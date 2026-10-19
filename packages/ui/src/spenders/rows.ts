// The board's shelves as one flat list for the virtual list (architecture.md
// §10.1; ui-design §3.5, §4.14): a column header on top, then per shelf its
// thin divider (28 px, sticks under the column header; X65), its fans (36 px)
// and, when the shelf is cut, «ещё N · показать». A 6 px gap stands before
// every shelf but the first. An empty shelf is not drawn. Pure: the Board renders
// it, the tests measure it.

import { type I18n, type ShelfVM, type SpenderRowVM, type SpendersStatsVM } from '@cg/contracts/vm';

export type BoardItem =
  | { readonly kind: 'gap'; readonly key: string }
  | { readonly kind: 'shelf'; readonly key: string; readonly shelf: ShelfVM }
  | { readonly kind: 'fan'; readonly key: string; readonly row: SpenderRowVM }
  | { readonly kind: 'more'; readonly key: string; readonly shelf: ShelfVM; readonly hidden: number };

/** Heights of ui-design §3.5: the column header, a shelf divider, the gap above a shelf, a fan row, «ещё N · показать». */
export const BOARD_HEIGHTS = { header: 28, shelf: 28, gap: 6, fan: 36, more: 32 } as const;
/** 1.32.0: a fan in a batch has its line under the row. */
export const BATCH_FAN_HEIGHT = 54;

/** A shelf with nothing to show (no rows and nothing hidden) is skipped (§4.14 «Пустая полка не рисуется»). */
export function boardItems(shelves: readonly ShelfVM[]): BoardItem[] {
  const items: BoardItem[] = [];
  for (const shelf of shelves) {
    const hidden = shelf.collapsed?.hidden ?? 0;
    if (shelf.rows.length === 0 && hidden <= 0) continue;
    if (items.length > 0) items.push({ kind: 'gap', key: `gap:${shelf.id}` });
    items.push({ kind: 'shelf', key: `shelf:${shelf.id}`, shelf });
    for (const row of shelf.rows) items.push({ kind: 'fan', key: `fan:${row.handle}`, row });
    if (shelf.collapsed !== null && hidden > 0) items.push({ kind: 'more', key: `more:${shelf.id}`, shelf, hidden });
  }
  return items;
}

export function boardItemHeight(item: BoardItem): number {
  return item.kind === 'fan' && (item.row.batch?.state ?? null) !== null ? BATCH_FAN_HEIGHT : BOARD_HEIGHTS[item.kind];
}

/** Rows the keyboard can stand on: fans and «ещё N · показать». */
export function isStop(item: BoardItem | undefined): boolean {
  return item !== undefined && (item.kind === 'fan' || item.kind === 'more');
}

/** The next keyboard stop from `from` in `direction`; stays put at the ends. */
export function nextStop(items: readonly BoardItem[], from: number, direction: 1 | -1): number {
  for (let index = from + direction; index >= 0 && index < items.length; index += direction) {
    if (isStop(items[index])) return index;
  }
  return from;
}

/** The first (`edge` 1) or the last (`edge` -1) keyboard stop; -1 when there is none. */
export function edgeStop(items: readonly BoardItem[], edge: 1 | -1): number {
  if (edge === 1) return items.findIndex(isStop);
  for (let index = items.length - 1; index >= 0; index -= 1) if (isStop(items[index])) return index;
  return -1;
}

/** Where the keyboard starts: the selected fan (its preview is open), else the first stop. */
export function initialStop(items: readonly BoardItem[]): number {
  const selected = items.findIndex((item) => item.kind === 'fan' && item.row.selected);
  return selected >= 0 ? selected : edgeStop(items, 1);
}

export function fanCount(items: readonly BoardItem[]): number {
  let count = 0;
  for (const item of items) if (item.kind === 'fan') count += 1;
  return count;
}

/**
 * A shelf's name from the hub's tier bounds: «$600+», «$350–600», both
 * unknown — «вне полок» (SP-008). The amounts come from the I18n port's one
 * money notation; a range prints its sign once, as the tiers are named.
 */
export function shelfLabel(i18n: I18n, range: ShelfVM['range']): string {
  const { fromMills, toMills } = range;
  if (fromMills === null && toMills === null) return i18n.t('spenders.shelf.none');
  const from = i18n.formatMoneyMills(fromMills ?? 0, { zero: 'show' });
  if (toMills === null) return i18n.t('spenders.shelf.from', { from });
  const to = i18n.formatMoneyMills(toMills, { zero: 'show' }).replace(/^\D+/, '');
  return i18n.t('spenders.shelf.range', { from, to });
}

/**
 * A row of the statistics' tier table: a remainder is named by what it is — «Без тира», «Не распределено» (1.4.0;
 * the hub sends both, and neither has bounds) — a tier by its bounds.
 */
export function statsShelfLabel(i18n: I18n, shelf: Pick<SpendersStatsVM['shelves'][number], 'range' | 'remainder'>): string {
  return shelf.remainder === undefined ? shelfLabel(i18n, shelf.range) : i18n.t(`stats.shelf.${shelf.remainder}`);
}
