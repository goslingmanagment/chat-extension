// Shelves of the Spenders board (architecture.md §8.5 «Тиры», SP-007…SP-011,
// SP-013): the hub's tier buckets (`pageSpenderAutoLists`: $600+, $350–600,
// $150–350, $50–150, $25–50, $1–25 — bounds and order are the hub's), the
// loaded rows each one holds, and the «вне полок» shelf for the rest. A
// shelf's sum is shown only when every member of the shelf is loaded:
// a sum over a cut list would pass a part for the whole.

import { type AutoLists } from '@cg/contracts/hub';
import { type MoneyMills } from '@cg/contracts/primitives';

import { type SpenderRow } from './rows';

/** The shelf of fans no bucket takes (below the lowest bound, or an unknown amount). */
export const OUTSIDE_SHELF_ID = 'shelf-outside';

/** SP-010: the first shelf previews four rows, the others two; a shelf above fifty starts collapsed. */
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
  /** The hub's count, or the loaded count when the whole scope is loaded; null — unknown. */
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

/**
 * The shelf header numbers. `wholeScope` — every payer of the scope is on
 * the board (nothing cut at 1000, every page arrived). A shelf whose members
 * are not all loaded has no sum: null («—»), never the sum of the part.
 */
export function shelfTotals(shelf: Shelf, wholeScope: boolean): ShelfTotals {
  const allLoaded = wholeScope || (shelf.hubCount !== null && shelf.rows.length >= shelf.hubCount);
  return {
    fans: shelf.hubCount ?? (wholeScope ? shelf.rows.length : null),
    lifetime: allLoaded ? sum(shelf.rows, (row) => row.lifetime) : null,
    period: allLoaded ? sum(shelf.rows, (row) => row.period) : null,
  };
}

/** SP-010: rows a shelf shows in the plain «Все» view before «ещё N · показать»; `position` counts non-empty shelves. */
export function shelfPreviewCount(position: number, members: number): number {
  if (members > SHELF_COLLAPSED_ABOVE) return 0;
  return Math.min(members, position === 0 ? SHELF_PREVIEW_FIRST : SHELF_PREVIEW_REST);
}

const wholeDollars = (mills: MoneyMills): MoneyMills => Math.round(mills / 1000) * 1000;

/**
 * SP-013: amounts print as whole dollars, except where the rounding would
 * move the amount across its shelf's bound ($599.60 printed as «$600» on the
 * $350–600 shelf) or below a dollar turns it into «$0»: those print cents.
 */
export function needsCents(mills: MoneyMills | null, range: ShelfRange): boolean {
  if (mills === null || mills <= 0 || mills % 1000 === 0) return false;
  if (mills < 1000) return true;
  const rounded = wholeDollars(mills);
  if (range.toMills !== null && mills < range.toMills && rounded >= range.toMills) return true;
  if (range.fromMills !== null && mills >= range.fromMills && rounded < range.fromMills) return true;
  return false;
}
