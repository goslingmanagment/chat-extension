// The Spenders board (ui-design §3.5, §4.14, §6.1, §6.4; SP-008…SP-021,
// SP-033, SP-034): the list owns the window — filters with counts, a sticky
// column header with the two sort buttons, shelves with their sums, fans, the
// coverage footer. Only the rows in view are in the DOM (≤ 150 for a
// thousand). Everything comes from SpendersBoardVM; a failed read is an error
// card with «Повторить», never an empty list (SP-029). «Фан ждёт ответа» is
// the bold age of «Фан писал» and nothing else: no dot, no colour.

import { type JSX, type Ref, type TargetedKeyboardEvent } from 'preact';
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'preact/hooks';

import { type I18nKey } from '@cg/contracts/errors';
import { type ShelfVM, type SpenderRowVM, type SpendersBoardVM, type SpendersFilter, type SpendersPeriod, type UiAction } from '@cg/contracts/vm';

import {
  ActionButton,
  KeysFooter,
  Money,
  Spinner,
  ViewState,
  VirtualList,
  activeIn,
  hotkeyText,
  isComposing,
  useAnnounce,
  useDispatch,
  useHints,
  useI18n,
  useMinuteClock,
  useSpokenMoney,
  useTooltip,
} from '../kit';
import { useRowFocus } from './rowFocus';
import { BOARD_HEIGHTS, boardItemHeight, boardItems, edgeStop, initialStop, isStop, nextStop, shelfLabel, type BoardItem } from './rows';
import { DataFooter, FilterChip, ageOrUnknown, coverageWord, isPlainKey } from './window';

export const PERIOD_KEYS: Readonly<Record<SpendersPeriod, I18nKey>> = {
  lifetime: 'spenders.period.lifetime',
  '30d': 'spenders.period.d30',
  mtd: 'spenders.period.month',
  '7d': 'spenders.period.d7',
  today: 'spenders.period.today',
};

/** The first row of filters (ui-design §4.14); the others stand in a second row (§10, SP-020). */
const PRIMARY_FILTERS: readonly SpendersFilter[] = ['all', 'waiting', 'new'];
/** Ask for the next page this many rows before the end of the loaded list. */
const LOAD_MORE_MARGIN = 20;

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

function ShortLabel({ long, short }: { readonly long: string; readonly short: string }): JSX.Element {
  // The short word explains itself: the full label is its tooltip (ui-design §4.14).
  const tip = useTooltip(long);
  return (
    <>
      <span class="cg-lbl-long">{long}</span>
      <span class="cg-lbl-short" {...tip.props}>
        {short}
      </span>
      {tip.description}
    </>
  );
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

function ColumnHeader({ board }: { readonly board: SpendersBoardVM }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const bySum = board.sort === 'sum';
  return (
    <div class="cg-bd__grid cg-bd__colhead" role="row" aria-rowindex={1}>
      <span role="columnheader">{i18n.t('spenders.col.fan')}</span>
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
      <span role="columnheader" class="cg-bd__num">
        {i18n.t(PERIOD_KEYS[board.period])}
      </span>
      <span role="columnheader" class="cg-bd__num">
        <ShortLabel long={i18n.t('spenders.col.weWrote')} short={i18n.t('spenders.col.weWroteShort')} />
      </span>
      <span role="columnheader" class="cg-bd__num" aria-sort={bySum ? 'none' : 'ascending'}>
        <SortButton
          label={i18n.t('spenders.col.fanWrote')}
          short={i18n.t('spenders.col.fanWroteShort')}
          tooltip={i18n.t('spenders.sort.fanAgeTooltip')}
          sorted={!bySum}
          arrow="↑"
          onSort={() => void dispatch({ type: 'SetSpendersSort', sort: 'fan-age' })}
        />
      </span>
    </div>
  );
}

function ShelfRow({ shelf, rowIndex }: { readonly shelf: ShelfVM; readonly rowIndex: number }): JSX.Element {
  const i18n = useI18n();
  const label = shelfLabel(i18n, shelf.range);
  return (
    <div class="cg-bd__shelf" role="rowgroup" aria-label={label}>
      <div class="cg-bd__grid cg-bd__shelfrow" role="row" aria-rowindex={rowIndex}>
        <span role="rowheader" class="cg-bd__shelfname">
          {label}
          {shelf.fans === null ? null : <span class="cg-bd__shelfn cg-num">{shelf.fans}</span>}
        </span>
        <span role="cell" class="cg-bd__last" />
        <Money mills={shelf.lifetime} cell class="cg-bd__num cg-bd__shelfsum" />
        <Money mills={shelf.period} sign="plus" cell class="cg-bd__num cg-bd__shelfsum" />
        <span role="cell" class="cg-bd__num" />
        <span role="cell" class="cg-bd__num" />
      </div>
    </div>
  );
}

interface FanRowProps {
  readonly row: SpenderRowVM;
  readonly index: number;
  readonly rowIndex: number;
  readonly active: boolean;
  readonly onPick: (index: number) => void;
}

function FanRow({ row, index, rowIndex, active, onPick }: FanRowProps): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const fullName = row.username === null ? row.name : `${row.name} @${row.username}`;
  const who = useTooltip(fullName);
  const waiting = useTooltip(row.waiting ? i18n.t('spenders.waitingTooltip') : null);
  const period = useSpokenMoney(row.period, { sign: 'plus' });
  const classes = ['cg-bd__grid', 'cg-bd__row', row.selected ? 'is-sel' : '', row.deleted ? 'is-deleted' : ''].filter((name) => name !== '').join(' ');
  return (
    <div
      class={classes}
      role="row"
      aria-rowindex={rowIndex}
      {...(row.selected ? { 'aria-current': 'true' as const } : {})}
      tabIndex={active ? 0 : -1}
      data-cg-item={index}
      data-cg-fan={row.handle}
      onClick={() => {
        onPick(index);
        void dispatch(openPreview(row.handle));
      }}
      onFocus={() => onPick(index)}
    >
      <span role="cell" class="cg-bd__who" {...who.props}>
        <span class="cg-bd__name">{row.name}</span>
        {row.isNew ? <span class="cg-bd__tag">{i18n.t('spenders.tag.new')}</span> : null}
        {row.deleted ? <span class="cg-bd__tag">{i18n.t('spenders.tag.deleted')}</span> : null}
        {row.username === null ? null : <span class="cg-bd__handle">@{row.username}</span>}
        {who.description}
      </span>
      <span role="cell" class="cg-bd__last">
        {row.lastMessage === null ? null : row.lastMessage.fromUs ? `${i18n.t('spenders.ourPrefix')} ${row.lastMessage.text}` : row.lastMessage.text}
      </span>
      <Money mills={row.lifetime} cell class="cg-bd__num cg-bd__life" />
      <span role="cell" class="cg-bd__num cg-bd__per cg-num" {...(period === null ? {} : { 'aria-label': period })}>
        {i18n.formatMoneyMills(row.period, { sign: 'plus' })}
      </span>
      <span role="cell" class="cg-bd__num cg-bd__age cg-num">
        {ageOrUnknown(i18n, row.weWroteAt)}
      </span>
      <span role="cell" class={`cg-bd__num cg-bd__age cg-num${row.waiting ? ' is-wait' : ''}`} {...waiting.props}>
        {ageOrUnknown(i18n, row.fanWroteAt)}
        {waiting.description}
      </span>
    </div>
  );
}

function MoreRow({ item, index, rowIndex, active, onPick }: { readonly item: Extract<BoardItem, { kind: 'more' }>; readonly index: number; readonly rowIndex: number; readonly active: boolean; readonly onPick: (index: number) => void }): JSX.Element {
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
          onFocus={() => onPick(index)}
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

function FilterButton({ filter }: { readonly filter: SpendersBoardVM['filters'][number] }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  return <FilterChip label={i18n.text(filter.label)} count={filter.count} pressed={filter.pressed} onPress={() => void dispatch({ type: 'SetSpendersFilter', filter: filter.id })} />;
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
  const [active, setActive] = useState(() => initialStop(items));
  const { wrapRef, listRef, focusRow, settle } = useRowFocus();
  const askedMore = useRef(-1);

  // The keyboard's row survives a new list as long as it is still a stop; else it goes back to the start.
  const current = isStop(items[active]) ? active : initialStop(items);
  useEffect(() => {
    if (current !== active) setActive(current);
  }, [current, active]);

  const move = (to: number): void => {
    if (to < 0 || to === current) return;
    setActive(to);
    focusRow(to);
  };

  useImperativeHandle(
    boardRef ?? null,
    () => ({
      scrollToShelf(shelfId) {
        const index = items.findIndex((item) => item.kind === 'shelf' && item.shelf.id === shelfId);
        if (index >= 0) listRef.current?.scrollToIndex(index, 'start');
      },
      focusActiveRow() {
        if (current < 0) return false;
        focusRow(current);
        return true;
      },
    }),
    [items, current, focusRow, listRef],
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
    const target = event.target as HTMLElement | null;
    if (target === null || target.closest('[data-cg-item]') === null) return;
    const item = items[current];
    // Letters go by the physical key, so J/K and O work on any layout (SP-033).
    switch (event.code) {
      case 'ArrowDown':
      case 'KeyJ':
        event.preventDefault();
        move(nextStop(items, current, 1));
        return;
      case 'ArrowUp':
      case 'KeyK':
        event.preventDefault();
        move(nextStop(items, current, -1));
        return;
      case 'Home':
        event.preventDefault();
        move(edgeStop(items, 1));
        return;
      case 'End':
        event.preventDefault();
        move(edgeStop(items, -1));
        return;
      case 'Enter':
      case 'NumpadEnter':
      case 'KeyO':
        if (item?.kind !== 'fan') return;
        event.preventDefault();
        // Opening the chat is the person's own act: ChatSpace marks it read (А7); the controller closes the board (SP-035).
        void dispatch(openChat(item.row.handle));
        return;
      case 'Space':
        if (item?.kind !== 'fan') return;
        event.preventDefault();
        void dispatch(openPreview(item.row.handle));
        return;
      default:
    }
  };

  const primary = board.filters.filter((filter) => PRIMARY_FILTERS.includes(filter.id));
  const secondary = board.filters.filter((filter) => !PRIMARY_FILTERS.includes(filter.id));
  const cut = truncation(board);
  const coverage = coverageWord(i18n, board.footer.stamp.coverage);
  const loaded =
    board.footer.total === null
      ? i18n.plural('spenders.footerNoTotal', board.footer.loaded, { coverage })
      : i18n.plural('spenders.footer', board.footer.total, { loaded: board.footer.loaded, coverage });
  const footerText = shown === null ? loaded : `${loaded}${i18n.t('spenders.footerShown', { n: shown })}`;
  const hasRows = items.length > 0;
  const showList = hasRows && board.view.s !== 'error' && board.view.s !== 'forbidden' && board.view.s !== 'empty';

  return (
    <section class="cg-bd" aria-label={i18n.t('spenders.boardLabel')} data-cg-board={board.view.s}>
      <div class="cg-sp__tools">
        {primary.map((filter) => (
          <FilterButton key={filter.id} filter={filter} />
        ))}
        <span class="cg-bd__sortnote">
          {board.view.s === 'loading' && hasRows ? <Spinner label={i18n.t('common.loading')} /> : null}
          {i18n.t(board.sort === 'sum' ? 'spenders.sortNote.sum' : 'spenders.sortNote.fanAge')}
        </span>
      </div>
      {secondary.length === 0 ? null : (
        <div class="cg-sp__tools cg-sp__tools--more">
          {secondary.map((filter) => (
            <FilterButton key={filter.id} filter={filter} />
          ))}
        </div>
      )}
      {board.view.s === 'offline' ? (
        <div class="cg-bd__banner">
          <ViewState view={board.view} />
        </div>
      ) : null}
      {showList ? (
        <div class="cg-bd__list" ref={wrapRef}>
          <VirtualList
            items={items}
            rowHeight={boardItemHeight}
            getKey={(item) => item.key}
            role="table"
            label={i18n.t('spenders.boardLabel')}
            class="cg-bd__scroll"
            header={<ColumnHeader board={board} />}
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
                  return <FanRow row={item.row} index={index} rowIndex={rowIndex} active={index === current} onPick={setActive} />;
                case 'more':
                  return <MoreRow item={item} index={index} rowIndex={rowIndex} active={index === current} onPick={setActive} />;
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
      {showList && board.reset !== null ? (
        <div class="cg-sp__line">
          <ActionButton vm={board.reset} variant="plain" size="sm" />
        </div>
      ) : null}
      {board.keys.length === 0 ? null : (
        <KeysFooter
          hide={null}
          hints={board.keys.map((entry) => ({ keys: hotkeyText(entry.hotkey)?.display ?? '', label: i18n.text(entry.label) })).filter((hint) => hint.keys !== '')}
        />
      )}
      <DataFooter left={footerText} stamp={board.footer.stamp} />
    </section>
  );
}

/** Whether focus is on the window itself (nothing inside chosen yet), so a list that just arrived may take it. */
export function focusIsIdle(root: ShadowRoot | Document, box: HTMLElement | null): boolean {
  const focused = activeIn(root);
  return focused === null || focused === box;
}

export const BOARD_CSS = `
.cg-bd { display: flex; flex-direction: column; min-height: 0; min-width: 0; container: cgboard / inline-size; }
.cg-bd__sortnote .cg-spin { margin-right: 8px; vertical-align: -1px; }
.cg-bd__sortnote { margin-left: auto; color: var(--cg-ink-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; padding-left: 8px; }
.cg-bd__list { flex: 1; min-height: 0; min-width: 0; }
.cg-bd__state { padding: 0; }
.cg-bd__state .cg-state--empty { justify-content: flex-start; text-align: left; padding: 24px 20px; }
.cg-bd__reset { padding: 0 20px 16px 12px; }
.cg-bd__banner { flex: none; border-bottom: 1px solid var(--cg-rule); }
.cg-bd__grid {
  display: grid; grid-template-columns: minmax(0, 1fr) 0 96px 80px 84px 84px; align-items: center; column-gap: 0; padding: 0 16px 0 20px;
}
.cg-bd__grid > * { min-width: 0; white-space: nowrap; }
.cg-bd__num { text-align: right; padding-left: 12px; overflow: hidden; text-overflow: ellipsis; }
.cg-bd__colhead { height: 28px; grid-template-rows: 28px; border-bottom: 1px solid var(--cg-rule); font-size: var(--cg-text-sm); color: var(--cg-ink-muted); }
.cg-bd__sort { height: 28px; max-width: 100%; border-radius: 4px; color: inherit; font: inherit; text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cg-bd__sort:hover, .cg-bd__sort.is-sorted { color: var(--cg-ink-strong); }
.cg-bd__sort.is-sorted { font-weight: 500; }
.cg-lbl-short { display: none; }
.cg-bd__shelf, .cg-bd__shelfrow { height: 34px; }
.cg-bd__shelfrow { background: var(--cg-surface); border-bottom: 1px solid var(--cg-rule); font-variant-numeric: tabular-nums; }
.cg-bd__shelfname { font-weight: 600; color: var(--cg-ink-strong); }
.cg-bd__shelfn { font-weight: 400; color: var(--cg-ink-muted); margin-left: 8px; }
.cg-bd__shelfsum { color: var(--cg-ink-2); font-weight: 500; }
.cg-bd__shelfsum.cg-money { color: var(--cg-money); }
.cg-bd__row { height: 36px; border-bottom: 1px solid var(--cg-rule); font-variant-numeric: tabular-nums; cursor: default; }
.cg-bd__row:hover { background: var(--cg-sunk); }
.cg-bd__row:focus-visible { background: var(--cg-hover); outline-offset: -2px; }
.cg-bd__row.is-sel, .cg-bd__row.is-sel:hover, .cg-bd__row.is-sel:focus-visible { background: var(--cg-sel); }
.cg-bd__who { display: flex; align-items: baseline; gap: 8px; }
.cg-bd__name { font-weight: 500; color: var(--cg-ink); overflow: hidden; text-overflow: ellipsis; flex: 0 1 auto; min-width: 48px; max-width: 64%; }
.cg-bd__handle { color: var(--cg-ink-muted); overflow: hidden; text-overflow: ellipsis; flex: 1 1 0; min-width: 0; }
.cg-bd__tag { flex: none; font-size: var(--cg-text-sm); color: var(--cg-ink-2); }
.cg-bd__row.is-deleted .cg-bd__name { color: var(--cg-ink-muted); font-weight: 400; }
.cg-bd__row.is-deleted .cg-bd__tag { color: var(--cg-ink-muted); }
.cg-bd__life { color: var(--cg-ink); }
.cg-bd__per { color: var(--cg-money); font-weight: 500; }
.cg-bd__age { color: var(--cg-ink-muted); }
.cg-bd__age.is-wait { color: var(--cg-ink-strong); font-weight: 500; }
.cg-bd__last { display: block; overflow: hidden; visibility: hidden; color: var(--cg-ink-muted); text-overflow: ellipsis; }
.cg-bd__more { display: flex; align-items: center; height: 32px; padding: 0 16px 0 12px; border-bottom: 1px solid var(--cg-rule); }
.cg-bd__morebtn { height: 24px; padding: 0 8px; border-radius: var(--cg-r-sm); color: var(--cg-ink-muted); font-size: var(--cg-text-sm); }
.cg-bd__morebtn:hover { background: var(--cg-hover); color: var(--cg-ink-strong); }
.cg-bd .cg-keys { padding-left: 20px; }
@container cgboard (max-width: 620px) {
  .cg-bd__grid { grid-template-columns: minmax(0, 1fr) 0 76px 64px 60px 64px; padding: 0 12px 0 16px; }
  .cg-bd__num { padding-left: 4px; }
  .cg-bd__handle { display: none; }
  .cg-bd__name { max-width: none; }
  .cg-lbl-long { display: none; }
  .cg-lbl-short { display: inline; }
}
@container cgboard (min-width: 860px) {
  .cg-bd__grid { grid-template-columns: minmax(0, 0.9fr) minmax(0, 1fr) 96px 80px 84px 84px; }
  .cg-bd__last { visibility: visible; padding-left: 16px; }
}
`;
