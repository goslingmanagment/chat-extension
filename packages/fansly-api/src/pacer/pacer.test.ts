// The pacer (architecture.md §8.4; FS-NET-3, NF-037, RB-023): the old
// extension's rules E130–E135 as data, a mode per call, a cooldown from ANY
// 429 — ours and the page's (`onCompleted`) — deduplicated, and state that
// survives the event page. Fake timers: the pacer's own sleep and clock.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFanslyPacer, PacerCooling, type PacerCreator, type PacerStorage, type RateLimitFactLike } from './pacer';

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

function rig(random = (): number => 0): Rig {
  const storage = memoryStorage();
  const facts: RateLimitFactLike[] = [];
  const make = (): ReturnType<typeof createFanslyPacer> => createFanslyPacer({ storage, facts: () => facts, settle: () => Promise.resolve(), random });
  const made: Rig = {
    storage,
    facts,
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
async function startedAt(pacer: Rig['pacer'], creator: PacerCreator, key: string, mode: 'queue' | 'check' | 'dispatch' | 'queue-or-refuse' = 'queue'): Promise<number> {
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
  it('[NF-037] modes during a cooldown: check, dispatch and POST /group are refused at once with its end; a queued read waits it out', async () => {
    const { pacer } = rig();
    const pass = await pacer.enter(A, GROUP, 'queue');
    const until = await pass.limited();
    pass.release();
    for (const mode of ['check', 'dispatch', 'queue-or-refuse'] as const) {
      const refused = await pacer.enter(A, GROUP, mode).catch((error: unknown) => error);
      expect(refused).toBeInstanceOf(PacerCooling);
      expect((refused as PacerCooling).until).toBe(until);
    }
    expect(await settle(startedAt(pacer, A, GROUP), 100)).toBeGreaterThanOrEqual(until);
  });
});

describe('a cooldown from any 429 (§8.4)', () => {
  it('[NF-037] [FS-NET-3] a foreign 429 (the page or a neighbour, onCompleted) closes our next call of that creator — and only of that creator', async () => {
    const { pacer, facts } = rig();
    facts.push(fact(A.legacyId, 'page'));
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
    facts.push(fact(A.legacyId, 'page'));
    first.release();
    expect(await settle(waiting, 100)).toBeGreaterThanOrEqual(T0 + 1000 + 30_000);
    const refusing = await settle(pacer.enter(A, GROUP, 'queue'));
    const queued = pacer.enter(A, 'POST /group', 'queue-or-refuse');
    facts.push(fact(A.legacyId, 'page'));
    refusing.release();
    await expect(settle(queued)).rejects.toBeInstanceOf(PacerCooling);
  });
});
