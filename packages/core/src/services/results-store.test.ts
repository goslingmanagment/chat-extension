import { opView, T0, target, uuid } from '@cg/contracts/fixtures';
import { chatKeyOf } from '@cg/contracts/ids';
import type { OpState, OpView } from '@cg/contracts/ops';
import { describe, expect, it } from 'vitest';

import { createResultsStore, type ResultsStoreDeps } from './results-store';
import type { ServiceLogEntry } from './storage/ports';
import { createMemoryKv, manualClock, type MemoryKv } from './test-support/memory-kv';

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
});

describe('[BG-004] results after the background unloads', () => {
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
});
