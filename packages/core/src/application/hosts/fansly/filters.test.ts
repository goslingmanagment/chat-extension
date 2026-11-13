// The controller of the filters above Fansly's chats (./filters.ts): when «Четыре группы» may show its own numbers —
// a mismatch keeps the last agreed ones for one second look, then dots; back from dots only on an agreement no `99+`
// decided or after a fresh full read; a switch to it mid-visit starts on dots — a change of the strip that a late read
// of the setting must not undo, and full names of lists two chips print alike only from names newer than the chips.

import { describe, expect, it } from 'vitest';

import type { FanslyPagePort } from '@cg/contracts/fansly';
import type { FanslyFilterBlock, FanslyFilterChip, FanslyFilterMemo, FanslyFilterNames, FanslyFilterUnread } from '@cg/contracts/fansly-filters';
import type { FanslyFilterStrip } from '@cg/contracts/settings-ext';

import { FILTERS_TEXTS } from '../../../domain/hosts/fansly/i18n/filters';
import { RECHECK_MS, createFanslyFilters } from './filters';

const chip = (label: string, count: string | null, active = false): FanslyFilterChip => ({ label, active, count });
const LIST = '830000000000000101';

function rig(strip: FanslyFilterStrip = 'groups') {
  let block: FanslyFilterBlock = {
    all: chip('All', '12', true),
    subscribers: chip('Subscribers', null),
    staff: null,
    vips: chip('VIPs', null),
    followers: chip('Followers', null),
    tiers: [],
    lists: [chip('🟡 Потенциал', '12')],
    spinning: false,
    width: 464,
  };
  let unread: FanslyFilterUnread | null = { all: 12, fresh: 1, rows: [{ unread: 12, subscriber: false, tierId: null, lists: [LIST] }] };
  let names: FanslyFilterNames = { tiers: [], lists: [{ id: LIST, label: '🟡 Потенциал' }] };
  let change: () => void = () => undefined;
  const timers: Array<{ readonly at: number; readonly run: () => void } | null> = [];
  const reads: Array<(answer: { strip: FanslyFilterStrip; memo: FanslyFilterMemo }) => void> = [];
  const page: FanslyPagePort['filters'] = {
    read: () => ({ ok: true, block }),
    names: () => names,
    unread: () => unread,
    hide: () => undefined,
    wantUnread: () => undefined,
    onChange(listener) {
      change = listener;
      return () => undefined;
    },
    select: () => true,
    unpin: () => true,
    pin: () => true,
    refresh: () => true,
  };
  const controller = createFanslyFilters({
    page,
    creator: () => '700000000000000017',
    read: () => new Promise((resolve) => reads.push(resolve)),
    remember: () => Promise.resolve(null),
    copy: () => FILTERS_TEXTS.ru,
    timers: {
      set: (run, ms) => timers.push({ at: ms, run }) - 1,
      clear: (handle) => {
        timers[handle as number] = null;
      },
    },
  });
  const settle = async (answer: FanslyFilterStrip = strip): Promise<void> => {
    reads.shift()?.({ strip: answer, memo: { tier: null, list: null } });
    await Promise.resolve();
    await Promise.resolve();
  };
  return {
    controller,
    settle,
    reads,
    set(next: Partial<FanslyFilterBlock>, facts?: FanslyFilterUnread | null) {
      block = { ...block, ...next };
      if (facts !== undefined) unread = facts;
      change();
    },
    /** MAIN's names said anew (a new object, as every `fx.filters` brings). */
    name(next: FanslyFilterNames) {
      names = next;
      change();
    },
    /** The pending second look, run as its timer would. */
    tick() {
      const due = timers.findLast((timer) => timer !== null);
      expect(due?.at).toBe(RECHECK_MS);
      timers.splice(0);
      due?.run();
    },
    pending: () => timers.some((timer) => timer !== null),
    union: () => controller.view().groups?.union ?? null,
    dots: () => controller.view().groups?.fallback ?? null,
  };
}

describe('«Четыре группы»: when its numbers are shown', () => {
  it('a mismatch keeps the last agreed numbers for one second look, then dots', async () => {
    const r = rig();
    await r.settle();
    expect(r.union()).toBe('12');
    // Fansly's «Mark as read» of every chat: its badges go, MAIN's copy does not hear of it.
    r.set({ all: chip('All', null, true), lists: [chip('🟡 Потенциал', null)] });
    expect(r.union()).toBe('12');
    expect(r.pending()).toBe(true);
    r.tick();
    expect(r.dots()).toBe(true);
    expect(r.union()).toBeNull();
  });

  it('comes back from dots only on an agreement no 99+ decided, or after a fresh full read', async () => {
    const r = rig();
    await r.settle();
    r.set({ all: chip('All', '7', true) });
    r.tick();
    expect(r.dots()).toBe(true);
    // 99+ on both sides: equal by its letter only.
    r.set({ all: chip('All', '99+', true), lists: [chip('🟡 Потенциал', '99+')] }, { all: 150, fresh: 1, rows: [{ unread: 150, subscriber: false, tierId: null, lists: [LIST] }] });
    expect(r.dots()).toBe(true);
    // The same after the page read its unread anew: trusted again.
    r.set({}, { all: 150, fresh: 2, rows: [{ unread: 150, subscriber: false, tierId: null, lists: [LIST] }] });
    expect(r.dots()).toBe(false);
    expect(r.union()).toBe('99+');
  });

  it('an agreement in plain numbers ends the dots at once', async () => {
    const r = rig();
    await r.settle();
    r.set({ all: chip('All', '7', true) });
    r.tick();
    r.set({ all: chip('All', '12', true) });
    expect(r.dots()).toBe(false);
  });
});

describe('«Четыре группы» after another strip in the same tab', () => {
  const saturated = (fresh: number): FanslyFilterUnread => ({ all: 150, fresh, rows: [{ unread: 150, subscriber: false, tierId: null, lists: [LIST] }] });
  const busy = { all: chip('All', '99+', true), lists: [chip('🟡 Потенциал', '99+')] };

  it('starts on dots: the copy kept meanwhile proves nothing by 99+, only a full read after the switch does', async () => {
    const r = rig('shelves');
    await r.settle();
    // Under «Две полки» nothing checks the copy (a «Mark as read» of every chat goes unseen); every badge is 99+.
    r.set(busy, saturated(1));
    r.controller.stripChanged('groups');
    expect(r.controller.view().mode).toBe('groups');
    expect(r.dots()).toBe(true);
    r.set({}, saturated(1));
    expect(r.dots()).toBe(true);
    r.set({}, saturated(2));
    expect(r.dots()).toBe(false);
    expect(r.union()).toBe('99+');
  });

  it('an agreement in plain numbers is enough; leaving drops the numbers, so coming back never shows the old ones', async () => {
    const r = rig('shelves');
    await r.settle();
    r.controller.stripChanged('groups');
    expect(r.union()).toBe('12');
    r.set(busy, saturated(3));
    expect(r.union()).toBe('99+');
    r.controller.stripChanged('shelves');
    r.controller.stripChanged('groups');
    expect(r.dots()).toBe(true);
  });

  it('the tab’s first «Четыре группы» trusts an agreement as before', async () => {
    const r = rig();
    r.set(busy, saturated(1));
    await r.settle();
    expect(r.union()).toBe('99+');
  });
});

describe('full names of lists two chips print alike', () => {
  const A = { id: '830000000000000201', label: 'Clients from Germany A' };
  const B = { id: '830000000000000202', label: 'Clients from Germany B' };
  const cut = chip('Clients from Germany...', null);

  it('come by order only while no chip went since the names: a list unpinned and pinned again is named by Fansly’s label', async () => {
    const r = rig('shelves');
    // The names first, Fansly's chips drawn after: chips coming do not move the order the names have.
    r.set({ lists: [] });
    r.name({ tiers: [], lists: [A, B] });
    r.set({ lists: [cut, cut] });
    await r.settle();
    const full = () => r.controller.view().set?.lists.map((item) => [item.full, item.id]);
    expect(full()).toEqual([
      [A.label, A.id],
      [B.label, B.id],
    ]);
    // Another list pinned: Fansly adds it at the end, the order of the others stands.
    const other = chip('🟡 Потенциал', null);
    r.set({ lists: [cut, cut, other] });
    expect(full()).toEqual([
      [A.label, A.id],
      [B.label, B.id],
      [other.label, null],
    ]);
    // A unpinned and pinned again before the writes answer: Fansly has B, other, A; the names still say A, B.
    r.set({ lists: [cut, other] });
    r.set({ lists: [cut, other, cut] });
    expect(full()).toEqual([
      [cut.label, null],
      [other.label, null],
      [cut.label, null],
    ]);
    // The same names said again prove nothing; new ones do.
    r.name({ tiers: [], lists: [A, B] });
    expect(full()?.[0]?.[1]).toBeNull();
    const P = { id: LIST, label: '🟡 Потенциал' };
    r.name({ tiers: [], lists: [B, P, A] });
    expect(full()).toEqual([
      [B.label, B.id],
      [P.label, P.id],
      [A.label, A.id],
    ]);
  });
});

describe('the strip chosen', () => {
  it('a change heard while a read is on its way wins over that read', async () => {
    const r = rig();
    r.controller.stripChanged('native');
    await r.settle('groups');
    expect(r.controller.view().mode).toBeNull();
    r.controller.reread();
    await r.settle('groups');
    expect(r.controller.view().mode).toBe('groups');
  });
});
