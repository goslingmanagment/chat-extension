import type { PageDiagnostics } from '@cg/contracts/diagnostics';
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
//   digest is host-kit's, its provenance knows our own unchanged insert
//   (insert.ts). `focusComposer` focuses that field after the same checks. A
//   field of another chat, route, creator or document is refused.
// - Writes need a human (R20 P7e): `insert` and `navigate` spend the action
//   token of the click or key (`token.redeem`) before anything is written,
//   once the cheap checks passed. The insert goes into the field this port
//   owns for the current generation — its chat's and its creator's — in one
//   synchronous step from its last check (insert.ts, FS-INS-1); «Открыть и
//   вставить» opens the target's group and writes once its own field is there
//   (navigate.ts, FS-INS-4). The insertion record is what a human send is
//   linked to (`insertion`, `sentDraft`). `checkpoint` and `previewSend`
//   are ChatSpace's X8 and do not exist here.
// - The person's send (R20 P7f): the draft is read at the person's own Enter
//   or Send click in the field the port owns, and MAIN's `fx.sent` for that
//   gesture is linked to it — the port says `humanSend` (send-observe.ts).
// - `fansly` (FanslyPagePort): the header slot is said from the anchors (its
//   mount is P7d's and P11a's); a file into the field (P12c) and the relay
//   (P9c) are refused until then; a file into the vault is the vault panel's
//   upload (`vault.serve`, P13b), refused while its module is not up.
// - `vault`: the vault's facts of MAIN's stream (§7.11, R20 P13a) — an addition
//   to an album and an album the page loaded — for the uploader, which comes in
//   its own module (`isolated/vault`, never in this early bundle); the port
//   keeps only the album of the load the page STARTED last (MAIN's observation
//   number — a late answer of an earlier load is not it), forgotten with every
//   change of address and every loss of MAIN's facts, which it says.
//
// Before MAIN's first state the port knows only the address; without MAIN at
// all it still answers, and its report says CG-HOST-NOT-READY.

import type { FanslyChatWire, FanslyContractWire, FanslyHealth, FanslyState, FromMainFansly } from '@cg/contracts/bridge-messages-fansly';
import type { CgCode } from '@cg/contracts/errors';
import type { FanslyHeaderSlot, FanslyPagePort } from '@cg/contracts/fansly';
import type { FanslyContractReport, FanslyHostPort } from '@cg/contracts/fansly-host';
import type { ChatWindow, ComposerState, HostContractReport, HostEvent, HostFan, HostSnapshot, InsertIntent, InsertReceipt, InsertWire, NavigateOptions, NavigationIntent, NavigationReceipt, RouteState, SentDraft, Unsubscribe } from '@cg/contracts/host';
import type { ChatRef, DraftSnapshot, HostAccount, HostIdentity } from '@cg/contracts/ids';
import { digest } from '@cg/host-kit/common/digest';
import { sameReport } from '@cg/host-kit/isolated/report';

import { DOM_ANCHORS_NOT_YET, judgeAnchors, type AnchorStats, type AnchorWatcher, type DomAnchorStates } from './anchors';
import { BridgeCallError, type FanslyMainBridgeClient } from './bridge-client';
import { FANSLY_ADAPTER_VERSION, buildFanslyReport, buildOf, type Observation } from './contract';
import { createFreshnessPort } from './freshness';
import { createGeneration } from './generation';
import { createComposerField, rejected, type InsertionRecord, type WritePath } from './insert';
import { FANSLY_KIND, FANSLY_PLATFORM, accountOf, chatFits, chatWindowOf, fanOf, identityMatches, identityOf, routeStateOf, sameChat, sameRoute } from './identity';
import type { Coexistence } from './legacy';
import type { FanslyMounts } from './mount';
import { createNavigator, type NavigationWay } from './navigate';
import type { FanslyRoute, RouteStats, RouteWatcher } from './route';
import { createSendObserver, type SendObserveStats } from './send-observe';
import type { FanslyTheme } from './theme';
import { consumeStream, type StreamStats } from './stream';
import type { ValidationLoader } from './validation';

/** What the host tells the tab's log: an event, its code, a few plain facts — never a text, a name or an id of a fan. */
export interface FanslyDiagnostic {
  readonly event: string;
  readonly code?: CgCode;
  readonly detail?: Readonly<Record<string, string | number | boolean | null>>;
}

export type { FanslyTheme } from './theme';
export type { InsertionRecord } from './insert';

/** Spends one action token for one write (`token.redeem`); false — not spent, nothing is written. */
export type TokenRedeemer = (request: { readonly kind: 'insert' | 'navigate'; readonly actionToken: string; readonly intentId: string }) => Promise<boolean>;

/** This side's counts: the route, the anchors' observers, the stream. */
export interface FanslyIsolatedHealth {
  readonly route: RouteStats;
  readonly anchors: AnchorStats;
  readonly stream: StreamStats | null;
  /** `fx.chat` answers dropped as of another route epoch or group (FS-RTE-4). */
  readonly staleChats: number;
  /** The person's gestures read and MAIN's `fx.sent` linked to them, or not (P7f). */
  readonly sends: SendObserveStats;
}

/** A fact of the vault from MAIN's stream (§7.11): an addition to an album, an album the page loaded. */
export type FanslyVaultFact = Extract<FromMainFansly, { readonly t: 'fx.vaultAdded' | 'fx.vaultLoaded' }>;

/** What the uploader (isolated/vault) reads of the stream. */
export interface FanslyVaultFacts {
  /** The album of the load the page started last on this address; null — none since the address changed or a loss. */
  album(): Extract<FanslyVaultFact, { readonly t: 'fx.vaultLoaded' }>['p'] | null;
  onFact(cb: (fact: FanslyVaultFact) => void): Unsubscribe;
  /** MAIN's facts were lost (`fx.gap`, a refused or skipped batch): what the page did meanwhile is not known. */
  onLost(cb: () => void): Unsubscribe;
  /**
   * `FanslyPagePort.uploadToVault` as the vault's panel serves it (R20 P13b): its uploader is a lazy chunk of its own,
   * never this early bundle, so the member refuses (`anchor-missing`) until the panel's module is up and after it went.
   */
  serve(upload: FanslyPagePort['uploadToVault']): Unsubscribe;
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
  /** What our last write left in the open field, while the draft descends from it (§7.5 п. 5); null — none. */
  insertion(): InsertionRecord | null;
  /** The open field's draft as a human send carries it (§5.9 п. 7, P7f): its revision, provenance and our insert; null — no field. */
  sentDraft(): SentDraft | null;
  /** The vault's facts for the uploader (§7.11, P13a). */
  readonly vault: FanslyVaultFacts;
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
  /** The background's `token.redeem` for the click or key of a write. */
  readonly redeem: TokenRedeemer;
  /** Fansly's schema module (validation.ts): the checks of our own controllers' intents. */
  readonly validation: ValidationLoader;
  /** Bootstrap `limits.navInsertTimeoutSec` × 1000, read at each «Открыть и вставить»; undefined — 20 s. */
  readonly navInsertTimeoutMs?: () => number | undefined;
  /** The page loaded by its address when a navigation did not open the chat (SP-036); tests replace it. */
  readonly load?: (path: string) => void;
  readonly adapterVersion?: string;
  readonly now?: () => number;
  readonly onDiagnostic?: (diagnostic: FanslyDiagnostic) => void;
}

/** Sites of MAIN's guarded failures logged per document. */
const MAX_FAULT_SITES = 64;
/** The longest draft a snapshot carries (contracts DraftSnapshotSchema). */
const DRAFT_MAX = 20_000;

/** Shown: not under `display: none`, `visibility: hidden` or a zero opacity. */
const shown = (element: Element): boolean => typeof element.checkVisibility !== 'function' || element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });

export function createFanslyHostPort(options: FanslyHostPortOptions): FanslyPort {
  const { win, bridge, mounts, theme, route, anchors, redeem, validation } = options;
  const doc = win.document;
  const clock = options.now ?? (() => Date.now());
  const adapterVersion = options.adapterVersion ?? FANSLY_ADAPTER_VERSION;
  const diag = (diagnostic: FanslyDiagnostic): void => options.onDiagnostic?.(diagnostic);

  let companion: PageDiagnostics['companion'] = null;
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
  /** The field this port owns now, its revision, its composition and the record of our write (insert.ts). */
  const composerField = createComposerField({
    win,
    changed() {
      if (composer === null) return;
      // A keystroke that changes nothing the views read is said to nobody (§11); the revision is kept current all the same.
      const draft = { revision: composerField.revision(), provenance: composerField.provenance() };
      if (draft.provenance !== composer.draft.provenance) sync();
      else composer = { ...composer, draft };
    },
    onWrite: ({ receipt, path, mode }) => noteInsert(receipt, path, mode),
  });
  /** The tab's log hears of every insert — its outcome, its way, never its text (LG-017). */
  const noteInsert = (receipt: InsertReceipt, path: WritePath, mode: 'replace' | 'append'): void =>
    diag({ event: 'insert', ...(receipt.state === 'applied' ? {} : { code: receipt.code }), detail: { state: receipt.state, path, mode, ms: receipt.state === 'applied' ? receipt.ms : null, needs: receipt.state === 'rejected' ? (receipt.needs ?? null) : null } });
  const instanceOf = (element: Element): string => {
    let token = instances.get(element);
    if (token === undefined) {
      instanceSerial += 1;
      token = `f${instanceSerial}`;
      instances.set(element, token);
    }
    return token;
  };

  let vaultLoad: ReturnType<FanslyVaultFacts['album']> = null;
  /** The vault panel's upload of one file (P13b), while its module is up. */
  let vaultUpload: FanslyPagePort['uploadToVault'] | null = null;
  const vaultListeners = new Set<(fact: FanslyVaultFact) => void>();
  const vaultLosses = new Set<() => void>();
  const eventListeners = new Set<(event: HostEvent) => void>();
  const contractListeners = new Set<(report: HostContractReport) => void>();
  const slotListeners = new Set<(slot: FanslyHeaderSlot) => void>();
  const emit = (event: HostEvent): void => {
    for (const listener of [...eventListeners]) listener(event);
  };

  /** The person's send (§5.9 п. 7): the draft read at the gesture in the field this port owns, linked to MAIN's `fx.sent`. */
  const sends = createSendObserver({
    win,
    field: () => composerField.element(),
    draft: () => composerField.sentDraft(),
    chat: () => {
      const chat = routeState.chat;
      const groupId = routeState.conversationRef;
      return chat === null || groupId === undefined ? null : { chat, groupId };
    },
    now: clock,
    said: (fact) => emit({ type: 'humanSend', fact }),
    onDiagnostic: diag,
  });

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
    const owned = candidate !== null && owner !== null && owners.get(candidate) === owner ? candidate : null;
    composerField.follow(owned, owned === null ? null : instanceOf(owned));
    const field = composerField.element();
    const chat = routeState.chat;
    composer =
      chat !== null && field !== null && conversation !== null
        ? {
            chat,
            instanceId: instanceOf(field),
            ready: field.isConnected && !field.disabled,
            hidden: conversation.copyOnly || chatWire?.dmAllowed === false,
            draft: { revision: composerField.revision(), provenance: composerField.provenance() },
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
      sends.reset();
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
    companion = { ...state.identity.fbuddy };
    network = state.contract;
    const changed = changeCreator(state.identity.creatorId);
    setChat(state.chat !== null && chatFits(routeNow(), state.chat) && focused === state.chat.routeEpoch ? state.chat : null);
    if (changed) emit({ type: 'accounts', accounts: accounts() });
  };

  const onEvent = (event: FromMainFansly): void => {
    if (disposed) return;
    switch (event.t) {
      case 'fx.identity':
        companion = { ...event.p.fbuddy };
        if (event.p.legacy) options.coexistence?.stop('legacy');
        if (disposed) return;
        return setCreator(event.p.creatorId);
      case 'fx.chat':
        return takeChat(event.p);
      case 'fx.contract':
        network = event.p;
        return sync();
      // The vault's facts go to the uploader, if one listens (§7.11, P13a).
      case 'fx.vaultLoaded':
      case 'fx.vaultAdded':
        if (event.t === 'fx.vaultLoaded' && (vaultLoad === null || event.p.seq > vaultLoad.seq)) vaultLoad = event.p;
        for (const listener of [...vaultListeners]) listener(event);
        return;
      // The person's send, proven by MAIN: linked to the draft read at its gesture (P7f).
      case 'fx.sent':
        return sends.sent(event.p);
      // The stream's other facts — new messages, follows, coverage, deletions — are taken by the work packages that act
      // on them (P8b1, P14a); here they are acknowledged with their batch.
      case 'fx.incoming':
      case 'fx.follow':
      case 'fx.coverage':
      case 'fx.deleted':
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
              // Which album the page loaded meanwhile is not known either.
              vaultLoad = null;
              for (const listener of [...vaultLosses]) listener();
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
    // Another page (or a new life of it) shows no album yet: the next one it loads says which.
    vaultLoad = null;
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
    const field = composerField.element();
    if (!identityMatches(expected, current) || current.chat === null || composer === null || field === null || expected.composerInstanceId !== composer.instanceId) {
      return new BridgeCallError('identity-mismatch', t);
    }
    return field;
  };

  const freshness = createFreshnessPort({ bridge, under: generation.under, onDiagnostic: diag });

  // ── writes (R20 P7e) ──
  /**
   * FS-INS-1 п. 1–3, asked before the token, before the focus and after it: the address verified, the anchors read
   * again, then this document and creator, the target's own chat — an open insert also its generation and the very
   * field its draft was read from —, a field shown, enabled and under the route (never the mini-chat's), the DM
   * rules met. A refusal, or null.
   */
  const insertCheck = (intent: InsertWire): InsertReceipt | null => {
    acting();
    const current = identity();
    if (disposed || bridge === null || current === null) return rejected('CG-HOST-NOT-READY');
    const expected = intent.expected;
    if (current.documentEpoch !== expected.documentEpoch || !sameChat(current.chat, intent.target)) return rejected('CG-INSERT-CHAT-CHANGED');
    if (expected.kind === 'open' && (current.routeEpoch !== expected.routeEpoch || current.composerInstanceId !== expected.composerInstanceId)) return rejected('CG-INSERT-CHAT-CHANGED');
    const field = composerField.element();
    if (composer === null || field === null) return rejected('CG-HOST-COMPOSER-MISSING');
    if (composer.hidden) return rejected('CG-GATE-FAN-BLOCKED');
    if (anchors.current().conversation?.textarea !== field || !field.isConnected || field.disabled || field.readOnly || !shown(field)) return rejected('CG-HOST-COMPOSER-MISSING');
    return null;
  };

  /** A write is no use while the capability is off: the person sees why (copy only, not ready). */
  const writeBlocked = (): CgCode | null => {
    const state = report.capabilities.insert;
    return state.state === 'off' || state.state === 'contractBroken' ? (state.code ?? 'CG-HOST-COMPOSER-MISSING') : null;
  };

  const navigator = createNavigator({
    win,
    creator: () => creator,
    open: () => {
      const now = routeNow();
      const field = composerField.element();
      const conversation = anchors.current().conversation;
      return {
        groupId: now.groupId,
        fanId: routeState.epoch === now.epoch ? (routeState.chat?.platformFanId ?? null) : null,
        generation: now.epoch,
        composer: composer === null || field === null ? null : { instanceId: composer.instanceId, ready: composer.ready },
        composing: composerField.composing(),
        container: conversation?.container ?? null,
        conversation: conversation !== null && conversation !== undefined,
      };
    },
    // The two looks saw this generation and this field: the write takes them as its expectation, then every check.
    write: (intent, seen) =>
      composerField.write(intent, () => {
        const refusal = insertCheck(intent);
        if (refusal !== null) return refusal;
        const current = identity();
        return current?.routeEpoch === seen.generation && current.composerInstanceId === seen.instanceId ? null : rejected('CG-INSERT-CHAT-CHANGED');
      }),
    ...(options.navInsertTimeoutMs === undefined ? {} : { timeoutMs: options.navInsertTimeoutMs }),
    ...(options.load === undefined ? {} : { load: options.load }),
    onRoute: (listener) => route.onChange(() => listener()),
    onNavigate: (way: NavigationWay, receipt: NavigationReceipt) =>
      diag({ event: 'navigate', ...(receipt.state === 'failed' ? { code: receipt.code } : {}), detail: { way, state: receipt.state, insert: receipt.insert?.state ?? null, insertCode: receipt.insert !== null && receipt.insert.state !== 'applied' ? receipt.insert.code : null } }),
  });

  const page: FanslyPagePort = {
    headerSlot: () => slot,
    onHeaderSlot(cb): Unsubscribe {
      slotListeners.add(cb);
      return () => {
        slotListeners.delete(cb);
      };
    },
    attachToComposer: () => Promise.resolve({ state: 'refused', reason: 'anchor-missing' }),
    uploadToVault: (file) => (vaultUpload === null || disposed ? Promise.resolve({ state: 'refused', reason: 'anchor-missing' }) : vaultUpload(file)),
    relay: { open: () => Promise.resolve('failed'), close: () => undefined },
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    generation.advance();
    stream?.dispose();
    offRoute();
    offAnchors();
    navigator.dispose();
    sends.dispose();
    composerField.dispose();
    route.dispose();
    anchors.dispose();
    mounts.dispose();
    theme.dispose();
    options.coexistence?.dispose();
    eventListeners.clear();
    contractListeners.clear();
    slotListeners.clear();
    vaultListeners.clear();
    vaultLosses.clear();
    vaultUpload = null;
  };
  const retire = (): void => {
    generation.advance();
    creator = null;
    chatWire = null;
    composer = null;
    vaultLoad = null;
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
    async diagnostics() {
      const health = await this.health();
      const counters: Record<string, number> = {};
      const collect = (value: unknown, prefix: string): void => {
        if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) counters[prefix] = value;
        else if (value !== null && typeof value === 'object') for (const [key, child] of Object.entries(value)) collect(child, `${prefix}.${key}`);
      };
      collect(health.isolated, 'isolated');
      collect(health.main, 'main');
      return { observedAt: clock(), companion: health.main === null ? null : companion, mainAvailable: health.main !== null, counters };
    },
    async health() {
      const main = bridge === null || disposed ? null : await bridge.request('fx.health', {}).catch(() => null);
      return { isolated: { route: route.stats(), anchors: anchors.stats(), stream: stream?.stats() ?? null, staleChats, sends: sends.stats() }, main };
    },
    vault: {
      album: () => vaultLoad,
      onFact(cb): Unsubscribe {
        vaultListeners.add(cb);
        return () => {
          vaultListeners.delete(cb);
        };
      },
      onLost(cb): Unsubscribe {
        vaultLosses.add(cb);
        return () => {
          vaultLosses.delete(cb);
        };
      },
      serve(upload): Unsubscribe {
        vaultUpload = upload;
        return () => {
          if (vaultUpload === upload) vaultUpload = null;
        };
      },
    },

    readDraft(expected: HostIdentity): Promise<DraftSnapshot> {
      const found = fieldFor(expected, 'readDraft');
      if (found instanceof BridgeCallError) return Promise.reject(found);
      const text = found.value;
      const current = identity() as HostIdentity;
      return Promise.resolve({ identity: current, revision: composerField.revision(), plainText: text.slice(0, DRAFT_MAX), provenance: composerField.provenance(), digest: digest(text) });
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
    insertion: () => composerField.insertion(),
    sentDraft: () => composerField.sentDraft(),

    /**
     * §7.5: an open intent only (a deferred one rides `navigate`). The cheap checks first, so a stale intent spends no
     * token; then the token; then the one synchronous step of insert.ts, which asks every check again.
     */
    async insert(intent: InsertIntent): Promise<InsertReceipt> {
      const check = await validation();
      if (!check.isInsertIntent(intent) || intent.expected.kind !== 'open') throw new TypeError('insert() takes an open InsertIntent with its cause; a deferred one rides navigate()');
      // The port ended while it waited (the tab goes): nothing of the page is touched any more.
      if (disposed) return rejected('CG-HOST-NOT-READY');
      const { cause, ...wire } = intent;
      const refused = (receipt: InsertReceipt): InsertReceipt => (noteInsert(receipt, 'none', intent.mode), receipt);
      const blocked = writeBlocked();
      if (blocked !== null) return refused(rejected(blocked));
      const early = insertCheck(wire);
      if (early !== null) return refused(early);
      if (Date.now() > intent.expiresAt || !(await redeem({ kind: 'insert', actionToken: cause.actionToken, intentId: intent.intentId })) || Date.now() > intent.expiresAt) return refused(rejected('CG-INSERT-FAILED'));
      if (disposed) return rejected('CG-HOST-NOT-READY');
      // Another write of ours, into the open chat: the latest navigation stops — its waiting insert, its 2-second check.
      navigator.cancel();
      return composerField.write(wire, () => insertCheck(wire));
    },
    /** §7.6: on a human action only; its token is spent before the page is touched. */
    async navigate(intent: NavigationIntent, navigateOptions?: NavigateOptions): Promise<NavigationReceipt> {
      const check = await validation();
      if (!check.isNavigationIntent(intent)) throw new TypeError('navigate() takes a NavigationIntent with its cause');
      const then = intent.thenInsert;
      const failed = (code: CgCode): NavigationReceipt => ({ state: 'failed', code, insert: then === undefined ? null : rejected(code) });
      // After each wait the port may have ended (the tab goes): then nothing moves — no address, no check, no load.
      if (disposed || bridge === null || report.capabilities.navigate.state !== 'on') return failed('CG-NAV-FAILED');
      if (!(await redeem({ kind: 'navigate', actionToken: intent.cause.actionToken, intentId: intent.intentId })) || disposed) return failed('CG-NAV-FAILED');
      // The chat still opens, but its insert is refused at once instead of waiting out its deadline: copy only, or
      // given up already (sign-out, a persona or binding change, the preview closed).
      const skipped: CgCode | null = then === undefined ? null : navigateOptions?.signal?.aborted === true ? 'CG-INSERT-CANCELED' : writeBlocked();
      if (skipped === null) return navigator.navigate(intent, navigateOptions);
      const { thenInsert: _skipped, ...plain } = intent;
      const receipt = await navigator.navigate(plain);
      return { ...receipt, insert: rejected(skipped) };
    },
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
