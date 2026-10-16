// «Нельзя написать» on Fansly as a pure rule (R20 P10b2): Fansly's `verifyNew` as the old extension ported it
// (fansly-chat tests/fansly-dm-permissions.test.ts), and the window's reason — a paid DM or the fan's rules.

import { describe, expect, it } from 'vitest';

import { dmClosedOf, groupDmClosed, unmetDmRequirements } from './dm-permissions';

/** Fansly's metadata is a JSON object whose values are JSON strings. */
const meta = (byFlag: Record<number, unknown>): string => JSON.stringify(Object.fromEntries(Object.entries(byFlag).map(([flag, value]) => [flag, JSON.stringify(value)])));
const paid = (price: number): Record<string, unknown> => ({ flags: 1, metadata: meta({ 1: { price } }), verificationFlags: 0, verificationMetadata: '{}' });

describe('[host:fansly] «Нельзя написать»: the fan’s DM rules (R20 P10b2)', () => {
  it('[FX-003] [FS-NEW-2] an ordinary follower is open: the rule sets of the 2026-08 captures; no rule set is open; an answer without the rules says nothing', () => {
    // Every fan chat in the hub's HAR captures: «followed by them» met, «subscribed by them» not.
    const rules = [
      { flags: 16, metadata: '', verificationFlags: 16, verificationMetadata: '{}' },
      { flags: 64, metadata: '', verificationFlags: 0, verificationMetadata: '{}' },
    ];
    expect(unmetDmRequirements(rules, { flags: 16, metadata: '{}' })).toEqual([]);
    expect(unmetDmRequirements([], { flags: 0 })).toEqual([]);
    expect(unmetDmRequirements(undefined, undefined)).toBeNull();
    expect(dmClosedOf([])).toBeNull();
    expect(dmClosedOf(null)).toBeNull();
  });

  it('[FX-003] [FS-NEW-2] a paid DM is «only paid messages»; one this account already paid is open; an unreadable price stays closed', () => {
    const unmet = unmetDmRequirements([paid(1700)], { flags: 16, metadata: '{}' });
    expect(unmet).toEqual([{ flags: 1, price: 1700 }]);
    expect(dmClosedOf(unmet)).toBe('paid');
    expect(unmetDmRequirements([paid(1700)], { flags: 0, metadata: meta({ 1: { price: 1700 } }) })).toEqual([]);
    const unreadable = unmetDmRequirements([{ flags: 1, metadata: '{"1":"oops"}', verificationFlags: 0 }], null);
    expect(unreadable).toEqual([{ flags: 1, price: null }]);
    expect(dmClosedOf(unreadable)).toBe('paid');
    // Fansly: `0 >= null` lets a null price through; a missing price stays unmet.
    expect(unmetDmRequirements([{ flags: 1, metadata: meta({ 1: { price: null } }), verificationFlags: 0 }], null)).toEqual([]);
    expect(unmetDmRequirements([{ flags: 1, metadata: meta({ 1: {} }), verificationFlags: 0 }], null)).toEqual([{ flags: 1, price: null }]);
  });

  it('[FX-003] [FS-NEW-2] the paid-DM reason carries the lowest known per-message price; unknown prices, other conditions and already-paid DMs never invent one', () => {
    const group = (rules: unknown[], account: unknown = null) => groupDmClosed({ dmPermissionFlags: rules, accountDmPermissionFlags: account });
    const unknown = { flags: 1, metadata: '{"1":"oops"}', verificationFlags: 0 };
    const conditional = { flags: 1 | 2, metadata: meta({ 1: { price: 500 } }), verificationFlags: 0 };
    expect(group([paid(5000), unknown, conditional, paid(1700)])).toEqual({ read: true, closed: 'paid', priceMills: 1700 });
    expect(group([paid(405)])).toMatchObject({ closed: 'paid', priceMills: 405 });
    expect(group([unknown])).toMatchObject({ closed: 'paid', priceMills: null });
    expect(group([conditional])).toMatchObject({ closed: 'permissions', priceMills: null });
    expect(group([paid(1700)], { metadata: meta({ 1: { price: 1700 } }) })).toMatchObject({ closed: null, priceMills: null });
    expect(group([paid(1700), { flags: 16, verificationFlags: 16 }])).toMatchObject({ closed: null, priceMills: null });
  });

  it('[FX-003] open as soon as one rule set is met; tips and media purchases count against what was already sent', () => {
    expect(unmetDmRequirements([paid(1700), { flags: 16, verificationFlags: 16 }], null)).toEqual([]);
    const tips = { flags: 8, metadata: meta({ 8: { minAmount: 5000 } }), verificationFlags: 0 };
    expect(unmetDmRequirements([tips], { metadata: meta({ 8: { totalSent: 5000 } }) })).toEqual([]);
    expect(unmetDmRequirements([tips], { metadata: meta({ 8: { totalSent: 1000 } }) })).toEqual([{ flags: 8, price: 0 }]);
    const media = { flags: 32, metadata: meta({ 32: { minAmount: 2000 } }), verificationFlags: 0 };
    expect(unmetDmRequirements([media], { metadata: meta({ 32: { totalPurchased: 2000 } }) })).toEqual([]);
  });

  it('[FX-003] [FS-NEW-2] rules the creator does not meet are «the fan’s rules»; a paid way among them is still «only paid messages»', () => {
    const unmet = unmetDmRequirements([{ flags: 4, verificationFlags: 0 }, { flags: 2 | 16, verificationFlags: 16 }], null);
    expect(unmet).toEqual([
      { flags: 4, price: 0 },
      { flags: 2, price: 0 },
    ]);
    expect(dmClosedOf(unmet)).toBe('permissions');
    expect(dmClosedOf(unmetDmRequirements([{ flags: 2, verificationFlags: 0 }, paid(500)], null))).toBe('paid');
    // A price together with another condition is not a paid DM alone.
    expect(dmClosedOf(unmetDmRequirements([{ flags: 1 | 2, metadata: meta({ 1: { price: 500 } }), verificationFlags: 0 }], null))).toBe('permissions');
  });

  it('[FX-003] the group object as Fansly answers it: its rules and what the creator has; garbage reads as no rules', () => {
    // The stand's rule (fake-fansly data.ts): «follow the fan», not met.
    const closed = { id: '1', dmPermissionFlags: [{ id: 1, accountId: '2', type: 1, flags: 2, metadata: '{}', verificationFlags: 0, verificationMetadata: '{}' }], accountDmPermissionFlags: { flags: 0, metadata: '{}' } };
    expect(groupDmClosed(closed)).toEqual({ read: true, closed: 'permissions', priceMills: null });
    expect(groupDmClosed({ id: '1', dmPermissionFlags: [], accountDmPermissionFlags: { flags: 0, metadata: '{}' } })).toEqual({ read: true, closed: null, priceMills: null });
    expect(groupDmClosed({ id: '1' })).toEqual({ read: false, closed: null, priceMills: null });
    expect(groupDmClosed(null)).toEqual({ read: false, closed: null, priceMills: null });
    expect(groupDmClosed({ dmPermissionFlags: [null, 7, 'x'] })).toEqual({ read: true, closed: null, priceMills: null });
  });
});
