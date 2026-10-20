// The pacer of our own requests to Fansly (R20 docs/project-unite/
// architecture.md §8.4; spec FS-NET-3, NF-037, RB-023). One lane per creator
// (the model whose session a request carries), shared by every tab, every
// pass and every click of that creator.
//
// - A mode per call (allowlist.ts): `queue` waits its turn in the lane's FIFO
//   (one attempt in flight), the lane gap with its jitter, the key's spacing
//   and the cooldown; `queue-or-refuse` waits its turn and the gaps, but a
//   cooldown refuses it (`POST /group`); `check` and `dispatch` never wait —
//   refused while the creator cools down, otherwise at once (their starts
//   still count for the gaps of the queued calls).
// - A cooldown comes from OUR OWN 429 only, as in the old extension: the client
//   tells the pass, or the core's `webRequest.onCompleted` recorded it as a
//   fact `own` (even while this chunk was not loaded). A 429 of the page or a
//   neighbour (FBuddy polls `/message/unread` every 10 s from every tab) cools
//   nothing: it held our clicks for 30–300 s for others' requests (2026-10-20
//   restrictions, item 7). An own fact without a creator (a request the event
//   page lost track of) cools every creator of the profile.
// - One response is one limit: our own 429 is seen by the client and, as a
//   fact `own`, by the listener; the two sightings pair up whichever comes
//   first, by the opaque client request id, across a sleep of the event page too.
// - The state lives in memory and in `storage.session` (it survives the event
//   page, it goes with the browser's session, like the facts it is made
//   from). After the event page wakes, a call waits until it is loaded and the
//   facts recorded meanwhile are applied (`ready`, then the facts at each call).

import { PACE_RULES } from './rules';
import {
  extendCooldown,
  freshLane,
  heal,
  limitLane,
  readLane,
  restIfIdle,
  served as servedLane,
  spacingDeadline,
  started,
  storeLane,
  worthKeeping,
  type LaneState,
} from './lane';
import type { PacerMode } from '../allowlist';

/** The creator a request is paced for: the ids its session template carries. */
export interface PacerCreator {
  readonly legacyId: string;
  readonly canonicalId: string | null;
}

/** A 429 the core recorded (core/services/network-session.ts `RateLimitFact`, structurally). */
export interface RateLimitFactLike {
  readonly clientRequestId?: string;
  readonly requestId: string;
  readonly at: number;
  /** null — every creator of the profile, those learned later too. */
  readonly accountId: string | null;
  readonly source: 'own' | 'page' | 'unknown';
}

/** storage.session as the core's services speak it (KeyValuePort, structurally). */
export interface PacerStorage {
  get(keys: readonly string[]): Promise<{ readonly ok: true; readonly value: Readonly<Record<string, unknown>> } | { readonly ok: false; readonly code: string }>;
  set(items: Readonly<Record<string, unknown>>): Promise<{ readonly ok: true } | { readonly ok: false; readonly code: string }>;
}

export interface PacerDeps {
  readonly storage: PacerStorage;
  /** The core's 429 facts (`networkSession.rateLimits`). */
  readonly facts: () => readonly RateLimitFactLike[];
  /** Settles the observations already delivered to the core (`networkSession.idle`). */
  readonly settle?: () => Promise<void>;
  readonly warn?: (reason: 'restore' | 'observations' | 'persist') => void;
  readonly now?: () => number;
  readonly random?: () => number;
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** The storage.session key of the pacer's state. */
  readonly key?: string;
}

export const PACER_KEY = 'fansly.pacer';
const MAX_LANES = 64;
const MAX_APPLIED = 512;
const SAVE_EVERY_MS = 60_000;

/** The creator cools down until `until` (epoch ms): the call was not made. */
export class PacerCooling extends Error {
  override readonly name = 'PacerCooling';
  readonly until: number;
  constructor(until: number) {
    super('fansly pacer: the creator cools down');
    this.until = until;
  }
}

/** The caller gave up while the call waited: it was not made. */
export class PacerAborted extends Error {
  override readonly name = 'PacerAborted';
}

/** One admitted start. `release` when the attempt is over (the next queued call may then start). */
export interface PacerPass {
  /** Final synchronous check and actual dispatch accounting. Once, immediately before fetch. */
  start(requestId?: string): void;
  release(): void;
  /** Fansly answered with a valid envelope. */
  served(): void;
  /** Fansly answered 429 (`retryAfterMs` — its Retry-After). Resolves with the cooldown's end, once it is stored. */
  limited(retryAfterMs?: number): Promise<number>;
}

export interface PacerLaneView {
  readonly cooldownUntil: number;
  readonly level: number;
  readonly gapLevel: number;
}

interface OwnRequest {
  id: string;
  aliases: string[];
  paceKey: string | null;
  at: number;
  limitedAt: number | null;
}

interface Lane extends LaneState {
  parent?: Lane;
  tail: Promise<void>;
  pending: number;
  inFlight: number;
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = (): void => {
      clearTimeout(timer);
      reject(new PacerAborted());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, Math.min(Math.max(0, ms), 2_147_483_647));
    if (signal?.aborted === true) abort();
    else signal?.addEventListener('abort', abort, { once: true });
  });
}

const isAborted = (signal: AbortSignal | undefined): boolean => signal?.aborted === true;

/** Waits for `work` or the abort, whichever comes first. */
function abortable(work: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (signal === undefined) return work;
  return new Promise((resolve, reject) => {
    const abort = (): void => reject(new PacerAborted());
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    void work.then(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    });
  });
}

export function createFanslyPacer(deps: PacerDeps) {
  const now = deps.now ?? (() => Date.now());
  const random = deps.random ?? Math.random;
  const sleep = deps.sleep ?? defaultSleep;
  const key = deps.key ?? PACER_KEY;
  const lanes: Lane[] = [];
  const requests = new Map<string, OwnRequest>();
  /** Every creator of the profile: the facts that name none. */
  let profile: Lane = { ...freshLane([]), tail: Promise.resolve(), pending: 0, inFlight: 0 };
  /** The facts already applied, by `requestId` (they stay in the core's list for a day). */
  let applied: string[] = [];
  let appliedSet = new Set<string>();
  let savedAt = 0;
  let writing: Promise<void> = Promise.resolve();
  let queued: Promise<void> | null = null;
  let recoveryDirty = false;
  let persistDirty = false;
  let revision = 0;
  const recoveryKey = `${key}.recovery`;

  const laneOf = (state: LaneState): Lane => ({ ...state, tail: Promise.resolve(), pending: 0, inFlight: 0 });

  const closed = (reason: 'restore' | 'observations'): void => {
    profile.cooldownUntil = Math.max(profile.cooldownUntil, now() + PACE_RULES.retryAfterMaxMs);
    profile.usedAt = now();
    recoveryDirty = true;
    deps.warn?.(reason);
  };

  const ready = (async (): Promise<void> => {
    try {
      const stored = await deps.storage.get([key, recoveryKey]);
      if (!stored.ok) throw new Error('read failed');
      // A failed primary write may have left a newer recovery snapshot. It contains
      // the cooldown AND its applied facts, so restoration cannot deduplicate away Retry-After.
      let raw: unknown;
      for (const source of [key, recoveryKey]) {
        const candidate = stored.value[source];
        if (candidate === undefined) continue;
        if (typeof candidate !== 'object' || candidate === null) throw new Error('invalid state');
        const version = (candidate as Record<string, unknown>)['revision'] ?? 0;
        if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0) throw new Error('invalid revision');
        if (raw === undefined || version > revision) { raw = candidate; revision = version; persistDirty = source === recoveryKey; }
      }
      if (raw === undefined) return; // Only an absent key is a fresh session.
      if (typeof raw !== 'object' || raw === null) throw new Error('invalid state');
      const value = raw as Record<string, unknown>;
      if (value['v'] !== 2 || !Array.isArray(value['lanes']) || !Array.isArray(value['applied']) || !Array.isArray(value['requests'])) throw new Error('invalid state');
      const at = now();
      for (const item of value['lanes']) {
        const lane = readLane(item, at, true);
        if (lane === null) throw new Error('invalid lane');
        lanes.push(laneOf(lane));
      }
      const everyone = readLane(value['profile'], at, false);
      if (everyone === null) throw new Error('invalid profile');
      profile = laneOf({ ...everyone, aliases: [] });
      if (!value['applied'].every((id) => typeof id === 'string' && id.length <= 128)) throw new Error('invalid facts');
      applied = (value['applied'] as string[]).slice(-MAX_APPLIED);
      appliedSet = new Set(applied);
      for (const item of value['requests']) {
        if (typeof item !== 'object' || item === null) throw new Error('invalid request');
        const r = item as OwnRequest;
        if (typeof r.id !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(r.id) || !Array.isArray(r.aliases) || !r.aliases.every((id) => typeof id === 'string' && /^[1-9][0-9]{0,39}$/.test(id)) || (r.paceKey !== null && (typeof r.paceKey !== 'string' || r.paceKey.length > 80)) || !Number.isFinite(r.at) || (r.limitedAt !== null && !Number.isFinite(r.limitedAt))) throw new Error('invalid request');
        if (at - r.at < PACE_RULES.badMemoryMs) requests.set(r.id, r);
      }
      if (lanes.length > MAX_LANES || requests.size > MAX_APPLIED) throw new Error('state too large');
    } catch {
      closed('restore');
    }
  })();

  const snapshot = (): Record<string, unknown> => {
    const at = now();
    return {
      v: 2,
      revision: ++revision,
      requests: [...requests.values()].filter((r) => at - r.at < PACE_RULES.badMemoryMs).map((r) => ({ ...r, aliases: [...r.aliases] })),
      lanes: lanes.filter((lane) => worthKeeping(lane, at)).map(storeLane),
      profile: storeLane(profile),
      applied: [...applied],
    };
  };

  const persist = async (target: string, state: Record<string, unknown>): Promise<boolean> => {
    try {
      if ((await deps.storage.set({ [target]: state })).ok) return true;
    } catch { /* A rejected write is the same as an explicit storage failure. */ }
    deps.warn?.('persist');
    return false;
  };

  /** Serialized snapshots; never reload over authoritative memory after a write failure. */
  const save = (): Promise<void> => {
    queued ??= writing.then(async () => {
      queued = null;
      persistDirty = true;
      for (let attempt = 0; attempt < 2; attempt++) {
        const state = snapshot();
        if (await persist(key, state)) {
          persistDirty = false;
          savedAt = now();
          return;
        }
        // Preserve the stricter requirement independently of a stale primary key,
        // then retry the primary with current memory (which may have advanced).
        await persist(recoveryKey, state);
      }
      // Persistent failure: sync/flush retries without spinning or forgetting memory.
    });
    writing = queued.catch(() => { deps.warn?.('persist'); });
    return writing;
  };

  /** The lane of a creator, by any of its ids; two lanes of one creator (a legacy and a canonical id seen apart) merge. */
  function laneFor(ids: readonly string[]): Lane {
    const found = lanes.filter((lane) => lane.aliases.some((alias) => ids.includes(alias)));
    let lane = found[0];
    if (lane === undefined) {
      lane = laneOf(freshLane(ids));
      lanes.push(lane);
      while (lanes.length > MAX_LANES) {
        const at = now();
        const index = lanes.findIndex((candidate) => candidate.pending === 0 && candidate.cooldownUntil <= at && candidate !== lane);
        lanes.splice(index < 0 ? 0 : index, 1);
      }
    }
    for (const other of found.slice(1)) {
      lane.cooldownUntil = Math.max(lane.cooldownUntil, other.cooldownUntil);
      lane.level = Math.max(lane.level, other.level);
      lane.gapLevel = Math.max(lane.gapLevel, other.gapLevel);
      lane.healFrom = Math.max(lane.healFrom, other.healFrom);
      lane.usedAt = Math.max(lane.usedAt, other.usedAt);
      for (const [name, state] of other.keys) {
        const current = lane.keys.get(name);
        lane.keys.set(name, current === undefined ? state : {
          spacingMs: Math.max(current.spacingMs, state.spacingMs), lastStartAt: Math.max(current.lastStartAt, state.lastStartAt),
          badMs: Math.max(current.badMs, state.badMs), badAt: Math.max(current.badAt, state.badAt),
        });
      }
      lane.nextAt = Math.max(lane.nextAt, other.nextAt);
      lane.answered += other.answered;
      lane.clean = Math.min(lane.clean, other.clean);
      lane.pending += other.pending;
      lane.inFlight += other.inFlight;
      lane.tail = Promise.all([lane.tail, other.tail]).then(() => undefined);
      other.parent = lane;
      lane.aliases.push(...other.aliases);
      lanes.splice(lanes.indexOf(other), 1);
    }
    for (const id of ids) if (!lane.aliases.includes(id)) lane.aliases.push(id);
    lane.aliases = [...new Set(lane.aliases)].slice(0, 4);
    return lane;
  }

  const root = (lane: Lane): Lane => lane.parent === undefined ? lane : root(lane.parent);

  const idsOf = (creator: PacerCreator): string[] => (creator.canonicalId === null || creator.canonicalId === creator.legacyId ? [creator.legacyId] : [creator.legacyId, creator.canonicalId]);

  /**
   * Applies the core's facts not applied yet, in the order they happened. Synchronous over what the core holds in
   * memory (the final check of a send may read it); `sync` settles the core's observations first.
   */
  function applyFacts(): boolean {
    let changed = false;
    const facts = [...deps.facts()].sort((a, b) => a.at - b.at);
    for (const fact of facts) {
      if (appliedSet.has(fact.requestId)) continue;
      applied.push(fact.requestId);
      appliedSet.add(fact.requestId);
      changed = true;
      // Only our own 429 cools us (the old extension's rule): the page's or a neighbour's is theirs.
      if (fact.source !== 'own') continue;
      const id = fact.clientRequestId;
      let own = id === undefined ? undefined : requests.get(id);
      if (own?.limitedAt !== null && own?.limitedAt !== undefined) continue;
      const ids = [...(own?.aliases ?? []), ...(fact.accountId === null ? [] : [fact.accountId])];
      const lane = ids.length === 0 ? profile : laneFor(ids);
      restIfIdle(lane, fact.at);
      limitLane(lane, own?.paceKey ?? null, fact.at);
      if (id !== undefined) {
        own ??= { id, aliases: ids, paceKey: null, at: fact.at, limitedAt: null };
        own.limitedAt = fact.at;
        remember(own);
      }
    }
    while (applied.length > MAX_APPLIED) appliedSet.delete(applied.shift() ?? '');
    return changed;
  }

  function remember(request: OwnRequest): void {
    requests.set(request.id, request);
    for (const [id, value] of requests) if (now() - value.at >= PACE_RULES.badMemoryMs) requests.delete(id);
    while (requests.size > MAX_APPLIED) requests.delete(requests.keys().next().value as string);
  }

  async function sync(): Promise<void> {
    await ready;
    if (deps.settle !== undefined) await deps.settle().catch(() => { closed('observations'); });
    if (applyFacts() || recoveryDirty || persistDirty) { recoveryDirty = false; await save(); }
  }

  /** When the creator's cooldown ends: its lane's and the profile's (epoch ms; in the past — none). */
  const coolingOf = (lane: LaneState): number => Math.max(lane.cooldownUntil, profile.cooldownUntil);

  /** Before a lane is used at `at`: an idle lane (and the profile) starts over, healed levels are forgiven. */
  function freshen(lane: Lane, at: number): void {
    let changed = false;
    if (lane.pending === 0) changed = restIfIdle(lane, at) || changed;
    changed = restIfIdle(profile, at) || changed;
    changed = heal(lane, at) || changed;
    if (changed) void save();
  }

  function passOf(initial: Lane, paceKey: string, mode: PacerMode, unlock: (() => void) | null): PacerPass {
    let released = false;
    let dispatched = false;
    let request: OwnRequest | null = null;
    return {
      start(id = crypto.randomUUID()) {
        if (released || dispatched) throw new PacerAborted();
        if (applyFacts()) void save();
        const lane = root(initial);
        // A merge can unite permits already returned from different FIFOs. Their
        // old tails cannot revoke them: claim the merged lane synchronously here.
        if (unlock !== null && lane.inFlight > 0) throw new PacerAborted();
        const at = now();
        const until = Math.max(coolingOf(lane), mode === 'queue' || mode === 'queue-or-refuse' ? spacingDeadline(lane, paceKey) : 0);
        if (until > at) throw new PacerCooling(until);
        dispatched = true;
        if (unlock !== null) lane.inFlight += 1;
        started(lane, paceKey, at);
        request = { id, aliases: [...lane.aliases], paceKey, at, limitedAt: null };
        remember(request);
        void save();
      },
      release() {
        if (released) return;
        released = true;
        const lane = root(initial);
        if (unlock !== null && dispatched) lane.inFlight -= 1;
        if (unlock !== null) { lane.pending -= 1; unlock(); }
        if (request !== null && request.limitedAt === null) requests.delete(request.id);
        if (now() - savedAt >= SAVE_EVERY_MS && worthKeeping(lane, now())) void save();
      },
      served() { servedLane(root(initial), now()); },
      async limited(retryAfterMs) {
        // Apply the client observation immediately; a blocked composition queue must not postpone cooling.
        const lane = root(initial);
        const at = now();
        restIfIdle(lane, at);
        request ??= { id: crypto.randomUUID(), aliases: [...lane.aliases], paceKey, at, limitedAt: null };
        if (request.limitedAt === null) {
          limitLane(lane, paceKey, at, retryAfterMs);
          request.limitedAt = at;
          remember(request);
        } else {
          extendCooldown(lane, request.limitedAt, retryAfterMs);
        }
        await save();
        return coolingOf(root(initial));
      },
    };
  }

  /**
   * Admits one call of `creator` on `paceKey` by `mode`. Rejects with PacerCooling (refused: the creator cools down)
   * or PacerAborted (the signal fired while it waited); either way no request is made.
   */
  async function enter(creator: PacerCreator, paceKey: string, mode: PacerMode, signal?: AbortSignal): Promise<PacerPass> {
    if (signal?.aborted === true) throw new PacerAborted();
    await sync();
    let lane = laneFor(idsOf(creator));
    freshen(lane, now());
    if (mode === 'check' || mode === 'dispatch' || mode === 'queue-or-refuse') {
      const until = coolingOf(lane);
      if (until > now()) throw new PacerCooling(until);
    }
    if (mode === 'check' || mode === 'dispatch') {
      return passOf(lane, paceKey, mode, null);
    }

    // The FIFO: one queued attempt of this creator in flight.
    const previous = lane.tail;
    let unlock!: () => void;
    lane.tail = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    lane.pending += 1;
    // A waiter that gives up must not let its successor overtake the call before it.
    const leave = (): void => {
      root(lane).pending -= 1;
      void previous.then(unlock);
    };
    try {
      await abortable(previous, signal);
      let jitter: number | null = null;
      for (;;) {
        await sync();
        lane = root(lane);
        const at = now();
        freshen(lane, at);
        const cooling = coolingOf(lane);
        if (mode === 'queue-or-refuse' && cooling > at) throw new PacerCooling(cooling);
        const base = spacingDeadline(lane, paceKey);
        // The jitter rides on whichever deadline binds (E133), drawn once for the call.
        jitter ??= base > at ? Math.floor(random() * (PACE_RULES.jitterMs + 1)) : 0;
        const until = Math.max(cooling, base + jitter);
        if (until <= at) break;
        await sleep(until - at, signal);
      }
      // The signal may have fired during the last wait's resolution (narrowing does not see across the awaits).
      if (isAborted(signal)) throw new PacerAborted();
      return passOf(lane, paceKey, mode, () => void previous.then(unlock));
    } catch (error) {
      leave();
      throw error;
    }
  }

  return {
    /** The stored state is back (or known absent): every call waits for it. */
    ready,
    enter,
    /** Settles the core's observations and applies their facts. */
    sync,
    /**
     * When the creator's cooldown ends, from what is applied now (synchronous: the final check of a send reads it; it
     * applies the facts the core holds in memory). 0 or past — none.
     */
    coolingUntil(creator: PacerCreator): number {
      if (applyFacts()) void save();
      const lane = laneFor(idsOf(creator));
      return lane === undefined ? profile.cooldownUntil : coolingOf(lane);
    },
    /** What «Статус» and the diagnostics may show of a creator's lane (no ids of fans, no text). */
    view(creator: PacerCreator): PacerLaneView {
      if (applyFacts()) void save();
      const lane = laneFor(idsOf(creator));
      return { cooldownUntil: lane === undefined ? profile.cooldownUntil : coolingOf(lane), level: lane?.level ?? 0, gapLevel: lane?.gapLevel ?? 0 };
    },
    /** Waits for the writes in flight. */
    flush: async (): Promise<void> => {
      await writing;
      if (persistDirty) await save();
    },
  };
}

export type FanslyPacer = ReturnType<typeof createFanslyPacer>;
