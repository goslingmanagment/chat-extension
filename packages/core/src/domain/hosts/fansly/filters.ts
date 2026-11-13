// The filters above Fansly's chats (2026-11-13, contracts fansly-filters.ts): the pure rules both strips are drawn by.
//
// - The set: Fansly's chips as read, matched with the full names of the page's own answers by position (a full name is
//   taken only when Fansly's cut of it is the chip's label), each list classified by its name alone (groups spec §1.1:
//   a step of FBuddy's spend ladder, another FBuddy list, the agency's own) and each tier by its words (groups §1.2).
// - «Две полки»: the rows for a set and a width (shelves spec §3, §4), the texts measured by the view. Nothing of it
//   depends on a count, the active filter, a hover or a focus.
// - «Четыре группы»: the numbers of the two groups (groups spec §3, §7) from MAIN's copy of the unread of the loaded
//   chats, and the check of that copy against Fansly's own badges (§7.4).

import type {
  FanslyFilterBlock,
  FanslyFilterChip,
  FanslyFilterItem,
  FanslyFilterKind,
  FanslyFilterMemo,
  FanslyFilterNames,
  FanslyFilterRef,
  FanslyFilterSet,
  FanslyFilterUnread,
  FanslyShelfCell,
  FanslyShelvesLayout,
  FanslyTextMeasure,
} from '@cg/contracts/fansly-filters';

// ── names ──

/**
 * Fansly prints a tier's name and a list's label as its first 20 characters, and `...` when it is longer than 21
 * (main:73925, 73993: `slice(0, 20)` always): a name of exactly 21 loses its last character and gets no dots.
 */
export function fanslyCut(name: string): string {
  return `${name.slice(0, 20)}${name.length > 21 ? '...' : ''}`;
}

/** Fansly's badge as a number: `99+` is 100; null — none, 0. */
export function badgeNumber(count: string | null): number {
  if (count === null) return 0;
  if (count === '99+') return 100;
  const n = Number(count);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}

/** A number as Fansly prints a badge: null for 0, `99+` above 99. */
export function badgeText(n: number): string | null {
  return n <= 0 ? null : n > 99 ? '99+' : String(n);
}

/** Whether our number is the badge Fansly printed (`99+` equals any number above 99). */
export function sameBadge(ours: number, printed: string | null): boolean {
  if (printed === '99+') return ours > 99;
  return badgeText(ours) === printed;
}

const WORD = /[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}\p{Nd}]/u;

/**
 * A tier's words (groups spec §1.2): from the first to the last Latin, Cyrillic or Greek letter or digit, the symbols
 * and marks inside taken out, runs of spaces collapsed. No such letter: the name as it is. Fansly's `...` of a cut
 * name is dropped first.
 */
export function tierWords(name: string): string {
  const s = name.replace(/\.\.\.$/, '');
  const chars = [...s];
  let first = -1;
  let last = -1;
  chars.forEach((char, index) => {
    if (!WORD.test(char)) return;
    if (first < 0) first = index;
    last = index;
  });
  if (first < 0) return s.trim() || name;
  const words = chars
    .slice(first, last + 1)
    .join('')
    .replace(/[\p{S}\p{M}]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return words === '' ? name : words;
}

// ── the kind of a pinned list (groups spec §1.1, with the shelves' `hi > lo`) ──

const TAIL = String.raw`(?=\s*(?:Spe|\.\.\.|$))`;
const RX_RANGE = new RegExp(String.raw`^\[FB\]\s*\$\s*([\d.,]+)\s*(k)?\s*[-–]\s*\$?\s*([\d.,]+)\s*(k)?` + TAIL, 'i');
const RX_OPEN = new RegExp(String.raw`^\[FB\]\s*\$\s*([\d.,]+)\s*(k)?\s*(?:\+|and up|or more)` + TAIL, 'i');
const RX_OVER = new RegExp(String.raw`^\[FB\]\s*(?:Over|Above)\s*\$\s*([\d.,]+)\s*(k)?` + TAIL, 'i');
const RX_FB = /^\[FB\]/i;
const RX_EMOJI = /^(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|\p{Emoji_Modifier})*|\p{Regional_Indicator}{2})\s*(.*)$/u;

const amount = (digits: string, k: string | undefined): number => {
  const value = Number.parseFloat(digits.replace(/,/g, ''));
  return k === undefined ? value : value * 1000;
};

export type FanslyListKind =
  | { readonly kind: 'step'; readonly lo: number; readonly hi: number | null }
  | { readonly kind: 'fb'; readonly name: string }
  | { readonly kind: 'own'; readonly emoji: string | null; readonly name: string };

/** What a pinned list is, by its name alone: an unknown name is never dropped and never guessed into the ladder. */
export function classifyList(name: string): FanslyListKind {
  const range = RX_RANGE.exec(name);
  if (range !== null) {
    const lo = amount(range[1] ?? '', range[2]);
    const hi = amount(range[3] ?? '', range[4]);
    if (Number.isFinite(lo) && Number.isFinite(hi) && hi > lo) return { kind: 'step', lo, hi };
  } else {
    const open = RX_OPEN.exec(name) ?? RX_OVER.exec(name);
    if (open !== null) {
      const lo = amount(open[1] ?? '', open[2]);
      if (Number.isFinite(lo)) return { kind: 'step', lo, hi: null };
    }
  }
  if (RX_FB.test(name)) {
    const rest = name.replace(/^\[FB\]\s*/i, '');
    return { kind: 'fb', name: rest === '' ? name : rest };
  }
  const emoji = RX_EMOJI.exec(name);
  return emoji !== null && emoji[2] !== undefined && emoji[2] !== '' ? { kind: 'own', emoji: emoji[1] ?? null, name: emoji[2] } : { kind: 'own', emoji: null, name };
}

/** `v` as a short amount: 1000 → 1k, 2500 → 2.5k. */
const kilo = (v: number): string => (v >= 1000 ? `${String(v / 1000).replace(/\.0$/, '')}k` : String(v));

/** A step's text: full `0-50`, `1000+`; compact `500-1k`, `1k+`. A hyphen-minus, never a dash. */
export function stepText(step: { readonly lo: number; readonly hi: number | null }, compact: boolean): string {
  const f = compact ? kilo : String;
  return step.hi === null ? `${f(step.lo)}+` : `${f(step.lo)}-${f(step.hi)}`;
}

/** Steps ascending: by `lo`, a finite `hi` before an open one, then by `hi`. */
export function compareSteps(a: { readonly lo: number; readonly hi: number | null }, b: { readonly lo: number; readonly hi: number | null }): number {
  return a.lo - b.lo || (a.hi === null ? (b.hi === null ? 0 : 1) : b.hi === null ? -1 : a.hi - b.hi);
}

// ── the set ──

const chipItem = (key: string, ref: FanslyFilterRef, kind: FanslyFilterKind, chip: FanslyFilterChip, more: Partial<FanslyFilterItem>): FanslyFilterItem => ({
  key,
  ref,
  kind,
  label: chip.label,
  full: chip.label,
  cut: false,
  color: null,
  emoji: null,
  step: null,
  id: null,
  memo: null,
  count: chip.count,
  n: badgeNumber(chip.count),
  active: chip.active,
  ...more,
});

/**
 * The page's data for each chip, in order: a chip takes the next entry whose cut is its label (shelves spec §8.3: by
 * position, only when they agree), so a list unpinned since the data was read leaves the others matched; null — none.
 * A label that as many entries as chips do not share is ambiguous (two lists with one cut, one of them unpinned since the
 * data was read): its chips get no name and no id, never another list's — the strip would name one and unpin another.
 * `repeats` false — the chips changed since the data came: a label two chips print can be matched by order no more (A
 * unpinned and pinned again puts it after B in Fansly while the data still says A, B), so those chips get neither.
 */
export function aligned<T>(chips: readonly FanslyFilterChip[], data: readonly T[], name: (entry: T) => string, repeats = true): Array<T | null> {
  const cuts = data.map((entry) => fanslyCut(name(entry)));
  const tally = (labels: readonly string[]): Map<string, number> => {
    const counted = new Map<string, number>();
    for (const label of labels) counted.set(label, (counted.get(label) ?? 0) + 1);
    return counted;
  };
  const inData = tally(cuts);
  const onChips = tally(chips.map((chip) => chip.label));
  let next = 0;
  return chips.map((chip) => {
    const printed = onChips.get(chip.label) ?? 0;
    if (inData.get(chip.label) !== printed || (!repeats && printed > 1)) return null;
    for (let at = next; at < data.length; at += 1) {
      if (cuts[at] !== chip.label) continue;
      next = at + 1;
      return data[at] as T;
    }
    return null;
  });
}

/** Fansly's label of a chip it cut: `...` at its end. */
const printedCut = (label: string): boolean => label.endsWith('...');

/** Whether a label two chips print may still take its names by order (aligned's `repeats`), for the tiers and the lists. */
export interface FanslyNamesFresh {
  readonly tiers: boolean;
  readonly lists: boolean;
}

/**
 * The set of a block: every filter as an item, the full names taken where the page's data agrees with the chip (in
 * order, `fanslyCut(full) === label`), the lists classified. `staff` — our own label of Fansly's Staff chip (it prints
 * the VIPs string on it); `fresh` — the names came after the chips last changed (aligned's `repeats`).
 */
export function filterSet(block: FanslyFilterBlock, names: FanslyFilterNames, staff: string, fresh: FanslyNamesFresh = { tiers: true, lists: true }): FanslyFilterSet & { readonly items: ReadonlyMap<string, FanslyFilterItem> } {
  const base: FanslyFilterItem[] = [
    chipItem('all', { kind: 'base', base: 'all' }, 'base', block.all, {}),
    chipItem('subscribers', { kind: 'base', base: 'subscribers' }, 'base', block.subscribers, {}),
    chipItem('vips', { kind: 'base', base: 'vips' }, 'base', block.vips, {}),
    chipItem('followers', { kind: 'base', base: 'followers' }, 'base', block.followers, {}),
    ...(block.staff === null ? [] : [chipItem('staff', { kind: 'base', base: 'staff' }, 'base', block.staff, { label: staff, full: staff })]),
  ];
  const tierOf = aligned(block.tiers, names.tiers ?? [], (data) => data.name, fresh.tiers);
  const tiers = block.tiers.map((chip, index) => {
    const matched = tierOf[index] ?? null;
    const full = matched?.name ?? chip.label;
    return chipItem(`tier:${String(index)}`, { kind: 'tier', index, label: chip.label }, 'tier', chip, {
      label: tierWords(full),
      full,
      cut: matched === null && printedCut(chip.label),
      color: chip.color ?? matched?.color ?? null,
      id: matched?.id ?? null,
      memo: matched?.id ?? `label:${chip.label}`,
    });
  });
  const listOf = aligned(block.lists, names.lists ?? [], (data) => data.label, fresh.lists);
  const pinned = block.lists.map((chip, index) => {
    const matched = listOf[index] ?? null;
    const full = matched?.label ?? chip.label;
    const kind = classifyList(full);
    const ref: FanslyFilterRef = { kind: 'list', index, label: chip.label };
    const common = { full, cut: matched === null && printedCut(chip.label), id: matched?.id ?? null, memo: matched?.id ?? `label:${chip.label}` };
    const key = `list:${String(index)}`;
    if (kind.kind === 'step') return chipItem(key, ref, 'step', chip, { ...common, label: stepText(kind, false), step: { lo: kind.lo, hi: kind.hi } });
    if (kind.kind === 'fb') return chipItem(key, ref, 'fb', chip, { ...common, label: kind.name });
    return chipItem(key, ref, 'own', chip, { ...common, label: kind.name, emoji: kind.emoji });
  });
  const lists = pinned.filter((item) => item.kind !== 'step');
  const steps = pinned.filter((item) => item.kind === 'step').sort((a, b) => compareSteps(a.step ?? { lo: 0, hi: null }, b.step ?? { lo: 0, hi: null }));
  const items = new Map<string, FanslyFilterItem>();
  for (const item of [...base, ...tiers, ...pinned]) items.set(item.key, item);
  // What the layout depends on: what exists, its names and colours — never a count or the active filter.
  const signature = JSON.stringify([base.map((item) => item.label), tiers.map((item) => [item.label, item.full, item.color]), pinned.map((item) => [item.kind, item.label, item.full, item.emoji])]);
  return { signature, base, tiers, lists, steps, items };
}

/** The item that is on now; null — none (Fansly shows exactly one: a block that says otherwise does not read). */
export function activeItem(items: ReadonlyMap<string, FanslyFilterItem>): FanslyFilterItem | null {
  for (const item of items.values()) if (item.active) return item;
  return null;
}

// ── «Две полки»: the layout (shelves spec §3, §4) ──

export const SHELF_GEOMETRY = { PAD: 8, PADIN: 5, ICGAP: 3, STAR: 12, SLGAP: 3, SLOT: 18, INSET: 2, GAP: 5, JOINT: 1, MORE: 24, LLGAP: 6, LMAX: 120, LIST_ROWS: 2, STEP_ROWS: 2 } as const;
const G = SHELF_GEOMETRY;
const RIGHT = G.SLGAP + G.SLOT + G.INSET;

export interface ShelvesWords {
  readonly ladder: string;
  readonly ladderShort: string;
  readonly more: (count: number) => string;
  /** A step in full where the chip shows less: `$1000-$2500`. */
  readonly stepFull: (step: { readonly lo: number; readonly hi: number | null }) => string;
}

interface Cell {
  key: string;
  type: FanslyShelfCell['type'];
  text: string | null;
  tip: string | null;
  inner: boolean;
  joint: boolean;
  shape: FanslyShelfCell['shape'];
  hidden: string[];
  stick: boolean;
  w: number;
}

const cell = (key: string, type: Cell['type'], text: string | null, w: number, more: Partial<Cell> = {}): Cell => ({ key, type, text, tip: null, inner: false, joint: false, shape: null, hidden: [], stick: false, w, ...more });

/**
 * The rows of «Две полки» for a set and a content width `width`: shelf 1 — All, Subscribers and its tiers glued (one
 * row: named, stars, or cut behind «ещё N»); shelf 2 — VIPs, Followers, Staff and the lists (two rows at most, the tail
 * of the pin order behind «ещё N»); shelf 3 — the spend ladder (none, one or two rows), «⋯» last of all.
 */
export function shelvesLayout(set: FanslyFilterSet, width: number, measure: FanslyTextMeasure, words: ShelvesWords): FanslyShelvesLayout {
  const fit = (x: number): boolean => x <= width + 0.01;
  const tw = (text: string): number => measure(text, 'label');
  const cw = (o: { readonly inner?: boolean; readonly icon?: number; readonly label?: string | null }): number =>
    (o.inner === true ? G.PADIN : G.PAD) + (o.icon !== undefined && o.icon > 0 ? o.icon + (o.label !== null && o.label !== undefined ? G.ICGAP : 0) : 0) + (o.label !== null && o.label !== undefined ? Math.min(tw(o.label), G.LMAX) : 0) + RIGHT;
  const more = (): Cell => cell('more', 'more', null, G.MORE, { stick: true });
  const overflow = (key: string, hidden: readonly FanslyFilterItem[]): Cell => {
    const text = words.more(hidden.length);
    return cell(key, 'overflow', text, cw({ label: text }), { hidden: hidden.map((item) => item.key) });
  };
  const rows: Array<{ shelf: 1 | 2 | 3; cells: Cell[] }> = [];
  const base = new Map(set.base.map((item) => [item.key, item]));
  const named = (key: string): Cell => {
    const label = base.get(key)?.label ?? key;
    return cell(key, 'chip', label, cw({ label }));
  };

  // Shelf 1: All, then Subscribers with its tiers as one pill. One row, always.
  const all = named('all');
  const subs = named('subscribers');
  const tierCell = (item: FanslyFilterItem, withName: boolean): Cell =>
    cell(item.key, 'chip', withName ? item.label : null, cw({ inner: true, icon: G.STAR, label: withName ? item.label : null }), { inner: true, tip: withName ? (tw(item.label) > G.LMAX ? item.full : null) : item.label });
  const head = all.w + G.GAP + subs.w;
  const family = (cells: readonly Cell[]): number => head + cells.reduce((sum, c) => sum + G.JOINT + c.w, 0);
  let tierCells = set.tiers.map((item) => tierCell(item, true));
  let hiddenTiers: FanslyFilterItem[] = [];
  let tierMode: FanslyShelvesLayout['tierMode'] = set.tiers.length > 0 ? 'named' : 'none';
  if (!fit(family(tierCells))) {
    tierCells = set.tiers.map((item) => tierCell(item, false));
    tierMode = 'stars';
    if (!fit(family(tierCells))) {
      let k = set.tiers.length - 1;
      const ow = (n: number): number => cw({ label: words.more(n) });
      while (k > 0 && !fit(family(tierCells.slice(0, k)) + G.GAP + ow(set.tiers.length - k))) k -= 1;
      hiddenTiers = set.tiers.slice(Math.max(k, 0));
      tierCells = tierCells.slice(0, Math.max(k, 0));
      tierMode = 'cut';
    }
  }
  const first = [all, subs, ...tierCells];
  if (tierCells.length > 0) {
    first.forEach((c, index) => {
      if (index === 0) return;
      c.shape = index === 1 ? 'first' : index === first.length - 1 ? 'last' : 'middle';
      c.joint = index < first.length - 1;
    });
  }
  if (hiddenTiers.length > 0) first.push(overflow('ov:tiers', hiddenTiers));
  rows.push({ shelf: 1, cells: first });

  // Shelf 2: VIPs, Followers, Staff, then the lists in pin order. Two rows at most; the rest behind «ещё N».
  const listCell = (item: FanslyFilterItem): Cell =>
    cell(item.key, 'chip', item.label, cw({ icon: item.emoji === null ? 0 : measure(item.emoji, 'emoji'), label: item.label }), { tip: tw(item.label) > G.LMAX || item.cut ? item.full : null });
  const second = [named('vips'), named('followers'), ...(base.has('staff') ? [named('staff')] : [])];
  const tail2 = set.steps.length === 0 ? [more()] : [];
  const pack = (cells: readonly Cell[]): Cell[][] => {
    const out: Cell[][] = [[]];
    let x = 0;
    cells.forEach((c, index) => {
      let need = c.w;
      for (let j = index + 1; j < cells.length && cells[j]?.stick === true; j += 1) need += G.GAP + (cells[j]?.w ?? 0);
      const row = out[out.length - 1] as Cell[];
      if (row.length > 0 && !c.stick && !fit(x + G.GAP + need)) {
        out.push([c]);
        x = c.w;
      } else {
        x += (row.length > 0 ? G.GAP : 0) + c.w;
        row.push(c);
      }
    });
    return out;
  };
  const listCells = set.lists.map(listCell);
  let rows2 = pack([...second, ...listCells, ...tail2]);
  if (rows2.length > G.LIST_ROWS) {
    let m = set.lists.length - 1;
    for (; m >= 0; m -= 1) {
      rows2 = pack([...second, ...listCells.slice(0, m), overflow('ov:lists', set.lists.slice(m)), ...tail2]);
      if (rows2.length <= G.LIST_ROWS) break;
    }
  }
  for (const cells of rows2) rows.push({ shelf: 2, cells });

  // Shelf 3: the spend ladder, lowest first; a hole is a break in the pill; «⋯» at its end.
  let ladder: FanslyShelvesLayout['ladder'] = null;
  const steps = set.steps;
  if (steps.length > 0) {
    const glued = (index: number): boolean => {
      const prev = steps[index - 1]?.step;
      const step = steps[index]?.step;
      return prev !== undefined && prev !== null && step !== undefined && step !== null && prev.hi !== null && prev.hi === step.lo;
    };
    const build = (label: string, compact: boolean, split: readonly number[]): Cell[][] => {
      const out: Cell[][] = [];
      let row: Cell[] = [cell('label', 'label', label, tw(label) + G.LLGAP)];
      steps.forEach((item, index) => {
        if (split.includes(index)) {
          out.push(row);
          row = [];
        }
        const prev = row[row.length - 1];
        const inner = prev !== undefined && prev.type === 'chip' && glued(index);
        const step = item.step ?? { lo: 0, hi: null };
        const text = stepText(step, compact);
        const c = cell(item.key, 'chip', text, cw({ inner, label: text }), { inner, tip: compact && text !== stepText(step, false) ? words.stepFull(step) : null });
        if (inner && prev !== undefined) prev.joint = true;
        row.push(c);
      });
      row.push(more());
      out.push(row);
      return out;
    };
    const shapes = (built: Cell[][]): Cell[][] => {
      for (const r of built)
        for (const c of r) {
          if (c.type !== 'chip') continue;
          c.shape = c.inner && c.joint ? 'middle' : c.joint ? 'first' : c.inner ? 'last' : null;
        }
      return built;
    };
    const rowWidth = (r: readonly Cell[]): number => r.reduce((sum, c, index) => sum + c.w + (index === 0 ? 0 : r[index - 1]?.type === 'label' ? 0 : r[index - 1]?.joint === true ? G.JOINT : G.GAP), 0);
    const ok = (built: readonly Cell[][]): boolean => built.every((r) => fit(rowWidth(r)));
    const levels: ReadonlyArray<readonly [string, boolean]> = [
      [words.ladder, false],
      [words.ladderShort, false],
      [words.ladderShort, true],
    ];
    let chosen: Cell[][] | null = null;
    for (const [label, compact] of levels) {
      const built = build(label, compact, []);
      if (ok(built)) {
        chosen = built;
        ladder = { label, compact };
        break;
      }
    }
    if (chosen === null && steps.length > 1) {
      const greedy = (label: string, compact: boolean): Cell[][] | null => {
        for (let s = steps.length - 1; s >= 1; s -= 1) {
          const built = build(label, compact, [s]);
          if (fit(rowWidth(built[0] ?? []))) return built;
        }
        return null;
      };
      for (const [label, compact] of levels) {
        const even = build(label, compact, [Math.ceil(steps.length / 2)]);
        const built = ok(even) ? even : greedy(label, compact);
        if (built !== null && ok(built)) {
          chosen = built;
          ladder = { label, compact };
          break;
        }
      }
    }
    if (chosen === null) {
      // More steps than two rows hold: the top of the ladder behind «ещё N», before «⋯».
      for (let m = steps.length - 1; m >= 1; m -= 1) {
        let split = 1;
        for (let s = m; s >= 1; s -= 1) {
          if (fit(rowWidth(build(words.ladderShort, true, [s])[0] ?? []))) {
            split = s;
            break;
          }
        }
        const built = build(words.ladderShort, true, [split]);
        const kept = new Set(steps.slice(0, m).map((item) => item.key));
        const cut = built.map((r) => r.filter((c) => c.type !== 'chip' || kept.has(c.key)));
        const last = cut[cut.length - 1] as Cell[];
        last.splice(last.length - 1, 0, overflow('ov:steps', steps.slice(m)));
        const prev = last[last.length - 3];
        if (prev !== undefined && prev.type === 'chip') prev.joint = false;
        if (ok(cut) && cut.length <= G.STEP_ROWS) {
          chosen = cut;
          ladder = { label: words.ladderShort, compact: true };
          break;
        }
      }
      if (chosen === null) {
        chosen = build(words.ladderShort, true, [1]);
        ladder = { label: words.ladderShort, compact: true };
      }
    }
    for (const cells of shapes(chosen)) rows.push({ shelf: 3, cells });
  }

  return {
    rows: rows.map((r) => ({
      shelf: r.shelf,
      cells: r.cells.map((c): FanslyShelfCell => ({ key: c.key, type: c.type, text: c.text, tip: c.tip, shape: c.shape, inner: c.inner, joint: c.joint, hidden: c.hidden })),
    })),
    tierMode,
    ladder,
  };
}

/** The sum of the counts an «ещё N» hides, as a badge (`99+` counts as 100). */
export function hiddenCount(hidden: readonly string[], items: ReadonlyMap<string, FanslyFilterItem>): string | null {
  return badgeText(hidden.reduce((sum, key) => sum + (items.get(key)?.n ?? 0), 0));
}

// ── «Четыре группы»: the numbers (groups spec §3, §7) ──

/** Our counts from MAIN's copy, by the page's list and tier ids. */
export interface GroupCounts {
  readonly all: number;
  readonly subscribers: number;
  tier(id: string): number;
  list(id: string): number;
  /** Unread in chats whose fan is in at least one of `ids`, each chat once; `except` — not in that one. */
  union(ids: readonly string[], except?: string): number;
}

/**
 * Our counts, in one pass over the rows: All is MAIN's count over every chat (Fansly's All counts the chats it has not
 * loaded too); subscribers, tiers and lists over the loaded chats with a known fan, as Fansly's filters count them.
 */
export function groupCounts(unread: FanslyFilterUnread): GroupCounts {
  const rows = unread.rows;
  let subscribers = 0;
  const tiers = new Map<string, number>();
  const lists = new Map<string, number>();
  for (const row of rows) {
    if (row.subscriber) subscribers += row.unread;
    if (row.tierId !== null) tiers.set(row.tierId, (tiers.get(row.tierId) ?? 0) + row.unread);
    for (const id of row.lists) lists.set(id, (lists.get(id) ?? 0) + row.unread);
  }
  return {
    all: unread.all,
    subscribers,
    tier: (id) => tiers.get(id) ?? 0,
    list: (id) => lists.get(id) ?? 0,
    union: (ids, except) => {
      const wanted = new Set(ids);
      let total = 0;
      for (const row of rows) if (row.lists.some((id) => wanted.has(id)) && (except === undefined || !row.lists.includes(except))) total += row.unread;
      return total;
    },
  };
}

export interface CountsCheck {
  /** Every compared number is Fansly's own. */
  readonly agree: boolean;
  /** A compared badge was `99+`: equal by its letter, not proven equal by its number. */
  readonly saturated: boolean;
}

/**
 * The self-check (§7.4): our All and our count of every pinned list against Fansly's badges, and our Subscribers while
 * Fansly's badge of it is its own (`subscribers`: false — a tier was on since Subscribers itself was, and Fansly prints
 * that tier's number on it, main:74387, 74458-74460). A list whose id is not known has nothing to be checked by: no.
 */
export function countsAgree(set: FanslyFilterSet, items: ReadonlyMap<string, FanslyFilterItem>, counts: GroupCounts, subscribers: boolean): CountsCheck {
  let saturated = false;
  const same = (ours: number, printed: string | null | undefined): boolean => {
    if (printed === '99+') saturated = true;
    return printed !== undefined && sameBadge(ours, printed);
  };
  const no = (): CountsCheck => ({ agree: false, saturated });
  if (!same(counts.all, items.get('all')?.count)) return no();
  if (subscribers && !same(counts.subscribers, items.get('subscribers')?.count)) return no();
  for (const item of [...set.lists, ...set.steps]) {
    if (item.id === null) return no();
    if (!same(counts.list(item.id), items.get(item.key)?.count ?? null)) return no();
  }
  return { agree: true, saturated };
}

/** The short name a group shows: a step `$250-500`, a tier's words, a list's name. */
export function shortName(item: FanslyFilterItem): string {
  return item.kind === 'step' && item.step !== null ? `$${stepText(item.step, true)}` : item.label;
}

export interface GroupsWords {
  readonly allLists: string;
  readonly noneUnread: string;
  readonly perList: string;
  readonly unionLine: (count: string) => string;
  readonly more: (count: number) => string;
}

export interface GroupsNumbers {
  readonly split: boolean;
  readonly oneTier: FanslyFilterItem | null;
  readonly tier: FanslyFilterItem | null;
  readonly subscribers: string | null;
  readonly tierRest: string | null;
  readonly list: FanslyFilterItem | null;
  readonly union: string | null;
  readonly listRest: string | null;
  readonly dot: boolean;
  readonly summary: readonly [string, string];
}

/**
 * What the two groups show. `counts` — our counts when they are vouched for (the self-check), else null: then no union
 * and no rest numbers, a dot where something inside is unread, and «Subscribers» without a number while Fansly's badge
 * of it counts a tier (`tierStale`).
 */
export function groupsNumbers(set: FanslyFilterSet, items: ReadonlyMap<string, FanslyFilterItem>, memo: FanslyFilterMemo, counts: GroupCounts | null, words: GroupsWords, tierStale: boolean): GroupsNumbers {
  const live = (item: FanslyFilterItem): FanslyFilterItem => items.get(item.key) ?? item;
  const split = set.tiers.length >= 2;
  const tier = split && memo.tier !== null ? (set.tiers.find((item) => item.memo === memo.tier) ?? null) : null;
  // Ours when vouched for; Fansly's badge only while it is its own (no tier on since Subscribers itself was).
  const subscribers = counts !== null ? badgeText(counts.subscribers) : tierStale ? null : (items.get('subscribers')?.count ?? null);
  const tierRest = tier !== null && counts !== null && tier.id !== null ? badgeText(counts.subscribers - counts.tier(tier.id)) : null;
  const pinned = [...set.steps, ...set.lists];
  const list = memo.list === null ? null : (pinned.find((item) => item.memo === memo.list) ?? null);
  const ids = pinned.flatMap((item) => (item.id === null ? [] : [item.id]));
  const union = counts === null || list !== null ? null : badgeText(counts.union(ids));
  const others = list === null ? [] : ids.filter((id) => id !== list.id);
  const listRest = counts === null || list === null || list.id === null ? null : badgeText(counts.union(others, list.id));
  const dot = counts === null && pinned.some((item) => item.key !== list?.key && live(item).n > 0);
  const withUnread = pinned
    .map((item) => live(item))
    .filter((item) => item.n > 0)
    .sort((a, b) => b.n - a.n);
  const summary: readonly [string, string] =
    withUnread.length === 0
      ? [words.allLists, words.noneUnread]
      : [
          withUnread
            .slice(0, 3)
            .map((item) => `${shortName(item)} ${item.count ?? ''}`)
            .join(' · ') + (withUnread.length > 3 ? ` · ${words.more(withUnread.length - 3)}` : ''),
          counts === null ? words.perList : words.unionLine(badgeText(counts.union(ids)) ?? '0'),
        ];
  return { split, oneTier: set.tiers.length === 1 ? (set.tiers[0] ?? null) : null, tier, subscribers, tierRest, list, union, listRest, dot, summary };
}
