// The rules of temporary chat pins (./pins.ts): six hours of quiet, a touch before the prune at the boundary, a late
// touch never bringing a pin back, the limit's eviction, one pin per chat, the stored value of another owner, the budget's
// last resort, a name cut to the schema, and the strip's chips that never move under the pointer.

import { describe, expect, it } from 'vitest';

import { FANSLY_PIN_LIMITS, FanslyPinTargetSchema, type FanslyPin, type FanslyPinTarget } from '@cg/contracts/fansly-pins';

import { applyPinOp, cutPinName, layPinChips, pinChipClosed, pinChipEntered, pinStoreOf, pinTargetOf, readPinStore, touchChat, type ShownPin } from './pins';

const HOUR = 60 * 60 * 1000;
const QUIET = FANSLY_PIN_LIMITS.quietMs;
const T0 = Date.UTC(2026, 10, 12, 12, 0, 0);
const target = (n: number): FanslyPinTarget => ({ groupId: `90000000000000000${n}`, fanId: `80000000000000000${n}`, name: `Fan ${n}` });
const groups = (pins: readonly FanslyPin[]): string[] => pins.map((pin) => pin.groupId);

describe('temporary pins', () => {
  it('a pin goes after six hours without activity; activity extends it', () => {
    let pins = applyPinOp([], { op: 'pin', pin: target(1) }, T0);
    expect(applyPinOp(pins, { op: 'touch', groupId: target(1).groupId, at: T0 + QUIET - 1 }, T0 + QUIET - 1)).toHaveLength(1);
    expect(applyPinOp(pins, { op: 'unpin', groupId: target(2).groupId }, T0 + QUIET)).toEqual([]);
    pins = applyPinOp(pins, { op: 'touch', groupId: target(1).groupId, at: T0 + 5 * HOUR }, T0 + 5 * HOUR);
    expect(pins[0]?.touchedAt).toBe(T0 + 5 * HOUR);
    expect(applyPinOp(pins, { op: 'touch', groupId: target(9).groupId, at: T0 + 10 * HOUR }, T0 + 10 * HOUR)).toHaveLength(1);
    expect(applyPinOp(pins, { op: 'touch', groupId: target(9).groupId, at: T0 + 11 * HOUR }, T0 + 11 * HOUR)).toEqual([]);
  });

  it('a touch heard just after the boundary, made just before it, keeps the pin: the touch comes before the prune', () => {
    const pins = applyPinOp([], { op: 'pin', pin: target(1) }, T0);
    const made = T0 + QUIET - 1000;
    const heard = T0 + QUIET + 1000;
    expect(groups(applyPinOp(pins, { op: 'touch', groupId: target(1).groupId, at: made }, heard))).toEqual([target(1).groupId]);
    // A touch never moves time back, and never past now.
    const ahead = applyPinOp(pins, { op: 'touch', groupId: target(1).groupId, at: T0 + 99 * HOUR }, T0 + HOUR);
    expect(ahead[0]?.touchedAt).toBe(T0 + HOUR);
    expect(applyPinOp(ahead, { op: 'touch', groupId: target(1).groupId, at: T0 }, T0 + HOUR)[0]?.touchedAt).toBe(T0 + HOUR);
  });

  it('a late touch never brings back a pin that was taken off', () => {
    let pins = applyPinOp([], { op: 'pin', pin: target(1) }, T0);
    pins = applyPinOp(pins, { op: 'unpin', groupId: target(1).groupId }, T0 + 1000);
    expect(applyPinOp(pins, { op: 'touch', groupId: target(1).groupId, at: T0 + 500 }, T0 + 2000)).toEqual([]);
  });

  it('a seventh pin takes off the quietest of the others, and the order of the rest stays', () => {
    let pins: readonly FanslyPin[] = [];
    for (let n = 1; n <= FANSLY_PIN_LIMITS.max; n += 1) pins = applyPinOp(pins, { op: 'pin', pin: target(n) }, T0 + n * 1000);
    // Chat 1 spoke last of all: chat 2 is now the quietest.
    pins = applyPinOp(pins, { op: 'touch', groupId: target(1).groupId, at: T0 + 60_000 }, T0 + 60_000);
    pins = applyPinOp(pins, { op: 'pin', pin: target(7) }, T0 + 70_000);
    expect(groups(pins)).toEqual([1, 3, 4, 5, 6, 7].map((n) => target(n).groupId));
  });

  it('pinning a pinned chat keeps its place and moment, and takes its new name', () => {
    let pins = applyPinOp([], { op: 'pin', pin: target(1) }, T0);
    pins = applyPinOp(pins, { op: 'pin', pin: target(2) }, T0 + 1000);
    pins = applyPinOp(pins, { op: 'pin', pin: { ...target(1), name: 'Renamed', username: 'renamed' } }, T0 + 2000);
    expect(groups(pins)).toEqual([target(1).groupId, target(2).groupId]);
    expect(pins[0]).toMatchObject({ name: 'Renamed', username: 'renamed', pinnedAt: T0, touchedAt: T0 + 2000 });
  });

  it('the stored pins are one person’s: another owner reads none, and writes start empty', () => {
    const creator = '700000000000000017';
    const pins = applyPinOp([], { op: 'pin', pin: target(1) }, T0);
    const stored = pinStoreOf('https://hub.example|7', { [creator]: pins }, T0, creator, 8 * 1024);
    expect(readPinStore(stored, 'https://hub.example|7').accounts[creator]).toEqual(pins);
    expect(readPinStore(stored, 'https://hub.example|8')).toEqual({ accounts: {}, foreign: true });
    expect(readPinStore(stored, 'https://other.example|7')).toEqual({ accounts: {}, foreign: true });
    expect(readPinStore(undefined, 'https://hub.example|7')).toEqual({ accounts: {}, foreign: false });
    // An expired creator's list goes with the next write.
    expect(pinStoreOf('https://hub.example|7', { [creator]: pins }, T0 + QUIET, 'another', 8 * 1024).accounts).toEqual({});
  });
});

describe('temporary pins: the edges', () => {
  it('a touch never brings back a pin quiet for six hours that no read pruned yet', () => {
    const pins = applyPinOp([], { op: 'pin', pin: target(1) }, T0);
    expect(touchChat(pins, target(1).groupId, T0 + QUIET)).toBe(pins);
    expect(touchChat(pins, target(1).groupId, T0 + QUIET - 1)[0]?.touchedAt).toBe(T0 + QUIET - 1);
  });

  it('a name is cut to the schema’s 64 UTF-16 units, never through a surrogate pair', () => {
    const meta = { groupId: target(1).groupId, fanId: target(1).fanId, kind: 'direct' as const, customName: '💋'.repeat(40), displayName: null, username: null };
    const pinned = pinTargetOf(meta, 'Чат');
    expect(pinned.name.length).toBeLessThanOrEqual(FANSLY_PIN_LIMITS.nameMaxChars);
    expect(pinned.name.endsWith('💋…')).toBe(true);
    expect(FanslyPinTargetSchema.safeParse(pinned).success).toBe(true);
    expect(cutPinName('a'.repeat(62) + '💋x', 64)).toBe(`${'a'.repeat(62)}…`);
  });

  it('past the budget the quietest other creator goes, never the one just written', () => {
    const creators = Array.from({ length: 60 }, (_, n) => `70000000000000${String(1000 + n)}`);
    const accounts: Record<string, readonly FanslyPin[]> = {};
    creators.forEach((creator, n) => {
      let pins: readonly FanslyPin[] = [];
      for (let k = 1; k <= FANSLY_PIN_LIMITS.max; k += 1) pins = applyPinOp(pins, { op: 'pin', pin: { ...target(k), name: 'Ф'.repeat(64) } }, T0 + n * 1000 + k);
      accounts[creator] = pins;
    });
    const keep = creators[0] as string;
    const store = pinStoreOf('https://hub.example|7', accounts, T0 + HOUR, keep, 64 * 1024);
    const kept = Object.keys(store.accounts);
    expect(kept).toContain(keep);
    expect(kept.length).toBeLessThan(creators.length);
    // Those that went are the quietest: every creator kept other than `keep` spoke later than every one dropped.
    const dropped = creators.filter((creator) => !kept.includes(creator));
    const lastSpoke = (creator: string): number => Math.max(...(accounts[creator] ?? []).map((pin) => pin.touchedAt));
    expect(Math.min(...kept.filter((creator) => creator !== keep).map(lastSpoke))).toBeGreaterThan(Math.max(...dropped.map(lastSpoke)));
    // Forty creators with six long names fit whole.
    expect(Object.keys(pinStoreOf('https://hub.example|7', Object.fromEntries(creators.slice(0, 40).map((creator) => [creator, accounts[creator] ?? []])), T0 + HOUR, keep, 64 * 1024).accounts)).toHaveLength(40);
  });
});

describe('the strip’s chips', () => {
  const pin = (n: number): FanslyPin => ({ ...target(n), pinnedAt: T0 + n, touchedAt: T0 + n });
  const states = (shown: readonly ShownPin[]): string[] => shown.map((entry) => `${entry.pin.groupId.slice(-1)}:${entry.state}`);

  it('held by the strip: a chip taken off is a placeholder of its place, a new one waits, names stay; then it closes and goes', () => {
    let shown = layPinChips([], [pin(1), pin(2), pin(3)], 'none', false).shown;
    expect(states(shown)).toEqual(['1:shown', '2:shown', '3:shown']);
    const renamed = { ...pin(2), name: 'Other' };
    const frozen = layPinChips(shown, [renamed, pin(3), pin(4)], 'strip', true);
    expect(states(frozen.shown)).toEqual(['1:tombstone', '2:shown', '3:shown']);
    expect(frozen.shown[1]?.pin.name).toBe('Fan 2');
    expect(frozen.closing).toEqual([]);
    const free = layPinChips(frozen.shown, [renamed, pin(3), pin(4)], 'none', true);
    expect(states(free.shown)).toEqual(['1:closing', '2:shown', '3:shown', '4:in']);
    expect(free.closing).toEqual([pin(1).groupId]);
    expect(free.entering).toEqual([pin(4).groupId]);
    expect(free.shown[1]?.pin.name).toBe('Other');
    shown = pinChipEntered(pinChipClosed(free.shown, pin(1).groupId), pin(4).groupId);
    expect(states(shown)).toEqual(['2:shown', '3:shown', '4:shown']);
  });

  it('the pointer over the list: a new chip comes at once and last; one taken off keeps its place and takes it back when pinned again, for good', () => {
    const start = layPinChips([], [pin(1), pin(2), pin(3)], 'none', false).shown;
    // A fourth chat pinned by its row's button: its chip grows in at once, the others keep their names (their widths).
    const renamed = { ...pin(2), name: 'Other' };
    const added = layPinChips(start, [pin(1), renamed, pin(3), pin(4)], 'list', true);
    expect(states(added.shown)).toEqual(['1:shown', '2:shown', '3:shown', '4:in']);
    expect(added.entering).toEqual([pin(4).groupId]);
    expect(added.shown[1]?.pin.name).toBe('Fan 2');
    // The second taken off by its row's button: a placeholder. Pinned again there (now the newest pin): back in its place.
    const off = layPinChips(pinChipEntered(added.shown, pin(4).groupId), [pin(1), pin(3), pin(4)], 'list', true);
    expect(states(off.shown)).toEqual(['1:shown', '2:tombstone', '3:shown', '4:shown']);
    expect(off.closing).toEqual([]);
    const again = [pin(1), pin(3), pin(4), { ...pin(2), pinnedAt: T0 + 9, touchedAt: T0 + 9 }];
    const back = layPinChips(off.shown, again, 'list', true);
    expect(states(back.shown)).toEqual(['1:shown', '2:shown', '3:shown', '4:shown']);
    expect(back.entering).toEqual([]);
    // The pointer left the list: no chip changes its place.
    expect(states(layPinChips(back.shown, again, 'none', true).shown)).toEqual(['1:shown', '2:shown', '3:shown', '4:shown']);
    // The first pin from a row: the strip does not stand yet, its chip is simply there to come with it.
    expect(layPinChips([], [pin(1)], 'list', false)).toEqual({ shown: [{ pin: pin(1), state: 'shown' }], closing: [], entering: [] });
  });

  it('a chip pinned again while its place closes takes it back; a strip that does not stand gets no entering chips', () => {
    const closing = layPinChips(layPinChips([], [pin(1), pin(2)], 'none', false).shown, [pin(2)], 'none', true);
    expect(states(closing.shown)).toEqual(['1:closing', '2:shown']);
    // Pinned again, it is the newest pin: it still takes its own place back.
    const back = layPinChips(closing.shown, [pin(2), { ...pin(1), pinnedAt: T0 + 9, touchedAt: T0 + 9 }], 'none', true);
    expect(states(back.shown)).toEqual(['1:shown', '2:shown']);
    expect(states(pinChipClosed(back.shown, pin(1).groupId))).toEqual(['1:shown', '2:shown']);
    expect(layPinChips([], [pin(1)], 'none', false).entering).toEqual([]);
  });
});
