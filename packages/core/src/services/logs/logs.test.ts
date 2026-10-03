import { LOG_LIMITS } from '@cg/contracts/limits';
import { LogRecordSchema, type LogRecord } from '@cg/contracts/logs';
import { describe, expect, it } from 'vitest';

import { CodeCounters, createLogger, createRedactor } from '../../domain/logging';
import { type Scheduler } from '../ports';
import {
  CHECK_JOURNAL_LIMITS,
  CheckJournal,
  DebugJournals,
  LOG_WRITE_POLICY,
  LogService,
  MemoryLogStore,
  acceptUiRecords,
  type LogStorePort,
  type StoredLog,
} from './index';

const T0 = Date.UTC(2026, 9, 3, 12, 0, 0);
const DAY = 86_400_000;
const TOKEN = 'agency_hub_device_Zx81kQpLm4Rt7Vw2Yb9N';
const TAB = '7d0a1c2e-3f4b-4c5d-8e6f-708192a3b4c5';
const RUN = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Manual timers: `tick(ms)` runs what is due. */
function clock(start = T0) {
  let now = start;
  let timers: { at: number; fn: () => void; id: number }[] = [];
  let ids = 0;
  const scheduler: Scheduler = {
    now: () => now,
    after: (ms, fn) => {
      const id = ++ids;
      timers.push({ at: now + ms, fn, id });
      return () => {
        timers = timers.filter((t) => t.id !== id);
      };
    },
  };
  return {
    scheduler,
    set: (at: number) => {
      now = at;
    },
    async tick(ms: number) {
      now += ms;
      const due = timers.filter((t) => t.at <= now);
      timers = timers.filter((t) => t.at > now);
      for (const t of due) t.fn();
      await settle();
    },
    get pendingTimers() {
      return timers.length;
    },
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

function record(i: number, over: Partial<LogRecord> = {}): LogRecord {
  return { ts: new Date(T0 + i).toISOString(), seq: i, level: 'info', scope: 'bg.ops', msg: 'op started', ...over };
}

/** A store whose methods can be made to fail. */
class FlakyStore extends MemoryLogStore {
  failAppend = false;
  failSessions = false;
  failPrune = false;
  failRead = false;
  failClear = false;
  override append(rows: readonly StoredLog[]): Promise<void> {
    return this.failAppend ? Promise.reject(new Error('quota')) : super.append(rows);
  }
  override sessions() {
    return this.failSessions ? Promise.reject(new Error('closed')) : super.sessions();
  }
  override dropOldest(count: number) {
    return this.failPrune ? Promise.reject(new Error('busy')) : super.dropOldest(count);
  }
  override tail(session: number, limit: number) {
    return this.failRead ? Promise.reject(new Error('read')) : super.tail(session, limit);
  }
  override clear() {
    return this.failClear ? Promise.reject(new Error('clear')) : super.clear();
  }
}

describe('[LG-004] the persistent log', () => {
  it('[LG-004] the logger’s records reach IndexedDB in one batch, a little later, without waiting', async () => {
    const c = clock();
    const store = new MemoryLogStore();
    const logs = new LogService({ store, scheduler: c.scheduler });
    expect(await logs.open(null)).toBe(1);
    const logger = createLogger({ now: () => c.scheduler.now(), debugEnabled: () => false, sinks: [logs.sink] });
    logger.info('bg.ops', 'op started');
    logger.warn('bg.hub', 'hub call failed', { code: 'CG-HUB-TIMEOUT' });
    expect(store.size).toBe(0);
    expect(logs.stats().pending).toBe(2);
    await c.tick(LOG_WRITE_POLICY.flushDelayMs);
    expect(store.size).toBe(2);
    const stats = logs.stats();
    expect(stats).toMatchObject({ available: true, session: 1, records: 2, sessions: 1, pending: 0, written: 2, lost: 0 });
    expect(stats.bytes).toBeGreaterThan(100);
    const recent = await logs.recent(10);
    expect(recent.map((r) => r.msg)).toEqual(['op started', 'hub call failed']);
    for (const r of recent) expect(LogRecordSchema.safeParse(r).success).toBe(true);
  });

  it('[LG-004] a full batch is written at once; a flush on suspend writes the rest', async () => {
    const c = clock();
    const store = new MemoryLogStore();
    const logs = new LogService({ store, scheduler: c.scheduler });
    await logs.open(null);
    for (let i = 0; i < LOG_WRITE_POLICY.batchMax; i += 1) logs.sink(record(i));
    await settle();
    expect(store.size).toBe(LOG_WRITE_POLICY.batchMax);
    for (let i = 0; i < 5; i += 1) logs.sink(record(1000 + i));
    await settle();
    expect(store.size).toBe(LOG_WRITE_POLICY.batchMax);
    await logs.flush();
    expect(store.size).toBe(LOG_WRITE_POLICY.batchMax + 5);
    expect(c.pendingTimers).toBe(0);
  });

  it('[LG-004] records logged before the store opened are kept and written into the new session', async () => {
    const c = clock();
    const store = new MemoryLogStore();
    const logs = new LogService({ store, scheduler: c.scheduler });
    logs.sink(record(1));
    expect(await logs.open(null)).toBe(1);
    await settle();
    expect((await store.tail(1, 10)).map((r) => r.record.seq)).toEqual([1]);
    expect(await logs.recent(0)).toEqual([]);
  });
});

describe('[LG-005] [LG-023] sessions and limits', () => {
  async function session(store: LogStorePort, c: ReturnType<typeof clock>, resume: number | null, n: number, startAt = 0) {
    const logs = new LogService({ store, scheduler: c.scheduler });
    const id = await logs.open(resume);
    for (let i = 0; i < n; i += 1) logs.sink(record(startAt + i));
    await logs.flush();
    return { logs, id };
  }

  it('[LG-023] a new browser session starts the next log session; a wake-up continues the same one', async () => {
    const c = clock();
    const store = new MemoryLogStore();
    const first = await session(store, c, null, 3);
    expect(first.id).toBe(1);
    const woke = await session(store, c, 1, 2, 10);
    expect(woke.id).toBe(1);
    const next = await session(store, c, null, 2, 20);
    expect(next.id).toBe(2);
    expect(await session(store, c, 1, 0).then((s) => s.id)).toBe(3);
    const previous = await next.logs.previousTail(3);
    expect(previous.session).toBe(1);
    expect(previous.records.map((r) => r.seq)).toEqual([2, 10, 11]);
    expect((await first.logs.previousTail(5)).session).toBeNull();
  });

  it('[LG-005] keeps the current session and the two before it', async () => {
    const c = clock();
    const store = new MemoryLogStore();
    for (let i = 0; i < 5; i += 1) await session(store, c, null, 2, i * 10);
    expect((await store.sessions()).map((s) => s.session)).toEqual([3, 4, 5]);
    const last = new LogService({ store, scheduler: c.scheduler });
    expect(await last.open(null)).toBe(6);
    expect((await store.sessions()).map((s) => s.session)).toEqual([4, 5]);
    expect(last.stats().pruned).toBe(2);
  });

  it('[LG-005] at most N records and B bytes: the oldest go first, with headroom, counted', async () => {
    const c = clock();
    const store = new MemoryLogStore();
    const logs = new LogService({ store, scheduler: c.scheduler, limits: { sessionsKept: 3, maxRecords: 100, maxBytes: 1_000_000, maxAgeMs: 7 * DAY } });
    await logs.open(null);
    for (let i = 0; i < 150; i += 1) logs.sink(record(i));
    await logs.flush();
    const stats = logs.stats();
    expect(stats.records).toBeLessThanOrEqual(100);
    expect(stats.records).toBeGreaterThanOrEqual(80);
    expect(stats.pruned).toBe(150 - stats.records);
    const tail = await logs.recent(500);
    expect(tail.at(-1)?.seq).toBe(149);
    const bytes = new LogService({ store: new MemoryLogStore(), scheduler: c.scheduler, limits: { sessionsKept: 3, maxRecords: 10_000, maxBytes: 4000, maxAgeMs: 7 * DAY } });
    await bytes.open(null);
    for (let i = 0; i < 100; i += 1) bytes.sink(record(i));
    await bytes.flush();
    expect(bytes.stats().bytes).toBeLessThanOrEqual(4000);
    expect(bytes.stats().records).toBeGreaterThan(0);
  });

  it('[LG-005] the default limits are the frozen ones: 3 sessions, 20 000 records, 10 MiB, 7 days', () => {
    expect([LOG_LIMITS.sessionsKept, LOG_LIMITS.idbMaxRecords, LOG_LIMITS.idbMaxBytes, LOG_LIMITS.idbMaxAgeMs]).toEqual([3, 20_000, 10 * 1024 * 1024, 7 * DAY]);
  });

  it('[LG-005] records older than 7 days go on open and then hourly', async () => {
    const c = clock(T0 - 10 * DAY);
    const store = new MemoryLogStore();
    const old = new LogService({ store, scheduler: c.scheduler });
    await old.open(null);
    old.sink(record(-10 * DAY));
    await old.flush();
    c.set(T0);
    const logs = new LogService({ store, scheduler: c.scheduler });
    await logs.open(1);
    expect(store.size).toBe(0);
    expect(logs.stats().pruned).toBe(1);
    logs.sink(record(0));
    await logs.flush();
    c.set(T0 + 8 * DAY);
    logs.sink(record(8 * DAY));
    await logs.flush();
    expect(store.size).toBe(1);
  });
});

describe('[LG-012] the store never throws and never blocks the logger', () => {
  it('[LG-012] failed writes are lost and counted; a failure is reported at most once a minute', async () => {
    const c = clock();
    const store = new FlakyStore();
    const failures: string[] = [];
    const logs = new LogService({ store, scheduler: c.scheduler, onFailure: (what) => failures.push(what) });
    await logs.open(null);
    store.failAppend = true;
    logs.sink(record(1));
    await logs.flush();
    logs.sink(record(2));
    await logs.flush();
    expect(logs.stats()).toMatchObject({ lost: 2, failures: 2, written: 0 });
    expect(failures).toEqual(['append']);
    await c.tick(LOG_WRITE_POLICY.failureReportEveryMs);
    store.failAppend = false;
    store.failRead = true;
    expect(await logs.recent(5)).toEqual([]);
    expect(failures).toEqual(['append', 'read']);
    store.failRead = false;
    store.failClear = true;
    await logs.clear();
    expect(logs.stats().failures).toBe(4);
  });

  it('[LG-012] a store that cannot open turns the log into memory only', async () => {
    const c = clock();
    const store = new FlakyStore();
    store.failSessions = true;
    const failures: string[] = [];
    const logs = new LogService({ store, scheduler: c.scheduler, onFailure: (what) => failures.push(what) });
    expect(await logs.open(null)).toBe(1);
    logs.sink(record(1));
    await logs.flush();
    expect(logs.stats()).toMatchObject({ available: false, lost: 1 });
    expect(failures).toEqual(['open']);
    expect(await logs.previousTail(5)).toEqual({ session: null, records: [] });
    const reporterThrows = new LogService({
      store,
      scheduler: c.scheduler,
      onFailure: () => {
        throw new Error('boom');
      },
    });
    await expect(reporterThrows.open(null)).resolves.toBe(1);
  });

  it('[LG-012] the pending queue is bounded; overflow is lost and counted', async () => {
    const c = clock();
    const logs = new LogService({ store: new MemoryLogStore(), scheduler: c.scheduler });
    // Not opened yet: nothing is written, the queue keeps the newest.
    for (let i = 0; i < LOG_WRITE_POLICY.pendingMax + 7; i += 1) logs.sink(record(i));
    expect(logs.stats().pending).toBe(LOG_WRITE_POLICY.pendingMax);
    expect(logs.stats().lost).toBe(7);
    await logs.open(null);
    await logs.flush();
    expect(logs.stats().written).toBe(LOG_WRITE_POLICY.pendingMax);
  });

  it('[LG-012] a failing prune keeps the log working', async () => {
    const c = clock();
    const store = new FlakyStore();
    const logs = new LogService({ store, scheduler: c.scheduler, limits: { sessionsKept: 3, maxRecords: 5, maxBytes: 1e9, maxAgeMs: 7 * DAY } });
    await logs.open(null);
    store.failPrune = true;
    for (let i = 0; i < 10; i += 1) logs.sink(record(i));
    await logs.flush();
    expect(logs.stats()).toMatchObject({ written: 10, records: 10, failures: 1 });
  });
});

describe('[ST-110] the size of our logs and «Очистить локальные данные»', () => {
  it('[ST-110] stats give records and bytes; clear empties the store and keeps the session', async () => {
    const c = clock();
    const store = new MemoryLogStore();
    const logs = new LogService({ store, scheduler: c.scheduler });
    await logs.open(null);
    logs.sink(record(1));
    await logs.flush();
    logs.sink(record(2));
    await logs.clear();
    expect(store.size).toBe(0);
    expect(logs.stats()).toMatchObject({ records: 0, bytes: 0, pending: 0, session: 1 });
  });
});

describe('[LG-011] [LG-003] records from tabs and pages', () => {
  it('[LG-003] the background masks the token a tab never knew, adds the tab session, counts codes', () => {
    const redactor = createRedactor();
    redactor.setToken(TOKEN);
    const stored: LogRecord[] = [];
    const counters = new CodeCounters(T0);
    const fromTab: LogRecord = {
      ts: new Date(T0).toISOString(),
      seq: 4,
      level: 'warn',
      scope: 'tab.dock',
      msg: `failed with ${TOKEN}`,
      code: 'CG-INSERT-FAILED',
      fields: { reason: `token tail ${TOKEN.slice(-8)}`, text: '[text len=12]' },
    };
    const answer = acceptUiRecords([fromTab], { tabSessionId: TAB }, { redactor, sinks: [(r) => stored.push(r)], debugEnabled: () => false, counters });
    expect(answer).toEqual({ accepted: 1, dropped: 0 });
    const json = JSON.stringify(stored);
    expect(json).not.toContain(TOKEN);
    expect(json).not.toContain(TOKEN.slice(-8));
    expect(stored[0]).toMatchObject({ seq: 4, scope: 'tab.dock', code: 'CG-INSERT-FAILED', ctx: { tabSessionId: TAB }, fields: { text: '[text len=12]' } });
    expect(LogRecordSchema.safeParse(stored[0]).success).toBe(true);
    expect(counters.todayCounts(T0)).toEqual([{ code: 'CG-INSERT-FAILED', count: 1 }]);
  });

  it('[LG-011] debug records only in debug mode; more than 50 per write are dropped; a failing sink loses nothing for the others', () => {
    const redactor = createRedactor();
    const stored: LogRecord[] = [];
    const records = Array.from({ length: 53 }, (_, i) => record(i, { level: i === 0 ? 'debug' : 'info' }));
    const answer = acceptUiRecords(records, {}, {
      redactor,
      sinks: [
        () => {
          throw new Error('sink');
        },
        (r) => stored.push(r),
      ],
      debugEnabled: () => false,
    });
    expect(answer).toEqual({ accepted: 49, dropped: 4 });
    expect(stored).toHaveLength(49);
    expect(stored[0]?.ctx).toBeUndefined();
    const withDebug = acceptUiRecords([record(0, { level: 'debug' })], {}, {
      redactor,
      sinks: [],
      debugEnabled: () => {
        throw new Error('settings');
      },
    });
    expect(withDebug).toEqual({ accepted: 0, dropped: 1 });
  });
});

describe('[NF-029] the «Новые» check journal', () => {
  it('[NF-029] keeps at most 8 runs; a dropped run marks the journal cut', () => {
    const journal = new CheckJournal();
    for (let run = 1; run <= 9; run += 1) journal.add(RUN(run), new Date(T0 + run).toISOString(), record(run));
    const read = journal.read(500);
    expect(read.runs.map((r) => r.runId)).toEqual(Array.from({ length: 8 }, (_, i) => RUN(i + 2)));
    expect(read.truncated).toBe(true);
    expect(read.records.map((r) => r.seq)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    journal.startRun(RUN(9), 'ignored');
    expect(journal.read(1).runs).toHaveLength(8);
    expect(CHECK_JOURNAL_LIMITS).toEqual({ runs: 8, events: 100_000, bytes: 10 * 1024 * 1024 });
  });

  it('[NF-029] limits events and bytes: older runs go first, then the oldest events of the current run', () => {
    const journal = new CheckJournal({ runs: 8, events: 10, bytes: 1e9 });
    const sink = journal.sinkFor(RUN(1), new Date(T0).toISOString());
    for (let i = 0; i < 4; i += 1) sink(record(i));
    for (let i = 0; i < 2000; i += 1) journal.add(RUN(2), new Date(T0).toISOString(), record(100 + i));
    const read = journal.read(500);
    expect(read.runs).toEqual([{ runId: RUN(2), startedAt: new Date(T0).toISOString(), events: 10 }]);
    expect(read.records.map((r) => r.seq)).toEqual(Array.from({ length: 10 }, (_, i) => 2090 + i));
    expect(read.truncated).toBe(true);
    expect(journal.stats()).toMatchObject({ runs: 1, events: 10 });
    const bytes = new CheckJournal({ runs: 8, events: 1e9, bytes: 1000 });
    for (let i = 0; i < 50; i += 1) bytes.add(RUN(1), new Date(T0).toISOString(), record(i));
    expect(bytes.stats().bytes).toBeLessThanOrEqual(1000);
    expect(bytes.read(0).records).toEqual([]);
    bytes.clear();
    expect(bytes.stats()).toEqual({ runs: 0, events: 0, bytes: 0, truncated: false });
  });

  it('[NF-029] the debug journals collect by scope only in debug mode and clear', () => {
    let debug = false;
    const journals = new DebugJournals(() => debug);
    const logger = createLogger({ now: () => T0, debugEnabled: () => debug, sinks: [journals.sink] });
    logger.info('bg.ops', 'op started');
    debug = true;
    logger.info('bg.ops.queue', 'op started');
    logger.info('bg.hub', 'hub call');
    logger.info('bg.send', 'preview send state');
    logger.info('bg.lifecycle', 'background started');
    journals.newcomersSink(RUN(1), new Date(T0).toISOString())(record(1));
    expect(journals.read('operations', 10).records.map((r) => r.scope)).toEqual(['bg.ops.queue']);
    expect(journals.read('hub-calls', 10).records).toHaveLength(1);
    expect(journals.read('send-attempts', 10)).toMatchObject({ truncated: false, runs: null });
    expect(journals.read('newcomers-check', 10).runs).toHaveLength(1);
    expect(journals.read('operations', 0).records).toEqual([]);
    debug = false;
    journals.newcomersSink(RUN(2), new Date(T0).toISOString())(record(2));
    journals.clear();
    expect(journals.read('hub-calls', 10).records).toEqual([]);
    expect(journals.read('newcomers-check', 10).runs).toEqual([]);
    const broken = new DebugJournals(() => {
      throw new Error('settings');
    });
    expect(() => broken.sink(record(1))).not.toThrow();
    expect(() => broken.newcomersSink(RUN(1), 'x')(record(1))).not.toThrow();
  });
});
