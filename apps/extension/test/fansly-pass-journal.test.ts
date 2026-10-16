import { LOG_LIMITS } from '@cg/contracts/limits';
import { DEFAULT_SETTINGS, STORAGE_KEYS } from '@cg/contracts/settings';
import type { PassJournalRun } from '@cg/core/services/hosts/fansly/newcomers';
import { openBoundedStore, type BoundedStoreOptions } from '@cg/platform';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMemoryKv } from '../../../packages/core/src/services/test-support/memory-kv';
import { createPassJournal, PASS_JOURNAL_BOUNDS, PASS_JOURNAL_DB, PASS_JOURNAL_MEMORY, startPassJournal } from '../bg/fansly/pass-journal';
import { fanslyModule } from '../bg/fansly';
import type { BackgroundKit, HostSiteRegistry } from '../src/composition/background/host-module';

const T0 = Date.UTC(2026, 9, 16, 12);
const run = (n: number): PassJournalRun => ({ passId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, hostAccountId: '700000000000000017', startedAt: T0, windowHours: 48 });
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanups.splice(0)) await close();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function setup(idb = new IDBFactory(), limits: Partial<BoundedStoreOptions> = {}) {
  const clock = { now: T0, mono: 10 };
  const options = { dbName: PASS_JOURNAL_DB, ...PASS_JOURNAL_BOUNDS, ...limits, idb, now: () => clock.now };
  const disk = await openBoundedStore(options);
  const journal = createPassJournal({ open: () => Promise.resolve(disk), now: () => clock.now, monotonicNow: () => clock.mono });
  await journal.setEnabled(true);
  cleanups.push(() => journal.dispose());
  return { journal, disk, clock };
}

describe('[host:fansly] the pass journal in IndexedDB (R20 P10b3)', () => {
  it('[NF-029] [FS-NEW-5] rotates eight runs, including identical start times, and survives a background restart and a backwards wall clock', async () => {
    const idb = new IDBFactory();
    const first = await setup(idb);
    expect(PASS_JOURNAL_BOUNDS).toMatchObject({ maxGroups: 8, maxRecords: 100_000, maxBytes: 10 * 1024 * 1024 });
    for (let n = 0; n < 10; n++) {
      const sink = first.journal.start(run(n));
      sink?.('pass.start');
      sink?.('pass.end', { state: 'done' });
      await first.journal.idle();
    }
    expect(first.disk.stats()).toMatchObject({ records: 16, evicted: 4, groups: [3, 4, 5, 6, 7, 8, 9, 10] });
    const retained = await first.disk.latest(100);
    expect([...new Set(retained.map((row) => (row.value as PassJournalRun).passId))]).toEqual(Array.from({ length: 8 }, (_, i) => run(i + 2).passId));
    await first.journal.dispose();
    const second = await setup(idb);
    second.clock.now -= 100_000;
    second.journal.start(run(10))?.('pass.start');
    second.clock.mono += 15;
    second.clock.now -= 1000;
    second.journal.start(run(11))?.('pass.start');
    await second.journal.idle();
    expect(second.disk.stats().groups).toEqual([5, 6, 7, 8, 9, 10, 11, 12]);
    expect((await second.disk.latest(1))[0]?.value).toMatchObject({ passId: run(11).passId, at: new Date(second.clock.now).toISOString() });
  });

  it.each([
    { maxRecords: 5, maxBytes: LOG_LIMITS.newcomersJournalBytes },
    { maxRecords: LOG_LIMITS.newcomersJournalEvents, maxBytes: 1100 },
  ])('[NF-029] [FS-NEW-5] bounds one long run by records and serialized bytes: %o', async (limits) => {
    const t = await setup(new IDBFactory(), limits);
    const sink = t.journal.start(run(1));
    for (let n = 0; n < 30; n++) {
      sink?.('history.page', { page: n, count: 25 });
      await t.journal.idle();
    }
    const stats = t.disk.stats();
    expect(stats.records).toBeLessThanOrEqual(limits.maxRecords);
    expect(stats.bytes).toBeLessThanOrEqual(limits.maxBytes);
    expect(stats.records).toBeGreaterThan(0);
    expect(stats.records + stats.evicted).toBe(30);
    const rows = await t.disk.latest(100);
    expect(rows.at(-1)?.value).toMatchObject({ fields: { page: 29 } });
    expect(rows.reduce((sum, row) => sum + row.bytes, 0)).toBe(stats.bytes);
  });

  it('[NF-029] [FS-NEW-5] a stalled write retains only the bounded pending queue, one batch and the memory tail; omissions are counted', async () => {
    const disk = await openBoundedStore({ dbName: PASS_JOURNAL_DB, ...PASS_JOURNAL_BOUNDS, idb: new IDBFactory() });
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const writing = new Promise<void>((resolve) => { entered = resolve; });
    const journal = createPassJournal({
      now: () => T0, monotonicNow: () => 1,
      open: () => Promise.resolve({ ...disk, async append(rows) { entered(); await gate; return disk.append(rows); } }),
    });
    cleanups.push(() => journal.dispose());
    await journal.setEnabled(true);
    const sink = journal.start(run(1));
    sink?.('pass.start');
    await writing;
    try {
      for (let n = 0; n < 2000; n++) sink?.('history.page', { page: n });
      expect(journal.stats()).toMatchObject({ tail: PASS_JOURNAL_MEMORY.tail, pending: PASS_JOURNAL_MEMORY.pending, inFlight: 1, omitted: 2000 - PASS_JOURNAL_MEMORY.pending });
    } finally { release(); }
    await journal.idle();
    expect(journal.stats()).toMatchObject({ pending: 0, inFlight: 0 });
    expect(disk.stats().records).toBe(1 + PASS_JOURNAL_MEMORY.pending);
    expect((await disk.latest(1))[0]?.value).toMatchObject({ fields: { page: 1999 } });
    expect(((await disk.latest(1))[0]?.value as { omittedBefore: number }).omittedBefore).toBeGreaterThan(0);
    expect(journal.tail()).toHaveLength(PASS_JOURNAL_MEMORY.tail);
  });

  it('[NF-029] [FS-NEW-5] debug is selected at scan start; off/clear invalidate old sinks and erase disk and memory without reviving that scan', async () => {
    const t = await setup();
    const old = t.journal.start(run(1));
    old?.('pass.start');
    await t.journal.idle();
    await t.journal.setEnabled(false);
    expect(t.journal.start(run(2))).toBeUndefined();
    expect(await t.disk.latest(10)).toEqual([]);
    expect(t.journal.tail()).toEqual([]);
    await t.journal.setEnabled(true);
    old?.('pass.end');
    const current = t.journal.start(run(3));
    current?.('pass.start');
    await t.journal.idle();
    expect(t.disk.stats().records).toBe(1);
    await t.journal.clear();
    current?.('pass.end');
    await t.journal.idle();
    expect(t.disk.stats().records).toBe(0);
  });

  it('[FS-NEW-5] a clear waits out an in-flight write: old events cannot reappear, and a new run writes after the clear', async () => {
    const disk = await openBoundedStore({ dbName: PASS_JOURNAL_DB, ...PASS_JOURNAL_BOUNDS, idb: new IDBFactory() });
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const writing = new Promise<void>((resolve) => { entered = resolve; });
    const journal = createPassJournal({
      now: () => T0, monotonicNow: () => 1,
      open: () => Promise.resolve({ ...disk, async append(rows) { entered(); await gate; return disk.append(rows); } }),
    });
    cleanups.push(() => journal.dispose());
    await journal.setEnabled(true);
    const old = journal.start(run(1));
    old?.('pass.start');
    await writing;
    old?.('history.page');
    const cleared = journal.clear();
    old?.('pass.end');
    journal.start(run(2))?.('pass.start');
    release();
    await cleared;
    await journal.idle();
    expect((await disk.latest(100)).map((row) => (row.value as PassJournalRun).passId)).toEqual([run(2).passId]);
  });

  it('[NF-029] metadata only: no message/profile bodies, credentials, signed URLs, error messages or caller-owned object references', async () => {
    const t = await setup();
    const fields = { fanRef: '710000000000000001', count: 25, content: 'private text', headers: { authorization: 'private token' }, reason: 'https://image.invalid/signed?token=private', error: new Error('private error') };
    const extraRun = { ...run(1), welcome: 'private welcome' };
    const sink = t.journal.start(extraRun);
    sink?.('history.page', fields);
    fields.count = 100;
    extraRun.hostAccountId = 'another-account';
    t.clock.now -= 10_000;
    t.clock.mono += 20;
    sink?.('pass.end');
    await t.journal.idle();
    const records = (await t.disk.latest(10)).map((row) => row.value);
    expect(records[0]).toMatchObject({ hostAccountId: run(1).hostAccountId, fields: { fanRef: fields.fanRef, count: 25 }, offsetMs: 0 });
    expect(records[1]).toMatchObject({ offsetMs: 20 });
    expect(JSON.stringify(records)).not.toMatch(/private|image.invalid|another-account|authorization/);
  });

  it('[FS-NEW-5] an unavailable database counts losses, keeps a small tail, and never throws or accumulates a write queue', async () => {
    const broken = { open: () => { throw new Error('denied'); } } as unknown as IDBFactory;
    const t = await setup(broken);
    const sink = t.journal.start(run(1));
    for (let n = 0; n < 500; n++) sink?.('history.page', { page: n });
    await t.journal.idle();
    expect(t.journal.stats()).toMatchObject({ pending: 0, inFlight: 0, tail: 100, omitted: 500, store: { available: false } });
    await expect(t.journal.setEnabled(false)).rejects.toThrow('clear failed');
    expect(t.journal.tail()).toEqual([]);
  });

  it('[NF-029] observes the existing debug setting and clears retained runs when starting with debug off; no settings writes', async () => {
    const idb = new IDBFactory();
    vi.stubGlobal('indexedDB', idb);
    const local = createMemoryKv().open();
    await local.set({ [STORAGE_KEYS.settings]: { ...DEFAULT_SETTINGS, debug: { enabled: true, renderTrace: false } } });
    const set = vi.spyOn(local, 'set');
    const kit = { storage: { local, journal: openBoundedStore }, clock: { now: () => T0 } } as unknown as BackgroundKit;
    const first = await startPassJournal(kit);
    if (first === null) throw new Error('no journal port');
    first.start(run(1))?.('pass.start');
    await first.idle();
    await first.dispose();
    expect(set).not.toHaveBeenCalled();
    await local.set({ [STORAGE_KEYS.settings]: DEFAULT_SETTINGS });
    const second = await startPassJournal(kit);
    if (second === null) throw new Error('no journal port');
    cleanups.push(() => second.dispose());
    await second.idle();
    expect(second.start(run(2))).toBeUndefined();
    expect(second.stats().store).toMatchObject({ records: 0, groups: [] });
    await local.set({ [STORAGE_KEYS.settings]: { ...DEFAULT_SETTINGS, debug: { enabled: true, renderTrace: false } } });
    const sink = second.start(run(3));
    expect(sink).toBeTypeOf('function');
    sink?.('pass.start');
    await second.idle();
    await local.set({ [STORAGE_KEYS.settings]: DEFAULT_SETTINGS });
    await second.idle();
    expect(second.stats().store).toMatchObject({ records: 0 });
    expect(second.tail()).toEqual([]);
  });

  it('[NF-029] [FS-NEW-5] the wired background records actual HTTP attempts/statuses and retry gaps, then clears on owner change', async () => {
    vi.useFakeTimers({ now: T0, toFake: ['Date', 'setTimeout', 'clearTimeout', 'performance'] });
    const idb = new IDBFactory();
    const local = createMemoryKv().open();
    await local.set({ [STORAGE_KEYS.settings]: { ...DEFAULT_SETTINGS, debug: { enabled: true, renderTrace: false } } });
    const session = createMemoryKv().open();
    const requests = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('', { status: 401 }));
    vi.stubGlobal('fetch', requests);
    let registry: HostSiteRegistry | null = null;
    let stopped = false;
    let disk: Awaited<ReturnType<typeof openBoundedStore>> | undefined;
    const template = { legacyId: run(1).hostAccountId, canonicalId: null, connected: true, observedAt: T0, headers: { authorization: 'PRIVATE_TOKEN' }, checks: {} };
    const kit = {
      storage: { local, session, journal: async (options: BoundedStoreOptions) => (disk = await openBoundedStore({ ...options, idb })) },
      clock: { now: () => Date.now(), setTimer: (ms: number, fn: () => void) => setTimeout(fn, ms), clearTimer: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer) },
      ids: { uuid: () => crypto.randomUUID() },
      log: { service: () => undefined },
      router: { tabs: () => ['tab-1'] },
      networkSession: { ready: Promise.resolve(), idle: () => Promise.resolve(), rateLimits: () => [], forAccount: () => template, disconnect: () => Promise.resolve() },
      site: {
        plug(next: HostSiteRegistry) { registry = next; return () => undefined; },
        emit(_type: string, change: { pass: { state: string } }) { if (change.pass.state === 'stopped') stopped = true; },
      },
    } as unknown as BackgroundKit;
    const handle = await fanslyModule().start(kit);
    cleanups.push(async () => { vi.useRealTimers(); await handle.dispose(); });
    if (registry === null) throw new Error('registry not plugged');
    await (registry as HostSiteRegistry).handle('fansly.followers.scan', { hostAccountId: template.legacyId, windowHours: 48 }, { kind: 'tab', tabSessionId: 'tab-1', host: 'fansly-web', tabId: 12, url: 'https://fansly.com/messages' });
    await vi.waitFor(() => expect(stopped).toBe(true), { timeout: 10_000 });
    // Drain through the real module's disposal before reopening the same IDB.
    await handle.dispose();
    const retained = await openBoundedStore({ dbName: PASS_JOURNAL_DB, ...PASS_JOURNAL_BOUNDS, idb });
    cleanups.push(() => { retained.close(); return Promise.resolve(); });
    const records = (await retained.latest(100)).map((row) => row.value as { event: string; fields: { httpStatus?: number; waitMs?: number } });
    expect(requests).toHaveBeenCalledTimes(2);
    expect(records.filter((row) => row.event === 'http.end').map((row) => row.fields.httpStatus)).toEqual([503, 401]);
    expect(records.find((row) => row.event === 'call.wait')?.fields.waitMs).toBeGreaterThanOrEqual(1000);
    expect(JSON.stringify(records)).not.toMatch(/PRIVATE_TOKEN|authorization/);
    expect(disk).toBeDefined();
    retained.close();
    // A fresh realm sees the saved run; changing the signed-in owner erases it.
    const next = await fanslyModule().start(kit);
    cleanups.push(() => next.dispose());
    await next.onEvent({ kind: 'session', ownerChanged: true, signedOut: false });
    expect(disk?.stats().records).toBe(0);
  });
});
