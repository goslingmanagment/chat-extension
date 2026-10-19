// The Spenders board (ui-design §3.5, §4.14, §6.1, §6.4; SP-008…SP-021,
// SP-033, SP-034; X67 — the old Fansly extension's list, on both sites): every
// payer by the lifetime under the tier's header «🐳 Whale  $600+ … 42»; a fan is
// the initials, the name over the @handle, and on the right the lifetime in
// green with «+$320» of the period under it; «ждёт 6 мин» next to the name when
// the fan waits for a reply. The chips over the list — «Все», the tiers, the
// filters' menu — are BoardFilters. The picked fan's preview unfolds right under
// their row (X66), its height the room the list has for the row and the preview
// together. Only the rows in view are in the DOM (≤ 150 for a thousand).
// Everything comes from SpendersBoardVM; a failed read is an error card with
// «Повторить», never an empty list (SP-029).

import { type ComponentChildren, type JSX, type Ref, type TargetedKeyboardEvent } from 'preact';
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';

import { type I18nKey } from '@cg/contracts/errors';
import { type ShelfVM, type SpenderRowVM, type SpendersBoardVM, type SpendersFilter, type SpendersPeriod, type UiAction } from '@cg/contracts/vm';

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
  useI18n,
  useMinuteClock,
  useSpokenMoney,
  useTooltip,
} from '../kit';
import { BatchBar, BatchCheck, BatchCheckAll, BatchLine, inBatch } from './batch';
import { bothAges } from './preview/Preview';
import { rowKeyOf, useRowFocus } from './rowFocus';
import { boardItemHeight, boardItems, edgeStop, initialStop, initialsOf, inlinePreviewHeight, isStop, nextStop, shelfLabel, shelfTier, type BoardItem } from './rows';
import { ChoiceMenu, FilterChip, coverageWord, isPlainKey } from './window';

export const PERIOD_KEYS: Readonly<Record<SpendersPeriod, I18nKey>> = {
  lifetime: 'spenders.period.lifetime',
  '30d': 'spenders.period.d30',
  mtd: 'spenders.period.month',
  '7d': 'spenders.period.d7',
  today: 'spenders.period.today',
};

/** «Все» is a chip of its own, beside the tiers; every other filter waits in the menu «Фильтр» (X67). */
const MAIN_FILTER: SpendersFilter = 'all';
/** «Фан писал» is «Ждут ответа» under another name: the menu lists it once. */
const SAME_AS_WAITING: SpendersFilter = 'fan-wrote';
/** Ask for the next page this many rows before the end of the loaded list. */
const LOAD_MORE_MARGIN = 20;

type FilterVM = SpendersBoardVM['filters'][number];
type TierVM = NonNullable<SpendersBoardVM['tiers']>[number];

export interface BoardHandle {
  /** Scrolls the list to a shelf's header row (a click on a shelf in the statistics, SP-045). */
  scrollToShelf(shelfId: string): void;
  /** Puts focus on the keyboard's current row (the window opened, a preview closed). */
  focusActiveRow(): boolean;
}

export interface BoardProps {
  readonly board: SpendersBoardVM;
  readonly boardRef?: Ref<BoardHandle>;
  /** X66: the open preview, drawn under the picked fan's row; absent or null — none unfolds in the list. */
  readonly unfolded?: (() => ComponentChildren) | null;
}

function openPreview(handle: string): UiAction {
  return { type: 'OpenPreview', targetHandle: handle };
}

function openChat(handle: string): UiAction {
  return { type: 'Navigate', to: { kind: 'chat', targetHandle: handle } };
}

/** A tier's header, as the old extension drew it: «🐳 Whale  $600+ … 42»; a bucket of other bounds — its bounds. */
function ShelfRow({ shelf, rowIndex }: { readonly shelf: ShelfVM; readonly rowIndex: number }): JSX.Element {
  const i18n = useI18n();
  const band = shelfLabel(i18n, shelf.range);
  const tier = shelfTier(i18n, shelf.range);
  return (
    <div class="cg-bd__shelf" role="rowgroup" aria-label={tier === null ? band : `${tier.name} ${band}`}>
      <div class="cg-bd__shelfrow" role="row" aria-rowindex={rowIndex}>
        <span role="rowheader" class="cg-bd__shelfname">
          {tier === null ? band : `${tier.mark} ${tier.name}`}
          {tier === null ? null : <span class="cg-bd__band cg-num">{band}</span>}
        </span>
        {shelf.fans === null ? null : <span class="cg-bd__shelfn cg-num">{shelf.fans}</span>}
      </div>
    </div>
  );
}

interface FanRowProps {
  readonly row: SpenderRowVM;
  /** The period of the second sum, for its tooltip. */
  readonly period: SpendersPeriod;
  /** Its preview is unfolded under it (X66). */
  readonly expanded: boolean;
  /** The row's key in the list: what the keyboard's row is remembered by. */
  readonly itemKey: string;
  readonly index: number;
  readonly rowIndex: number;
  readonly active: boolean;
  readonly onPick: (key: string) => void;
}

/** A fan as the old extension drew one: the initials, the name over the @handle, the lifetime over «+$N». */
function FanRow({ row, period, expanded, itemKey, index, rowIndex, active, onPick }: FanRowProps): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  // Who wrote when — both ages — is the tooltip of the fan's name (SP-017); the row itself only says who waits.
  const ages = useTooltip(bothAges(i18n, row));
  const plus = row.period !== null && row.period > 0;
  // «+$320» is the period's: its name is the tooltip («30 дней»).
  const perTip = useTooltip(plus ? i18n.t(PERIOD_KEYS[period]) : null);
  const lifetime = useSpokenMoney(row.lifetime);
  const classes = ['cg-bd__row', row.selected ? 'is-sel' : '', expanded ? 'is-open' : '', row.deleted ? 'is-deleted' : '', inBatch(row) ? 'has-batch' : ''].filter((name) => name !== '').join(' ');
  return (
    <div
      class={classes}
      role="row"
      aria-rowindex={rowIndex}
      {...(row.selected ? { 'aria-current': 'true' as const } : {})}
      {...(expanded ? { 'aria-expanded': 'true' as const } : {})}
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
      <span role="cell" class="cg-bd__who">
        <span class="cg-bd__ava" aria-hidden="true">
          {initialsOf(row.name)}
        </span>
        {row.batch === undefined ? null : <BatchCheck list="spenders" handle={row.handle} row={row.batch} name={row.name} />}
      </span>
      <span role="cell" class="cg-bd__main" {...ages.props}>
        <span class="cg-bd__l1">
          <span class="cg-bd__name">{row.name}</span>
          {row.isNew ? <span class="cg-bd__new">{i18n.t('spenders.tag.new')}</span> : null}
          {row.deleted ? <span class="cg-bd__tag">{i18n.t('spenders.tag.deleted')}</span> : null}
          {row.waiting && row.fanWroteAt !== null ? <span class="cg-bd__wait">{i18n.t('spenders.wait.fan', { age: { age: row.fanWroteAt } })}</span> : null}
        </span>
        {row.username === null ? null : <span class="cg-bd__handle">@{row.username}</span>}
        {ages.description}
      </span>
      <span role="cell" class="cg-bd__sums" {...(lifetime === null ? {} : { 'aria-label': lifetime })}>
        <Money mills={row.lifetime} class="cg-bd__life" />
        {plus ? (
          <span class="cg-bd__per" {...perTip.props}>
            <Money mills={row.period} sign="plus" />
            {perTip.description}
          </span>
        ) : null}
      </span>
      {row.batch === undefined ? null : <BatchLine row={row.batch} />}
    </div>
  );
}

function FilterButton({ filter }: { readonly filter: FilterVM }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  return <FilterChip label={i18n.text(filter.label)} count={filter.count} pressed={filter.pressed} onPress={() => void dispatch({ type: 'SetSpendersFilter', filter: filter.id })} />;
}

/** A tier chip of the old extension (X67): «🐳 Whale 42», its bounds in the tooltip; pressed again — every tier. */
function TierChip({ tier }: { readonly tier: TierVM }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const band = shelfLabel(i18n, tier.range);
  const named = shelfTier(i18n, tier.range);
  const tip = useTooltip(named === null ? null : band);
  return (
    <>
      <button
        type="button"
        class="cg-flt cg-tier"
        aria-pressed={tier.pressed ? 'true' : 'false'}
        {...tip.props}
        onClick={() => void dispatch({ type: 'SetSpendersShelf', shelfId: tier.pressed ? null : tier.id })}
      >
        {named === null ? band : `${named.mark} ${named.name}`}
        <span class="cg-flt__n cg-num">{tier.fans}</span>
      </button>
      {tip.description}
    </>
  );
}

/**
 * The chips over the list, as the old extension's row of them (X67): «Все» with its count, then the tiers —
 * «🐳 Whale 42», «⭐ Top 29» …; «Ждут ответа», «Новые» and the rest wait in «Фильтр»; the batch's «Отметить всех»
 * before them, the spinner while a new list is read over the one shown.
 */
export function BoardFilters({ board }: { readonly board: SpendersBoardVM }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const all = board.filters.find((filter) => filter.id === MAIN_FILTER);
  const hasWaiting = board.filters.some((filter) => filter.id === 'waiting');
  const others = board.filters.filter((filter) => filter.id !== MAIN_FILTER && !(hasWaiting && filter.id === SAME_AS_WAITING && !filter.pressed));
  const othersOn = others.filter((filter) => filter.pressed);
  const hasRows = board.shelves.some((shelf) => shelf.rows.length > 0);
  const handles = useMemo(() => board.shelves.flatMap((shelf) => shelf.rows.map((row) => row.handle)), [board.shelves]);
  const tiers = board.tiers ?? [];
  return (
    <div class="cg-sp__filters">
      {board.batch === undefined ? null : <BatchCheckAll list="spenders" handles={handles} batch={board.batch} />}
      {all === undefined ? null : <FilterButton filter={all} />}
      {tiers.length < 2 ? null : (
        <span class="cg-sp__tiers" role="group" aria-label={i18n.t('spenders.tiers')}>
          {tiers.map((tier) => (
            <TierChip key={tier.id} tier={tier} />
          ))}
        </span>
      )}
      {others.length === 0 ? null : (
        <ChoiceMenu
          label={othersOn.length === 0 ? i18n.t('spenders.filter.menu') : othersOn.map((filter) => i18n.text(filter.label)).join(' · ')}
          menuLabel={i18n.t('spenders.filter.menu')}
          pressed={othersOn.length > 0}
          items={others.map((filter) => ({ id: filter.id, label: i18n.text(filter.label), count: filter.count, checked: filter.pressed }))}
          onSelect={(id) => {
            const filter = others.find((item) => item.id === id);
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

export function Board({ board, boardRef, unfolded = null }: BoardProps): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const announce = useAnnounce();
  // One minute ticker for every age in the list («3 ч», «19 д»).
  useMinuteClock(true);

  const unfold = unfolded !== null;
  const items = useMemo(() => boardItems(board.shelves, unfold), [board.shelves, unfold]);
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

  // X66: the unfolded preview takes the room the list has under its row; the list's height is measured, not guessed.
  const [listHeight, setListHeight] = useState(0);
  const showsRows = items.length > 0;
  useLayoutEffect(() => {
    const node = wrapRef.current;
    if (node === null) return undefined;
    const measure = (): void => setListHeight(node.clientHeight);
    measure();
    const view = node.ownerDocument.defaultView;
    if (view === null || typeof view.ResizeObserver !== 'function') return undefined;
    const observer = new view.ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [wrapRef, showsRows]);
  const previewHeight = inlinePreviewHeight(listHeight);
  const rowHeight = useCallback((item: BoardItem): number => boardItemHeight(item, previewHeight), [previewHeight]);
  // A preview that unfolds (a click, Space, the neighbouring fan) brings its row and itself into view together, and
  // so does a list that moved it (a search cleared, a refresh that put fans above it): a preview is a row of the
  // virtual list, and one scrolled out by a change the person did not make would be gone from the window. The
  // person's own scrolling moves nothing here.
  const unfoldedAt = unfold ? items.findIndex((item) => item.kind === 'preview') : -1;
  const unfoldedKey = unfoldedAt < 0 ? null : (items[unfoldedAt]?.key ?? null);
  useLayoutEffect(() => {
    if (unfoldedAt < 0) return;
    listRef.current?.scrollToIndex(unfoldedAt - 1);
    listRef.current?.scrollToIndex(unfoldedAt);
  }, [unfoldedKey, unfoldedAt, previewHeight, listRef]);

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

  const secondaryOn = board.filters.filter((filter) => filter.pressed && filter.id !== 'all' && filter.id !== 'waiting' && filter.id !== 'new');
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
            rowHeight={rowHeight}
            getKey={(item) => item.key}
            role="table"
            label={i18n.t('spenders.boardLabel')}
            class="cg-bd__scroll"
            isGroupHeader={(item) => item.kind === 'shelf'}
            listRef={listRef}
            onRangeChange={onRange}
            onKeyDown={onKeyDown}
            renderRow={(item, index) => {
              const rowIndex = index + 1;
              switch (item.kind) {
                case 'shelf':
                  return <ShelfRow shelf={item.shelf} rowIndex={rowIndex} />;
                case 'fan':
                  return <FanRow row={item.row} period={board.period} expanded={unfold && item.row.selected} itemKey={item.key} index={index} rowIndex={rowIndex} active={index === current} onPick={setActiveKey} />;
                case 'preview':
                  // Out of the rows' keys (no data-cg-key): what is typed in the preview is never a key of the list.
                  return (
                    <div class="cg-bd__unfold" role="row" aria-rowindex={rowIndex} data-cg-unfolded={item.handle}>
                      <div role="cell" class="cg-bd__unfoldcell">
                        {unfolded?.()}
                      </div>
                    </div>
                  );
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

// The look is the old Fansly extension's (X67): a tier's header in strong ink with its bounds and count in mono, a
// fan of 52 px — the initials in a rounded square, the name over the @handle, the lifetime in green mono over «+$N»
// of the period —, the picked fan washed with the terracotta bar at its left edge, which runs on into the preview
// unfolded under it (X66). The batch's check box takes the place of the initials under the pointer, on the keyboard's
// row and while anyone is ticked (1.32.0).
export const BOARD_CSS = `
.cg-bd { display: flex; flex-direction: column; min-height: 0; min-width: 0; }
.cg-bd__list { flex: 1; min-height: 0; min-width: 0; }
.cg-bd__state { padding: 0; }
.cg-bd__state .cg-state--empty { justify-content: flex-start; text-align: left; padding: 24px 20px; }
.cg-bd__reset { padding: 0 20px 16px 12px; }
.cg-bd__banner { flex: none; border-bottom: 1px solid var(--cg-rule); }
.cg-bd__shelf, .cg-bd__shelfrow { height: 36px; }
.cg-bd__shelfrow { display: flex; align-items: flex-end; gap: 8px; padding: 0 20px 6px; background: var(--cg-surface); font-variant-numeric: tabular-nums; }
.cg-bd__shelfname { display: inline-flex; align-items: baseline; gap: 10px; min-width: 0; font-weight: 600; color: var(--cg-ink-strong); white-space: nowrap; }
.cg-bd__band, .cg-bd__shelfn { font: var(--cg-text-xs)/16px var(--cg-mono); letter-spacing: 0.04em; color: var(--cg-ink-muted); font-weight: 400; }
.cg-bd__shelfn { margin-left: auto; }
.cg-bd__row {
  display: grid; grid-template-columns: 34px minmax(0, 1fr) auto; grid-template-rows: 52px; align-items: center; column-gap: 12px;
  padding: 0 20px 0 18px; border-radius: var(--cg-r-md); margin: 0 8px; cursor: pointer; outline: none; font-variant-numeric: tabular-nums;
}
.cg-bd__row:hover { background: var(--cg-hover); }
.cg-bd__row:focus-visible { box-shadow: inset 0 0 0 2px var(--cg-focus); }
.cg-bd__row.is-sel, .cg-bd__row.is-sel:hover { background: var(--cg-sel); box-shadow: inset 3px 0 var(--cg-clay); }
.cg-bd__row.is-sel:focus-visible { box-shadow: inset 3px 0 var(--cg-clay), inset 0 0 0 1px var(--cg-focus); }
.cg-bd__row.is-open { border-radius: var(--cg-r-md) var(--cg-r-md) 0 0; }
.cg-bd__row.has-batch { grid-template-rows: 52px 18px; align-content: start; }
.cg-bd__row.has-batch .cg-bt__line { padding-left: 46px; }
.cg-bd__who { position: relative; width: 34px; height: 34px; }
.cg-bd__ava {
  display: flex; align-items: center; justify-content: center; width: 34px; height: 34px; border-radius: 10px;
  background: var(--cg-sunk); box-shadow: inset 0 0 0 1px var(--cg-rule); color: var(--cg-ink-2); font-size: var(--cg-text-sm); font-weight: 600;
}
.cg-bd__who .cg-bt__check { position: absolute; inset: 0; width: 34px; height: 34px; margin: 0; border-radius: 10px; background: var(--cg-surface); box-shadow: inset 0 0 0 1px var(--cg-rule-2); }
.cg-bd:not(:has(.cg-bt__check[aria-checked="true"])) .cg-bd__row:not(:hover, :focus-within, .has-batch) .cg-bt__check { visibility: hidden; }
.cg-bd__main { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.cg-bd__l1 { display: flex; align-items: center; gap: 6px; min-width: 0; line-height: 19px; }
.cg-bd__name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; color: var(--cg-ink-strong); }
.cg-bd__new, .cg-bd__wait {
  flex: none; padding: 0 7px; border-radius: var(--cg-r-pill); border: 1px solid var(--cg-clay-line); background: var(--cg-clay-bg);
  color: var(--cg-clay-ink); font-size: var(--cg-text-xs); line-height: 16px; white-space: nowrap;
}
.cg-bd__tag { flex: none; font-size: var(--cg-text-sm); color: var(--cg-ink-muted); }
.cg-bd__row.is-deleted .cg-bd__name { color: var(--cg-ink-muted); font-weight: 400; }
.cg-bd__handle { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--cg-text-sm); line-height: 16px; color: var(--cg-ink-muted); }
.cg-bd__sums { display: flex; flex-direction: column; align-items: flex-end; gap: 1px; font-family: var(--cg-mono); white-space: nowrap; }
.cg-bd__life { font-weight: 600; line-height: 19px; color: var(--cg-money); }
.cg-bd__per { font-size: var(--cg-text-xs); line-height: 16px; }
.cg-bd__unfold { height: 100%; padding: 0 8px 10px; }
.cg-bd__unfoldcell {
  display: flex; flex-direction: column; height: 100%; border: 1px solid var(--cg-rule-2); border-top: 0; border-left: 3px solid var(--cg-clay);
  border-radius: 0 0 var(--cg-r-md) var(--cg-r-md); background: var(--cg-surface); overflow: hidden;
}
.cg-bd__unfoldcell > * { flex: 1; min-height: 0; }
.cg-bd__unfoldcell .cg-pv__name, .cg-bd__unfoldcell .cg-pv__money { display: none; }
.cg-bd > .cg-sp__foot .cg-btn { margin-right: -8px; }
`;
