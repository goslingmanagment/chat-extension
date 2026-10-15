// The pacer (architecture.md §8.4; FS-NET-3, NF-037, RB-023): the old
// extension's rules E130–E135 as data, a mode per call, a cooldown from ANY
// 429 — ours and the page's (`onCompleted`) — deduplicated, and state that
// survives the event page. Fake timers: the pacer's own sleep and clock.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFanslyPacer, PACER_KEY, PacerAborted, PacerCooling, type PacerCreator, type PacerStorage, type RateLimitFactLike } from './pacer';
import { PACE_RULES } from './rules';

const T0 = Date.UTC(2026, 9, 15, 12, 0, 0);
const A: PacerCreator = { legacyId: '300000000000000001', canonicalId: null };
const A_CANONICAL: PacerCreator = { legacyId: '300000000000000001', canonicalId: '300000000000000009' };
const B: PacerCreator = { legacyId: '300000000000000002', canonicalId: null };
const C: PacerCreator = { legacyId: '300000000000000003', canonicalId: null };
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

const level = (pacer: Rig['pacer'], creator: PacerCreator): number => pacer.view(creator).level;

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

  it('[NF-037] the 0–100 ms jitter rides on whichever deadline binds, drawn once per call', async () => {
    const { pacer } = rig(() => 0.5);
    await startedAt(pacer, A, GROUP);
    expect(await settle(startedAt(pacer, A, GROUP))).toBe(T0 + 500 + 50);
    // Nothing binds: no jitter, no wait.
    vi.setSystemTime(Date.now() + 60_000);
    const now = Date.now();
    expect(await startedAt(pacer, A, MESSAGE)).toBe(now);
  });

  it('[RB-023] one queued attempt of a creator in flight: the next waits until the pass is released, in arrival order', async () => {
    const { pacer } = rig();
    const first = await pacer.enter(A, GROUP, 'queue');
    const order: string[] = [];
    const second = pacer.enter(A, MESSAGE, 'queue').then((pass) => {
      order.push('second');
      return pass;
    });
    const third = pacer.enter(A, 'GET /message/automated', 'queue').then((pass) => {
      order.push('third');
      pass.release();
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(order).toEqual([]);
    first.release();
    const pass = await settle(second);
    expect(order).toEqual(['second']);
    pass.release();
    await settle(third);
    expect(order).toEqual(['second', 'third']);
  });

  it('[NF-037] a caller that gives up while waiting is refused, and does not let the call after it overtake the one before', async () => {
    const { pacer } = rig();
    const first = await pacer.enter(A, GROUP, 'queue');
    const controller = new AbortController();
    const given = pacer.enter(A, MESSAGE, 'queue', controller.signal);
    let third = false;
    const after = pacer.enter(A, 'GET /message/automated', 'queue').then((pass) => {
      third = true;
      pass.release();
    });
    controller.abort();
    await expect(given).rejects.toBeInstanceOf(PacerAborted);
    await vi.advanceTimersByTimeAsync(2000);
    expect(third).toBe(false);
    first.release();
    await settle(after);
    expect(third).toBe(true);
  });

  it('[NF-037] check and dispatch never wait for the gaps, but a queued call is spaced from their start', async () => {
    const { pacer } = rig();
    await startedAt(pacer, A, GROUP);
    expect(await startedAt(pacer, A, GROUP, 'check')).toBe(T0);
    expect(await startedAt(pacer, A, 'POST /message', 'dispatch')).toBe(T0);
    expect(await settle(startedAt(pacer, A, GROUP))).toBe(T0 + 500);
  });
});

describe('the cooldown (E133)', () => {
  it('[NF-037] our own 429: the ladder 30/60/120/240/300 s by level, Retry-After never shortened and capped at 6 h, 1.25 s per answered read', async () => {
    const { pacer } = rig();
    const ladder: number[] = [];
    for (let i = 0; i < 6; i++) {
      const pass = await settle(pacer.enter(A, GROUP, 'queue'));
      const until = await pass.limited();
      ladder.push(until - Date.now());
      pass.release();
    }
    expect(ladder).toEqual([30_000, 60_000, 120_000, 240_000, 300_000, 300_000]);

    const other = rig();
    const pass = await other.pacer.enter(B, GROUP, 'queue');
    expect((await pass.limited(120_000)) - Date.now()).toBe(120_000);
    pass.release();
    const capped = await settle(other.pacer.enter(B, GROUP, 'queue'), 1000);
    expect((await capped.limited(48 * 3600_000)) - Date.now()).toBe(PACE_RULES.retryAfterMaxMs);
    capped.release();

    const answered = rig();
    for (let i = 0; i < 100; i++) {
      const read = await settle(answered.pacer.enter(C, `GET /k${i % 20}`, 'queue'));
      read.served();
      read.release();
    }
    const limited = await settle(answered.pacer.enter(C, GROUP, 'queue'));
    expect((await limited.limited()) - Date.now()).toBe(100 * 1250);
  });

  it('[NF-037] a limit doubles the key and widens the lane from the first one; the /account* family is isolated until its second', async () => {
    const { pacer } = rig();
    const pass = await pacer.enter(A, GROUP, 'queue');
    await pass.limited();
    pass.release();
    expect(pacer.view(A)).toMatchObject({ level: 1, gapLevel: 1 });

    const isolated = rig();
    const read = await isolated.pacer.enter(B, ACCOUNT, 'queue');
    await read.limited();
    read.release();
    expect(isolated.pacer.view(B)).toMatchObject({ level: 1, gapLevel: 0 });
    // After the cooldown: the key went 5 s → 10 s, the lane gap is still 400 ms.
    const resumed = await settle(startedAt(isolated.pacer, B, MESSAGE), 100);
    expect(await settle(startedAt(isolated.pacer, B, ACCOUNT), 100)).toBe(resumed + 400);
    expect(await settle(startedAt(isolated.pacer, B, ACCOUNT), 100)).toBe(resumed + 400 + 10_000);
    const second = await settle(isolated.pacer.enter(B, ACCOUNT, 'queue'), 100);
    await second.limited();
    second.release();
    expect(isolated.pacer.view(B)).toMatchObject({ level: 2, gapLevel: 1 });
  });

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

  it('[NF-037] a level is forgiven after five quiet minutes past the cooldown and twenty answered reads; an idle lane starts over but remembers a limited key', async () => {
    const { pacer } = rig();
    const pass = await pacer.enter(A, GROUP, 'queue');
    const until = await pass.limited();
    pass.release();
    expect(level(pacer, A)).toBe(1);
    // Reads inside the quiet period forgive nothing.
    vi.setSystemTime(until + 1000);
    for (let i = 0; i < 25; i++) {
      const read = await settle(pacer.enter(A, `GET /k${i}`, 'queue'));
      read.served();
      read.release();
    }
    expect(level(pacer, A)).toBe(1);
    vi.setSystemTime(until + PACE_RULES.healMs + 1);
    for (let i = 0; i < 20; i++) {
      const read = await settle(pacer.enter(A, `GET /k${i}`, 'queue'));
      read.served();
      read.release();
    }
    await settle(startedAt(pacer, A, MESSAGE));
    expect(level(pacer, A)).toBe(0);

    const idle = rig();
    const limited = await idle.pacer.enter(B, GROUP, 'queue');
    await limited.limited();
    limited.release();
    vi.setSystemTime(Date.now() + 30_000 + PACE_RULES.idleMs + 1);
    const restedAt = await idle.pacer.enter(B, GROUP, 'queue');
    restedAt.release();
    expect(idle.pacer.view(B)).toMatchObject({ level: 0, gapLevel: 0 });
    // The key keeps a quarter above the spacing Fansly limited (500 ms → 625 ms).
    const at = Date.now();
    expect(await settle(startedAt(idle.pacer, B, GROUP))).toBe(at + 625);
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

  it('[NF-037] [FS-NET-3] a foreign 429 survives the background going to sleep: the next realm refuses the call and does not count the fact twice', async () => {
    const made = rig();
    made.facts.push(fact(A.legacyId, 'page'));
    await expect(made.pacer.enter(A, GROUP, 'check')).rejects.toBeInstanceOf(PacerCooling);
    await made.pacer.flush();
    vi.setSystemTime(T0 + 10_000);
    const woken = made.wake();
    const refused = await woken.enter(A, GROUP, 'check').catch((error: unknown) => error);
    expect((refused as PacerCooling).until).toBe(T0 + 30_000);
    expect(level(woken, A)).toBe(1);
    expect((made.storage.data.get(PACER_KEY) as { applied: string[] }).applied).toHaveLength(1);
  });

  it('[NF-037] [FS-NET-3] a 429 the core recorded while this chunk was not loaded is applied at its own time', async () => {
    const { pacer, facts } = rig();
    facts.push(fact(A.legacyId, 'page', T0 - 20_000), fact(B.legacyId, 'page', T0 - 40_000));
    expect(((await pacer.enter(A, GROUP, 'check').catch((error: unknown) => error)) as PacerCooling).until).toBe(T0 + 10_000);
    // B's cooldown ended before this realm began: nothing to wait for.
    expect(await startedAt(pacer, B, GROUP, 'check')).toBe(T0);
  });

  it('[NF-037] [FS-NET-3] a 429 without a creator (a tab registered before the grant, no tab) cools every creator — those learned later too', async () => {
    const { pacer, facts } = rig();
    await startedAt(pacer, A, GROUP);
    facts.push(fact(null, 'unknown'));
    for (const creator of [A, B, C]) await expect(pacer.enter(creator, GROUP, 'check')).rejects.toBeInstanceOf(PacerCooling);
    expect(pacer.coolingUntil(B)).toBe(T0 + 30_000);
  });

  it('[NF-037] a fact about the canonical id reaches the lane of the session that knows both ids', async () => {
    const { pacer, facts } = rig();
    await startedAt(pacer, A_CANONICAL, GROUP);
    facts.push(fact(A_CANONICAL.canonicalId, 'page'));
    await expect(pacer.enter(A_CANONICAL, GROUP, 'check')).rejects.toBeInstanceOf(PacerCooling);
    await expect(pacer.enter(A, GROUP, 'check')).rejects.toBeInstanceOf(PacerCooling);
  });

  it('[NF-037] our own 429 seen by the client and by the listener is one limit, whichever comes first, across a sleep too', async () => {
    // The client first, then the listener's fact.
    const first = rig();
    const pass = await first.pacer.enter(A, GROUP, 'check');
    await pass.limited();
    pass.release();
    first.facts.push(fact(A.legacyId, 'own', Date.now() + 5));
    expect(first.pacer.coolingUntil(A)).toBe(T0 + 30_000);
    expect(level(first.pacer, A)).toBe(1);

    // The fact first (the next call applies it), then the client: Retry-After still counts, the level does not.
    const second = rig();
    const own = await second.pacer.enter(B, GROUP, 'check');
    second.facts.push(fact(B.legacyId, 'own'));
    await second.pacer.sync();
    expect(level(second.pacer, B)).toBe(1);
    expect(await own.limited(90_000)).toBe(T0 + 90_000);
    own.release();
    expect(level(second.pacer, B)).toBe(1);

    // Across a sleep: the client's sighting is stored, the fact comes to the next realm.
    const third = rig();
    const stored = await third.pacer.enter(C, GROUP, 'check');
    await stored.limited();
    stored.release();
    await third.pacer.flush();
    third.facts.push(fact(C.legacyId, 'own', Date.now() + 20));
    const woken = third.wake();
    await woken.sync();
    expect(level(woken, C)).toBe(1);

    // Two responses half a minute apart are two limits; a page's 429 next to ours is its own limit.
    const fourth = rig();
    const one = await fourth.pacer.enter(A, GROUP, 'check');
    await one.limited();
    one.release();
    fourth.facts.push(fact(A.legacyId, 'own'), fact(A.legacyId, 'page'));
    await fourth.pacer.sync();
    expect(level(fourth.pacer, A)).toBe(2);
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

  it('[NF-037] the stored state is bounded and read defensively: a cooldown saved past the 6 h cap is cut to it', async () => {
    const { storage } = rig();
    storage.data.set(PACER_KEY, {
      v: 1,
      lanes: [{ aliases: [A.legacyId, 'not-an-id'], cooldownUntil: T0 + 1e12, level: 99, gapLevel: 99, keys: { [GROUP]: [1e9, 500, T0] }, ownSeen: ['x', T0] }, { aliases: [] }, 'junk'],
      profile: null,
      applied: [1, 'r-kept'],
    });
    const pacer = createFanslyPacer({ storage, facts: () => [{ requestId: 'r-kept', at: T0, accountId: null, source: 'page' }], settle: () => Promise.resolve() });
    const refused = (await pacer.enter(A, GROUP, 'check').catch((error: unknown) => error)) as PacerCooling;
    expect(refused.until).toBe(T0 + PACE_RULES.retryAfterMaxMs);
    expect(pacer.view(A)).toMatchObject({ level: PACE_RULES.maxLevel, gapLevel: PACE_RULES.maxLevel });
    // The applied fact is not applied again: no creator but A cools down.
    expect(await startedAt(pacer, B, GROUP, 'check')).toBe(T0);
  });
});
