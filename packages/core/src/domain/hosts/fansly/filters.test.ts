// The rules of the filters above Fansly's chats (./filters.ts): the kind of a list by its name (cut labels, open-ended
// steps, amounts in k, a non-bracket FBuddy list), the shelves' layout on random sets (shelves spec §4 «Acceptance»),
// and «Четыре группы»' numbers: the union without repeats, the rest, and the self-check that turns them into dots.

import { describe, expect, it } from 'vitest';

import type { FanslyFilterBlock, FanslyFilterChip, FanslyFilterNames, FanslyShelfCell } from '@cg/contracts/fansly-filters';

import { classifyList, countsAgree, fanslyCut, filterSet, groupCounts, groupsNumbers, shelvesLayout, stepText, tierWords } from './filters';

const chip = (label: string, more: Partial<FanslyFilterChip> = {}): FanslyFilterChip => ({ label, active: false, count: null, ...more });
const block = (tiers: readonly string[], lists: readonly string[], more: Partial<FanslyFilterBlock> = {}): FanslyFilterBlock => ({
  all: chip('All', { active: true }),
  subscribers: chip('Subscribers'),
  staff: null,
  vips: chip('VIPs'),
  followers: chip('Followers'),
  tiers: tiers.map((name) => ({ ...chip(fanslyCut(name)), color: '#4781b4' })),
  lists: lists.map((name) => chip(fanslyCut(name))),
  spinning: false,
  width: 464,
  ...more,
});
const names = (tiers: readonly string[], lists: readonly string[]): FanslyFilterNames => ({
  tiers: tiers.map((name, index) => ({ id: `70000000000000040${String(index)}`, name, color: null })),
  lists: lists.map((label, index) => ({ id: `7000000000000004${String(10 + index)}`, label })),
});
const WORDS = { ladder: 'Траты, $', ladderShort: '$', more: (n: number) => `ещё ${String(n)}`, stepFull: (s: { lo: number; hi: number | null }) => `$${String(s.lo)}-$${String(s.hi)}` };
/** A text's width as the strip's 12.25 px font about measures it; an emoji 15. */
const measure = (text: string, kind: 'label' | 'emoji'): number => (kind === 'emoji' ? 15 : [...text].reduce((w, c) => w + (/[A-ZА-Я]/.test(c) ? 8.2 : /[ .,'il|1]/.test(c) ? 3.4 : 6.6), 0));

describe('the kind of a pinned list', () => {
  it('reads FBuddy steps from the full name and from the label Fansly cut', () => {
    expect(classifyList('[FB] $0-$50 Spenders')).toEqual({ kind: 'step', lo: 0, hi: 50 });
    expect(classifyList('[FB] $500-$1000 Spen...')).toEqual({ kind: 'step', lo: 500, hi: 1000 });
    expect(classifyList(fanslyCut('[FB] $1000-$2500 Spenders'))).toEqual({ kind: 'step', lo: 1000, hi: 2500 });
    expect(classifyList('[FB] $1,000-$2,500 Spenders')).toEqual({ kind: 'step', lo: 1000, hi: 2500 });
    expect(classifyList('[FB] $2.5k-$5k Spenders')).toEqual({ kind: 'step', lo: 2500, hi: 5000 });
  });

  it('reads open-ended steps in each of the guessed forms', () => {
    expect(classifyList('[FB] $1000+ Spenders')).toEqual({ kind: 'step', lo: 1000, hi: null });
    expect(classifyList('[FB] $5k and up')).toEqual({ kind: 'step', lo: 5000, hi: null });
    expect(classifyList('[FB] Over $2500')).toEqual({ kind: 'step', lo: 2500, hi: null });
  });

  it('never guesses a step: a range going down, another FBuddy list, the agency’s own', () => {
    expect(classifyList('[FB] $500-$100 Spenders').kind).toBe('fb');
    expect(classifyList('[FB] Top 1% Spenders')).toEqual({ kind: 'fb', name: 'Top 1% Spenders' });
    expect(classifyList('[FB]Auto-Renew OFF')).toEqual({ kind: 'fb', name: 'Auto-Renew OFF' });
    expect(classifyList('[FB] $$$ whales')).toEqual({ kind: 'fb', name: '$$$ whales' });
    expect(classifyList('🟡 Потенциал')).toEqual({ kind: 'own', emoji: '🟡', name: 'Потенциал' });
    expect(classifyList('⏳ Кастом')).toEqual({ kind: 'own', emoji: '⏳', name: 'Кастом' });
    expect(classifyList('Вернуть в подписку')).toEqual({ kind: 'own', emoji: null, name: 'Вернуть в подписку' });
  });

  it('writes a step full and compact with a hyphen-minus', () => {
    expect(stepText({ lo: 500, hi: 1000 }, false)).toBe('500-1000');
    expect(stepText({ lo: 500, hi: 1000 }, true)).toBe('500-1k');
    expect(stepText({ lo: 1000, hi: 2500 }, true)).toBe('1k-2.5k');
    expect(stepText({ lo: 1000, hi: null }, true)).toBe('1k+');
  });

  it('keeps a tier’s words', () => {
    expect(tierWords('⋆˙⟡ my friend ⋆˙⟡')).toBe('my friend');
    expect(tierWords('꒰ა . ა꒱ my boyfriend...')).toBe('my boyfriend');
    expect(tierWords('★ VIP ♡ lounge ★')).toBe('VIP lounge');
    expect(tierWords('かわいい')).toBe('かわいい');
  });
});

describe('the set', () => {
  it('cuts a name as Fansly prints it: twenty characters always, dots only past twenty-one', () => {
    expect(fanslyCut('123456789012345678901')).toBe('12345678901234567890');
    expect(fanslyCut('1234567890123456789012')).toBe('12345678901234567890...');
    expect(fanslyCut('12345678901234567890')).toBe('12345678901234567890');
    const name = 'Клиенты из Германии!!';
    const set = filterSet(block([], [name]), names([], [name]), 'Staff');
    expect(set.lists[0]?.id).not.toBeNull();
    expect(set.lists[0]?.full).toBe(name);
  });

  it('gives no name and no id to chips whose cut more or fewer entries share (one of two alike unpinned)', () => {
    const a = 'Clients from Germany A';
    const b = 'Clients from Germany B';
    expect(fanslyCut(a)).toBe(fanslyCut(b));
    // Both pinned, both known: each chip its own.
    const both = filterSet(block([], [a, b]), names([], [a, b]), 'Staff');
    expect(both.lists.map((item) => item.full)).toEqual([a, b]);
    // A unpinned, the names not read again yet: B's chip must not take A's name and id.
    const stale = filterSet(block([], [b]), names([], [a, b]), 'Staff');
    expect(stale.lists[0]?.id).toBeNull();
    expect(stale.lists[0]?.full).toBe(fanslyCut(b));
    // The chips changed since the names came: alike labels get nothing, a label of its own keeps its name.
    const moved = filterSet(block([], [b, '💩 Бомж', a]), names([], [a, '💩 Бомж', b]), 'Staff', { tiers: true, lists: false });
    expect(moved.lists.map((item) => [item.full, item.id === null])).toEqual([
      [fanslyCut(b), true],
      ['💩 Бомж', false],
      [fanslyCut(a), true],
    ]);
  });

  it('takes a full name only where Fansly’s cut of it is the chip’s label, in order', () => {
    const lists = ['[FB] $0-$50 Spenders', '💩 Бомж', '📸 Хотят кастом фото и видео'];
    const set = filterSet(block([], lists), names([], lists), 'Staff');
    expect(set.lists.map((item) => [item.full, item.cut, item.id !== null])).toEqual([
      ['💩 Бомж', false, true],
      ['📸 Хотят кастом фото и видео', false, true],
    ]);
    // A list unpinned since the names were read: the others keep their names.
    const stale = filterSet(block([], [lists[0] as string, lists[2] as string]), names([], lists), 'Staff');
    expect(stale.lists.map((item) => item.full)).toEqual(['📸 Хотят кастом фото и видео']);
    // No names: the chip's label, cut.
    const bare = filterSet(block([], lists), { tiers: null, lists: null }, 'Staff');
    expect(bare.lists[1]?.label).toBe('Хотят кастом фото...');
    expect(bare.lists[1]?.cut).toBe(true);
  });
});

/** A seeded generator: the same sets on every run. */
function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TIERS = ['⋆˙⟡ my friend ⋆˙⟡', '₊˚♡˚₊ my bff ₊˚♡˚₊', '꒰ა . ა꒱ my boyfriend ꒰ა . ა꒱', '✧ my husband ✧', '♛ VIP lounge ♛', '☾ inner circle ☽', '₊˚ platinum ˚₊', '♡ besties ♡'];
const OWN = ['💩 Бомж', '⏳ Кастом', '🟡 Потенциал', '🔥 Писали на этой неделе', '🐳 Киты', '💤 Спящие', '🎁 Ждёт подарок', '🚫 Не писать', '🆕 Новенькие', '🧊 Холодные', 'Вернуть в подписку', '📸 Хотят кастом фото и видео'];
const FB = ['[FB] Top 1% Spenders', '[FB] Auto-Renew OFF', '[FB] New Followers', '[FB] Recently Messaged'];
const BOUNDS = [0, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

describe('«Две полки»: the layout on any set (shelves spec §4, acceptance)', () => {
  const rnd = random(20261113);
  const pick = <T,>(pool: readonly T[], n: number): T[] => [...pool].sort(() => rnd() - 0.5).slice(0, n);
  for (let run = 0; run < 400; run += 1) {
    const tiers = pick(TIERS, Math.floor(rnd() * 9));
    const steps: string[] = [];
    for (let i = 0; i < BOUNDS.length - 1; i += 1) if (rnd() < 0.55) steps.push(`[FB] $${String(BOUNDS[i])}-$${String(BOUNDS[i + 1])} Spenders`);
    if (rnd() < 0.3) steps.push('[FB] $10000+ Spenders');
    const lists = [...pick(OWN, Math.floor(rnd() * 13)), ...pick(FB, Math.floor(rnd() * 5)), ...steps].sort(() => rnd() - 0.5);
    const staff = rnd() < 0.15;
    for (const width of [464, 374]) {
      it(`set ${String(run)} at ${String(width)} px`, () => {
        const b = block(tiers, lists, { width, ...(staff ? { staff: chip('VIPs') } : {}) });
        const set = filterSet(b, names(tiers, lists), 'Staff');
        const layout = shelvesLayout(set, width, measure, WORDS);
        const rows = layout.rows;
        const widthOf = (cells: readonly FanslyShelfCell[]): number => {
          // The same widths as the layout's own formula, read back through the cells.
          const cw = (c: FanslyShelfCell): number => {
            if (c.type === 'more') return 24;
            if (c.type === 'label') return measure(c.text ?? '', 'label') + 6;
            const item = set.items.get(c.key);
            const icon = item?.kind === 'tier' ? 12 : item?.emoji !== null && item?.emoji !== undefined ? 15 : 0;
            return (c.inner ? 5 : 8) + (icon > 0 ? icon + (c.text !== null ? 3 : 0) : 0) + (c.text !== null ? Math.min(measure(c.text, 'label'), 120) : 0) + 23;
          };
          return cells.reduce((sum, c, index) => sum + cw(c) + (index === 0 ? 0 : cells[index - 1]?.type === 'label' ? 0 : cells[index - 1]?.joint === true ? 1 : 5), 0);
        };
        for (const row of rows) expect(widthOf(row.cells)).toBeLessThanOrEqual(width + 0.01);
        expect(rows.length).toBeLessThanOrEqual(5);
        expect(rows[0]?.cells.slice(0, 2).map((c) => c.key)).toEqual(['all', 'subscribers']);
        const second = rows.find((row) => row.shelf === 2);
        expect(second?.cells.slice(0, 2).map((c) => c.key)).toEqual(['vips', 'followers']);
        const all = rows.flatMap((row) => row.cells);
        expect(all.filter((c) => c.type === 'more')).toHaveLength(1);
        expect(all.at(-1)?.type).toBe('more');
        const shelves = rows.map((row) => row.shelf);
        expect([...shelves].sort()).toEqual(shelves);
        expect(shelves.filter((s) => s === 1)).toHaveLength(1);
        expect(shelves.filter((s) => s === 2).length).toBeLessThanOrEqual(2);
        expect(shelves.filter((s) => s === 3).length).toBeLessThanOrEqual(2);
        // Every filter is a cell or in exactly one «ещё N».
        for (const key of set.items.keys()) {
          const shown = all.filter((c) => c.type === 'chip' && c.key === key).length;
          const hidden = all.filter((c) => c.type === 'overflow' && c.hidden.includes(key)).length;
          expect(shown + hidden).toBe(1);
        }
        // Steps ascending.
        const stepKeys = all.filter((c) => c.type === 'chip' && set.items.get(c.key)?.kind === 'step').map((c) => set.items.get(c.key)?.step?.lo ?? 0);
        expect([...stepKeys].sort((x, y) => x - y)).toEqual(stepKeys);
        // A count or the active filter moves nothing.
        const busy = filterSet({ ...b, all: chip('All', { count: '99+' }), followers: chip('Followers', { active: true, count: '7' }), lists: b.lists.map((c) => ({ ...c, count: '12' })) }, names(tiers, lists), 'Staff');
        expect(busy.signature).toBe(set.signature);
        expect(shelvesLayout(busy, width, measure, WORDS)).toEqual(layout);
      });
    }
  }
});

describe('«Четыре группы»: the numbers', () => {
  const lists = ['[FB] $250-$500 Spenders', '⏳ Кастом', '🟡 Потенциал'];
  const n = names([], lists);
  const [step, custom, potential] = (n.lists ?? []).map((list) => list.id);
  // Mateo is in the step and in «Потенциал»: one chat, counted once in the union.
  const unread = {
    all: 11,
    fresh: 1,
    rows: [
      { unread: 2, subscriber: false, tierId: null, lists: [step as string, potential as string] },
      { unread: 2, subscriber: false, tierId: null, lists: [custom as string] },
      { unread: 6, subscriber: false, tierId: null, lists: [potential as string] },
      { unread: 1, subscriber: true, tierId: '700000000000000400', lists: [] },
    ],
  };
  const badges = block([], lists, { all: chip('All', { active: true, count: '11' }), subscribers: chip('Subscribers', { count: '1' }), lists: [chip(fanslyCut(lists[0] as string), { count: '2' }), chip('⏳ Кастом', { count: '2' }), chip('🟡 Потенциал', { count: '8' })] });
  const words = { allLists: 'Все списки', noneUnread: 'непрочитанного нет', perList: 'в каждом списке своё число', unionLine: (c: string) => `всего ${c}`, more: (k: number) => `ещё ${String(k)}` };

  it('counts each chat once in the union, and the rest outside the remembered list', () => {
    const set = filterSet(badges, n, 'Staff');
    const counts = groupCounts(unread);
    expect(countsAgree(set, set.items, counts, true)).toEqual({ agree: true, saturated: false });
    const plain = groupsNumbers(set, set.items, { tier: null, list: null }, counts, words, false);
    expect(plain.union).toBe('10');
    expect(plain.summary).toEqual(['Потенциал 8 · $250-500 2 · Кастом 2', 'всего 10']);
    const remembered = groupsNumbers(set, set.items, { tier: null, list: potential as string }, counts, words, false);
    expect(remembered.list?.label).toBe('Потенциал');
    expect(remembered.listRest).toBe('2');
    expect(remembered.union).toBeNull();
  });

  it('turns the numbers into dots when ours do not agree with Fansly’s badges or a list has no id', () => {
    const set = filterSet({ ...badges, lists: badges.lists.map((c, index) => (index === 2 ? { ...c, count: '9' } : c)) }, n, 'Staff');
    expect(countsAgree(set, set.items, groupCounts(unread), true).agree).toBe(false);
    const numbers = groupsNumbers(set, set.items, { tier: null, list: null }, null, words, false);
    expect(numbers.union).toBeNull();
    expect(numbers.dot).toBe(true);
    expect(numbers.summary[1]).toBe('в каждом списке своё число');
    const unnamed = filterSet(badges, { tiers: null, lists: null }, 'Staff');
    expect(countsAgree(unnamed, unnamed.items, groupCounts(unread), true).agree).toBe(false);
  });

  it('counts All over every unread chat, loaded or not: MAIN’s `all`, not the sum of the rows', () => {
    const set = filterSet(badges, n, 'Staff');
    // Two more unread in chats the page has not loaded: Fansly's All counts them, the lists cannot.
    const counts = groupCounts({ ...unread, all: 13 });
    expect(countsAgree(set, set.items, counts, true).agree).toBe(false);
    const agreed = filterSet({ ...badges, all: chip('All', { active: true, count: '13' }) }, n, 'Staff');
    expect(countsAgree(agreed, agreed.items, counts, true).agree).toBe(true);
  });

  it('takes 99+ as any number above 99 (saturated), and leaves Subscribers out while Fansly’s badge counts a tier', () => {
    const many = { all: 150, fresh: 1, rows: [{ unread: 150, subscriber: true, tierId: '700000000000000400', lists: [] }] };
    const tiers = ['⋆˙⟡ my friend ⋆˙⟡'];
    const set = filterSet(
      block(tiers, [], { all: chip('All', { count: '99+' }), subscribers: chip('Subscribers', { count: '99+' }), tiers: [{ ...chip(fanslyCut(tiers[0] as string), { active: true, count: '99+' }), color: null }] }),
      names(tiers, []),
      'Staff',
    );
    expect(countsAgree(set, set.items, groupCounts(many), false)).toEqual({ agree: true, saturated: true });
    // A tier on since Subscribers was: Fansly's Subscribers badge is that tier's, ours is all subscribers.
    const stale = filterSet(block(tiers, [], { all: chip('All', { active: true, count: '5' }), subscribers: chip('Subscribers', { count: '2' }) }), names(tiers, []), 'Staff');
    const five = groupCounts({ all: 5, fresh: 1, rows: [{ unread: 2, subscriber: true, tierId: '700000000000000400', lists: [] }, { unread: 3, subscriber: true, tierId: '700000000000000401', lists: [] }] });
    expect(countsAgree(stale, stale.items, five, true).agree).toBe(false);
    expect(countsAgree(stale, stale.items, five, false).agree).toBe(true);
    expect(groupsNumbers(stale, stale.items, { tier: null, list: null }, five, words, true).subscribers).toBe('5');
    expect(groupsNumbers(stale, stale.items, { tier: null, list: null }, null, words, true).subscribers).toBeNull();
  });
});
