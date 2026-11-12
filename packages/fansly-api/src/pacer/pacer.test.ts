// The pacer (architecture.md §8.4; FS-NET-3, NF-037, RB-023): the old
// extension's rules E130–E135 as data, a mode per call, a cooldown from our own
// 429 only (also seen by `onCompleted`) — deduplicated, and state that
// survives the event page. Fake timers: the pacer's own sleep and clock.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FanslyObservation } from '../observe';
import { createFanslyPacer, PacerCooling, PacerEarly, type PacerCreator, type PacerStorage, type RateLimitFactLike } from './pacer';

const T0 = Date.UTC(2026, 9, 15, 12, 0, 0);
const A: PacerCreator = { legacyId: '300000000000000001', canonicalId: null };
const B: PacerCreator = { legacyId: '300000000000000002', canonicalId: null };
const GROUP = 'GET /group/:id';
const MESSAGE = 'GET /message';
const ACCOUNT = 'GET /account*';

function memoryStorage(): PacerStorage & { readonly data: Map<string, unknown>; writes: number } {
  const data = new Map<string, unknown>();
  const store = {
    data,
    writes: 0,
    get: (keys: readonly string[]) => Promise.resolve({ ok: true as const, value: Object.fromEntries(keys.filter((key) => data.has(key)).map((key) => [key, structuredClone(data.get(key))])) }),
    set: (items: Readonly<Record<string, unknown>>) => {
      store.writes += 1;
      for (const [key, value] of Object.entries(items)) data.set(key, structuredClone(value));
      return Promise.resolve({ ok: true as const });
    },
  };
  return store;
}

interface Rig {
  readonly storage: ReturnType<typeof memoryStorage>;
  readonly facts: RateLimitFactLike[];
  pacer: ReturnType<typeof createFanslyPacer>;
  /** A new realm of the event page: a new pacer over the same storage.session and the same facts of the core. */
  wake(): ReturnType<typeof createFanslyPacer>;
}

function rig(random = (): number => 0): Rig & { readonly told: FanslyObservation[] } {
  const storage = memoryStorage();
  const facts: RateLimitFactLike[] = [];
  const told: FanslyObservation[] = [];
  const make = (): ReturnType<typeof createFanslyPacer> => createFanslyPacer({ storage, facts: () => facts, settle: () => Promise.resolve(), random, observe: (observation) => told.push(observation) });
  const made: Rig & { readonly told: FanslyObservation[] } = {
    storage,
    facts,
    told,
    pacer: make(),
    wake() {
      made.pacer = make();
      return made.pacer;
    },
  };
  return made;
}

let factSeq = 0;
const fact = (accountId: string | null, source: RateLimitFactLike['source'], at = Date.now()): RateLimitFactLike => ({ requestId: `r${++factSeq}`, at, accountId, source });

/** Starts of a call, run to its pass, then released at once: the moment it started. */
async function startedAt(pacer: Rig['pacer'], creator: PacerCreator, key: string, mode: 'queue' | 'check' | 'dispatch' | 'queue-or-refuse' | 'poll' = 'queue'): Promise<number> {
  const pass = await pacer.enter(creator, key, mode);
  pass.start();
  const at = Date.now();
  pass.release();
  return at;
}

/** Runs a promise to its end while the fake clock moves. */
async function settle<T>(work: Promise<T>, stepMs = 10, maxMs = 600_000): Promise<T> {
  let done = false;
  let result: { value: T } | { error: unknown } | null = null;
  work.then(
    (value) => {
      done = true;
      result = { value };
    },
    (error: unknown) => {
      done = true;
      result = { error };
    },
  );
  for (let spent = 0; !done && spent <= maxMs; spent += stepMs) await vi.advanceTimersByTimeAsync(stepMs);
  if (!done) throw new Error('did not settle');
  const end = result as { value: T } | { error: unknown } | null;
  if (end !== null && 'error' in end) throw end.error;
  return (end as { value: T }).value;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the pace (E130, E133)', () => {
  it('[NF-037] [RB-023] one creator: a 400 ms lane gap between any two starts, 500 ms per key, 5 s on the /account* family; another creator runs apart', async () => {
    const { pacer } = rig();
    const first = await startedAt(pacer, A, GROUP);
    expect(first).toBe(T0);
    // The same key again: its own 500 ms spacing from its last start binds (the lane gap is 400 ms).
    expect(await settle(startedAt(pacer, A, GROUP))).toBe(T0 + 500);
    // Another key of the same creator: the lane gap binds.
    expect(await settle(startedAt(pacer, A, MESSAGE))).toBe(T0 + 900);
    // The /account* family: 5 s between two of its reads (E128).
    const account = await settle(startedAt(pacer, A, ACCOUNT));
    expect(await settle(startedAt(pacer, A, ACCOUNT))).toBe(account + 5000);
    // Another creator has a lane of its own: no wait.
    const before = Date.now();
    expect(await startedAt(pacer, B, GROUP)).toBe(before);
  });
});

describe('the cooldown (E133)', () => {
  it('[NF-037] modes during a cooldown: check, dispatch, a poll and POST /group are refused at once with its end; a queued read waits it out', async () => {
    const { pacer } = rig();
    const pass = await pacer.enter(A, GROUP, 'queue');
    const until = await pass.limited();
    pass.release();
    for (const mode of ['check', 'dispatch', 'queue-or-refuse', 'poll'] as const) {
      const refused = await pacer.enter(A, GROUP, mode).catch((error: unknown) => error);
      expect(refused).toBeInstanceOf(PacerCooling);
      expect((refused as PacerCooling).until).toBe(until);
    }
    expect(await settle(startedAt(pacer, A, GROUP), 100)).toBeGreaterThanOrEqual(until);
  });
});

describe('a cooldown from our own 429 (§8.4)', () => {
  it('[NF-037] a foreign 429 (the page or a neighbour, onCompleted) cools nothing, as in the old extension', async () => {
    const { pacer, facts } = rig();
    facts.push(fact(A.legacyId, 'page'), fact(null, 'unknown'));
    expect(await startedAt(pacer, A, GROUP, 'check')).toBe(T0);
    expect(await settle(startedAt(pacer, A, 'POST /group', 'queue-or-refuse'))).toBeLessThan(T0 + 1000);
  });

  it('[NF-037] [FS-NET-3] our own 429 seen by onCompleted closes our next call of that creator — and only of that creator', async () => {
    const { pacer, facts } = rig();
    facts.push(fact(A.legacyId, 'own'));
    const refused = await pacer.enter(A, GROUP, 'check').catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(PacerCooling);
    expect((refused as PacerCooling).until).toBe(T0 + 30_000);
    await expect(pacer.enter(A, 'POST /group', 'queue-or-refuse')).rejects.toBeInstanceOf(PacerCooling);
    expect(await settle(startedAt(pacer, A, GROUP), 100)).toBeGreaterThanOrEqual(T0 + 30_000);
    expect(await startedAt(pacer, B, GROUP, 'check')).toBeLessThan(T0 + 31_000);
  });

  it('[NF-037] a queued call that waits its turn notices a 429 recorded meanwhile', async () => {
    const { pacer, facts } = rig();
    const first = await pacer.enter(A, GROUP, 'queue');
    const waiting = startedAt(pacer, A, MESSAGE);
    await vi.advanceTimersByTimeAsync(1000);
    facts.push(fact(A.legacyId, 'own'));
    first.release();
    expect(await settle(waiting, 100)).toBeGreaterThanOrEqual(T0 + 1000 + 30_000);
    const refusing = await settle(pacer.enter(A, GROUP, 'queue'));
    const queued = pacer.enter(A, 'POST /group', 'queue-or-refuse');
    facts.push(fact(A.legacyId, 'own'));
    refusing.release();
    await expect(settle(queued)).rejects.toBeInstanceOf(PacerCooling);
  });
});

describe('a poll (2026-11-12: badges, «Онлайн»)', () => {
  const earlyOf = async (work: Promise<unknown>): Promise<number> => {
    const error = await work.then(() => null, (caught: unknown) => caught);
    expect(error).toBeInstanceOf(PacerEarly);
    return (error as PacerEarly).until;
  };

  it('[NF-037] is refused early, with the moment it may start, by the key\'s spacing and by the lane gap; then it starts', async () => {
    const { pacer } = rig();
    expect(await startedAt(pacer, A, ACCOUNT, 'poll')).toBe(T0);
    // The /account* family: 5 s since its last start.
    expect(await earlyOf(pacer.enter(A, ACCOUNT, 'poll'))).toBe(T0 + 5000);
    await vi.advanceTimersByTimeAsync(5000);
    // A click of another key starts at once; the lane gap (400 ms) since it now binds the poll.
    expect(await startedAt(pacer, A, GROUP, 'check')).toBe(T0 + 5000);
    expect(await earlyOf(pacer.enter(A, ACCOUNT, 'poll'))).toBe(T0 + 5400);
    await vi.advanceTimersByTimeAsync(400);
    expect(await startedAt(pacer, A, ACCOUNT, 'poll')).toBe(T0 + 5400);
    // Another creator's lane is its own.
    expect(await startedAt(pacer, B, ACCOUNT, 'poll')).toBe(T0 + 5400);
  });

  it('[NF-037] the check is made again in start(), synchronously: of two polls admitted side by side only the first starts', async () => {
    const { pacer } = rig();
    const first = await pacer.enter(A, ACCOUNT, 'poll');
    const second = await pacer.enter(A, ACCOUNT, 'poll');
    first.start();
    let refused: unknown = null;
    try {
      second.start();
    } catch (error) {
      refused = error;
    }
    expect(refused).toBeInstanceOf(PacerEarly);
    expect((refused as PacerEarly).until).toBe(T0 + 5000);
    first.release();
    second.release();
  });

  it('[NF-037] a click never waits for a poll and moves the key\'s last start: the poll after it counts from the click', async () => {
    const { pacer } = rig();
    expect(await startedAt(pacer, A, ACCOUNT, 'poll')).toBe(T0);
    await vi.advanceTimersByTimeAsync(1000);
    // «Заметки» reads the same family by a click: at once, 1 s after the poll.
    expect(await startedAt(pacer, A, ACCOUNT, 'check')).toBe(T0 + 1000);
    await vi.advanceTimersByTimeAsync(4000);
    expect(await earlyOf(pacer.enter(A, ACCOUNT, 'poll'))).toBe(T0 + 6000);
  });

  it('[NF-037] is never in the creator\'s FIFO: a queued call in flight does not hold it, and a queued call waits only the gaps after it', async () => {
    const { pacer } = rig();
    const queued = await pacer.enter(A, MESSAGE, 'queue');
    queued.start();
    await vi.advanceTimersByTimeAsync(400);
    // The queued call is still in flight: the poll goes beside it.
    expect(await startedAt(pacer, A, ACCOUNT, 'poll')).toBe(T0 + 400);
    queued.release();
    // A queued read of another key: the lane gap since the poll, not a turn behind it.
    expect(await settle(startedAt(pacer, A, GROUP))).toBe(T0 + 800);
  });
});

describe('each 429 told once (the counters, observe.ts)', () => {
  it('our own 429 once, whether the client or `webRequest` saw it first, with its purpose; the page\'s and the others\' as their facts are applied', async () => {
    const { pacer, facts, told } = rig();
    // The client first, then the same answer as a fact of ours.
    const click = await pacer.enter(A, GROUP, 'check');
    click.start('req-1', 'notes');
    await click.limited();
    click.release();
    facts.push({ clientRequestId: 'req-1', requestId: 'w-1', at: T0, accountId: A.legacyId, source: 'own' });
    pacer.coolingUntil(A);
    expect(told).toEqual([{ kind: 'limited', source: 'own', purpose: 'notes' }]);
    // The fact first, then the client reads the same answer.
    const poll = await pacer.enter(B, ACCOUNT, 'poll');
    poll.start('req-2', 'badges');
    facts.push({ clientRequestId: 'req-2', requestId: 'w-2', at: T0, accountId: B.legacyId, source: 'own' });
    pacer.coolingUntil(B);
    await poll.limited();
    poll.release();
    expect(told).toEqual([
      { kind: 'limited', source: 'own', purpose: 'notes' },
      { kind: 'limited', source: 'own', purpose: 'badges' },
    ]);
    // The page's and a neighbour's: once each, however often the facts are read.
    facts.push(fact(A.legacyId, 'page'), fact(null, 'unknown'));
    pacer.coolingUntil(A);
    pacer.coolingUntil(B);
    expect(told.slice(2)).toEqual([
      { kind: 'limited', source: 'page', purpose: null },
      { kind: 'limited', source: 'unknown', purpose: null },
    ]);
  });
});
