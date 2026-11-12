import { describe, expect, it } from 'vitest';

import { readAccountsSeen } from '../hosts/fansly/badges';
import { fanGoneOf, hubFanAccountOf, type HubFanAccount } from './account-state';

const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `92000000000000${String(1000 + i)}`);
const [a = '', b = '', c = ''] = ids(3);

describe('[host:fansly] readAccountsSeen: which ids of this very read Fansly returned', () => {
  it('a returned id is seen whatever its flags, an asked id absent is not; `accounts` inside an object too', () => {
    expect(readAccountsSeen([{ id: a }, { id: b, userFlags: 2 }], [a, b, c])).toEqual(new Map([[a, true], [b, true], [c, false]]));
    expect(readAccountsSeen({ accounts: [{ id: a }] }, [a, b])).toEqual(new Map([[a, true], [b, false]]));
  });

  it('for one id an empty list is that fan not seen', () => {
    expect(readAccountsSeen([], [a])).toEqual(new Map([[a, false]]));
  });

  it('any malformed entry makes the whole answer say nothing; so does a shape that is not a list', () => {
    expect(readAccountsSeen([{ id: a }, { id: 7 }], [a, b])).toBeNull();
    expect(readAccountsSeen([{ id: a }, null], [a, b])).toBeNull();
    expect(readAccountsSeen([{ id: a }, [b]], [a, b])).toBeNull();
    expect(readAccountsSeen([{ id: a }, 'x'], [a])).toBeNull();
    expect(readAccountsSeen({ accounts: 'x' }, [a])).toBeNull();
    expect(readAccountsSeen(null, [a])).toBeNull();
    expect(readAccountsSeen({ id: a }, [a])).toBeNull();
  });

  it('five or more asked and none of them returned says nothing; four is still an answer', () => {
    expect(readAccountsSeen([], ids(5))).toBeNull();
    expect(readAccountsSeen([{ id: '930000000000000001' }], ids(5))).toBeNull();
    expect(readAccountsSeen([], ids(4))).toEqual(new Map(ids(4).map((id) => [id, false])));
    const five = ids(5);
    expect(readAccountsSeen([{ id: five[2] }], five)?.get(five[2] ?? '')).toBe(true);
  });
});

const T = Date.UTC(2026, 10, 12, 10);
const iso = (ms: number): string => new Date(ms).toISOString();
const hub = (state: HubFanAccount['state'], checkedAt = T, since: string | null = null): HubFanAccount => ({ state, since, checkedAt: iso(checkedAt) });

describe('hubFanAccountOf: the hub\'s word, or before fan-account-state-v1 its accountLookupMissAt', () => {
  it('a hub without the capability: a lookup miss is a fan not seen, cause unknown; none — no word', () => {
    expect(hubFanAccountOf(undefined, iso(T))).toEqual({ state: 'unchecked', since: null, checkedAt: iso(T) });
    expect(hubFanAccountOf(undefined, null)).toBeNull();
    expect(hubFanAccountOf(undefined, undefined)).toBeNull();
  });

  it('with it: its state, an unknown one read as unchecked; null — never answered, whatever the old field says', () => {
    expect(hubFanAccountOf({ state: 'blocked', since: iso(T - 1000), checkedAt: iso(T) }, null)).toEqual({ state: 'blocked', since: iso(T - 1000), checkedAt: iso(T) });
    expect(hubFanAccountOf({ state: 'suspended', since: null, checkedAt: iso(T) }, null)?.state).toBe('unchecked');
    expect(hubFanAccountOf(null, iso(T))).toBeNull();
  });
});

describe('fanGoneOf: one mark from the hub\'s word and the local read', () => {
  it('the hub says not seen, the local read says not seen or nothing: the hub\'s state, not local', () => {
    expect(fanGoneOf(hub('deleted', T, iso(T - 5000)), null)).toEqual({ state: 'deleted', since: iso(T - 5000), checkedAt: iso(T), local: false });
    expect(fanGoneOf(hub('blocked'), { seen: false, at: T + 1000 })).toEqual({ state: 'blocked', since: null, checkedAt: iso(T), local: false });
    expect(fanGoneOf(hub('unchecked'), { seen: false, at: T - 1000 })?.local).toBe(false);
  });

  it('a local «seen» newer than the hub\'s answer clears the mark; an older one does not', () => {
    expect(fanGoneOf(hub('deleted'), { seen: true, at: T + 1 })).toBeNull();
    expect(fanGoneOf(hub('deleted'), { seen: true, at: T })?.state).toBe('deleted');
    expect(fanGoneOf(hub('blocked'), { seen: true, at: T - 60_000 })?.state).toBe('blocked');
  });

  it('a newer local «not seen» while the hub says seen or nothing: «не виден», local, checked at the local read', () => {
    expect(fanGoneOf(hub('seen'), { seen: false, at: T + 1000 })).toEqual({ state: 'unchecked', since: null, checkedAt: iso(T + 1000), local: true });
    expect(fanGoneOf(null, { seen: false, at: T })).toEqual({ state: 'unchecked', since: null, checkedAt: iso(T), local: true });
  });

  it('otherwise no mark: seen by both, a stale local miss, nothing at all', () => {
    expect(fanGoneOf(hub('seen'), { seen: true, at: T + 1000 })).toBeNull();
    expect(fanGoneOf(hub('seen'), { seen: false, at: T - 1000 })).toBeNull();
    expect(fanGoneOf(hub('seen'), null)).toBeNull();
    expect(fanGoneOf(null, { seen: true, at: T })).toBeNull();
    expect(fanGoneOf(null, null)).toBeNull();
  });
});
