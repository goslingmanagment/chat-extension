// The Spenders window (architecture.md §10.1; ui-design §3.5, §4.14–§4.16,
// §6.3, §6.4; SP-002, SP-019, SP-033, SP-049, SP-050; X65): a modal window
// over the site's container. On top, as wide as the window, the list — with
// the statistics as a compact right column on a site that has them —; under
// it, once a fan is picked, the preview as a panel across the whole width,
// its height dragged on the border between them. The statistics may also be
// expanded in place of both. It renders three view models (`spenders.board`,
// `spenders.stats`, `preview` from `spenders`) and asks for everything
// through UiAction.

import { type JSX, type RefObject, type TargetedKeyboardEvent } from 'preact';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';

import { type SpendersBoardVM } from '@cg/contracts/vm';

import { Boundary, Dialog, OverlayLayer, SearchBox, focusQuietly, isComposing, useDispatch, useI18n, useKit, useView } from '../kit';
import { BOARD_CSS, Board, BoardFilters, focusIsIdle, type BoardHandle } from './Board';
import { PanelPreview, type PreviewFallback } from './preview/PanelPreview';
import { STATS_CSS, StatsColumn, StatsExpanded } from './Stats';
import { RefreshButton, StaleStamp, WindowHeader, isPlainKey, isTextEntry, type RefreshableView } from './window';

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

  const close = useCallback((): void => {
    // Esc in turn: the search, the preview, the window (ui-design §6.4).
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

  return (
    <OverlayLayer>
      <Dialog open label={i18n.t('spenders.title')} size="window" scrim={false} class="cg-sp cg-spw" onClose={close} initialFocus={() => frameRef.current?.querySelector<HTMLElement>('[data-cg-item][tabindex="0"]') ?? null}>
        <div ref={frameRef} class="cg-sp__frame" onKeyDown={onKeyDown}>
          <WindowHeader title={i18n.t('spenders.title')} pageName={board.pageName} onClose={() => void dispatch({ type: 'Navigate', to: { kind: 'surface', surface: 'spenders', open: false } })}>
            <BoardFilters board={board} />
            <span class="cg-sp__grow" />
            <StaleStamp stamp={board.footer.stamp} />
            {/* SP-024: one «Обновить» for what the window shows of the page — the list and the statistics beside it. */}
            <RefreshButton views={statistics ? BOARD_REFRESH : LIST_REFRESH} stamp={board.footer.stamp} />
            <SearchBox
              value={board.query}
              label={i18n.t('spenders.search.placeholder')}
              placeholder={i18n.t('spenders.search.placeholder')}
              class="cg-sp__search"
              inputRef={searchRef}
              onQuery={(query) => void dispatch({ type: 'Search', list: 'spenders', query })}
            />
          </WindowHeader>
          {expanded ? (
            <div class="cg-sp__cols is-stats">
              <Boundary surface={null}>
                <StatsExpanded stats={stats} />
              </Boundary>
            </div>
          ) : (
            <div ref={bodyRef} class={`cg-sp__body${preview ? ' has-panel' : ''}`}>
              <div class={`cg-sp__cols${statistics ? '' : ' no-stats'}`}>
                <Board board={board} boardRef={boardRef} />
                {/* A broken statistics column does not take the board down (ER-020). */}
                {statistics ? <Boundary surface={null}>
                  <StatsColumn stats={stats} onShelf={(shelfId) => {
                    void dispatch({ type: 'RevealShelf', shelfId });
                    boardRef.current?.scrollToShelf(shelfId);
                  }} />
                </Boundary> : null}
              </div>
              {preview ? (
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
        </div>
      </Dialog>
    </OverlayLayer>
  );
}

// The window's body (X65): the list (and the statistics column) on top, the preview panel under it across the
// whole width. The panel opens at about half of the body and is dragged on its border; the list keeps 160 px.
// The notes stand here and not in the sheet: a comment inside the string ships with the chunk, and the Spenders
// surface has a budget (packages/testing/src/boards/size.test.ts).
//
// ≤ 900 px — the browser's zoom of 150–200 % on a laptop (ui-design §11): the header's filters take a line of
// their own under the title and the search.
// ≤ 680 px — the list needs about 380 px to keep its columns apart, so the statistics column gives way; S still
// opens the statistics in full.
export const SPENDERS_CSS = `
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
@media (max-width: 1360px) {
  .cg-sp__cols { grid-template-columns: minmax(0, 1fr) 240px; }
}
@media (max-width: 900px) {
  .cg-sp__top { flex-wrap: wrap; height: auto; padding-block: 10px; row-gap: 6px; }
  .cg-sp__filters { order: 1; width: 100%; margin: 0; }
}
@media (max-width: 680px) {
  .cg-sp__cols { grid-template-columns: minmax(0, 1fr); }
  .cg-sp__cols > .cg-st { display: none; }
}
${BOARD_CSS}
${STATS_CSS}
`;
