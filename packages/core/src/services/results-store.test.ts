import { opView, T0, target, uuid } from '@cg/contracts/fixtures';
import { chatKeyOf } from '@cg/contracts/ids';
import { OP_LIMITS, STORAGE_LIMITS } from '@cg/contracts/limits';
import type { OpState, OpView } from '@cg/contracts/ops';
import { describe, expect, it } from 'vitest';

import { RESULT_MAX_BYTES, SESSION_KEYS } from '../domain/storage';
import { createResultsStore, RESULTS_LIMITS, type ResultsStoreDeps } from './results-store';
import type { ServiceLogEntry } from './storage/ports';
import { createMemoryKv, manualClock, type MemoryKv } from './test-support/memory-kv';

const MINUTE = 60_000;
const view = (n: number, state: OpState = 'done', extra: Partial<OpView> = {}): OpView => {
  const running = state === 'admitted' || state === 'requesting' || state === 'streaming';
  const base: OpView = { ...opView, opId: uuid(1000 + n), state, ...extra };
  if (!running) return base;
  const { endedAt: _ended, result: _result, ...rest } = base;
  return { ...rest, phase: { name: 'streaming', since: T0 + 100 } };
};

function setup(options: { session?: MemoryKv; deps?: Partial<ResultsStoreDeps>; at?: number } = {}) {
  const session = options.session ?? createMemoryKv();
  const port = session.open();
  const clock = manualClock(options.at ?? T0);
  const logs: ServiceLogEntry[] = [];
  const store = createResultsStore({ session: port, clock, log: (entry) => logs.push(entry), ...options.deps });
  return { session, port, clock, logs, store };
}

describe('results in storage.session (§7 «Жизнь в фоне», §9.4)', () => {
  it('keeps the stated limits: 24 per tab, 4 MiB, 30 minutes', () => {
    expect(RESULTS_LIMITS).toEqual({ perTab: 24, totalBytes: 4 * 1024 * 1024, ttlMs: 30 * MINUTE, listMax: STORAGE_LIMITS.opListMax });
    expect(RESULTS_LIMITS.ttlMs).toBe(OP_LIMITS.resultTtlMs);
  });

  it('[AI-128] a result and its index are ONE set; it reads back by id and by chat', async () => {
    const { session, store } = setup();
    await store.start();
    const before = session.calls.set;
    expect(await store.put(view(1), { tabSessionId: 'tab-a' })).toEqual({ ok: true, evicted: [] });
    expect(session.calls.set - before).toBe(1);
    expect(await store.get(uuid(1001))).toEqual(view(1));
    expect(await store.get(uuid(9999))).toBeNull();
    const listed = await store.list({ scope: 'tab', tabSessionId: 'tab-a', chatKey: chatKeyOf(target.chat) });
    expect(listed).toEqual({ ops: [view(1)], truncated: false });
    expect(await store.list({ scope: 'tab', tabSessionId: 'tab-b' })).toEqual({ ops: [], truncated: false });
    // A later save of the same operation keeps its first owner (the tab may be gone).
    await store.put(view(1, 'done', { text: 'updated' }), { tabSessionId: null });
    expect((await store.list({ scope: 'tab', tabSessionId: 'tab-a' })).ops[0]?.text).toBe('updated');
    expect(store.stats().count).toBe(1);
  });

  it('[AI-124] up to 24 per tab: the oldest finished result of that tab goes first, a running one last', async () => {
    const { store, clock } = setup();
    await store.put(view(0, 'streaming'), { tabSessionId: 'tab-a' });
    for (let n = 1; n <= 23; n += 1) {
      clock.advance(1000);
      await store.put(view(n), { tabSessionId: 'tab-a' });
    }
    await store.put(view(100), { tabSessionId: 'tab-b' });
    clock.advance(1000);
    const result = await store.put(view(24), { tabSessionId: 'tab-a' });
    expect(result).toEqual({ ok: true, evicted: [uuid(1001)] });
    const own = await store.list({ scope: 'tab', tabSessionId: 'tab-a' });
    expect(own.ops).toHaveLength(24);
    expect(own.ops.some((op) => op.opId === uuid(1000))).toBe(true);
    expect((await store.list({ scope: 'tab', tabSessionId: 'tab-b' })).ops).toHaveLength(1);
    expect(await store.get(uuid(1001))).toBeNull();
  });

  it('up to 4 MiB for the whole extension: finished results are evicted oldest first, across tabs', async () => {
    const { store, clock } = setup();
    const big = '€'.repeat(64_000);
    const evicted: string[] = [];
    for (let n = 0; n < 26; n += 1) {
      clock.advance(1000);
      const put = await store.put(view(n, 'done', { text: big }), { tabSessionId: n % 2 === 0 ? 'tab-a' : 'tab-b' });
      expect(put.ok).toBe(true);
      if (put.ok) evicted.push(...put.evicted);
    }
    expect(store.stats().bytes).toBeLessThanOrEqual(4 * 1024 * 1024);
    expect(evicted.length).toBeGreaterThan(0);
    expect(evicted[0]).toBe(uuid(1000));
    expect(await store.get(uuid(1025))).not.toBeNull();
  });

  it('one result over its budget is CG-STORAGE-FULL; an invalid view is refused; a failed write keeps the index', async () => {
    const { store, session } = setup();
    expect(RESULT_MAX_BYTES).toBe(512 * 1024);
    // Within the schema (64k characters each), over the byte budget once escaped as JSON.
    const escaped = '\u0001'.repeat(64_000);
    const huge = view(1, 'done', { text: escaped, result: { kind: 'review', doc: null, raw: escaped } });
    expect(await store.put(huge, { tabSessionId: 'tab-a' })).toMatchObject({ ok: false, code: 'CG-STORAGE-FULL' });
    expect(await store.put({ ...view(2), opId: 'not-a-uuid' }, { tabSessionId: 'tab-a' })).toMatchObject({ ok: false, code: 'CG-STORAGE-WRITE' });
    session.failNext('set', 'full');
    expect(await store.put(view(3), { tabSessionId: 'tab-a' })).toMatchObject({ ok: false, code: 'CG-STORAGE-FULL' });
    expect(store.stats().count).toBe(0);
    expect(await store.put(view(4), { tabSessionId: 'tab-a' })).toEqual({ ok: true, evicted: [] });
  });

  it('a result lives 30 minutes after its last save: hidden, swept, and evicted on the next save', async () => {
    const { store, clock, session } = setup();
    await store.put(view(1), { tabSessionId: 'tab-a' });
    clock.advance(10 * MINUTE);
    await store.put(view(2), { tabSessionId: 'tab-a' });
    clock.advance(20 * MINUTE + 1);
    expect((await store.list({ scope: 'all' })).ops.map((op) => op.opId)).toEqual([uuid(1002)]);
    expect(await store.sweep()).toBe(1);
    expect(session.read(`${SESSION_KEYS.resultPrefix}${uuid(1001)}`)).toBeUndefined();
    expect(await store.sweep()).toBe(0);
    clock.advance(10 * MINUTE);
    expect(await store.put(view(3), { tabSessionId: 'tab-b' })).toEqual({ ok: true, evicted: [uuid(1002)] });
  });

  it('op.list «all» is newest first, capped and flagged truncated', async () => {
    const { store, clock } = setup({ deps: { limits: { listMax: 2 } } });
    for (let n = 1; n <= 3; n += 1) {
      clock.advance(1000);
      await store.put(view(n), { tabSessionId: `tab-${n}` });
    }
    const all = await store.list({ scope: 'all' });
    expect(all.ops.map((op) => op.opId)).toEqual([uuid(1003), uuid(1002)]);
    expect(all.truncated).toBe(true);
  });

  it('a persona change drops a page’s results; sign-out drops everything', async () => {
    const { store, session } = setup();
    const otherPage = { ...target, binding: { ...target.binding, pageId: 12 } };
    await store.put(view(1), { tabSessionId: 'tab-a' });
    await store.put(view(2, 'done', { target: otherPage }), { tabSessionId: 'tab-a' });
    expect(await store.removeWhere((meta) => meta.pageId === 12)).toBe(1);
    expect(await store.removeWhere((meta) => meta.pageId === 99)).toBe(0);
    expect((await store.list({ scope: 'all' })).ops.map((op) => op.opId)).toEqual([uuid(1001)]);
    expect(await store.clear()).toBe(true);
    expect(store.stats()).toEqual({ count: 0, bytes: 0 });
    expect([...session.data.keys()]).toEqual([]);
  });

  it('a result key that could not be removed is removed with a later change', async () => {
    const { store, session } = setup({ deps: { limits: { perTab: 1 } } });
    await store.put(view(1), { tabSessionId: 'tab-a' });
    session.failNext('remove');
    await store.put(view(2), { tabSessionId: 'tab-a' });
    expect(session.read(`${SESSION_KEYS.resultPrefix}${uuid(1001)}`)).toBeDefined();
    await store.sweep();
    expect(session.read(`${SESSION_KEYS.resultPrefix}${uuid(1001)}`)).toBeUndefined();
  });
});

describe('[BG-004] results after the background unloads', () => {
  it('finished results come back; expired ones and unreadable running ones go', async () => {
    const first = setup();
    await first.store.put(view(1), { tabSessionId: 'tab-a' });
    await first.store.put(view(2, 'streaming'), { tabSessionId: 'tab-a' });
    first.clock.advance(20 * MINUTE);
    await first.store.put(view(3), { tabSessionId: 'tab-b' });
    await first.store.put(view(4, 'requesting'), { tabSessionId: 'tab-b' });
    first.port.detach();
    expect(first.session.read<{ v: 1; entries: unknown[] }>(SESSION_KEYS.resultsIndex)?.entries).toHaveLength(4);
    // A broken running record cannot be shown as interrupted: it goes.
    first.session.data.set(`${SESSION_KEYS.resultPrefix}${uuid(1004)}`, { broken: true });

    const second = setup({ session: first.session, at: T0 + 31 * MINUTE });
    expect(await second.store.start()).toEqual({ restored: 1, interrupted: [], expired: 2, readable: true });
    expect((await second.store.list({ scope: 'all' })).ops.map((op) => op.opId)).toEqual([uuid(1003)]);
    for (const n of [1001, 1002, 1004]) expect(first.session.read(`${SESSION_KEYS.resultPrefix}${uuid(n)}`)).toBeUndefined();
  });

  it('[RB-003] an operation cut by the restart is `interrupted` with CG-OP-INTERRUPTED, no new request', async () => {
    const first = setup();
    await first.store.put(view(1, 'streaming'), { tabSessionId: 'tab-a' });
    await first.store.put(view(2), { tabSessionId: 'tab-a' });
    first.port.detach();
    const second = setup({ session: first.session, at: T0 + 5000 });
    const recovery = await second.store.start();
    expect(recovery).toEqual({ restored: 2, interrupted: [uuid(1001)], expired: 0, readable: true });
    const cut = await second.store.get(uuid(1001));
    expect(cut).toMatchObject({ state: 'interrupted', phase: { name: 'settled', since: T0 + 5000 }, endedAt: T0 + 5000, error: { code: 'CG-OP-INTERRUPTED' } });
    expect(second.logs.find((entry) => entry.code === 'CG-OP-INTERRUPTED')?.fields).toEqual({ count: 1 });
    // A second start is the same run: it answers the first report and touches nothing.
    const writes = first.session.calls.set;
    expect(await second.store.start()).toBe(recovery);
    expect(first.session.calls.set).toBe(writes);
  });

  it('[RB-003] start is idempotent: this background\'s own running operation is never interrupted by a second start', async () => {
    const { store } = setup();
    await store.start();
    await store.put(view(1, 'streaming'), { tabSessionId: 'tab-a' });
    expect((await store.start()).interrupted).toEqual([]);
    expect(await store.get(uuid(1001))).toMatchObject({ state: 'streaming' });
  });

  it('[RB-003] start\'s read failed: the first later read still interrupts what the previous background left running', async () => {
    const first = setup();
    await first.store.put(view(1, 'streaming'), { tabSessionId: 'tab-a' });
    first.port.detach();
    first.session.failNext('get');
    const second = setup({ session: first.session, at: T0 + 5000 });
    expect(await second.store.start()).toEqual({ restored: 0, interrupted: [], expired: 0, readable: false });
    expect(await second.store.get(uuid(1001))).toMatchObject({ state: 'interrupted', error: { code: 'CG-OP-INTERRUPTED' } });
    // This background's own new operation is not touched by that recovery.
    await second.store.put(view(2, 'streaming'), { tabSessionId: 'tab-a' });
    expect(await second.store.get(uuid(1002))).toMatchObject({ state: 'streaming' });
    expect(second.logs.find((entry) => entry.code === 'CG-OP-INTERRUPTED')?.fields).toEqual({ count: 1 });
  });

  it('an unreadable index is reported; the cache starts over on the next save', async () => {
    const session = createMemoryKv();
    session.failNext('get');
    const { store, logs } = setup({ session });
    expect(await store.start()).toEqual({ restored: 0, interrupted: [], expired: 0, readable: false });
    session.data.set(SESSION_KEYS.resultsIndex, 'garbage');
    expect(await store.put(view(1), { tabSessionId: 'tab-a' })).toEqual({ ok: true, evicted: [] });
    expect(logs.some((entry) => entry.msg.includes('unreadable'))).toBe(true);
  });

  const resultKeys = (session: MemoryKv): string[] => [...session.data.keys()].filter((key) => key.startsWith(SESSION_KEYS.resultPrefix)).sort();

  it('an index read that fails on a save: the keys the lost index named are found by a listing and removed', async () => {
    const first = setup();
    for (let n = 1; n <= 5; n += 1) await first.store.put(view(n), { tabSessionId: 'tab-a' });
    first.port.detach();
    first.session.failNext('get');
    const second = setup({ session: first.session });
    expect(await second.store.put(view(6), { tabSessionId: 'tab-a' })).toEqual({ ok: true, evicted: [] });
    expect(resultKeys(first.session)).toEqual([`${SESSION_KEYS.resultPrefix}${uuid(1006)}`]);
    expect(second.store.stats().count).toBe(1);
    expect(second.logs.find((entry) => entry.msg === 'results the lost index named are removed')?.fields).toEqual({ count: 5 });
  });

  it('an index that cannot be parsed: its result keys go at once; a failed listing is retried by the next sweep', async () => {
    const session = createMemoryKv();
    for (let n = 1; n <= 3; n += 1) session.data.set(`${SESSION_KEYS.resultPrefix}${uuid(1000 + n)}`, view(n));
    session.data.set(SESSION_KEYS.resultsIndex, { v: 9 });
    const { store } = setup({ session });
    expect(await store.start()).toEqual({ restored: 0, interrupted: [], expired: 0, readable: true });
    expect(resultKeys(session)).toEqual([]);

    const later = createMemoryKv();
    later.data.set(`${SESSION_KEYS.resultPrefix}${uuid(1001)}`, view(1));
    later.data.set(SESSION_KEYS.resultsIndex, 'garbage');
    later.failNext('keys');
    const other = setup({ session: later });
    await other.store.start();
    expect(resultKeys(later)).toHaveLength(1);
    await other.store.sweep();
    expect(resultKeys(later)).toEqual([]);
  });

  it('clear removes every result key of the area, even when the index could not be read', async () => {
    const first = setup();
    for (let n = 1; n <= 3; n += 1) await first.store.put(view(n), { tabSessionId: 'tab-a' });
    first.port.detach();
    first.session.failNext('get');
    const second = setup({ session: first.session });
    expect(await second.store.clear()).toBe(true);
    expect([...first.session.data.keys()]).toEqual([]);
  });

  it('after a browser restart storage.session is empty: nothing to restore', async () => {
    const first = setup();
    await first.store.put(view(1), { tabSessionId: 'tab-a' });
    first.session.wipe();
    const second = setup({ session: first.session });
    expect(await second.store.start()).toEqual({ restored: 0, interrupted: [], expired: 0, readable: true });
  });
});
