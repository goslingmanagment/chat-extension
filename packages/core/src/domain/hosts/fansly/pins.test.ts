// The rules of temporary chat pins (./pins.ts): six hours of quiet, a touch before the prune at the boundary, a late
// touch never bringing a pin back, the limit's eviction, one pin per chat, and the stored value of another owner.

import { describe, expect, it } from 'vitest';

import { FANSLY_PIN_LIMITS, type FanslyPin, type FanslyPinTarget } from '@cg/contracts/fansly-pins';

import { applyPinOp, pinStoreOf, readPinStore } from './pins';

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
