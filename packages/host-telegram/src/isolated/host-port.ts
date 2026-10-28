// HostPort for Telegram Web A (docs/specs/2026-10-27-telegram-site.md §4): the isolated world's face of a Telegram
// tab, with no MAIN script. It never touches the hub, makes no request of its own, never scrolls, never navigates.
//
// - Whose account (§4.1): the active slot's `userId`, read again on every sync, every read of the chat and every
//   insert; a change of it is a new login epoch, and what was asked under the old one matches nothing.
// - Which chat (§4.2): the address's `#<id>` of a person, the same peer as the header's active slide, never the account
//   itself, a service account or a bot (best effort). Web A changes the address by `pushState` with no `hashchange`:
//   a DOM observer of the page brings every change in (coalesced to one sync a frame or so).
// - The chat's window and the fan's name come from the active slide; the transcript is read only when a start asks
//   (`telegram.read`), from the slides as they are at that moment, for the identity the start froze.
// - The insert (§4.4): insert.ts, after the cheap checks, the token, and the editor's arrival; every check again in
//   the write's one step. The page's own state the dock warns about is `notice` (§4.3, §4.4).
// - A new fan message in the open chat is told as an incoming fact (ids only), so a cached answer goes stale.

import type { CgCode } from '@cg/contracts/errors';
import type {
  ChatWindow,
  ComposerState,
  HostEvent,
  HostFan,
  HostNotice,
  HostSnapshot,
  IncomingFact,
  InsertIntent,
  InsertReceipt,
  InsertWire,
  NavigationIntent,
  NavigationReceipt,
  RouteState,
  Unsubscribe,
} from '@cg/contracts/host';
import type { ChatRef, DraftSnapshot, HostAccount, HostIdentity } from '@cg/contracts/ids';
import { CLIENT_CONTEXT_LIMITS } from '@cg/contracts/limits';
import type { TelegramChatRead, TelegramContractReport, TelegramHostPort } from '@cg/contracts/telegram-host';
import { digest } from '@cg/host-kit/common/digest';
import { sameReport } from '@cg/host-kit/isolated/report';

import { activeUserIdOf, type SessionRead } from './account';
import { TELEGRAM_ADAPTER_VERSION, buildTelegramReport } from './contract';
import { SERVICE_PEERS, TELEGRAM_SELECTORS, editable, peerOfHash, readChatDom, readPageState, type ChatDom, type PageState } from './dom';
import { createTelegramField, rejected, type InsertionRecord } from './insert';
import type { TelegramMounts } from './mount';
import type { TelegramTheme } from './theme';
import { readTranscript, type TranscriptRead } from './transcript';

export const TELEGRAM_KIND = 'telegram-web' as const;
export const TELEGRAM_PLATFORM = 'telegram' as const;

/** What the host tells the tab's log: an event, its code, a few plain facts — never a text, a name or an id. */
export interface TelegramDiagnostic {
  readonly event: string;
  readonly code?: CgCode;
  readonly detail?: Readonly<Record<string, string | number | boolean | null>>;
}

/** Spends one action token for one write (`token.redeem`); false — not spent, nothing is written. */
export type TokenRedeemer = (request: { readonly kind: 'insert' | 'navigate'; readonly actionToken: string; readonly intentId: string }) => Promise<boolean>;

export interface TelegramPort extends TelegramHostPort {
  /** The identity reads and writes are checked against now; null when there is none. */
  identity(): HostIdentity | null;
  probe(): TelegramContractReport;
  /** «Проверить»: the page read again. */
  recheck(): Promise<TelegramContractReport>;
  /** What our last write left in the open field, while the draft descends from it; null — none. */
  insertion(): InsertionRecord | null;
  /** The active account's id as the page's session names it (the diagnostics line); null — none. */
  activeAccount(): string | null;
  /**
   * Whether our dock shows in the open chat (the application says: the account is bound to a page granted to the
   * person); null — not known yet. Off, the early key route reads «no chat of ours»: Telegram keeps its own keys (⌘E,
   * ⌘I) on any account that is not the page's (spec §2).
   */
  dockShown(): boolean | null;
  setDockShown(shown: boolean): void;
}

export interface TelegramPortOptions {
  readonly win: Window;
  readonly mounts: TelegramMounts;
  readonly theme: TelegramTheme;
  /** The page's own storage, the active slot's session entry only (account.ts). */
  readonly session: SessionRead;
  readonly redeem: TokenRedeemer;
  readonly adapterVersion?: string;
  readonly now?: () => number;
  /** How long an insert waits for the editor to replace its stub (ms). */
  readonly editorWaitMs?: number;
  readonly onDiagnostic?: (diagnostic: TelegramDiagnostic) => void;
}

/** The longest draft a snapshot carries (contracts DraftSnapshotSchema). */
const DRAFT_MAX = 20_000;
/** How long an insert waits for the editor by default. */
const EDITOR_WAIT_MS = 3000;
/** Coalescing of the page's mutations into one sync. */
const SYNC_DELAY_MS = 40;
/** Fan message ids remembered per chat, to tell a new one. */
const CHATS_KEPT = 64;

/** A token of the epoch shape (`[A-Za-z0-9_-]{1,64}`), new each call. */
function newToken(win: Window): string {
  const bytes = new Uint8Array(12);
  win.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(36).padStart(2, '0')).join('');
}

const sameChat = (a: ChatRef | null, b: ChatRef | null): boolean =>
  a === null || b === null ? a === b : a.host === b.host && a.hostAccountId === b.hostAccountId && a.platformFanId === b.platformFanId;

export function createTelegramHostPort(options: TelegramPortOptions): TelegramPort {
  const { win, mounts, theme, session, redeem } = options;
  const doc = win.document;
  const clock = options.now ?? (() => Date.now());
  const adapterVersion = options.adapterVersion ?? TELEGRAM_ADAPTER_VERSION;
  const diag = (diagnostic: TelegramDiagnostic): void => options.onDiagnostic?.(diagnostic);
  const multiaccount = 'SharedWorker' in win;
  const documentEpoch = newToken(win);

  let disposed = false;
  let shown: boolean | null = null;
  let account: string | null = null;
  let loginEpoch: string | null = null;
  let routeEpoch = 1;
  let routeState: RouteState = { epoch: routeEpoch, name: 'other', account: null, chat: null };
  let composer: ComposerState | null = null;
  let composerSeen = '';
  let page: PageState = { newest: true, editing: false, attachment: false };
  let report: TelegramContractReport = buildTelegramReport({ account: false, personRoute: false, layout: false, listSlide: false, headerPeer: false, messageList: false, field: 'none', composer: false, adapterVersion, checkedAt: clock() });
  const eventListeners = new Set<(event: HostEvent) => void>();
  const contractListeners = new Set<(report: TelegramContractReport) => void>();
  const fieldTokens = new WeakMap<Element, string>();
  /** Per chat: the newest fan message id seen, to tell a new one (incoming facts). */
  const fanHeads = new Map<string, string>();
  let fanSequence = 0;
  let windowCache: { readonly key: string; readonly read: TranscriptRead } | null = null;
  const counts = { syncs: 0, routes: 0, incoming: 0, inserts: 0, refused: 0, editorWaits: 0 };

  const emit = (event: HostEvent): void => {
    for (const listener of [...eventListeners]) listener(event);
  };
  const changed = (): void => scheduleSync();
  const field = createTelegramField({
    win,
    changed: () => changed(),
    onWrite: (note) => diag({ event: 'insert', ...(note.receipt.state === 'applied' ? {} : { code: note.receipt.code }), detail: { state: note.receipt.state, mode: note.mode, guarded: note.guarded } }),
  });

  const accountOf = (id: string | null): HostAccount | null =>
    id === null ? null : { host: TELEGRAM_KIND, hostAccountId: id, platform: TELEGRAM_PLATFORM, platformAccountId: id, username: null, displayName: null };
  const accounts = (): readonly HostAccount[] => {
    const own = accountOf(account);
    return own === null ? [] : [own];
  };

  const identity = (): HostIdentity | null => {
    if (account === null || loginEpoch === null) return null;
    return {
      host: TELEGRAM_KIND,
      documentEpoch,
      hostLoginEpoch: loginEpoch,
      hostAccountId: account,
      platformAccountId: account,
      chat: routeState.chat,
      routeEpoch: routeState.epoch,
      composerInstanceId: routeState.chat === null ? null : (composer?.instanceId ?? null),
    };
  };
  const identityMatches = (expected: HostIdentity, current: HostIdentity): boolean =>
    expected.host === current.host &&
    expected.documentEpoch === current.documentEpoch &&
    expected.hostLoginEpoch === current.hostLoginEpoch &&
    expected.routeEpoch === current.routeEpoch &&
    expected.hostAccountId === current.hostAccountId &&
    sameChat(expected.chat, current.chat);

  /** The chat the page shows now, read live: the account, the address and the header's peer agree, and it is a person's. */
  const liveChat = (): { readonly account: string; readonly peer: string; readonly dom: ChatDom } | null => {
    const id = activeUserIdOf(win.location.href, multiaccount, session);
    const peer = peerOfHash(win.location.hash);
    if (id === null || peer === null || peer === id || SERVICE_PEERS.has(peer)) return null;
    const dom = readChatDom(doc);
    if (dom === null || dom.peerId !== peer || dom.bot) return null;
    return { account: id, peer, dom };
  };

  const instanceOf = (element: Element): string => {
    let token = fieldTokens.get(element);
    if (token === undefined) {
      token = newToken(win);
      fieldTokens.set(element, token);
    }
    return token;
  };

  /** A new fan message in the open chat: one fact with the newest id (no text). */
  const noteIncoming = (chat: ChatRef, listSlide: Element): void => {
    let newest: string | null = null;
    for (const node of listSlide.querySelectorAll(`${TELEGRAM_SELECTORS.message}:not(.own)`)) {
      const id = node.getAttribute('data-message-id') ?? '';
      if (!/^[1-9]\d{0,29}$/.test(id)) continue;
      if (newest === null || id.length > newest.length || (id.length === newest.length && id > newest)) newest = id;
    }
    if (newest === null) return;
    const key = `${chat.hostAccountId}:${chat.platformFanId}`;
    const known = fanHeads.get(key);
    fanHeads.delete(key);
    fanHeads.set(key, newest);
    if (fanHeads.size > CHATS_KEPT) fanHeads.delete(fanHeads.keys().next().value as string);
    if (known === undefined || known === newest || known.length > newest.length || (known.length === newest.length && known > newest)) return;
    fanSequence += 1;
    counts.incoming += 1;
    const fact: IncomingFact = {
      host: TELEGRAM_KIND,
      hostAccountId: chat.hostAccountId,
      platformFanId: chat.platformFanId,
      platformMessageId: newest,
      fromFan: true,
      automatic: false,
      tip: false,
      sentAt: null,
      socketEpoch: 0,
      fanSequence,
      source: 'store',
    };
    emit({ type: 'incoming', fact });
  };

  const sync = (): void => {
    if (disposed) return;
    counts.syncs += 1;
    const id = activeUserIdOf(win.location.href, multiaccount, session);
    if (id !== account) {
      account = id;
      loginEpoch = id === null ? null : newToken(win);
      emit({ type: 'accounts', accounts: accounts() });
    }
    const hashPeer = peerOfHash(win.location.hash);
    const dom = readChatDom(doc);
    const personal = id !== null && hashPeer !== null && hashPeer !== id && !SERVICE_PEERS.has(hashPeer);
    const ours = personal && dom !== null && dom.peerId === hashPeer && !dom.bot;
    // An animation of the slides (no active slide for a moment) keeps the chat the address still names.
    const settling = personal && dom === null && routeState.chat?.platformFanId === hashPeer && routeState.chat.hostAccountId === id;
    const chat: ChatRef | null = ours || settling ? { host: TELEGRAM_KIND, hostAccountId: id, platformFanId: hashPeer } : null;
    const name: RouteState['name'] = chat === null ? 'other' : 'chat';
    if (!sameChat(chat, routeState.chat) || name !== routeState.name || routeState.account?.hostAccountId !== (id ?? undefined)) {
      routeEpoch += 1;
      counts.routes += 1;
      routeState = { epoch: routeEpoch, name, account: accountOf(id), chat };
      windowCache = null;
      emit({ type: 'route', route: routeState });
    }

    // The field of the open chat: the editor, or its stub while it loads (an insert waits for the editor).
    // While the slides settle, the field followed so far stays the chat's.
    const element = ours && dom !== null ? dom.field : chat !== null ? field.element() : null;
    const instance = element === null ? null : instanceOf(element);
    if (ours || chat === null) field.follow(element, instance);
    const nextComposer: ComposerState | null =
      chat === null || element === null || instance === null ? null : { chat, instanceId: instance, ready: true, hidden: false, draft: { revision: field.revision(), provenance: field.provenance() } };
    const seen = nextComposer === null ? 'none' : [nextComposer.instanceId, nextComposer.ready, nextComposer.draft.revision, nextComposer.draft.provenance].join('|');
    composer = nextComposer;
    if (seen !== composerSeen) {
      composerSeen = seen;
      emit({ type: 'composer', composer });
    }

    mounts.place({ composer: ours && dom !== null ? dom.composer : null, composerInstanceId: instance });

    const nextPage = readPageState(doc, ours && dom !== null ? dom.listSlide : null);
    if (ours && (nextPage.newest !== page.newest || nextPage.editing !== page.editing || nextPage.attachment !== page.attachment)) {
      page = nextPage;
      emit({ type: 'notice' });
    }
    if (ours && dom !== null && chat !== null) noteIncoming(chat, dom.listSlide);

    const layout = doc.querySelector(TELEGRAM_SELECTORS.layout) !== null;
    const next = buildTelegramReport({
      account: id !== null,
      personRoute: personal,
      layout,
      listSlide: dom !== null,
      headerPeer: dom !== null,
      messageList: dom !== null && dom.listSlide.querySelector(TELEGRAM_SELECTORS.messageList) !== null,
      field: dom === null || dom.field === null ? 'none' : editable(dom.field) ? 'editor' : 'stub',
      composer: dom !== null && dom.composer !== null,
      adapterVersion,
      checkedAt: clock(),
    });
    if (!sameReport(next, report)) {
      report = next;
      for (const listener of [...contractListeners]) listener(report);
    } else report = next;
  };

  let timer: number | null = null;
  function scheduleSync(): void {
    if (timer !== null || disposed) return;
    timer = win.setTimeout(() => {
      timer = null;
      sync();
    }, SYNC_DELAY_MS);
  }
  const observer = new MutationObserver(() => scheduleSync());
  const watch = (): void => {
    if ((doc.documentElement as HTMLElement | null) === null) return;
    observer.observe(doc.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'contenteditable', 'data-peer-id'] });
  };
  if ((doc.documentElement as HTMLElement | null) !== null) watch();
  else {
    const waiting = new MutationObserver(() => {
      if ((doc.documentElement as HTMLElement | null) === null) return;
      waiting.disconnect();
      watch();
      scheduleSync();
    });
    waiting.observe(doc, { childList: true });
  }
  const onAddress = (): void => scheduleSync();
  win.addEventListener('popstate', onAddress);
  win.addEventListener('hashchange', onAddress);
  // Another tab of the same browser signed in or out: the session entry moved.
  win.addEventListener('storage', onAddress);
  sync();

  /** Every check of a write, against the page as it is now (sync first): a refusal, or null. */
  const insertCheck = (wire: InsertWire): InsertReceipt | null => {
    if (disposed) return rejected('CG-HOST-NOT-READY');
    sync();
    const live = liveChat();
    const current = identity();
    if (live === null || current === null) return rejected('CG-INSERT-CHAT-CHANGED');
    if (live.account !== wire.target.hostAccountId || live.peer !== wire.target.platformFanId) return rejected('CG-INSERT-CHAT-CHANGED');
    const expected = wire.expected;
    if (current.documentEpoch !== expected.documentEpoch || !sameChat(current.chat, wire.target)) return rejected('CG-INSERT-CHAT-CHANGED');
    if (expected.kind === 'open' && (current.routeEpoch !== expected.routeEpoch || current.composerInstanceId !== expected.composerInstanceId)) return rejected('CG-INSERT-CHAT-CHANGED');
    if (live.dom.field === null || live.dom.field !== field.element()) return rejected('CG-INSERT-CHAT-CHANGED');
    if (readPageState(doc, live.dom.listSlide).attachment) return rejected('CG-HOST-ATTACHMENT-OPEN');
    if (!editable(live.dom.field)) return rejected('CG-HOST-COMPOSER-MISSING');
    return null;
  };

  /** The editor replaces its stub a moment after a chat opens: an insert waits for it, as for a field on the other sites. */
  const editorReady = async (): Promise<boolean> => {
    const deadline = clock() + (options.editorWaitMs ?? EDITOR_WAIT_MS);
    for (;;) {
      const live = liveChat();
      if (live !== null && editable(live.dom.field)) return true;
      if (disposed || clock() >= deadline || live === null) return false;
      counts.editorWaits += 1;
      await new Promise((resolve) => win.setTimeout(resolve, 100));
    }
  };

  const fieldFor = (expected: HostIdentity): HTMLElement | null => {
    sync();
    const current = identity();
    const live = liveChat();
    if (disposed || current === null || live === null || !identityMatches(expected, current) || composer === null || expected.composerInstanceId !== composer.instanceId) return null;
    return live.dom.field === field.element() ? live.dom.field : null;
  };

  /** The chat window's summary, kept while the rendered list stays the same (ids, count, the bottom marker). */
  const summaryOf = (listSlide: Element, peer: string): TranscriptRead => {
    const nodes = listSlide.querySelectorAll(TELEGRAM_SELECTORS.message);
    const key = `${peer}|${nodes.length}|${nodes[0]?.getAttribute('data-message-id') ?? ''}|${nodes[nodes.length - 1]?.getAttribute('data-message-id') ?? ''}|${listSlide.querySelector(TELEGRAM_SELECTORS.bottomMarker) !== null}`;
    if (windowCache?.key === key) return windowCache.read;
    const read = readTranscript(listSlide, CLIENT_CONTEXT_LIMITS.transcriptMaxChars);
    windowCache = { key, read };
    return read;
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    if (timer !== null) win.clearTimeout(timer);
    observer.disconnect();
    win.removeEventListener('popstate', onAddress);
    win.removeEventListener('hashchange', onAddress);
    win.removeEventListener('storage', onAddress);
    field.dispose();
    eventListeners.clear();
    contractListeners.clear();
    fanHeads.clear();
    windowCache = null;
  };

  const notice = (chat: ChatRef): HostNotice | null => {
    if (!sameChat(chat, routeState.chat)) return null;
    if (page.attachment) return { code: 'CG-HOST-ATTACHMENT-OPEN', copyOnly: true };
    if (page.editing) return { code: 'CG-HOST-EDITING-SENT', copyOnly: false };
    if (!page.newest) return { code: 'CG-HOST-HISTORY-PARTIAL', copyOnly: false };
    return null;
  };

  return {
    kind: TELEGRAM_KIND,
    platform: TELEGRAM_PLATFORM,
    previewSend: null,
    identity,
    activeAccount: () => activeUserIdOf(win.location.href, multiaccount, session),
    dockShown: () => shown,
    setDockShown(next) {
      shown = next;
    },
    telegram: {
      read(expected: HostIdentity): TelegramChatRead | null {
        sync();
        const current = identity();
        const live = liveChat();
        if (disposed || current === null || live === null || !identityMatches(expected, current) || expected.chat === null || live.peer !== expected.chat.platformFanId) return null;
        const read = readTranscript(live.dom.listSlide, CLIENT_CONTEXT_LIMITS.transcriptMaxChars);
        return { transcript: read.transcript, messageCount: read.messageCount, fanDisplayName: live.dom.name ?? '', newest: read.newest, fanScript: read.fanScript };
      },
    },
    probe: () => report,
    onContract(cb): Unsubscribe {
      contractListeners.add(cb);
      return () => {
        contractListeners.delete(cb);
      };
    },
    recheck() {
      sync();
      return Promise.resolve(report);
    },
    current(): HostSnapshot {
      return { kind: TELEGRAM_KIND, identity: identity(), route: routeState, composer, accounts: accounts(), contract: report, mounts: mounts.points(), theme: theme.current() };
    },
    subscribe(cb): Unsubscribe {
      eventListeners.add(cb);
      return () => {
        eventListeners.delete(cb);
      };
    },
    diagnostics() {
      const counters: Record<string, number> = { ...counts, ...Object.fromEntries(Object.entries(mounts.stats()).map(([key, value]) => [`mount.${key}`, value])) };
      return Promise.resolve({ observedAt: clock(), companion: null, mainAvailable: false, counters });
    },
    readDraft(expected: HostIdentity): Promise<DraftSnapshot> {
      const element = fieldFor(expected);
      if (element === null) return Promise.reject(new Error('identity-mismatch'));
      const text = field.text();
      return Promise.resolve({ identity: identity() as HostIdentity, revision: field.revision(), plainText: text.slice(0, DRAFT_MAX), provenance: field.provenance(), digest: digest(text) });
    },
    readVisibleTail: () => Promise.resolve(null),
    notice,
    chatWindow(chat: ChatRef): ChatWindow | null {
      if (disposed || !sameChat(chat, routeState.chat)) return null;
      const live = liveChat();
      if (live === null || live.peer !== chat.platformFanId) return { chat, state: 'loading', loaded: 0, fanMessages: 0, modelMessages: 0, lastFanMessageId: null, lastFanMessageAt: null, lastModelMessageAt: null, hasOlder: null };
      const summary = summaryOf(live.dom.listSlide, live.peer);
      return {
        chat,
        state: 'ready',
        loaded: Math.min(200, summary.fanMessages + summary.modelMessages),
        fanMessages: summary.fanMessages,
        modelMessages: summary.modelMessages,
        lastFanMessageId: summary.lastFanMessageId,
        lastFanMessageAt: null,
        lastModelMessageAt: null,
        hasOlder: null,
        fanScript: summary.fanScript,
        newestAt: null,
      };
    },
    fan(chat: ChatRef): HostFan | null {
      if (disposed || !sameChat(chat, routeState.chat)) return null;
      const live = liveChat();
      const name = live !== null && live.peer === chat.platformFanId ? live.dom.name : null;
      return { chat, username: null, displayName: name, isBlocked: null, canReceiveMessages: null, isRestricted: null, isOnline: null, lastSeenAt: null, buyingPowerLabel: null, insights: null, bio: null, lists: null };
    },
    listCachedChats: () => [],
    listCachedAccounts: accounts,
    insertion: () => field.insertion(),

    /** An open intent only. The cheap checks first, so a stale intent spends no token; then the token, the editor, the write. */
    async insert(intent: InsertIntent): Promise<InsertReceipt> {
      if (typeof intent !== 'object' || intent === null || intent.expected?.kind !== 'open' || typeof intent.text !== 'string' || typeof intent.cause?.actionToken !== 'string') {
        throw new TypeError('insert() takes an open InsertIntent with its cause');
      }
      counts.inserts += 1;
      if (disposed) return rejected('CG-HOST-NOT-READY');
      const { cause, ...wire } = intent;
      const refused = (receipt: InsertReceipt): InsertReceipt => {
        counts.refused += 1;
        diag({ event: 'insert-refused', ...(receipt.state === 'applied' ? {} : { code: receipt.code }) });
        return receipt;
      };
      // The editor's stub is no refusal before the token: the write waits for the editor below.
      const early = insertCheck(wire);
      if (early !== null && !(early.state === 'rejected' && early.code === 'CG-HOST-COMPOSER-MISSING')) return refused(early);
      if (clock() > intent.expiresAt || !(await redeem({ kind: 'insert', actionToken: cause.actionToken, intentId: intent.intentId })) || clock() > intent.expiresAt) return refused(rejected('CG-INSERT-FAILED'));
      if (disposed) return rejected('CG-HOST-NOT-READY');
      if (!(await editorReady())) return refused(rejected('CG-HOST-COMPOSER-MISSING'));
      return field.write(wire, () => insertCheck(wire));
    },
    /** Telegram has no navigation of ours (spec §2): the person opens chats himself. */
    navigate(intent: NavigationIntent): Promise<NavigationReceipt> {
      return Promise.resolve({ state: 'failed', code: 'CG-NAV-FAILED', insert: intent.thenInsert === undefined ? null : rejected('CG-NAV-FAILED') });
    },
    focusComposer(expected: HostIdentity): Promise<boolean> {
      const element = fieldFor(expected);
      if (element === null || !editable(element)) return Promise.resolve(false);
      element.focus();
      return Promise.resolve(doc.activeElement === element);
    },
    checkpoint: () => Promise.resolve(null),
    mounts: () => mounts.points(),
    onMounts: (cb): Unsubscribe => mounts.onChange(cb),
    theme: () => theme.current(),
    onTheme: (cb): Unsubscribe => theme.onChange(cb),
    dispose,
  };
}
