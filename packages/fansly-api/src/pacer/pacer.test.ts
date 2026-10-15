import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiWorld } from '../test-world';
import { FanslyPacer } from './pacer';
import { BAD_MEMORY_MS, fresh, healed, limited, rested } from './controller';
import { paceFor } from './policy';

const signal = () => new AbortController().signal;
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000_000); });
afterEach(() => vi.useRealTimers());

describe('Fansly pacer E130–E135', () => {
  it('[RB-023] one FIFO per creator, independent creators; aborting a waiter never lets a successor overtake', async () => {
    const w = apiWorld(); const p = new FanslyPacer({ ...w, random: () => 0 });
    const first = await p.acquire('100', 'GET', '/api/v1/group/1', 'queue', signal());
    const cancel = new AbortController();
    const middle = p.acquire('100', 'GET', '/api/v1/group/2', 'queue', cancel.signal).catch(() => 'aborted');
    let reached = false;
    const last = p.acquire('100', 'GET', '/api/v1/group/3', 'queue', signal()).then((permit) => { reached = true; return permit; });
    cancel.abort(); await middle; await vi.advanceTimersByTimeAsync(5000); expect(reached).toBe(false);
    const independent = await p.acquire('200', 'GET', '/api/v1/group/1', 'queue', signal()); independent.release();
    first.release(); (await last).release(); expect(reached).toBe(true);
  });
  it('[RB-023] /account* shares the slow five-second family; jitter rides the binding deadline', async () => {
    const w = apiWorld(); const p = new FanslyPacer({ ...w, random: () => 1 - Number.EPSILON });
    (await p.acquire('100', 'GET', '/api/v1/account/100/followersnew', 'queue', signal())).release();
    let reached = false;
    const next = p.acquire('10', 'GET', '/api/v1/account', 'queue', signal()).then((permit) => { reached = true; return permit; });
    await vi.advanceTimersByTimeAsync(5099); expect(reached).toBe(false);
    await vi.advanceTimersByTimeAsync(1); (await next).release(); expect(reached).toBe(true);
  });
  it('[NF-037] foreign 429 closes the creator across tabs; null attribution closes even creators learned after wake', async () => {
    const w = apiWorld(); w.facts.push({ requestId: 'foreign', accountId: '100', source: 'page', at: Date.now() });
    let p = new FanslyPacer(w); await p.sync();
    await expect(p.acquire('10', 'GET', '/api/v1/group/1', 'cooldown', signal())).rejects.toMatchObject({ code: 'CG-FAN-RATE-LIMIT' });
    (await p.acquire('200', 'GET', '/api/v1/group/1', 'cooldown', signal())).release();
    w.facts.push({ requestId: 'unknown', accountId: null, source: 'unknown', at: Date.now() }); await p.sync();
    p = new FanslyPacer(w); await p.sync();
    await expect(p.acquire('999', 'GET', '/api/v1/group/1', 'cooldown', signal())).rejects.toMatchObject({ code: 'CG-FAN-RATE-LIMIT' });
    expect(p.status('100').level).toBe(1);
  });
  it('[NF-037] a later foreign 429 extends a sleeping queue; POST /group refuses cooling immediately', async () => {
    const w = apiWorld(); const p = new FanslyPacer({ ...w, random: () => 0 });
    (await p.acquire('100', 'GET', '/api/v1/group/1', 'queue', signal())).release();
    let reached = false;
    const next = p.acquire('100', 'GET', '/api/v1/group/2', 'queue', signal()).then((permit) => { reached = true; return permit; });
    await vi.advanceTimersByTimeAsync(250);
    w.facts.push({ requestId: 'f', accountId: '100', source: 'page', at: Date.now() });
    await vi.advanceTimersByTimeAsync(250); expect(reached).toBe(false);
    await expect(p.acquire('100', 'POST', '/api/v1/group', 'queue', signal())).rejects.toMatchObject({ code: 'CG-FAN-RATE-LIMIT', phase: 'before-dispatch' });
    await vi.advanceTimersByTimeAsync(29_750); (await next).release(); expect(reached).toBe(true);
  });
  it('deduplicates the same 429 across restores; a later Retry-After extends without doubling or recounting', async () => {
    const w = apiWorld(); const countLimit = vi.fn(); let p = new FanslyPacer({ ...w, countLimit });
    const fact = { requestId: 'same', accountId: '100', source: 'own' as const, at: Date.now() };
    w.facts.push(fact); await p.sync(); w.facts[0] = { ...fact, retryAfterMs: 120_000 }; await p.sync();
    expect(p.status('100')).toMatchObject({ level: 1, cooldownUntil: Date.now() + 120_000 }); expect(countLimit).toHaveBeenCalledTimes(1);
    p = new FanslyPacer({ ...w, countLimit }); await p.sync(); expect(p.status('100').level).toBe(1); expect(countLimit).toHaveBeenCalledTimes(1);
  });
  it('storage restore is a barrier, never a one-second best-effort bypass', async () => {
    const w = apiWorld(); let release!: (v: unknown) => void;
    const storage = { ...w.storage, get: () => new Promise<unknown>((resolve) => { release = resolve; }) };
    const p = new FanslyPacer({ ...w, storage }); let reached = false;
    const work = p.acquire('100', 'GET', '/api/v1/group/1', 'cooldown', signal()).then((permit) => { reached = true; return permit; });
    await vi.advanceTimersByTimeAsync(5000); expect(reached).toBe(false); release(undefined); (await work).release();
    const broken = new FanslyPacer({ ...w, storage: { ...w.storage, get: () => Promise.reject(new Error('unavailable')) } });
    await expect(broken.acquire('100', 'GET', '/api/v1/group/1', 'cooldown', signal())).rejects.toMatchObject({ code: 'CG-FAN-SESSION' });
  });
  it('rest and healing keep a 25% margin above a refused spacing for 24 hours, never probe below policy', () => {
    const { policy } = paceFor('GET', '/api/v1/account');
    const bad = limited(fresh(policy), policy, Date.now()); expect(bad.spacingMs).toBe(10_000);
    expect(healed(bad, policy, Date.now()).spacingMs).toBe(6250);
    expect(rested(bad, policy, Date.now() + 900_001).spacingMs).toBe(6250);
    expect(rested(bad, policy, Date.now() + BAD_MEMORY_MS).spacingMs).toBe(5000);
  });
  it('first account-family throttle slows its key, second slows the lane; other first throttles slow the lane', async () => {
    const w = apiWorld(); const p = new FanslyPacer(w);
    w.facts.push({ requestId: 'a', accountId: '100', source: 'own', at: Date.now(), method: 'GET', pathname: '/api/v1/account' }); await p.sync();
    expect(p.status('100')).toMatchObject({ intervalMs: 400, level: 1 });
    w.facts.push({ requestId: 'b', accountId: '100', source: 'page', at: Date.now(), method: 'GET', pathname: '/api/v1/account/100/followersnew' }); await p.sync();
    expect(p.status('100')).toMatchObject({ intervalMs: 800, level: 2 });
  });
  it('an identity alias learned after cooling preserves the penalty across a wake', async () => {
    const w = apiWorld(); const template = w.templates.get(1)!;
    w.templates.set(1, { ...template, canonicalId: null });
    w.facts.push({ requestId: 'legacy', accountId: '10', source: 'page', at: Date.now() });
    const p = new FanslyPacer(w); await p.sync(); w.templates.set(1, template); await p.sync();
    const awake = new FanslyPacer(w); await awake.sync(); expect(awake.status('100').level).toBe(1);
    expect(() => awake.assertOpen('100')).toThrow();
    // Closing the last tab drops P9a's template. A new tab captures only the
    // legacy identity initially; it must not escape the canonical cooldown.
    w.templates.set(1, { ...template, canonicalId: null });
    const reopened = new FanslyPacer(w); await reopened.sync();
    expect(() => reopened.assertOpen('10')).toThrow();
  });
  it('[RB-023] learning the canonical id while a request is in flight does not create a second FIFO', async () => {
    const w = apiWorld(); const template = w.templates.get(1)!; w.templates.set(1, { ...template, canonicalId: null });
    const p = new FanslyPacer(w);
    const first = await p.acquire('10', 'GET', '/api/v1/group/1', 'queue', signal());
    w.templates.set(1, template); let reached = false;
    const next = p.acquire('100', 'GET', '/api/v1/group/2', 'queue', signal()).then((permit) => { reached = true; return permit; });
    await vi.advanceTimersByTimeAsync(5000); expect(reached).toBe(false);
    first.release(); (await next).release(); expect(reached).toBe(true);
  });
});
