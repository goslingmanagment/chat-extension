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
// - A cooldown comes from ANY 429 (§8.4): our own (the client tells the pass),
//   or a fact the core's `webRequest.onCompleted` recorded — the page's, a
//   neighbour's (FBuddy polls `/message/unread` every 10 s from every tab), our
//   relay's — even while this chunk was not loaded. A fact names its creator
//   (the tab's registration); a fact without one (a tab registered before the
//   grant, a request without a tab) cools every creator of the profile: an
//   extra pause is safer than an extra request.
// - One response is one limit: our own 429 is seen by the client and, as a
//   fact `own`, by the listener; the two sightings pair up whichever comes
//   first (rules.ts `dedupMs`), across a sleep of the event page too.
// - The state lives in memory and in `storage.session` (it survives the event
//   page, it goes with the browser's session, like the facts it is made
//   from). After the event page wakes, a call waits until it is loaded and the
//   facts recorded meanwhile are applied (`ready`, then the facts at each call).

import { PACE_RULES } from './rules';
import {
  extendCooldown,
  freshLane,
  heal,
  limitKey,
  limitLane,
  pairOwn,
  pruneOwn,
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

interface Lane extends LaneState {
  tail: Promise<void>;
  pending: number;
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
  /** Every creator of the profile: the facts that name none. */
  let profile: Lane = { ...freshLane([]), tail: Promise.resolve(), pending: 0 };
  /** The facts already applied, by `requestId` (they stay in the core's list for a day). */
  let applied: string[] = [];
  let appliedSet = new Set<string>();
  let savedAt = 0;
  let writing: Promise<void> = Promise.resolve();
  let queued: Promise<void> | null = null;

  const laneOf = (state: LaneState): Lane => ({ ...state, tail: Promise.resolve(), pending: 0 });

  const ready = (async (): Promise<void> => {
    const stored = await deps.storage.get([key]);
    const raw = stored.ok ? stored.value[key] : undefined;
    if (typeof raw !== 'object' || raw === null || (raw as { v?: unknown }).v !== 1) return;
    const value = raw as Record<string, unknown>;
    const at = now();
    if (Array.isArray(value['lanes'])) {
      for (const item of value['lanes'].slice(-MAX_LANES)) {
        const lane = readLane(item, at, true);
        if (lane !== null) lanes.push(laneOf(lane));
      }
    }
    const everyone = readLane(value['profile'], at, false);
    if (everyone !== null) profile = laneOf({ ...everyone, aliases: [] });
    if (Array.isArray(value['applied'])) applied = value['applied'].filter((id): id is string => typeof id === 'string' && id.length <= 64).slice(-MAX_APPLIED);
    appliedSet = new Set(applied);
  })().catch(() => undefined);

  const snapshot = (): Record<string, unknown> => {
    const at = now();
    return {
      v: 1,
      lanes: lanes.filter((lane) => worthKeeping(lane, at)).map(storeLane),
      profile: storeLane(profile),
      applied: [...applied],
    };
  };

  /** One write of the whole state; calls in the same moment share it. A failed write keeps pacing from memory. */
  const save = (): Promise<void> => {
    savedAt = now();
    queued ??= writing.then(async () => {
      queued = null;
      await deps.storage.set({ [key]: snapshot() });
    });
    writing = queued.catch(() => undefined);
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
      for (const [name, state] of other.keys) if ((lane.keys.get(name)?.badAt ?? -1) < state.badAt) lane.keys.set(name, state);
      lane.ownSeen.push(...other.ownSeen);
      lane.ownFacts.push(...other.ownFacts);
      lane.aliases.push(...other.aliases);
      lanes.splice(lanes.indexOf(other), 1);
    }
    for (const id of ids) if (!lane.aliases.includes(id)) lane.aliases.push(id);
    lane.aliases = [...new Set(lane.aliases)].slice(0, 4);
    return lane;
  }

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
      const lane = fact.accountId === null ? profile : laneFor([fact.accountId]);
      restIfIdle(lane, fact.at);
      // Our own response, which the client may already have counted.
      if (fact.source === 'own' && pairOwn(lane.ownSeen, lane.ownFacts, fact.at)) continue;
      limitLane(lane, null, fact.at);
    }
    while (applied.length > MAX_APPLIED) appliedSet.delete(applied.shift() ?? '');
    return changed;
  }

  async function sync(): Promise<void> {
    await ready;
    if (deps.settle !== undefined) await deps.settle().catch(() => undefined);
    if (applyFacts()) await save();
  }

  /** When the creator's cooldown ends: its lane's and the profile's (epoch ms; in the past — none). */
  const coolingOf = (lane: LaneState): number => Math.max(lane.cooldownUntil, profile.cooldownUntil);

  /** Before a lane is used at `at`: an idle lane (and the profile) starts over, healed levels are forgiven. */
  function freshen(lane: Lane, at: number): void {
    let changed = false;
    if (lane.pending === 0) changed = restIfIdle(lane, at) || changed;
    changed = restIfIdle(profile, at) || changed;
    changed = heal(lane, at) || changed;
    pruneOwn(lane, at);
    if (changed) void save();
  }

  function passOf(lane: Lane, paceKey: string, unlock: (() => void) | null): PacerPass {
    let released = false;
    return {
      release() {
        if (released) return;
        released = true;
        lane.usedAt = Math.max(lane.usedAt, now());
        if (unlock !== null) {
          lane.pending -= 1;
          unlock();
        }
        if (now() - savedAt >= SAVE_EVERY_MS && worthKeeping(lane, now())) void save();
      },
      served() {
        servedLane(lane, now());
      },
      async limited(retryAfterMs) {
        // A fact `own` of this very response may be in the core already: settle and apply it first, then pair.
        await sync();
        const at = now();
        restIfIdle(lane, at);
        if (pairOwn(lane.ownFacts, lane.ownSeen, at)) {
          // The listener's fact counted the limit (lane-wide); the client adds what only it knows: the key and Retry-After.
          limitKey(lane, paceKey, at);
          extendCooldown(lane, at, retryAfterMs);
        } else {
          limitLane(lane, paceKey, at, retryAfterMs);
        }
        await save();
        return coolingOf(lane);
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
    const lane = laneFor(idsOf(creator));
    freshen(lane, now());
    if (mode === 'check' || mode === 'dispatch' || mode === 'queue-or-refuse') {
      const until = coolingOf(lane);
      if (until > now()) throw new PacerCooling(until);
    }
    if (mode === 'check' || mode === 'dispatch') {
      started(lane, paceKey, now());
      return passOf(lane, paceKey, null);
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
      lane.pending -= 1;
      void previous.then(unlock);
    };
    try {
      await abortable(previous, signal);
      let jitter: number | null = null;
      for (;;) {
        await sync();
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
      started(lane, paceKey, now());
      return passOf(lane, paceKey, () => void previous.then(unlock));
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
      const lane = lanes.find((candidate) => candidate.aliases.some((alias) => idsOf(creator).includes(alias)));
      return lane === undefined ? profile.cooldownUntil : coolingOf(lane);
    },
    /** What «Статус» and the diagnostics may show of a creator's lane (no ids of fans, no text). */
    view(creator: PacerCreator): PacerLaneView {
      const lane = lanes.find((candidate) => candidate.aliases.some((alias) => idsOf(creator).includes(alias)));
      return { cooldownUntil: lane === undefined ? profile.cooldownUntil : coolingOf(lane), level: lane?.level ?? 0, gapLevel: lane?.gapLevel ?? 0 };
    },
    /** Waits for the writes in flight. */
    flush: (): Promise<void> => writing,
  };
}

export type FanslyPacer = ReturnType<typeof createFanslyPacer>;
