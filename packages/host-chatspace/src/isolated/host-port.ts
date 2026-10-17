// HostPort for ChatSpace (architecture.md §5.2, §6): the isolated-world face
// of the host. It never touches the network or the hub token (§4); it reads
// page memory only through the MAIN bridge, the DOM for mounting, and the
// page's draft key through a storage port.
//
// - One read goes past page memory (X54): `openChatMessages`, the open chat's
//   messages from ChatSpace's API, which MAIN requests with the page's own
//   session. Only for the chat on the route (another chat's history load would
//   mark it read on OnlyFans): any other is `not-open` here, before MAIN, and
//   MAIN checks its route again. Callers that ask at once share one request;
//   the newest page stays for `maxAgeMs`, and a change of the chat's cache, an
//   incoming message of it or a move to another chat drops it.
// - The media picker of a preview reads the vault past page memory too (X53,
//   `media`): folders, a folder's media, a fan's media statuses, the picks'
//   release forms — MAIN asks ChatSpace's API for the account the page has
//   loaded; no chat's history. Nothing is cached here: the picker keeps what
//   it read.
//
// - State comes from MAIN's snapshot and events (route, composer, accounts,
//   chat cache, contract), checked by the bridge client; the synchronous
//   reads (`chatWindow`, `fan`, `listCachedChats`) answer from a cache that
//   those events refresh, and load nothing (§6.9).
// - Writes need a human: `insert` and `navigate` spend the action token of
//   the click or key (`token.redeem`, §14) BEFORE anything reaches MAIN, and
//   MAIN gets no token. The isolated prechecks of §6.4 п. 1 run first; MAIN
//   repeats every check in one synchronous step right before the write.
// - A write that may have run (timeout, lost answer, `internal`) gets the
//   fixed outcome of BRIDGE_WRITE_FAILURES and is never retried.
// - An `applied` insert is checked once more against the target chat's own
//   draft key (NEW-06): a disagreement makes it `uncertain`, never a retry.
// - The live side (§6.6–§6.8) needs the tap script in the page and the flags
//   of the bootstrap (`configure`): facts of incoming messages and coverage,
//   human sends with their receipt, the freshness checkpoint, and the X8
//   preview send. `previewSend` is non-null only while its capability is on
//   (flag, anchors, tap, a matching receipt profile); the port sends MAIN the
//   host target, the text and the ticket's deadline — never the hub binding,
//   the ticket or the action token (§14). One queue call per attempt: a
//   repeated commit gets the first answer (only a `held` one is ever
//   forgotten), a bridge failure that may have run is `uncertain` and is
//   never sent again. A receipt profile that stops matching while a send is
//   on its way makes that send `uncertain` here (§6.2): of what MAIN still
//   says about it only the late linked pair (`sentObserved`) passes.
// - The fuse (decision X25): MAIN tells, after an X8 send, that the text, the
//   number of messages or the chat of its receipt are not what we sent
//   (`previewSendFuse`). X8 is off in this document from that moment — the
//   capability says CG-SEND-FUSE — and the tab tells the background
//   (`sendFuse`), which keeps the fuse for the browser and hands it back to
//   every tab through `configure`: it holds on the build it was seen on, until
//   another build or the person's reset. Nothing is ever sent or repeated
//   because of it.

import type { ChatKey, ChatRef, DraftSnapshot, HostAccount, HostIdentity } from '@cg/contracts/ids';
import type { ChatSpaceContractReport, ChatWindow, ComposerState, HostContractReport, HostEvent, HostFan, HostPort, HostSnapshot, HostTheme, InsertIntent, InsertReceipt, LiveTextTail, MountPoints, NavigateOptions, NavigationIntent, NavigationItem, NavigationReceipt, OpenChatPage, OpenChatRead, OpenChatReadOptions, RouteState, Unsubscribe } from '@cg/contracts/host';
import type { CgCode } from '@cg/contracts/errors';
import type { ReceiptProfile } from '@cg/contracts/hub';
import type { DispatchTicket, FreshnessCheckpoint, PreviewSendCommit, PreviewSendPort, PreviewSendPreflight, PreviewSendRequest, SendAttemptView, SendFuseState } from '@cg/contracts/send';
import { PREVIEW_SEND_CONDITION_CODES, sendFuseHolds, type PreviewSendConditionCode } from '@cg/contracts/send-rules';
import { BRIDGE_LIMITS, LIVE_TEXT_LIMITS, MEDIA_LIMITS, OPEN_CHAT_LIMITS } from '@cg/contracts/limits';
import type { MediaFanState, MediaFoldersPage, MediaItemsPage, MediaRead, MediaRequest } from '@cg/contracts/media';
import type { MediaTags } from '@cg/contracts/send-media';

import { BridgeCallError, type BridgeEvent, type MainBridgeClient } from './bridge-client';
import { buildContractReport, type ContractWireInput } from './contract';
import { sameReport } from '@cg/host-kit/isolated/report';
import { readStoredDraft, storedDraftAgrees, type DraftStorage } from './draft-store';
import { ADAPTER_VERSION } from './host-contract';
import type { MountManager } from './mount';
import { loadedScriptUrls, matchReceiptProfile, receiptModules, type ReceiptMatch } from './receipt-profile';
import type { ThemeReader } from './theme';
import type { ValidationLoader } from './validation';
import { WRITE_FAILURES } from './wire';

export { ADAPTER_VERSION };

/** What the composition root tells the port from the bootstrap (and again whenever the flags change). */
export interface ChatSpaceLiveConfig {
  /** Flag `wsTap`: false switches the running tap off (§6.8 п. 10); the background unregisters it for later documents. */
  readonly wsTap: boolean;
  /** Flag `previewSend`: on for at least one bound page. The hub checks the page's own flag again on every dispatch. */
  readonly previewSend: boolean;
  /** Flag `previewSendMarkAiGenerated`: off — the queue call says `isAiGenerated: false` whatever the request says. */
  readonly markAiGenerated: boolean;
  /** Bootstrap `limits.previewSendReceiptProfiles`; none — X8 is off. */
  readonly receiptProfiles: readonly ReceiptProfile[];
  /**
   * 1.21.0 (decision X48): the hub records who sent each message (`send-attribution-v1`) — MAIN follows the receipt of
   * every human send of the composer, so that its `humanSend` names the message. Absent — off.
   */
  readonly attribution?: boolean;
  /**
   * The X8 fuse as the background keeps it (decision X25); absent or null — not known yet: only a trip seen in this
   * document holds. A fuse holds while this page runs the build it names; a reset after a trip of this document
   * lifts that one too.
   */
  readonly fuse?: SendFuseState | null;
}

/** Spends one action token for one intent (`token.redeem`); false — not redeemed, nothing is written. */
export type TokenRedeemer = (request: { readonly kind: 'insert' | 'navigate'; readonly actionToken: string; readonly intentId: string }) => Promise<boolean>;

/** What the adapter tells the logs: events and codes, never a text of a draft, message or prompt. */
export interface HostDiagnostic {
  readonly event: string;
  readonly code?: CgCode;
  readonly detail?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface ChatSpaceHostOptions {
  readonly win: Window;
  /** null — MAIN never answered the handshake: the host is not ready. */
  readonly bridge: MainBridgeClient | null;
  readonly redeem: TokenRedeemer;
  readonly mounts: MountManager;
  readonly theme: ThemeReader;
  /** Where the schemas of our own controllers' inputs come from (validation.ts). */
  readonly validation: ValidationLoader;
  /** The page's localStorage, read only (the composition root gives it; §6.1). */
  readonly drafts?: DraftStorage | null;
  readonly adapterVersion?: string;
  /**
   * Bootstrap `limits.navInsertTimeoutSec` × 1000 (§5.3); 20 s by default.
   * A function is read at each «Открыть и вставить»: the host starts at
   * document_start, before the tab has a bootstrap, and the owner may change
   * the limit while the tab is open.
   */
  readonly navInsertTimeoutMs?: number | (() => number | undefined);
  readonly onDiagnostic?: (diagnostic: HostDiagnostic) => void;
}

/** A consumer passed an input that breaks its contract schema: a programming error, not a host refusal. */
export class HostContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HostContractError';
  }
}

export interface ChatSpaceHostPort extends HostPort {
  /** Resolves once the first snapshot from MAIN was taken (or at once without a bridge). */
  readonly ready: Promise<void>;
  /** The identity writes are checked against now; null when there is none. */
  identity(): HostIdentity | null;
  /** «Проверить» (§6.2): re-reads MAIN's snapshot — page memory and DOM only, nothing of ChatSpace's network. */
  recheck(): Promise<ChatSpaceContractReport>;
  /** The flags and the receipt profiles of the bootstrap; resolves with the report they lead to. */
  configure(config: ChatSpaceLiveConfig): Promise<ChatSpaceContractReport>;
  /** ChatSpace's report has ChatSpace's shape (contracts 1.15.0: the report is parsed by its site). */
  probe(): ChatSpaceContractReport;
}

const keyOf = (chat: ChatRef): ChatKey => `${chat.host}:${chat.hostAccountId}:${chat.platformFanId}`;
/** The reads of page memory the port keeps a cache of (the bridge's own request names). */
type ReadKind = 'chatWindow' | 'fan' | 'listChats' | 'listAccounts';
const sameChat = (a: ChatRef | null | undefined, b: ChatRef | null | undefined): boolean => !!a && !!b && keyOf(a) === keyOf(b);
const rejected = (code: CgCode): InsertReceipt => ({ state: 'rejected', code });
/** A newest page cut to `limit` messages: what one asking for fewer than were read gets. */
const firstOf = (page: OpenChatPage, limit: number): OpenChatPage =>
  page.items.length <= limit ? page : { ...page, items: page.items.slice(0, limit), hasMore: true, cursor: page.items[limit - 1]?.platformMessageId ?? null };
/** How long a cached chat list counts as fresh before a read asks MAIN again (no timer). */
const LIST_FRESH_MS = 1000;
/** Fans of other chats kept for decoration. */
const FAN_CACHE = 200;
/** Time MAIN gets past a deferred insert's deadline to answer with its own outcome. */
const NAV_GRACE_MS = 1000;
/** Attempts answered `held` that are kept for a repeated command; any other answer is kept for the document's life. */
const COMMIT_MEMORY = 64;
/** Sends on their way that are followed for a profile change (§6.2); the oldest goes first. */
const FLYING_MAX = 64;
/** Sites of MAIN's guarded failures logged per document (MAIN has about thirty). */
const MAX_FAULT_SITES = 64;
/** The deadline a preflight carries: it has no ticket, and MAIN's preflight does not look at it. */
const PREFLIGHT_WINDOW_MS = 60_000;

export function createChatSpaceHostPort(options: ChatSpaceHostOptions): ChatSpaceHostPort {
  const { bridge, mounts, theme, redeem, validation } = options;
  const drafts = options.drafts ?? null;
  const navTimeout = (): number => {
    const option = options.navInsertTimeoutMs;
    const value = typeof option === 'function' ? option() : option;
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : BRIDGE_LIMITS.navInsertTimeoutDefaultMs;
  };
  const diag = (diagnostic: HostDiagnostic): void => options.onDiagnostic?.(diagnostic);
  const clock = (): number => Date.now();

  let route: RouteState = { epoch: 0, name: 'other', account: null, chat: null };
  let hostLoginEpoch: string | null = null;
  /** The open chat's composer: MAIN's last report while it is of the route's chat; null otherwise (`syncComposer`). */
  let composer: ComposerState | null = null;
  /** MAIN's last composer report, whatever chat it is of. Kept: MAIN never repeats an unchanged one. */
  let reported: ComposerState | null = null;
  let accounts: readonly HostAccount[] = [];
  let wire: ContractWireInput | null = null;
  /** §6.2 `draftKey`: unchecked counts as fine; it turns `missing` when a non-empty draft has no key. */
  let draftKey: 'ok' | 'missing' = 'ok';
  let snapshotTaken = false;
  let disposed = false;
  /** The tap script is in the page and was not switched off. */
  let tap = false;
  /** MAIN itself said whether the tap runs (`flags`): a probe that comes later does not overrule it. */
  let tapKnown = false;
  let live: ChatSpaceLiveConfig | null = null;
  /** The bootstrap profile the loaded send-path modules match, and how; null — none. */
  let receiptProfile: ReceiptMatch | null = null;
  /** The last judgement said in the diagnostics; undefined — not judged (the flag is off). */
  let lastJudged: ReceiptMatch | null | undefined;
  /** When MAIN tripped the fuse in this document (decision X25); null — it did not. A reset after it lifts it. */
  let trippedAt: number | null = null;
  /** The last judgement found a profile (kept while the flag is off: a send started before goes on). */
  let matched = false;
  const adapterVersion = options.adapterVersion ?? ADAPTER_VERSION;
  const sendListeners = new Map<string, Set<(view: SendAttemptView) => void>>();
  /** Attempts whose queue call was asked for, with their first answer. */
  const commits = new Map<string, Promise<PreviewSendCommit>>();
  /** The attempts answered `held`, oldest first: only these are ever forgotten. */
  const heldCommits: string[] = [];
  /**
   * Sends on their way — the queue call was asked for and no end was heard: null — MAIN has not answered yet; false —
   * in the queue, followed; true — said `uncertain` here because the receipt profile stopped matching (§6.2).
   */
  const flying = new Map<string, boolean | null>();
  /**
   * MAIN's guarded failures (decision X22) as last logged, by site. MAIN sends a site's count at 1, 2, 4, 8…; one is
   * logged when it at least doubled the last, so a page that forges the event adds at most a few records per site.
   */
  const faults = new Map<string, number>();
  let report: ChatSpaceContractReport = compute();
  const windows = new Map<ChatKey, ChatWindow | null>();
  const fans = new Map<ChatKey, HostFan | null>();
  const lists = new Map<string, { readonly items: readonly NavigationItem[]; readonly at: number }>();
  const inFlight = new Set<string>();
  /** Reads asked for while the same read was in flight: it runs once more afterwards. */
  const dirty = new Set<string>();
  /**
   * Reads whose last ask failed, by key. Like an answer — `null` included —, a failure stands until MAIN's state may
   * have changed: a getter does not ask again for it; a route, chat-cache or contract event does (`refreshOpenChat`,
   * `chatCache`), as it does for every read it touches.
   */
  const failedReads = new Set<string>();
  /** The run of identical failures of each kind of read: the log hears its 1st, 10th, 100th… one and how it ended. */
  const failing = new Map<ReadKind, { readonly failure: string; count: number }>();
  /** X54: the open chat's newest page from ChatSpace's API, the read of it in flight, and what drops them (`staleOpen`). */
  let openPage: { readonly key: ChatKey; readonly at: number; readonly limit: number; readonly page: OpenChatPage } | null = null;
  let openRead: { readonly key: ChatKey; readonly generation: number; readonly limit: number; readonly done: Promise<OpenChatRead> } | null = null;
  let openGeneration = 0;
  /** The chat's messages may have changed: no read started before serves a later caller or the cache. */
  const staleOpen = (chat?: ChatRef): void => {
    if (chat !== undefined && !sameChat(chat, route.chat)) return;
    openGeneration += 1;
    openPage = null;
  };

  const eventListeners = new Set<(event: HostEvent) => void>();
  const contractListeners = new Set<(report: HostContractReport) => void>();
  const emit = (event: HostEvent): void => {
    for (const listener of [...eventListeners]) listener(event);
  };

  function compute(): ChatSpaceContractReport {
    return buildContractReport({
      wire,
      dom: { composerFrame: mounts.frameAnchor(), draftKey, theme: theme.anchor() },
      accountBound: Boolean(route.account?.platformAccountId),
      adapterVersion,
      checkedAt: clock(),
      live: { tap, previewSend: live?.previewSend === true, receipt: receiptProfile !== null, receiptMatch: receiptProfile, fused: fused() },
    });
  }
  /**
   * The fuse holds X8 off (decision X25): the background's, while this page runs the build it was seen on; or a
   * trip of this document, until the person resets the fuse after it.
   */
  function fused(): boolean {
    const state = live?.fuse ?? null;
    return (state !== null && sendFuseHolds(state.fuse, wire?.build ?? null)) || latched();
  }
  /** A trip of this document that no reset after it lifted. */
  function latched(): boolean {
    const resetAt = live?.fuse?.resetAt ?? null;
    return trippedAt !== null && !(resetAt !== null && resetAt >= trippedAt);
  }
  const recompute = (): void => {
    const next = compute();
    if (sameReport(next, report)) return;
    const before = report;
    report = next;
    if (next.build !== before.build && before.build !== null) diag({ event: 'build-changed', detail: { from: before.build, to: next.build } });
    for (const listener of [...contractListeners]) listener(report);
  };

  const capability = (name: keyof HostContractReport['capabilities']): boolean => {
    const state = report.capabilities[name].state;
    return state === 'on' || state === 'degraded';
  };

  /**
   * §6.2: which approved profile the modules this page ALREADY loaded match —
   * read from the DOM and the resource timing, nothing is requested. Only
   * while the flag is on; the modules of a chat load with the first chat.
   */
  const refreshReceipt = (): void => {
    const judged = live?.previewSend ? matchReceiptProfile(receiptModules(loadedScriptUrls(options.win), options.win.location.origin), live.receiptProfiles, adapterVersion) : undefined;
    // Said once per change: which profile matched and how (a reviewed build or the «any build» sentinel), or that none
    // does while the flag is on.
    const same = judged === lastJudged || (!!judged && !!lastJudged && judged.profile === lastJudged.profile && judged.kind === lastJudged.kind);
    if (!same && judged !== undefined) diag({ event: 'receipt-profile', ...(judged === null ? { code: 'CG-SEND-RECEIPT' as const } : {}), detail: { profile: judged?.profile ?? null, kind: judged?.kind ?? null } });
    lastJudged = judged;
    receiptProfile = judged ?? null;
    if (judged === undefined) return;
    // §6.2: the modules changed in the middle of a send — what MAIN goes on to read of it is no longer the approved
    // path: `uncertain`, the custody stays, and the next X8 is closed by the capability. Only a send known to be in
    // the queue: one whose command MAIN has not answered yet may still turn out held.
    if (matched && judged === null) {
      for (const [attemptId, state] of flying) {
        if (state !== false) continue;
        flying.set(attemptId, true);
        diag({ event: 'x8-profile-lost', code: 'CG-SEND-UNCERTAIN' });
        for (const listener of [...(sendListeners.get(attemptId) ?? [])]) listener({ attemptId, state: 'uncertain', code: 'CG-SEND-UNCERTAIN' });
      }
    }
    matched = judged !== null;
  };

  // ── identity ──

  const identity = (): HostIdentity | null => {
    const documentEpoch = bridge?.documentEpoch ?? null;
    const account = route.account;
    if (!documentEpoch || !hostLoginEpoch || !account?.platformAccountId) return null;
    const current = composer && !composer.hidden && sameChat(composer.chat, route.chat) ? composer.instanceId : null;
    return {
      host: 'chatspace',
      documentEpoch,
      hostLoginEpoch,
      hostAccountId: account.hostAccountId,
      platformAccountId: account.platformAccountId,
      chat: route.chat,
      routeEpoch: route.epoch,
      composerInstanceId: current,
    };
  };

  // ── cache refresh (reads of page memory through MAIN) ──

  /**
   * A read failed. The log hears a run of the same failure of the same kind of read once — and its 10th, 100th…
   * time with the count —, not once per ask: a page that keeps answering the same way filled the log segment in two
   * seconds (fourth live check). `requestKind` is the bridge's own name of the read, a fixed word, never a text.
   */
  const readFailed = (kind: ReadKind, failure: string): void => {
    const run = failing.get(kind);
    if (run?.failure === failure) {
      run.count += 1;
      if (Number.isInteger(Math.log10(run.count))) diag({ event: 'read-failed', detail: { requestKind: kind, failure, repeats: run.count } });
      return;
    }
    failing.set(kind, { failure, count: 1 });
    diag({ event: 'read-failed', detail: { requestKind: kind, failure } });
  };
  /** A read answered: a run of failures of its kind is over — said, with its count, when it was more than one. */
  const readAnswered = (kind: ReadKind): void => {
    const run = failing.get(kind);
    if (run === undefined) return;
    failing.delete(kind);
    if (run.count > 1) diag({ event: 'read-recovered', detail: { requestKind: kind, failure: run.failure, repeats: run.count } });
  };

  /** One read per key at a time; asked again meanwhile, it runs once more when the first is done (a change is never lost). */
  const once = (key: string, kind: ReadKind, work: () => Promise<void>): void => {
    if (!bridge || disposed) return;
    if (inFlight.has(key)) {
      dirty.add(key);
      return;
    }
    inFlight.add(key);
    void work()
      .then(
        () => {
          failedReads.delete(key);
          readAnswered(kind);
        },
        (error: unknown) => {
          failedReads.add(key);
          readFailed(kind, error instanceof BridgeCallError ? error.failure : 'error');
        },
      )
      .finally(() => {
        inFlight.delete(key);
        if (dirty.delete(key)) once(key, kind, work);
      });
  };

  const refreshWindow = (chat: ChatRef): void =>
    once(`window:${keyOf(chat)}`, 'chatWindow', async () => {
      const window = await (bridge as MainBridgeClient).request('chatWindow', { acc: chat.hostAccountId, fan: chat.platformFanId, max: BRIDGE_LIMITS.maxSnapshotMessages });
      windows.clear();
      windows.set(keyOf(chat), window);
      if (sameChat(chat, route.chat)) emit({ type: 'chatCache', chat });
    });

  const refreshFan = (chat: ChatRef, announce: boolean): void =>
    once(`fan:${keyOf(chat)}`, 'fan', async () => {
      const fan = await (bridge as MainBridgeClient).request('fan', { acc: chat.hostAccountId, fan: chat.platformFanId });
      fans.delete(keyOf(chat));
      fans.set(keyOf(chat), fan);
      if (fans.size > FAN_CACHE) fans.delete(fans.keys().next().value as ChatKey);
      if (announce && sameChat(chat, route.chat)) emit({ type: 'chatCache', chat });
    });

  const refreshList = (hostAccountId: string): void =>
    once(`list:${hostAccountId}`, 'listChats', async () => {
      const items = await (bridge as MainBridgeClient).request('listChats', { acc: hostAccountId, limit: BRIDGE_LIMITS.maxArrayLength });
      lists.set(hostAccountId, { items, at: clock() });
    });

  const refreshOpenChat = (): void => {
    const chat = route.chat;
    if (!chat) return;
    if (capability('chatWindow')) refreshWindow(chat);
    if (capability('fan')) refreshFan(chat, true);
    if (capability('chatList')) refreshList(chat.hostAccountId);
  };

  /** The cached list is kept but no longer fresh: the next listCachedChats() reads it again (lazily, not on every cache change). */
  const staleList = (hostAccountId: string): void => {
    const cached = lists.get(hostAccountId);
    if (cached) lists.set(hostAccountId, { items: cached.items, at: Number.NEGATIVE_INFINITY });
  };

  const refreshAccounts = (): void =>
    once('accounts', 'listAccounts', async () => {
      accounts = await (bridge as MainBridgeClient).request('listAccounts', {});
      emit({ type: 'accounts', accounts });
      recompute();
    });

  // ── MAIN's state ──

  const setRoute = (next: RouteState, loginEpoch: string | null): void => {
    const moved = next.epoch !== route.epoch || !sameChat(next.chat, route.chat);
    route = next;
    hostLoginEpoch = loginEpoch;
    // The composer of the chat we left is no longer the open chat's (the dock leaves it too); MAIN reports the new one
    // a frame later — or has reported it already, its route event being the one that came late (`syncComposer`).
    syncComposer();
    if (moved) emit({ type: 'route', route });
    if (moved) refreshReceipt();
    if (moved) staleOpen();
    recompute();
    refreshOpenChat();
  };

  /**
   * The open chat's composer from MAIN's last report and the route — whichever of the two came last. MAIN's route and
   * composer events are coalesced each on its own, there and in the bridge client (§5.3), so they can come in another
   * order than MAIN's own: after quick switches the composer of the chat MAIN came back to may come before a route
   * event of a chat it has already left, and MAIN sends that composer only once (an unchanged state is not repeated).
   * Dropping the report on that late route left the dock «copy only» over a field that was there (`pnpm perf`); kept,
   * it is the open chat's again as soon as the route of its chat comes.
   */
  const syncComposer = (): void => {
    const next = reported && sameChat(reported.chat, route.chat) ? reported : null;
    if (next === composer) return;
    composer = next;
    mounts.update(next);
    emit({ type: 'composer', composer: next });
  };

  const setComposer = (next: ComposerState | null): void => {
    reported = next;
    syncComposer();
  };

  const snapshot = async (): Promise<void> => {
    if (!bridge) return;
    const taken = await bridge.request('snapshot', {});
    snapshotTaken = true;
    wire = taken.contract;
    accounts = taken.accounts;
    setRoute(taken.route, taken.hostLoginEpoch);
    setComposer(taken.composer);
    emit({ type: 'accounts', accounts });
    recompute();
  };

  const onBridgeEvent = (event: BridgeEvent): void => {
    if (disposed) return;
    if (!snapshotTaken && event.t !== 'contract') void snapshot().catch(() => undefined);
    switch (event.t) {
      case 'route':
        return setRoute(event.payload.route, event.payload.hostLoginEpoch);
      case 'composer':
        setComposer(event.payload.state);
        return recompute();
      case 'accounts':
        return refreshAccounts();
      case 'chatCache': {
        const chat: ChatRef = { host: 'chatspace', hostAccountId: event.payload.acc, platformFanId: event.payload.fan };
        if (!sameChat(chat, route.chat)) return;
        staleOpen(chat);
        if (capability('chatWindow')) refreshWindow(chat);
        if (capability('fan')) refreshFan(chat, true);
        staleList(chat.hostAccountId);
        return;
      }
      case 'contract': {
        wire = event.payload;
        const before = report;
        refreshReceipt();
        recompute();
        // An anchor came (its data landed after the route settled): what it feeds is read now, not at the next change.
        if (report !== before) refreshOpenChat();
        return;
      }
      // Facts of the tap and the receipt observer: never coalesced, never with a message's text.
      case 'incoming': {
        const { acc, fan, msgId, ...rest } = event.payload;
        staleOpen({ host: 'chatspace', hostAccountId: acc, platformFanId: fan });
        return emit({ type: 'incoming', fact: { host: 'chatspace', hostAccountId: acc, platformFanId: fan, platformMessageId: msgId, ...rest, source: 'ws-tap' } });
      }
      case 'coverage':
        return emit({ type: 'coverage', coverage: { hostAccountId: event.payload.acc, state: event.payload.state, reason: event.payload.reason } });
      case 'humanSend': {
        const { acc, fan, ...rest } = event.payload;
        return emit({ type: 'humanSend', fact: { chat: { host: 'chatspace', hostAccountId: acc, platformFanId: fan }, ...rest } });
      }
      case 'previewSendState': {
        const view = event.payload.view;
        const voided = flying.get(view.attemptId) === true;
        if (view.state === 'sentObserved' || view.state === 'rejected' || view.state === 'uncertain') flying.delete(view.attemptId);
        // After the `uncertain` said here (§6.2) only the late linked pair may still speak (§6.7.7).
        if (voided && view.state !== 'sentObserved') return;
        for (const listener of [...(sendListeners.get(view.attemptId) ?? [])]) listener(view);
        return;
      }
      // The fuse (decision X25): X8 is off in this document at once; the tab tells the background, the logs hear it.
      case 'previewSendFuse': {
        const fact = event.payload;
        // A trip after a reset is a new one: it holds until a reset after it.
        const first = !latched();
        if (first) trippedAt = clock();
        diag({ event: 'x8-fuse', code: 'CG-SEND-FUSE', detail: { reason: fact.reason, where: fact.where, first, sentChars: fact.sentChars ?? null, seenChars: fact.seenChars ?? null } });
        recompute();
        return emit({ type: 'sendFuse', fuse: fact });
      }
      // A failure of our own MAIN code that its guard kept from the page: only the logs hear of it.
      case 'fault': {
        const { source, count } = event.payload;
        const last = faults.get(source);
        if ((last === undefined && faults.size >= MAX_FAULT_SITES) || count < 2 * (last ?? 0.5)) return;
        faults.set(source, count);
        return diag({ event: 'main-fault', code: 'CG-UNKNOWN', detail: { source, count } });
      }
    }
  };

  const unsubscribeBridge = bridge?.onEvent(onBridgeEvent) ?? (() => undefined);
  const unsubscribeTheme = theme.onChange(() => recompute());
  const unsubscribeMounts = mounts.onChange(() => recompute());
  /**
   * ChatSpace rendered the open chat's composer again from new nodes and MAIN did not hear of it (it reads composers on
   * store events): it still names the old composer, whose nodes are gone, and a «Вставить» made with that identity would
   * be refused. The dock stands over the new nodes and MAIN stayed silent (mount.ts `onRenewed`), so MAIN is asked to
   * look again: asked for a snapshot, it finds the new composer, binds it to the chat by the same rule as ever — and
   * says it in its composer EVENT (runtime.ts). The answer itself is not taken: MAIN's state reaches this side by one
   * way only. MAIN never repeats an event equal to its last one, and it knows nothing of what an answer told — a
   * composer taken from an answer in the middle of a chat switch («none yet») stayed for good when MAIN, back on the
   * first chat, had nothing new to say: the dock was left «copy only» over a field that was there (CI, PR #16).
   * A read only: nothing of the insert's checks changes, here or in MAIN.
   */
  const unsubscribeRenewed = mounts.onRenewed(() => {
    if (bridge && !disposed) void bridge.request('snapshot', {}).catch(() => undefined);
  });
  /**
   * MAIN came after document_start (the extension was installed or updated
   * under an open tab): ChatSpace started without us, so the person is asked
   * to reload. Sticky: a subscriber that comes later still hears it.
   */
  let reloadNeeded = false;
  const noteLateStart = async (): Promise<void> => {
    const probe = await (bridge as MainBridgeClient).probe().catch(() => null);
    // The tap script leaves its handle at document_start. `configure` may have switched it off meanwhile, and once MAIN
    // has answered `flags` its word stands: a handle that is there does not mean the runtime got its live port.
    if (probe && !tapKnown && live?.wsTap !== false) {
      tap = probe.wsTap;
      recompute();
    }
    if (!probe || probe.readyStateAtStart === 'loading' || reloadNeeded) return;
    reloadNeeded = true;
    diag({ event: 'late-start', detail: { startReadyState: probe.readyStateAtStart } });
    emit({ type: 'reloadNeeded' });
  };
  const ready = bridge
    ? snapshot()
        .catch((error: unknown) => diag({ event: 'snapshot-failed', detail: { failure: error instanceof BridgeCallError ? error.failure : 'error' } }))
        .then(noteLateStart)
    : Promise.resolve();

  // ── the draft key (NEW-06) ──

  /** Learns whether ChatSpace still keeps the draft under its key; a non-empty draft without a key degrades draftRead. */
  const noteDraftKey = (chat: ChatRef, nonEmpty: boolean): void => {
    if (!drafts || !nonEmpty) return;
    const stored = readStoredDraft(drafts, chat);
    const next = stored.state === 'present' ? 'ok' : 'missing';
    if (next === draftKey) return;
    draftKey = next;
    recompute();
  };

  const verifyAgainstKey = (receipt: InsertReceipt, target: ChatRef, text: string, mode: 'replace' | 'append'): InsertReceipt => {
    if (receipt.state !== 'applied' || !drafts) return receipt;
    const agrees = storedDraftAgrees(readStoredDraft(drafts, target), text, mode);
    noteDraftKey(target, true);
    if (agrees !== false) return receipt;
    diag({ event: 'insert-key-disagrees', code: 'CG-INSERT-UNCERTAIN' });
    return { state: 'uncertain', code: 'CG-INSERT-UNCERTAIN' };
  };

  /** A refused or failed insert call → its receipt (BRIDGE_WRITE_FAILURES for one that may have run). */
  const insertFailure = (error: unknown): InsertReceipt => {
    if (!(error instanceof BridgeCallError) || error.executed === 'maybe') return WRITE_FAILURES.insertGuarded;
    if (error.failure === 'identity-mismatch' || error.failure === 'stale-document') return rejected('CG-INSERT-CHAT-CHANGED');
    return rejected(error.failure === 'not-ready' ? 'CG-HOST-NOT-READY' : 'CG-INSERT-FAILED');
  };

  // ── X8: the preview send (§6.7) ──

  /** The request as MAIN gets it (contracts MainSendRequestSchema): the host target, the text, the deadline — no binding, ticket or token. */
  const toMain = (req: PreviewSendRequest, expiresAt: number) => ({
    attemptId: req.attemptId,
    acc: req.target.chat.hostAccountId,
    fan: req.target.chat.platformFanId,
    platformAccountId: req.target.binding.platformAccountId,
    part: req.part,
    previewRevision: req.previewRevision,
    plainText: req.plainText,
    isAiGenerated: live?.markAiGenerated === true && req.isAiGenerated,
    checkpoint: req.checkpoint,
    expiresAt,
    // X53: the vault media the part takes along go to MAIN as they are (MainSendRequest.media).
    ...(req.media === undefined ? {} : { media: req.media }),
  });

  /** What this side can refuse before MAIN is asked: the capability (flag, anchors, tap, receipt profile) and the host of the target. */
  const sendRefusal = (req: PreviewSendRequest): PreviewSendConditionCode | null => {
    refreshReceipt();
    recompute();
    if (req.target.chat.host !== 'chatspace') return 'CG-CONTEXT-CHANGED';
    const capability = report.capabilities.previewSend;
    if (capability.state === 'on') return null;
    const code = PREVIEW_SEND_CONDITION_CODES.find((known) => known === capability.code);
    return code ?? 'CG-SEND-HOST';
  };

  const commit = async (req: PreviewSendRequest, ticket: DispatchTicket): Promise<PreviewSendCommit> => {
    const refused = sendRefusal(req);
    if (refused || !bridge) return { state: 'held', code: refused ?? 'CG-SEND-HOST' };
    // A late command is held, never a late send (§6.7.11); MAIN checks the same deadline again.
    if (clock() >= ticket.expiresAt) return { state: 'held', code: 'CG-TIMEOUT' };
    flying.set(req.attemptId, null);
    if (flying.size > FLYING_MAX) flying.delete(flying.keys().next().value as string);
    try {
      const answer = await bridge.request('previewSendCommit', { req: toMain(req, ticket.expiresAt) });
      // Only a send that is in the queue is on its way; its end may have been heard already — then it is not put back.
      if (answer.state !== 'nativeEnqueued') flying.delete(req.attemptId);
      else if (flying.has(req.attemptId)) flying.set(req.attemptId, false);
      return answer;
    } catch (error) {
      flying.delete(req.attemptId);
      if (!(error instanceof BridgeCallError) || error.executed === 'maybe') {
        diag({ event: 'x8-commit-lost', code: 'CG-SEND-UNCERTAIN', detail: { failure: error instanceof BridgeCallError ? error.failure : 'error' } });
        return WRITE_FAILURES.previewSendCommit;
      }
      return { state: 'held', code: error.failure === 'stale-document' ? 'CG-CONTEXT-CHANGED' : 'CG-SEND-HOST' };
    }
  };

  const sendPort: PreviewSendPort = {
    async preflight(req: PreviewSendRequest): Promise<PreviewSendPreflight> {
      if (!(await validation()).isPreviewSendRequest(req)) throw new HostContractError('preflight() takes a PreviewSendRequest');
      const refused = sendRefusal(req);
      if (refused || !bridge) return { ok: false, code: refused ?? 'CG-SEND-HOST' };
      try {
        return await bridge.request('previewSendPreflight', { req: toMain(req, clock() + PREFLIGHT_WINDOW_MS) });
      } catch {
        return { ok: false, code: 'CG-SEND-HOST' };
      }
    },
    async commit(req: PreviewSendRequest, ticket: DispatchTicket): Promise<PreviewSendCommit> {
      const check = await validation();
      if (!check.isPreviewSendRequest(req) || !check.isDispatchTicket(ticket) || ticket.attemptId !== req.attemptId) throw new HostContractError('commit() takes a PreviewSendRequest and the ticket of the same attempt');
      // One command per attempt, ever: a repeat gets the first answer and reaches neither MAIN nor the queue again.
      let first = commits.get(req.attemptId);
      if (!first) {
        commits.set(req.attemptId, (first = commit(req, ticket)));
        // Only «held» is ever forgotten, the oldest first (as in MAIN): an attempt that may have reached the queue stays.
        void first.then((answer) => {
          if (answer.state === 'held' && heldCommits.push(req.attemptId) > COMMIT_MEMORY) commits.delete(heldCommits.shift() as string);
        });
      }
      return first;
    },
    onState(attemptId: string, cb: (view: SendAttemptView) => void): Unsubscribe {
      const set = sendListeners.get(attemptId) ?? new Set<(view: SendAttemptView) => void>();
      sendListeners.set(attemptId, set);
      set.add(cb);
      return () => {
        set.delete(cb);
        if (set.size === 0) sendListeners.delete(attemptId);
      };
    },
  };

  /**
   * 1.24.0 (X53): one read of a preview's media picker (MediaPort). The bridge checked MAIN's answer against the union
   * of the four kinds; `kind` keeps only the one this request asks for. Never rejects.
   */
  const mediaRead = <T>(request: MediaRequest, kind: (value: object) => boolean): Promise<MediaRead<T>> => {
    if (!bridge || disposed) return Promise.resolve({ ok: false, reason: 'unavailable', status: null });
    return bridge.request('media', request, MEDIA_LIMITS.bridgeMs).then(
      (answer): MediaRead<T> =>
        !answer.ok ? { ok: false, reason: answer.failure, status: answer.status } : kind(answer.value) ? { ok: true, value: answer.value as T } : { ok: false, reason: 'invalid', status: null },
      (): MediaRead<T> => ({ ok: false, reason: 'unavailable', status: null }),
    );
  };

  const port: ChatSpaceHostPort = {
    kind: 'chatspace',
    platform: 'onlyfans',
    /** X8; non-null only while the capability is on. */
    get previewSend(): PreviewSendPort | null {
      return !disposed && report.capabilities.previewSend.state === 'on' ? sendPort : null;
    },
    ready: ready.then(() => undefined),
    identity,

    probe: () => report,
    onContract(cb): Unsubscribe {
      contractListeners.add(cb);
      return () => {
        contractListeners.delete(cb);
      };
    },
    current(): HostSnapshot {
      return { kind: 'chatspace', identity: identity(), route, composer, accounts, contract: report, mounts: mounts.points(), theme: theme.current() };
    },
    subscribe(cb): Unsubscribe {
      eventListeners.add(cb);
      if (reloadNeeded) queueMicrotask(() => eventListeners.has(cb) && cb({ type: 'reloadNeeded' }));
      return () => {
        eventListeners.delete(cb);
      };
    },
    async recheck() {
      if (bridge) await snapshot().catch(() => undefined);
      mounts.refresh();
      refreshReceipt();
      recompute();
      return report;
    },
    async configure(config: ChatSpaceLiveConfig) {
      live = config;
      refreshReceipt();
      // MAIN's latch follows the flag at once (§6.7.11); `wsTap: false` switches the tap off for this document.
      tap = bridge ? await bridge.request('flags', { wsTap: config.wsTap, previewSend: config.previewSend, attribution: config.attribution === true }).then((flags) => flags.wsTap, () => false) : false;
      tapKnown = true;
      recompute();
      return report;
    },

    async readDraft(expected: HostIdentity): Promise<DraftSnapshot> {
      if (!bridge) throw new BridgeCallError('not-ready', 'readDraft');
      const draft = await bridge.request('readDraft', { expected });
      if (expected.chat) noteDraftKey(expected.chat, draft.plainText.trim() !== '');
      return { identity: { ...expected, composerInstanceId: draft.composerInstanceId }, revision: draft.revision, plainText: draft.plainText, provenance: draft.provenance, digest: draft.digest };
    },

    async readVisibleTail(expected: HostIdentity, max: number): Promise<LiveTextTail | null> {
      if (!bridge || report.capabilities.freshText.state !== 'on' || max < 1) return null;
      try {
        // Never more than the hub takes (60): MAIN builds less and the answer stays far below the frame limit.
        const tail = await bridge.request('readTail', { expected, max: Math.min(Math.floor(max), LIVE_TEXT_LIMITS.maxItems) });
        const messages = tail?.messages.slice(-Math.min(Math.floor(max), LIVE_TEXT_LIMITS.maxItems)) ?? [];
        return tail && messages.length > 0 ? { capturedAt: tail.capturedAt, messages } : null;
      } catch {
        return null;
      }
    },

    async openChatMessages(chat: ChatRef, options: OpenChatReadOptions): Promise<OpenChatRead> {
      const { limit, cursor } = options;
      if (!Number.isInteger(limit) || limit < 1 || limit > OPEN_CHAT_LIMITS.pageMax || (cursor !== undefined && !/^[1-9]\d{0,29}$/.test(cursor))) {
        throw new HostContractError('openChatMessages: limit 1…pageMax, cursor a native id');
      }
      if (!sameChat(chat, route.chat)) return { ok: false, reason: 'not-open', status: null };
      if (!bridge || disposed) return { ok: false, reason: 'unavailable', status: null };
      const key = keyOf(chat);
      const newest = cursor === undefined;
      if (newest && openPage?.key === key && openPage.limit >= limit && clock() - openPage.at < (options.maxAgeMs ?? OPEN_CHAT_LIMITS.cacheMs)) {
        return { ok: true, page: firstOf(openPage.page, limit), cached: true };
      }
      if (newest && openRead?.key === key && openRead.generation === openGeneration && openRead.limit >= limit) {
        const read = await openRead.done;
        return read.ok ? { ...read, page: firstOf(read.page, limit) } : read;
      }
      const generation = openGeneration;
      /** A settled read serves no later caller: the cache does, or a new request. */
      const settled = (read: OpenChatRead): OpenChatRead => {
        if (openRead?.done === done) openRead = null;
        return read;
      };
      const done: Promise<OpenChatRead> = bridge.request('openChatMessages', { acc: chat.hostAccountId, fan: chat.platformFanId, limit, ...(newest ? {} : { cursor }) }, OPEN_CHAT_LIMITS.bridgeMs).then(
        (answer) => {
          if (!answer.ok) return settled({ ok: false, reason: answer.failure, status: answer.status });
          // Kept only while nothing of the chat moved since the read started: a later message may be missing from it.
          if (newest && generation === openGeneration && sameChat(chat, route.chat)) openPage = { key, at: clock(), limit, page: answer.page };
          return settled({ ok: true, page: answer.page, cached: false });
        },
        (error: unknown) => settled({ ok: false, reason: error instanceof BridgeCallError && error.failure === 'identity-mismatch' ? 'not-open' : 'unavailable', status: null }),
      );
      if (newest) openRead = { key, generation, limit, done };
      return done;
    },

    media: {
      folders: (hostAccountId, offset) => mediaRead<MediaFoldersPage>({ of: 'folders', acc: hostAccountId, offset }, (value) => 'items' in value),
      items: (hostAccountId, folder, offset) => mediaRead<MediaItemsPage>({ of: 'items', acc: hostAccountId, folder, offset }, (value) => 'items' in value),
      fanStates: (chat, ids) => mediaRead<readonly MediaFanState[]>({ of: 'states', acc: chat.hostAccountId, fan: chat.platformFanId, ids: [...ids] }, Array.isArray),
      tags: (hostAccountId, ids) => mediaRead<MediaTags>({ of: 'tags', acc: hostAccountId, ids: [...ids] }, (value) => 'users' in value),
    },

    /** `max` does not narrow the window: it covers what ChatSpace has loaded, up to the snapshot limit (ui-contract.md п. 11). */
    chatWindow(chat: ChatRef): ChatWindow | null {
      if (!sameChat(chat, route.chat)) return null;
      const cached = windows.get(keyOf(chat));
      // Never asked, or the last ask failed and nothing of MAIN's state has moved since: asked once, not per call.
      if (cached === undefined && capability('chatWindow') && !failedReads.has(`window:${keyOf(chat)}`)) refreshWindow(chat);
      return cached ?? null;
    },

    /** A `null` MAIN answered («ChatSpace holds no such fan yet») is kept like any answer until its state moves. */
    fan(chat: ChatRef): HostFan | null {
      const cached = fans.get(keyOf(chat));
      if (cached === undefined && capability('fan') && !failedReads.has(`fan:${keyOf(chat)}`)) refreshFan(chat, false);
      return cached ?? null;
    },

    listCachedChats(hostAccountId: string, limit: number): readonly NavigationItem[] {
      const cached = lists.get(hostAccountId);
      if ((!cached || clock() - cached.at > LIST_FRESH_MS) && capability('chatList')) refreshList(hostAccountId);
      return cached ? cached.items.slice(0, Math.max(0, limit)) : [];
    },

    listCachedAccounts: () => accounts,

    async insert(intent: InsertIntent): Promise<InsertReceipt> {
      const check = await validation();
      if (!check.isInsertIntent(intent) || intent.expected.kind !== 'open') throw new HostContractError('insert() takes an open InsertIntent with its cause; a deferred one rides navigate()');
      const expected = intent.expected;
      const insertCapability = report.capabilities.insert;
      if (insertCapability.state === 'off' || insertCapability.state === 'contractBroken') return rejected(insertCapability.code ?? 'CG-HOST-COMPOSER-MISSING');
      const current = identity();
      if (!bridge || !current) return rejected('CG-HOST-NOT-READY');
      // §6.4 п. 1 on this side; MAIN repeats all of it in the one synchronous step before the write.
      if (
        !sameChat(current.chat, intent.target) ||
        current.documentEpoch !== expected.documentEpoch ||
        current.routeEpoch !== expected.routeEpoch ||
        current.composerInstanceId !== expected.composerInstanceId
      ) {
        return rejected('CG-INSERT-CHAT-CHANGED');
      }
      if (!composer?.ready) return rejected('CG-HOST-COMPOSER-MISSING');
      if (clock() > intent.expiresAt) return rejected('CG-INSERT-FAILED');
      if (!(await redeem({ kind: 'insert', actionToken: intent.cause.actionToken, intentId: intent.intentId }))) return rejected('CG-INSERT-FAILED');
      const { cause: _cause, ...insertWire } = intent;
      let receipt: InsertReceipt;
      try {
        receipt = await bridge.request('insertGuarded', { intent: insertWire });
      } catch (error) {
        receipt = insertFailure(error);
      }
      if (receipt.state === 'uncertain' && receipt.code === 'CG-INSERT-MISPLACED') diag({ event: 'insert-misplaced', code: receipt.code });
      return verifyAgainstKey(receipt, intent.target, intent.text, intent.mode);
    },

    async focusComposer(expected: HostIdentity): Promise<boolean> {
      if (!bridge) return false;
      try {
        return (await bridge.request('focus', { expected })).focused;
      } catch {
        return false;
      }
    },

    async navigate(intent: NavigationIntent, options: NavigateOptions = {}): Promise<NavigationReceipt> {
      const check = await validation();
      if (!check.isNavigationIntent(intent)) throw new HostContractError('navigate() takes a NavigationIntent with its cause');
      const then = intent.thenInsert;
      const failed = (code: CgCode): NavigationReceipt => ({ state: 'failed', code, insert: then ? rejected(code) : null });
      if (!bridge || !capability('navigate')) return failed('CG-NAV-FAILED');
      if (!(await redeem({ kind: 'navigate', actionToken: intent.cause.actionToken, intentId: intent.intentId }))) return failed('CG-NAV-FAILED');
      // The chat still opens, but its insert is refused now instead of waiting out its deadline in MAIN: copy only (the insert
      // capability is off), or the insert was canceled already (§6.5: sign-out, persona or binding change, the preview closed).
      const insertCapability = report.capabilities.insert;
      const skipped: CgCode | null =
        options.signal?.aborted === true
          ? 'CG-INSERT-CANCELED'
          : insertCapability.state === 'off' || insertCapability.state === 'contractBroken'
            ? (insertCapability.code ?? 'CG-HOST-COMPOSER-MISSING')
            : null;
      // MAIN waits for the composer until the insert's own deadline: never later than this side waits for MAIN's answer, or the
      // insert could land after the person was told it timed out.
      const navTimeoutMs = navTimeout();
      const thenInsert = then && !skipped ? { ...then, expiresAt: Math.max(then.createdAt + 1, Math.min(then.expiresAt, clock() + navTimeoutMs)) } : undefined;
      const timeoutMs = thenInsert ? Math.min(Math.max(0, thenInsert.expiresAt - clock()), navTimeoutMs) + NAV_GRACE_MS : navTimeoutMs;
      // Canceled while MAIN waits for the composer: MAIN drops the insert unless it was written already; the receipt tells which.
      const signal = thenInsert ? options.signal : undefined;
      const onAbort = (): void => {
        if (thenInsert) void bridge.request('cancelInsert', { intentId: thenInsert.intentId }).catch(() => undefined);
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      let receipt: NavigationReceipt;
      try {
        receipt = await bridge.request(
          'navigate',
          { intent: { intentId: intent.intentId, acc: intent.target.hostAccountId, fan: intent.target.platformFanId, ...(thenInsert ? { thenInsert } : {}) } },
          timeoutMs,
        );
      } catch (error) {
        if (error instanceof BridgeCallError && error.executed === 'no') return failed('CG-NAV-FAILED');
        return { ...WRITE_FAILURES.navigate, insert: then ? (skipped ? rejected(skipped) : WRITE_FAILURES.navigate.insert) : null };
      } finally {
        signal?.removeEventListener('abort', onAbort);
      }
      if (then && skipped) return { ...receipt, insert: rejected(skipped) };
      if (then && receipt.insert && intent.target.platformFanId) {
        const target: ChatRef = { host: 'chatspace', hostAccountId: intent.target.hostAccountId, platformFanId: intent.target.platformFanId };
        return { ...receipt, insert: verifyAgainstKey(receipt.insert, target, then.text, then.mode) };
      }
      return receipt;
    },

    /** §6.7.5: MAIN takes it in one synchronous step; null — no tap, no bridge: the result can be inserted, never sent. */
    async checkpoint(chat: ChatRef): Promise<FreshnessCheckpoint | null> {
      if (!bridge) return null;
      try {
        return await bridge.request('checkpoint', { acc: chat.hostAccountId, fan: chat.platformFanId });
      } catch {
        return null;
      }
    },

    mounts: (): MountPoints => mounts.points(),
    onMounts: (cb): Unsubscribe => mounts.onChange(cb),
    theme: (): HostTheme => theme.current(),
    onTheme: (cb): Unsubscribe => theme.onChange(cb),

    dispose() {
      disposed = true;
      unsubscribeBridge();
      unsubscribeTheme();
      unsubscribeMounts();
      unsubscribeRenewed();
      eventListeners.clear();
      contractListeners.clear();
      sendListeners.clear();
      mounts.dispose();
      theme.dispose();
    },
  };
  return port;
}
