// The Spenders window (architecture.md §10.1; ui-design §3.5, §4.14–§4.16,
// §6.3, §6.4; SP-002, SP-019, SP-033, SP-049, SP-050): a modal window over
// ChatSpace's container with the list on the left and widest, the preview of
// the selected fan, and the statistics as a compact right column — or
// expanded in place of the list and the preview. It renders three view
// models (`spenders.board`, `spenders.stats`, `preview` from `spenders`) and
// asks for everything through UiAction.

import { type JSX, type TargetedKeyboardEvent } from 'preact';
import { useCallback, useEffect, useLayoutEffect, useRef } from 'preact/hooks';

import { type SpendersPeriod } from '@cg/contracts/vm';

import { Boundary, Dialog, OverlayLayer, SearchBox, Tabs, focusQuietly, isComposing, useDispatch, useI18n, useKit, useView } from '../kit';
import { BOARD_CSS, Board, PERIOD_KEYS, focusIsIdle, type BoardHandle } from './Board';
import { Preview } from './preview/Preview';
import { STATS_CSS, StatsColumn, StatsExpanded } from './Stats';
import { WindowHeader, isPlainKey, isTextEntry } from './window';

/** Marks of the paints the UI reports; the controller starts the measure, the UI ends it (RenderMarks). */
export const SPENDERS_PAINT_MARKS = { open: 'spenders.board', search: 'spenders.search' } as const;

export function SpendersWindow(): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const { root, deps } = useKit();
  const board = useView({ of: 'spenders.board' }).value;
  const stats = useView({ of: 'spenders.stats' }).value;
  const statistics = board.statistics !== false;
  const expanded = statistics && stats.expanded;
  const boardRef = useRef<BoardHandle>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const hasRows = board.shelves.some((shelf) => shelf.rows.length > 0);

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

  const columns = expanded ? 'is-stats' : board.previewOpen ? 'is-preview' : 'is-list';

  return (
    <OverlayLayer>
      <Dialog open label={i18n.t('spenders.title')} size="window" scrim={false} class="cg-sp cg-spw" onClose={close} initialFocus={() => frameRef.current?.querySelector<HTMLElement>('[data-cg-item][tabindex="0"]') ?? null}>
        <div ref={frameRef} class="cg-sp__frame" onKeyDown={onKeyDown}>
          <WindowHeader title={i18n.t('spenders.title')} pageName={board.pageName} onClose={() => void dispatch({ type: 'Navigate', to: { kind: 'surface', surface: 'spenders', open: false } })}>
            <Tabs<SpendersPeriod>
              label={i18n.t('spenders.period.label')}
              tabs={board.periods.map((period) => ({ value: period, label: i18n.t(PERIOD_KEYS[period]) }))}
              value={board.period}
              onChange={(period) => void dispatch({ type: 'SetSpendersPeriod', period })}
            />
            <span class="cg-sp__grow" />
            <SearchBox
              value={board.query}
              label={i18n.t('spenders.search.placeholder')}
              placeholder={i18n.t('spenders.search.placeholder')}
              class="cg-sp__search"
              inputRef={searchRef}
              onQuery={(query) => void dispatch({ type: 'Search', list: 'spenders', query })}
            />
          </WindowHeader>
          <div class={`cg-sp__cols ${columns}${statistics ? '' : ' no-stats'}`}>
            {expanded ? (
              <Boundary surface={null}>
                <StatsExpanded stats={stats} />
              </Boundary>
            ) : (
              <>
                <Board board={board} boardRef={boardRef} />
                {board.previewOpen ? (
                  <Boundary surface={null}>
                    <Preview from="spenders" />
                  </Boundary>
                ) : null}
                {/* A broken statistics column does not take the board down (ER-020). */}
                {statistics ? <Boundary surface={null}>
                  <StatsColumn stats={stats} onShelf={(shelfId) => {
                    void dispatch({ type: 'RevealShelf', shelfId });
                    boardRef.current?.scrollToShelf(shelfId);
                  }} />
                </Boundary> : null}
              </>
            )}
          </div>
        </div>
      </Dialog>
    </OverlayLayer>
  );
}

// The two narrow-window rules (their notes stand here and not in the sheet: a comment inside the string ships
// with the chunk, and the Spenders surface has a budget — packages/testing/src/boards/size.test.ts).
//
// ≤ 1120 px — the browser's zoom of 150–200 % on a laptop (ui-design §11). The list needs about 400 px to keep
// its columns apart; a preview no longer leaves that next to the statistics: while a preview is open the
// statistics column gives way (S still opens the statistics in full; closing the preview brings the column back).
//
// ≤ 860 px — the list and the preview do not fit side by side either: one column, read top to bottom — the list
// in a window of its own, then the preview, then the statistics. The column scrolls; a list or a feed at its end
// hands the wheel on to it. The header puts the period tabs on a line of their own.
export const SPENDERS_CSS = `
.cg-sp__cols { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 264px; }
.cg-sp__cols.is-preview { grid-template-columns: minmax(0, 1fr) 420px 264px; }
.cg-sp__cols.no-stats { grid-template-columns: minmax(0, 1fr); }
.cg-sp__cols.no-stats.is-preview { grid-template-columns: minmax(0, 1fr) 420px; }
.cg-sp__cols.is-stats { grid-template-columns: minmax(0, 1fr); }
.cg-sp__cols > * { min-height: 0; min-width: 0; }
.cg-sp__cols > * + * { border-left: 1px solid var(--cg-rule); }
@media (max-width: 1360px) {
  .cg-sp__cols { grid-template-columns: minmax(0, 1fr) 240px; }
  .cg-sp__cols.is-preview { grid-template-columns: minmax(0, 1fr) 392px 240px; }
}
@media (max-width: 1120px) {
  .cg-sp__cols.is-preview { grid-template-columns: minmax(0, 1fr) 392px; }
  .cg-sp__cols.is-preview > .cg-st { display: none; }
}
@media (max-width: 860px) {
  .cg-sp__cols, .cg-sp__cols.is-preview { display: flex; flex-direction: column; overflow-y: auto; scrollbar-width: thin; }
  .cg-sp__cols > * { flex: none; }
  .cg-sp__cols > * + * { border-left: 0; border-top: 1px solid var(--cg-rule); }
  .cg-sp__cols > .cg-bd { height: 100%; min-height: 240px; }
  .cg-sp__cols.is-preview > .cg-bd { height: 56%; min-height: 220px; }
  .cg-sp__cols.is-preview > .cg-st { display: block; }
  .cg-sp__cols > .cg-st, .cg-sp__cols > .cg-stx { overflow-y: visible; }
  .cg-sp__cols > .cg-pv .cg-feed { flex: 0 0 200px; }
  .cg-sp__cols .cg-vlist, .cg-sp__cols .cg-feed, .cg-sp__cols .cg-pv__work { overscroll-behavior: auto; }
  .cg-spw .cg-sp__top { display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; grid-template-rows: 52px auto; height: auto; column-gap: 12px; }
  .cg-spw .cg-sp__title { grid-area: 1 / 1; }
  .cg-spw .cg-sp__page { grid-area: 1 / 2; }
  .cg-spw .cg-sp__top .cg-sp__search { grid-area: 1 / 3; }
  .cg-spw .cg-sp__close { grid-area: 1 / 4; }
  .cg-spw .cg-sp__top .cg-tabs { grid-area: 2 / 1 / 3 / -1; margin: 0 0 8px -8px; overflow-x: auto; scrollbar-width: none; }
  .cg-spw .cg-sp__grow { display: none; }
}
${BOARD_CSS}
${STATS_CSS}
`;
