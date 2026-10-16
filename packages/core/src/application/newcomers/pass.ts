// «Новые» checked by a background pass, as a surface controller (R20 P10a; docs/project-unite/architecture.md §8.7,
// §8.17; FS-NEW-1; NF-001…NF-011, NF-025…NF-027, FX-017): the view `newcomers` — the shared `NewcomersVM` with its
// `pass` — over a source port (./source.ts) a site implements over its own messages. It opens the pass when the window
// opens (NF-004), reads its rows a page at a time (NF-006), hears the rows that change as the background tells them —
// never a poll —, filters, searches, keeps the selected fan's card with the conversation as the pass read it, up to
// the source's cap (NF-009, NF-010), and gives the way into the fan's chat as an address the person opens in a new
// tab, so the window stays (NF-011). A failed read is a failed list, never «nobody new» (FX-017).
//
// The identity guard (NF-026): another sign-in, hub, account or binding — the context's epoch —, a closed window and
// another period end everything in flight: late answers and changes of the old pass are dropped, the pass is let go.
// A pass of another account is nobody's here.
//
// Nothing here sends and nothing generates (P10c brings the greeting): the card's strip is not in this controller.
// It names no site; the hub's list (ChatSpace) is ./controller.ts.

import { isCgCode, type CgCode, type CgErrorView } from '@cg/contracts/errors';
import {
  NEWCOMER_CHECK_FILTERS,
  type ActionReceipt,
  type I18n,
  type NewcomerCardVM,
  type NewcomerCheckFilter,
  type NewcomerHistoryVM,
  type NewcomerMessageVM,
  type NewcomerRowVM,
  type NewcomersFailureVM,
  type NewcomersPassStage,
  type NewcomersPassVM,
  type NewcomersTab,
  type NewcomersVM,
  type PartialGap,
  type TargetHandle,
  type UiAction,
  type VmView,
} from '@cg/contracts/vm';

import { filterLeavesTodo, historyReadable, placePassPage, prependHistory, writable } from '../../domain/newcomers/pass';
import { type PageContextPort, type PageContextState, flagFailure, pageFlag } from '../boards/context';
import { type BoardsClock } from '../boards/ports';
import { type GreetingDesk, type PreviewDirectory, type Surfaces } from '../boards/shared';
import { ViewCell, done, refused } from '../boards/surface';
import { dataView, failureView, loadingView, localError, msg, reason, stamp } from '../boards/views';
import { type NewcomersController } from './controller';
import { type NewcomersPassSource, type PassChange, type PassCounts, type PassQuery, type PassRow, type PassState } from './source';

/** The search waits this long after the last keystroke, as on the hub's list. */
export const PASS_SEARCH_DEBOUNCE_MS = 150;
/** Conversations kept in the tab at once (up to 750 messages each): the fans looked at last; an older one is read again. */
export const PASS_HISTORIES_KEPT = 12;

const SELECTOR = { of: 'newcomers' } as const;
const RELOAD: UiAction = { type: 'ReloadView', selector: SELECTOR };
const TABS = ['todo', 'all'] as const satisfies readonly NewcomersTab[];
const HANDLE = /^pass:([0-9a-f-]{36}):([1-9]\d{0,29})$/;

export interface PassNewcomersDeps {
  readonly source: NewcomersPassSource;
  readonly i18n: I18n;
  readonly clock: BoardsClock;
  readonly context: PageContextPort;
  readonly surfaces: Surfaces;
}

/** The selected fan's conversation, per pass. */
interface History {
  s: 'loading' | 'ready' | 'failed';
  /** Oldest first. */
  messages: NewcomerMessageVM[];
  more: boolean;
  loadingMore: boolean;
  capped: boolean;
  failure: NewcomersFailureVM | null;
}

const NO_FAILURE = null;

/** A failure the shared registry knows renders as its own card; a site's own code reads as «данные недоступны» there (its words are the site's). */
function sharedCode(failure: NewcomersFailureVM): CgCode {
  return isCgCode(failure.code) ? failure.code : 'CG-DATA-UNAVAILABLE';
}

export function passHandle(passId: string, fanRef: string): TargetHandle {
  return `pass:${passId}:${fanRef}`;
}

export function parsePassHandle(handle: string): { readonly passId: string; readonly fanRef: string } | null {
  const match = HANDLE.exec(handle);
  return match === null ? null : { passId: match[1] as string, fanRef: match[2] as string };
}

/** No preview of the hub's archive for a fan of the pass: its card is the window's own (`NewcomersVM.pass.card`). */
const NO_DIRECTORY: PreviewDirectory = {
  resolve: () => null,
  neighbours: () => ({ previous: null, next: null }),
  subscribe: () => () => undefined,
};

export function createPassNewcomersController(deps: PassNewcomersDeps): NewcomersController {
  const { source, i18n, clock, context, surfaces } = deps;

  let windowHours = clampHours(source.windows.initial);
  let tab: NewcomersTab = 'todo';
  let filter: NewcomerCheckFilter = 'any';
  let typed = '';
  let applied = '';
  let searchTimer: number | null = null;
  let stage: 'idle' | 'connecting' | 'live' | 'failed' = 'idle';
  let listFailure: NewcomersFailureVM | null = null;
  let pass: PassState | null = null;
  let rows: PassRow[] = [];
  let total = 0;
  let counts: PassCounts | null = null;
  /** Changes with a query or a resync: older pages cannot replace this query's rows or counters. */
  let readRun = 0;
  /** The last change applied; null — none known yet. */
  let seq: number | null = null;
  /** Changes heard while the first page was on its way. */
  let held: PassChange[] = [];
  let reading = false;
  let loadingMore = false;
  let moreFailure: NewcomersFailureVM | null = null;
  let selected: string | null = null;
  let regone = false;
  const histories = new Map<string, History>();
  /** Grows with every window, period and identity: an answer of an older run is nobody's (NF-026). */
  let run = 0;
  let epoch = context.current().epoch;
  let account = context.current().account?.hostAccountId ?? null;
  let disposed = false;

  const cell = new ViewCell(build);
  const changed = (): void => {
    if (disposed) return;
    reselect();
    cell.invalidate();
  };

  function clampHours(hours: number): number {
    return Math.min(source.windows.max, Math.max(source.windows.min, Math.round(hours)));
  }

  const open = (): boolean => surfaces.current().newcomers;
  const usable = (): boolean => {
    const ctx = context.current();
    return ctx.phase === 'ready' && pageFlag(ctx, 'newcomers');
  };

  /** Everything of the pass on screen goes; `close` — the pass is let go too (another period or identity, the window closed). */
  function letGo(close: boolean): void {
    run += 1;
    readRun += 1;
    if (close && pass !== null) source.close(pass.passId);
    pass = null;
    rows = [];
    total = 0;
    counts = null;
    seq = null;
    held = [];
    reading = false;
    loadingMore = false;
    moreFailure = null;
    listFailure = null;
    selected = null;
    histories.clear();
    stage = 'idle';
  }

  // ── the pass and its rows ──

  const query = (): PassQuery => ({ search: applied, tab, filter });

  /** A new query starts its own pages: it must reach the source even when the previous result had no list to scroll. */
  function queryChanged(): Promise<void> {
    if (pass === null || stage !== 'live') {
      changed();
      return Promise.resolve();
    }
    rows = [];
    total = 0;
    counts = null;
    return firstPage(run, source.pageSize);
  }

  /**
   * Opens the pass of this tab's creator and period, then reads its first page (NF-004). `close` — the pass on screen
   * is another period's: it is let go; a reload asks for the same pass again, which the background answers as it is.
   */
  async function start(close = true): Promise<void> {
    letGo(close);
    const mine = run;
    if (disposed || !open() || !usable()) return changed();
    const creator = context.current().account?.hostAccountId ?? null;
    account = creator;
    if (creator === null) {
      stage = 'failed';
      listFailure = { code: 'CG-HOST-NOT-READY', retryAt: null };
      return changed();
    }
    stage = 'connecting';
    changed();
    const scanned = await source.scan(creator, windowHours);
    if (disposed || mine !== run) return;
    if (!scanned.ok) return fail(scanned.failure);
    // NF-026: a pass of another creator is nobody's here.
    if (scanned.value.hostAccountId !== creator) return fail({ code: 'CG-CONTEXT-CHANGED', retryAt: null });
    pass = scanned.value;
    stage = 'live';
    changed();
    await firstPage(mine, Math.max(source.pageSize, 1));
  }

  function fail(failure: NewcomersFailureVM): void {
    stage = 'failed';
    listFailure = failure;
    changed();
  }

  /** The first rows, or the rows on screen again (a gap in the changes, a port that came back): `limit` rows from the top. */
  async function firstPage(mine: number, limit: number): Promise<void> {
    if (pass === null) return;
    const request = ++readRun;
    const wanted = query();
    reading = true;
    loadingMore = false;
    held = [];
    changed();
    const read: PassRow[] = [];
    let latest: PassState | null = null;
    let count = 0;
    let latestCounts: PassCounts | null = null;
    // The first read's change: the rows of later reads are at least as new, and the changes after it are heard.
    let firstSeq: number | null | undefined;
    for (let offset = 0; offset < limit; ) {
      const step = Math.min(source.readMax, limit - offset);
      const answer = await source.read(pass.passId, offset, step, wanted);
      if (disposed || mine !== run || request !== readRun) return;
      if (!answer.ok) {
        reading = false;
        // Rows already on screen stay with the reason beside them; with none, the list was not read (FX-017).
        if (rows.length === 0) return fail(answer.failure);
        moreFailure = answer.failure;
        return changed();
      }
      if (answer.value.pass === null) return gone(mine);
      if (answer.value.pass.hostAccountId !== account) return fail({ code: 'CG-CONTEXT-CHANGED', retryAt: null });
      read.push(...answer.value.rows);
      latest = answer.value.pass;
      count = answer.value.total;
      latestCounts = answer.value.counts;
      if (firstSeq === undefined) firstSeq = answer.value.seq;
      offset += answer.value.rows.length;
      if (answer.value.rows.length < step || offset >= answer.value.total) break;
    }
    reading = false;
    regone = false;
    moreFailure = null;
    if (latest !== null) {
      pass = latest;
      total = count;
      counts = latestCounts;
      rows = placePassPage([], 0, read);
      seq = firstSeq ?? null;
    }
    const pending = held;
    held = [];
    // An unfiltered event can move a fan into or out of this query, even beyond its loaded page. Read the query
    // again for correct rows AND whole-pass counts; concurrent events are coalesced behind the in-flight read.
    if (pending.some((change) => seq === null || change.seq > seq)) return firstPage(mine, limit);
    changed();
  }

  /** The background holds the pass no more (it ended, the event page restarted): opened again once, then a failure. */
  function gone(mine: number): void {
    reading = false;
    if (regone || mine !== run) return fail({ code: 'CG-DATA-UNAVAILABLE', retryAt: null });
    regone = true;
    void start(false);
  }

  async function nextPage(): Promise<void> {
    if (pass === null || reading || loadingMore || rows.length >= total) return;
    const mine = run;
    const request = readRun;
    loadingMore = true;
    moreFailure = null;
    changed();
    const answer = await source.read(pass.passId, rows.length, source.pageSize, query());
    if (disposed || mine !== run || request !== readRun) return;
    loadingMore = false;
    if (!answer.ok) moreFailure = answer.failure;
    else if (answer.value.pass === null) return gone(mine);
    else {
      rows = placePassPage(rows, rows.length, answer.value.rows);
      total = answer.value.total;
      counts = answer.value.counts;
      pass = answer.value.pass;
    }
    const pending = held;
    held = [];
    if (pending.some((change) => seq === null || change.seq > seq)) return firstPage(mine, Math.max(rows.length, source.pageSize));
    changed();
  }

  /** Changes carry raw rows, not this query's counts: refresh its loaded pages, never filter a partial raw list. */
  function apply(change: PassChange): void {
    if (pass === null || change.pass.passId !== pass.passId) return;
    if (seq !== null && change.seq <= seq) return;
    pass = change.pass;
    void firstPage(run, Math.max(rows.length, source.pageSize));
  }

  function heard(change: PassChange): void {
    if (disposed || pass === null || change.pass.passId !== pass.passId) return;
    if (reading || loadingMore) {
      held.push(change);
      return;
    }
    apply(change);
  }

  // ── the conversation of the card ──

  const rowOf = (fanRef: string): PassRow | null => rows.find((row) => row.fanRef === fanRef) ?? null;

  /**
   * `first` — the first page, once; `older` — the page before the oldest shown («Более ранние сообщения»); `again` —
   * «Повторить загрузку»: the older page when that is what failed, else the newest again.
   */
  async function loadHistory(fanRef: string, mode: 'first' | 'older' | 'again'): Promise<void> {
    const row = rowOf(fanRef);
    if (pass === null || row === null || !historyReadable(row.check, row.conversationRef)) return;
    const known = histories.get(fanRef);
    const older = mode === 'older' || (mode === 'again' && known !== undefined && known.s === 'ready' && known.failure !== null && known.messages.length > 0);
    if (older) {
      if (known === undefined || known.s !== 'ready' || known.loadingMore || (mode === 'older' && !known.more)) return;
    } else if (known !== undefined && (known.s === 'loading' || (mode === 'first' && known.s !== 'failed'))) return;
    const mine = run;
    const passId = pass.passId;
    const history: History = known ?? { s: 'loading', messages: [], more: false, loadingMore: false, capped: false, failure: NO_FAILURE };
    if (older) history.loadingMore = true;
    else history.s = 'loading';
    history.failure = NO_FAILURE;
    // The last one looked at goes to the end; past the bound the longest unseen goes (never the card's own).
    histories.delete(fanRef);
    histories.set(fanRef, history);
    for (const key of histories.keys()) {
      if (histories.size <= PASS_HISTORIES_KEPT) break;
      if (key !== selected && key !== fanRef) histories.delete(key);
    }
    changed();
    const before = older ? (history.messages[0]?.id ?? null) : null;
    const room = source.historyCap - (older ? history.messages.length : 0);
    const answer = await source.history(passId, fanRef, before, Math.max(1, Math.min(source.historyPage, room)));
    if (disposed || mine !== run || histories.get(fanRef) !== history) return;
    history.loadingMore = false;
    if (!answer.ok) {
      if (!older) {
        history.s = 'failed';
        history.messages = [];
      }
      history.failure = answer.failure;
      return changed();
    }
    const placed = prependHistory(older ? history.messages : [], answer.value.messages, source.historyCap);
    history.messages = placed.messages;
    // The cap is reached when something is left out of it: the rest is in the chat itself.
    history.capped = placed.messages.length >= source.historyCap && (placed.truncated || answer.value.more);
    history.more = answer.value.more && !history.capped;
    history.s = 'ready';
    changed();
  }

  /**
   * The card is on a fan of the list as it is now: the one chosen, else the first one a greeting may be written to,
   * else the first (the old window's choice). A new choice reads its conversation — after this change, never inside it.
   */
  function reselect(): void {
    if (reading && rows.length === 0) return;
    if (selected === null || !rows.some((row) => row.fanRef === selected)) selected = (rows.find((row) => writable(row.check)) ?? rows[0])?.fanRef ?? null;
    // The chosen fan's chat may have become readable meanwhile (the pass gave its verdict): it is read once.
    if (selected !== null && !histories.has(selected)) void Promise.resolve().then(ensureHistory);
  }

  /** The card shows the selected fan's conversation when the pass read it: asked once per fan and pass. */
  function ensureHistory(): void {
    if (disposed) return;
    const fanRef = selected;
    if (fanRef === null || histories.has(fanRef)) return;
    const row = rowOf(fanRef);
    if (row !== null && historyReadable(row.check, row.conversationRef)) void loadHistory(fanRef, 'first');
  }

  // ── the view ──

  function contextView(ctx: PageContextState): VmView | null {
    if (ctx.phase === 'loading') return loadingView(null);
    if (ctx.phase === 'blocked') return failureView(ctx.blocker ?? { code: 'CG-UNKNOWN' }, i18n, RELOAD);
    if (!pageFlag(ctx, 'newcomers')) return failureView(flagFailure(ctx, 'newcomers'), i18n, RELOAD);
    return null;
  }

  function stageOf(): NewcomersPassStage {
    if (stage === 'failed') return 'failed';
    if (stage !== 'live' || pass === null) return 'connecting';
    // A pass that stopped before it read anyone: the list was not read (FX-017), not «nobody».
    if (pass.state === 'stopped' && pass.failure !== null && pass.total === 0) return 'failed';
    return pass.state;
  }

  function historyVM(row: PassRow): NewcomerHistoryVM {
    const base = { messages: [] as NewcomerMessageVM[], more: false, loadingMore: false, capped: false, cap: source.historyCap, failure: null };
    if (!historyReadable(row.check, row.conversationRef)) {
      if (row.check === 'failed') return { ...base, s: 'failed', failure: row.failure };
      if (row.check === 'pending' || row.check === 'checking' || row.check === 'unverified') return { ...base, s: 'unchecked' };
      return { ...base, s: 'none' };
    }
    const history = histories.get(row.fanRef);
    if (history === undefined) return { ...base, s: 'loading' };
    return { s: history.s, messages: history.messages, more: history.more, loadingMore: history.loadingMore, capped: history.capped, cap: source.historyCap, failure: history.failure };
  }

  function cardOf(row: PassRow, passId: string): NewcomerCardVM {
    return {
      handle: passHandle(passId, row.fanRef),
      name: nameOf(row),
      username: row.username,
      customName: row.customName,
      followedAt: row.followedAt,
      checkedAt: row.checkedAt,
      bio: row.bio,
      check: row.check,
      dmClosed: row.dmClosed,
      failure: row.failure,
      proof: row.proof,
      history: historyVM(row),
      openHref: row.conversationRef === null ? null : source.chatHref(row.conversationRef),
    };
  }

  function windowText(hours: number): string {
    return hours >= 168 && hours % 24 === 0 ? i18n.plural('common.days', hours / 24) : i18n.plural('common.hours', hours);
  }

  function build(): NewcomersVM {
    const ctx = context.current();
    const now = stageOf();
    const passId = pass?.passId ?? null;
    const rowVMs: NewcomerRowVM[] =
      passId === null
        ? []
        : rows.map((row) => ({
            handle: passHandle(passId, row.fanRef),
            name: nameOf(row),
            username: row.username,
            kind: 'new',
            subscribedAt: row.followedAt,
            greeting: row.check === 'greeted' ? { s: 'greeted', at: null } : { s: 'none' },
            hasDraft: false,
            draftStale: false,
            selected: row.fanRef === selected,
            check: { status: row.check, customName: row.customName, dmClosed: row.dmClosed },
          }));

    let view: VmView;
    const blocked = contextView(ctx);
    if (blocked !== null) view = blocked;
    else if (now === 'failed') {
      const failure = listFailure ?? pass?.failure ?? { code: 'CG-DATA-UNAVAILABLE', retryAt: null };
      view = failureView({ code: sharedCode(failure) }, i18n, RELOAD);
      // A failure the shared registry reads as `offline` or `forbidden` is still a list not read, not an empty one: the card says so.
    } else if (now === 'connecting' || (rows.length === 0 && (reading || counts === null || ((now === 'scanning' || now === 'queue') && pass?.total === 0)))) view = loadingView(null, msg('common.loading'));
    else if (rows.length === 0) view = { s: 'empty', why: msg('common.empty') };
    else {
      const gaps: PartialGap[] = [];
      if (pass?.partial === true) gaps.push({ kind: 'coverage', level: 'partial' });
      if (moreFailure !== null) gaps.push({ kind: 'source-failed', source: 'newcomers', code: sharedCode(moreFailure) });
      view = dataView(gaps);
    }

    const selectedRow = selected === null ? null : rowOf(selected);
    const passVM: NewcomersPassVM = {
      passId,
      creator: ctx.account?.username ?? null,
      stage: now,
      phase: pass !== null && now === 'scanning' ? pass.phase : null,
      checked: pass?.checked ?? null,
      total: pass === null ? null : Math.max(pass.total, rows.length),
      range: pass === null ? null : { from: new Date(Date.parse(pass.startedAt) - pass.windowHours * 3_600_000).toISOString(), to: pass.startedAt },
      cooldownUntil: pass?.state === 'cooldown' ? pass.cooldownUntil : null,
      filters: NEWCOMER_CHECK_FILTERS.map((id) => ({ id, count: counts?.filters[id] ?? null, pressed: id === filter })),
      failure: now === 'failed' ? (listFailure ?? pass?.failure ?? null) : (moreFailure ?? pass?.failure ?? null),
      card: selectedRow === null || passId === null || blocked !== null ? null : cardOf(selectedRow, passId),
    };

    return {
      view,
      pageName: ctx.page?.title ?? null,
      personaLabel: ctx.persona?.label ?? null,
      tab,
      tabs: TABS.map((t) => ({ id: t, label: msg(t === 'todo' ? 'newcomers.tab.todo' : 'newcomers.tab.all'), count: counts?.tabs[t] ?? null })),
      windowHours,
      windowOptions: source.windows.options,
      // The hub list's filters; a pass filters by its verdicts (`pass.filters`).
      filters: [],
      query: typed,
      rows: rowVMs,
      cardOpen: passVM.card !== null,
      scan: pass !== null && (now === 'scanning' || now === 'queue') ? { stage: msg('common.loading'), done: pass.checked, total: passVM.total } : null,
      incomplete: pass?.partial === true ? msg('newcomers.incomplete.body') : null,
      footer: { count: passVM.total ?? rows.length, stamp: stamp(pass?.startedAt ?? null, pass?.partial === true ? 'partial' : 'complete') },
      canLoadMore: stage === 'live' && !reading && !loadingMore && rows.length < total,
      hint: msg('newcomers.hint', { window: windowText(windowHours) }),
      noAutoSend: msg('newcomers.noAutoSend'),
      pass: passVM,
    };
  }

  // ── the actions ──

  /** The handle of a fan of the open pass; a handle of an older pass or another fan — null. */
  function own(handle: TargetHandle): string | null {
    const parsed = parsePassHandle(handle);
    if (parsed === null || pass === null || parsed.passId !== pass.passId) return null;
    return rowOf(parsed.fanRef) === null ? null : parsed.fanRef;
  }

  const stale = (type: UiAction['type']): Promise<ActionReceipt> => Promise.resolve(refused(type, localError('CG-CONTEXT-CHANGED', i18n)));

  function dispatch(action: UiAction): Promise<ActionReceipt> | null {
    const type = action.type;
    if (action.type === 'Navigate') {
      const to = action.to;
      if (to.kind !== 'surface' || to.surface !== 'newcomers') return null;
      surfaces.setList('newcomers', to.open);
      return Promise.resolve(done(type, to.open ? 'opened' : 'done'));
    }
    if (action.type === 'SetNewcomersTab') {
      tab = action.tab;
      filter = 'any';
      return queryChanged().then(() => done(type));
    }
    if (action.type === 'SetNewcomersCheckFilter') {
      filter = action.filter;
      if (filterLeavesTodo(action.filter)) tab = 'all';
      return queryChanged().then(() => done(type));
    }
    if (action.type === 'SetNewcomersWindow') {
      const hours = clampHours(action.hours);
      if (hours === windowHours) return Promise.resolve(done(type, 'noop'));
      // Another period is another pass: the old one is let go, its late answers are nobody's.
      windowHours = hours;
      return start().then(() => done(type));
    }
    if (action.type === 'Search') {
      if (action.list !== 'newcomers') return null;
      typed = action.query;
      if (searchTimer !== null) clock.clearTimer(searchTimer);
      searchTimer = clock.setTimer(PASS_SEARCH_DEBOUNCE_MS, () => {
        searchTimer = null;
        if (applied === typed) return;
        applied = typed;
        void queryChanged();
      });
      cell.invalidate();
      return Promise.resolve(done(type));
    }
    if (action.type === 'ResetFilters') {
      if (action.list !== 'newcomers') return null;
      filter = 'any';
      typed = '';
      applied = '';
      if (searchTimer !== null) clock.clearTimer(searchTimer);
      searchTimer = null;
      return queryChanged().then(() => done(type));
    }
    if (action.type === 'LoadMore') {
      if (action.list !== 'newcomers') return null;
      if (pass === null || rows.length >= total) return Promise.resolve(done(type, 'noop'));
      return nextPage().then(() => done(type));
    }
    if (action.type === 'ReloadView') {
      if (action.selector.of !== 'newcomers') return null;
      const reads = context.current().phase === 'ready' ? Promise.resolve() : context.refresh();
      return reads.then(() => start(false)).then(() => done(type));
    }
    if (action.type === 'OpenPreview' || action.type === 'LoadOlder' || action.type === 'RefreshArchive') {
      // A handle of the pass is this window's; any other is a list's or the dock's.
      if (parsePassHandle(action.targetHandle) === null) return null;
      const fanRef = own(action.targetHandle);
      if (fanRef === null) return stale(type);
      if (action.type === 'OpenPreview') {
        selected = fanRef;
        changed();
        ensureHistory();
        return Promise.resolve(done(type, 'opened'));
      }
      return loadHistory(fanRef, action.type === 'LoadOlder' ? 'older' : 'again').then(() => done(type));
    }
    return null;
  }

  // ── what the window hears ──

  const offs: (() => void)[] = [
    source.onChange(heard),
    source.onReconnect(() => {
      // The changes while the port was down are lost: what is on screen is read again.
      if (pass !== null && stage === 'live' && !disposed) void firstPage(run, Math.max(rows.length, source.pageSize));
    }),
    context.subscribe((state) => {
      const creator = state.account?.hostAccountId ?? null;
      if (state.epoch !== epoch || creator !== account) {
        // NF-026: another sign-in, hub, account or binding — the pass, its rows and everything in flight go.
        epoch = state.epoch;
        account = creator;
        letGo(true);
        changed();
        if (open()) void start();
        return;
      }
      if (state.phase === 'ready' && !pageFlag(state, 'newcomers') && stage !== 'idle') {
        // The owner's switch went off on the page: the pass is let go, nothing more is read. (A context blocked while
        // the port is down keeps what is shown; the port's return reads it again.)
        letGo(true);
        changed();
      } else if (open() && stage === 'idle' && usable()) void start();
      else changed();
    }),
    surfaces.subscribe((state, previous) => {
      if (state.newcomers && !previous.newcomers) void start();
      else if (!state.newcomers && previous.newcomers) {
        // Closing the window lets the pass go (NF-026): it keeps what it found, nothing new starts for this window.
        letGo(true);
        if (searchTimer !== null) clock.clearTimer(searchTimer);
        searchTimer = null;
        applied = typed;
        changed();
      }
    }),
    i18n.subscribe(() => changed()),
  ];

  const greeting = noGreeting(i18n);

  return {
    kinds: ['newcomers'],
    getSnapshot: () => cell.get(),
    subscribe: (_selector, listener) => cell.subscribe(listener),
    dispatch,
    directory: NO_DIRECTORY,
    greeting,
    refresh: () => start(false),
    draftsChanged: () => undefined,
    dispose() {
      disposed = true;
      for (const off of offs.splice(0)) off();
      if (pass !== null) source.close(pass.passId);
      if (searchTimer !== null) clock.clearTimer(searchTimer);
      run += 1;
      histories.clear();
      cell.clear();
    },
  };
}

function nameOf(row: PassRow): string {
  return row.displayName ?? row.username ?? row.fanRef;
}

/**
 * The greeting desk the preview asks for «Новые» fans: a fan of the pass is never in the preview (`NO_DIRECTORY`),
 * and the pass's own greeting is the card's (P10c). Everything here says no.
 */
function noGreeting(i18n: I18n): GreetingDesk {
  const off = (): CgErrorView => localError('CG-FEATURE-DISABLED', i18n);
  return {
    claimForGenerate: () => Promise.resolve({ ok: false, code: 'CG-FEATURE-DISABLED', error: off() }),
    giveBack: () => undefined,
    leaseToken: () => null,
    claim: () => ({ s: 'none' }),
    greeting: () => ({ s: 'none' }),
    hiBlocked: () => reason('feature-disabled'),
    subscribed: () => false,
    threadRevision: () => null,
    noteProgress: () => undefined,
    touch: () => undefined,
    noteRefusal: () => undefined,
    subscribe: () => () => undefined,
  };
}
