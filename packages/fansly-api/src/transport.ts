// Where a ready request of ours leaves for Fansly (R20 docs/project-unite/
// architecture.md §8.5, §8.6; spec FS-NET-4, FX-001; as the Fansly extension's
// transport did it, a frame raised for the work instead of one for the shift).
//
// Two routes. The direct one is the event page's own `fetch`: Firefox gives it
// no tab (`tabId −1`), so a container's proxy never takes it and it leaves
// from the chatter's own line. «Fansly через вкладку» (the person's switch,
// off by default, X33) sends it through the relay frame of the model's tab: an
// extension page in a closed root of that tab, whose requests Firefox
// attributes to the tab and its container — the container's proxy carries
// them, as it carries the page's own. With the switch on there is no direct
// request ever, not even as a fallback: that line is what the mode avoids.
//
// With the switch off, a direct request that got no answer (the connection
// failed, or nothing came in time, the caller still waiting) sends everything
// after it through the relay frame as well, until the browser restarts (kept
// in storage.session, so the event page's sleeps do not forget it): a chatter
// whose tab rides a proxy and whose own line lets Fansly's small answers
// through but freezes the large ones (a send passes, a followers page or a
// chat never comes; Ivan, 2026-10-30) gets the background's work through the
// tab without knowing the switch, and loses one read a browser session at
// most. No frame of the session's tab — the direct route, as before.
//
// The route is chosen before anything is handed to the hub's custody (P9d):
// - a tab of the request's session — the one whose own page requests the core
//   bound to that session (P9a) — is asked to raise its frame
//   (`fansly.relay.open`: lazily, for a batch of work and 60 s after; the tab
//   holds the lease) and the route is ready only once the frame said it is up
//   (`fansly.relay.hello`, within 5 s): the account its tab was on when it
//   mounted it, and its own id. A frame of another account than the session's
//   known one is no route. No tab, no frame in time — `tab`, provably unsent;
// - `holds()` is the route's part of the last check, synchronous: the same
//   frame still up (a document that went took its frame with it; an account
//   that changed made its tab tear it down), its tab still registered, the
//   tab's page still on the same session. The client asks it right before it
//   sends; P9d's final check right before `start`;
// - `send()` dispatches before it yields, like `fetch`: the request is posted
//   to the frame (and the tab's lease renewed) in the same task, so nothing
//   asynchronous sits between the last check and the request. A frame that
//   took no post (gone a moment ago) — `FanslyRouteRefused`: provably no
//   request. The frame repeats its own part of the check before its own
//   `fetch`: the account it serves is the one the request expects, and it is
//   the frame the route was chosen with (`expect.relayId`); refused —
//   `failure: refused`, provably no request.
//
// The frame answers like `fetch`: the status and three headers first
// (`fansly.relay.head`) — a 429 or a 401 counts even when its body never comes
// — then the body. A frame that went before its answer: a dropped connection
// (sent, outcome unknown). An abort of the caller reaches the frame
// (`fansly.relay.abort`). Replies are taken from the frame that was asked
// alone. Requests through the frame carry the extension's origin, so the core
// never takes their headers for the page's session (FS-NET-2) and counts their
// 429 as ours, for the tab's creator.
//
// The relay's wire always names Fansly's own address (`FANSLY_RELAY_TARGET` +
// the path under the client's base): a test build's frame serves it from the
// stand it was pointed at, so the contract stays Fansly's alone.

import { FANSLY_API_BASE } from './allowlist';

/** The response as the client reads it: a status, the one header it needs and the body as text. */
export interface FanslyHttpResponse {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export type FanslyFetch = (url: string, init: RequestInit) => Promise<FanslyHttpResponse>;

/** What the client hands its route: the request built synchronously from the template as it is now. */
export interface FanslyWireRequest {
  /** The address under the client's base (FANSLY_API_BASE; a test build's stand). */
  readonly url: string;
  /** The same address under the base (`group/1/?ngsw-bypass=true`): the relay names it under Fansly's own. */
  readonly path: string;
  readonly method: 'GET' | 'POST';
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly signal: AbortSignal;
}

/** `direct`, or `tab:<tabSessionId>` of the relay frame (contracts send-fansly.ts `FanslySendTuple.transport`). */
export type FanslyTransportLabel = 'direct' | `tab:${string}`;

/** Provably no request: the route took nothing (no frame took the post, the frame's own check refused it). */
export class FanslyRouteRefused extends Error {
  override readonly name = 'FanslyRouteRefused';
  constructor(readonly reason: 'gone' | 'refused' | 'holds') {
    super(`fansly route refused: ${reason}`);
  }
}

/** Why no route came: no tab of the session, no frame in time, settings not read, a frame of another account. */
export class FanslyRouteUnavailable extends Error {
  override readonly name = 'FanslyRouteUnavailable';
  constructor(readonly reason: 'settings' | 'no-tab' | 'no-frame' | 'account' | 'aborted') {
    super(`fansly route unavailable: ${reason}`);
  }
}

export interface FanslyRoute {
  readonly transport: FanslyTransportLabel;
  /** The route's part of the last check, synchronous: true — a `send` now goes where the route was chosen. */
  holds(): boolean;
  /**
   * Dispatches before it yields (the request is with `fetch` or posted to the frame when this returns). Rejects with
   * `FanslyRouteRefused` when provably nothing left; with anything else the request may have left.
   */
  send(request: FanslyWireRequest): Promise<FanslyHttpResponse>;
}

export interface FanslyRouteRequest {
  /** The session the request carries: the template's legacy id, and its canonical one when known. */
  readonly legacyId: string;
  readonly canonicalId: string | null;
  /**
   * Through the session's tab whatever the person's switch says (a read whose CDN addresses the tab must load: they
   * are signed for the reader's line). No frame — unavailable, as with the switch on; the direct route never stands in.
   */
  readonly tab?: boolean;
  readonly signal?: AbortSignal;
}

export interface FanslyTransport {
  /** Chooses the route before the custody (§8.6); rejects with `FanslyRouteUnavailable`, nothing sent. */
  route(request: FanslyRouteRequest): Promise<FanslyRoute>;
  /** A request on the direct route got no answer (no connection, or none in time) while its caller still waited. */
  unanswered?(): void;
}

const directRoute = (doFetch: FanslyFetch, holds: () => boolean): FanslyRoute => ({
  transport: 'direct',
  holds,
  send(request) {
    if (!holds()) return Promise.reject(new FanslyRouteRefused('holds'));
    const { method, headers, body, signal } = request;
    try {
      return doFetch(request.url, {
        method,
        headers: { ...headers },
        ...(body === undefined ? {} : { body }),
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        signal,
      });
    } catch {
      return Promise.reject(new TypeError('fetch threw'));
    }
  },
});

/** The event page's own requests, always (the client's default; a world without the relay). */
export function directTransport(doFetch: FanslyFetch): FanslyTransport {
  const route = directRoute(doFetch, () => true);
  return { route: () => Promise.resolve(route) };
}

// ── the relay ──────────────────────────────────────────────────────────────

/** How long a route waits for the tab's frame to say it is up (its page loads, its port opens). */
export const RELAY_WAIT_MS = 5_000;
/** Response headers the client reads; the frame hands back no other. */
export const RELAY_RESPONSE_HEADERS = ['content-type', 'content-length', 'retry-after'] as const;
/** Where the relay's wire points: Fansly's API (contracts FANSLY_RELAY_TARGET). */
export const RELAY_TARGET = FANSLY_API_BASE;

/** A relay frame: its tab session and its frame in that tab (the core's sender of a relay). */
export interface RelayFrameRef {
  readonly tabSessionId: string;
  readonly frameId: number;
}

export interface RelayFetchEvent {
  readonly requestId: string;
  readonly method: 'GET' | 'POST';
  readonly url: string;
  readonly headers: Array<[string, string]>;
  readonly body?: string;
  readonly expect: { readonly hostAccountId: string; readonly relayId: string };
}

export interface RelayTransportPorts {
  /** «Fansly через вкладку» now: on, off, or null — the settings are not read (no route then: no guess, no fallback). */
  viaTab(): boolean | null;
  /** The settings read once more, when `viaTab` does not know yet (the module's start); still unknown — no route. */
  settled?(): Promise<void>;
  /** The site's registered tab sessions, oldest first. */
  tabs(): readonly { readonly tabSessionId: string; readonly tabId: number }[];
  /** The session (its legacy id) the tab's own page requests proved (the core's binding, P9a); null — none. */
  sessionOfTab(tabId: number): string | null;
  /** `fansly.relay.open` to the tab session: raise the frame or keep it 60 s more; false — it reached nobody. */
  open(tabSessionId: string): boolean;
  /** An event to the relay frames of one tab session (`fansly.relay.fetch`, `.abort`); how many got it. */
  post(tabSessionId: string, type: 'fansly.relay.fetch' | 'fansly.relay.abort', payload: RelayFetchEvent | { readonly requestId: string }): number;
  /** The direct route: the event page's `fetch` (the global one by default). */
  readonly fetch?: FanslyFetch;
  /** The direct line is taken for silent: now (`remembered: false`), or as this realm learns it from `lostMemory`. Once a realm. */
  directLost?(how: { readonly remembered: boolean }): void;
  /** Where the direct line's silence outlives the realm (storage.session: the event page's sleeps, not the browser's restart). */
  readonly lostMemory?: { load(): Promise<boolean>; save(): Promise<void> };
  readonly waitMs?: number;
  readonly randomUUID?: () => string;
  readonly setTimer?: (callback: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}

/** What the frame said when it came up (`fansly.relay.hello`). */
export interface RelayFrame extends RelayFrameRef {
  readonly hostAccountId: string;
  readonly relayId: string;
}

export interface RelayHub extends FanslyTransport {
  /** `fansly.relay.hello` of a frame; false — not taken. */
  hello(frame: RelayFrameRef, said: { readonly hostAccountId: string; readonly relayId: string }): boolean;
  /** `fansly.relay.head`, `.body`, `.failure` of a frame; false — no request of that frame waits for it. */
  head(frame: RelayFrameRef, reply: { readonly requestId: string; readonly status: number; readonly headers: ReadonlyArray<readonly [string, string]> }): boolean;
  body(frame: RelayFrameRef, reply: { readonly requestId: string; readonly body: string }): boolean;
  failure(frame: RelayFrameRef, reply: { readonly requestId: string; readonly reason: 'refused' | 'network' | 'aborted' | 'too-large' }): boolean;
  /** The core says a frame's port went: its unanswered requests end as a dropped connection. */
  gone(frame: RelayFrameRef): void;
  /** The frames up now (diagnostics, tests). */
  frames(): readonly RelayFrame[];
  /** Requests posted and not answered yet. */
  pending(): number;
}

const keyOf = (frame: RelayFrameRef): string => `${frame.tabSessionId}#${String(frame.frameId)}`;

interface PendingRelay {
  readonly frame: RelayFrame;
  readonly resolve: (response: FanslyHttpResponse) => void;
  readonly reject: (error: unknown) => void;
  /** Once the head came: the body's settlement. */
  body: { readonly resolve: (text: string) => void; readonly reject: (error: unknown) => void } | null;
  /** A body that came before its head (the core hands replies on in their order; this is insurance). */
  early: string | null;
  readonly cleanup: () => void;
}

interface Waiter {
  readonly tabSessionId: string;
  readonly done: (frame: RelayFrame) => void;
}

const relayLost = (): TypeError => new TypeError('Fansly relay frame lost');
/** An abort as `fetch` rejects it: the signal's own reason when it is an error. */
const abortReason = (signal: AbortSignal): Error => (signal.reason instanceof Error ? signal.reason : new DOMException('The operation was aborted.', 'AbortError'));

/**
 * The relay as a transport, and the module's handle on what the frames say. One per realm of the event page: the
 * frames say hello again on every new port, so nothing of it is kept across a sleep.
 */
export function createRelayTransport(ports: RelayTransportPorts): RelayHub {
  const waitMs = ports.waitMs ?? RELAY_WAIT_MS;
  const uuid = ports.randomUUID ?? (() => crypto.randomUUID());
  const setTimer = ports.setTimer ?? ((callback: () => void, ms: number): unknown => setTimeout(callback, ms));
  const clearTimer = ports.clearTimer ?? ((handle: unknown): void => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const live = new Map<string, RelayFrame>();
  const requests = new Map<string, PendingRelay>();
  const waiters = new Set<Waiter>();
  const direct = directRoute(ports.fetch ?? ((url, init) => fetch(url, init)), () => ports.viaTab() === false);
  /** A direct request got no answer, in this realm or an earlier one of this browser session. */
  let lost = false;
  let recalled: Promise<void> | null = null;
  const recall = (): Promise<void> =>
    (recalled ??= (ports.lostMemory?.load() ?? Promise.resolve(false)).then(
      (was) => {
        if (!was || lost) return;
        lost = true;
        ports.directLost?.({ remembered: true });
      },
      () => undefined,
    ));

  /** The newest frame up in a tab session (a second frame of one document is a stale one going away). */
  const frameOf = (tabSessionId: string): RelayFrame | null => {
    let found: RelayFrame | null = null;
    for (const frame of live.values()) if (frame.tabSessionId === tabSessionId) found = frame;
    return found;
  };

  const waitFor = (tabSessionId: string, signal: AbortSignal | undefined): Promise<RelayFrame> =>
    new Promise((resolve, reject) => {
      const finish = (settle: () => void): void => {
        clearTimer(timer);
        waiters.delete(waiter);
        signal?.removeEventListener('abort', onAbort);
        settle();
      };
      const waiter: Waiter = { tabSessionId, done: (frame) => finish(() => resolve(frame)) };
      const onAbort = (): void => finish(() => reject(new FanslyRouteUnavailable('aborted')));
      const timer = setTimer(() => finish(() => reject(new FanslyRouteUnavailable('no-frame'))), waitMs);
      waiters.add(waiter);
      signal?.addEventListener('abort', onAbort, { once: true });
    });

  function settle(pending: PendingRelay, requestId: string, outcome: { readonly error: unknown } | { readonly text: string }): void {
    requests.delete(requestId);
    pending.cleanup();
    if ('text' in outcome) {
      if (pending.body !== null) pending.body.resolve(outcome.text);
      return;
    }
    if (pending.body !== null) pending.body.reject(outcome.error);
    else pending.reject(outcome.error);
  }

  function tabRoute(tabSessionId: string, tabId: number, frame: RelayFrame, legacyId: string): FanslyRoute {
    const holds = (): boolean =>
      live.get(keyOf(frame)) === frame && ports.tabs().some((tab) => tab.tabSessionId === tabSessionId && tab.tabId === tabId) && ports.sessionOfTab(tabId) === legacyId;
    return {
      transport: `tab:${tabSessionId}`,
      holds,
      send(request) {
        if (request.signal.aborted) return Promise.reject(abortReason(request.signal));
        if (!holds()) return Promise.reject(new FanslyRouteRefused('holds'));
        const requestId = uuid();
        const event: RelayFetchEvent = {
          requestId,
          method: request.method,
          url: `${RELAY_TARGET}${request.path}`,
          headers: Object.entries(request.headers),
          ...(request.body === undefined ? {} : { body: request.body }),
          expect: { hostAccountId: frame.hostAccountId, relayId: frame.relayId },
        };
        return new Promise<FanslyHttpResponse>((resolve, reject) => {
          const onAbort = (): void => {
            const pending = requests.get(requestId);
            if (pending === undefined) return;
            ports.post(tabSessionId, 'fansly.relay.abort', { requestId });
            settle(pending, requestId, { error: abortReason(request.signal) });
          };
          const pending: PendingRelay = { frame, resolve, reject, body: null, early: null, cleanup: () => request.signal.removeEventListener('abort', onAbort) };
          requests.set(requestId, pending);
          request.signal.addEventListener('abort', onAbort, { once: true });
          // The lease first: the frame stays for this request's answer (the tab counts 60 s from now).
          ports.open(tabSessionId);
          let delivered: number;
          try {
            delivered = ports.post(tabSessionId, 'fansly.relay.fetch', event);
          } catch {
            delivered = 0;
          }
          if (delivered === 0) settle(pending, requestId, { error: new FanslyRouteRefused('gone') });
        });
      },
    };
  }

  const pendingOf = (frame: RelayFrameRef, requestId: string): PendingRelay | null => {
    const pending = requests.get(requestId);
    return pending !== undefined && keyOf(pending.frame) === keyOf(frame) ? pending : null;
  };

  function gone(ref: RelayFrameRef): void {
    const key = keyOf(ref);
    live.delete(key);
    for (const [requestId, pending] of [...requests]) if (keyOf(pending.frame) === key) settle(pending, requestId, { error: relayLost() });
  }

  async function viaFrame(legacyId: string, canonicalId: string | null, signal: AbortSignal | undefined): Promise<FanslyRoute> {
    if (signal?.aborted === true) throw new FanslyRouteUnavailable('aborted');
    const candidates = ports.tabs().filter((tab) => ports.sessionOfTab(tab.tabId) === legacyId);
    // A tab whose frame is up already (the newest such), else the newest tab of the session.
    const target = [...candidates].reverse().find((tab) => frameOf(tab.tabSessionId) !== null) ?? candidates.at(-1);
    if (target === undefined) throw new FanslyRouteUnavailable('no-tab');
    if (!ports.open(target.tabSessionId)) throw new FanslyRouteUnavailable('no-tab');
    const frame = frameOf(target.tabSessionId) ?? (await waitFor(target.tabSessionId, signal));
    if (canonicalId !== null && frame.hostAccountId !== canonicalId) throw new FanslyRouteUnavailable('account');
    return tabRoute(target.tabSessionId, target.tabId, frame, legacyId);
  }

  return {
    async route({ legacyId, canonicalId, tab, signal }) {
      if (tab !== true) {
        let mode = ports.viaTab();
        if (mode === null && ports.settled !== undefined) {
          await ports.settled().catch(() => undefined);
          mode = ports.viaTab();
        }
        if (mode === null) throw new FanslyRouteUnavailable('settings');
        if (mode === false) {
          await recall();
          if (!lost) return direct;
          // The direct line went unanswered: the tab's frame if one serves the session, else direct as before.
          try {
            return await viaFrame(legacyId, canonicalId, signal);
          } catch (error) {
            if (error instanceof FanslyRouteUnavailable && error.reason === 'aborted') throw error;
            return direct;
          }
        }
      }
      return viaFrame(legacyId, canonicalId, signal);
    },
    unanswered() {
      if (lost) return;
      lost = true;
      ports.lostMemory?.save().catch(() => undefined);
      ports.directLost?.({ remembered: false });
    },
    hello(ref, said) {
      const frame: RelayFrame = { tabSessionId: ref.tabSessionId, frameId: ref.frameId, hostAccountId: said.hostAccountId, relayId: said.relayId };
      const key = keyOf(frame);
      const before = live.get(key);
      // A frame that came up anew under the same place is another frame: what the old one held is lost.
      if (before !== undefined && before.relayId !== frame.relayId) gone(before);
      live.set(key, frame);
      for (const waiter of [...waiters]) if (waiter.tabSessionId === frame.tabSessionId) waiter.done(frame);
      return true;
    },
    head(frame, reply) {
      const pending = pendingOf(frame, reply.requestId);
      if (pending === null || pending.body !== null) return false;
      const headers = new Map(reply.headers.filter(([name]) => (RELAY_RESPONSE_HEADERS as readonly string[]).includes(name)).map(([name, value]) => [name, value]));
      const text = new Promise<string>((resolve, reject) => {
        pending.body = { resolve, reject };
      });
      // A caller that acts on the status alone never reads the body: its end must not be an unhandled rejection.
      text.catch(() => undefined);
      pending.resolve({ status: reply.status, headers: { get: (name) => headers.get(name.toLowerCase()) ?? null }, text: () => text });
      if (pending.early !== null) settle(pending, reply.requestId, { text: pending.early });
      return true;
    },
    body(frame, reply) {
      const pending = pendingOf(frame, reply.requestId);
      if (pending === null) return false;
      if (pending.body === null) {
        pending.early = reply.body;
        return true;
      }
      settle(pending, reply.requestId, { text: reply.body });
      return true;
    },
    failure(frame, reply) {
      const pending = pendingOf(frame, reply.requestId);
      if (pending === null) return false;
      // Only the frame's own refusal before its fetch is provably no request; a failure after it, or after a head, is not.
      settle(pending, reply.requestId, { error: reply.reason === 'refused' && pending.body === null ? new FanslyRouteRefused('refused') : relayLost() });
      return true;
    },
    gone,
    frames: () => [...live.values()],
    pending: () => requests.size,
  };
}
