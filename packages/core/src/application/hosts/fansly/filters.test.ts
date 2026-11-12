// The controller of the filters above Fansly's chats (./filters.ts): when «Четыре группы» may show its own numbers —
// a mismatch keeps the last agreed ones for one second look, then dots; back from dots only on an agreement no `99+`
// decided or after a fresh full read — and a change of the strip that a late read of the setting must not undo.

import { describe, expect, it } from 'vitest';

import type { FanslyPagePort } from '@cg/contracts/fansly';
import type { FanslyFilterBlock, FanslyFilterChip, FanslyFilterMemo, FanslyFilterUnread } from '@cg/contracts/fansly-filters';
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
  let change: () => void = () => undefined;
  const timers: Array<{ readonly at: number; readonly run: () => void } | null> = [];
  const reads: Array<(answer: { strip: FanslyFilterStrip; memo: FanslyFilterMemo }) => void> = [];
  const page: FanslyPagePort['filters'] = {
    read: () => ({ ok: true, block }),
    names: () => ({ tiers: [], lists: [{ id: LIST, label: '🟡 Потенциал' }] }),
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
