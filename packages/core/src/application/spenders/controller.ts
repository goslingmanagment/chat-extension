// The Spenders board and its statistics as a surface controller
// (architecture.md §8.5, §8.7, §10.2 SpendersBoardVM / SpendersStatsVM;
// SP-002…SP-049). The board is the background's assembled ranking (up to
// 1000 rows with the hub's tier buckets); statistics and the «ждут ответа»
// queue are the hub's own numbers over the whole page. The ranking shows
// before the statistics, a failed read is an error card and never an empty
// list, a cut or incomplete list says so, and every number carries its
// coverage and data time. A change of the sign-in, the hub or the account
// closes the board and drops everything it held (SP-042).

import { type CgErrorWire } from '@cg/contracts/errors';
import { type QueuePage, type SpendersStats } from '@cg/contracts/hub';
import { CHAT_IS_FAN } from '@cg/contracts/ids';
import { type ActionReceipt, type I18n, type PartialGap, type PreviewSource, type ShelfVM, type SpenderRowVM, type SpendersBoardVM, type SpendersFilter, type SpendersPeriod, type SpendersSort, type SpendersStatsVM, type TargetHandle, type UiAction, type ViewMap, type VmView } from '@cg/contracts/vm';
import { type I18nKey } from '@cg/contracts/errors';

import { boardFilterCounts, indexBoard, neighbours, shelfOfFan, viewBoard, type BoardIndex, type BoardView } from '../../domain/spenders/board';
import { NO_FILTERS, filterPressed, filtersActive, pressFilter, type BoardFilters } from '../../domain/spenders/filters';
import { moveRow, type BoardCommand } from '../../domain/spenders/keyboard';
import { EMPTY_QUEUE, appendQueuePage, queueHasMore, queueRow, type QueueState } from '../../domain/spenders/queue';
import { type SpenderRow } from '../../domain/spenders/rows';
import { statsModel, type StatsModel } from '../../domain/spenders/stats';
import { type PageContextPort, type PageContextState, flagFailure, pageFlag } from '../boards/context';
import { fanHandle, parseFanHandle } from '../boards/handles';
import { type ChatNavigator } from '../boards/navigate';
import { type BoardsClock, type TabRpc } from '../boards/ports';
import { type PreviewDirectory, type PreviewTargetInfo, type Surfaces } from '../boards/shared';
import { ViewCell, done, refused, type SurfaceController } from '../boards/surface';
import { button, dataView, errorOf, failureClass, failureView, loadingView, localError, localKey, msg, stamp } from '../boards/views';

/** The search waits this long after the last keystroke (SP-019). */
export const SEARCH_DEBOUNCE_MS = 150;
/** The tab reads the board again after this long (the background keeps its own 10-minute cache, SP-026). */
export const BOARD_FRESH_MS = 10 * 60_000;
/** Statistics are the hub's 60-second cache (H-8). */
export const STATS_FRESH_MS = 60_000;
/** The «ждут ответа» queue, a page at a time. */
export const QUEUE_PAGE_SIZE = 100;

const PERIODS = ['lifetime', '30d', 'mtd', '7d', 'today'] as const satisfies readonly SpendersPeriod[];
const FILTERS = ['all', 'waiting', 'new', 'we-wrote', 'fan-wrote', 'history', 'no-history'] as const satisfies readonly SpendersFilter[];
const FILTER_LABELS: Readonly<Record<SpendersFilter, I18nKey>> = {
  all: 'spenders.filter.all',
  waiting: 'spenders.filter.waiting',
  new: 'spenders.filter.new',
  'we-wrote': 'spenders.filter.weWrote',
  'fan-wrote': 'spenders.filter.fanWrote',
  history: 'spenders.filter.history',
  'no-history': 'spenders.filter.noHistory',
};
const BOARD_SELECTOR = { of: 'spenders.board' } as const;
const STATS_SELECTOR = { of: 'spenders.stats' } as const;

interface BoardEntry {
  index: BoardIndex | null;
  loading: boolean;
  error: CgErrorWire | null;
  /** When the rows on screen were read (local clock). */
  loadedAt: number | null;
  /** When the running read started. */
  since: number | null;
  run: number;
}

interface StatsEntry {
  raw: SpendersStats | null;
  loading: boolean;
  error: CgErrorWire | null;
  loadedAt: number | null;
  since: number | null;
  run: number;
}

interface QueueEntry {
  state: QueueState;
  loading: boolean;
  error: CgErrorWire | null;
  run: number;
  /** This walk already started over once because the hub no longer took its cursor: a second refusal is an error, not a loop. */
  cursorRestarted?: boolean;
}

export interface SpendersControllerDeps {
  readonly rpc: TabRpc;
  readonly i18n: I18n;
  readonly clock: BoardsClock;
  readonly context: PageContextPort;
  readonly surfaces: Surfaces;
  readonly navigator: ChatNavigator;
  /** IANA zone of the statistics' calendar (the chatter's own). */
  readonly timeZone: string;
  /** Rows of one «ждут ответа» page (QUEUE_PAGE_SIZE by default). */
  readonly queuePageSize?: number;
}

type BoardViews = 'spenders.board' | 'spenders.stats';

export interface SpendersController extends SurfaceController<BoardViews> {
  /** The board or its statistics, typed by the selector. */
  getSnapshot<K extends BoardViews>(selector: { readonly of: K }): ViewMap[K];
  subscribe<K extends BoardViews>(selector: { readonly of: K }, listener: (view: ViewMap[K]) => void): () => void;
  /** Who a `spenders:` handle is, and its neighbours in the visible order. */
  readonly directory: PreviewDirectory;
  /** The loaded row of a fan of this page, if the board has one (the fan panel reads its retention and archive coverage). */
  row(pageId: number, fanRef: string): SpenderRow | null;
  /**
   * What a board key does (SP-033): an action to dispatch, the row the focus
   * moves to, the search field to focus, or nothing. `focused` — the row
   * under the keyboard focus.
   */
  command(command: BoardCommand, focused: TargetHandle | null): { readonly action: UiAction } | { readonly focusRow: TargetHandle } | { readonly focusSearch: true } | null;
}

export function createSpendersController(deps: SpendersControllerDeps): SpendersController {
  const { rpc, i18n, clock, context, surfaces, navigator } = deps;

  let period: SpendersPeriod = '30d';
  let filters: BoardFilters = NO_FILTERS;
  let sort: SpendersSort = 'sum';
  /** What the person typed, and what the list is filtered by after the debounce. */
  let typed = '';
  let applied = '';
  let searchTimer: number | null = null;
  let revealed = new Set<string>();
  let statsExpanded = false;
  let boards = new Map<SpendersPeriod, BoardEntry>();
  let statsEntry: StatsEntry = { raw: null, loading: false, error: null, loadedAt: null, since: null, run: 0 };
  let queue: QueueEntry = { state: EMPTY_QUEUE, loading: false, error: null, run: 0 };
  let epoch = context.current().epoch;
  /** The visible list, kept while what it was computed from is the same (by identity: every change replaces its object). */
  let viewCache: { readonly index: BoardIndex; readonly queue: QueueState | null; readonly applied: string; readonly filters: BoardFilters; readonly sort: SpendersSort; readonly revealed: ReadonlySet<string>; readonly view: BoardView } | null = null;
  /** Row view models of the visible list: rebuilt only when the list or the selection changes, not on every keystroke. */
  let shelfCache: { readonly view: BoardView; readonly selected: string | null; readonly pageId: number | null; readonly shelves: ShelfVM[] } | null = null;
  let disposed = false;
  const directoryListeners = new Set<() => void>();

  const entryOf = (p: SpendersPeriod): BoardEntry => {
    let entry = boards.get(p);
    if (entry === undefined) {
      entry = { index: null, loading: false, error: null, loadedAt: null, since: null, run: 0 };
      boards.set(p, entry);
    }
    return entry;
  };

  const pageId = (): number | null => context.current().binding?.pageId ?? null;
  const handleOf = (fanRef: string): TargetHandle => fanHandle('spenders', pageId() ?? 0, fanRef);
  const selectedFan = (): string | null => {
    const handle = surfaces.current().preview.spenders;
    const parsed = handle === null ? null : parseFanHandle(handle);
    return parsed !== null && parsed.pageId === pageId() ? parsed.fanRef : null;
  };

  /** «Ждут ответа» is served by the hub's queue when the statistics are on for the page. */
  const queueMode = (): boolean => filters.main === 'waiting' && pageFlag(context.current(), 'stats') && queue.error === null && queue.state.total !== null;

  // ── the visible list ──

  function currentView(): { readonly index: BoardIndex; readonly view: BoardView; readonly sourced: boolean } | null {
    const index = entryOf(period).index;
    if (index === null) return null;
    const sourced = queueMode();
    const from = sourced ? queue.state : null;
    const cached = viewCache;
    if (cached !== null && cached.index === index && cached.queue === from && cached.applied === applied && cached.filters === filters && cached.sort === sort && cached.revealed === revealed) {
      return { index, view: cached.view, sourced };
    }
    const query = { query: applied, filters, sort, revealed };
    const view = from === null ? viewBoard(index, query) : viewBoard(index, query, from.items.map((item, rank) => queueRow(item, rank, index.byFan.get(item.fanRef), index.period)));
    viewCache = { index, queue: from, applied, filters, sort, revealed, view };
    return { index, view, sourced };
  }

  // ── view models ──

  function contextView(ctx: PageContextState, flag: 'spenders' | 'stats', retry: UiAction): VmView | null {
    if (ctx.phase === 'loading') return loadingView(null);
    if (ctx.phase === 'blocked') return failureView(ctx.blocker ?? { code: 'CG-UNKNOWN' }, i18n, retry);
    if (!pageFlag(ctx, flag)) return failureView(flagFailure(ctx, flag), i18n, retry);
    return null;
  }

  function rowVM(row: SpenderRow, cents: boolean, selected: string | null): SpenderRowVM {
    const base: SpenderRowVM = {
      handle: handleOf(row.fanRef),
      name: row.name,
      username: row.username,
      lifetime: row.lifetime,
      period: row.period,
      isNew: row.isNew,
      deleted: row.deleted,
      weWroteAt: row.weWroteAt,
      fanWroteAt: row.fanWroteAt,
      waiting: row.waiting,
      lastMessage: row.lastMessage,
      selected: row.fanRef === selected,
    };
    return cents ? { ...base, lifetimeCents: true } : base;
  }

  const boardRetry: UiAction = { type: 'ReloadView', selector: BOARD_SELECTOR };
  const statsRetry: UiAction = { type: 'ReloadView', selector: STATS_SELECTOR };

  function buildBoard(): SpendersBoardVM {
    const ctx = context.current();
    const entry = entryOf(period);
    const current = currentView();
    const selected = selectedFan();
    const narrowed = applied.trim().length > 0 || filtersActive(filters);

    const counts = current === null ? null : boardFilterCounts(current.index, FILTERS);
    const waitingTotal = pageFlag(ctx, 'stats') ? (queue.state.total ?? statsEntry.raw?.queueSummary.total ?? null) : null;
    const filterVMs = FILTERS.map((id) => ({
      id,
      label: msg(FILTER_LABELS[id]),
      // «Ждут ответа» is the hub's count over the whole page when it gave one; the rest count loaded rows.
      count: counts === null ? null : id === 'waiting' && waitingTotal !== null ? waitingTotal : id === 'all' ? current?.index.loaded ?? null : counts[id],
      pressed: filterPressed(filters, id),
    }));

    let shelves: ShelfVM[] = [];
    if (current !== null) {
      const id = pageId();
      if (shelfCache === null || shelfCache.view !== current.view || shelfCache.selected !== selected || shelfCache.pageId !== id) {
        shelfCache = {
          view: current.view,
          selected,
          pageId: id,
          shelves: current.view.shelves.map((shelf) => ({
            id: shelf.id,
            range: shelf.range,
            fans: shelf.totals.fans,
            lifetime: shelf.totals.lifetime,
            period: shelf.totals.period,
            rows: shelf.rows.map((row) => rowVM(row, shelf.cents.has(row.fanRef), selected)),
            collapsed: shelf.hidden > 0 ? { hidden: shelf.hidden, reveal: button(msg('spenders.shelfMore', { n: shelf.hidden }), { type: 'RevealShelf', shelfId: shelf.id }) } : null,
          })),
        };
      }
      shelves = shelfCache.shelves;
    }

    let view: VmView;
    const blocked = contextView(ctx, 'spenders', boardRetry);
    if (blocked !== null) view = blocked;
    else if (current === null) {
      view = entry.error !== null ? failureView(entry.error, i18n, boardRetry) : loadingView(entry.since);
    } else {
      const { index } = current;
      const gaps: PartialGap[] = [];
      if (current.sourced ? queue.state.truncated : index.truncated) gaps.push({ kind: 'truncated', shown: current.sourced ? queue.state.items.length : index.loaded, total: current.sourced ? queue.state.total : index.total });
      if (!index.complete) gaps.push({ kind: 'coverage', level: 'partial' });
      if (index.tiers === null) gaps.push({ kind: 'source-failed', source: 'tiers', code: 'CG-DATA-PARTIAL' });
      if (filters.main === 'waiting' && queue.error !== null) gaps.push({ kind: 'source-failed', source: 'queue', code: queue.error.code });
      if (entry.loading) gaps.push({ kind: 'stale-cache', asOf: index.asOf });
      if (entry.error !== null) {
        // The rows on screen are the last good read; the failed refresh is named, not hidden.
        view = failureClass(entry.error.code) === 'error' ? dataView([...gaps, { kind: 'source-failed', source: 'board', code: entry.error.code }]) : failureView(entry.error, i18n, boardRetry, entry.loadedAt);
      } else if (index.loaded === 0) view = { s: 'empty', why: msg('common.empty') };
      else if (shelves.length === 0) view = { s: 'empty', why: msg('spenders.empty') };
      else view = dataView(gaps);
    }

    const index = current?.index ?? null;
    const sourced = current?.sourced ?? false;
    // «Ждут ответа» is the hub's queue over the whole page (SP-047). When its read failed the rows on screen are this
    // tab's own filter over what the board has loaded — a fallback the board must name, with the read's own error
    // and «Повторить» (ER-025: a failed read is never passed off as a list), not a list that only looks like the queue.
    const queueFailed = current !== null && blocked === null && filters.main === 'waiting' && pageFlag(ctx, 'stats') && queue.error !== null ? queue.error : null;
    return {
      view,
      pageName: ctx.page?.title ?? null,
      period,
      periods: PERIODS,
      query: typed,
      filters: filterVMs,
      sort,
      shelves,
      footer: {
        loaded: sourced ? queue.state.items.length : (index?.loaded ?? 0),
        total: sourced ? queue.state.total : (index?.total ?? null),
        shown: current?.view.shown ?? null,
        stamp: stamp(sourced ? (queue.state.asOf ?? index?.asOf ?? null) : (index?.asOf ?? index?.fetchedAt ?? null), index?.coverage ?? 'unknown'),
      },
      canLoadMore: sourced && queueHasMore(queue.state) && !queue.loading,
      reset: narrowed ? button('spenders.resetFilters', { type: 'ResetFilters', list: 'spenders' }) : null,
      previewOpen: surfaces.current().preview.spenders !== null,
      keys: [
        { label: msg('spenders.keys.row'), hotkey: localKey('J / K', 'J K') },
        { label: msg('preview.label'), hotkey: localKey('Space', 'Space') },
        { label: msg('common.openChat'), hotkey: localKey('O', 'O') },
        { label: msg('stats.title'), hotkey: localKey('S', 'S') },
        { label: msg('cheatsheet.row.search'), hotkey: localKey('/', '/') },
        { label: msg('common.close'), hotkey: localKey('Esc', 'Escape') },
      ],
      waitingFallback: queueFailed === null ? null : { error: errorOf(queueFailed, i18n), retry: boardRetry },
    };
  }

  function buildStats(): SpendersStatsVM {
    const ctx = context.current();
    const index = entryOf('30d').index ?? entryOf(period).index;
    // Lifetime sums of shelves the board can vouch for (it holds the whole shelf); the statistics carry none.
    const lifetimeByShelf = new Map<string, number | null>();
    if (index !== null) {
      for (const shelf of viewBoard(index, { query: '', filters: NO_FILTERS, sort: 'sum', revealed: new Set() }).shelves) lifetimeByShelf.set(shelf.id, shelf.totals.lifetime);
    }
    const model: StatsModel | null = statsEntry.raw === null ? null : statsModel(statsEntry.raw, lifetimeByShelf);

    let view: VmView;
    const blocked = contextView(ctx, 'stats', statsRetry);
    if (blocked !== null) view = blocked;
    else if (model === null) view = statsEntry.error !== null ? failureView(statsEntry.error, i18n, statsRetry) : loadingView(statsEntry.since);
    else {
      const gaps: PartialGap[] = [];
      if (model.coverage !== 'complete') gaps.push({ kind: 'coverage', level: model.coverage });
      if (statsEntry.loading) gaps.push({ kind: 'stale-cache', asOf: model.asOf });
      if (statsEntry.error !== null) {
        view = failureClass(statsEntry.error.code) === 'error' ? dataView([...gaps, { kind: 'source-failed', source: 'stats', code: statsEntry.error.code }]) : failureView(statsEntry.error, i18n, statsRetry, statsEntry.loadedAt);
      } else view = dataView(gaps);
    }

    const s = stamp(model?.asOf ?? null, model?.coverage ?? 'unknown');
    const money = (mills: number | null) => ({ mills, stamp: s });
    const count = (n: number | null) => ({ count: n, stamp: s });
    return {
      view,
      expanded: statsExpanded,
      windowDays: model?.windowDays ?? 30,
      timeZone: model?.timeZone ?? null,
      days: model?.days ?? [],
      today: money(model?.today ?? null),
      d7: { ...money(model?.d7 ?? null), changePct: model?.changePct ?? null, prev7: model?.prev7 ?? null },
      d30: { ...money(model?.d30 ?? null), purchases: model?.purchases ?? null },
      payers: count(model?.payers ?? null),
      avgCheck: money(model?.avgCheck ?? null),
      shelves: model?.shelves ?? [],
      attention: {
        awaiting: count(model?.awaiting ?? null),
        // §8.7: «ждёт ответа; прочтение неизвестно» is a category of its own, as the hub counts it.
        awaitingUnknown: count(model?.awaitingUnknown ?? null),
        newPayers: { ...count(model?.newPayers ?? null), firstObserved: model?.newPayersFirstObserved ?? false },
        silent8to21: count(model?.silent8to21 ?? null),
        // SP-046: what the fans silent for more than 21 days spent in all, as the hub sums it.
        silentOver21: { ...count(model?.silentOver21 ?? null), lifetime: model?.silentOver21Lifetime ?? null },
        noData: count(model?.noData ?? null),
      },
      stamp: s,
    };
  }

  const boardCell = new ViewCell(buildBoard);
  const statsCell = new ViewCell(buildStats);

  const changed = (what: 'board' | 'stats' | 'both' = 'both'): void => {
    if (disposed) return;
    if (what !== 'stats') boardCell.invalidate();
    if (what !== 'board') statsCell.invalidate();
    if (what !== 'stats') for (const listener of [...directoryListeners]) listener();
  };

  // ── reads ──

  const usable = (flag: 'spenders' | 'stats'): boolean => {
    const ctx = context.current();
    return ctx.phase === 'ready' && pageFlag(ctx, flag);
  };

  async function loadBoard(force: boolean): Promise<void> {
    const id = pageId();
    if (id === null || !usable('spenders')) return;
    const forPeriod = period;
    const entry = entryOf(forPeriod);
    const atEpoch = epoch;
    const run = ++entry.run;
    entry.loading = true;
    entry.since = clock.now();
    changed('board');
    const answer = await rpc.request('spenders.board', force ? { pageId: id, period: forPeriod, force: true } : { pageId: id, period: forPeriod });
    // The identity changed, or a newer read of this period started: this answer is nobody's.
    if (disposed || atEpoch !== epoch || entryOf(forPeriod).run !== run) return;
    entry.loading = false;
    entry.since = null;
    if (answer.ok) {
      entry.index = indexBoard(answer.payload);
      entry.error = null;
      entry.loadedAt = clock.now();
    } else entry.error = answer.error;
    changed();
  }

  async function loadStats(force: boolean): Promise<void> {
    const id = pageId();
    if (id === null || !usable('stats')) return;
    if (!force && statsEntry.loading) return;
    const atEpoch = epoch;
    const run = ++statsEntry.run;
    statsEntry.loading = true;
    statsEntry.since = clock.now();
    changed('stats');
    const answer = await rpc.request('spenders.stats', { pageId: id, windowDays: 30, timeZone: deps.timeZone });
    if (disposed || atEpoch !== epoch || statsEntry.run !== run) return;
    statsEntry.loading = false;
    statsEntry.since = null;
    if (answer.ok) {
      statsEntry.raw = answer.payload;
      statsEntry.error = null;
      statsEntry.loadedAt = clock.now();
    } else statsEntry.error = answer.error;
    changed();
  }

  /**
   * One page of «ждут ответа»: the first (a new walk) or the one behind the cursor. `afterCursorRefusal` — the walk
   * starts over because the hub refused its cursor: that happens once per walk.
   */
  async function loadQueue(restart: boolean, afterCursorRefusal = false): Promise<void> {
    const id = pageId();
    if (id === null || !usable('stats')) return;
    if (queue.loading && !restart) return;
    // A walk that starts over after a failed read keeps saying so until this read answers: the list on screen is
    // still the local fallback, and its notice must not blink away for the time of the request.
    if (restart) queue = { state: EMPTY_QUEUE, loading: false, error: queue.error, run: queue.run, cursorRestarted: afterCursorRefusal };
    const cursor = restart ? null : queue.state.nextCursor;
    if (!restart && cursor === null) return;
    const atEpoch = epoch;
    const run = ++queue.run;
    queue.loading = true;
    changed('board');
    const answer = await rpc.request('spenders.queue', { pageId: id, cursor, limit: deps.queuePageSize ?? QUEUE_PAGE_SIZE });
    if (disposed || atEpoch !== epoch || queue.run !== run) return;
    queue.loading = false;
    if (answer.ok) {
      const page: QueuePage = answer.payload;
      queue.state = appendQueuePage(queue.state, cursor, page);
      queue.error = null;
    } else if (cursor !== null && answer.error.code === 'CG-HUB-REQUEST' && queue.cursorRestarted !== true) {
      // The hub no longer takes the cursor (400 `bad_request` · `cursor_invalid`: the queue was rebuilt under the walk).
      // Nothing is wrong with the list itself: the walk starts over from the first page — once. A second refusal
      // of the same walk is an error like any other, never a loop of requests.
      return loadQueue(true, true);
    } else queue.error = answer.error;
    changed('board');
  }

  const fresh = (loadedAt: number | null, ms: number): boolean => loadedAt !== null && clock.now() - loadedAt < ms;

  /** Reads what the open board is missing or shows too old. */
  function ensure(): void {
    if (!surfaces.current().spenders || context.current().phase !== 'ready') return;
    const entry = entryOf(period);
    if (!entry.loading && (entry.index === null ? entry.error === null : !fresh(entry.loadedAt, BOARD_FRESH_MS) && entry.error === null)) void loadBoard(false);
    if (!statsEntry.loading && statsEntry.error === null && !fresh(statsEntry.loadedAt, STATS_FRESH_MS)) void loadStats(false);
    if (filters.main === 'waiting' && queue.state.total === null && !queue.loading && queue.error === null) void loadQueue(true);
  }

  function reset(): void {
    boards = new Map();
    statsEntry = { raw: null, loading: false, error: null, loadedAt: null, since: null, run: statsEntry.run + 1 };
    queue = { state: EMPTY_QUEUE, loading: false, error: null, run: queue.run + 1 };
    filters = NO_FILTERS;
    sort = 'sum';
    typed = '';
    applied = '';
    revealed = new Set();
    statsExpanded = false;
    viewCache = null;
    shelfCache = null;
    if (searchTimer !== null) clock.clearTimer(searchTimer);
    searchTimer = null;
  }

  const offContext = context.subscribe((state) => {
    if (state.epoch !== epoch) {
      // SP-042: another sign-in, hub or account — the board closes and nothing of the old identity stays.
      epoch = state.epoch;
      reset();
      surfaces.setList('spenders', false);
    }
    changed();
    ensure();
  });
  const offSurfaces = surfaces.subscribe((state, previous) => {
    if (state.spenders && !previous.spenders) ensure();
    if (!state.spenders && previous.spenders && searchTimer !== null) {
      clock.clearTimer(searchTimer);
      searchTimer = null;
      applied = typed;
    }
    if (state.spenders !== previous.spenders || state.preview.spenders !== previous.preview.spenders) changed('board');
  });
  const offLanguage = i18n.subscribe(() => changed());

  // ── directory ──

  /**
   * R20 P8a (FS-IDN-6): the fan's conversation as the board knows it — the hub's chat of the fan where a chat has an
   * id of its own (Fansly: the group of the row); `{}` where a chat is its fan (OnlyFans: the fan is the conversation,
   * as before) and where the hub knows none: a preview then asks nothing of that chat, and the chat is not opened.
   */
  const conversationOfRow = (row: SpenderRow | undefined): { readonly conversationRef?: string } => {
    const platform = context.current().binding?.platform;
    const ref = row?.conversationRef ?? null;
    return platform === undefined || CHAT_IS_FAN[platform] || ref === null ? {} : { conversationRef: ref };
  };

  const infoOf = (fanRef: string, id: number): PreviewTargetInfo | null => {
    const index = entryOf(period).index;
    const row = index?.byFan.get(fanRef);
    if (row !== undefined && index !== undefined && index !== null) {
      return {
        handle: fanHandle('spenders', id, fanRef),
        source: 'spenders',
        pageId: id,
        fanRef,
        ...conversationOfRow(row),
        name: row.name,
        username: row.username,
        lifetime: row.lifetime,
        period30: index.period === '30d' ? row.period : null,
        weWroteAt: row.weWroteAt,
        fanWroteAt: row.fanWroteAt,
        newcomer: null,
      };
    }
    const queued = queue.state.items.find((item) => item.fanRef === fanRef);
    if (queued === undefined || index === null || index === undefined) return null;
    const asRow = queueRow(queued, 0, undefined, index.period);
    return {
      handle: fanHandle('spenders', id, fanRef),
      source: 'spenders',
      pageId: id,
      fanRef,
      name: asRow.name,
      username: asRow.username,
      lifetime: asRow.lifetime,
      period30: null,
      weWroteAt: asRow.weWroteAt,
      fanWroteAt: asRow.fanWroteAt,
      newcomer: null,
    };
  };

  const directory: PreviewDirectory = {
    resolve(handle) {
      const parsed = parseFanHandle(handle);
      const id = pageId();
      if (parsed === null || parsed.source !== 'spenders' || id === null || parsed.pageId !== id) return null;
      return infoOf(parsed.fanRef, id);
    },
    neighbours(handle) {
      const parsed = parseFanHandle(handle);
      const current = currentView();
      if (parsed === null || current === null) return { previous: null, next: null };
      const around = neighbours(current.view.order, parsed.fanRef);
      return { previous: around.previous === null ? null : handleOf(around.previous), next: around.next === null ? null : handleOf(around.next) };
    },
    subscribe(listener) {
      directoryListeners.add(listener);
      return () => {
        directoryListeners.delete(listener);
      };
    },
  };

  // ── actions ──

  function applySearch(): void {
    searchTimer = null;
    if (applied === typed) return;
    applied = typed;
    changed('board');
  }

  const own = (handle: TargetHandle, source: PreviewSource = 'spenders'): string | null => {
    const parsed = parseFanHandle(handle);
    return parsed !== null && parsed.source === source && parsed.pageId === pageId() ? parsed.fanRef : null;
  };

  async function openChat(type: UiAction['type'], fanRef: string): Promise<ActionReceipt> {
    const binding = context.current().binding;
    if (binding === null) return refused(type, localError('CG-BINDING-MISSING', i18n));
    // R20 P8a: the fan's chat as the board knows it; where a chat has an id of its own, the fan's id opens none.
    const { conversationRef } = conversationOfRow(entryOf(period).index?.byFan.get(fanRef));
    if (conversationRef === undefined && !CHAT_IS_FAN[binding.platform]) return refused(type, localError('CG-DATA-NOT-READY', i18n));
    // The person's click on this fan in the Spenders board: the board's own switch on its page, not `navigation`.
    const receipt = await navigator.open({ host: binding.host, hostAccountId: binding.hostAccountId, platformFanId: fanRef }, 'preview', ['spenders'], conversationRef);
    if (receipt.state === 'failed') return refused(type, localError(receipt.code, i18n));
    // SP-035: the chat opened — the board gets out of the way.
    surfaces.closeBoards();
    return done(type, 'opened');
  }

  function dispatch(action: UiAction): Promise<ActionReceipt> | null {
    if (action.type === 'Navigate') {
      const to = action.to;
      if (to.kind === 'surface' && to.surface === 'spenders') {
        surfaces.setList('spenders', to.open);
        return Promise.resolve(done(action.type, to.open ? 'opened' : 'done'));
      }
      if (to.kind === 'chat') {
        const fanRef = own(to.targetHandle);
        return fanRef === null ? null : openChat(action.type, fanRef);
      }
      return null;
    }
    if (action.type === 'SetSpendersPeriod') {
      if (action.period !== period) {
        period = action.period;
        revealed = new Set();
        changed('board');
        ensure();
      }
      return Promise.resolve(done(action.type));
    }
    if (action.type === 'SetSpendersFilter') {
      const next = pressFilter(filters, action.filter);
      const waitingOn = next.main === 'waiting' && filters.main !== 'waiting';
      filters = next;
      changed('board');
      if (waitingOn && usable('stats')) void loadQueue(true);
      return Promise.resolve(done(action.type));
    }
    if (action.type === 'SetSpendersSort') {
      if (action.sort !== sort) {
        sort = action.sort;
        changed('board');
      }
      return Promise.resolve(done(action.type));
    }
    if (action.type === 'ResetFilters') {
      if (action.list !== 'spenders') return null;
      filters = NO_FILTERS;
      typed = '';
      applied = '';
      if (searchTimer !== null) clock.clearTimer(searchTimer);
      searchTimer = null;
      changed('board');
      return Promise.resolve(done(action.type));
    }
    if (action.type === 'Search') {
      if (action.list !== 'spenders') return null;
      // The field shows what was typed at once (an IME's composition is never fought); the list follows after the pause.
      typed = action.query;
      if (searchTimer !== null) clock.clearTimer(searchTimer);
      searchTimer = clock.setTimer(SEARCH_DEBOUNCE_MS, applySearch);
      boardCell.invalidate();
      return Promise.resolve(done(action.type));
    }
    if (action.type === 'RevealShelf') {
      const known = entryOf(period).index?.shelves.some((shelf) => shelf.id === action.shelfId) ?? false;
      if (!known) return Promise.resolve(done(action.type, 'noop'));
      revealed = new Set(revealed).add(action.shelfId);
      changed('board');
      return Promise.resolve(done(action.type));
    }
    if (action.type === 'LoadMore') {
      if (action.list !== 'spenders') return null;
      if (!queueMode() || !queueHasMore(queue.state)) return Promise.resolve(done(action.type, 'noop'));
      return loadQueue(false).then(() => done(action.type));
    }
    if (action.type === 'SetStatsExpanded') {
      if (statsExpanded !== action.expanded) {
        statsExpanded = action.expanded;
        changed('stats');
      }
      return Promise.resolve(done(action.type));
    }
    if (action.type === 'ReloadView') {
      const of = action.selector.of;
      if (of !== 'spenders.board' && of !== 'spenders.stats') return null;
      // SP-024: a free re-read past the caches; a blocked page is asked for its identity again first.
      const reads = context.current().phase === 'ready' ? Promise.resolve() : context.refresh();
      return reads.then(async () => {
        if (of === 'spenders.board') {
          const waiting = filters.main === 'waiting';
          await Promise.all([loadBoard(true), waiting ? loadQueue(true) : Promise.resolve()]);
        } else await loadStats(true);
        return done(action.type);
      });
    }
    return null;
  }

  return {
    kinds: ['spenders.board', 'spenders.stats'],
    getSnapshot<K extends BoardViews>(selector: { readonly of: K }): ViewMap[K] {
      const of: BoardViews = selector.of;
      return (of === 'spenders.board' ? boardCell.get() : statsCell.get()) as ViewMap[K];
    },
    subscribe<K extends BoardViews>(selector: { readonly of: K }, listener: (view: ViewMap[K]) => void): () => void {
      const of: BoardViews = selector.of;
      return of === 'spenders.board' ? boardCell.subscribe(listener as (view: SpendersBoardVM) => void) : statsCell.subscribe(listener as (view: SpendersStatsVM) => void);
    },
    dispatch,
    directory,
    row(id, fanRef) {
      if (id !== pageId()) return null;
      for (const entry of boards.values()) {
        const row = entry.index?.byFan.get(fanRef);
        if (row !== undefined) return row;
      }
      return null;
    },
    command(command, focused) {
      const current = currentView();
      const order = current?.view.order ?? [];
      const focusedFan = focused === null ? null : own(focused);
      const selected = selectedFan();
      switch (command) {
        case 'row-next':
        case 'row-previous': {
          const to = moveRow(order, focusedFan, command === 'row-next' ? 'next' : 'previous');
          return to === null ? null : { focusRow: handleOf(to) };
        }
        case 'open-chat':
          return focusedFan === null ? null : { action: { type: 'Navigate', to: { kind: 'chat', targetHandle: handleOf(focusedFan) } } };
        case 'preview':
          return focusedFan === null ? null : { action: { type: 'OpenPreview', targetHandle: handleOf(focusedFan) } };
        case 'toggle-stats':
          return { action: { type: 'SetStatsExpanded', expanded: !statsExpanded } };
        case 'focus-search':
          return { focusSearch: true };
        case 'clear-search':
          return { action: { type: 'Search', list: 'spenders', query: '' } };
        case 'close-preview':
          return { action: { type: 'Navigate', to: { kind: 'surface', surface: 'preview', open: false } } };
        case 'close-board':
          return { action: { type: 'Navigate', to: { kind: 'surface', surface: 'spenders', open: false } } };
        case 'fan-next':
        case 'fan-previous': {
          if (selected === null) return null;
          const around = neighbours(order, selected);
          const to = command === 'fan-next' ? around.next : around.previous;
          return to === null ? null : { action: { type: 'OpenPreview', targetHandle: handleOf(to) } };
        }
      }
    },
    dispose() {
      disposed = true;
      offContext();
      offSurfaces();
      offLanguage();
      if (searchTimer !== null) clock.clearTimer(searchTimer);
      directoryListeners.clear();
      boardCell.clear();
      statsCell.clear();
    },
  };
}

/** Reveals the shelf of a fan opened from outside the visible rows (kept for the palette and the stats' attention rows). */
export function shelfToReveal(index: BoardIndex, fanRef: string): string | null {
  return shelfOfFan(index, fanRef);
}
