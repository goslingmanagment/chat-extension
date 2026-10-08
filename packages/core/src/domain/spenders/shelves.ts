// Shelves of the Spenders board (architecture.md §8.5 «Тиры», SP-007…SP-011,
// SP-013): the hub's tier buckets (`pageSpenderAutoLists`: $600+, $350–600,
// $150–350, $50–150, $25–50, $1–25 — bounds and order are the hub's), the
// loaded rows each one holds, and the «вне полок» shelf for the rest. A
// shelf's sum is shown only when every member of the shelf is loaded:
// a sum over a cut list would pass a part for the whole. And the header's
// count and its sums always speak of the same fans: the hub counts a bucket
// over the whole page by the buckets' own metric (the lifetime spend, as
// this client asks for them), while a board of a period lists only that
// period's payers — so a count of the page never stands next to a sum over
// the rows that happen to be listed.

import { type AutoLists } from '@cg/contracts/hub';
import { type MoneyMills } from '@cg/contracts/primitives';

import { type SpenderRow } from './rows';

/** The shelf of fans no bucket takes (below the lowest bound, or an unknown amount). */
export const OUTSIDE_SHELF_ID = 'shelf-outside';

/**
 * SP-010: the first shelf previews four rows, the others two; a shelf of
 * MORE than fifty fans starts collapsed. The bound is the desktop's own
 * (`shelfPresentation`: `usersCount > SHELF_COLLAPSED_MIN_COUNT`, with its
 * test pinning that exactly fifty still previews): a shelf of fifty previews,
 * a shelf of fifty-one is collapsed.
 */
export const SHELF_PREVIEW_FIRST = 4;
export const SHELF_PREVIEW_REST = 2;
export const SHELF_COLLAPSED_ABOVE = 50;

export interface ShelfRange {
  readonly fromMills: MoneyMills | null;
  /** Exclusive; null — open-ended. */
  readonly toMills: MoneyMills | null;
}

export interface Shelf {
  readonly id: string;
  readonly range: ShelfRange;
  /** The hub's own member count of the bucket; null — the hub gave none. */
  readonly hubCount: number | null;
  /** Loaded members, in the hub's ranking order. */
  readonly rows: readonly SpenderRow[];
}

/** A shelf id the UI can pass back (HANDLE_PATTERN): `shelf-<bucket key>`. */
export function shelfIdOf(key: string): string {
  const clean = key.replace(/[^A-Za-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '');
  return `shelf-${clean.length === 0 ? 'x' : clean}`.slice(0, 120);
}

type Bucket = AutoLists['lists'][number];

/** Buckets from the richest down; a bucket without a valid range is dropped. */
export function orderedBuckets(tiers: AutoLists | null): Bucket[] {
  if (tiers === null) return [];
  return tiers.lists
    .filter((bucket) => bucket.maxAmountMillsExclusive === null || bucket.maxAmountMillsExclusive > bucket.minAmountMills)
    .slice()
    .sort((a, b) => b.minAmountMills - a.minAmountMills);
}

/** The amount a row is shelved by: the buckets' own metric. */
export function shelvedAmount(row: SpenderRow, tiers: AutoLists | null): MoneyMills | null {
  return tiers !== null && tiers.metric === 'grossAmountMills' ? row.period : row.lifetime;
}

function bucketOf(amount: MoneyMills | null, buckets: readonly Bucket[]): Bucket | null {
  if (amount === null) return null;
  for (const bucket of buckets) {
    if (amount >= bucket.minAmountMills && (bucket.maxAmountMillsExclusive === null || amount < bucket.maxAmountMillsExclusive)) return bucket;
  }
  return null;
}

/**
 * Rows on their shelves, richest shelf first, «вне полок» last. Without
 * buckets (their read failed) everything is one shelf with no bounds: the
 * ranking still shows (SpendersBoard.tiers).
 */
export function buildShelves(rows: readonly SpenderRow[], tiers: AutoLists | null): Shelf[] {
  const buckets = orderedBuckets(tiers);
  const byKey = new Map<string, SpenderRow[]>();
  const outside: SpenderRow[] = [];
  for (const row of rows) {
    const bucket = bucketOf(shelvedAmount(row, tiers), buckets);
    if (bucket === null) outside.push(row);
    else {
      const list = byKey.get(bucket.key);
      if (list === undefined) byKey.set(bucket.key, [row]);
      else list.push(row);
    }
  }
  const shelves: Shelf[] = buckets.map((bucket) => ({
    id: shelfIdOf(bucket.key),
    range: { fromMills: bucket.minAmountMills, toMills: bucket.maxAmountMillsExclusive },
    hubCount: bucket.entryCount,
    rows: byKey.get(bucket.key) ?? [],
  }));
  shelves.push({ id: OUTSIDE_SHELF_ID, range: { fromMills: null, toMills: null }, hubCount: null, rows: outside });
  return shelves;
}

export interface ShelfTotals {
  /** The members of the shelf: the hub's count of the bucket, or the listed rows when they are the whole shelf; null — unknown. */
  readonly fans: number | null;
  readonly lifetime: MoneyMills | null;
  readonly period: MoneyMills | null;
}

function sum(rows: readonly SpenderRow[], pick: (row: SpenderRow) => MoneyMills | null): MoneyMills | null {
  let total = 0;
  for (const row of rows) {
    const value = pick(row);
    if (value === null) return null;
    total += value;
  }
  return total;
}

/** How the hub's buckets relate to the board that shows them. */
export type BucketBasis =
  /**
   * The buckets count the fans of the board's own scope: buckets by the
   * lifetime spend under a lifetime board, or buckets of the board's own
   * period. A board without buckets is its own one shelf.
   */
  | 'scope'
  /**
   * Buckets by the lifetime spend under a board of a period: every listed
   * row is a member of its bucket (it is shelved by its lifetime), but the
   * bucket also counts fans the board does not list — they paid nothing in
   * the period.
   */
  | 'page'
  /**
   * Buckets by the spend of other dates than the board's: the board has no
   * such amount to shelve its rows by, so the hub's counts say nothing
   * about the rows under a shelf.
   */
  | 'foreign';

/** What the board knows about its own completeness, for a shelf header. */
export interface ShelfScope {
  /** Every payer of the board's scope is on the board (nothing cut at 1000, every page arrived). */
  readonly wholeScope: boolean;
  readonly basis: BucketBasis;
}

/**
 * The shelf header numbers: a count and sums that always speak of the same
 * fans.
 * - The listed rows ARE the shelf when the whole scope is on the board and
 *   the hub's buckets count nobody else (`scope`, or `foreign`, where the
 *   shelf is just the board's own rows in the range): the count is theirs,
 *   every sum is exact.
 * - Otherwise the count is the hub's, and the lifetime sum is given only
 *   when exactly as many rows are listed as the hub counts — every member
 *   is here.
 * - Under `page` buckets the period sum is also exact whenever the whole
 *   scope is on the board: a member that is not listed paid nothing in the
 *   period.
 * - Rows that outnumber the hub's count contradict it, and `foreign` counts
 *   are of other fans: the count is unknown, never a number its own rows
 *   disprove.
 * Everything else is null («—»), never the sum of a part.
 */
export function shelfTotals(shelf: Shelf, scope: ShelfScope): ShelfTotals {
  const loaded = shelf.rows.length;
  const count = scope.basis === 'foreign' ? null : shelf.hubCount;
  const rowsAreShelf = scope.wholeScope && scope.basis !== 'page';
  const allMembers = rowsAreShelf || (count !== null && loaded === count);
  return {
    fans: rowsAreShelf ? loaded : count !== null && loaded <= count ? count : null,
    lifetime: allMembers ? sum(shelf.rows, (row) => row.lifetime) : null,
    period: allMembers || scope.wholeScope ? sum(shelf.rows, (row) => row.period) : null,
  };
}

/**
 * The shelf header of a narrowed list (a search, a filter, the «ждут ответа» queue): it speaks of the fans the list
 * shows on that shelf — their count, and sums over exactly them (null when an amount of one of them is unknown). The
 * hub's bucket count is the page's, not the tab's: «$600+ 31» over the five who wait for a reply was the third live
 * check's complaint.
 */
export function shownTotals(rows: readonly SpenderRow[]): ShelfTotals {
  return { fans: rows.length, lifetime: sum(rows, (row) => row.lifetime), period: sum(rows, (row) => row.period) };
}

/** SP-010: rows a shelf shows in the plain «Все» view before «ещё N · показать»; `position` counts non-empty shelves. */
export function shelfPreviewCount(position: number, members: number): number {
  if (members > SHELF_COLLAPSED_ABOVE) return 0;
  return Math.min(members, position === 0 ? SHELF_PREVIEW_FIRST : SHELF_PREVIEW_REST);
}

const wholeDollars = (mills: MoneyMills): MoneyMills => Math.round(mills / 1000) * 1000;

/** No bounds: an amount that was not shelved by this range (only the «below a dollar» rule applies). */
export const UNBOUNDED: ShelfRange = { fromMills: null, toMills: null };

/**
 * SP-013: amounts print as whole dollars, except where the rounding would
 * move the amount across its shelf's bound ($599.60 printed as «$600» on the
 * $350–600 shelf) or below a dollar turns it into «$0»: those print cents.
 * `range` is the shelf the amount was shelved by (`shelvedAmount`): another
 * amount of the row has no bound to cross.
 */
export function needsCents(mills: MoneyMills | null, range: ShelfRange): boolean {
  if (mills === null || mills <= 0 || mills % 1000 === 0) return false;
  if (mills < 1000) return true;
  const rounded = wholeDollars(mills);
  if (range.toMills !== null && mills < range.toMills && rounded >= range.toMills) return true;
  if (range.fromMills !== null && mills >= range.fromMills && rounded < range.fromMills) return true;
  return false;
}
