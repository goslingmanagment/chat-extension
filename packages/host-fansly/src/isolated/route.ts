// Fansly's route in the isolated world (docs/project-unite/architecture.md
// §7.2; FS-RTE-1…4): the address is the one source — `location.pathname` by
// `^/messages/(\d+)$`, its number the conversation's group (`conversationRef`);
// the fan of that group comes later, from MAIN's `fx.chat` (host-port.ts).
//
// No polling and no hook on `history` (FS-RTE-3, BG-009: the old extension
// read the address twice every 500 ms). The address is read again on a
// SIGNAL: a callback of the anchor observers (anchors.ts) — Fansly re-creates
// the conversation's container in the same task as its `pushState`, so they
// see every change of chat —, `popstate`, `pageshow`, and on Firefox ≥ 147
// the Navigation API's `currententrychange`, an early signal, not the base.
// Each change of the address is a new route epoch: an answer or an intent of
// an older epoch is dropped (FS-RTE-4).
//
// What keeps that claim honest is a VERIFICATION without a signal: on
// `visibilitychange`, `focus` and every action of our UI (the port's reads
// and writes), the address is compared once more. A change found there is
// counted («адрес сменился без сигнала») and goes to the log: it must stay at
// zero; if it does not, Fansly changed how it navigates. The insert's safety
// does not rest on the route (FS-INS-1 re-checks everything, P7e).
//
// The gallery takes the header and the container away without a change of
// address: that is no change of route (anchors.ts sees the nodes go, the
// address stays).

/** FS-RTE-1: a conversation's address. Its number must be a Fansly id (NATIVE_ID_PATTERN): no leading zero. */
const CONVERSATION = /^\/messages\/([1-9]\d{0,29})$/;

/** The conversation's group of an address, or null: the old extension's rule made strict (AU-033). */
export function groupIdOfPath(pathname: string): string | null {
  return CONVERSATION.exec(pathname)?.[1] ?? null;
}

/**
 * The route by the address alone, for the early key dispatcher: a conversation is a chat, everything else is other
 * (Fansly has no route of an account). `epoch` is the path: a key kept for the lazy part runs only on the same one.
 */
export function routeOfLocation(location: Pick<Location, 'pathname'>): { readonly kind: 'chat' | 'account' | 'other'; readonly epoch: string } {
  return { kind: groupIdOfPath(location.pathname) === null ? 'other' : 'chat', epoch: location.pathname };
}

/** Where a fresh look at the address came from: a signal of the page, or a verification without one. */
export type RouteSignal = 'observer' | 'popstate' | 'pageshow' | 'navigation';
export type RouteVerification = 'visibility' | 'focus' | 'ui';

/** The route as the address names it. `epoch` grows by one on every change of the address (and on a bfcache return). */
export interface FanslyRoute {
  readonly path: string;
  /** The conversation's group (`RouteState.conversationRef`); null — not a conversation. */
  readonly groupId: string | null;
  readonly epoch: number;
}

export interface RouteChange {
  readonly route: FanslyRoute;
  readonly previous: FanslyRoute;
  /** What noticed it: a signal, a verification (an unsignalled change) or the page's return from bfcache. */
  readonly via: RouteSignal | RouteVerification;
}

export interface RouteStats {
  /** Changes of the route since the start. */
  readonly changes: number;
  /** Changes a verification found before any signal did (FS-RTE-3: must stay 0). */
  readonly unsignalled: number;
}

export interface RouteWatcher {
  current(): FanslyRoute;
  /** A signal of the page: the address is read again now. */
  signal(source: RouteSignal): void;
  /** A verification without a signal (our UI acted, the tab came back): a change found here is counted. */
  verify(source: RouteVerification): void;
  onChange(listener: (change: RouteChange) => void): () => void;
  stats(): RouteStats;
  dispose(): void;
}

export interface RouteDiagnostic {
  readonly event: string;
  readonly detail?: Readonly<Record<string, string | number | boolean | null>>;
}

/** The part of the Navigation API the watcher listens to (Firefox ≥ 147); absent before it. */
type NavigationLike = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

/**
 * Watches the address of `win` by signals. Synchronous and cheap at document_start: it reads the path once and adds
 * its listeners; nothing runs on a timer.
 */
export function createRouteWatcher(win: Window, onDiagnostic?: (diagnostic: RouteDiagnostic) => void): RouteWatcher {
  const doc = win.document;
  const path = (): string => win.location.pathname;
  let route: FanslyRoute = { path: path(), groupId: groupIdOfPath(path()), epoch: 1 };
  let changes = 0;
  let unsignalled = 0;
  let disposed = false;
  const listeners = new Set<(change: RouteChange) => void>();

  const move = (next: string, via: RouteSignal | RouteVerification): void => {
    const previous = route;
    route = { path: next, groupId: groupIdOfPath(next), epoch: previous.epoch + 1 };
    changes += 1;
    for (const listener of [...listeners]) listener({ route, previous, via });
  };

  const signal = (source: RouteSignal): void => {
    if (disposed) return;
    const next = path();
    if (next !== route.path) move(next, source);
  };

  const verify = (source: RouteVerification): void => {
    if (disposed) return;
    const next = path();
    if (next === route.path) return;
    unsignalled += 1;
    // Only the kind of route and the count: an address names a conversation, the log never does.
    onDiagnostic?.({ event: 'route-unsignalled', detail: { via: source, count: unsignalled, chat: groupIdOfPath(next) !== null } });
    move(next, source);
  };

  const onPopState = (): void => signal('popstate');
  const onPageShow = (event: Event): void => {
    if (disposed) return;
    // Back from the back-forward cache: whatever was on its way before belongs to another life of the page — a new
    // epoch even on the same address (FS-RTE-2, FS-RTE-4).
    if ((event as PageTransitionEvent).persisted) move(path(), 'pageshow');
    else signal('pageshow');
  };
  const onEntryChange = (): void => signal('navigation');
  const onVisibility = (): void => verify('visibility');
  const onFocus = (): void => verify('focus');

  const navigation = (win as Window & { readonly navigation?: NavigationLike }).navigation;
  win.addEventListener('popstate', onPopState);
  win.addEventListener('pageshow', onPageShow);
  win.addEventListener('focus', onFocus);
  doc.addEventListener('visibilitychange', onVisibility);
  navigation?.addEventListener('currententrychange', onEntryChange);

  return {
    current: () => route,
    signal,
    verify,
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    stats: () => ({ changes, unsignalled }),
    dispose() {
      if (disposed) return;
      disposed = true;
      listeners.clear();
      win.removeEventListener('popstate', onPopState);
      win.removeEventListener('pageshow', onPageShow);
      win.removeEventListener('focus', onFocus);
      doc.removeEventListener('visibilitychange', onVisibility);
      navigation?.removeEventListener('currententrychange', onEntryChange);
    },
  };
}
