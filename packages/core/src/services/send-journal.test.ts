import { IDS, journalEntry, T0, uuid } from '@cg/contracts/fixtures';
import { sendLockKey, type SendJournalEntry } from '@cg/contracts/send';
import { STORAGE_KEYS } from '@cg/contracts/settings';
import { describe, expect, it } from 'vitest';

import { createSendJournal, isOpenSendState, SEND_JOURNAL_OPEN_STATES, type SendJournalDeps } from './send-journal';
import type { ServiceLogEntry } from './storage/ports';
import { createMemoryKv, manualClock, settle, type MemoryKv } from './test-support/memory-kv';

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
    // The same state again only adds facts; an observed id is never replaced by another.
    expect(await journal.advance(uuid(501), { state: 'nativeAccepted' })).toMatchObject({ ok: true, entry: { state: 'nativeAccepted' } });
    expect(await journal.advance(uuid(501), { state: 'nativeAccepted', platformMessageId: IDS.msg1 })).toMatchObject({ ok: false, code: 'transition', detail: 'platformMessageId already set' });
    expect(await journal.advance(uuid(501), { state: 'sentObserved', pendingId: 'pending-2' })).toMatchObject({ ok: false, code: 'transition', detail: 'pendingId already set' });
    expect(await journal.advance(uuid(501), { state: 'sentObserved', platformMessageId: IDS.msg2 })).toMatchObject({ ok: true, entry: { state: 'sentObserved' } });
    // A finished record is final: no same-state rewrite either.
    expect(await journal.advance(uuid(501), { state: 'sentObserved', platformMessageId: IDS.msg1 })).toMatchObject({ ok: false, code: 'transition' });
    expect(await journal.advance(uuid(501), { state: 'sentObserved' })).toMatchObject({ ok: false, code: 'transition' });
    expect(journal.get(uuid(501))).toMatchObject({ state: 'sentObserved', platformMessageId: IDS.msg2 });
    expect(await journal.advance(uuid(501), { state: 'ready' })).toMatchObject({ ok: false, code: 'transition' });
    expect(await journal.advance(uuid(999), { state: 'held' })).toMatchObject({ ok: false, code: 'unknown-attempt' });
    expect(journal.open()).toEqual([]);
    // A finished attempt journaled again (a repeated call with its id) is never a second enqueue permit.
    expect(await journal.begin(entry(1))).toMatchObject({ ok: false, code: 'CG-SEND-BUSY', holder: uuid(501) });
    expect((await journal.begin(entry(2))).ok).toBe(true);
    expect(await journal.advance(uuid(502), { state: 'held', code: 'CG-SEND-STALE' })).toMatchObject({ ok: true, entry: { state: 'held', code: 'CG-SEND-STALE' } });
    expect(await journal.advance(uuid(502), { state: 'held', code: 'CG-SEND-FRESHNESS' })).toMatchObject({ ok: false, code: 'transition' });
    expect(isOpenSendState('held')).toBe(false);
    expect(SEND_JOURNAL_OPEN_STATES).toEqual(['preparing', 'nativeEnqueued', 'nativeAccepted', 'uncertain']);
  });

  it('[RB-007] an uncertain attempt stays until resolved — no TTL, no cap, no sign-out removes it — but holds its fan no longer (audit 2026-10-20, row 2)', async () => {
    const { journal, clock, local } = setup({ deps: { limits: { finishedKept: 2 } } });
    await journal.begin(entry(1));
    await journal.advance(uuid(501), { state: 'nativeEnqueued', pendingId: 'p1' });
    await journal.advance(uuid(501), { state: 'uncertain', code: 'CG-SEND-UNCERTAIN' });
    // The person's new click to the same fan is journaled beside it.
    expect((await journal.begin(entry(2))).ok).toBe(true);
    await journal.advance(uuid(502), { state: 'notEnqueued' });
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
    expect(await journal.release(uuid(501))).toEqual({ ok: true });
    expect(await journal.release(uuid(501))).toEqual({ ok: false, reason: 'unknown-attempt' });
    expect((await journal.begin(entry(3))).ok).toBe(true);
    expect(stored(local)?.entries.map((item) => item['attemptId'])).toEqual([uuid(503)]);
  });

  it('[RB-007] release is only for an uncertain attempt: a live one keeps its fan (§6.7.7 п. 6)', async () => {
    const { journal, local, logs } = setup();
    await journal.begin(entry(1));
    expect(await journal.release(uuid(501))).toEqual({ ok: false, reason: 'not-uncertain' });
    await journal.advance(uuid(501), { state: 'nativeEnqueued', pendingId: 'p1' });
    expect(await journal.release(uuid(501))).toEqual({ ok: false, reason: 'not-uncertain' });
    await journal.advance(uuid(501), { state: 'nativeAccepted', platformMessageId: IDS.msg2 });
    expect(await journal.release(uuid(501))).toEqual({ ok: false, reason: 'not-uncertain' });
    expect(await journal.begin(entry(2))).toMatchObject({ ok: false, code: 'CG-SEND-BUSY', holder: uuid(501) });
    expect(journal.open().map((item) => item.attemptId)).toEqual([uuid(501)]);
    expect(logs.filter((item) => item.msg.startsWith('release refused'))).toHaveLength(3);
    // A release whose write fails keeps the record.
    await journal.advance(uuid(501), { state: 'uncertain', code: 'CG-SEND-UNCERTAIN' });
    local.failNext('set');
    expect(await journal.release(uuid(501))).toEqual({ ok: false, reason: 'CG-STORAGE-WRITE' });
    expect(journal.open()).toHaveLength(1);
  });

  it('uncertain → sentObserved when the late second half of the linked pair arrives', async () => {
    const { journal } = setup();
    await journal.begin(entry(1));
    await journal.advance(uuid(501), { state: 'uncertain', code: 'CG-SEND-UNCERTAIN' });
    expect(await journal.advance(uuid(501), { state: 'sentObserved', platformMessageId: IDS.msg2 })).toMatchObject({ ok: true, entry: { state: 'sentObserved' } });
    expect(journal.open()).toEqual([]);
  });
});

describe('[TL-004] [NF-019] a part the person sent themselves is a finished record, never an attempt (§6.6)', () => {
  const delivered = (n: number, extra: Partial<SendJournalEntry> = {}): SendJournalEntry => entry(n, { state: 'sentObserved', platformMessageId: IDS.msg2, documentEpoch: 'native-send', ...extra });

  it('it is written finished in ONE set: never `preparing`, it holds no fan and the fan’s next attempt begins', async () => {
    const { local, journal } = setup();
    await journal.start();
    const before = local.calls.set;
    expect(await journal.record(delivered(1))).toEqual({ ok: true, entry: delivered(1), persisted: true });
    expect(local.calls.set - before).toBe(1);
    expect(stored(local)?.entries).toEqual([delivered(1)]);
    expect(journal.open()).toEqual([]);
    expect(journal.stats()).toMatchObject({ records: 1, open: 0, uncertain: 0, dirty: false });
    // The same fan, the next part: nothing holds it.
    expect((await journal.begin(entry(2))).ok).toBe(true);
    // Told again (the tab repeats a report): one record, no write.
    const writes = local.calls.set;
    expect(await journal.record(delivered(1))).toMatchObject({ ok: true, entry: { attemptId: uuid(501) } });
    expect(local.calls.set).toBe(writes);
    expect(journal.list().map((item) => [item.attemptId, item.state])).toEqual([[uuid(501), 'sentObserved'], [uuid(502), 'preparing']]);
  });

  it('only a proven delivery is taken: any other state, or no message id, is refused and nothing is written', async () => {
    const { local, journal } = setup();
    await journal.start();
    const before = local.calls.set;
    for (const state of ['preparing', 'nativeEnqueued', 'nativeAccepted', 'uncertain', 'held', 'notEnqueued', 'rejected'] as const) {
      expect(await journal.record(entry(1, { state, platformMessageId: IDS.msg2 }))).toMatchObject({ ok: false, code: 'transition' });
    }
    expect(await journal.record(entry(1, { state: 'sentObserved' }))).toMatchObject({ ok: false, code: 'transition' });
    expect(await journal.record({ ...delivered(1), attemptId: 'nope' })).toMatchObject({ ok: false, code: 'transition' });
    expect(local.calls.set).toBe(before);
    expect(journal.list()).toEqual([]);
  });

  it('an attempt of ours is never rewritten by it: an open attempt under that id keeps its state and its fan', async () => {
    const { journal } = setup();
    await journal.begin(entry(1));
    expect(await journal.record(delivered(1))).toMatchObject({ ok: false, code: 'transition' });
    expect(journal.get(uuid(501))?.state).toBe('preparing');
    expect(journal.open().map((item) => item.attemptId)).toEqual([uuid(501)]);
    // Another message id under a delivered record's id is another message: refused too.
    expect((await journal.record(delivered(2, { fanRef: IDS.otherFan }))).ok).toBe(true);
    expect(await journal.record(delivered(2, { fanRef: IDS.otherFan, platformMessageId: '987654' }))).toMatchObject({ ok: false, code: 'transition' });
  });

  it('after an unload it is still delivered — never «неизвестно, ушло ли»; it ages out with the finished records', async () => {
    const first = setup();
    await first.journal.record(delivered(1));
    const second = setup({ local: first.local });
    expect(await second.journal.start()).toMatchObject({ readable: true, records: 1, madeUncertain: [], uncertain: 0 });
    expect(second.journal.get(uuid(501))).toEqual(delivered(1));
    second.clock.advance(DAY + 1);
    await second.journal.begin(entry(9));
    expect(second.journal.list().map((item) => item.attemptId)).toEqual([uuid(509)]);
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
    // Nothing is retried by itself; the fans are not held (row 2): a person's new click is journaled.
    expect((await second.journal.begin(entry(6))).ok).toBe(true);
    await second.journal.advance(uuid(506), { state: 'notEnqueued' });
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
    // Never resent by itself; the person's own new click is a new attempt (row 2).
    expect(second.journal.get(uuid(501))).toMatchObject({ state: 'uncertain' });
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

describe('[RB-007] the key removed or overwritten outside the journal', () => {
  it('«Очистить локальные данные» (the key removed): open and uncertain records are written back at once, finished ones may go', async () => {
    const { journal, local, logs, port } = setup();
    await journal.begin(entry(1));
    await journal.advance(uuid(501), { state: 'uncertain', code: 'CG-SEND-UNCERTAIN' });
    await journal.begin(entry(2, { fanRef: '7002' }));
    await journal.begin(entry(3, { fanRef: '7003' }));
    await journal.advance(uuid(503), { state: 'held' });
    await settle(10);
    local.external(KEY, undefined);
    await settle(20);
    expect(stored(local)?.entries.map((item) => [item['attemptId'], item['state']])).toEqual([
      [uuid(501), 'uncertain'],
      [uuid(502), 'preparing'],
      [uuid(503), 'held'],
    ]);
    expect(logs.find((item) => item.msg === 'send journal removed outside: open records written back')?.fields).toEqual({ open: 2, saved: true });
    // The event page unloads right after: the next one still has both records.
    journal.dispose();
    port.detach();
    const next = setup({ local });
    expect((await next.journal.start()).records).toBeGreaterThanOrEqual(2);
  });

  it('a value that dropped an open record is rewritten; a late echo of an own write is not a removal', async () => {
    const { journal, local } = setup();
    await journal.start();
    local.holdEvents();
    await journal.begin(entry(1));
    await journal.begin(entry(2, { fanRef: '7002' }));
    const writes = local.calls.set;
    const reads = local.calls.get;
    local.releaseEvents();
    await settle(20);
    // The first echo lacks attempt 2 (it predates it): the store is read again, holds both — no write.
    expect(local.calls.get).toBe(reads + 1);
    expect(local.calls.set).toBe(writes);
    local.external(KEY, { v: 1, entries: [] });
    await settle(20);
    expect(stored(local)?.entries.map((item) => item['attemptId'])).toEqual([uuid(501), uuid(502)]);
  });

  it('an outside value this build cannot read is left untouched and refuses sends; a failed re-read waits for the next change', async () => {
    for (const [value, mode, code] of [
      [{ v: 2, entries: [] }, 'newer', 'CG-STORAGE-VERSION'],
      ['garbage', 'unreadable', 'CG-STORAGE-READ'],
    ] as const) {
      const { journal, local } = setup();
      await journal.begin(entry(1));
      local.external(KEY, value);
      await settle(20);
      expect(local.read(KEY)).toEqual(value);
      expect(journal.stats().mode).toBe(mode);
      expect(await journal.begin(entry(2, { fanRef: '7002' }))).toMatchObject({ ok: false, code });
    }
    const { journal, local, logs } = setup();
    await journal.begin(entry(1));
    local.failNext('get');
    local.external(KEY, undefined);
    await settle(20);
    expect(journal.stats().dirty).toBe(true);
    expect(logs.some((item) => item.code === 'CG-STORAGE-READ' && item.msg.includes('changed outside'))).toBe(true);
    // The next change writes the whole journal again.
    await journal.advance(uuid(501), { state: 'nativeEnqueued', pendingId: 'p1' });
    expect(stored(local)?.entries.map((item) => item['attemptId'])).toEqual([uuid(501)]);
  });

  it('unparsed records are part of what must survive an outside overwrite', async () => {
    const local = createMemoryKv();
    const foreign = { ...entry(1), state: 'someFutureState' };
    local.data.set(KEY, { v: 1, entries: [foreign] });
    const { journal } = setup({ local });
    await journal.start();
    local.external(KEY, { v: 1, entries: [] });
    await settle(20);
    expect(stored(local)?.entries).toEqual([foreign]);
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
    // Readable again: the uncertain record is there (it holds its fan no longer, row 2).
    expect((await journal.begin(entry(3, { fanRef: '7003' }))).ok).toBe(true);
    expect(journal.get(uuid(501))).toMatchObject({ state: 'uncertain' });
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
      expect(await journal.release(uuid(501))).toEqual({ ok: false, reason: 'unavailable' });
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
