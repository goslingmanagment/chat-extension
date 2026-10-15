import { afterEach, describe, expect, it, vi } from 'vitest';
import { admit } from './allowlist';
import type { FanslyAnswer, FanslyCall } from './client';
import { FanslyApiError } from './errors';
import { createSpendersLookup, NAMES_STORAGE_KEY, NAMES_TTL_MS, RESOLVE_BUDGET_MS } from './spenders';

const ACCOUNT = '700000000000000001';
const FAN = '700000000000000002';
const GROUP = '800000000000000003';
const group = (users = [ACCOUNT, FAN], type = 1) => ({ id: GROUP, type, users: users.map((userId) => ({ userId })) });
const fan = { fanRef: FAN, displayName: 'Display name', username: 'handle' };
const answer = (response: unknown): FanslyAnswer => ({ status: 200, response });
function world(reply: (call: FanslyCall) => unknown = () => []) {
  let time = 1_000;
  const call = vi.fn(async (request: FanslyCall) => {
    expect(admit(request.purpose, request.route)).not.toBeNull();
    return answer(await reply(request));
  });
  const lookup = createSpendersLookup({ call }, () => time);
  return { lookup, call, advance: (ms: number) => { time += ms; } };
}
afterEach(() => vi.useRealTimers());

describe('[host:fansly] Spenders missing-data lookup (R20 P9e)', () => {
  it('[SP-038] requests only the asked ids, in batches of 100, and ignores unsolicited accounts', async () => {
    const w = world(() => [{ id: FAN, displayName: 'Display', username: 'handle' }, { id: '999', displayName: 'Not asked' }]);
    const ids = Array.from({ length: 101 }, (_, n) => String(BigInt(FAN) + BigInt(n)));
    expect(await w.lookup.names(ACCOUNT, ids)).toEqual([{ fanRef: FAN, name: 'Display', displayName: 'Display', username: 'handle' }]);
    expect(w.call.mock.calls.map(([call]) => call.query?.['ids']?.split(',').length)).toEqual([100, 1]);
    expect(w.call.mock.calls.every(([call]) => call.purpose === 'spenders' && call.route === 'account.byIds')).toBe(true);
  });
  it('[SP-039] caches names and absent/deleted accounts for six hours, isolated by creator', async () => {
    const w = world(() => [{ id: FAN, displayName: 'Display' }]);
    await w.lookup.names(ACCOUNT, [FAN, '999']);
    w.advance(NAMES_TTL_MS - 1);
    await w.lookup.names(ACCOUNT, [FAN, '999']);
    expect(w.call).toHaveBeenCalledTimes(1);
    await w.lookup.names('123', [FAN]);
    expect(w.call).toHaveBeenCalledTimes(2);
    w.advance(1);
    await w.lookup.names(ACCOUNT, [FAN]);
    expect(w.call).toHaveBeenCalledTimes(3);
  });
  it('[SP-039] persists the cache across event-page sleep; concurrent boards share a single lookup; clear removes it', async () => {
    let stored: Readonly<Record<string, unknown>> = {};
    const storage = { get: () => Promise.resolve({ ok: true as const, value: stored }), set: (value: Readonly<Record<string, unknown>>) => { stored = structuredClone(value); return Promise.resolve({ ok: true as const }); } };
    const call = vi.fn(() => Promise.resolve(answer([{ id: FAN, username: 'handle' }])));
    const first = createSpendersLookup({ call }, () => 1000, storage);
    await Promise.all([first.names(ACCOUNT, [FAN]), first.names(ACCOUNT, [FAN])]);
    expect(call).toHaveBeenCalledTimes(1);
    const awake = createSpendersLookup({ call }, () => 1001, storage);
    expect(await awake.names(ACCOUNT, [FAN])).toMatchObject([{ name: 'handle' }]);
    expect(call).toHaveBeenCalledTimes(1);
    await awake.clear();
    expect(stored[NAMES_STORAGE_KEY]).toEqual({ v: 1, entries: [] });
    const reset = createSpendersLookup({ call }, () => 1002, storage);
    await reset.names(ACCOUNT, [FAN]);
    expect(call).toHaveBeenCalledTimes(2);
  });
  it('[SP-040] native 12002 custom name precedes display/username; CRM notes never become a name', async () => {
    const w = world(() => [{ id: FAN, displayName: 'Display', username: 'handle', notes: [{ contentType: 12000, note: 'CRM' }, { contentType: 12002, note: ' Saved name ' }] }]);
    expect(await w.lookup.names(ACCOUNT, [FAN])).toEqual([{ fanRef: FAN, name: 'Saved name', displayName: 'Display', username: 'handle' }]);
  });
  it('[SP-041] searches once by displayName || username and uses exact identity/membership, never a name match', async () => {
    const w = world(() => ({ data: [{ partnerAccountId: FAN, groupId: GROUP }], aggregationData: { groups: [group()] } }));
    expect(await w.lookup.resolve(ACCOUNT, fan)).toBe(GROUP);
    expect(w.call).toHaveBeenCalledTimes(1);
    expect(w.call.mock.calls[0]?.[0]).toMatchObject({ purpose: 'spenders', route: 'messaging.groups', query: { search: 'Display name', offset: '0' } });
    expect(await w.lookup.resolve(ACCOUNT, fan)).toBe(GROUP);
    expect(w.call).toHaveBeenCalledTimes(1);
    expect(w.lookup.cached('999', FAN)).toBeNull();
  });
  it('[FS-SPD-2] an empty successful search permits one POST /group; it never sends or acknowledges a message', async () => {
    const w = world((call) => call.route === 'messaging.groups' ? { data: [], aggregationData: { groups: [] } } : group());
    expect(await w.lookup.resolve(ACCOUNT, fan)).toBe(GROUP);
    expect(w.call.mock.calls.map(([call]) => call.route)).toEqual(['messaging.groups', 'group.create']);
    expect(w.call.mock.calls[1]?.[0]).toMatchObject({ purpose: 'spenders', body: { users: [{ userId: FAN, permissionFlags: 0 }, { userId: ACCOUNT, permissionFlags: 0 }], recipients: [], lastMessage: null, userSettings: null, type: 1 } });
  });
  it('without a searchable name, gets-or-creates once by exact ids', async () => {
    const w = world(() => group());
    expect(await w.lookup.resolve(ACCOUNT, { ...fan, displayName: null, username: null })).toBe(GROUP);
    expect(w.call.mock.calls.map(([call]) => call.route)).toEqual(['group.create']);
  });
  it.each(['network', 'rate-limited', 'cooling', 'expired', 'malformed'] as const)('a %s search never falls through to a POST or retries', async (kind) => {
    const w = world(() => { throw new FanslyApiError(kind, { sent: kind !== 'cooling' }); });
    await expect(w.lookup.resolve(ACCOUNT, fan)).rejects.toMatchObject({ kind });
    expect(w.call).toHaveBeenCalledTimes(1);
  });
  it('a group chat or another creator in the POST answer is refused, never cached or retried', async () => {
    for (const value of [group([ACCOUNT, FAN, '999']), group(['999', FAN]), group([ACCOUNT, FAN], 3)]) {
      const w = world(() => value);
      await expect(w.lookup.resolve(ACCOUNT, { ...fan, displayName: null, username: null })).rejects.toMatchObject({ kind: 'malformed' });
      expect(w.call).toHaveBeenCalledTimes(1);
      expect(w.lookup.cached(ACCOUNT, FAN)).toBeNull();
    }
  });
  it('a POST with an indeterminate outcome is attempted once', async () => {
    const w = world(() => { throw new FanslyApiError('network', { sent: true }); });
    await expect(w.lookup.resolve(ACCOUNT, { ...fan, displayName: null, username: null })).rejects.toMatchObject({ kind: 'network' });
    expect(w.call).toHaveBeenCalledTimes(1);
  });
  it('[SP-041] the 15 s budget aborts an inbox search and never starts a POST afterwards', async () => {
    vi.useFakeTimers();
    const w = world((call) => new Promise((_, reject) => call.signal?.addEventListener('abort', () => reject(new FanslyApiError('aborted', { sent: true })))));
    const finding = w.lookup.resolve(ACCOUNT, fan);
    const rejected = expect(finding).rejects.toMatchObject({ kind: 'aborted' });
    await vi.advanceTimersByTimeAsync(RESOLVE_BUDGET_MS);
    await rejected;
    expect(w.call).toHaveBeenCalledTimes(1);
  });
  it('concurrent clicks share one resolution; a cleared owner never receives a late group', async () => {
    let done!: (value: unknown) => void;
    const w = world(() => new Promise((resolve) => { done = resolve; }));
    const one = w.lookup.resolve(ACCOUNT, { ...fan, displayName: null, username: null });
    const two = w.lookup.resolve(ACCOUNT, { ...fan, displayName: null, username: null });
    expect(two).toBe(one);
    await w.lookup.clear();
    done(group());
    expect(await one).toBeNull();
    expect(w.lookup.cached(ACCOUNT, FAN)).toBeNull();
    expect(w.call).toHaveBeenCalledTimes(1);
  });
});
