import { LOG_DB_NAME, LOG_LIMITS } from '@cg/contracts';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';

import { openBoundedStore, type BoundedStoreOptions } from './idb';

const MINUTE = 60_000;

function options(idb: IDBFactory, clock: { now: number }, overrides: Partial<BoundedStoreOptions> = {}): BoundedStoreOptions {
  return {
    dbName: LOG_DB_NAME,
    idb,
    now: () => clock.now,
    maxRecords: LOG_LIMITS.idbMaxRecords,
    maxBytes: LOG_LIMITS.idbMaxBytes,
    maxAgeMs: LOG_LIMITS.idbMaxAgeMs,
    maxGroups: LOG_LIMITS.sessionsKept,
    maxRecordBytes: LOG_LIMITS.maxRecordBytes,
    ...overrides,
  };
}

const record = (at: number, group: number, n: number) => ({ at, group, value: { seq: n, level: 'info', msg: 'event' } });

describe('bounded IndexedDB store (§9.2)', () => {
  it('[LG-004] keeps records across a background restart and returns the newest, oldest first', async () => {
    const idb = new IDBFactory();
    const clock = { now: 1_000_000 };
    const first = await openBoundedStore(options(idb, clock));
    expect(first.stats()).toMatchObject({ available: true, records: 0, bytes: 0 });
    expect(await first.append([record(clock.now, 1, 1), record(clock.now, 1, 2), record(clock.now, 1, 3)])).toEqual({ stored: 3, rejected: 0 });
    first.close();
    // A new event page instance opens the same database.
    const second = await openBoundedStore(options(idb, clock));
    expect(second.stats()).toMatchObject({ records: 3, groups: [1] });
    const latest = await second.latest(2);
    expect(latest.map((r) => (r.value as { seq: number }).seq)).toEqual([2, 3]);
    expect(latest[0]).toMatchObject({ group: 1, at: clock.now });
    expect(latest[0]?.bytes).toBeGreaterThan(0);
    expect(await second.latest(0)).toEqual([]);
    second.close();
  });

  it('[LG-005] appends at the same time never evict more than the bounds require', async () => {
    const idb = new IDBFactory();
    const clock = { now: 10 * MINUTE };
    const store = await openBoundedStore(options(idb, clock, { maxRecords: 10, maxBytes: 1_000_000, maxAgeMs: 60 * MINUTE }));
    await store.append(Array.from({ length: 10 }, (_, i) => record(clock.now, 1, i)));
    const results = await Promise.all([
      store.append([record(clock.now, 1, 10), record(clock.now, 1, 11)]),
      store.append([record(clock.now, 1, 12), record(clock.now, 1, 13)]),
      store.prune(),
    ]);
    expect(results.slice(0, 2)).toEqual([
      { stored: 2, rejected: 0 },
      { stored: 2, rejected: 0 },
    ]);
    expect(store.stats()).toMatchObject({ records: 10, evicted: 4 });
    expect((await store.latest(20)).map((r) => (r.value as { seq: number }).seq)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    store.close();
  });

  it('[LG-005] rotates by record count, by bytes and by age — whichever comes first', async () => {
    const idb = new IDBFactory();
    const clock = { now: 10 * MINUTE };
    const store = await openBoundedStore(options(idb, clock, { maxRecords: 5, maxBytes: 100_000, maxAgeMs: 5 * MINUTE }));
    await store.append(Array.from({ length: 8 }, (_, i) => record(clock.now, 1, i)));
    expect(store.stats()).toMatchObject({ records: 5, evicted: 3 });
    expect((await store.latest(10)).map((r) => (r.value as { seq: number }).seq)).toEqual([3, 4, 5, 6, 7]);
    // Age: everything older than maxAgeMs goes on the next write.
    clock.now += 6 * MINUTE;
    await store.append([record(clock.now, 1, 100)]);
    expect(store.stats()).toMatchObject({ records: 1, expired: 5 });
    // Bytes.
    const bytesStore = await openBoundedStore(options(new IDBFactory(), clock, { dbName: 'bytes', maxRecords: 1000, maxBytes: 600 }));
    await bytesStore.append(Array.from({ length: 10 }, (_, i) => record(clock.now, 1, i)));
    const stats = bytesStore.stats();
    expect(stats.bytes).toBeLessThanOrEqual(600);
    expect(stats.records).toBeGreaterThan(0);
    expect(stats.records + stats.evicted).toBe(10);
  });

  it('[LG-023] keeps the current session and the two previous ones', async () => {
    const idb = new IDBFactory();
    const clock = { now: MINUTE };
    const store = await openBoundedStore(options(idb, clock));
    for (const session of [1, 2, 3]) await store.append([record(clock.now, session, session * 10), record(clock.now, session, session * 10 + 1)]);
    expect(store.stats().groups).toEqual([1, 2, 3]);
    await store.append([record(clock.now, 4, 40)]);
    expect(store.stats().groups).toEqual([2, 3, 4]);
    // The previous session's tail is still there for the diagnostics package.
    expect((await store.latest(5, { group: 3 })).map((r) => (r.value as { seq: number }).seq)).toEqual([30, 31]);
  });

  it('[LG-005] rotating whole groups accounts counts and bytes without retaining their record values', async () => {
    const clock = { now: MINUTE };
    const store = await openBoundedStore(options(new IDBFactory(), clock, { maxGroups: 2, maxRecords: 12, maxBytes: 6000, maxAgeMs: MINUTE }));
    for (let group = 1; group <= 10; group++) {
      await store.append(Array.from({ length: 4 }, (_, n) => ({ at: clock.now, group, value: { n, metadata: 'x'.repeat(100 * (n + 1)) } })));
      const rows = await store.latest(20);
      const stats = store.stats();
      expect(stats.records).toBe(rows.length);
      expect(stats.bytes).toBe(rows.reduce((sum, row) => sum + row.bytes, 0));
      expect(stats.records + stats.evicted).toBe(group * 4);
      expect(stats.groups).toEqual(group === 1 ? [1] : [group - 1, group]);
    }
    clock.now += 2 * MINUTE;
    await store.prune();
    expect(store.stats()).toMatchObject({ records: 0, bytes: 0, groups: [], expired: 8, evicted: 32 });
    store.close();
  });

  it('never throws: oversized or non-JSON records are refused, an unavailable database counts losses', async () => {
    const clock = { now: MINUTE };
    const store = await openBoundedStore(options(new IDBFactory(), clock, { maxRecordBytes: 200 }));
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    expect(await store.append([{ at: clock.now, group: 1, value: 'x'.repeat(500) }, { at: clock.now, group: 1, value: cyclic }])).toEqual({ stored: 0, rejected: 2 });
    expect(store.stats().rejected).toBe(2);
    expect(await store.clear()).toBe(true);
    store.close();
    // After close every call is a counted loss, not an exception.
    expect(await store.append([record(clock.now, 1, 1)])).toEqual({ stored: 0, rejected: 0 });
    expect(await store.latest(5)).toEqual([]);
    expect(await store.clear()).toBe(false);
    expect(store.stats()).toMatchObject({ available: false, failed: 1 });
    const broken = await openBoundedStore(options({ open: () => { throw new Error('denied'); } } as unknown as IDBFactory, clock));
    expect(broken.stats().available).toBe(false);
    await broken.prune();
    const none = await openBoundedStore({ ...options(new IDBFactory(), clock), idb: undefined as unknown as IDBFactory });
    expect(none.stats().available).toBe(typeof globalThis.indexedDB !== 'undefined');
  });

  it('clears everything ("Очистить локальные данные")', async () => {
    const clock = { now: MINUTE };
    const store = await openBoundedStore(options(new IDBFactory(), clock));
    await store.append([record(clock.now, 1, 1), record(clock.now, 2, 2)]);
    expect(await store.clear()).toBe(true);
    expect(store.stats()).toMatchObject({ records: 0, bytes: 0, groups: [] });
    expect(await store.latest(10)).toEqual([]);
  });
});
