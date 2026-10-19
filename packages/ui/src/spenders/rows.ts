// The board's shelves as one flat list for the virtual list (architecture.md
// §10.1; ui-design §3.5, §4.14; X67 — the old Fansly extension's list): per
// shelf its header «🐳 Whale  $600+ … 42» (36 px, sticks while its fans are in
// view), then every one of its fans (52 px: the initials, the name over the
// @handle, the lifetime over «+$N» of the period). The open preview unfolds
// under its fan's row (X66). An empty shelf is not drawn. Pure: the Board
// renders it, the tests measure it.

import { type I18nKey } from '@cg/contracts/errors';
import { type I18n, type ShelfVM, type SpenderRowVM, type SpendersStatsVM } from '@cg/contracts/vm';

export type BoardItem =
  | { readonly kind: 'shelf'; readonly key: string; readonly shelf: ShelfVM }
  | { readonly kind: 'fan'; readonly key: string; readonly row: SpenderRowVM }
  /** X66: the preview of the picked fan, unfolded under that fan's row. */
  | { readonly kind: 'preview'; readonly key: string; readonly handle: string };

/** Heights of ui-design §3.5 (X67): a shelf's header with the air above it, a fan row. */
export const BOARD_HEIGHTS = { shelf: 36, fan: 52 } as const;
/** 1.32.0: a fan in a batch has its line under the row. */
export const BATCH_FAN_HEIGHT = 72;

/**
 * The unfolded preview keeps to these heights; between them it fills the list under its row (X66). Under `min` (a
 * browser zoomed to 200 %) it stays that high and scrolls inside, as the short panel did (#217).
 */
export const INLINE_PREVIEW = { min: 220, max: 600 } as const;

/**
 * A shelf with no rows is skipped (§4.14 «Пустая полка не рисуется»). `unfold` — the open preview stands under the
 * picked fan's row (X66); a picked fan the list does not show has none.
 */
export function boardItems(shelves: readonly ShelfVM[], unfold = false): BoardItem[] {
  const items: BoardItem[] = [];
  for (const shelf of shelves) {
    if (shelf.rows.length === 0) continue;
    items.push({ kind: 'shelf', key: `shelf:${shelf.id}`, shelf });
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
 * The unfolded preview's height for a list of `listHeight` px: the room under a sticky shelf header and its fan's
 * row, so the row and the whole preview are in view together; within INLINE_PREVIEW.
 */
export function inlinePreviewHeight(listHeight: number): number {
  const room = listHeight - BOARD_HEIGHTS.shelf - BOARD_HEIGHTS.fan - 8;
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
 * A row of the statistics' tier table: a remainder is named by what it is — «Без тира», «Не распределено» (1.4.0;
 * the hub sends both, and neither has bounds) — a tier by its bounds.
 */
export function statsShelfLabel(i18n: I18n, shelf: Pick<SpendersStatsVM['shelves'][number], 'range' | 'remainder'>): string {
  return shelf.remainder === undefined ? shelfLabel(i18n, shelf.range) : i18n.t(`stats.shelf.${shelf.remainder}`);
}

/**
 * The old Fansly extension's tiers (X67): its names and marks for the hub's buckets of the same lower bounds —
 * 🐳 Whale $600+, ⭐ Top $350–600, ✅ Prime $150–350, ③ Base $50–150, ② Low $25–50, ① Micro $1–25 (or $0–25). A
 * bucket of other bounds has no name: its bounds alone say what it is.
 */
const TIERS: readonly { readonly from: number; readonly mark: string; readonly key: I18nKey }[] = [
  { from: 600_000, mark: '🐳', key: 'spenders.tier.whale' },
  { from: 350_000, mark: '⭐', key: 'spenders.tier.top' },
  { from: 150_000, mark: '✅', key: 'spenders.tier.prime' },
  { from: 50_000, mark: '③', key: 'spenders.tier.base' },
  { from: 25_000, mark: '②', key: 'spenders.tier.low' },
  { from: 1_000, mark: '①', key: 'spenders.tier.micro' },
  { from: 0, mark: '①', key: 'spenders.tier.micro' },
];

export function shelfTier(i18n: I18n, range: ShelfVM['range']): { readonly mark: string; readonly name: string } | null {
  if (range.fromMills === null && range.toMills === null) return null;
  const from = range.fromMills ?? 0;
  // The lowest tier is «$1–25» or «$0–25»; a bucket under a dollar is not Micro.
  const tier = TIERS.find((item) => item.from === from && (from > 1_000 || range.toMills === 25_000));
  return tier === undefined ? null : { mark: tier.mark, name: i18n.t(tier.key) };
}

/** The row's picture where there is none: the first letters of the first two words that have one («Theodore Whitfield» → TW). */
export function initialsOf(name: string): string {
  const letters = name
    .split(/\s+/)
    .map((word) => /[\p{L}\p{N}]/u.exec(word)?.[0] ?? '')
    .filter((letter) => letter !== '')
    .slice(0, 2)
    .join('');
  return letters === '' ? '?' : letters.toLocaleUpperCase();
}
