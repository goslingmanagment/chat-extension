// The Spenders window (architecture.md §10.1; ui-design §3.5, §4.14–§4.16,
// §6.3, §6.4; SP-002, SP-019, SP-033, SP-049, SP-050; X66, X67; 1.44.0 — the
// owner's «Таблица»): one window on both sites over a scrim in the middle of the
// page — «Spenders  page · N фанов · данные на …» with «Обновить» and «Закрыть
// Esc» on one line, the chips and the search under it (or, while fans are
// ticked, the batch's row in their place), the table, the keys at the foot. A
// site with statistics has them at the table's right edge: a rail by default,
// the column on a click or S, or expanded in place of the list. A picked fan's
// preview unfolds right under their row (X66); only a fan the list does not
// show (a filter or a search hides them) gets the preview as a panel under the
// list, its height dragged on the border between them. It renders three view
// models (`spenders.board`, `spenders.stats`, `preview` from `spenders`) and
// asks for everything through UiAction.

import { type JSX, type RefObject, type TargetedKeyboardEvent } from 'preact';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';

import { type BatchVM, type SpendersBoardVM } from '@cg/contracts/vm';

import { Boundary, Button, Dialog, KeysFooter, OverlayLayer, SearchBox, activeIn, focusQuietly, isComposing, useDispatch, useI18n, useKit, useView } from '../kit';
import { BOARD_CSS, Board, BoardFilters, firstFan, focusIsIdle, openChat, type BoardHandle } from './Board';
import { PanelPreview, type PreviewFallback } from './preview/PanelPreview';
import { STATS_CSS, StatsColumn, StatsExpanded, StatsRail, type StatsShow } from './Stats';
import { RefreshButton, isPlainKey, isTextEntry, type RefreshableView } from './window';

/** Marks of the paints the UI reports; the controller starts the measure, the UI ends it (RenderMarks). */
export const SPENDERS_PAINT_MARKS = { open: 'spenders.board', search: 'spenders.search' } as const;

/** What «Обновить» of the header reads again: the list and the statistics column beside it (SP-024). */
const BOARD_REFRESH: readonly RefreshableView[] = ['spenders.board', 'spenders.stats'];
/** A board without the statistics (R20 P9e) reads only the list again. */
const LIST_REFRESH: readonly RefreshableView[] = ['spenders.board'];

/** The preview panel never gets lower than this, and the list above it keeps at least `LIST_MIN_PX` (X65). */
export const PANEL_MIN_PX = 180;
export const LIST_MIN_PX = 160;
/** One press of ↑ / ↓ on the border moves it this far. */
const PANEL_STEP_PX = 24;
/** The height the person dragged the panel to, kept while the tab lives: the next fan and the next opening keep it. */
let draggedPanelHeight: number | null = null;

/** The picked fan has a row in the list: their preview unfolds under it (X66). */
function pickedInList(board: SpendersBoardVM): boolean {
  return board.shelves.some((shelf) => shelf.rows.some((row) => row.selected));
}

/** The picked fan's last message from the list: the preview shows it while the archive has nothing yet (X65). */
function rowFallback(board: SpendersBoardVM): PreviewFallback | null {
  for (const shelf of board.shelves) {
    for (const row of shelf.rows) {
      if (!row.selected) continue;
      if (row.lastMessage === null) return null;
      return { handle: row.handle, fromUs: row.lastMessage.fromUs, text: row.lastMessage.text, at: row.lastMessage.fromUs ? row.weWroteAt : row.fanWroteAt };
    }
  }
  return null;
}

/**
 * The border between the list and the preview: drag it, or ↑ / ↓ with focus on it. `role="separator"` with the
 * panel's height as its value (WAI-ARIA window splitter).
 */
function PanelSplit({ panelRef, height, onResize }: { readonly panelRef: RefObject<HTMLDivElement | null>; readonly height: number | null; readonly onResize: (height: number) => void }): JSX.Element {
  const i18n = useI18n();
  const drag = useRef<{ readonly y: number; readonly height: number } | null>(null);
  const measured = (): number => panelRef.current?.getBoundingClientRect().height ?? height ?? PANEL_MIN_PX;
  // The pointer's capture ends with its pointerup or pointercancel by itself.
  const end = (): void => {
    drag.current = null;
  };
  return (
    <div
      class="cg-sp__split"
      role="separator"
      aria-orientation="horizontal"
      aria-label={i18n.t('spenders.previewSplit')}
      aria-valuemin={PANEL_MIN_PX}
      {...(height === null ? {} : { 'aria-valuenow': Math.round(height) })}
      tabIndex={0}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        drag.current = { y: event.clientY, height: measured() };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (start !== null) onResize(start.height + (start.y - event.clientY));
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={(event) => {
        const step = event.key === 'ArrowUp' ? PANEL_STEP_PX : event.key === 'ArrowDown' ? -PANEL_STEP_PX : 0;
        if (step === 0) return;
        event.preventDefault();
        onResize(measured() + step);
      }}
    />
  );
}

/**
 * The ticked fans' row in place of the chips (1.44.0): «Отмечено 3 · [Написать приветствие] · Снять · ИИ напишет
 * черновик каждому — отправляете вы сами»; a batch already on its way says how far it got and can be stopped. The
 * batch never sends: each result waits on its fan's card for the person's own click (X8).
 */
function PickedBar({ batch, picked }: { readonly batch: BatchVM; readonly picked: readonly string[] }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const total = batch.queued + batch.generating + batch.ready + batch.sent + batch.failed;
  const running = batch.queued + batch.generating > 0;
  return (
    <div class="cg-sp__picked" role="group" aria-label={i18n.t('batch.pickAll')} data-cg-batch={running ? 'running' : 'picked'}>
      <b class="cg-sp__pickedn cg-num">{i18n.t('spenders.batch.picked', { n: batch.picked })}</b>
      <Button
        label={i18n.t('spenders.batch.write')}
        size="sm"
        class="cg-sp__solid"
        reason={batch.reason === null ? null : i18n.text(batch.reason)}
        tooltip={i18n.t('batch.generateTooltip')}
        onClick={() => void dispatch({ type: 'GenerateBatch', list: 'spenders' })}
      />
      <Button
        label={i18n.t('spenders.batch.unpick')}
        variant="quiet"
        size="sm"
        class="cg-sp__unpick"
        // The ticks go; the drafts a batch already wrote stay on their rows.
        onClick={() => void dispatch(picked.length === 0 ? { type: 'ClearBatch', list: 'spenders' } : { type: 'SetBatchPick', list: 'spenders', targetHandles: picked.slice(0, 1000), picked: false })}
      />
      {total === 0 ? (
        <span class="cg-sp__hint">{i18n.t('spenders.batch.hint')}</span>
      ) : (
        <>
          <span class="cg-sp__hint" role="status">
            {i18n.t('batch.progress', { done: batch.ready + batch.sent, total })}
            {batch.failed === 0 ? null : ` · ${i18n.t('batch.failedCount', { n: batch.failed })}`}
          </span>
          {running ? <Button label={i18n.t('batch.stop')} variant="quiet" size="sm" onClick={() => void dispatch({ type: 'StopBatch', list: 'spenders' })} /> : null}
        </>
      )}
    </div>
  );
}

export function SpendersWindow(): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const { root, deps } = useKit();
  const board = useView({ of: 'spenders.board' }).value;
  const stats = useView({ of: 'spenders.stats' }).value;
  // A board without the statistics (its controller's `statistics: false`; both sites have them): no column, no S, the preview next to the list alone.
  const statistics = board.statistics !== false;
  const expanded = statistics && stats.expanded;
  const statsOpen = statistics && stats.open && !expanded;
  const railRef = useRef<HTMLButtonElement>(null);
  const collapseRef = useRef<HTMLButtonElement>(null);
  const picked = useMemo(() => board.shelves.flatMap((shelf) => shelf.rows.filter((row) => row.batch?.picked === true).map((row) => row.handle)), [board.shelves]);
  const ticking = board.batch !== undefined && board.batch.picked > 0;
  const boardRef = useRef<BoardHandle>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const hasRows = board.shelves.some((shelf) => shelf.rows.length > 0);
  const fallback = useMemo(() => rowFallback(board), [board]);
  const [panelHeight, setPanelHeight] = useState<number | null>(draggedPanelHeight);
  // The sheet keeps both parts in the body (the panel's min- and max-height); the window remembers what was dragged.
  const resizePanel = useCallback((wanted: number): void => {
    const body = bodyRef.current?.clientHeight ?? 0;
    if (body <= 0) return;
    draggedPanelHeight = Math.round(Math.min(body - LIST_MIN_PX, Math.max(PANEL_MIN_PX, wanted)));
    setPanelHeight(draggedPanelHeight);
  }, []);

  const closeWindow = useCallback((): void => void dispatch({ type: 'Navigate', to: { kind: 'surface', surface: 'spenders', open: false } }), [dispatch]);
  const close = useCallback((): void => {
    // Esc in turn: the search, the preview, the window (ui-design §6.4). A press outside the window closes it at once.
    if (board.query !== '') void dispatch({ type: 'Search', list: 'spenders', query: '' });
    else if (board.previewOpen && !expanded) void dispatch({ type: 'Navigate', to: { kind: 'surface', surface: 'preview', open: false } });
    else void dispatch({ type: 'Navigate', to: { kind: 'surface', surface: 'spenders', open: false } });
  }, [board.query, board.previewOpen, expanded, dispatch]);

  // The board is on screen: the end of `boardOpenMs` (the controller holds its start).
  const paintedOpen = useRef(false);
  useEffect(() => {
    if (paintedOpen.current || !hasRows) return undefined;
    paintedOpen.current = true;
    const frame = requestAnimationFrame(() => deps.marks.painted('boardOpenMs', SPENDERS_PAINT_MARKS.open));
    return () => cancelAnimationFrame(frame);
  }, [hasRows, deps]);

  // A search ANSWER painted: the end of `searchMs`. A controller shows the typed query at once and the filtered
  // shelves after its own pause (SP-019), so the query alone is not the answer: the mark waits for the shelves
  // that come with or after it. Typing back to the query the shelves already answer ends the wait.
  const search = useRef<{ query: string; shelves: typeof board.shelves; answered: string; state: 'idle' | 'waiting' | 'painting' }>({ query: board.query, shelves: board.shelves, answered: board.query, state: 'idle' });
  useEffect(() => {
    const seen = search.current;
    const newShelves = seen.shelves !== board.shelves;
    if (seen.query !== board.query) seen.state = newShelves || board.query !== seen.answered ? 'waiting' : 'idle';
    seen.query = board.query;
    seen.shelves = board.shelves;
    if (seen.state === 'waiting' && newShelves) {
      seen.answered = board.query;
      seen.state = 'painting';
    }
    if (seen.state !== 'painting') return undefined;
    // Cancelled by a newer render before the frame came: the next run of this effect asks again.
    const frame = requestAnimationFrame(() => {
      seen.state = 'idle';
      deps.marks.painted('searchMs', SPENDERS_PAINT_MARKS.search);
    });
    return () => cancelAnimationFrame(frame);
  }, [board.query, board.shelves, deps]);

  // The window opens on the selected row of the list, or the first (ui-design §6.3) — also when that row is
  // far down the virtual list, and when the rows arrive later, unless the person has moved focus meanwhile.
  const openedOn = useRef<Element | null | undefined>(undefined);
  useLayoutEffect(() => {
    const first = openedOn.current === undefined;
    if (hasRows && (first || root.activeElement === openedOn.current || focusIsIdle(root, frameRef.current?.closest<HTMLElement>('.cg-dialog') ?? null))) boardRef.current?.focusActiveRow();
    if (first) openedOn.current = root.activeElement;
  }, [hasRows, root]);

  // The preview closed (×, Esc): focus goes back to the fan's row (ui-design §6.3).
  const previewWasOpen = useRef(board.previewOpen);
  useLayoutEffect(() => {
    if (previewWasOpen.current && !board.previewOpen) boardRef.current?.focusActiveRow();
    previewWasOpen.current = board.previewOpen;
  }, [board.previewOpen]);

  // The rail turned into the column or back (a click on it, ›): the button pressed is gone with it, and the focus would
  // fall out of the window, where no key of ours is heard. It goes to the other one. S on a row keeps it on the row.
  const statsWereOpen = useRef(statsOpen);
  useLayoutEffect(() => {
    if (statsWereOpen.current !== statsOpen && activeIn(root) === null) focusQuietly(statsOpen ? collapseRef.current : railRef.current);
    statsWereOpen.current = statsOpen;
  }, [statsOpen, root]);

  // «Кому написать»: the list shows those fans — «Ждут ответа» sorts it, the rest filter it — from its first row.
  const showFans = useCallback(
    (what: StatsShow): void => {
      const now = deps.client.getSnapshot({ of: 'spenders.board' });
      const actions: Promise<unknown>[] = [];
      if (what === 'waiting') {
        if (now.sort !== 'waiting') actions.push(dispatch({ type: 'SetSpendersSort', sort: 'waiting' }));
      } else if (now.filters.find((filter) => filter.id === what)?.pressed !== true) actions.push(dispatch({ type: 'SetSpendersFilter', filter: what }));
      if (expanded) actions.push(dispatch({ type: 'SetStatsExpanded', expanded: false }));
      void Promise.all(actions).then(() => requestAnimationFrame(() => boardRef.current?.scrollToTop()));
    },
    [deps, dispatch, expanded],
  );

  // The statistics took the place of the list (S, «Развернуть»): the row that had the focus is gone with it, and
  // the focus would fall out of the window — to the page, where no key of ours is heard, so a second S could
  // not bring the list back. It goes to «Свернуть к списку», and back to the fan's row when the list returns.
  const statsWereExpanded = useRef(expanded);
  useLayoutEffect(() => {
    if (expanded && !statsWereExpanded.current) focusQuietly(frameRef.current?.querySelector<HTMLElement>('.cg-stx__head .cg-btn'));
    else if (!expanded && statsWereExpanded.current) boardRef.current?.focusActiveRow();
    statsWereExpanded.current = expanded;
  }, [expanded]);

  // The old Fansly board's search: Enter opens the top match of what was typed, ↓ / ↑ go on to the list.
  const searchEnter = useCallback(
    (query: string): void => {
      // The list follows the field at once, in this same key press: the chat it opens is the person's choice of it.
      void dispatch({ type: 'Search', list: 'spenders', query, now: true });
      // An empty field has no match: Enter there only settles it.
      if (query.trim() === '') return;
      const now = deps.client.getSnapshot({ of: 'spenders.board' });
      // A list still on its way (or another query) opens nothing: Enter never opens a fan the person did not see match.
      if (now.query !== query) return;
      const top = firstFan(now);
      if (top !== null) void dispatch(openChat(top.handle));
    },
    [dispatch, deps],
  );
  const searchArrow = useCallback(
    (query: string): boolean => {
      void dispatch({ type: 'Search', list: 'spenders', query, now: true });
      // The rows of what was typed are drawn on the next frame; the keyboard's row is one of them.
      requestAnimationFrame(() => boardRef.current?.focusActiveRow());
      return true;
    },
    [dispatch],
  );

  const onKeyDown = (event: TargetedKeyboardEvent<HTMLDivElement>): void => {
    if (event.defaultPrevented || isComposing(event) || isTextEntry(event.target) || !isPlainKey(event)) return;
    if (event.code === 'Slash' || event.key === '/') {
      // `/` — the search (SP-019).
      event.preventDefault();
      searchRef.current?.focus();
    } else if (event.code === 'KeyS' && !event.shiftKey && statistics) {
      // S — the statistics' column and its rail (SP-049); from the full view, back to the column beside the list.
      event.preventDefault();
      void dispatch(expanded ? { type: 'SetStatsExpanded', expanded: false } : { type: 'SetStatsOpen', open: !stats.open });
    }
  };

  const preview = board.previewOpen && !expanded;
  const unfold = preview && pickedInList(board);
  const unfolded = useCallback(
    () => (
      <Boundary surface={null}>
        <PanelPreview fallback={fallback} />
      </Boundary>
    ),
    [fallback],
  );

  return (
    <OverlayLayer>
      <Dialog
        open
        label={i18n.t('spenders.title')}
        size="wide"
        class={`cg-sp cg-spw${statistics ? ' has-stats' : ''}`}
        onClose={close}
        onScrim={closeWindow}
        initialFocus={() => frameRef.current?.querySelector<HTMLElement>('[data-cg-item][tabindex="0"]') ?? null}
      >
        <div ref={frameRef} class="cg-sp__frame" onKeyDown={onKeyDown}>
          <div class="cg-sp__top">
            <header class="cg-sp__head">
              <h2 class="cg-sp__title">{i18n.t('spenders.title')}</h2>
              <span class="cg-sp__sub">
                {board.pageName === null ? null : <span class="cg-sp__page">{board.pageName}</span>}
                {/* «1000 из 1240 фанов» when the hub has more than the list holds; else «1240 фанов». */}
                {board.footer.loaded > 0 ? <span>{board.footer.total !== null && board.footer.total > board.footer.loaded ? i18n.plural('spenders.headOf', board.footer.total, { loaded: board.footer.loaded }) : i18n.plural('common.fans', board.footer.loaded)}</span> : null}
                {board.footer.stamp.asOf === null ? null : <span>{i18n.t('common.dataAsOf', { time: { time: board.footer.stamp.asOf } })}</span>}
              </span>
              <span class="cg-sp__grow" />
              {/* SP-024: one «Обновить» for what the window shows of the page — the list and the statistics beside it. */}
              <RefreshButton views={statistics ? BOARD_REFRESH : LIST_REFRESH} />
              <Button label={i18n.t('common.close')} variant="quiet" size="sm" hotkey="Esc" tooltip={i18n.t('spenders.closeTooltip')} class="cg-sp__close" onClick={closeWindow} />
            </header>
            {ticking && board.batch !== undefined ? (
              <div class="cg-sp__bar is-batch">
                <PickedBar batch={board.batch} picked={picked} />
              </div>
            ) : (
              <div class="cg-sp__bar">
                <BoardFilters board={board} />
                <span class="cg-sp__grow" />
                <SearchBox
                  value={board.query}
                  label={i18n.t('spenders.search.placeholder')}
                  placeholder={i18n.t('spenders.search.placeholder')}
                  class="cg-sp__search"
                  hotkey="/"
                  inputRef={searchRef}
                  onQuery={(query) => void dispatch({ type: 'Search', list: 'spenders', query })}
                  onEnter={searchEnter}
                  onArrow={(_direction, query) => searchArrow(query)}
                />
              </div>
            )}
          </div>
          {expanded ? (
            <div class="cg-sp__cols is-stats">
              <Boundary surface={null}>
                <StatsExpanded stats={stats} onShow={showFans} />
              </Boundary>
            </div>
          ) : (
            <div ref={bodyRef} class={`cg-sp__body${preview && !unfold ? ' has-panel' : ''}`}>
              <div class={`cg-sp__cols${statistics ? (statsOpen ? ' has-column' : ' has-rail') : ' no-stats'}`}>
                <Board board={board} boardRef={boardRef} unfolded={unfold ? unfolded : null} narrow={statsOpen} />
                {/* A broken statistics column does not take the board down (ER-020). */}
                {statistics ? (
                  <Boundary surface={null}>
                    {statsOpen ? <StatsColumn stats={stats} onShow={showFans} collapseRef={collapseRef} /> : <StatsRail stats={stats} buttonRef={railRef} />}
                  </Boundary>
                ) : null}
              </div>
              {preview && !unfold ? (
                <>
                  <PanelSplit panelRef={panelRef} height={panelHeight} onResize={resizePanel} />
                  <div ref={panelRef} class="cg-sp__panel" {...(panelHeight === null ? {} : { style: { height: `${panelHeight}px` } })}>
                    <Boundary surface={null}>
                      <PanelPreview fallback={fallback} />
                    </Boundary>
                  </div>
                </>
              ) : null}
            </div>
          )}
          {/* The old window's foot: the list's keys (SP-034). */}
          <KeysFooter hints={board.keys.map((key) => ({ keys: key.hotkey.display, label: i18n.text(key.label) }))} hide={null} />
        </div>
      </Dialog>
    </OverlayLayer>
  );
}

// The window (1.44.0, the owner's «Таблица»): 1320 px at most over a scrim in the middle of the page; a 56 px head —
// «Spenders» and its quiet line, «Обновить», «Закрыть Esc» —, a 48 px row of the chips (one segmented group), «Фильтр
// ▾» and the search at its right end, or the ticked fans' batch row in its place. The body: the table and, at its
// right edge, the statistics — a 40 px rail or the 336 px column. A preview of a fan the list does not show is a
// panel under them, dragged on its border. Terracotta is the board's «ждёт» alone: buttons here hover in grey.
//
// ≤ 680 px — the statistics give way; S still opens them in full.
export const SPENDERS_CSS = `
.cg-dialog.cg-dialog--wide.cg-sp {
  top: 50%; translate: -50% -50%; width: min(1320px, calc(100vw - 48px)); height: min(900px, calc(100vh - 48px)); max-height: none;
  border-radius: 12px;
}
.cg-sp .cg-sp__top { display: block; flex: none; height: auto; padding: 0; border-bottom: 0; }
.cg-sp__head { display: flex; align-items: center; gap: 8px; height: 56px; padding: 0 16px; }
.cg-sp .cg-sp__title { flex: none; margin: 0 8px 0 0; font: 600 var(--cg-text-2xl)/24px var(--cg-font); color: var(--cg-ink-strong); letter-spacing: 0; }
.cg-sp__sub { display: flex; gap: 6px; min-width: 0; font-size: var(--cg-text-sm2); color: var(--cg-ink-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cg-sp__sub > * + *::before { content: "·"; margin-right: 6px; }
.cg-sp__head > .cg-sp__refresh { margin: 0; }
.cg-spw .cg-sp__head .cg-btn { height: 28px; padding: 0 8px; border-radius: var(--cg-r-sm); color: var(--cg-ink-2); font-size: var(--cg-text-sm2); }
.cg-spw .cg-sp__head .cg-btn:hover { background: var(--cg-sunk); color: var(--cg-ink-strong); }
.cg-spw .cg-sp__head .cg-btn kbd { margin-left: 2px; }
.cg-sp__close { flex: none; }
.cg-sp__bar { display: flex; align-items: center; gap: 8px; height: 48px; padding: 0 16px; min-width: 0; border-bottom: 1px solid var(--cg-rule); }
.cg-sp__bar.is-batch { background: var(--cg-sunk); border-top: 1px solid var(--cg-rule); }
.cg-sp__bar .cg-sp__filters { margin: 0; gap: 8px; min-width: 0; }
.cg-sp__seg { display: flex; gap: 2px; padding: 2px; border-radius: var(--cg-r-md); box-shadow: inset 0 0 0 1px var(--cg-rule-2); min-width: 0; overflow: hidden; }
.cg-spw .cg-sp__seg .cg-flt { display: flex; align-items: center; gap: 6px; height: 26px; padding: 0 8px; border-radius: var(--cg-r-sm); color: var(--cg-ink-muted); font-size: var(--cg-text-sm2); font-weight: 400; }
.cg-spw .cg-sp__seg .cg-flt:hover { background: var(--cg-sunk); color: var(--cg-ink-strong); }
.cg-spw .cg-sp__seg .cg-flt[aria-pressed="true"] { background: var(--cg-seg-on); color: var(--cg-ink-strong); font-weight: 400; }
.cg-spw .cg-sp__seg .cg-flt__n { margin: 0; color: var(--cg-ink-faint); font-family: inherit; font-size: inherit; }
.cg-spw .cg-sp__seg .cg-flt[aria-pressed="true"] .cg-flt__n { color: var(--cg-ink-muted); }
.cg-spw .cg-sp__bar .cg-choice { height: 28px; padding: 0 8px; border-radius: var(--cg-r-sm); color: var(--cg-ink-2); font-size: var(--cg-text-sm2); }
.cg-spw .cg-sp__bar .cg-choice:hover { background: var(--cg-sunk); color: var(--cg-ink-strong); }
.cg-spw .cg-sp__bar .cg-choice.is-on { background: var(--cg-seg-on); color: var(--cg-ink-strong); }
.cg-spw .cg-sp__bar .cg-choice .cg-ico { width: 12px; height: 12px; color: var(--cg-ink-muted); }
.cg-sp__bar .cg-sp__search { width: 264px; min-width: 160px; height: 32px; border-radius: var(--cg-r-md); }
/* The window's menus (the period, «Фильтр») mark their choice in grey: terracotta is the board's «ждёт» alone. */
.cg-spw .cg-menu__item.is-on { background: var(--cg-seg-on); color: var(--cg-ink-strong); }
.cg-spw .cg-menu__item.is-on::after { color: var(--cg-ink-strong); }
.cg-sp__picked { display: flex; align-items: center; gap: 16px; min-width: 0; flex: 1; }
.cg-sp__pickedn { flex: none; font-weight: 600; color: var(--cg-ink-strong); }
.cg-spw .cg-sp__solid.cg-btn { height: 28px; padding: 0 12px; border-radius: var(--cg-r-sm); background: var(--cg-ink); color: var(--cg-surface); font-size: var(--cg-text-sm2); font-weight: 600; box-shadow: none; }
.cg-spw .cg-sp__solid.cg-btn:hover { background: var(--cg-ink-strong); color: var(--cg-surface); }
.cg-spw .cg-sp__solid.cg-btn[aria-disabled="true"] { background: var(--cg-rule-2); color: var(--cg-ink-muted); }
.cg-sp__picked .cg-sp__unpick { margin-left: -8px; color: var(--cg-ink-2); }
.cg-sp__hint { min-width: 0; color: var(--cg-ink-muted); font-size: var(--cg-text-sm); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cg-sp__body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.cg-sp__cols { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr); }
.cg-sp__cols.has-rail { grid-template-columns: minmax(0, 1fr) 40px; }
.cg-sp__cols.has-column { grid-template-columns: minmax(0, 1fr) 336px; }
.cg-sp__cols > * { min-height: 0; min-width: 0; }
.cg-sp__cols > * + * { border-left: 1px solid var(--cg-rule); }
.cg-sp__split {
  flex: none; height: 9px; margin: -4px 0; position: relative; z-index: 4; cursor: row-resize; touch-action: none;
  background: linear-gradient(var(--cg-rule-2), var(--cg-rule-2)) center / 100% 1px no-repeat;
}
.cg-sp__split:hover, .cg-sp__split:focus-visible { outline: none; background-image: linear-gradient(var(--cg-ink-muted), var(--cg-ink-muted)); background-size: 100% 3px; }
.cg-sp__panel { flex: none; height: clamp(180px, 46%, 560px); min-height: min(180px, 50%); max-height: calc(100% - 160px); display: flex; flex-direction: column; }
.cg-sp__panel > * { flex: 1; min-height: 0; }
.cg-sp .cg-keys { min-height: 32px; padding-left: 16px; gap: 4px 16px; font-size: var(--cg-text-xs); }
/* A short window (200 % zoom of a laptop) keeps its room for the list and the unfolded preview. */
@media (max-height: 560px) { .cg-sp .cg-keys { display: none; } }
@media (max-width: 1100px) { .cg-sp__bar .cg-sp__search { width: 200px; } }
@media (max-width: 760px) {
  .cg-dialog.cg-dialog--wide.cg-sp { width: calc(100vw - 16px); height: calc(100vh - 16px); }
  .cg-sp__bar { height: auto; min-height: 48px; flex-wrap: wrap; padding: 8px 16px; }
  .cg-sp__bar .cg-sp__search { width: 100%; }
}
@media (max-width: 680px) {
  .cg-sp__cols.has-rail, .cg-sp__cols.has-column { grid-template-columns: minmax(0, 1fr); }
  .cg-sp__cols > .cg-st { display: none; }
}
${BOARD_CSS}
${STATS_CSS}
`;
