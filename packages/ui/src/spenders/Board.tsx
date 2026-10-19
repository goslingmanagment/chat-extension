// The Spenders board (ui-design §3.5, §4.14, §6.1, §6.4; SP-008…SP-021,
// SP-033, SP-034; X65): the list owns the top of the window and its whole
// width — a sticky column header with «Всё время», the period's menu and
// «Ждёт» (the two sort buttons), thin shelf dividers, fans. Its filters stand
// in the window's header (BoardFilters), its «Обновить» too; the footer
// speaks only when something is missing or a search narrows the list. Only
// the rows in view are in the DOM (≤ 150 for a thousand). Everything comes
// from SpendersBoardVM; a failed read is an error card with «Повторить», never
// an empty list (SP-029). «Фан ждёт ответа» is the bold age in «Ждёт» and
// nothing else: no dot, no colour; a fan we wrote to last reads «мы 18 ч».

import { type JSX, type Ref, type TargetedKeyboardEvent } from 'preact';
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'preact/hooks';

import { type I18nKey } from '@cg/contracts/errors';
import { type I18n, type ShelfVM, type SpenderRowVM, type SpendersBoardVM, type SpendersFilter, type SpendersPeriod, type UiAction } from '@cg/contracts/vm';

import {
  ActionButton,
  Money,
  Spinner,
  ViewState,
  VirtualList,
  activeIn,
  isComposing,
  useAnnounce,
  useDispatch,
  useHints,
  useI18n,
  useMinuteClock,
  useSpokenMoney,
  useTooltip,
} from '../kit';
import { BatchBar, BatchCheck, BatchCheckAll, BatchLine, inBatch } from './batch';
import { bothAges } from './preview/Preview';
import { rowKeyOf, useRowFocus } from './rowFocus';
import { BOARD_HEIGHTS, boardItemHeight, boardItems, edgeStop, initialStop, isStop, nextStop, shelfLabel, type BoardItem } from './rows';
import { ChoiceMenu, FilterChip, ageOrUnknown, coverageWord, isPlainKey } from './window';

export const PERIOD_KEYS: Readonly<Record<SpendersPeriod, I18nKey>> = {
  lifetime: 'spenders.period.lifetime',
  '30d': 'spenders.period.d30',
  mtd: 'spenders.period.month',
  '7d': 'spenders.period.d7',
  today: 'spenders.period.today',
};

/** The chips of the list (ui-design §4.14); the others go into «Ещё» — one row, as the old clients had (SP-020). */
const PRIMARY_FILTERS: readonly SpendersFilter[] = ['all', 'waiting', 'new'];
/** «Фан писал» is «Ждут ответа» under another name: a second chip with the same count only adds noise. */
const SAME_AS_WAITING: SpendersFilter = 'fan-wrote';
/** Ask for the next page this many rows before the end of the loaded list. */
const LOAD_MORE_MARGIN = 20;

type FilterVM = SpendersBoardVM['filters'][number];

/** The chips in the header and the rest in «Ещё»; «Фан писал» stays out while «Ждут ответа» is a chip. */
function splitFilters(board: SpendersBoardVM): { readonly primary: readonly FilterVM[]; readonly secondary: readonly FilterVM[]; readonly secondaryOn: readonly FilterVM[] } {
  const primary = board.filters.filter((filter) => PRIMARY_FILTERS.includes(filter.id));
  const hasWaiting = primary.some((filter) => filter.id === 'waiting');
  const secondary = board.filters.filter((filter) => !PRIMARY_FILTERS.includes(filter.id) && !(hasWaiting && filter.id === SAME_AS_WAITING && !filter.pressed));
  return { primary, secondary, secondaryOn: secondary.filter((filter) => filter.pressed) };
}

export interface BoardHandle {
  /** Scrolls the list to a shelf's header row (a click on a shelf in the statistics, SP-045). */
  scrollToShelf(shelfId: string): void;
  /** Puts focus on the keyboard's current row (the window opened, a preview closed). */
  focusActiveRow(): boolean;
}

export interface BoardProps {
  readonly board: SpendersBoardVM;
  readonly boardRef?: Ref<BoardHandle>;
}

function openPreview(handle: string): UiAction {
  return { type: 'OpenPreview', targetHandle: handle };
}

function openChat(handle: string): UiAction {
  return { type: 'Navigate', to: { kind: 'chat', targetHandle: handle } };
}

function SortButton({ label, short, tooltip, sorted, arrow, onSort }: { readonly label: string; readonly short: string; readonly tooltip: string; readonly sorted: boolean; readonly arrow: string; readonly onSort: () => void }): JSX.Element {
  const hints = useHints();
  const tip = useTooltip(hints ? tooltip : null);
  return (
    <>
      <button type="button" class={`cg-bd__sort${sorted ? ' is-sorted' : ''}`} {...tip.props} onClick={onSort}>
        <span class="cg-lbl-long">{label}</span>
        <span class="cg-lbl-short">{short}</span>
        {sorted ? <span aria-hidden="true"> {arrow}</span> : null}
      </button>
      {tip.description}
    </>
  );
}

/** The period of the second sum: a quiet menu in its own column header (X65), as the old clients' select. */
function PeriodHeader({ board }: { readonly board: SpendersBoardVM }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const label = i18n.t(PERIOD_KEYS[board.period]);
  if (board.periods.length < 2) return <span>{label}</span>;
  return (
    <ChoiceMenu
      label={label}
      menuLabel={i18n.t('spenders.period.label')}
      items={board.periods.map((period) => ({ id: period, label: i18n.t(PERIOD_KEYS[period]), checked: period === board.period }))}
      class="cg-bd__period"
      align="end"
      onSelect={(id) => {
        const period = board.periods.find((item) => item === id);
        if (period !== undefined && period !== board.period) void dispatch({ type: 'SetSpendersPeriod', period });
      }}
    />
  );
}

function ColumnHeader({ board, handles }: { readonly board: SpendersBoardVM; readonly handles: readonly string[] }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const bySum = board.sort === 'sum';
  return (
    <div class="cg-bd__grid cg-bd__colhead" role="row" aria-rowindex={1}>
      <span role="columnheader" class="cg-bd__who">
        {board.batch === undefined ? null : <BatchCheckAll list="spenders" handles={handles} batch={board.batch} />}
        {i18n.t('spenders.col.fan')}
      </span>
      <span role="columnheader" class="cg-bd__last">
        {i18n.t('spenders.col.lastMessage')}
      </span>
      <span role="columnheader" class="cg-bd__num" aria-sort={bySum ? 'descending' : 'none'}>
        <SortButton
          label={i18n.t('spenders.col.lifetime')}
          short={i18n.t('spenders.col.lifetimeShort')}
          tooltip={i18n.t('spenders.sort.sumTooltip')}
          sorted={bySum}
          arrow="↓"
          onSort={() => void dispatch({ type: 'SetSpendersSort', sort: 'sum' })}
        />
      </span>
      <span role="columnheader" class="cg-bd__num cg-bd__perhead">
        <PeriodHeader board={board} />
      </span>
      <span role="columnheader" class="cg-bd__num" aria-sort={bySum ? 'none' : 'ascending'}>
        <SortButton
          label={i18n.t('spenders.col.waits')}
          short={i18n.t('spenders.col.waits')}
          tooltip={i18n.t('spenders.sort.fanAgeTooltip')}
          sorted={!bySum}
          arrow="↑"
          onSort={() => void dispatch({ type: 'SetSpendersSort', sort: 'fan-age' })}
        />
      </span>
    </div>
  );
}

/** A shelf is a thin divider (X65): its name from the tier bounds and its fans; its sums are the statistics'. */
function ShelfRow({ shelf, rowIndex }: { readonly shelf: ShelfVM; readonly rowIndex: number }): JSX.Element {
  const i18n = useI18n();
  const label = shelfLabel(i18n, shelf.range);
  return (
    <div class="cg-bd__shelf" role="rowgroup" aria-label={label}>
      <div class="cg-bd__shelfrow" role="row" aria-rowindex={rowIndex}>
        <span role="rowheader" class="cg-bd__shelfname">
          {label}
          {shelf.fans === null ? null : <span class="cg-bd__shelfn cg-num">{shelf.fans}</span>}
        </span>
      </div>
    </div>
  );
}

/**
 * «Ждёт» (X65): who waits and how long. The fan wrote last — their age in strong ink («11 ч»); we wrote last —
 * «мы 18 ч» in muted ink; nothing known — «—». The tooltip gives both ages (SP-017).
 */
export function waitCell(i18n: I18n, row: SpenderRowVM): { readonly text: string; readonly waiting: boolean; readonly tooltip: string | null } {
  const ages = bothAges(i18n, row);
  if (row.waiting) {
    const says = i18n.t('spenders.waitingTooltip');
    return { text: ageOrUnknown(i18n, row.fanWroteAt), waiting: true, tooltip: ages === null ? says : `${says}. ${ages}` };
  }
  if (row.weWroteAt !== null) return { text: i18n.t('spenders.wait.ours', { age: { age: row.weWroteAt } }), waiting: false, tooltip: ages };
  return { text: ageOrUnknown(i18n, row.fanWroteAt), waiting: false, tooltip: ages };
}

interface FanRowProps {
  readonly row: SpenderRowVM;
  /** The row's key in the list: what the keyboard's row is remembered by. */
  readonly itemKey: string;
  readonly index: number;
  readonly rowIndex: number;
  readonly active: boolean;
  readonly onPick: (key: string) => void;
}

function FanRow({ row, itemKey, index, rowIndex, active, onPick }: FanRowProps): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  // The @handle is the tooltip's and the preview's (X65): in the row it only made the names ragged.
  const fullName = row.username === null ? row.name : `${row.name} @${row.username}`;
  const who = useTooltip(fullName);
  const wait = waitCell(i18n, row);
  const waitTip = useTooltip(wait.tooltip);
  // The second sum is plain ink (X65): green is income in the statistics and the preview, not a column of it.
  const period = useSpokenMoney(row.period);
  const classes = ['cg-bd__grid', 'cg-bd__row', row.selected ? 'is-sel' : '', row.deleted ? 'is-deleted' : '', inBatch(row) ? 'has-batch' : ''].filter((name) => name !== '').join(' ');
  return (
    <div
      class={classes}
      role="row"
      aria-rowindex={rowIndex}
      {...(row.selected ? { 'aria-current': 'true' as const } : {})}
      tabIndex={active ? 0 : -1}
      data-cg-item={index}
      data-cg-key={itemKey}
      data-cg-fan={row.handle}
      onClick={() => {
        onPick(itemKey);
        void dispatch(openPreview(row.handle));
      }}
      onFocus={() => onPick(itemKey)}
    >
      <span role="cell" class="cg-bd__who" {...who.props}>
        {row.batch === undefined ? null : <BatchCheck list="spenders" handle={row.handle} row={row.batch} name={row.name} />}
        <span class="cg-bd__name">{row.name}</span>
        {row.deleted ? <span class="cg-bd__tag">{i18n.t('spenders.tag.deleted')}</span> : null}
        {who.description}
      </span>
      <span role="cell" class="cg-bd__last">
        {row.lastMessage === null ? null : row.lastMessage.fromUs ? `${i18n.t('spenders.ourPrefix')} ${row.lastMessage.text}` : row.lastMessage.text}
      </span>
      <Money mills={row.lifetime} cell class="cg-bd__num cg-bd__life" />
      <span role="cell" class={`cg-bd__num cg-bd__per cg-num${row.period === null ? ' is-unknown' : ''}`} {...(period === null ? {} : { 'aria-label': period })}>
        {i18n.formatMoneyMills(row.period)}
      </span>
      <span role="cell" class={`cg-bd__num cg-bd__age cg-num${wait.waiting ? ' is-wait' : ''}`} {...waitTip.props}>
        {wait.text}
        {waitTip.description}
      </span>
      {row.batch === undefined ? null : <BatchLine row={row.batch} />}
    </div>
  );
}

function MoreRow({ item, index, rowIndex, active, onPick }: { readonly item: Extract<BoardItem, { kind: 'more' }>; readonly index: number; readonly rowIndex: number; readonly active: boolean; readonly onPick: (key: string) => void }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const reveal = item.shelf.collapsed?.reveal;
  return (
    <div class="cg-bd__more" role="row" aria-rowindex={rowIndex}>
      <span role="cell">
        <button
          type="button"
          class="cg-bd__morebtn"
          tabIndex={active ? 0 : -1}
          data-cg-item={index}
          data-cg-key={item.key}
          onFocus={() => onPick(item.key)}
          onClick={() => {
            if (reveal !== undefined && reveal.enabled) void dispatch(reveal.action);
          }}
        >
          {i18n.t('spenders.shelfMore', { n: item.hidden })}
        </button>
      </span>
    </div>
  );
}

function FilterButton({ filter }: { readonly filter: FilterVM }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  return <FilterChip label={i18n.text(filter.label)} count={filter.count} pressed={filter.pressed} onPress={() => void dispatch({ type: 'SetSpendersFilter', filter: filter.id })} />;
}

/**
 * The list's filters in the window's header (X65): «Все», «Ждут ответа», «Новые» with their counts, the rest in
 * «Ещё», and the spinner while a new list is read over the one shown.
 */
export function BoardFilters({ board }: { readonly board: SpendersBoardVM }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const { primary, secondary, secondaryOn } = splitFilters(board);
  const hasRows = board.shelves.some((shelf) => shelf.rows.length > 0);
  return (
    <div class="cg-sp__filters">
      {primary.map((filter) => (
        <FilterButton key={filter.id} filter={filter} />
      ))}
      {secondary.length === 0 ? null : (
        <ChoiceMenu
          label={secondaryOn.length === 0 ? i18n.t('dock.action.more') : secondaryOn.map((filter) => i18n.text(filter.label)).join(' · ')}
          menuLabel={i18n.t('dock.action.more')}
          pressed={secondaryOn.length > 0}
          items={secondary.map((filter) => ({ id: filter.id, label: i18n.text(filter.label), count: filter.count, checked: filter.pressed }))}
          onSelect={(id) => {
            const filter = secondary.find((item) => item.id === id);
            if (filter !== undefined) void dispatch({ type: 'SetSpendersFilter', filter: filter.id });
          }}
        />
      )}
      {board.view.s === 'loading' && hasRows ? <Spinner label={i18n.t('common.loading')} /> : null}
    </div>
  );
}

function truncation(board: SpendersBoardVM): { readonly shown: number; readonly total: number | null } | null {
  if (board.view.s !== 'partial') return null;
  for (const gap of board.view.gaps) if (gap.kind === 'truncated') return { shown: gap.shown, total: gap.total };
  return null;
}

export function Board({ board, boardRef }: BoardProps): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const announce = useAnnounce();
  // One minute ticker for every age in the list («3 ч», «19 д»).
  useMinuteClock(true);

  const items = useMemo(() => boardItems(board.shelves), [board.shelves]);
  const handles = useMemo(() => items.flatMap((item) => (item.kind === 'fan' ? [item.row.handle] : [])), [items]);
  // The keyboard's row is a fan (or «ещё N»), remembered by its key and never by its place: the list changes
  // under the person — a refresh, a fan who wrote and moved up — and the row must stay on its fan.
  const [activeKey, setActiveKey] = useState<string | null>(() => items[initialStop(items)]?.key ?? null);
  const askedMore = useRef(-1);

  // It survives a new list as long as its fan is still there; else it goes back to the start.
  const current = useMemo(() => {
    const at = activeKey === null ? -1 : items.findIndex((item) => item.key === activeKey);
    return at >= 0 && isStop(items[at]) ? at : initialStop(items);
  }, [items, activeKey]);
  const currentKey = items[current]?.key ?? null;
  useEffect(() => {
    if (currentKey !== activeKey) setActiveKey(currentKey);
  }, [currentKey, activeKey]);
  const { wrapRef, listRef, focusRow, settle } = useRowFocus(currentKey);

  const move = (from: number, to: number): void => {
    const item = items[to];
    if (item === undefined || to === from) return;
    setActiveKey(item.key);
    focusRow(to, item.key);
  };

  useImperativeHandle(
    boardRef ?? null,
    () => ({
      scrollToShelf(shelfId) {
        const index = items.findIndex((item) => item.kind === 'shelf' && item.shelf.id === shelfId);
        if (index >= 0) listRef.current?.scrollToIndex(index, 'start');
      },
      focusActiveRow() {
        if (currentKey === null) return false;
        focusRow(current, currentKey);
        return true;
      },
    }),
    [items, current, currentKey, focusRow, listRef],
  );

  // «Показано 7» is said, not only printed (ui-design §6.2).
  const shown = board.footer.shown;
  const announced = useRef(shown);
  useEffect(() => {
    if (shown !== null && shown !== announced.current) announce(i18n.t('spenders.footerShown', { n: shown }).replace(/^[\s.]+/, ''));
    announced.current = shown;
  }, [shown, announce, i18n]);

  const onRange = useCallback(
    (_start: number, end: number): void => {
      settle();
      if (board.canLoadMore && end >= items.length - LOAD_MORE_MARGIN && askedMore.current !== items.length) {
        askedMore.current = items.length;
        void dispatch({ type: 'LoadMore', list: 'spenders' });
      }
    },
    [board.canLoadMore, items.length, dispatch, settle],
  );

  const onKeyDown = (event: TargetedKeyboardEvent<HTMLDivElement>): void => {
    if (event.defaultPrevented || isComposing(event) || !isPlainKey(event)) return;
    // The list's keys work on its rows, not inside the header's sort buttons.
    const key = rowKeyOf(event.target);
    if (key === null) return;
    // They act on the row that HAS focus, found by its key in the list as it is now — never on a remembered
    // place: after a change above it that place holds another fan, and Enter would open (and mark read) a chat
    // the person did not choose.
    const at = items.findIndex((entry) => entry.key === key);
    const item = items[at];
    if (item === undefined) return;
    // Letters go by the physical key, so J/K and O work on any layout (SP-033).
    switch (event.code) {
      case 'ArrowDown':
      case 'KeyJ':
        event.preventDefault();
        move(at, nextStop(items, at, 1));
        return;
      case 'ArrowUp':
      case 'KeyK':
        event.preventDefault();
        move(at, nextStop(items, at, -1));
        return;
      case 'Home':
        event.preventDefault();
        move(at, edgeStop(items, 1));
        return;
      case 'End':
        event.preventDefault();
        move(at, edgeStop(items, -1));
        return;
      case 'Enter':
      case 'NumpadEnter':
      case 'KeyO':
        if (item.kind !== 'fan') return;
        event.preventDefault();
        // Opening the chat is the person's own act: ChatSpace marks it read (А7); the controller closes the board (SP-035).
        void dispatch(openChat(item.row.handle));
        return;
      case 'Space':
        if (item.kind !== 'fan') return;
        event.preventDefault();
        void dispatch(openPreview(item.row.handle));
        return;
      default:
    }
  };

  const { secondaryOn } = splitFilters(board);
  // A search or a filter of «Ещё» narrows the list: the footer says how many are shown and offers the way back.
  // A chip of the header is a view of its own, and «Все» stands next to it.
  const narrowed = board.query !== '' || secondaryOn.length > 0;
  const cut = truncation(board);
  const coverage = coverageWord(i18n, board.footer.stamp.coverage);
  // «40 фанов» when everything is here; «из», the coverage only when something is missing.
  const whole = board.footer.stamp.coverage === 'complete' && (board.footer.total === null || board.footer.total === board.footer.loaded);
  const loaded = whole
    ? i18n.plural('common.fans', board.footer.loaded)
    : board.footer.total === null
      ? i18n.plural('spenders.footerNoTotal', board.footer.loaded, { coverage })
      : i18n.plural('spenders.footer', board.footer.total, { loaded: board.footer.loaded, coverage });
  const footerText = shown === null || !narrowed ? loaded : `${loaded}${i18n.t('spenders.footerShown', { n: shown })}`;
  const hasRows = items.length > 0;
  const fallback = board.waitingFallback ?? null;
  const showList = hasRows && board.view.s !== 'error' && board.view.s !== 'forbidden' && board.view.s !== 'empty';
  return (
    <section class="cg-bd" aria-label={i18n.t('spenders.boardLabel')} data-cg-board={board.view.s}>
      {board.batch === undefined ? null : <BatchBar list="spenders" batch={board.batch} />}
      {board.view.s === 'offline' ? (
        <div class="cg-bd__banner">
          <ViewState view={board.view} />
        </div>
      ) : null}
      {/* 1.5.0, SP-029: «Ждут ответа» is the hub's queue; when its read failed the rows below are the tab's own filter. */}
      {fallback === null ? null : (
        <div class="cg-bd__banner" data-cg-waiting-fallback={fallback.error.code}>
          <ViewState view={{ s: 'error', ...fallback }} />
          <div class="cg-sp__line" role="status">
            {i18n.t('spenders.waitingLocal')}
          </div>
        </div>
      )}
      {showList ? (
        <div class="cg-bd__list" ref={wrapRef}>
          <VirtualList
            items={items}
            rowHeight={boardItemHeight}
            getKey={(item) => item.key}
            role="table"
            label={i18n.t('spenders.boardLabel')}
            class="cg-bd__scroll"
            header={<ColumnHeader board={board} handles={handles} />}
            headerHeight={BOARD_HEIGHTS.header}
            isGroupHeader={(item) => item.kind === 'shelf'}
            listRef={listRef}
            onRangeChange={onRange}
            onKeyDown={onKeyDown}
            renderRow={(item, index) => {
              // Row 1 is the column header.
              const rowIndex = index + 2;
              switch (item.kind) {
                case 'gap':
                  return null;
                case 'shelf':
                  return <ShelfRow shelf={item.shelf} rowIndex={rowIndex} />;
                case 'fan':
                  return <FanRow row={item.row} itemKey={item.key} index={index} rowIndex={rowIndex} active={index === current} onPick={setActiveKey} />;
                case 'more':
                  return <MoreRow item={item} index={index} rowIndex={rowIndex} active={index === current} onPick={setActiveKey} />;
              }
            }}
          />
        </div>
      ) : (
        <div class="cg-sp__state cg-bd__state">
          {board.view.s === 'offline' ? null : <ViewState view={board.view} />}
          {board.reset === null ? null : (
            <div class="cg-bd__reset">
              <ActionButton vm={board.reset} variant="line" />
            </div>
          )}
        </div>
      )}
      {cut === null ? null : (
        <div class="cg-sp__line" role="status">
          {cut.total === null ? i18n.t('spenders.truncatedNoTotal', { shown: cut.shown }) : i18n.t('spenders.truncated', { shown: cut.shown, total: cut.total })}
        </div>
      )}
      {/* SP-021: what is loaded and shown — only when something is missing or a search narrows the list (X65). */}
      {whole && !narrowed ? null : (
        <div class="cg-sp__foot">
          <span>{footerText}</span>
          {showList && narrowed && board.reset !== null ? <ActionButton vm={board.reset} variant="plain" size="sm" /> : null}
        </div>
      )}
    </section>
  );
}

/** Whether focus is on the window itself (nothing inside chosen yet), so a list that just arrived may take it. */
export function focusIsIdle(root: ShadowRoot | Document, box: HTMLElement | null): boolean {
  const focused = activeIn(root);
  return focused === null || focused === box;
}

// The row's check box (1.32.0) shows under the pointer, on the keyboard's row and while anyone is ticked: an empty
// box on every row was a column of noise (X65). The column header's «Отметить всех» follows the same rule.
export const BOARD_CSS = `
.cg-bd { display: flex; flex-direction: column; min-height: 0; min-width: 0; container: cgboard / inline-size; }
.cg-bd__list { flex: 1; min-height: 0; min-width: 0; }
.cg-bd__state { padding: 0; }
.cg-bd__state .cg-state--empty { justify-content: flex-start; text-align: left; padding: 24px 20px; }
.cg-bd__reset { padding: 0 20px 16px 12px; }
.cg-bd__banner { flex: none; border-bottom: 1px solid var(--cg-rule); }
.cg-bd__grid {
  display: grid; grid-template-columns: minmax(0, 1fr) 0 96px 88px 80px; align-items: center; column-gap: 0; padding: 0 16px 0 20px;
}
.cg-bd__grid > * { min-width: 0; white-space: nowrap; }
.cg-bd__num { text-align: right; padding-left: 12px; overflow: hidden; text-overflow: ellipsis; }
.cg-bd__colhead { height: 28px; grid-template-rows: 28px; border-bottom: 1px solid var(--cg-rule); font-size: var(--cg-text-sm); color: var(--cg-ink-muted); }
.cg-bd__sort { height: 28px; max-width: 100%; border-radius: 4px; color: inherit; font: inherit; text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cg-bd__sort:hover, .cg-bd__sort.is-sorted { color: var(--cg-ink-strong); }
.cg-bd__sort.is-sorted { font-weight: 500; }
.cg-bd__perhead { overflow: visible; display: flex; justify-content: flex-end; }
.cg-bd__colhead .cg-bd__period { height: 24px; padding: 0 0 0 4px; margin-right: -2px; gap: 2px; font: inherit; color: inherit; }
.cg-bd__period:is(:hover, [aria-expanded="true"]) { color: var(--cg-ink-strong); background: none; }
.cg-bd__colhead .cg-menu { z-index: 6; font-size: var(--cg-text-base); text-align: left; }
.cg-lbl-short { display: none; }
.cg-bd__shelf, .cg-bd__shelfrow { height: 28px; }
.cg-bd__shelfrow {
  display: flex; align-items: center; gap: 10px; padding: 0 16px 0 20px; background: var(--cg-surface);
  font-size: var(--cg-text-sm); color: var(--cg-ink-muted); font-variant-numeric: tabular-nums;
}
.cg-bd__shelfrow::after { content: ""; flex: 1; height: 1px; background: var(--cg-rule); }
.cg-bd__shelfname { flex: none; font-weight: 500; color: var(--cg-ink-2); white-space: nowrap; }
.cg-bd__shelfn { font-weight: 400; color: var(--cg-ink-muted); margin-left: 6px; }
.cg-bd__row { height: 36px; font-variant-numeric: tabular-nums; cursor: default; }
.cg-bd__row:hover { background: var(--cg-sunk); }
.cg-bd__row:focus-visible { background: var(--cg-hover); outline-offset: -2px; }
.cg-bd__row.has-batch { height: 54px; grid-template-rows: 30px 18px; align-content: center; }
.cg-bd__row.is-sel, .cg-bd__row.is-sel:hover, .cg-bd__row.is-sel:focus-visible { background: var(--cg-sel); }
.cg-bd__who { display: flex; align-items: center; gap: 8px; }
.cg-bd__who .cg-bt__check { margin-right: 0; }
.cg-bd:not(:has(.cg-bt__check[aria-checked="true"])) :is(.cg-bd__row, .cg-bd__colhead):not(:hover, :focus-within, .has-batch) .cg-bt__check { visibility: hidden; }
.cg-bd__name { font-weight: 500; color: var(--cg-ink); overflow: hidden; text-overflow: ellipsis; flex: 0 1 auto; min-width: 48px; }
.cg-bd__tag { flex: none; font-size: var(--cg-text-sm); color: var(--cg-ink-2); }
.cg-bd__row.is-deleted .cg-bd__name { color: var(--cg-ink-muted); font-weight: 400; }
.cg-bd__row.is-deleted .cg-bd__tag { color: var(--cg-ink-muted); }
.cg-bd__life { color: var(--cg-ink); font-weight: 500; }
.cg-bd__per { color: var(--cg-ink-muted); }
.cg-bd__per.is-unknown { color: var(--cg-ink-faint); }
.cg-bd__age { color: var(--cg-ink-muted); }
.cg-bd__age.is-wait { color: var(--cg-ink-strong); font-weight: 500; }
.cg-bd__last { display: block; overflow: hidden; visibility: hidden; color: var(--cg-ink-muted); text-overflow: ellipsis; }
.cg-bd__more { display: flex; align-items: center; height: 32px; padding: 0 16px 0 12px; }
.cg-bd__morebtn { height: 24px; padding: 0 8px; border-radius: var(--cg-r-sm); color: var(--cg-ink-muted); font-size: var(--cg-text-sm); }
.cg-bd__morebtn:hover { background: var(--cg-hover); color: var(--cg-ink-strong); }
.cg-bd > .cg-sp__foot .cg-btn { margin-right: -8px; }
@container cgboard (max-width: 620px) {
  .cg-bd__grid { grid-template-columns: minmax(0, 1fr) 0 76px 68px 64px; padding: 0 12px 0 16px; }
  .cg-bd__num { padding-left: 4px; }
  .cg-lbl-long { display: none; }
  .cg-lbl-short { display: inline; }
}
@container cgboard (min-width: 860px) {
  .cg-bd__grid { grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.3fr) 104px 96px 84px; }
  .cg-bd__last { visibility: visible; padding-left: 16px; }
}
`;
