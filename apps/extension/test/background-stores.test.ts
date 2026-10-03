// The adapters of the background composition root between wave-1 packages
// that brought the same store twice (R07's stores, R10's and R18's ports):
// one writer per key, R07's guarantees kept.

import 'fake-indexeddb/auto';

import { journalEntry, opView } from '@cg/contracts/fixtures';
import type { LogRecord, OpView, SendJournalEntry } from '@cg/contracts';
import { OPS_STORE_KEY, createResultsStore, createSendJournal } from '@cg/core/services';
import { LogService } from '@cg/core/services/logs';
import { openBoundedStore } from '@cg/platform';
import { describe, expect, it } from 'vitest';

import { LOG_STORE_BOUNDS, logStoreOver } from '../src/composition/background/log-store.ts';
import { OPS_META_KEY, opsStoreOver } from '../src/composition/background/ops-store.ts';
import { sendJournalStoreOver } from '../src/composition/background/send-journal-store.ts';
import { memoryStore } from './support/memory-store.ts';

const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const SEND_KEY = 'send.journal';

describe('opsStoreOver — the scheduler journal on the results store', () => {
  const meta = (startedBy: string | null) => ({ startedBy, requestKey: 'rk', tag: { hubOrigin: 'https://hub.example.test', userId: 7, signInEpoch: 3, pageId: 11, personaKey: 'default', personaDefinitionId: 'pdef_0123456789abcdef' }, fanLabel: null, knownIds: [], checkpoint: null, split: false });
  const view = (n: number, over: Partial<OpView> = {}): OpView => ({ ...opView, opId: uuid(n), endedAt: Date.now(), ...over });
  const world = (data = new Map<string, unknown>()) => {
    const session = memoryStore('session', data);
    const results = createResultsStore({ session });
    return { session, results, store: opsStoreOver(results, session) };
  };

  it('[BG-004] one result per key through the results store, the run facts next to it; a new background reads them back', async () => {
    const data = new Map<string, unknown>();
    const first = world(data);
    await first.store.set(OPS_STORE_KEY, { v: 1, ops: [{ view: view(1), meta: meta('tab-a') }, { view: view(2), meta: meta(null) }] });
    expect([...data.keys()].sort()).toEqual([OPS_META_KEY, `result.${uuid(1)}`, `result.${uuid(2)}`, 'results.index'].sort());
    expect(first.results.stats().count).toBe(2);

    const second = world(data);
    const read = (await second.store.get(OPS_STORE_KEY)) as { v: number; ops: { view: OpView; meta: { startedBy: string | null } }[] };
    expect(read.v).toBe(1);
    expect(read.ops.map((op) => [op.view.opId, op.meta.startedBy]).sort()).toEqual([[uuid(1), 'tab-a'], [uuid(2), null]]);
    expect(read.ops.find((op) => op.view.opId === uuid(1))?.view.result).toEqual(opView.result);
  });

  it('writes only what changed: a phase change of one operation rewrites one result', async () => {
    const { session, store } = world();
    const a = view(1);
    const b = view(2);
    await store.set(OPS_STORE_KEY, { v: 1, ops: [{ view: a, meta: meta('t') }, { view: b, meta: meta('t') }] });
    const before = session.sets.length;
    await store.set(OPS_STORE_KEY, { v: 1, ops: [{ view: a, meta: meta('t') }, { view: b, meta: meta('t') }] });
    expect(session.sets.length).toBe(before);
    await store.set(OPS_STORE_KEY, { v: 1, ops: [{ view: a, meta: meta('t') }, { view: { ...b, stale: { reason: 'fan-wrote', at: null } }, meta: meta('t') }] });
    expect(session.sets.slice(before)).toEqual([[`result.${uuid(2)}`, 'results.index']]);
  });

  it('a result the scheduler dropped leaves the store; one it never saw stays for the sweep', async () => {
    const data = new Map<string, unknown>();
    const first = world(data);
    await first.store.set(OPS_STORE_KEY, { v: 1, ops: [{ view: view(1), meta: meta('t') }, { view: view(2), meta: meta('t') }] });
    await first.store.set(OPS_STORE_KEY, { v: 1, ops: [{ view: view(2), meta: meta('t') }] });
    expect(data.has(`result.${uuid(1)}`)).toBe(false);
    // A background that has not restored yet writes a new admission: older results are not its to remove.
    const second = world(data);
    await second.store.set(OPS_STORE_KEY, { v: 1, ops: [{ view: view(3, { state: 'admitted', phase: { name: 'admitted', since: 1 }, endedAt: undefined, result: undefined, text: undefined }), meta: meta('t') }] });
    expect(data.has(`result.${uuid(2)}`)).toBe(true);
    expect(data.has(`result.${uuid(3)}`)).toBe(true);
  });

  it('[RB-013] a failed write rejects (the scheduler then refuses the admission), and a view without its facts is not handed back', async () => {
    const data = new Map<string, unknown>();
    const { session, store } = world(data);
    session.failNextSet();
    await expect(store.set(OPS_STORE_KEY, { v: 1, ops: [{ view: view(1), meta: meta('t') }] })).rejects.toMatchObject({ name: 'StorageCallError', code: 'CG-STORAGE-WRITE' });
    await expect(store.set(OPS_STORE_KEY, { v: 2 })).rejects.toMatchObject({ code: 'CG-STORAGE-WRITE' });
    await store.set(OPS_STORE_KEY, { v: 1, ops: [{ view: view(1), meta: meta('t') }] });
    data.delete(OPS_META_KEY);
    expect(await world(data).store.get(OPS_STORE_KEY)).toBeUndefined();
    expect(await world(new Map()).store.get('other')).toBeUndefined();
  });

  it('after an unload a running operation comes back interrupted (the results store’s recovery)', async () => {
    const data = new Map<string, unknown>();
    const running = view(4, { state: 'streaming', phase: { name: 'streaming', since: 1 }, endedAt: undefined, result: undefined, text: undefined });
    await world(data).store.set(OPS_STORE_KEY, { v: 1, ops: [{ view: running, meta: meta('t') }] });
    const read = (await world(data).store.get(OPS_STORE_KEY)) as { ops: { view: OpView }[] };
    expect(read.ops.map((op) => [op.view.state, op.view.error?.code])).toEqual([['interrupted', 'CG-OP-INTERRUPTED']]);
  });
});

describe('sendJournalStoreOver — the coordinator journal on the send journal', () => {
  const entry = (n: number, over: Partial<SendJournalEntry> = {}): SendJournalEntry => ({ ...journalEntry, attemptId: uuid(n), fanRef: String(2000 + n), ...over });
  const world = (data = new Map<string, unknown>()) => {
    const local = memoryStore('local', data);
    const journal = createSendJournal({ local });
    return { local, journal, store: sendJournalStoreOver(journal) };
  };

  it('[X8-07] a new attempt is journaled before anything else; moves advance it; the value keeps the journal’s own format', async () => {
    const { store, journal, local } = world();
    expect(await store.get(SEND_KEY)).toEqual([]);
    await store.set(SEND_KEY, [entry(1)]);
    expect(journal.get(uuid(1))?.state).toBe('preparing');
    expect(local.data.get(SEND_KEY)).toMatchObject({ v: 1, entries: [{ attemptId: uuid(1), state: 'preparing' }] });
    await store.set(SEND_KEY, [entry(1, { state: 'nativeEnqueued', pendingId: 'p-1', updatedAt: journalEntry.updatedAt + 10 })]);
    expect(journal.get(uuid(1))).toMatchObject({ state: 'nativeEnqueued', pendingId: 'p-1' });
    // The same facts again: no write.
    const writes = local.sets.length;
    await store.set(SEND_KEY, [entry(1, { state: 'nativeEnqueued', pendingId: 'p-1', updatedAt: journalEntry.updatedAt + 99 })]);
    expect(local.sets.length).toBe(writes);
  });

  it('[X8-07] a record that did not save rejects: the coordinator holds instead of asking the hub', async () => {
    const { store, local, journal } = world();
    await store.get(SEND_KEY);
    local.failNextSet();
    await expect(store.set(SEND_KEY, [entry(1)])).rejects.toMatchObject({ name: 'StorageCallError', code: 'CG-STORAGE-WRITE' });
    expect(journal.get(uuid(1))).toBeNull();
    // A second open attempt to the same fan is refused by the journal itself.
    await store.set(SEND_KEY, [entry(1)]);
    await expect(store.set(SEND_KEY, [entry(1), entry(2, { fanRef: entry(1).fanRef })])).rejects.toMatchObject({ code: 'CG-SEND-BUSY' });
  });

  it('[RB-007] after an unload a half-way attempt is uncertain; it is released only when the coordinator that restored it drops it', async () => {
    const data = new Map<string, unknown>();
    const first = world(data);
    await first.store.set(SEND_KEY, [entry(1), entry(2)]);
    await first.store.set(SEND_KEY, [entry(1, { state: 'nativeEnqueued' }), entry(2)]);

    // A new background: a send that begins before the restore must not free anybody's fan.
    const early = world(data);
    await early.store.set(SEND_KEY, [entry(3)]);
    expect(early.journal.get(uuid(1))?.state).toBe('uncertain');
    expect(early.journal.get(uuid(2))?.state).toBe('uncertain');

    const second = world(data);
    const restored = (await second.store.get(SEND_KEY)) as SendJournalEntry[];
    expect(restored.map((item) => [item.attemptId, item.state]).sort()).toEqual([[uuid(1), 'uncertain'], [uuid(2), 'uncertain'], [uuid(3), 'uncertain']]);
    // The hub resolved attempt 1: the coordinator drops it, the journal releases its fan.
    await second.store.set(SEND_KEY, restored.filter((item) => item.attemptId !== uuid(1)));
    expect(second.journal.get(uuid(1))).toBeNull();
    expect(second.journal.get(uuid(2))?.state).toBe('uncertain');
    // The late linked pair ends an uncertain attempt as sent.
    await second.store.set(SEND_KEY, restored.filter((item) => item.attemptId !== uuid(1)).map((item) => (item.attemptId === uuid(2) ? { ...item, state: 'sentObserved' as const, platformMessageId: '4100' } : item)));
    expect(second.journal.get(uuid(2))).toMatchObject({ state: 'sentObserved', platformMessageId: '4100' });
  });
});

describe('logStoreOver — the log service on the bounded IndexedDB store', () => {
  const record = (seq: number, at: number): LogRecord => ({ ts: new Date(at).toISOString(), seq, level: 'info', scope: 'bg.test', msg: 'synthetic record' });
  const scheduler = { now: () => Date.now(), after: (_ms: number, fn: () => void) => (queueMicrotask(fn), () => undefined) };

  it('[LG-004] [LG-023] keeps the current log session and the two before it; the tail of the previous one is readable', async () => {
    const dbName = `cg-logs-test-${Math.random()}`;
    const open = () => openBoundedStore({ dbName, ...LOG_STORE_BOUNDS });
    let lastSession = 0;
    for (let run = 1; run <= 4; run += 1) {
      const logs = new LogService({ store: logStoreOver(open), scheduler });
      lastSession = await logs.open(null);
      expect(lastSession).toBe(run);
      for (let i = 0; i < 3; i += 1) logs.sink(record(i, Date.now()));
      await logs.flush();
      expect(logs.stats()).toMatchObject({ available: true, session: run, lost: 0 });
    }
    const logs = new LogService({ store: logStoreOver(open), scheduler });
    expect(await logs.open(lastSession)).toBe(4);
    expect(logs.stats()).toMatchObject({ sessions: 3, records: 9 });
    expect((await logs.recent(10)).map((item) => item.seq)).toEqual([0, 1, 2]);
    const previous = await logs.previousTail(2);
    expect(previous.session).toBe(3);
    expect(previous.records.map((item) => item.seq)).toEqual([1, 2]);
    await logs.clear();
    expect(logs.stats().records).toBe(0);
  });

  it('[LG-012] a store that will not open leaves the service in memory: unavailable, records counted as lost, nothing thrown', async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
    Object.defineProperty(globalThis, 'indexedDB', { value: undefined, configurable: true, writable: true });
    try {
      const logs = new LogService({ store: logStoreOver(() => openBoundedStore({ dbName: 'never', ...LOG_STORE_BOUNDS })), scheduler });
      await logs.open(null);
      logs.sink(record(1, Date.now()));
      await logs.flush();
      expect(logs.stats()).toMatchObject({ available: false, lost: 1 });
      expect(await logs.recent(5)).toEqual([]);
    } finally {
      if (original !== undefined) Object.defineProperty(globalThis, 'indexedDB', original);
    }
  });
});
