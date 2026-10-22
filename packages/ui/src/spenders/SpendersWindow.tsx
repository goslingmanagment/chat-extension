// The Spenders window (architecture.md §10.1; ui-design §3.5, §4.14–§4.16,
// §6.3, §6.4; SP-002, SP-019, SP-033, SP-049, SP-050; X66, X67): the old Fansly
// extension's window, the same on both sites — a compact window over a scrim in
// the middle of the page, the serif title over «page · N фанов · данные на …»,
// «Обновить» and «Закрыть», the chips and the search under them, the list, the
// keys at the foot. A site with statistics has them as a column right of the
// list, inside the same window. A picked fan's preview unfolds right under their
// row (X66); only a fan the list does not show (a filter or a search hides them)
// gets the preview as a panel under the list, its height dragged on the border
// between them. The statistics may also be expanded in place of both. It renders three view models (`spenders.board`,
// `spenders.stats`, `preview` from `spenders`) and asks for everything
// through UiAction.

import { type JSX, type RefObject, type TargetedKeyboardEvent } from 'preact';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';

import { type SpendersBoardVM } from '@cg/contracts/vm';

import { Boundary, Button, Dialog, KeysFooter, OverlayLayer, SearchBox, focusQuietly, isComposing, useDispatch, useI18n, useKit, useView } from '../kit';
import { BOARD_CSS, Board, BoardFilters, firstFan, focusIsIdle, openChat, type BoardHandle } from './Board';
import { PanelPreview, type PreviewFallback } from './preview/PanelPreview';
import { STATS_CSS, StatsColumn, StatsExpanded } from './Stats';
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

export function SpendersWindow(): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const { root, deps } = useKit();
  const board = useView({ of: 'spenders.board' }).value;
  const stats = useView({ of: 'spenders.stats' }).value;
  // A host without the statistics (Fansly, R20 P9e): no column, no S, the preview next to the list alone.
  const statistics = board.statistics !== false;
  const expanded = statistics && stats.expanded;
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
      // S — the statistics, expanded and back (SP-049).
      event.preventDefault();
      void dispatch({ type: 'SetStatsExpanded', expanded: !expanded });
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
              <div class="cg-sp__titles">
                <h2 class="cg-sp__title">{i18n.t('spenders.title')}</h2>
                <span class="cg-sp__sub">
                  {board.pageName === null ? null : <span class="cg-sp__page">{board.pageName}</span>}
                  {/* «1000 из 1240 фанов» when the hub has more than the list holds; else «1240 фанов». */}
                  {board.footer.loaded > 0 ? <span>{board.footer.total !== null && board.footer.total > board.footer.loaded ? i18n.plural('spenders.headOf', board.footer.total, { loaded: board.footer.loaded }) : i18n.plural('common.fans', board.footer.loaded)}</span> : null}
                  {board.footer.stamp.asOf === null ? null : <span>{i18n.t('common.dataAsOf', { time: { time: board.footer.stamp.asOf } })}</span>}
                </span>
              </div>
              {/* SP-024: one «Обновить» for what the window shows of the page — the list and the statistics beside it. */}
              <RefreshButton views={statistics ? BOARD_REFRESH : LIST_REFRESH} />
              <Button
                label={i18n.t('common.close')}
                variant="line"
                size="sm"
                tooltip={i18n.t('spenders.closeTooltip')}
                class="cg-sp__close"
                onClick={closeWindow}
              />
            </header>
            <div class="cg-sp__bar">
              <BoardFilters board={board} />
              <span class="cg-sp__grow" />
              <SearchBox
                value={board.query}
                label={i18n.t('spenders.search.placeholder')}
                placeholder={i18n.t('spenders.search.placeholder')}
                class="cg-sp__search"
                inputRef={searchRef}
                onQuery={(query) => void dispatch({ type: 'Search', list: 'spenders', query })}
                onEnter={searchEnter}
                onArrow={(_direction, query) => searchArrow(query)}
              />
            </div>
          </div>
          {expanded ? (
            <div class="cg-sp__cols is-stats">
              <Boundary surface={null}>
                <StatsExpanded stats={stats} />
              </Boundary>
            </div>
          ) : (
            <div ref={bodyRef} class={`cg-sp__body${preview && !unfold ? ' has-panel' : ''}`}>
              <div class={`cg-sp__cols${statistics ? '' : ' no-stats'}`}>
                <Board board={board} boardRef={boardRef} unfolded={unfold ? unfolded : null} />
                {/* A broken statistics column does not take the board down (ER-020). */}
                {statistics ? <Boundary surface={null}>
                  <StatsColumn stats={stats} onShelf={(shelfId) => {
                    void dispatch({ type: 'RevealShelf', shelfId });
                    boardRef.current?.scrollToShelf(shelfId);
                  }} />
                </Boundary> : null}
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

// The window (X67): the old extension's — 980 px at most over a scrim in the middle of the page, 1240 with the
// statistics column; its head a serif title over a quiet line, «Обновить» and «Закрыть» as buttons; the chips and
// the search a row of their own under it (they wrap in a narrow window). The body: the list (and the statistics
// column); a preview of a fan the list does not show is a panel under them, dragged on its border.
//
// ≤ 680 px — the statistics column gives way; S still opens the statistics in full.
export const SPENDERS_CSS = `
.cg-dialog.cg-dialog--wide.cg-sp {
  top: 50%; translate: -50% -50%; width: min(980px, calc(100vw - 48px)); height: min(880px, calc(100vh - 48px)); max-height: none;
  border-radius: 14px;
}
.cg-dialog.cg-dialog--wide.cg-sp.has-stats { width: min(1240px, calc(100vw - 48px)); }
.cg-sp .cg-sp__top { display: block; flex: none; height: auto; padding: 0; border-bottom: 1px solid var(--cg-rule); }
.cg-sp__head { display: flex; align-items: flex-start; gap: 8px; padding: 16px 16px 12px 22px; }
.cg-sp__titles { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.cg-sp .cg-sp__title { margin: 0; font: 600 var(--cg-text-2xl)/1.2 var(--cg-serif); color: var(--cg-ink-strong); letter-spacing: -0.01em; }
.cg-sp__sub { display: flex; gap: 6px; min-width: 0; font-size: var(--cg-text-sm); color: var(--cg-ink-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cg-sp__sub > * + *::before { content: "·"; margin-right: 6px; }
.cg-sp__head > .cg-sp__refresh { margin: 0; }
.cg-sp__close { flex: none; }
.cg-sp__bar { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 10px; padding: 0 16px 12px 18px; min-width: 0; }
.cg-sp__bar .cg-sp__filters { margin: 0; flex-wrap: wrap; gap: 6px; }
.cg-sp__tiers { display: inline-flex; flex-wrap: wrap; gap: 6px; }
.cg-sp__bar .cg-flt { height: 26px; padding: 0 10px; border-radius: var(--cg-r-pill); background: var(--cg-sunk); color: var(--cg-ink-2); font-weight: 500; }
.cg-sp__bar .cg-flt:hover { background: var(--cg-hover); color: var(--cg-ink-strong); }
.cg-sp__bar .cg-flt[aria-pressed="true"] { background: var(--cg-ink-strong); color: var(--cg-surface); }
.cg-sp__bar .cg-flt[aria-pressed="true"] .cg-flt__n { color: inherit; opacity: 0.75; }
.cg-sp__bar .cg-flt__n { font-family: var(--cg-mono); font-size: var(--cg-text-xs); }
.cg-sp__bar .cg-choice { height: 26px; border-radius: var(--cg-r-pill); }
.cg-sp__bar .cg-sp__search { width: 220px; height: 30px; }
.cg-sp__body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.cg-sp__cols { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 264px; }
.cg-sp__cols.no-stats, .cg-sp__cols.is-stats { grid-template-columns: minmax(0, 1fr); }
.cg-sp__cols > * { min-height: 0; min-width: 0; }
.cg-sp__cols > * + * { border-left: 1px solid var(--cg-rule); }
.cg-sp__split {
  flex: none; height: 9px; margin: -4px 0; position: relative; z-index: 4; cursor: row-resize; touch-action: none;
  background: linear-gradient(var(--cg-rule-2), var(--cg-rule-2)) center / 100% 1px no-repeat;
}
.cg-sp__split:hover, .cg-sp__split:focus-visible { outline: none; background-image: linear-gradient(var(--cg-clay-line), var(--cg-clay-line)); background-size: 100% 3px; }
.cg-sp__panel { flex: none; height: clamp(180px, 46%, 560px); min-height: min(180px, 50%); max-height: calc(100% - 160px); display: flex; flex-direction: column; }
.cg-sp__panel > * { flex: 1; min-height: 0; }
.cg-sp .cg-keys { padding-left: 22px; }
/* A short window (200 % zoom of a laptop) keeps its room for the list and the unfolded preview. */
@media (max-height: 560px) { .cg-sp .cg-keys { display: none; } }
@media (max-width: 760px) {
  .cg-dialog.cg-dialog--wide.cg-sp, .cg-dialog.cg-dialog--wide.cg-sp.has-stats { width: calc(100vw - 16px); height: calc(100vh - 16px); }
  .cg-sp__bar .cg-sp__search { width: 100%; }
}
@media (max-width: 680px) {
  .cg-sp__cols { grid-template-columns: minmax(0, 1fr); }
  .cg-sp__cols > .cg-st { display: none; }
}
${BOARD_CSS}
${STATS_CSS}
`;
