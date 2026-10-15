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
import type { ChatWindow, ComposerState, HostContractReport, HostEvent, HostFan, HostSnapshot, InsertReceipt, NavigationIntent, NavigationReceipt, RouteState, Unsubscribe } from '@cg/contracts/host';
import type { ChatRef, DraftSnapshot, HostAccount, HostIdentity } from '@cg/contracts/ids';
import { digest } from '@cg/host-kit/common/digest';
import { sameReport } from '@cg/host-kit/isolated/report';

import { DOM_ANCHORS_NOT_YET, judgeAnchors, type AnchorStats, type AnchorWatcher, type DomAnchorStates } from './anchors';
import { BridgeCallError, type FanslyMainBridgeClient } from './bridge-client';
import { FANSLY_ADAPTER_VERSION, buildFanslyReport, buildOf, type Observation } from './contract';
import { createFreshnessPort } from './freshness';
import { createGeneration } from './generation';
import { FANSLY_KIND, FANSLY_PLATFORM, accountOf, chatFits, chatWindowOf, fanOf, identityMatches, identityOf, routeStateOf, sameChat, sameRoute } from './identity';
import type { Coexistence } from './legacy';
import type { FanslyMounts } from './mount';
import type { FanslyRoute, RouteStats, RouteWatcher } from './route';
import type { FanslyTheme } from './theme';
import { consumeStream, type StreamStats } from './stream';

/** What the host tells the tab's log: an event, its code, a few plain facts — never a text, a name or an id of a fan. */
export interface FanslyDiagnostic {
  readonly event: string;
  readonly code?: CgCode;
  readonly detail?: Readonly<Record<string, string | number | boolean | null>>;
}

export type { FanslyTheme } from './theme';

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
  readonly coexistence?: Coexistence;
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
  /** Changes of creator after the first binding: a field seen before the binding is the first creator's. */
  let creatorChanges = 0;
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

  /**
   * The port's generation (generation.ts) — its route epoch: it moves with the address (and a return from bfcache)
   * and with the creator, so a focus after either names a new epoch, and every asynchronous answer is taken only in
   * the generation it was asked in.
   */
  const generation = createGeneration(1);
  let addressEpoch = route.current().epoch;
  /** The route as the port says it: the address, under the port's own epoch. */
  const routeNow = (): FanslyRoute => {
    const address = route.current();
    if (address.epoch !== addressEpoch) {
      addressEpoch = address.epoch;
      generation.advance();
    }
    return { path: address.path, groupId: address.groupId, epoch: generation.current() };
  };

  let routeState: RouteState = routeStateOf(routeNow(), null, null);
  let composer: ComposerState | null = null;
  /** The projection of the composer views read (§11: a keystroke that changes none of it says nothing). */
  let composerSeen = '';
  let slot: FanslyHeaderSlot = { state: 'none', reason: 'no-chat' };
  let report: FanslyContractReport = compute();

  // ── the main field: its owner, its instance and its revision ──
  /**
   * The conversation (and the creator) each field node was first seen under. Fansly changes the address before it
   * replaces the conversation's nodes (`popstate` is read a task later, S2 Q4): a field still on the page when the
   * route moved is the old chat's, and it never becomes the new one's — even once MAIN names the new fan; nor the
   * field of one creator another's (FS-RTE-4).
   */
  const owners = new WeakMap<Element, string | null>();
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
    return buildFanslyReport({ blocked: options.coexistence?.reason() ?? null, bridge: bridge !== null, wire: network, creator: creator !== null, observation, dom, build, adapterVersion, checkedAt: clock() });
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
    void generation.under(() => bridge.request('fx.focus', { groupId, routeEpoch: epoch })).then((taken) => {
      // An answer to a focus of another generation says nothing of now: a newer answer may have said more.
      if (disposed || !taken.fresh()) return;
      // A MAIN without the observation (before P7b) says `not-ready`: the chat stays unknown, honestly.
      const next: Observation | null = taken.ok ? 'ready' : taken.error instanceof BridgeCallError && taken.error.failure === 'not-ready' ? 'off' : null;
      if (next === null || next === observation) return;
      observation = next;
      sync();
    });
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
    const now = routeNow();
    if (chatWire !== null && !chatFits(now, chatWire)) chatWire = null;
    if (stream?.started() === true && focused !== now.epoch) focus(now.epoch, now.groupId);
    const nextRoute = routeStateOf(now, creator, chatWire);
    const routeMoved = !sameRoute(nextRoute, routeState);
    routeState = nextRoute;

    const conversation = anchors.current().conversation;
    const candidate = conversation?.textarea ?? null;
    const owner = now.groupId === null ? null : `${creatorChanges}:${now.groupId}`;
    if (candidate !== null && !owners.has(candidate)) owners.set(candidate, owner);
    follow(candidate !== null && owner !== null && owners.get(candidate) === owner ? candidate : null);
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
    // The dock's place, before anyone hears of the change: what they read of the mounts is already the new one (§7.3).
    mounts.place({
      conversation,
      group: routeState.conversationKind === 'group',
      copyOnly: conversation?.copyOnly === true || chatWire?.dmAllowed === false,
      composerInstanceId: field === null ? null : instanceOf(field),
    });
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
  /**
   * Another creator (§5.7): a new login epoch and a new generation — what MAIN said of the old one's chat is gone,
   * the route's group is focused again under a new epoch, and only the answer to that names the chat. The first
   * creator of the page (none before it) is its binding, not a change. Says whether it changed; the caller syncs and
   * tells the accounts.
   */
  const changeCreator = (next: string | null): boolean => {
    if (next === creator) return false;
    if (creator !== null) {
      chatWire = null;
      creatorChanges += 1;
      generation.advance();
    }
    creator = next;
    logins += 1;
    return true;
  };
  const setCreator = (next: string | null): void => {
    if (!changeCreator(next)) return;
    sync();
    emit({ type: 'accounts', accounts: accounts() });
  };

  /** MAIN's chat for the route, or none: the port says the change — the route when the chat comes or goes, `chatCache` when its window moves. */
  const setChat = (next: FanslyChatWire | null): void => {
    const before = chatWire;
    chatWire = next;
    sync();
    const chat = routeState.chat;
    const same = before !== null && next !== null && before.groupId === next.groupId && before.fanId === next.fanId;
    if (chat !== null && same && JSON.stringify(before.window) !== JSON.stringify(next.window)) emit({ type: 'chatCache', chat });
  };

  /** fx.chat of the route's group and epoch: taken; any other is late (A → B → A) and dropped. */
  const takeChat = (wire: FanslyChatWire): void => {
    if (!chatFits(routeNow(), wire) || focused !== wire.routeEpoch) {
      staleChats += 1;
      return;
    }
    setChat(wire);
  };

  /**
   * MAIN's state — taken only in the generation it was asked in (the stream drops it whole otherwise) — replaces what
   * the port holds: its chat for the route's focus, or none: a chat it no longer names is gone.
   */
  const onState = (state: FanslyState): void => {
    if (state.identity.legacy) options.coexistence?.stop('legacy');
    if (disposed) return;
    network = state.contract;
    const changed = changeCreator(state.identity.creatorId);
    setChat(state.chat !== null && chatFits(routeNow(), state.chat) && focused === state.chat.routeEpoch ? state.chat : null);
    if (changed) emit({ type: 'accounts', accounts: accounts() });
  };

  const onEvent = (event: FromMainFansly): void => {
    if (disposed) return;
    switch (event.t) {
      case 'fx.identity':
        if (event.p.legacy) options.coexistence?.stop('legacy');
        if (disposed) return;
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
              // Every chat unknown until the next state (FS-TAIL-5): the window the tab holds says so at once — and a
              // proven start no longer stands, its unbroken observation is broken.
              if (chatWire !== null) setChat({ ...chatWire, window: { ...chatWire.window, completeness: 'unknown', startProven: false } });
            },
            fault(source, count) {
              // MAIN says a site's count at 1, 2, 4, 8…: one is logged when it at least doubled the last.
              const last = faults.get(source);
              if ((last === undefined && faults.size >= MAX_FAULT_SITES) || count < 2 * (last ?? 0.5)) return;
              faults.set(source, count);
              diag({ event: 'main-fault', code: 'CG-UNKNOWN', detail: { source, count } });
            },
          },
          { under: generation.under, now: clock, onFailure: (failure) => diag({ event: 'state-failed', detail: { failure } }) },
        );

  /** A state is owed — none taken yet, or a loss or a failed ask since the last one: the next signal of the page asks again (after its pause). */
  const resyncIfNeeded = (): void => {
    stream?.retry();
  };

  const offRoute = route.onChange((change) => {
    // The new generation first: whatever is asked from here on is asked in it.
    routeNow();
    // Back from bfcache: a new life (and a new route epoch, so what MAIN said before no longer fits); MAIN's states
    // are asked again whole (FS-RTE-2).
    if (change.restored) void stream?.resync();
    else resyncIfNeeded();
    sync();
  });
  const offAnchors = anchors.onChange(() => sync());

  /** MAIN came after the page began (installed or updated under an open tab): the person is asked to reload (FS-IDN-4). */
  const noteLateStart = async (): Promise<void> => {
    const probe = await bridge?.probe().catch(() => null);
    if (disposed || !probe || probe.readyStateAtStart === 'loading' || reloadNeeded) return;
    reloadNeeded = true;
    diag({ event: 'late-start', detail: { startReadyState: probe.readyStateAtStart } });
    emit({ type: 'reloadNeeded' });
  };
  const ready = stream === null ? Promise.resolve() : stream.resync().then(() => (sync(), noteLateStart()));
  sync();

  /** Our UI acts: the address is verified first (FS-RTE-3), the anchors read again. */
  const acting = (): void => {
    options.coexistence?.check();
    if (disposed) return;
    route.verify('ui');
    anchors.refresh();
    resyncIfNeeded();
  };

  /** The open field a read or a focus names, or why not. */
  const fieldFor = (expected: HostIdentity, t: string): HTMLTextAreaElement | BridgeCallError => {
    acting();
    const current = identity();
    if (disposed || bridge === null || current === null) return new BridgeCallError('not-ready', t);
    if (!identityMatches(expected, current) || current.chat === null || composer === null || field === null || expected.composerInstanceId !== composer.instanceId) {
      return new BridgeCallError('identity-mismatch', t);
    }
    return field;
  };

  const freshness = createFreshnessPort({ bridge, under: generation.under, onDiagnostic: diag });

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

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    generation.advance();
    stream?.dispose();
    offRoute();
    offAnchors();
    follow(null);
    route.dispose();
    anchors.dispose();
    mounts.dispose();
    theme.dispose();
    options.coexistence?.dispose();
    eventListeners.clear();
    contractListeners.clear();
    slotListeners.clear();
  };
  const retire = (): void => {
    generation.advance();
    creator = null;
    chatWire = null;
    composer = null;
    routeState = routeStateOf(routeNow(), null, null);
    slot = { state: 'none', reason: 'no-chat' };
    report = compute();
    emit({ type: 'accounts', accounts: [] });
    emit({ type: 'route', route: routeState });
    emit({ type: 'composer', composer: null });
    for (const listener of [...contractListeners]) listener(report);
    diag({ event: 'coexistence', detail: { reason: options.coexistence?.reason() ?? null } });
    dispose();
  };
  options.coexistence?.stopped.addEventListener('abort', retire, { once: true });
  if (options.coexistence?.stopped.aborted) retire();

  return {
    kind: FANSLY_KIND,
    platform: FANSLY_PLATFORM,
    ready,
    identity,
    previewSend: null,
    freshness: {
      snapshot: (...args) => {
        acting();
        return disposed ? Promise.resolve(null) : freshness.snapshot(...args);
      },
    },
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
      options.coexistence?.check();
      if (disposed) return report;
      if (stream !== null) await stream.resync();
      anchors.refresh();
      sync();
      return report;
    },
    async health() {
      const main = bridge === null || disposed ? null : await bridge.request('fx.health', {}).catch(() => null);
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

    dispose,
  };
}
