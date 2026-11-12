// The filters' facts in MAIN (./filters.ts) and the emitter they go through (./emitter.ts): the state's byte budget in
// UTF-8 (the unread, then the names, not said past it), All over every unread chat (loaded or not) with Fansly's own
// tests, read marks only for messages the page holds, the throttle, and one state no batch could carry never stopping
// the stream.

import { describe, expect, it } from 'vitest';

import { createEmitter, utf8Bytes } from './emitter';
import { FILTERS_EVERY_MS, FILTERS_MAX_BYTES, createFilterFacts } from './filters';
import { MAX_BATCH_BYTES } from './protocol';

const CREATOR = '700000000000000017';
const id = (n: number): string => String(810_000_000_000_000_000n + BigInt(n));
const fan = (n: number): string => String(920_000_000_000_000_000n + BigInt(n));
const msg = (n: number): string => String(860_000_000_000_000_000n + BigInt(n));
const list = (n: number): string => String(830_000_000_000_000_100n + BigInt(n));

function facts() {
  const wakes: number[] = [];
  const f = createFilterFacts(JSON.stringify, (ms) => wakes.push(ms));
  f.me({ id: CREATOR, subscriptionTiers: [] });
  return { f, wakes };
}

const settings = (labels: readonly string[]) => [{ categoryId: '4000', keyId: '100', value: 1, metadata: JSON.stringify({ pinnedLists: labels.map((label, n) => ({ id: list(n), label })) }) }];
const unreadPage = (items: ReadonlyArray<{ readonly group: number; readonly message: number; readonly valid?: boolean }>) => ({
  messageInteractions: items.map((item) => ({ groupId: id(item.group), messageId: msg(item.message), deletedAt: null, validMessage: item.valid !== false })),
});

describe('the filters’ facts in MAIN', () => {
  it('counts All over every unread chat, loaded or not, with Fansly’s own tests; the rows only for loaded fans of a filter', () => {
    const { f } = facts();
    f.want(true);
    f.settings(settings(['🟡 Потенциал']), JSON.parse);
    f.loaded(id(1), fan(1));
    f.account({ id: fan(1), subscriber: false, containingLists: [list(0), '830000000000999999'] });
    // Chat 2 is not loaded (beyond the list's first page); one entry of chat 1 is not a valid message.
    f.unread(unreadPage([{ group: 1, message: 1 }, { group: 1, message: 2 }, { group: 2, message: 3 }, { group: 1, message: 4, valid: false }]), true);
    const taken = f.take(10_000, false);
    const unread = taken?.payload['unread'] as { all: number; ids: string[]; rows: number[][] };
    expect(unread.all).toBe(3);
    // Only the pinned list is named: the fan's other list is not the strip's. A row: unread, subscriber, tier, lists.
    expect(unread.ids).toEqual([list(0)]);
    expect(unread.rows).toEqual([[2, 0, -1, 0]]);
  });

  it('applies a read mark, a deletion and «unread again» only to a message the page holds', () => {
    const { f } = facts();
    f.want(true);
    f.settings(settings([]), JSON.parse);
    f.unread(unreadPage([{ group: 1, message: 1 }, { group: 1, message: 2 }]), true);
    // Another session read both: the page holds only message 2 (it opened nothing else).
    f.held(id(1), msg(2));
    f.read(CREATOR, [msg(1), msg(2)], 2, CREATOR);
    const all = (): number => ((f.take(Number.MAX_SAFE_INTEGER / 2 + Math.random(), true)?.payload['unread'] as { all: number }).all);
    expect(all()).toBe(1);
    f.read(CREATOR, [msg(2)], 4, CREATOR);
    expect(all()).toBe(2);
    f.deleted(msg(1));
    expect(all()).toBe(2);
    f.deleted(msg(2));
    expect(all()).toBe(1);
  });

  it('keeps the state within its UTF-8 budget: the unread first, then the names, are not said past it', () => {
    const { f } = facts();
    f.want(true);
    // Two hundred pinned lists of long Cyrillic and emoji names: two to four bytes a character.
    const labels = Array.from({ length: 200 }, (_, n) => `🟡 Потенциальные клиенты номер ${String(n)} из Германии и Австрии`);
    f.settings(settings(labels), JSON.parse);
    const names = f.take(10_000, false);
    expect(names?.bytes).toBeLessThanOrEqual(FILTERS_MAX_BYTES);
    expect(names?.payload['lists']).toBeNull();
    expect(names?.bytes).toBe(utf8Bytes(JSON.stringify(names?.payload)));

    const { f: g } = facts();
    g.want(true);
    g.settings(settings(Array.from({ length: 40 }, (_, n) => `Список ${String(n)}`)), JSON.parse);
    // Six hundred loaded chats, each fan in all forty pinned lists: the unread alone is far past the budget (600 × 40 indexes).
    for (let n = 0; n < 600; n += 1) {
      g.loaded(id(n), fan(n));
      g.account({ id: fan(n), subscriber: true, containingLists: Array.from({ length: 40 }, (_, k) => list(k)) });
    }
    g.unread(unreadPage(Array.from({ length: 600 }, (_, n) => ({ group: n, message: n }))), true);
    const big = g.take(10_000, false);
    expect(big?.bytes).toBeLessThanOrEqual(FILTERS_MAX_BYTES);
    expect(big?.payload['unread']).toBeNull();
    expect((big?.payload['lists'] as unknown[]).length).toBe(40);
  });

  it('builds the state at most every FILTERS_EVERY_MS, and the unread only while a strip wants it', () => {
    const { f, wakes } = facts();
    f.settings(settings([]), JSON.parse);
    f.unread(unreadPage([{ group: 1, message: 1 }]), true);
    expect(f.take(1_000, false)?.payload['unread']).toBeNull();
    f.want(true);
    expect(f.take(1_100, false)).toBeNull();
    expect(wakes).toEqual([FILTERS_EVERY_MS - 100]);
    expect((f.take(1_000 + FILTERS_EVERY_MS, false)?.payload['unread'] as { all: number }).all).toBe(1);
  });

  it('forgets every chat and fan of another creator', () => {
    const { f } = facts();
    f.want(true);
    f.settings(settings(['A']), JSON.parse);
    f.loaded(id(1), fan(1));
    f.account({ id: fan(1), subscriber: true, containingLists: [list(0)] });
    f.unread(unreadPage([{ group: 1, message: 1 }]), true);
    f.me({ id: '700000000000000099', subscriptionTiers: [] });
    expect(f.take(10_000, false)?.payload).toEqual({ tiers: [], lists: null, unread: null });
  });
});

describe('the emitter', () => {
  it('measures in UTF-8, as the isolated side does', () => {
    expect(utf8Bytes('abc')).toBe(3);
    expect(utf8Bytes('Пот')).toBe(6);
    expect(utf8Bytes('🟡')).toBe(4);
    expect(utf8Bytes('⟡')).toBe(3);
  });

  it('drops a state no batch could carry, says it, and the stream goes on', () => {
    const posted: Array<{ t: string; payload: Record<string, unknown> }> = [];
    const dropped: string[] = [];
    const emitter = createEmitter((t, payload) => posted.push({ t, payload }), JSON.stringify, undefined, (t) => dropped.push(t));
    emitter.start();
    emitter.state('fx.filters', { blob: 'Ж'.repeat(MAX_BATCH_BYTES / 2) });
    emitter.event('fx.incoming', { groupId: id(1) });
    emitter.flush();
    expect(dropped).toEqual(['fx.filters']);
    expect(posted).toHaveLength(1);
    const events = (posted[0]?.payload['events'] as Array<{ t: string }>).map((event) => event.t);
    expect(events).toEqual(['fx.incoming']);
  });
});
