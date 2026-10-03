import { IDS, journalEntry, T0, uuid } from '@cg/contracts/fixtures';
import { sendLockKey, type SendJournalEntry } from '@cg/contracts/send';
import { STORAGE_KEYS } from '@cg/contracts/settings';
import { describe, expect, it } from 'vitest';

import { createSendJournal, isOpenSendState, SEND_JOURNAL_LIMITS, SEND_JOURNAL_OPEN_STATES, type SendJournalDeps } from './send-journal';
import type { ServiceLogEntry } from './storage/ports';
import { createMemoryKv, manualClock, type MemoryKv } from './test-support/memory-kv';

const KEY = STORAGE_KEYS.sendJournal;
const DAY = 24 * 60 * 60 * 1000;

const entry = (n: number, extra: Partial<SendJournalEntry> = {}): SendJournalEntry => ({
  ...journalEntry,
  attemptId: uuid(500 + n),
  createdAt: T0,
  updatedAt: T0,
  ...extra,
});

function setup(options: { local?: MemoryKv; at?: number; deps?: Partial<SendJournalDeps> } = {}) {
  const local = options.local ?? createMemoryKv();
  const port = local.open();
  const clock = manualClock(options.at ?? T0);
  const logs: ServiceLogEntry[] = [];
  const journal = createSendJournal({ local: port, clock, log: (item) => logs.push(item), ...options.deps });
  return { local, port, clock, logs, journal };
}

const stored = (local: MemoryKv): { v: number; entries: Record<string, unknown>[] } | undefined => local.read(KEY);

describe('[X8-07] the send journal: written before the command, never retried when unknown', () => {
  it('journals a new attempt in ONE set before anything goes to MAIN; the record has no text', async () => {
    const { local, journal } = setup();
    await journal.start();
    const before = local.calls.set;
    const begun = await journal.begin(entry(1));
    expect(begun).toEqual({ ok: true, entry: entry(1) });
    expect(local.calls.set - before).toBe(1);
    const value = stored(local);
    expect(value?.v).toBe(1);
    expect(value?.entries).toEqual([entry(1)]);
    expect(Object.keys(value?.entries[0] ?? {}).some((key) => /text|draft|body|message$/i.test(key))).toBe(false);
    expect(journal.get(uuid(501))).toEqual(entry(1));
    expect(journal.get(uuid(999))).toBeNull();
  });

  it('a record that did not save means no enqueue: the failure is the answer, nothing is held in memory', async () => {
    const { local, journal, logs } = setup();
    local.failNext('set');
    expect(await journal.begin(entry(1))).toMatchObject({ ok: false, code: 'CG-STORAGE-WRITE' });
    local.failNext('set', 'full');
    expect(await journal.begin(entry(1))).toMatchObject({ ok: false, code: 'CG-STORAGE-FULL' });
    expect(journal.open()).toEqual([]);
    expect(logs.filter((item) => item.msg === 'send journal record not saved: no queue call')).toHaveLength(2);
    // The next click journals normally.
    expect((await journal.begin(entry(2))).ok).toBe(true);
  });

  it('[X8-08] one open attempt per (hubOrigin, pageId, platform, fanRef): a second is CG-SEND-BUSY', async () => {
    const { journal } = setup();
    await journal.begin(entry(1));
    expect(await journal.begin(entry(2))).toMatchObject({ ok: false, code: 'CG-SEND-BUSY', holder: uuid(501) });
    expect(await journal.begin(entry(1))).toMatchObject({ ok: false, code: 'CG-SEND-BUSY', holder: uuid(501) });
    expect((await journal.begin(entry(3, { fanRef: IDS.otherFan }))).ok).toBe(true);
    expect((await journal.begin(entry(4, { pageId: 12 }))).ok).toBe(true);
    expect(journal.open(sendLockKey(entry(1))).map((item) => item.attemptId)).toEqual([uuid(501)]);
    expect(journal.open()).toHaveLength(3);
    // Only a new record in `preparing` is journaled.
    expect(await journal.begin(entry(5, { fanRef: '9999', state: 'nativeEnqueued' }))).toMatchObject({ ok: false, code: 'CG-STORAGE-WRITE' });
    expect(await journal.begin({ ...entry(6), attemptId: 'nope' })).toMatchObject({ ok: false, code: 'CG-STORAGE-WRITE' });
  });

  it('moves only along the attempt states; an end frees the fan', async () => {
    const { journal, clock } = setup();
    await journal.begin(entry(1));
    clock.advance(10);
    expect(await journal.advance(uuid(501), { state: 'nativeEnqueued', pendingId: 'pending-1' })).toMatchObject({ ok: true, persisted: true, entry: { state: 'nativeEnqueued', pendingId: 'pending-1', updatedAt: T0 + 10 } });
    expect(await journal.advance(uuid(501), { state: 'preparing' })).toMatchObject({ ok: false, code: 'transition' });
    expect(await journal.advance(uuid(501), { state: 'nativeAccepted', platformMessageId: IDS.msg2 })).toMatchObject({ ok: true, entry: { state: 'nativeAccepted', platformMessageId: IDS.msg2 } });
    // The same state again only adds facts.
    expect(await journal.advance(uuid(501), { state: 'nativeAccepted' })).toMatchObject({ ok: true, entry: { state: 'nativeAccepted' } });
    expect(await journal.advance(uuid(501), { state: 'sentObserved' })).toMatchObject({ ok: true, entry: { state: 'sentObserved' } });
    expect(await journal.advance(uuid(501), { state: 'ready' })).toMatchObject({ ok: false, code: 'transition' });
    expect(await journal.advance(uuid(999), { state: 'held' })).toMatchObject({ ok: false, code: 'unknown-attempt' });
    expect(journal.open()).toEqual([]);
    expect((await journal.begin(entry(2))).ok).toBe(true);
    expect(await journal.advance(uuid(502), { state: 'held', code: 'CG-SEND-STALE' })).toMatchObject({ ok: true, entry: { state: 'held', code: 'CG-SEND-STALE' } });
    expect(isOpenSendState('held')).toBe(false);
    expect(SEND_JOURNAL_OPEN_STATES).toEqual(['preparing', 'nativeEnqueued', 'nativeAccepted', 'uncertain']);
  });

  it('[RB-007] an uncertain attempt holds its fan until resolved: no TTL, no cap, no sign-out removes it', async () => {
    const { journal, clock, local } = setup({ deps: { limits: { finishedKept: 2 } } });
    await journal.begin(entry(1));
    await journal.advance(uuid(501), { state: 'nativeEnqueued', pendingId: 'p1' });
    await journal.advance(uuid(501), { state: 'uncertain', code: 'CG-SEND-UNCERTAIN' });
    expect(await journal.begin(entry(2))).toMatchObject({ ok: false, code: 'CG-SEND-UNCERTAIN', holder: uuid(501) });
    // Many finished attempts to other fans and a week later: the uncertain one stays.
    for (let n = 10; n < 15; n += 1) {
      await journal.begin(entry(n, { fanRef: `${7000 + n}` }));
      await journal.advance(uuid(500 + n), { state: 'notEnqueued' });
    }
    clock.advance(7 * DAY);
    expect(await journal.removeFinished()).toBe(2);
    expect(journal.list().map((item) => item.attemptId)).toEqual([uuid(501)]);
    expect(journal.stats()).toMatchObject({ open: 1, uncertain: 1, records: 1 });
    // Only the late linked pair or the hub's resolve ends it.
    expect(await journal.advance(uuid(501), { state: 'ready' })).toMatchObject({ ok: false, code: 'transition' });
    expect(await journal.release(uuid(501))).toBe(true);
    expect(await journal.release(uuid(501))).toBe(false);
    expect((await journal.begin(entry(3))).ok).toBe(true);
    expect(stored(local)?.entries.map((item) => item['attemptId'])).toEqual([uuid(503)]);
  });

  it('uncertain → sentObserved when the late second half of the linked pair arrives', async () => {
    const { journal } = setup();
    await journal.begin(entry(1));
    await journal.advance(uuid(501), { state: 'uncertain', code: 'CG-SEND-UNCERTAIN' });
    expect(await journal.advance(uuid(501), { state: 'sentObserved', platformMessageId: IDS.msg2 })).toMatchObject({ ok: true, entry: { state: 'sentObserved' } });
    expect(journal.open()).toEqual([]);
  });

  it('finished records are bounded by count and age', async () => {
    const { journal, clock } = setup({ deps: { limits: { finishedKept: 3 } } });
    expect(SEND_JOURNAL_LIMITS).toEqual({ finishedKept: 200, finishedTtlMs: DAY });
    for (let n = 1; n <= 5; n += 1) {
      await journal.begin(entry(n, { fanRef: `${8000 + n}` }));
      await journal.advance(uuid(500 + n), { state: 'held' });
    }
    expect(journal.list().map((item) => item.attemptId)).toEqual([uuid(503), uuid(504), uuid(505)]);
    clock.advance(DAY + 1);
    await journal.begin(entry(9));
    expect(journal.list().map((item) => item.attemptId)).toEqual([uuid(509)]);
  });

  it('an observed state whose write failed stays in memory and is written with the next change', async () => {
    const { journal, local, logs } = setup();
    await journal.begin(entry(1));
    local.failNext('set');
    expect(await journal.advance(uuid(501), { state: 'nativeEnqueued', pendingId: 'p1' })).toMatchObject({ ok: true, persisted: false });
    expect(journal.stats().dirty).toBe(true);
    expect(stored(local)?.entries[0]?.['state']).toBe('preparing');
    expect(logs.some((item) => item.msg === 'send state not saved')).toBe(true);
    await journal.advance(uuid(501), { state: 'nativeAccepted', platformMessageId: IDS.msg2 });
    expect(stored(local)?.entries[0]).toMatchObject({ state: 'nativeAccepted', pendingId: 'p1' });
    expect(journal.stats().dirty).toBe(false);
  });
});

describe('[X8-07] the journal after the background unloads or the browser restarts', () => {
  it('attempts left half-way become uncertain, once; uncertain and finished ones come back as they were', async () => {
    const first = setup();
    await first.journal.begin(entry(1));
    await first.journal.begin(entry(2, { fanRef: '7002' }));
    await first.journal.advance(uuid(502), { state: 'nativeEnqueued', pendingId: 'p2' });
    await first.journal.begin(entry(3, { fanRef: '7003' }));
    await first.journal.advance(uuid(503), { state: 'nativeEnqueued', pendingId: 'p3' });
    await first.journal.advance(uuid(503), { state: 'nativeAccepted', platformMessageId: IDS.msg1 });
    await first.journal.begin(entry(4, { fanRef: '7004' }));
    await first.journal.advance(uuid(504), { state: 'uncertain', code: 'CG-SEND-UNCERTAIN' });
    await first.journal.begin(entry(5, { fanRef: '7005' }));
    await first.journal.advance(uuid(505), { state: 'held', code: 'CG-SEND-STALE' });
    first.port.detach();

    const second = setup({ local: first.local, at: T0 + 60_000 });
    const writes = first.local.calls.set;
    const recovery = await second.journal.start();
    expect(recovery).toEqual({ readable: true, records: 5, madeUncertain: [uuid(501), uuid(502), uuid(503)], uncertain: 4, unparsed: 0 });
    expect(first.local.calls.set - writes).toBe(1);
    expect(second.journal.list().map((item) => [item.attemptId, item.state])).toEqual([
      [uuid(501), 'uncertain'],
      [uuid(502), 'uncertain'],
      [uuid(503), 'uncertain'],
      [uuid(504), 'uncertain'],
      [uuid(505), 'held'],
    ]);
    expect(second.journal.get(uuid(503))).toMatchObject({ code: 'CG-SEND-UNCERTAIN', platformMessageId: IDS.msg1, updatedAt: T0 + 60_000 });
    // Nothing is retried: the fans stay held.
    expect(await second.journal.begin(entry(6))).toMatchObject({ ok: false, code: 'CG-SEND-UNCERTAIN' });
    expect(second.logs.find((item) => item.code === 'CG-SEND-UNCERTAIN')?.fields).toEqual({ count: 3 });
    // A later start does not touch them again.
    second.port.detach();
    const third = setup({ local: first.local, at: T0 + 120_000 });
    expect((await third.journal.start()).madeUncertain).toEqual([]);
  });

  it('[RB-007] a record whose write confirmation was lost: no enqueue now, and after a restart it is uncertain — never resent', async () => {
    const first = setup();
    first.local.failNext('set', 'lost');
    expect(await first.journal.begin(entry(1))).toMatchObject({ ok: false, code: 'CG-STORAGE-WRITE' });
    // The write did land; this instance does not count it (no command went to MAIN).
    expect(stored(first.local)?.entries).toHaveLength(1);
    first.port.detach();
    const second = setup({ local: first.local });
    expect((await second.journal.start()).madeUncertain).toEqual([uuid(501)]);
    expect(await second.journal.begin(entry(2))).toMatchObject({ ok: false, code: 'CG-SEND-UNCERTAIN' });
  });

  it('a recovery that could not be written is still uncertain in memory', async () => {
    const local = createMemoryKv();
    local.data.set(KEY, { v: 1, entries: [entry(1)] });
    local.failNext('set');
    const { journal, logs } = setup({ local });
    expect((await journal.start()).madeUncertain).toEqual([uuid(501)]);
    expect(journal.stats()).toMatchObject({ uncertain: 1, dirty: true });
    expect(logs.some((item) => item.msg === 'send journal recovery not saved')).toBe(true);
  });
});

describe('a journal this build cannot read is never overwritten (§9.4)', () => {
  it('a failed read refuses every send until a read succeeds', async () => {
    const local = createMemoryKv();
    local.data.set(KEY, { v: 1, entries: [entry(1, { state: 'uncertain', code: 'CG-SEND-UNCERTAIN' })] });
    local.failNext('get');
    local.failNext('get');
    const { journal } = setup({ local });
    expect(await journal.start()).toMatchObject({ readable: false });
    expect(await journal.begin(entry(2, { fanRef: '7002' }))).toMatchObject({ ok: false, code: 'CG-STORAGE-READ' });
    expect(local.calls.set).toBe(0);
    expect(journal.stats()).toMatchObject({ available: false, mode: 'unreadable' });
    // Readable again: the uncertain record is there and still holds its fan.
    expect((await journal.begin(entry(3, { fanRef: '7003' }))).ok).toBe(true);
    expect(await journal.begin(entry(4))).toMatchObject({ ok: false, code: 'CG-SEND-UNCERTAIN' });
  });

  it('garbage and unknown versions are left untouched; a newer build’s journal is read-only (CG-STORAGE-VERSION)', async () => {
    for (const [value, code] of [
      ['garbage', 'CG-STORAGE-READ'],
      [{ v: 0, entries: [] }, 'CG-STORAGE-READ'],
      [{ v: 2, entries: [{ future: true }] }, 'CG-STORAGE-VERSION'],
    ] as const) {
      const local = createMemoryKv();
      local.data.set(KEY, value);
      const { journal } = setup({ local });
      expect(await journal.begin(entry(1))).toMatchObject({ ok: false, code });
      expect(await journal.removeFinished()).toBe(0);
      expect(await journal.release(uuid(501))).toBe(false);
      expect(local.read(KEY)).toEqual(value);
      expect(local.calls.set).toBe(0);
    }
    const local = createMemoryKv();
    local.data.set(KEY, { v: 2, entries: [] });
    const { journal } = setup({ local });
    await journal.start();
    expect(await journal.advance(uuid(501), { state: 'held' })).toMatchObject({ ok: false, code: 'CG-STORAGE-VERSION' });
  });

  it('records it cannot parse are kept verbatim and hold their fan — or every fan when even the fan is unreadable', async () => {
    const local = createMemoryKv();
    const foreign = { ...entry(1), state: 'someFutureState' };
    local.data.set(KEY, { v: 1, entries: [foreign] });
    const { journal, logs } = setup({ local });
    expect(await journal.start()).toMatchObject({ readable: true, records: 0, unparsed: 1 });
    expect(await journal.begin(entry(2))).toMatchObject({ ok: false, code: 'CG-SEND-UNCERTAIN' });
    expect((await journal.begin(entry(3, { fanRef: '7003' }))).ok).toBe(true);
    expect(stored(local)?.entries).toEqual([entry(3, { fanRef: '7003' }), foreign]);
    expect(journal.stats()).toMatchObject({ unparsed: 1, open: 2 });
    expect(logs.some((item) => item.msg.includes('not parsed'))).toBe(true);

    const blind = createMemoryKv();
    blind.data.set(KEY, { v: 1, entries: [{ attemptId: 'x' }] });
    const other = setup({ local: blind });
    expect(await other.journal.begin(entry(4, { fanRef: '7004' }))).toMatchObject({ ok: false, code: 'CG-SEND-UNCERTAIN' });
  });
});
