// The Spenders board as one model (architecture.md §8.5; SP-004…SP-021):
// the background's assembled board (up to 1000 rows of `/api/v2/spenders`
// with the hub's tier buckets) turned into shelves, then narrowed by the
// search and the filters. Built in two steps so a keystroke never redoes the
// shelving: `indexBoard` once per board, `viewBoard` per search, filter,
// sort or reveal. The hub's total is shown next to what is loaded; a board
// cut at the visible limit says so.

import { type AutoLists, type HubSpenderPeriod, type SpendersBoard } from '@cg/contracts/hub';
import { STORAGE_LIMITS } from '@cg/contracts/limits';
import { type CoverageLevel } from '@cg/contracts/ops';
import { type IsoTimestamp } from '@cg/contracts/primitives';
import { type SpendersFilter, type SpendersSort } from '@cg/contracts/vm';

import { filterCounts, filtersActive, rowMatches, searchNeedle, sortRows, waitingGroups, type BoardFilters } from './filters';
import { isNewSpender, spenderRows, type SpenderRow } from './rows';
import { UNBOUNDED, buildShelves, needsCents, shelfTotals, shownTotals, type BucketBasis, type Shelf, type ShelfRange, type ShelfTotals } from './shelves';

export interface BoardIndex {
  readonly pageLabel: string;
  readonly period: HubSpenderPeriod;
  readonly rows: readonly SpenderRow[];
  readonly shelves: readonly Shelf[];
  /** Rows on the board. */
  readonly loaded: number;
  /** The hub's total of the scope. */
  readonly total: number;
  /** The scope has more payers than the board shows (the 1000-row cut). */
  readonly truncated: boolean;
  /** Every page within the cap arrived. */
  readonly complete: boolean;
  /** Every payer of the scope is on the board: sums over rows are the scope's sums. */
  readonly wholeScope: boolean;
  /** How the hub's buckets relate to this board (ShelfScope.basis). */
  readonly basis: BucketBasis;
  /** The hub's tier buckets; null — their read failed and there are no shelves. */
  readonly tiers: AutoLists | null;
  readonly asOf: IsoTimestamp | null;
  readonly fetchedAt: IsoTimestamp;
  readonly timeZone: string | null;
  readonly coverage: CoverageLevel;
  readonly byFan: ReadonlyMap<string, SpenderRow>;
}

/**
 * How the buckets relate to the board. The hub's buckets are by the lifetime
 * spend over the whole page unless a period is asked for (this client asks
 * for none): they are a lifetime board's own, and wider than a board of a
 * period. Buckets by a period's spend are the board's own only on the very
 * same dates.
 */
function bucketBasis(board: SpendersBoard): BucketBasis {
  const tiers = board.tiers;
  if (tiers === null) return 'scope';
  if (tiers.metric === 'lifetimeGrossAmountMills') return board.period === 'lifetime' ? 'scope' : 'page';
  const sameDates = tiers.period.fromBusinessDate === board.periodMeta.fromBusinessDate && tiers.period.toBusinessDateInclusive === board.periodMeta.toBusinessDateInclusive;
  return board.period !== 'lifetime' && sameDates ? 'scope' : 'foreign';
}

/** Shelves and rows of a board; rows beyond the visible limit are dropped and counted as cut. */
export function indexBoard(board: SpendersBoard): BoardIndex {
  const rows = spenderRows(board.items.slice(0, STORAGE_LIMITS.listVisibleRows), board.period);
  const total = Math.max(board.total, rows.length);
  const truncated = total > rows.length;
  const wholeScope = board.complete && !truncated;
  return {
    pageLabel: board.pageLabel,
    period: board.period,
    rows,
    shelves: buildShelves(rows, board.tiers),
    loaded: rows.length,
    total,
    truncated,
    complete: board.complete,
    wholeScope,
    basis: bucketBasis(board),
    tiers: board.tiers,
    asOf: board.periodMeta.asOf,
    fetchedAt: board.fetchedAt,
    timeZone: board.periodMeta.timeZone.length > 0 ? board.periodMeta.timeZone : null,
    coverage: wholeScope ? 'complete' : 'partial',
    byFan: new Map(rows.map((row) => [row.fanRef, row])),
  };
}

/**
 * X66: the list is the lifetime board — every payer, as the old Fansly extension listed them — and its second sum
 * is a period's, taken from that period's own board (the old extension's month column). A fan the period board does
 * not list paid nothing in the period when that board is whole; otherwise, and while the period board is not read
 * (or its read failed), the second sum is unknown. `period` of the result names the second sum's period.
 */
export function withPeriod(list: BoardIndex, period: HubSpenderPeriod, delta: BoardIndex | null): BoardIndex {
  const whole = delta !== null && delta.wholeScope;
  const rows = list.rows.map((row): SpenderRow => {
    const amount = delta === null ? null : (delta.byFan.get(row.fanRef)?.period ?? (whole ? 0 : null));
    return { ...row, period: amount, isNew: isNewSpender(row.lifetime, amount, period) };
  });
  return { ...list, period, rows, shelves: buildShelves(rows, list.tiers), byFan: new Map(rows.map((row) => [row.fanRef, row])) };
}

export interface BoardQuery {
  /** The search as typed (normalized here). */
  readonly query: string;
  readonly filters: BoardFilters;
  readonly sort: SpendersSort;
  /** X67: a tier chip — the list shows that shelf alone; null or absent — every shelf. */
  readonly shelf?: string | null;
  /** The clock a silence filter counts the fan's days to; absent — no silence filter can pass a row. */
  readonly now?: number;
}

/** 1.44.0: a group of a sort other than `sum`, in place of the tiers (ShelfVM.group). */
export type BoardGroup = 'waiting' | 'rest' | 'flat';

export interface ShelfView {
  readonly id: string;
  readonly range: ShelfRange;
  readonly totals: ShelfTotals;
  /** Rows shown now. */
  readonly rows: readonly SpenderRow[];
  /** Rows of this shelf whose lifetime prints cents (SP-013). */
  readonly cents: ReadonlySet<string>;
  /** A group of the sort, not a tier; absent — a tier. */
  readonly group?: BoardGroup;
}

export interface BoardView {
  readonly shelves: readonly ShelfView[];
  /** Rows passing the search and the filters; null while neither narrows the list. */
  readonly shown: number | null;
  /** The search or a filter is on. */
  readonly narrowed: boolean;
  /** Fan ids in the order the list shows them: keyboard movement and the preview's neighbours. */
  readonly order: readonly string[];
  /** Every shown fan's tier: the «Тир» column of a list not grouped by the tiers. */
  readonly tierOf: ReadonlyMap<string, ShelfRange>;
}

/** Ids of the groups: never a shelf's (`shelf-…`), never dispatched back. */
const GROUP_IDS: Readonly<Record<BoardGroup, string>> = { waiting: 'group-waiting', rest: 'group-rest', flat: 'group-all' };

/**
 * The visible list: every row of every shelf, as the old Fansly extension
 * showed them (X66: the desktop's preview of four and two rows per shelf is
 * gone). A search or a filter shows every match and drops shelves without
 * one; a tier chip keeps its shelf alone (X67); an empty shelf is never drawn.
 * `source` — rows from another read placed on the board's shelves (the
 * server's «ждут ответа» queue). The plain view's shelf headers carry the
 * board's numbers (`shelfTotals`); a narrowed list's count the fans it shows
 * there, and sum over them (`shownTotals`). A sort other than `sum` (1.44.0)
 * lists the same rows without the tiers' headers: «Ждёт ответа» as two groups
 * — who waits, then the rest —, the other two as one list; each row keeps its
 * tier for the «Тир» column.
 */
export function viewBoard(index: BoardIndex, query: BoardQuery, source?: readonly SpenderRow[]): BoardView {
  const needle = searchNeedle(query.query);
  const narrowed = needle.length > 0 || filtersActive(query.filters) || source !== undefined;
  // Without a clock no fan is «silent»: a silence filter then shows nobody rather than a guess.
  const now = query.now ?? Number.NaN;
  const shelves: ShelfView[] = [];
  const tierOf = new Map<string, ShelfRange>();
  const centsOf = new Set<string>();
  const shown: SpenderRow[] = [];
  const own = new Map(index.shelves.map((shelf) => [shelf.id, shelf]));
  // A sourced row is shelved by the same buckets; its shelf's totals stay those of the board's own shelf.
  const placed: readonly Shelf[] = source === undefined ? index.shelves : buildShelves(source, index.tiers);
  // SP-013: the lifetime can cross a shelf bound only when the rows are shelved by it (buckets by a period's spend shelve by that spend,
  // which is the lifetime itself on a lifetime board).
  const lifetimeShelved = index.tiers === null || index.tiers.metric !== 'grossAmountMills' || index.period === 'lifetime';
  for (const shelf of placed) {
    if (shelf.rows.length === 0 || (query.shelf !== undefined && query.shelf !== null && shelf.id !== query.shelf)) continue;
    const matching = narrowed ? shelf.rows.filter((row) => rowMatches(row, query.filters, needle, now)) : shelf.rows;
    if (matching.length === 0) continue;
    for (const row of matching) {
      tierOf.set(row.fanRef, shelf.range);
      if (needsCents(row.lifetime, lifetimeShelved ? shelf.range : UNBOUNDED)) centsOf.add(row.fanRef);
    }
    shown.push(...matching);
    if (query.sort !== 'sum') continue;
    const rows = sortRows(matching, 'sum');
    shelves.push({
      id: shelf.id,
      range: shelf.range,
      // A narrowed list's header counts what the list shows on the shelf; the plain view's is the shelf's own.
      totals: narrowed ? shownTotals(matching) : shelfTotals(own.get(shelf.id) ?? shelf, index),
      rows,
      cents: new Set(rows.filter((row) => centsOf.has(row.fanRef)).map((row) => row.fanRef)),
    });
  }
  if (query.sort !== 'sum') {
    const split = query.sort === 'waiting' ? waitingGroups(shown) : null;
    const groups: readonly (readonly [BoardGroup, readonly SpenderRow[]])[] = split === null ? [['flat', sortRows(shown, query.sort)]] : [['waiting', split.waiting], ['rest', split.rest]];
    for (const [group, rows] of groups) {
      if (rows.length === 0) continue;
      shelves.push({ id: GROUP_IDS[group], range: UNBOUNDED, totals: shownTotals(rows), rows, cents: new Set(rows.filter((row) => centsOf.has(row.fanRef)).map((row) => row.fanRef)), group });
    }
  }
  const order = shelves.flatMap((shelf) => shelf.rows.map((row) => row.fanRef));
  return { shelves, shown: narrowed ? shown.length : null, narrowed, order, tierOf };
}

/** Counters of the filter buttons over the loaded rows («Все 40», «Ждут ответа 12», «Новые 3»). */
export function boardFilterCounts(index: BoardIndex, ids: readonly SpendersFilter[], now: number): Record<SpendersFilter, number> {
  return filterCounts(index.rows, ids, now);
}

/** The fan before and after `fanRef` in the visible order (SP-056); null at either end or when it is not listed. */
export function neighbours(order: readonly string[], fanRef: string): { readonly previous: string | null; readonly next: string | null } {
  const at = order.indexOf(fanRef);
  if (at < 0) return { previous: null, next: null };
  return { previous: order[at - 1] ?? null, next: order[at + 1] ?? null };
}

/** The shelf a fan sits on, to reveal it when the fan is opened from outside the list (the stats' queue, the palette). */
export function shelfOfFan(index: BoardIndex, fanRef: string): string | null {
  for (const shelf of index.shelves) {
    if (shelf.rows.some((row) => row.fanRef === fanRef)) return shelf.id;
  }
  return null;
}
