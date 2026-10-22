// The board's shelves as one flat list for the virtual list (architecture.md
// §10.1; ui-design §3.5, §4.14; 1.44.0 — the board as a table): per shelf its
// header «Whale  $600+ · 4 фана» (32 px, sticks while its fans are in view),
// or a group of the sort («Ждут ответа · дольше ждущие — первыми · 26 фанов»;
// a flat list has none), then every one of its fans (a 40 px row of the
// table's columns). The open preview unfolds under its fan's row (X66). An
// empty shelf is not drawn. Pure: the Board renders it, the tests measure it.

import { type I18nKey } from '@cg/contracts/errors';
import { type I18n, type ShelfVM, type SpenderRowVM, type SpendersStatsVM } from '@cg/contracts/vm';

export type BoardItem =
  | { readonly kind: 'shelf'; readonly key: string; readonly shelf: ShelfVM }
  | { readonly kind: 'fan'; readonly key: string; readonly row: SpenderRowVM }
  /** X66: the preview of the picked fan, unfolded under that fan's row. */
  | { readonly kind: 'preview'; readonly key: string; readonly handle: string };

/** 1.44.0: the table's sticky column header, a shelf's (or a group's) header row, a fan row. */
export const BOARD_HEIGHTS = { head: 32, shelf: 32, fan: 40 } as const;
/** 1.32.0: a fan in a batch has its line under the row. */
export const BATCH_FAN_HEIGHT = 60;

/**
 * The unfolded preview keeps to these heights; between them it fills the list under its row (X66). Under `min` (a
 * browser zoomed to 200 %) it stays that high and scrolls inside, as the short panel did (#217).
 */
export const INLINE_PREVIEW = { min: 220, max: 600 } as const;

/**
 * A shelf with no rows is skipped (§4.14 «Пустая полка не рисуется»); a flat list of a sort has no header row.
 * `unfold` — the open preview stands under the picked fan's row (X66); a picked fan the list does not show has none.
 */
export function boardItems(shelves: readonly ShelfVM[], unfold = false): BoardItem[] {
  const items: BoardItem[] = [];
  for (const shelf of shelves) {
    if (shelf.rows.length === 0) continue;
    if (shelf.group !== 'flat') items.push({ kind: 'shelf', key: `shelf:${shelf.id}`, shelf });
    for (const row of shelf.rows) {
      items.push({ kind: 'fan', key: `fan:${row.handle}`, row });
      if (unfold && row.selected) items.push({ kind: 'preview', key: `preview:${row.handle}`, handle: row.handle });
    }
  }
  return items;
}

/** `preview` — the unfolded preview's height, as the Board measured the room for it. */
export function boardItemHeight(item: BoardItem, preview: number = INLINE_PREVIEW.min): number {
  if (item.kind === 'preview') return preview;
  return item.kind === 'fan' && (item.row.batch?.state ?? null) !== null ? BATCH_FAN_HEIGHT : BOARD_HEIGHTS[item.kind];
}

/**
 * The unfolded preview's height for a list of `listHeight` px: the room under the column header, a sticky shelf
 * header and its fan's row, so the row and the whole preview are in view together; within INLINE_PREVIEW.
 */
export function inlinePreviewHeight(listHeight: number): number {
  const room = listHeight - BOARD_HEIGHTS.head - BOARD_HEIGHTS.shelf - BOARD_HEIGHTS.fan - 8;
  return Math.round(Math.min(INLINE_PREVIEW.max, Math.max(INLINE_PREVIEW.min, room)));
}

/** Rows the keyboard can stand on: the fans. */
export function isStop(item: BoardItem | undefined): boolean {
  return item !== undefined && item.kind === 'fan';
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
 * A row of the statistics' tier table: a remainder is named by what it is — «Удалённые аккаунты», «Без фана» (1.4.0;
 * the hub sends both, and neither has bounds) — a tier by its name, or its bounds where it has none.
 */
export function statsShelfLabel(i18n: I18n, shelf: Pick<SpendersStatsVM['shelves'][number], 'range' | 'remainder'>): string {
  if (shelf.remainder !== undefined) return i18n.t(`stats.shelf.${shelf.remainder}`);
  return shelfTier(i18n, shelf.range) ?? shelfLabel(i18n, shelf.range);
}

/**
 * The old Fansly extension's tiers (X67): its names for the hub's buckets of the same lower bounds — Whale $600+,
 * Top $350–600, Prime $150–350, Base $50–150, Low $25–50, Micro $1–25 (or $0–25). A bucket of other bounds has no
 * name: its bounds alone say what it is. No marks (1.44.0): the name and the bounds say it.
 */
const TIERS: readonly { readonly from: number; readonly key: I18nKey }[] = [
  { from: 600_000, key: 'spenders.tier.whale' },
  { from: 350_000, key: 'spenders.tier.top' },
  { from: 150_000, key: 'spenders.tier.prime' },
  { from: 50_000, key: 'spenders.tier.base' },
  { from: 25_000, key: 'spenders.tier.low' },
  { from: 1_000, key: 'spenders.tier.micro' },
  { from: 0, key: 'spenders.tier.micro' },
];

/** The tier's name («Whale»); null — a bucket of other bounds, or none. */
export function shelfTier(i18n: I18n, range: ShelfVM['range']): string | null {
  if (range.fromMills === null && range.toMills === null) return null;
  const from = range.fromMills ?? 0;
  // The lowest tier is «$1–25» or «$0–25»; a bucket under a dollar is not Micro.
  const tier = TIERS.find((item) => item.from === from && (from > 1_000 || range.toMills === 25_000));
  return tier === undefined ? null : i18n.t(tier.key);
}
