// The Spenders board (ui-design §3.5, §4.14, §6.1, §6.4; SP-008…SP-021,
// SP-033, SP-034; 1.44.0 — the owner's «Таблица»): a calm table where every
// fact has a column of its own — «Фан» (the name, then the @handle muted),
// «Последнее сообщение» («Мы: » muted before ours), «Ждёт ответа» (the age of
// the fan's message while they wait: the board's one colour), «Мы писали»,
// «Потратил» (the lifetime), the period's column with its ▾ menu, and «Открыть
// чат ↗» on the row under the pointer or the picked one. A click on a header
// sorts: «Потратил» under the tiers' headers «Whale  $600+ · 4 фана», «Ждёт
// ответа» as two groups, «Мы писали» and the period's column as one list with
// a narrow «Тир» column. The batch's check box starts each row. The picked
// fan's preview unfolds right under their row (X66), its height the room the
// list has for the row and the preview together. Only the rows in view are in
// the DOM (≤ 150 for a thousand). Everything comes from SpendersBoardVM; a
// failed read is an error card with «Повторить», never an empty list (SP-029).

import { type ComponentChildren, type JSX, type Ref, type TargetedKeyboardEvent } from 'preact';
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';

import { type I18nKey } from '@cg/contracts/errors';
import { type BatchVM, type I18n, type ShelfVM, type SpenderRowVM, type SpendersBoardVM, type SpendersFilter, type SpendersPeriod, type SpendersSort, type UiAction } from '@cg/contracts/vm';

import {
  ActionButton,
  CheckGlyph,
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
import { BatchBar, BatchCheck, BatchLine, inBatch } from './batch';
import { OutreachSend, useOutreachAdds } from './outreach';
import { rowKeyOf, useRowFocus } from './rowFocus';
import { BOARD_HEIGHTS, boardItemHeight, boardItems, edgeStop, initialStop, inlinePreviewHeight, isStop, nextStop, shelfLabel, shelfTier, type BoardItem } from './rows';
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
/**
 * A double click on a row: its second click within this long of the first, on the same row. A click's preview also
 * waits this long before the list scrolls it into view: the row stays under the pointer for that second click, and
 * nothing of the preview slides under it instead.
 */
const DOUBLE_CLICK_MS = 500;

type FilterVM = SpendersBoardVM['filters'][number];
type TierVM = NonNullable<SpendersBoardVM['tiers']>[number];

export interface BoardHandle {
  /** Scrolls the list to a shelf's header row (a click on a shelf in the statistics, SP-045). */
  scrollToShelf(shelfId: string): void;
  /** Scrolls the list back to its first row (the statistics' «Кому написать» changed what it shows). */
  scrollToTop(): void;
  /** Puts focus on the keyboard's current row (the window opened, a preview closed). */
  focusActiveRow(): boolean;
}

export interface BoardProps {
  readonly board: SpendersBoardVM;
  readonly boardRef?: Ref<BoardHandle>;
  /** X66: the open preview, drawn under the picked fan's row; absent or null — none unfolds in the list. */
  readonly unfolded?: (() => ComponentChildren) | null;
  /** The statistics column takes the room: the period's column gives way first. */
  readonly narrow?: boolean;
}

function openPreview(handle: string): UiAction {
  return { type: 'OpenPreview', targetHandle: handle };
}

/** The unfolded preview folds back: a press on its fan's row again, as on any list that unfolds. */
const CLOSE_PREVIEW: UiAction = { type: 'Navigate', to: { kind: 'surface', surface: 'preview', open: false } };

export function openChat(handle: string): UiAction {
  return { type: 'Navigate', to: { kind: 'chat', targetHandle: handle } };
}

/** The first fan the list shows, top to bottom: what Enter in the search opens (the old Fansly board's top match). */
export function firstFan(board: SpendersBoardVM): SpenderRowVM | null {
  for (const shelf of board.shelves) {
    const row = shelf.rows[0];
    if (row !== undefined) return row;
  }
  return null;
}

/** The period's column is named by the period it shows: «30 дней», «Месяц». */
export function periodName(i18n: I18n, period: SpendersPeriod): string {
  return i18n.t(PERIOD_KEYS[period]);
}

/**
 * «12 ч» as two spans — the number, then its unit in a column of its own — so a column of ages lines its units up
 * and hours stand apart from days at a glance. A word without a number («сейчас») is one span.
 */
function AgeText({ at }: { readonly at: string }): JSX.Element {
  const i18n = useI18n();
  const text = i18n.formatAge(at);
  const parts = /^(\S+)\s+(.+)$/.exec(text);
  return parts === null ? (
    <span class="cg-age">{text}</span>
  ) : (
    <span class="cg-age">
      <span class="cg-age__n">{parts[1]}</span>
      <span class="cg-age__u">{parts[2]}</span>
    </span>
  );
}

const CHAT_STATE_KEYS: Readonly<Record<NonNullable<SpenderRowVM['chat']>, { readonly label: I18nKey; readonly hint: I18nKey | null }>> = {
  find: { label: 'spenders.chat.find', hint: 'spenders.chat.findHint' },
  finding: { label: 'spenders.chat.finding', hint: null },
  missing: { label: 'spenders.chat.missing', hint: 'spenders.chat.missingHint' },
};

/**
 * The row's last column: «Открыть чат ↗» on the row under the pointer, the picked one and the keyboard's; «ищу
 * чат…» / «чат не найден» of a fan whose chat the board did not know (the old Fansly board) stand there all along.
 */
function OpenCell({ row, live }: { readonly row: SpenderRowVM; readonly live: boolean }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const keys = row.chat === undefined ? null : CHAT_STATE_KEYS[row.chat];
  const tip = useTooltip(keys?.hint === undefined || keys.hint === null ? null : i18n.t(keys.hint));
  const state = row.chat === 'finding' || row.chat === 'missing' ? row.chat : null;
  return (
    <span role="cell" class="cg-bd__act">
      {state === null ? null : (
        <span class="cg-bd__chat" data-cg-chat={state} {...(state === 'finding' ? { role: 'status' } : {})} {...(state === 'missing' ? tip.props : {})}>
          {i18n.t(CHAT_STATE_KEYS[state].label)}
        </span>
      )}
      {!live || state === 'finding' ? null : (
        <button
          type="button"
          class="cg-bd__open"
          tabIndex={-1}
          aria-label={i18n.t('common.openChat')}
          {...(state === null ? tip.props : {})}
          onClick={(event) => {
            // The row's own click opens the preview; this one, the chat — the person's own click, which marks it read.
            event.stopPropagation();
            void dispatch(openChat(row.handle));
          }}
        >
          <span class="cg-bd__opent" aria-hidden="true">
            {i18n.t('common.openChat')}
          </span>
          <span class="cg-bd__arr" aria-hidden="true">
            ↗
          </span>
        </button>
      )}
      {tip.description}
    </span>
  );
}

/** A tier's header «Whale  $600+ · 4 фана», or a group of the sort «Ждут ответа  дольше ждущие — первыми · 26 фанов». */
function ShelfRow({ shelf, rowIndex }: { readonly shelf: ShelfVM; readonly rowIndex: number }): JSX.Element {
  const i18n = useI18n();
  let name: string;
  let note: string | null;
  if (shelf.group === 'waiting' || shelf.group === 'rest') {
    name = i18n.t(shelf.group === 'waiting' ? 'spenders.group.waiting' : 'spenders.group.rest');
    note = i18n.t(shelf.group === 'waiting' ? 'spenders.group.waitingNote' : 'spenders.group.restNote');
  } else {
    const band = shelfLabel(i18n, shelf.range);
    const tier = shelfTier(i18n, shelf.range);
    name = tier ?? band;
    note = tier === null ? null : band;
  }
  const count = shelf.fans === null ? null : i18n.plural('common.fans', shelf.fans);
  return (
    <div class="cg-bd__shelf" role="rowgroup" aria-label={[name, note, count].filter((part) => part !== null).join(' ')}>
      <div class="cg-bd__shelfrow" role="row" aria-rowindex={rowIndex}>
        <span role="rowheader" class="cg-bd__shelfname">
          <b>{name}</b>
          {note === null ? null : <span class="cg-bd__band cg-num">{note}</span>}
          {count === null ? null : <span class="cg-bd__shelfn cg-num">· {count}</span>}
        </span>
      </div>
    </div>
  );
}

interface FanRowProps {
  readonly row: SpenderRowVM;
  /** The «Тир» column is shown: the list is not grouped by the tiers. */
  readonly tierColumn: boolean;
  /** Its preview is unfolded under it (X66). */
  readonly expanded: boolean;
  /** The row's key in the list: what the keyboard's row is remembered by. */
  readonly itemKey: string;
  readonly index: number;
  readonly rowIndex: number;
  readonly active: boolean;
  readonly onPick: (key: string) => void;
  /** «Рассылка» is open: what goes after the row's personal line («+ общий текст · + 2 вложения»); null — nothing. */
  readonly adds?: string | null;
  /**
   * A click on the row (not the keyboard's focus): the list holds its scroll for a second click. true — it is the second
   * click of a double click on this same row.
   */
  readonly onPress: (key: string) => boolean;
  /** The row's sticky copy over its unfolded preview: no ids, no keys, no handlers — the real row has them. */
  readonly copy?: boolean;
}

/**
 * The row's last message, «Мы: » before ours (SP-016). No text but an age on either side — the chat exists and its
 * text is not read yet: an empty cell. Neither — «нет переписки».
 */
function LastMessage({ last, talked }: { readonly last: SpenderRowVM['lastMessage']; readonly talked: boolean }): JSX.Element {
  const i18n = useI18n();
  if (last === null) {
    return (
      <span role="cell" class="cg-bd__last is-none">
        {talked ? null : i18n.t('spenders.noChat')}
      </span>
    );
  }
  return (
    <span role="cell" class={`cg-bd__last${last.fromUs ? ' is-ours' : ''}`}>
      {last.fromUs ? <span class="cg-bd__us">{i18n.t('spenders.ourPrefix')} </span> : null}
      {last.text}
    </span>
  );
}

/** The «Тир» cell of a list not grouped by the tiers: the tier's name, or its bounds; no tier — «—». */
function tierText(i18n: I18n, tier: SpenderRowVM['tier']): string {
  if (tier === undefined || (tier.fromMills === null && tier.toMills === null)) return i18n.formatMoneyMills(null);
  return shelfTier(i18n, tier) ?? shelfLabel(i18n, tier);
}

/** A fan: one line of the table's columns, and under a row in a batch the line of its generation. */
function FanRow({ row, tierColumn, expanded, itemKey, index, rowIndex, active, onPick, onPress, adds = null, copy = false }: FanRowProps): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const format = row.lifetimeCents === true ? { cents: true } : {};
  const lifetime = useSpokenMoney(row.lifetime, format);
  const classes = ['cg-bd__row', row.selected ? 'is-sel' : '', expanded ? 'is-open' : '', row.deleted ? 'is-deleted' : '', inBatch(row) ? 'has-batch' : '', row.outreach === undefined ? '' : 'has-outreach', active ? 'is-active' : '']
    .filter((name) => name !== '')
    .join(' ');
  // The sticky copy is drawn for the eye: the list, its keys and the e2e find the real row by these.
  const live = copy
    ? {}
    : {
        role: 'row' as const,
        'aria-rowindex': rowIndex,
        ...(row.selected ? { 'aria-current': 'true' as const } : {}),
        ...(expanded ? { 'aria-expanded': 'true' as const } : {}),
        tabIndex: active ? 0 : -1,
        'data-cg-item': index,
        'data-cg-key': itemKey,
        'data-cg-fan': row.handle,
        onClick: (event: MouseEvent) => {
          onPick(itemKey);
          // X66: a click opens the preview, a click on its fan's row again folds it; a double click opens the chat, as
          // the old Fansly board's click did. The second click of the pair is itself a click — the person's own, which
          // the chat's opening needs. The browser's count alone is not enough (a click elsewhere a moment before counts
          // in it): the first click must be this row's.
          const second = onPress(itemKey);
          void dispatch(second && event.detail >= 2 ? openChat(row.handle) : expanded ? CLOSE_PREVIEW : openPreview(row.handle));
        },
        onFocus: () => onPick(itemKey),
      };
  const period = row.period !== null && row.period > 0 ? row.period : null;
  return (
    <div class={classes} {...live}>
      <span role="cell" class="cg-bd__check">
        {row.batch === undefined || copy ? null : <BatchCheck list="spenders" handle={row.handle} row={row.batch} name={row.name} />}
      </span>
      {/* The row's text starts with the fan's name: search and the e2e read it so. */}
      <span role="cell" class="cg-bd__who">
        <span class="cg-bd__name">{row.name}</span>
        {row.deleted ? <span class="cg-bd__handle">{i18n.t('spenders.tag.deleted')}</span> : row.username === null ? null : <span class="cg-bd__handle">@{row.username}</span>}
      </span>
      <LastMessage last={row.lastMessage} talked={row.weWroteAt !== null || row.fanWroteAt !== null} />
      <span role="cell" class="cg-bd__wait cg-num">
        {row.waiting && row.fanWroteAt !== null ? <AgeText at={row.fanWroteAt} /> : null}
      </span>
      <span role="cell" class="cg-bd__wrote cg-num">
        {row.weWroteAt === null ? <span class="cg-bd__none">{i18n.formatMoneyMills(null)}</span> : <AgeText at={row.weWroteAt} />}
      </span>
      {tierColumn ? (
        <span role="cell" class="cg-bd__tier">
          {tierText(i18n, row.tier)}
        </span>
      ) : null}
      <span role="cell" class="cg-bd__spent cg-num" {...(lifetime === null ? {} : { 'aria-label': lifetime })}>
        {i18n.formatMoneyMills(row.lifetime, format)}
      </span>
      <span role="cell" class="cg-bd__per cg-num">
        {period === null ? <span class="cg-bd__none">{i18n.formatMoneyMills(null)}</span> : i18n.formatMoneyMills(period)}
      </span>
      {copy ? <span role="cell" class="cg-bd__act" /> : row.outreach === undefined ? <OpenCell row={row} live /> : <OutreachSend handle={row.handle} row={row.outreach} />}
      {row.batch === undefined || copy ? null : <BatchLine row={row.batch} end={row.outreach === undefined || adds === null ? null : <span class="cg-or__plus">{adds}</span>} />}
    </div>
  );
}

/** A sortable column's header: its name, a faint ↕ — and ↓ in strong ink on the column the list goes by. */
function SortHead({ sort, current, label, class: extra }: { readonly sort: SpendersSort; readonly current: SpendersSort; readonly label: string; readonly class?: string }): JSX.Element {
  const dispatch = useDispatch();
  const on = sort === current;
  return (
    <span role="columnheader" class={`cg-bd__th is-sort${on ? ' is-on' : ''}${extra === undefined ? '' : ` ${extra}`}`} aria-sort={on ? 'descending' : 'none'}>
      <button type="button" class="cg-bd__sort" aria-pressed={on ? 'true' : 'false'} onClick={() => void (on ? undefined : dispatch({ type: 'SetSpendersSort', sort }))}>
        {label}
        <span class="cg-bd__sg" aria-hidden="true">
          {on ? '↓' : '↕'}
        </span>
      </button>
    </span>
  );
}

/** The period's header: «30 дней ▾» chooses the period (the board's own list of them), its ↕ sorts by it. */
function PeriodHead({ board }: { readonly board: SpendersBoardVM }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const on = board.sort === 'period';
  const name = periodName(i18n, board.period);
  return (
    <span role="columnheader" class={`cg-bd__th cg-bd__per is-sort${on ? ' is-on' : ''}`} aria-sort={on ? 'descending' : 'none'}>
      <ChoiceMenu
        label={name}
        menuLabel={i18n.t('spenders.period.label')}
        align="end"
        class="cg-bd__pick"
        items={board.periods.map((period) => ({ id: period, label: periodName(i18n, period), checked: period === board.period }))}
        onSelect={(id) => {
          const period = board.periods.find((item) => item === id);
          if (period !== undefined && period !== board.period) void dispatch({ type: 'SetSpendersPeriod', period });
        }}
      />
      <button
        type="button"
        class="cg-bd__sort cg-bd__sortg"
        aria-pressed={on ? 'true' : 'false'}
        aria-label={i18n.t('spenders.sort.by', { column: name })}
        onClick={() => void (on ? undefined : dispatch({ type: 'SetSpendersSort', sort: 'period' }))}
      >
        <span class="cg-bd__sg" aria-hidden="true">
          {on ? '↓' : '↕'}
        </span>
      </button>
    </span>
  );
}

/**
 * The header's check box: ticks every fan the list shows (the batch keeps at most its own `max`), or unticks them;
 * a list partly ticked shows a dash.
 */
function CheckAll({ handles, batch }: { readonly handles: readonly string[]; readonly batch: BatchVM }): JSX.Element | null {
  const i18n = useI18n();
  const dispatch = useDispatch();
  if (handles.length === 0) return null;
  const on = batch.picked > 0;
  const whole = batch.picked >= Math.min(handles.length, batch.max);
  return (
    <button
      type="button"
      class="cg-bt__check"
      role="checkbox"
      aria-checked={on ? (whole ? 'true' : 'mixed') : 'false'}
      aria-label={i18n.t('batch.pickAll')}
      onClick={() => void dispatch({ type: 'SetBatchPick', list: 'spenders', targetHandles: handles.slice(0, 1000), picked: !on })}
    >
      <CheckGlyph on={on && whole} mixed={on && !whole} size={14} />
    </button>
  );
}

function TableHead({ board, tierColumn }: { readonly board: SpendersBoardVM; readonly tierColumn: boolean }): JSX.Element {
  const i18n = useI18n();
  const handles = useMemo(() => board.shelves.flatMap((shelf) => shelf.rows.map((row) => row.handle)), [board.shelves]);
  return (
    <div class="cg-bd__row cg-bd__head" role="row" aria-rowindex={1}>
      <span role="columnheader" class="cg-bd__check">
        {board.batch === undefined ? null : <CheckAll handles={handles} batch={board.batch} />}
      </span>
      <span role="columnheader" class="cg-bd__th">
        {i18n.t('spenders.col.fan')}
      </span>
      <span role="columnheader" class="cg-bd__th">
        {i18n.t('spenders.col.lastMessage')}
      </span>
      <SortHead sort="waiting" current={board.sort} label={i18n.t('spenders.col.waiting')} class="cg-bd__wait" />
      <SortHead sort="we-wrote" current={board.sort} label={i18n.t('spenders.col.weWrote')} class="cg-bd__wrote" />
      {tierColumn ? (
        <span role="columnheader" class="cg-bd__th cg-bd__tier">
          {i18n.t('spenders.col.tier')}
        </span>
      ) : null}
      <SortHead sort="sum" current={board.sort} label={i18n.t('spenders.col.spent')} class="cg-bd__spent" />
      <PeriodHead board={board} />
      <span role="columnheader" class="cg-bd__act">
        <span class="cg-sr">{i18n.t('common.openChat')}</span>
      </span>
    </div>
  );
}

function FilterButton({ filter }: { readonly filter: FilterVM }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  return <FilterChip label={i18n.text(filter.label)} count={filter.count} pressed={filter.pressed} onPress={() => void dispatch({ type: 'SetSpendersFilter', filter: filter.id })} />;
}

/** A tier chip (X67): «Whale 4», its bounds in the tooltip; pressed again — every tier. */
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
        {named ?? band}
        <span class="cg-flt__n cg-num">{tier.fans}</span>
      </button>
      {tip.description}
    </>
  );
}

/**
 * The chips over the list as one segmented group: «Все 149», then the tiers — «Whale 4», «Top 4» …; «Ждут ответа»,
 * «Новые», the silences and the rest wait in «Фильтр»; the spinner while a new list is read over the one shown.
 */
export function BoardFilters({ board }: { readonly board: SpendersBoardVM }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const all = board.filters.find((filter) => filter.id === MAIN_FILTER);
  const hasWaiting = board.filters.some((filter) => filter.id === 'waiting');
  const others = board.filters.filter((filter) => filter.id !== MAIN_FILTER && !(hasWaiting && filter.id === SAME_AS_WAITING && !filter.pressed));
  const othersOn = others.filter((filter) => filter.pressed);
  const hasRows = board.shelves.some((shelf) => shelf.rows.length > 0);
  const tiers = board.tiers ?? [];
  return (
    <div class="cg-sp__filters">
      <span class="cg-sp__seg" role="group" aria-label={i18n.t('spenders.tiers')}>
        {all === undefined ? null : <FilterButton filter={all} />}
        {tiers.length < 2 ? null : tiers.map((tier) => <TierChip key={tier.id} tier={tier} />)}
      </span>
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

export function Board({ board, boardRef, unfolded = null, narrow = false }: BoardProps): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const announce = useAnnounce();
  // One minute ticker for every age in the list («3 ч», «19 д»).
  useMinuteClock(true);

  const unfold = unfolded !== null;
  const items = useMemo(() => boardItems(board.shelves, unfold), [board.shelves, unfold]);
  // A sort other than «Потратил» lists the fans without the tiers' headers: each row names its tier.
  const tierColumn = board.sort !== 'sum';
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
  const pressedAt = useRef(-Infinity);
  const pressedKey = useRef<string | null>(null);
  const onPress = useCallback((key: string): boolean => {
    const now = Date.now();
    const second = pressedKey.current === key && now - pressedAt.current < DOUBLE_CLICK_MS;
    // A pair is two clicks: the third starts the next pair.
    pressedKey.current = second ? null : key;
    pressedAt.current = now;
    return second;
  }, []);
  useLayoutEffect(() => {
    if (unfoldedAt < 0) return undefined;
    const reveal = (): void => {
      const list = listRef.current;
      // The row and its whole preview in view; when they are not, the row goes to the top, right under its shelf.
      if (list !== null && !(list.isInView(unfoldedAt - 1) && list.isInView(unfoldedAt))) list.scrollToIndex(unfoldedAt - 1, 'start');
    };
    // A click's preview: the row stays where the pointer is until a second click could have come (a double click).
    const wait = DOUBLE_CLICK_MS - (Date.now() - pressedAt.current);
    if (wait <= 0) {
      reveal();
      return undefined;
    }
    const timer = setTimeout(reveal, wait);
    return () => clearTimeout(timer);
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
      scrollToTop() {
        if (items.length > 0) listRef.current?.scrollToIndex(0, 'start');
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
        void dispatch(unfold && item.row.selected ? CLOSE_PREVIEW : openPreview(item.row.handle));
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
  const shownText = shown === null || !narrowed ? '' : i18n.t('spenders.footerShown', { n: shown });
  // A cut list says it once: «Показаны первые 1000 из 1240…» stands in for «1000 из 1240 фанов» (the header has the count).
  const cutText = cut === null ? null : cut.total === null ? i18n.t('spenders.truncatedNoTotal', { shown: cut.shown }) : i18n.t('spenders.truncated', { shown: cut.shown, total: cut.total });
  const footerText = cutText === null ? `${loaded}${shownText}` : shownText === '' ? cutText : `${cutText} ${shownText.replace(/^[\s.]+/, '')}`;
  const hasRows = items.length > 0;
  const fallback = board.waitingFallback ?? null;
  const showList = hasRows && board.view.s !== 'error' && board.view.s !== 'forbidden' && board.view.s !== 'empty';
  // A batch's progress stands over the list once nobody is ticked (the ticked have the bar row of the window).
  const progress = board.batch !== undefined && board.batch.picked === 0;
  const adds = useOutreachAdds(board.outreach);
  return (
    <section class={`cg-bd${tierColumn ? ' has-tier' : ''}${narrow ? ' is-narrow' : ''}`} aria-label={i18n.t('spenders.boardLabel')} data-cg-board={board.view.s} data-cg-sort={board.sort}>
      {progress && board.batch !== undefined ? <BatchBar list="spenders" batch={board.batch} {...(board.outreach?.open === true ? { hint: i18n.t('outreach.batchHint') } : {})} /> : null}
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
            header={<TableHead board={board} tierColumn={tierColumn} />}
            headerHeight={BOARD_HEIGHTS.head}
            isGroupHeader={(item) => item.kind === 'shelf'}
            stickyLead={unfoldedAt < 1 ? null : { index: unfoldedAt - 1, until: unfoldedAt + 1 }}
            // A press on the stuck fan folds their preview, as a press on their row does; the focus going back to the
            // row (the window does it) brings the row back into view.
            onStickyPress={(index) => {
              const item = items[index];
              if (item?.kind !== 'fan') return;
              setActiveKey(item.key);
              void dispatch(CLOSE_PREVIEW);
            }}
            listRef={listRef}
            onRangeChange={onRange}
            onKeyDown={onKeyDown}
            renderRow={(item, index, copy) => {
              // The column header is the table's first row.
              const rowIndex = index + 2;
              switch (item.kind) {
                case 'shelf':
                  return <ShelfRow shelf={item.shelf} rowIndex={rowIndex} />;
                case 'fan':
                  return (
                    <FanRow
                      row={item.row}
                      tierColumn={tierColumn}
                      expanded={unfold && item.row.selected}
                      itemKey={item.key}
                      index={index}
                      rowIndex={rowIndex}
                      active={index === current}
                      onPick={setActiveKey}
                      onPress={onPress}
                      adds={adds}
                      copy={copy === true}
                    />
                  );
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
      {/* SP-021: what is loaded and shown — only when something is missing or a search narrows the list (X65); one line. */}
      {whole && !narrowed && cutText === null ? null : (
        <div class="cg-sp__foot" {...(cutText === null ? {} : { role: 'status' })}>
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

// The look (1.44.0, the owner's «Таблица»): one grid for the header and every row — the check box, «Фан» (the name
// in strong ink, the @handle muted after it, cut first), the message, «Ждёт ответа» (terracotta: the board's only
// colour), «Мы писали» (plain; the units in a column of their own), [«Тир»], «Потратил» (strong, semibold), the
// period (muted), the action. Rows of 40 px on a hairline; hover — the sunk fill; the picked row — a 2 px bar at its
// left edge and a neutral ring, running on into the preview unfolded under it (X66). The period's column gives way
// first (a narrow list, or the statistics column open beside it), then the fan's column narrows; «Ждёт ответа» and
// «Мы писали» never hide.
export const BOARD_CSS = `
.cg-bd { display: flex; flex-direction: column; min-height: 0; min-width: 0; }
.cg-bd__list { flex: 1; min-height: 0; min-width: 0; container: cg-board / inline-size; }
.cg-bd__state { padding: 0; }
.cg-bd__state .cg-state--empty { justify-content: flex-start; text-align: left; padding: 24px 20px; }
.cg-bd__reset { padding: 0 20px 16px 12px; }
.cg-bd__banner { flex: none; border-bottom: 1px solid var(--cg-rule); }
.cg-bd__scroll {
  /* The columns that come and go are tracks of their own: unset, a track is not in the grid at all. */
  --cg-bd-gap: 16px; --cg-bd-fan: 240px; --cg-bd-msg: 120px; --cg-bd-per: 96px; --cg-bd-act: 104px;
  --cg-bd-ghost: color-mix(in srgb, var(--cg-ink-faint) 62%, var(--cg-surface));
  --cg-bd-line: color-mix(in srgb, var(--cg-rule) 72%, var(--cg-surface));
  scrollbar-color: var(--cg-rule-2) transparent;
}
.cg-bd.has-tier .cg-bd__scroll { --cg-bd-tier: 56px; }
.cg-bd.is-narrow .cg-bd__scroll { --cg-bd-per: initial; }
.cg-bd__row {
  display: grid; align-items: center; column-gap: var(--cg-bd-gap); height: 100%; padding: 0 16px; box-sizing: border-box;
  grid-template-columns: 16px var(--cg-bd-fan) minmax(var(--cg-bd-msg), 1fr) 92px 88px var(--cg-bd-tier,) 80px var(--cg-bd-per,) var(--cg-bd-act,);
  grid-template-rows: 40px; border-bottom: 1px solid var(--cg-bd-line); white-space: nowrap; cursor: pointer; outline: none;
  font-variant-numeric: tabular-nums;
}
.cg-bd__row > * { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.cg-bd__row:not(.cg-bd__head):hover { background: var(--cg-sunk); }
/* The keyboard's ring is neutral: terracotta stays the board's «ждёт» alone. */
.cg-bd .cg-bd__row:focus-visible { outline: none; border-radius: 0; box-shadow: inset 0 0 0 1px var(--cg-ink-muted); }
.cg-bd__row.is-sel, .cg-bd__row.is-sel:hover { background: var(--cg-sunk); box-shadow: inset 2px 0 0 var(--cg-ink), inset 0 0 0 1px var(--cg-rule-3); }
.cg-bd .cg-bd__row.is-sel:focus-visible { box-shadow: inset 2px 0 0 var(--cg-ink), inset 0 0 0 1px var(--cg-ink-muted); }
.cg-bd__row.has-batch { grid-template-rows: 40px 16px; align-content: start; }
.cg-bd__row.has-batch .cg-bt__line { padding-left: calc(16px + var(--cg-bd-gap)); }
.cg-bd.is-narrow .cg-bd__per { display: none; }
.cg-bd__head {
  height: 32px; grid-template-rows: 32px; border-bottom-color: var(--cg-rule-2); cursor: default;
  font-size: var(--cg-text-xs); font-weight: 500; color: var(--cg-ink-muted); background: var(--cg-surface);
}
.cg-bd__th.is-sort { display: flex; justify-content: flex-end; align-items: center; gap: 2px; overflow: visible; }
.cg-bd__sort { display: inline-flex; align-items: center; gap: 4px; height: 22px; padding: 0 2px; border-radius: var(--cg-r-xs); color: inherit; font: inherit; white-space: nowrap; }
.cg-bd__sort:hover, .cg-bd__th.is-on .cg-bd__sort { color: var(--cg-ink); }
.cg-bd .cg-bd__sort:focus-visible { outline: 1px solid var(--cg-ink-muted); outline-offset: 0; }
.cg-bd__sg { width: 10px; text-align: center; color: var(--cg-ink-faint); font-size: var(--cg-text-xs); }
.cg-bd__sort:hover .cg-bd__sg { color: var(--cg-ink-muted); }
.cg-bd__th.is-on .cg-bd__sg { color: var(--cg-ink); }
.cg-bd__head .cg-bd__pick { height: 22px; padding: 0 4px; margin-right: -2px; gap: 2px; font-size: var(--cg-text-xs); font-weight: 500; color: var(--cg-ink-2); }
.cg-bd__head .cg-bd__pick:hover { background: var(--cg-sunk); color: var(--cg-ink-strong); }
.cg-bd__head .cg-bd__pick .cg-ico { width: 12px; height: 12px; color: var(--cg-ink-muted); }
.cg-bd__head .cg-menu { z-index: 6; font-weight: 400; }
.cg-bd__check { display: flex; align-items: center; overflow: visible; }
.cg-bd .cg-bt__check { width: 16px; height: 16px; margin: 0; color: var(--cg-rule-3); }
.cg-bd__row:hover .cg-bt__check { color: var(--cg-ink-faint); }
.cg-bd .cg-bt__check[aria-checked="true"], .cg-bd .cg-bt__check[aria-checked="mixed"] { color: var(--cg-ink); }
.cg-bd .cg-bt__check .cg-cb { width: 14px; height: 14px; }
.cg-bd__who { display: flex; align-items: baseline; gap: 8px; }
.cg-bd__name { flex: 0 0 auto; max-width: 100%; min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--cg-ink-strong); font-weight: 500; }
.cg-bd__handle { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--cg-ink-muted); font-size: var(--cg-text-sm); }
.cg-bd__last { font-size: var(--cg-text-sm2); color: var(--cg-ink); }
.cg-bd__last.is-ours { color: var(--cg-ink-muted); }
.cg-bd__last.is-none { color: var(--cg-bd-ghost); }
.cg-bd__us { color: var(--cg-ink-faint); }
.cg-bd__wait, .cg-bd__wrote, .cg-bd__spent, .cg-bd__per { text-align: right; }
.cg-bd__wait { color: var(--cg-clay-ink); font-weight: 600; }
.cg-bd__wrote { color: var(--cg-ink-2); }
.cg-bd__head .cg-bd__wait, .cg-bd__head .cg-bd__wrote, .cg-bd__head .cg-bd__spent { color: var(--cg-ink-muted); font-weight: 500; }
.cg-age { display: inline-flex; justify-content: flex-end; }
.cg-age__u { width: 34px; padding-left: 4px; box-sizing: border-box; text-align: left; }
.cg-bd__tier { color: var(--cg-ink-muted); font-size: var(--cg-text-sm); }
.cg-bd__spent { color: var(--cg-ink-strong); font-weight: 600; }
.cg-bd__per { color: var(--cg-ink-muted); font-size: var(--cg-text-sm2); }
.cg-bd__none { color: var(--cg-bd-ghost); font-weight: 400; }
.cg-bd__row.is-deleted :is(.cg-bd__name, .cg-bd__handle, .cg-bd__last, .cg-bd__us, .cg-bd__wrote, .cg-bd__spent, .cg-bd__per) { color: var(--cg-bd-ghost); font-weight: 400; }
.cg-bd__act { display: flex; justify-content: flex-end; align-items: center; gap: 6px; overflow: visible; }
.cg-bd__open {
  visibility: hidden; display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 8px; border-radius: var(--cg-r-sm);
  box-shadow: inset 0 0 0 1px var(--cg-rule-3); background: var(--cg-surface); color: var(--cg-ink); font-size: var(--cg-text-sm); white-space: nowrap;
}
.cg-bd__open:hover { box-shadow: inset 0 0 0 1px var(--cg-ink-muted); color: var(--cg-ink-strong); }
.cg-bd__arr { color: var(--cg-ink-muted); }
.cg-bd__row:hover .cg-bd__open, .cg-bd__row.is-sel .cg-bd__open, .cg-bd__row:focus-visible .cg-bd__open { visibility: visible; }
.cg-bd__chat { font-size: var(--cg-text-xs); color: var(--cg-ink-muted); white-space: nowrap; }
.cg-bd__row:hover .cg-bd__chat[data-cg-chat="missing"], .cg-bd__row.is-sel .cg-bd__chat[data-cg-chat="missing"] { display: none; }
.cg-bd__shelf, .cg-bd__shelfrow { height: 32px; }
.cg-bd__shelfrow {
  display: flex; align-items: flex-end; padding: 0 16px 7px calc(32px + var(--cg-bd-gap)); box-sizing: border-box;
  border-bottom: 1px solid var(--cg-rule-2); background: var(--cg-surface); font-size: var(--cg-text-xs); line-height: 16px; white-space: nowrap;
}
.cg-bd__shelfname { display: inline-flex; align-items: baseline; gap: 8px; min-width: 0; overflow: hidden; }
.cg-bd__shelfname > b { font-weight: 600; color: var(--cg-ink); }
.cg-bd__band { color: var(--cg-ink-muted); }
.cg-bd__shelfn { color: var(--cg-ink-faint); }
/* A narrow list: the period's column gives way first, then the fan's column narrows; the ages stay. */
@container cg-board (max-width: 1100px) {
  .cg-bd__scroll { --cg-bd-gap: 12px; --cg-bd-fan: 184px; --cg-bd-per: initial; }
  .cg-bd .cg-bd__per { display: none; }
}
/* Narrower still: «Открыть чат» keeps its arrow alone. */
@container cg-board (max-width: 760px) {
  .cg-bd__scroll { --cg-bd-fan: 150px; --cg-bd-msg: 48px; --cg-bd-act: 28px; }
  .cg-bd .cg-bd__opent, .cg-bd .cg-bd__chat { display: none; }
  .cg-bd .cg-bd__open { padding: 0 7px; }
}
.cg-bd__unfold { height: 100%; padding: 0 0 10px; }
.cg-bd__unfoldcell {
  display: flex; flex-direction: column; height: 100%; border-bottom: 1px solid var(--cg-rule-2); box-shadow: inset 2px 0 0 var(--cg-ink);
  background: var(--cg-surface); overflow: hidden;
}
.cg-bd__unfoldcell > * { flex: 1; min-height: 0; }
/* The fan's row stands over the unfolded preview (stuck at the top while it scrolls): its name, money and ages are not
   said twice. */
.cg-bd__unfoldcell :is(.cg-pv__name, .cg-pv__money, .cg-pv__ages) { display: none; }
/* The unfolded preview is a row of the list: a wheel its feed (or its result) has no room left for scrolls the list on
   to the next fans, instead of stopping dead over the whole height the preview takes. */
.cg-bd__unfoldcell :is(.cg-pv.is-panel, .cg-feed, .cg-pv__work) { overscroll-behavior: auto; }
.cg-bd > .cg-sp__foot .cg-btn { margin-right: -8px; }
`;
