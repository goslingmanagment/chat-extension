// HostPort for ChatSpace (architecture.md §5.2, §6): the isolated-world face
// of the host. It never touches the network or the hub token (§4); it reads
// page memory only through the MAIN bridge, the DOM for mounting, and the
// page's draft key through a storage port.
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
//
// Part B (X8 send port, receipt, human-send observation, WS tap) is not here:
// `checkpoint()` answers null and `previewSend` is null.

import type { ChatKey, ChatRef, DraftSnapshot, HostAccount, HostIdentity } from '@cg/contracts/ids';
import type { ChatWindow, ComposerState, HostContractReport, HostEvent, HostFan, HostPort, HostSnapshot, HostTheme, InsertIntent, InsertReceipt, LiveTextTail, MountPoints, NavigationIntent, NavigationItem, NavigationReceipt, RouteState, Unsubscribe } from '@cg/contracts/host';
import type { CgCode } from '@cg/contracts/errors';
import type { FreshnessCheckpoint } from '@cg/contracts/send';
import { BRIDGE_LIMITS, LIVE_TEXT_LIMITS } from '@cg/contracts/limits';

import { BridgeCallError, loadValidation, type BridgeEvent, type MainBridgeClient } from './bridge-client';
import { buildContractReport, sameReport, type ContractWireInput } from './contract';
import { readStoredDraft, storedDraftAgrees, type DraftStorage } from './draft-store';
import type { MountManager } from './mount';
import type { ThemeReader } from './theme';
import { WRITE_FAILURES } from './wire';

/** The adapter's own version, reported in the contract check. */
export const ADAPTER_VERSION = '0.1.0';

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
  /** The page's localStorage, read only (the composition root gives it; §6.1). */
  readonly drafts?: DraftStorage | null;
  readonly adapterVersion?: string;
  /** Bootstrap `limits.navInsertTimeoutSec` × 1000 (§5.3); 20 s by default. */
  readonly navInsertTimeoutMs?: number;
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
  recheck(): Promise<HostContractReport>;
}

const keyOf = (chat: ChatRef): ChatKey => `${chat.host}:${chat.hostAccountId}:${chat.platformFanId}`;
const sameChat = (a: ChatRef | null | undefined, b: ChatRef | null | undefined): boolean => !!a && !!b && keyOf(a) === keyOf(b);
const rejected = (code: CgCode): InsertReceipt => ({ state: 'rejected', code });
/** How long a cached chat list counts as fresh before a read asks MAIN again (no timer). */
const LIST_FRESH_MS = 1000;
/** Fans of other chats kept for decoration. */
const FAN_CACHE = 200;
/** Time MAIN gets past a deferred insert's deadline to answer with its own outcome. */
const NAV_GRACE_MS = 1000;

export function createChatSpaceHostPort(options: ChatSpaceHostOptions): ChatSpaceHostPort {
  const { bridge, mounts, theme, redeem } = options;
  const drafts = options.drafts ?? null;
  const navTimeoutMs = options.navInsertTimeoutMs ?? BRIDGE_LIMITS.navInsertTimeoutDefaultMs;
  const diag = (diagnostic: HostDiagnostic): void => options.onDiagnostic?.(diagnostic);
  const clock = (): number => Date.now();

  let route: RouteState = { epoch: 0, name: 'other', account: null, chat: null };
  let hostLoginEpoch: string | null = null;
  let composer: ComposerState | null = null;
  let accounts: readonly HostAccount[] = [];
  let wire: ContractWireInput | null = null;
  /** §6.2 `draftKey`: unchecked counts as fine; it turns `missing` when a non-empty draft has no key. */
  let draftKey: 'ok' | 'missing' = 'ok';
  let snapshotTaken = false;
  let disposed = false;
  let report: HostContractReport = compute();
  const windows = new Map<ChatKey, ChatWindow | null>();
  const fans = new Map<ChatKey, HostFan | null>();
  const lists = new Map<string, { readonly items: readonly NavigationItem[]; readonly at: number }>();
  const inFlight = new Set<string>();
  /** Reads asked for while the same read was in flight: it runs once more afterwards. */
  const dirty = new Set<string>();

  const eventListeners = new Set<(event: HostEvent) => void>();
  const contractListeners = new Set<(report: HostContractReport) => void>();
  const emit = (event: HostEvent): void => {
    for (const listener of [...eventListeners]) listener(event);
  };

  function compute(): HostContractReport {
    return buildContractReport({
      wire,
      dom: { composerFrame: mounts.frameAnchor(), draftKey, theme: theme.anchor() },
      accountBound: Boolean(route.account?.platformAccountId),
      adapterVersion: options.adapterVersion ?? ADAPTER_VERSION,
      checkedAt: clock(),
    });
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

  /** One read per key at a time; asked again meanwhile, it runs once more when the first is done (a change is never lost). */
  const once = (key: string, work: () => Promise<void>): void => {
    if (!bridge || disposed) return;
    if (inFlight.has(key)) {
      dirty.add(key);
      return;
    }
    inFlight.add(key);
    void work()
      .catch((error: unknown) => {
        if (error instanceof BridgeCallError) diag({ event: 'read-failed', detail: { request: error.t, failure: error.failure } });
      })
      .finally(() => {
        inFlight.delete(key);
        if (dirty.delete(key)) once(key, work);
      });
  };

  const refreshWindow = (chat: ChatRef): void =>
    once(`window:${keyOf(chat)}`, async () => {
      const window = await (bridge as MainBridgeClient).request('chatWindow', { acc: chat.hostAccountId, fan: chat.platformFanId, max: BRIDGE_LIMITS.maxSnapshotMessages });
      windows.clear();
      windows.set(keyOf(chat), window);
      if (sameChat(chat, route.chat)) emit({ type: 'chatCache', chat });
    });

  const refreshFan = (chat: ChatRef, announce: boolean): void =>
    once(`fan:${keyOf(chat)}`, async () => {
      const fan = await (bridge as MainBridgeClient).request('fan', { acc: chat.hostAccountId, fan: chat.platformFanId });
      fans.delete(keyOf(chat));
      fans.set(keyOf(chat), fan);
      if (fans.size > FAN_CACHE) fans.delete(fans.keys().next().value as ChatKey);
      if (announce && sameChat(chat, route.chat)) emit({ type: 'chatCache', chat });
    });

  const refreshList = (hostAccountId: string): void =>
    once(`list:${hostAccountId}`, async () => {
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
    once('accounts', async () => {
      accounts = await (bridge as MainBridgeClient).request('listAccounts', {});
      emit({ type: 'accounts', accounts });
      recompute();
    });

  // ── MAIN's state ──

  const setRoute = (next: RouteState, loginEpoch: string | null): void => {
    const moved = next.epoch !== route.epoch || !sameChat(next.chat, route.chat);
    route = next;
    hostLoginEpoch = loginEpoch;
    // The composer state belongs to the chat we left (the dock leaves it too); MAIN reports the new one a frame later.
    if (composer && !sameChat(composer.chat, route.chat)) setComposer(null);
    if (moved) emit({ type: 'route', route });
    recompute();
    refreshOpenChat();
  };

  const setComposer = (next: ComposerState | null): void => {
    composer = next;
    mounts.update(next);
    emit({ type: 'composer', composer: next });
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
        if (capability('chatWindow')) refreshWindow(chat);
        if (capability('fan')) refreshFan(chat, true);
        staleList(chat.hostAccountId);
        return;
      }
      case 'contract': {
        wire = event.payload;
        const before = report;
        recompute();
        // An anchor came (its data landed after the route settled): what it feeds is read now, not at the next change.
        if (report !== before) refreshOpenChat();
        return;
      }
      case 'incoming':
      case 'coverage':
      case 'humanSend':
      case 'previewSendState':
        // Part B (WS tap, send observation, X8) consumes these.
        return;
    }
  };

  const unsubscribeBridge = bridge?.onEvent(onBridgeEvent) ?? (() => undefined);
  const unsubscribeTheme = theme.onChange(() => recompute());
  const unsubscribeMounts = mounts.onChange(() => recompute());
  /**
   * MAIN came after document_start (the extension was installed or updated
   * under an open tab): ChatSpace started without us, so the person is asked
   * to reload. Sticky: a subscriber that comes later still hears it.
   */
  let reloadNeeded = false;
  const noteLateStart = async (): Promise<void> => {
    const probe = await (bridge as MainBridgeClient).probe().catch(() => null);
    if (!probe || probe.readyStateAtStart === 'loading' || reloadNeeded) return;
    reloadNeeded = true;
    diag({ event: 'late-start', detail: { readyStateAtStart: probe.readyStateAtStart } });
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

  const port: ChatSpaceHostPort = {
    kind: 'chatspace',
    platform: 'onlyfans',
    previewSend: null,
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
        const tail = await bridge.request('readTail', { expected, max: Math.min(Math.floor(max), BRIDGE_LIMITS.maxSnapshotMessages) });
        const messages = tail?.messages.slice(-Math.min(Math.floor(max), LIVE_TEXT_LIMITS.maxItems)) ?? [];
        return tail && messages.length > 0 ? { capturedAt: tail.capturedAt, messages } : null;
      } catch {
        return null;
      }
    },

    chatWindow(chat: ChatRef): ChatWindow | null {
      if (!sameChat(chat, route.chat)) return null;
      const cached = windows.get(keyOf(chat));
      if (cached === undefined && capability('chatWindow')) refreshWindow(chat);
      return cached ?? null;
    },

    fan(chat: ChatRef): HostFan | null {
      const cached = fans.get(keyOf(chat));
      if (cached === undefined && capability('fan')) refreshFan(chat, false);
      return cached ?? null;
    },

    listCachedChats(hostAccountId: string, limit: number): readonly NavigationItem[] {
      const cached = lists.get(hostAccountId);
      if ((!cached || clock() - cached.at > LIST_FRESH_MS) && capability('chatList')) refreshList(hostAccountId);
      return cached ? cached.items.slice(0, Math.max(0, limit)) : [];
    },

    listCachedAccounts: () => accounts,

    async insert(intent: InsertIntent): Promise<InsertReceipt> {
      const check = await loadValidation();
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

    async navigate(intent: NavigationIntent): Promise<NavigationReceipt> {
      const check = await loadValidation();
      if (!check.isNavigationIntent(intent)) throw new HostContractError('navigate() takes a NavigationIntent with its cause');
      const then = intent.thenInsert;
      const failed = (code: CgCode): NavigationReceipt => ({ state: 'failed', code, insert: then ? rejected(code) : null });
      if (!bridge || !capability('navigate')) return failed('CG-NAV-FAILED');
      if (!(await redeem({ kind: 'navigate', actionToken: intent.cause.actionToken, intentId: intent.intentId }))) return failed('CG-NAV-FAILED');
      // Copy only (the insert capability is off): the chat still opens, the insert is refused now instead of waiting out its deadline in MAIN.
      const insertCapability = report.capabilities.insert;
      const insertOff = insertCapability.state === 'off' || insertCapability.state === 'contractBroken' ? (insertCapability.code ?? 'CG-HOST-COMPOSER-MISSING') : null;
      const thenInsert = then && !insertOff ? then : undefined;
      const timeoutMs = thenInsert ? Math.min(Math.max(0, thenInsert.expiresAt - clock()), navTimeoutMs) + NAV_GRACE_MS : navTimeoutMs;
      let receipt: NavigationReceipt;
      try {
        receipt = await bridge.request(
          'navigate',
          { intent: { intentId: intent.intentId, acc: intent.target.hostAccountId, fan: intent.target.platformFanId, ...(thenInsert ? { thenInsert } : {}) } },
          timeoutMs,
        );
      } catch (error) {
        if (error instanceof BridgeCallError && error.executed === 'no') return failed('CG-NAV-FAILED');
        return { ...WRITE_FAILURES.navigate, insert: then ? (insertOff ? rejected(insertOff) : WRITE_FAILURES.navigate.insert) : null };
      }
      if (then && insertOff) return { ...receipt, insert: rejected(insertOff) };
      if (then && receipt.insert && intent.target.platformFanId) {
        const target: ChatRef = { host: 'chatspace', hostAccountId: intent.target.hostAccountId, platformFanId: intent.target.platformFanId };
        return { ...receipt, insert: verifyAgainstKey(receipt.insert, target, then.text, then.mode) };
      }
      return receipt;
    },

    /** Part B (§6.7.5): MAIN holds no freshness counters yet. */
    checkpoint: (): Promise<FreshnessCheckpoint | null> => Promise.resolve(null),

    mounts: (): MountPoints => mounts.points(),
    onMounts: (cb): Unsubscribe => mounts.onChange(cb),
    theme: (): HostTheme => theme.current(),
    onTheme: (cb): Unsubscribe => theme.onChange(cb),

    dispose() {
      disposed = true;
      unsubscribeBridge();
      unsubscribeTheme();
      unsubscribeMounts();
      eventListeners.clear();
      contractListeners.clear();
      mounts.dispose();
      theme.dispose();
    },
  };
  return port;
}
