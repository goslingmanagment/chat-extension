// The palette ⌘K (architecture.md §6.9, §10.2 PaletteVM; ui-design §4.20;
// HK-036, CS-006, CS-012, CS-030): ChatGoose's actions, the generations that
// run now, and «перейти» over what is already in memory — ChatSpace's loaded
// chat list and accounts, and the hub rows of Spenders, «Ждут ответа» and
// «Новые» of the account's page. It always says where it looked: the groups
// are named by their source, a row found only in the hub carries the source
// in its sublabel, and a source that did not answer is a gap, not silence.
//
// ChatSpace's own palette stays as it is; this one never loads a page of the
// chat list and never polls who is online — «Онлайн» lists only the fans
// ChatSpace itself already shows online, and opens OUR preview for them.
//
// ChatSpace's rows come from the host port's own copy of its list, which the
// port reads again only when asked and tells nobody when the read lands (the
// navigation controller's LIST_SETTLE_MS). So the palette looks twice, as the
// quick jump does: the look that opens it starts the read, the look a moment
// later shows what it brought — who is online now, not at the last opening.

import { type CgCode } from '@cg/contracts/errors';
import { type FeatureId } from '@cg/contracts/features';
import { type HostPort, type NavigationItem } from '@cg/contracts/host';
import { type ChatRef, type HostAccount } from '@cg/contracts/ids';
import { OP_TERMINAL_STATES, type OpView } from '@cg/contracts/ops';
import {
  DOCK_ACTION_IDS,
  type ActionCatalog,
  type ActionReceipt,
  type DockActionId,
  type DockVM,
  type HotkeyLabel,
  type I18n,
  type Msg,
  type PaletteGroupId,
  type PaletteItemVM,
  type PaletteVM,
  type PartialGap,
  type UiAction,
  type ViewSelector,
  type VmView,
} from '@cg/contracts/vm';

import { onlineChats, searchRows, normalizeQuery, type SearchRow } from '../../domain/navigation';
import { LIST_SETTLE_MS, accountHandle, chatHandle, parseChatHandle } from './navigation-controller';
import { type OverlayState } from './overlays';
import { createEmitter, type SurfaceController, type TabClock, type TabRpc } from './ports';

export interface PaletteFanRow {
  readonly fanRef: string;
  readonly name: string | null;
  readonly username: string | null;
  /** Lifetime money of the fan on the page; null — unknown. */
  readonly lifetimeMills: number | null;
}

export interface PaletteWaitingRow extends PaletteFanRow {
  /** The fan's last message, still unanswered. */
  readonly waitingSince: string;
}

export type PaletteSource<T> = { readonly ok: true; readonly rows: readonly T[] } | { readonly ok: false; readonly code: CgCode };

/** Hub rows for the palette, read through the tab's own background requests (the background caches them). */
export interface PaletteHubPort {
  waiting(account: HostAccount): Promise<PaletteSource<PaletteWaitingRow>>;
  fans(account: HostAccount): Promise<{ readonly spenders: PaletteSource<PaletteFanRow>; readonly newcomers: PaletteSource<PaletteFanRow> }>;
}

export const PALETTE_LIMITS = {
  /** Rows of ChatSpace's cached list the search looks through. */
  hostChats: 500,
  chats: 20,
  waiting: 8,
  running: 10,
  accounts: 10,
  online: 8,
  /** Hub rows are read again after this (the background has its own cache). */
  hubTtlMs: 60_000,
  newcomersWindowHours: 48,
  /** «Ждут ответа» rows asked from the hub. */
  queueRows: 20,
} as const;

/** The default hub port: the page of the account, then the three reads. */
export function createPaletteHub(rpc: Pick<TabRpc, 'request'>): PaletteHubPort {
  const pageOf = async (account: HostAccount): Promise<{ readonly ok: true; readonly pageId: number } | { readonly ok: false; readonly code: CgCode }> => {
    const answer = await rpc.request('binding.resolve', { account });
    return answer.ok ? { ok: true, pageId: answer.payload.binding.pageId } : { ok: false, code: answer.error.code };
  };
  return {
    async waiting(account) {
      const page = await pageOf(account);
      if (!page.ok) return page;
      const answer = await rpc.request('spenders.queue', { pageId: page.pageId, cursor: null, limit: PALETTE_LIMITS.queueRows });
      if (!answer.ok) return { ok: false, code: answer.error.code };
      return {
        ok: true,
        rows: answer.payload.items.map((item) => ({ fanRef: item.fanRef, name: item.displayName, username: item.username, lifetimeMills: item.lifetimeGrossMills, waitingSince: item.lastFanMessageAt })),
      };
    },
    async fans(account) {
      const page = await pageOf(account);
      if (!page.ok) return { spenders: page, newcomers: page };
      const [board, fresh] = await Promise.all([
        rpc.request('spenders.board', { pageId: page.pageId, period: 'lifetime' }),
        rpc.request('newcomers.list', { pageId: page.pageId, windowHours: PALETTE_LIMITS.newcomersWindowHours, cursor: null }),
      ]);
      return {
        spenders: board.ok
          ? {
              ok: true,
              rows: board.payload.items.map((item) => ({
                fanRef: item.fan.platformUserId,
                name: item.fan.displayName,
                username: item.fan.username,
                lifetimeMills: item.metrics.lifetime.scopeGrossAmountMills,
              })),
            }
          : { ok: false, code: board.error.code },
        newcomers: fresh.ok
          ? { ok: true, rows: fresh.payload.items.map((item) => ({ fanRef: item.fanRef, name: item.displayName, username: item.username, lifetimeMills: null })) }
          : { ok: false, code: fresh.error.code },
      };
    },
  };
}

export interface PaletteControllerDeps {
  readonly host: HostPort;
  readonly rpc: TabRpc;
  readonly i18n: I18n;
  readonly catalog: ActionCatalog;
  readonly clock: TabClock;
  readonly overlays: OverlayState;
  /** The dock's view of the open chat: which actions are available and why not. */
  readonly dock: { get(): DockVM | null; subscribe(listener: () => void): () => void };
  /** Hub rows; omitted — `createPaletteHub(rpc)`. */
  readonly hub?: PaletteHubPort;
  /** Our preview of a fan ChatSpace shows online (CS-030); omitted — no «Онлайн» group. */
  readonly preview?: { open(chat: ChatRef): Promise<ActionReceipt> };
}

type Loaded<T> = { readonly at: number; readonly source: PaletteSource<T> };

interface HubCache {
  waiting: Loaded<PaletteWaitingRow> | null;
  spenders: Loaded<PaletteFanRow> | null;
  newcomers: Loaded<PaletteFanRow> | null;
  waitingLoading: boolean;
  fansLoading: boolean;
}

const FEATURE_ACTION: Readonly<Record<FeatureId, DockActionId>> = {
  reply: 'reply',
  fix: 'fix',
  hi: 'hi',
  ping: 'ping',
  review: 'review',
  recap: 'recap',
  'recap-short': 'recap',
  coach: 'coach',
};

const isRunning = (op: OpView): boolean => !(OP_TERMINAL_STATES as readonly string[]).includes(op.state);

export function createPaletteController(deps: PaletteControllerDeps): SurfaceController & { dispose(): void } {
  const { host, i18n, catalog, overlays } = deps;
  const hub = deps.hub ?? createPaletteHub(deps.rpc);
  const changes = createEmitter();
  const caches = new Map<string, HubCache>();
  let query = '';
  let running: readonly OpView[] = [];
  let cached: { readonly version: number; readonly view: PaletteVM } | null = null;
  let wasOpen = overlays.isOpen('palette');

  const cacheOf = (accountId: string): HubCache => {
    let cache = caches.get(accountId);
    if (cache === undefined) {
      cache = { waiting: null, spenders: null, newcomers: null, waitingLoading: false, fansLoading: false };
      caches.set(accountId, cache);
    }
    return cache;
  };

  const currentAccount = (): HostAccount | null => {
    const snapshot = host.current();
    if (snapshot.route.account !== null) return snapshot.route.account;
    const id = snapshot.route.chat?.hostAccountId ?? snapshot.identity?.hostAccountId ?? null;
    return id === null ? null : (snapshot.accounts.find((account) => account.hostAccountId === id) ?? null);
  };

  const stale = <T,>(loaded: Loaded<T> | null): boolean => loaded === null || deps.clock.now() - loaded.at > PALETTE_LIMITS.hubTtlMs;

  /** Reads what the palette needs right now: the queue on open, the board and «Новые» with the first query. */
  const refreshHub = (): void => {
    const account = currentAccount();
    if (account === null || !overlays.isOpen('palette')) return;
    const cache = cacheOf(account.hostAccountId);
    if (!cache.waitingLoading && stale(cache.waiting)) {
      cache.waitingLoading = true;
      void hub
        .waiting(account)
        .catch((): PaletteSource<PaletteWaitingRow> => ({ ok: false, code: 'CG-HUB-UNAVAILABLE' }))
        .then((source) => {
          cache.waiting = { at: deps.clock.now(), source };
          cache.waitingLoading = false;
          changes.emit();
        });
    }
    if (normalizeQuery(query) !== '' && !cache.fansLoading && (stale(cache.spenders) || stale(cache.newcomers))) {
      cache.fansLoading = true;
      const failed: PaletteSource<PaletteFanRow> = { ok: false, code: 'CG-HUB-UNAVAILABLE' };
      void hub
        .fans(account)
        .catch(() => ({ spenders: failed, newcomers: failed }))
        .then((sources) => {
          const at = deps.clock.now();
          cache.spenders = { at, source: sources.spenders };
          cache.newcomers = { at, source: sources.newcomers };
          cache.fansLoading = false;
          changes.emit();
        });
    }
  };

  const refreshRunning = (): void => {
    void deps.rpc
      .request('op.list', { scope: 'all' })
      .then((answer) => {
        if (!answer.ok) return;
        running = answer.payload.ops.filter(isRunning);
        changes.emit();
      })
      .catch(() => undefined);
  };

  // ── rows ──

  const text = (msg: Msg): string => i18n.text(msg);
  const hotkeyOf = (label: HotkeyLabel | null): HotkeyLabel | null => (label !== null && label.delivery === 'reserved' && label.fallback === null ? null : label);
  const item = (id: string, label: string | Msg, action: UiAction, patch: Partial<PaletteItemVM> = {}): PaletteItemVM => ({
    id,
    label,
    sublabel: null,
    match: [],
    hotkey: null,
    money: null,
    waitingSince: null,
    runningSince: null,
    enabled: true,
    reason: null,
    action,
    ...patch,
  });

  const fanName = (row: { readonly name: string | null; readonly username: string | null }): string => row.name ?? (row.username === null ? i18n.t('common.unknown') : `@${row.username}`);
  const handleOf = (username: string | null): string | null => (username === null ? null : `@${username}`);

  const actionRows = (dock: DockVM | null, inChat: boolean): PaletteItemVM[] => {
    const rows: PaletteItemVM[] = [];
    const target = dock !== null && dock.visible ? dock.targetHandle : null;
    if (inChat && dock !== null && target !== null) {
      for (const id of DOCK_ACTION_IDS) {
        const state = dock.actions[id];
        const action: UiAction =
          id === 'recap'
            ? { type: 'ShowRecap', length: 'full' }
            : id === 'coach'
              ? { type: 'Navigate', to: { kind: 'surface', surface: 'coach', open: true } }
              : { type: 'Generate', targetHandle: target, feature: id, options: {} };
        rows.push(item(`action.${id}`, text({ key: catalog.entry(id).label }), action, { hotkey: hotkeyOf(catalog.entry(id).hotkey), enabled: state.enabled && !state.busy, reason: state.reason }));
      }
      const tones = [null, ...dock.options.tones];
      const nextTone = tones[(tones.indexOf(dock.options.tone) + 1) % tones.length] ?? null;
      rows.push(
        item('action.tone', text({ key: 'palette.item.tone' }), { type: 'SetTone', targetHandle: target, tone: nextTone }, { hotkey: hotkeyOf(catalog.entry('tone').hotkey), enabled: !dock.options.locked && dock.options.toneReason === null, reason: dock.options.toneReason }),
        item('action.split', text({ key: 'palette.item.split' }), { type: 'SetPreference', key: 'generation.split', value: !dock.options.split }, { hotkey: hotkeyOf(catalog.entry('split').hotkey), enabled: !dock.options.locked && dock.options.splitReason === null, reason: dock.options.splitReason }),
        item('action.fan-panel', text({ key: catalog.entry('fan-panel').label }), { type: 'Navigate', to: { kind: 'surface', surface: 'fan-panel', open: !overlays.isOpen('fan-panel') } }, { hotkey: hotkeyOf(catalog.entry('fan-panel').hotkey) }),
      );
    }
    rows.push(
      item('action.spenders', text({ key: 'palette.item.spenders' }), { type: 'Navigate', to: { kind: 'surface', surface: 'spenders', open: true } }, { hotkey: hotkeyOf(catalog.entry('spenders').hotkey) }),
      item('action.newcomers', text({ key: 'palette.item.newcomers' }), { type: 'Navigate', to: { kind: 'surface', surface: 'newcomers', open: true } }),
      item('action.cheatsheet', text({ key: 'palette.item.cheatsheet' }), { type: 'Navigate', to: { kind: 'surface', surface: 'cheatsheet', open: true } }, { hotkey: hotkeyOf(catalog.entry('cheatsheet').hotkey) }),
      item('action.settings', text({ key: 'palette.item.settings' }), { type: 'OpenSettings', route: { section: 'status' } }, { hotkey: hotkeyOf(catalog.entry('settings').hotkey) }),
    );
    return rows;
  };

  /** Rows that match the query, with the underline ranges; an empty query keeps all, in order. */
  const filter = (rows: readonly PaletteItemVM[], extra: (row: PaletteItemVM) => readonly string[], limit: number): PaletteItemVM[] => {
    const search: SearchRow<PaletteItemVM>[] = rows.map((row) => ({ value: row, label: typeof row.label === 'string' ? row.label : text(row.label), extra: extra(row) }));
    return searchRows(search, query, limit).map((hit) => (typeof hit.value.label === 'string' ? { ...hit.value, match: hit.match } : hit.value));
  };
  const withSublabel = (row: PaletteItemVM): readonly string[] => (row.sublabel === null ? [] : [row.sublabel]);

  const build = (): PaletteVM => {
    const snapshot = host.current();
    const account = currentAccount();
    const chat = snapshot.route.chat;
    const dock = deps.dock.get();
    const searching = normalizeQuery(query) !== '';
    const gaps: PartialGap[] = [];
    const groups: { id: PaletteGroupId; title: Msg; items: PaletteItemVM[] }[] = [];

    const listCapability = snapshot.contract.capabilities.chatList;
    const listOff = listCapability.state === 'off' || listCapability.state === 'contractBroken';
    if (listOff || listCapability.state === 'degraded') gaps.push({ kind: 'host-degraded', capabilities: ['chatList'] });
    const hostChats: readonly NavigationItem[] = account === null || listOff ? [] : host.listCachedChats(account.hostAccountId, PALETTE_LIMITS.hostChats);
    const nameOf = new Map(hostChats.map((row) => [row.chat.platformFanId, fanName({ name: row.displayName, username: row.username })]));

    // ── actions (or, outside a chat, the windows one can go to) ──
    const inChat = chat !== null && dock !== null && dock.visible && dock.targetHandle !== null;
    const actions = filter(actionRows(dock, inChat), () => [], 50);
    if (actions.length > 0) {
      const chatName = chat === null ? null : (nameOf.get(chat.platformFanId) ?? host.fan(chat)?.displayName ?? null);
      groups.push(
        inChat && chatName !== null
          ? { id: 'actions', title: { key: 'palette.group.actions', params: { name: chatName } }, items: actions }
          : { id: 'navigation', title: { key: 'palette.group.navigation' }, items: actions },
      );
    }

    // ── generations that run now, in any tab (CS-012) ──
    const runningRows = running.map((op) =>
      item(
        `running.${op.opId}`,
        text({ key: 'palette.item.running', params: { feature: i18n.t(`dock.action.${FEATURE_ACTION[op.feature]}`), fan: nameOf.get(op.target.chat.platformFanId) ?? i18n.t('common.unknown') } }),
        { type: 'Navigate', to: { kind: 'chat', targetHandle: chatHandle(op.target.chat) } },
        { runningSince: op.startedAt },
      ),
    );
    const runningShown = filter(runningRows, () => [], PALETTE_LIMITS.running);
    if (runningShown.length > 0) groups.push({ id: 'running', title: { key: 'palette.group.running' }, items: runningShown });

    const cache = account === null ? null : cacheOf(account.hostAccountId);
    const chatAction = (fanRef: string): UiAction => ({ type: 'Navigate', to: { kind: 'chat', targetHandle: chatHandle({ hostAccountId: account?.hostAccountId ?? '0', platformFanId: fanRef }) } });
    let hubFans = 0;
    let hubSearched = false;

    if (!searching) {
      // ── «Ждут ответа, из Spenders»: the hub's queue ──
      const waiting = cache?.waiting?.source ?? null;
      if (waiting !== null && !waiting.ok) gaps.push({ kind: 'source-failed', source: 'waiting', code: waiting.code });
      if (waiting !== null && waiting.ok) {
        hubSearched = true;
        hubFans = waiting.rows.length;
        const rows = waiting.rows
          .slice(0, PALETTE_LIMITS.waiting)
          .map((row) => item(`waiting.${row.fanRef}`, fanName(row), chatAction(row.fanRef), { sublabel: handleOf(row.username), money: row.lifetimeMills, waitingSince: row.waitingSince }));
        if (rows.length > 0) groups.push({ id: 'waiting', title: { key: 'palette.group.waiting' }, items: rows });
      }
    } else {
      // ── «Чаты из загруженных списков»: ChatSpace's rows first, then hub rows it does not hold ──
      const seen = new Set<string>();
      const rows: PaletteItemVM[] = [];
      for (const row of hostChats) {
        seen.add(row.chat.platformFanId);
        rows.push(item(`chat.${row.chat.platformFanId}`, fanName({ name: row.displayName, username: row.username }), chatAction(row.chat.platformFanId), { sublabel: handleOf(row.username) }));
      }
      const fromHub = (source: PaletteSource<PaletteFanRow> | null, name: 'spenders' | 'newcomers', where: string): void => {
        if (source === null) return;
        if (!source.ok) {
          gaps.push({ kind: 'source-failed', source: name, code: source.code });
          return;
        }
        hubSearched = true;
        hubFans += source.rows.length;
        for (const row of source.rows) {
          if (seen.has(row.fanRef)) continue;
          seen.add(row.fanRef);
          // Not in ChatSpace's loaded list: the row says where it was found.
          const handle = handleOf(row.username);
          rows.push(item(`chat.${row.fanRef}`, fanName(row), chatAction(row.fanRef), { sublabel: handle === null ? where : `${handle} · ${where}`, money: row.lifetimeMills }));
        }
      };
      fromHub(cache?.spenders?.source ?? null, 'spenders', i18n.t('palette.item.spenders'));
      fromHub(cache?.newcomers?.source ?? null, 'newcomers', i18n.t('palette.item.newcomers'));
      const found = filter(rows, withSublabel, PALETTE_LIMITS.chats);
      if (found.length > 0) groups.push({ id: 'chats', title: { key: 'palette.group.chats' }, items: found });
    }

    // ── fans ChatSpace itself shows online → our preview (CS-030) ──
    if (deps.preview !== undefined && account !== null) {
      const online = onlineChats(hostChats).map((row) =>
        item(`online.${row.chat.platformFanId}`, fanName({ name: row.displayName, username: row.username }), { type: 'OpenPreview', targetHandle: chatHandle(row.chat) }, { sublabel: handleOf(row.username) }),
      );
      const shown = filter(online, withSublabel, PALETTE_LIMITS.online);
      if (shown.length > 0) groups.push({ id: 'online', title: { key: 'palette.group.online' }, items: shown });
    }

    // ── other accounts ChatSpace has loaded (Б13): a switch only on this click ──
    const others = snapshot.accounts
      .filter((other) => other.hostAccountId !== account?.hostAccountId)
      .map((other) =>
        item(`account.${other.hostAccountId}`, other.displayName ?? (other.username === null ? other.hostAccountId : `@${other.username}`), { type: 'Navigate', to: { kind: 'account', accountHandle: accountHandle(other.hostAccountId) } }, {
          sublabel: other.displayName === null ? null : handleOf(other.username),
        }),
      );
    const accounts = searching ? filter(others, withSublabel, PALETTE_LIMITS.accounts) : others.slice(0, PALETTE_LIMITS.accounts);
    if (accounts.length > 0) groups.push({ id: 'accounts', title: { key: 'palette.group.accounts' }, items: accounts });

    const loading = cache !== null && ((cache.waitingLoading && cache.waiting === null) || (searching && cache.fansLoading && cache.spenders === null));
    const view: VmView =
      groups.length === 0
        ? loading
          ? { s: 'loading', since: null, stage: null }
          : { s: 'empty', why: { key: 'palette.empty' } }
        : gaps.length > 0
          ? { s: 'partial', gaps }
          : { s: 'ready' };
    return {
      view,
      query,
      groups,
      // Where the chats were looked for: the hub rows too, or only what ChatSpace has loaded.
      footer: hubSearched ? { key: 'palette.foot.chats', params: { n: hubFans } } : { key: 'palette.foot.hostOnly' },
    };
  };

  const snapshotView = (): PaletteVM => {
    if (cached === null || cached.version !== changes.version) cached = { version: changes.version, view: build() };
    return cached.view;
  };

  // ── what moves the view ──

  let disposed = false;
  let settleTimer: unknown = null;
  /** The look that just ran started the host port's read of ChatSpace's list; the next one shows what it brought. */
  const lookAgain = (): void => {
    if (settleTimer !== null) deps.clock.clearTimer(settleTimer);
    settleTimer = deps.clock.setTimer(LIST_SETTLE_MS, () => {
      settleTimer = null;
      if (!disposed && overlays.isOpen('palette')) changes.emit();
    });
  };

  const subscriptions = [
    overlays.subscribe(() => {
      const open = overlays.isOpen('palette');
      if (open === wasOpen) {
        if (open) changes.emit();
        return;
      }
      wasOpen = open;
      // A closed palette forgets its query: the next ⌘K starts clean.
      if (!open) query = '';
      else {
        refreshHub();
        refreshRunning();
      }
      changes.emit();
      if (open) lookAgain();
    }),
    deps.dock.subscribe(() => overlays.isOpen('palette') && changes.emit()),
    host.subscribe((event) => {
      if (overlays.isOpen('palette') && (event.type === 'route' || event.type === 'accounts')) {
        refreshHub();
        changes.emit();
        // Another account on screen: its list is read now, and shown once the read is in.
        lookAgain();
      }
    }),
    deps.rpc.onEvent('op.done', () => overlays.isOpen('palette') && refreshRunning()),
    i18n.subscribe(() => changes.emit()),
  ];

  const dispatch = (action: UiAction): Promise<ActionReceipt> | null => {
    if (action.type === 'Search' && action.list === 'palette') {
      if (action.query !== query) {
        query = action.query;
        refreshHub();
        changes.emit();
      }
      return Promise.resolve({ ok: true, type: 'Search', outcome: 'done' });
    }
    // An online fan's row opens OUR preview (the chat stays unread), through the preview's own controller.
    if (action.type === 'OpenPreview' && deps.preview !== undefined) {
      const chat = parseChatHandle(action.targetHandle);
      if (chat === null) return null;
      return deps.preview.open({ host: host.kind, ...chat }).then((receipt) => {
        if (receipt.ok) overlays.set('palette', false);
        return receipt;
      });
    }
    return null;
  };

  return {
    kinds: ['palette'],
    getSnapshot: (selector: ViewSelector) => (selector.of === 'palette' ? snapshotView() : undefined),
    subscribe(selector, listener) {
      if (selector.of !== 'palette') return () => undefined;
      return changes.on(() => listener(snapshotView()));
    },
    dispatch,
    dispose() {
      disposed = true;
      if (settleTimer !== null) deps.clock.clearTimer(settleTimer);
      settleTimer = null;
      for (const unsubscribe of subscriptions) unsubscribe();
    },
  };
}
