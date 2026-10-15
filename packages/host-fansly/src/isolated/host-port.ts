// HostPort for Fansly (docs/project-unite/architecture.md §7.7): the isolated
// world's face of a Fansly tab. It never touches the network or the hub token
// and makes no request of its own to Fansly; it reads MAIN's stream (stream.ts)
// and the page's DOM by its anchors (anchors.ts), and the address (route.ts).
//
// - `current`/`subscribe`: the identity (identity.ts), the route with its
//   group, the composer, the theme. One `sync()` makes all of them agree after
//   any input moved — the address, the anchors, a state of MAIN — and says
//   what changed, the route before the composer.
// - Every change of route asks MAIN to focus its group (`fx.focus`, with the
//   route's epoch); MAIN answers with `fx.chat` of the same epoch, and only
//   that one is taken (FS-RTE-4). A MAIN that answers `not-ready` (before P7b)
//   leaves the chat unknown: honest «not yet», never a guess.
// - `chatWindow` and `fan` answer synchronously from that `fx.chat`;
//   `readVisibleTail` is null (on Fansly the tail is the snapshot's,
//   `freshness`); `listCachedChats` is empty until P17.
// - `readDraft` reads the main field itself (`textarea.message-input` under
//   the route); its revision counts the `input` events we saw on it, its
//   digest is host-kit's. `focusComposer` focuses that field after the same
//   checks. A field of another chat, route, creator or document is refused.
// - Writes come with their work packages: `insert` and `navigate` (P7e) are
//   refused here before anything is spent (no token is redeemed), the send's
//   observation is P7f's; `checkpoint` and `previewSend` are ChatSpace's X8 and
//   do not exist here.
// - `fansly` (FanslyPagePort): the header slot is said from the anchors (its
//   mount is P7d's and P11a's); a file into the field (P12c), the vault (P13b)
//   and the relay (P9c) are refused until then.
//
// Before MAIN's first state the port knows only the address; without MAIN at
// all it still answers, and its report says CG-HOST-NOT-READY.

import type { FanslyChatWire, FanslyContractWire, FanslyHealth, FanslyState, FromMainFansly } from '@cg/contracts/bridge-messages-fansly';
import type { CgCode } from '@cg/contracts/errors';
import type { FanslyHeaderSlot, FanslyPagePort } from '@cg/contracts/fansly';
import type { FanslyContractReport, FanslyHostPort } from '@cg/contracts/fansly-host';
import type { ChatWindow, ComposerState, HostContractReport, HostEvent, HostFan, HostSnapshot, HostTheme, InsertReceipt, NavigationIntent, NavigationReceipt, RouteState, Unsubscribe } from '@cg/contracts/host';
import type { ChatRef, DraftSnapshot, HostAccount, HostIdentity } from '@cg/contracts/ids';
import { digest } from '@cg/host-kit/common/digest';
import { sameReport } from '@cg/host-kit/isolated/report';

import { DOM_ANCHORS_NOT_YET, judgeAnchors, type AnchorStats, type AnchorWatcher, type DomAnchorStates } from './anchors';
import { BridgeCallError, type FanslyMainBridgeClient } from './bridge-client';
import { FANSLY_ADAPTER_VERSION, buildFanslyReport, buildOf, type Observation } from './contract';
import { createFreshnessPort } from './freshness';
import { FANSLY_KIND, FANSLY_PLATFORM, accountOf, chatFits, chatWindowOf, fanOf, identityMatches, identityOf, routeStateOf, sameChat, sameRoute } from './identity';
import type { FanslyMounts } from './mount';
import type { RouteStats, RouteWatcher } from './route';
import { consumeStream, type StreamStats } from './stream';

/** What the host tells the tab's log: an event, its code, a few plain facts — never a text, a name or an id of a fan. */
export interface FanslyDiagnostic {
  readonly event: string;
  readonly code?: CgCode;
  readonly detail?: Readonly<Record<string, string | number | boolean | null>>;
}

/** Fansly's theme as its page shows it: the light scheme until P8d reads the page's own. */
export interface FanslyTheme {
  current(): HostTheme;
  onChange(listener: (theme: HostTheme) => void): () => void;
  dispose(): void;
}

/** This side's counts: the route, the anchors' observers, the stream. */
export interface FanslyIsolatedHealth {
  readonly route: RouteStats;
  readonly anchors: AnchorStats;
  readonly stream: StreamStats | null;
  /** `fx.chat` answers dropped as of another route epoch or group (FS-RTE-4). */
  readonly staleChats: number;
}

export interface FanslyPort extends FanslyHostPort {
  /** Resolves once MAIN's first state was taken (or asked in vain, or at once without MAIN). */
  readonly ready: Promise<void>;
  /** The identity reads and writes are checked against now; null when there is none. */
  identity(): HostIdentity | null;
  probe(): FanslyContractReport;
  /** «Проверить»: MAIN's state and the anchors read again — nothing of Fansly's network. */
  recheck(): Promise<FanslyContractReport>;
  /** This side's counts and MAIN's own (`fx.health`, null when it does not answer): «Статус», client_health, the e2e. */
  health(): Promise<{ readonly isolated: FanslyIsolatedHealth; readonly main: FanslyHealth | null }>;
}

export interface FanslyHostPortOptions {
  readonly win: Window;
  /** null — MAIN never answered the handshake. */
  readonly bridge: FanslyMainBridgeClient | null;
  readonly mounts: FanslyMounts;
  readonly theme: FanslyTheme;
  readonly route: RouteWatcher;
  readonly anchors: AnchorWatcher;
  readonly adapterVersion?: string;
  readonly now?: () => number;
  readonly onDiagnostic?: (diagnostic: FanslyDiagnostic) => void;
}

/** Sites of MAIN's guarded failures logged per document. */
const MAX_FAULT_SITES = 64;
/** The longest draft a snapshot carries (contracts DraftSnapshotSchema). */
const DRAFT_MAX = 20_000;

const rejected = (code: CgCode): InsertReceipt => ({ state: 'rejected', code });

export function createFanslyHostPort(options: FanslyHostPortOptions): FanslyPort {
  const { win, bridge, mounts, theme, route, anchors } = options;
  const doc = win.document;
  const clock = options.now ?? (() => Date.now());
  const adapterVersion = options.adapterVersion ?? FANSLY_ADAPTER_VERSION;
  const diag = (diagnostic: FanslyDiagnostic): void => options.onDiagnostic?.(diagnostic);

  let disposed = false;
  let creator: string | null = null;
  /** Grows whenever the creator changes: an identity of another creator matches nothing (§5.7). */
  let logins = 0;
  let network: FanslyContractWire | null = null;
  /** MAIN's chat for the current route's group and epoch; null — not known. */
  let chatWire: FanslyChatWire | null = null;
  let observation: Observation = 'unknown';
  /** The route epoch `fx.focus` was last asked for; null — none yet. */
  let focused: number | null = null;
  let staleChats = 0;
  let dom: DomAnchorStates = DOM_ANCHORS_NOT_YET;
  let build: string | null = null;
  let reloadNeeded = false;
  const faults = new Map<string, number>();

  let routeState: RouteState = routeStateOf(route.current(), null, null);
  let composer: ComposerState | null = null;
  /** The projection of the composer views read (§11: a keystroke that changes none of it says nothing). */
  let composerSeen = '';
  let slot: FanslyHeaderSlot = { state: 'none', reason: 'no-chat' };
  let report: FanslyContractReport = compute();

  // ── the main field: its instance and its revision ──
  const instances = new WeakMap<Element, string>();
  let instanceSerial = 0;
  let revision = 0;
  let field: HTMLTextAreaElement | null = null;
  const onInput = (): void => {
    revision += 1;
    if (composer === null) return;
    // A keystroke that changes nothing the views read is said to nobody (§11); the revision is kept current all the same.
    if (provenance() !== composer.draft.provenance) sync();
    else composer = { ...composer, draft: { revision, provenance: composer.draft.provenance } };
  };
  const instanceOf = (element: Element): string => {
    let token = instances.get(element);
    if (token === undefined) {
      instanceSerial += 1;
      token = `f${instanceSerial}`;
      instances.set(element, token);
    }
    return token;
  };
  const provenance = (): 'empty' | 'human-or-unknown' => (field === null || field.value.trim() === '' ? 'empty' : 'human-or-unknown');
  const follow = (next: HTMLTextAreaElement | null): void => {
    if (next === field) return;
    field?.removeEventListener('input', onInput);
    field = next;
    field?.addEventListener('input', onInput);
  };

  const eventListeners = new Set<(event: HostEvent) => void>();
  const contractListeners = new Set<(report: HostContractReport) => void>();
  const slotListeners = new Set<(slot: FanslyHeaderSlot) => void>();
  const emit = (event: HostEvent): void => {
    for (const listener of [...eventListeners]) listener(event);
  };

  function compute(): FanslyContractReport {
    return buildFanslyReport({ bridge: bridge !== null, wire: network, creator: creator !== null, observation, dom, build, adapterVersion, checkedAt: clock() });
  }

  const loginEpoch = (): string | null => (creator === null ? null : `fansly-${logins}`);
  const identity = (): HostIdentity | null =>
    identityOf({ documentEpoch: bridge?.documentEpoch ?? null, loginEpoch: loginEpoch(), route: routeState, composerInstanceId: composer?.instanceId ?? null });
  const accounts = (): readonly HostAccount[] => {
    const account = accountOf(creator);
    return account === null ? [] : [account];
  };

  const headerSlot = (): FanslyHeaderSlot => {
    if (routeState.name !== 'chat' || routeState.conversationRef === undefined) return { state: 'none', reason: 'no-chat' };
    if (routeState.conversationKind === 'group') return { state: 'none', reason: 'group' };
    const conversation = anchors.current().conversation;
    if (conversation?.gallery === true) return { state: 'none', reason: 'gallery' };
    if (dom.headerSubRow === 'missing') return { state: 'none', reason: 'anchor-missing' };
    if (routeState.chat === null || !conversation?.subRow) return { state: 'none', reason: 'no-chat' };
    return { state: 'ready', groupId: routeState.conversationRef, fanId: routeState.chat.platformFanId };
  };

  // ── MAIN: the focus of the route's group ──
  const focus = (epoch: number, groupId: string | null): void => {
    if (bridge === null || disposed) return;
    focused = epoch;
    bridge.request('fx.focus', { groupId, routeEpoch: epoch }).then(
      () => {
        if (observation === 'ready') return;
        observation = 'ready';
        sync();
      },
      (error: unknown) => {
        // A MAIN without the observation (before P7b) says `not-ready`: the chat stays unknown, honestly.
        if (!(error instanceof BridgeCallError) || error.failure !== 'not-ready' || observation === 'off') return;
        observation = 'off';
        sync();
      },
    );
  };

  let syncing = false;
  let syncAgain = false;
  /**
   * Everything the port says, made to agree with the address, the anchors and MAIN's last word; changes said in order.
   * A listener that makes the port look again while it speaks (our UI reads the draft on a route event) runs it once
   * more afterwards: the last word said is always the newest.
   */
  function sync(): void {
    if (disposed) return;
    if (syncing) {
      syncAgain = true;
      return;
    }
    syncing = true;
    try {
      do {
        syncAgain = false;
        syncOnce();
      } while (syncAgain && !disposed);
    } finally {
      syncing = false;
    }
  }

  function syncOnce(): void {
    const now = route.current();
    if (chatWire !== null && !chatFits(now, chatWire)) chatWire = null;
    if (stream?.started() === true && focused !== now.epoch) focus(now.epoch, now.groupId);
    const nextRoute = routeStateOf(now, creator, chatWire);
    const routeMoved = !sameRoute(nextRoute, routeState);
    routeState = nextRoute;

    const conversation = anchors.current().conversation;
    follow(conversation?.textarea ?? null);
    const chat = routeState.chat;
    composer =
      chat !== null && field !== null && conversation !== null
        ? {
            chat,
            instanceId: instanceOf(field),
            ready: field.isConnected && !field.disabled,
            hidden: conversation.copyOnly || chatWire?.dmAllowed === false,
            draft: { revision, provenance: provenance() },
          }
        : null;
    const seen = composer === null ? 'none' : [composer.instanceId, composer.ready, composer.hidden, composer.draft.provenance, chat?.platformFanId].join('|');

    dom = judgeAnchors(doc, { anchors: anchors.current(), chat: now.groupId !== null, path: now.path, exhausted: anchors.stats().exhausted, direct: chatWire?.kind === 'direct' }, dom);
    build ??= buildOf(doc);
    const next = compute();
    const reportMoved = !sameReport(next, report);
    if (reportMoved) report = next;

    const nextSlot = headerSlot();
    const slotMoved = JSON.stringify(nextSlot) !== JSON.stringify(slot);
    slot = nextSlot;

    if (routeMoved) emit({ type: 'route', route: routeState });
    if (seen !== composerSeen) {
      composerSeen = seen;
      emit({ type: 'composer', composer });
    }
    if (slotMoved) for (const listener of [...slotListeners]) listener(slot);
    if (reportMoved) for (const listener of [...contractListeners]) listener(report);
  }

  // ── MAIN's stream ──
  const setCreator = (next: string | null): void => {
    if (next === creator) return;
    creator = next;
    logins += 1;
    sync();
    emit({ type: 'accounts', accounts: accounts() });
  };

  /** fx.chat of the route's group and epoch: taken; any other is late (A → B → A) and dropped. */
  const takeChat = (wire: FanslyChatWire): void => {
    if (!chatFits(route.current(), wire) || focused !== wire.routeEpoch) {
      staleChats += 1;
      return;
    }
    const before = chatWire;
    chatWire = wire;
    sync();
    const chat = routeState.chat;
    if (chat !== null && before !== null && JSON.stringify(before.window) !== JSON.stringify(wire.window)) emit({ type: 'chatCache', chat });
  };

  const onState = (state: FanslyState): void => {
    network = state.contract;
    if (state.chat !== null && chatFits(route.current(), state.chat) && focused === state.chat.routeEpoch) chatWire = state.chat;
    if (state.identity.creatorId !== creator) setCreator(state.identity.creatorId);
    else sync();
  };

  const onEvent = (event: FromMainFansly): void => {
    switch (event.t) {
      case 'fx.identity':
        return setCreator(event.p.creatorId);
      case 'fx.chat':
        return takeChat(event.p);
      case 'fx.contract':
        network = event.p;
        return sync();
      // The stream's facts — new messages, follows, coverage, deletions, sends, the vault — are taken by the work
      // packages that act on them (P8b1, P14a, P7f, P13b); here they are acknowledged with their batch.
      case 'fx.incoming':
      case 'fx.follow':
      case 'fx.coverage':
      case 'fx.deleted':
      case 'fx.sent':
      case 'fx.vaultAdded':
        return;
    }
  };

  const stream =
    bridge === null
      ? null
      : consumeStream(
          bridge,
          {
            state: onState,
            event: onEvent,
            lost(reason) {
              diag({ event: 'stream-lost', detail: { reason } });
              // Every chat unknown until the next state (FS-TAIL-5): the window the tab holds says so at once.
              if (chatWire === null) return;
              chatWire = { ...chatWire, window: { ...chatWire.window, completeness: 'unknown' } };
              if (routeState.chat !== null) emit({ type: 'chatCache', chat: routeState.chat });
            },
            fault(source, count) {
              // MAIN says a site's count at 1, 2, 4, 8…: one is logged when it at least doubled the last.
              const last = faults.get(source);
              if ((last === undefined && faults.size >= MAX_FAULT_SITES) || count < 2 * (last ?? 0.5)) return;
              faults.set(source, count);
              diag({ event: 'main-fault', code: 'CG-UNKNOWN', detail: { source, count } });
            },
          },
          (failure) => diag({ event: 'state-failed', detail: { failure } }),
        );

  /** A state was never taken (it failed): the next signal of the page asks again. */
  const resyncIfNeeded = (): void => {
    if (stream !== null && !stream.started()) void stream.resync();
  };

  const offRoute = route.onChange((change) => {
    if (change.via === 'pageshow') {
      // Back from bfcache: MAIN's states are asked again whole (FS-RTE-2).
      void stream?.resync();
    } else resyncIfNeeded();
    sync();
  });
  const offAnchors = anchors.onChange(() => sync());

  /** MAIN came after the page began (installed or updated under an open tab): the person is asked to reload (FS-IDN-4). */
  const noteLateStart = async (): Promise<void> => {
    const probe = await bridge?.probe().catch(() => null);
    if (!probe || probe.readyStateAtStart === 'loading' || reloadNeeded) return;
    reloadNeeded = true;
    diag({ event: 'late-start', detail: { startReadyState: probe.readyStateAtStart } });
    emit({ type: 'reloadNeeded' });
  };
  const ready = stream === null ? Promise.resolve() : stream.resync().then(() => (sync(), noteLateStart()));
  sync();

  /** Our UI acts: the address is verified first (FS-RTE-3), the anchors read again. */
  const acting = (): void => {
    route.verify('ui');
    anchors.refresh();
    resyncIfNeeded();
  };

  /** The open field a read or a focus names, or why not. */
  const fieldFor = (expected: HostIdentity, t: string): HTMLTextAreaElement | BridgeCallError => {
    acting();
    const current = identity();
    if (bridge === null || current === null) return new BridgeCallError('not-ready', t);
    if (!identityMatches(expected, current) || current.chat === null || composer === null || field === null || expected.composerInstanceId !== composer.instanceId) {
      return new BridgeCallError('identity-mismatch', t);
    }
    return field;
  };

  const freshness = createFreshnessPort({ bridge, beforeAsk: acting, onDiagnostic: diag });

  const page: FanslyPagePort = {
    headerSlot: () => slot,
    onHeaderSlot(cb): Unsubscribe {
      slotListeners.add(cb);
      return () => {
        slotListeners.delete(cb);
      };
    },
    attachToComposer: () => Promise.resolve({ state: 'refused', reason: 'anchor-missing' }),
    uploadToVault: () => Promise.resolve({ state: 'refused', reason: 'anchor-missing' }),
    relay: { open: () => Promise.resolve('failed'), close: () => undefined },
  };

  return {
    kind: FANSLY_KIND,
    platform: FANSLY_PLATFORM,
    ready,
    identity,
    previewSend: null,
    freshness,
    fansly: page,

    probe: () => report,
    onContract(cb): Unsubscribe {
      contractListeners.add(cb);
      return () => {
        contractListeners.delete(cb);
      };
    },
    current(): HostSnapshot {
      return { kind: FANSLY_KIND, identity: identity(), route: routeState, composer, accounts: accounts(), contract: report, mounts: mounts.points(), theme: theme.current() };
    },
    subscribe(cb): Unsubscribe {
      eventListeners.add(cb);
      if (reloadNeeded) queueMicrotask(() => eventListeners.has(cb) && cb({ type: 'reloadNeeded' }));
      return () => {
        eventListeners.delete(cb);
      };
    },
    async recheck() {
      if (stream !== null) await stream.resync();
      anchors.refresh();
      sync();
      return report;
    },
    async health() {
      const main = bridge === null ? null : await bridge.request('fx.health', {}).catch(() => null);
      return { isolated: { route: route.stats(), anchors: anchors.stats(), stream: stream?.stats() ?? null, staleChats }, main };
    },

    readDraft(expected: HostIdentity): Promise<DraftSnapshot> {
      const found = fieldFor(expected, 'readDraft');
      if (found instanceof BridgeCallError) return Promise.reject(found);
      const text = found.value;
      const current = identity() as HostIdentity;
      return Promise.resolve({ identity: current, revision, plainText: text.slice(0, DRAFT_MAX), provenance: provenance(), digest: digest(text) });
    },
    readVisibleTail: () => Promise.resolve(null),
    chatWindow(chat: ChatRef): ChatWindow | null {
      return chatWire !== null && sameChat(chat, routeState.chat) ? chatWindowOf(chat, chatWire) : null;
    },
    fan(chat: ChatRef): HostFan | null {
      return chatWire !== null && sameChat(chat, routeState.chat) ? fanOf(chat, chatWire) : null;
    },
    listCachedChats: () => [],
    listCachedAccounts: accounts,

    // The insert and «Открыть и вставить» are P7e's (§7.5, §7.6): refused before anything is spent or written.
    insert: (): Promise<InsertReceipt> => Promise.resolve(rejected(report.capabilities.insert.code ?? 'CG-HOST-NOT-READY')),
    navigate: (intent: NavigationIntent): Promise<NavigationReceipt> =>
      Promise.resolve({ state: 'failed', code: 'CG-NAV-FAILED', insert: intent.thenInsert === undefined ? null : rejected('CG-NAV-FAILED') }),
    focusComposer(expected: HostIdentity): Promise<boolean> {
      const found = fieldFor(expected, 'focus');
      if (found instanceof BridgeCallError) return Promise.resolve(false);
      found.focus();
      return Promise.resolve(doc.activeElement === found);
    },
    // X8's freshness checkpoint is ChatSpace's; Fansly's freshness is the snapshot.
    checkpoint: () => Promise.resolve(null),

    mounts: () => mounts.points(),
    onMounts: (cb): Unsubscribe => mounts.onChange(cb),
    theme: () => theme.current(),
    onTheme: (cb): Unsubscribe => theme.onChange(cb),

    dispose() {
      if (disposed) return;
      disposed = true;
      stream?.dispose();
      offRoute();
      offAnchors();
      follow(null);
      eventListeners.clear();
      contractListeners.clear();
      slotListeners.clear();
      route.dispose();
      anchors.dispose();
      mounts.dispose();
      theme.dispose();
    },
  };
}
