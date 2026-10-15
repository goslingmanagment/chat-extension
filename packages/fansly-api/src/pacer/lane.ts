// A creator's lane and its keys: pure state and pure transitions, every one
// at an explicit time — no timers, no IO (rules.ts; old fansly-pacer
// controller.ts and pacer.ts, E130–E133). The pacer (pacer.ts) owns the
// lanes, the waiting and the storage; a test drives these directly.
//
// Times are those of the events, not of their processing: a 429 the core saw
// while this chunk slept is applied at its own moment, so a cooldown that
// already ended does not start again, and penalties that are older than the
// idle rule do not pile up (the lane rests between them).

import { laneGapMs, PACE_RULES, policyOf, type KeyPolicy } from './rules';

export interface KeyState {
  spacingMs: number;
  /** Memory only: when the key last started (0 — not in this realm). */
  lastStartAt: number;
  /** The spacing Fansly last limited this key at, and when. */
  badMs: number;
  badAt: number;
}

export interface LaneState {
  /** The creator's ids: the legacy one of the session token, the canonical one once known (AU-031…033). */
  aliases: string[];
  usedAt: number;
  cooldownUntil: number;
  level: number;
  /** How far the lane gap is widened; it comes back one level per heal. */
  gapLevel: number;
  healFrom: number;
  /** Reads answered since the heal period began. */
  clean: number;
  /** Reads answered since the previous limit (the cooldown's third term). */
  answered: number;
  /** Memory only: the earliest next start of a queued call. */
  nextAt: number;
  keys: Map<string, KeyState>;
  /** Our own 429s the client saw that no fact `own` has matched yet (event times). */
  ownSeen: number[];
  /** Facts `own` applied that the client has not reported (yet, or ever: its realm died first). */
  ownFacts: number[];
}

export const MAX_KEYS = 32;
const MAX_OWN = 16;

export function freshKey(policy: KeyPolicy): KeyState {
  return { spacingMs: policy.startMs, lastStartAt: 0, badMs: 0, badAt: 0 };
}

export function freshLane(aliases: readonly string[]): LaneState {
  return { aliases: [...aliases], usedAt: 0, cooldownUntil: 0, level: 0, gapLevel: 0, healFrom: 0, clean: 0, answered: 0, nextAt: 0, keys: new Map(), ownSeen: [], ownFacts: [] };
}

/** The lowest spacing allowed now: the policy's own, or a margin above a remembered limit. */
export function floorOf(state: KeyState, policy: KeyPolicy, now: number): number {
  const remembered = state.badMs > 0 && now - state.badAt < PACE_RULES.badMemoryMs;
  return remembered ? Math.min(policy.ceilMs, Math.max(policy.startMs, Math.ceil(state.badMs * PACE_RULES.badMargin))) : policy.startMs;
}

/** The key was limited at its spacing: remembered, and doubled up to its ceiling. */
export function limitedKey(state: KeyState, policy: KeyPolicy, at: number): KeyState {
  return { ...state, badMs: state.spacingMs, badAt: at, spacingMs: Math.min(policy.ceilMs, state.spacingMs * 2) };
}

/** The cooldown a limit at this lane state earns (E133), before Retry-After. */
export function backoffMs(lane: LaneState, retryAfterMs?: number): number {
  const ladder = Math.min(PACE_RULES.cooldownMaxMs, PACE_RULES.cooldownBaseMs * 2 ** Math.min(lane.level, 4));
  const answers = Math.min(PACE_RULES.cooldownMaxMs, lane.answered * PACE_RULES.cooldownPerAnswerMs);
  return Math.max(Math.min(retryAfterMs ?? 0, PACE_RULES.retryAfterMaxMs), ladder, answers);
}

/**
 * A limit of the lane at `at`. `key` — the key of our own request Fansly limited; null — a 429 of another request (the
 * page's, a neighbour's: its key is not known) slows the whole lane. An isolated key widens the lane gap only from the
 * lane's second unhealed limit (E133).
 */
export function limitLane(lane: LaneState, key: string | null, at: number, retryAfterMs?: number): void {
  const backoff = backoffMs(lane, retryAfterMs);
  const policy = key === null ? null : policyOf(key);
  if (policy?.isolated !== true || lane.level > 0) lane.gapLevel = Math.min(PACE_RULES.maxLevel, lane.gapLevel + 1);
  lane.level = Math.min(PACE_RULES.maxLevel, lane.level + 1);
  lane.clean = 0;
  lane.answered = 0;
  lane.cooldownUntil = Math.max(lane.cooldownUntil, at + backoff);
  lane.healFrom = lane.cooldownUntil;
  lane.usedAt = Math.max(lane.usedAt, at);
  if (key !== null && policy !== null) limitKey(lane, key, at);
}

/** Only the key's memory (a limit the lane already counted, §8.4 dedup). */
export function limitKey(lane: LaneState, key: string, at: number): void {
  const policy = policyOf(key);
  lane.keys.set(key, limitedKey(lane.keys.get(key) ?? freshKey(policy), policy, at));
  trimKeys(lane);
}

/** A server-requested wait on a limit already counted: never shortened. */
export function extendCooldown(lane: LaneState, at: number, retryAfterMs: number | undefined): void {
  if (retryAfterMs === undefined) return;
  lane.cooldownUntil = Math.max(lane.cooldownUntil, at + Math.min(retryAfterMs, PACE_RULES.retryAfterMaxMs));
  lane.healFrom = Math.max(lane.healFrom, lane.cooldownUntil);
}

/**
 * A lane idle since before `at` starts over (E121): its penalty goes, a remembered limit of a key stays (rested to its
 * floor), every other key starts again. Returns whether anything changed.
 */
export function restIfIdle(lane: LaneState, at: number): boolean {
  if (Math.max(lane.usedAt + PACE_RULES.idleMs, lane.cooldownUntil) >= at) return false;
  const changed = lane.level > 0 || lane.gapLevel > 0 || lane.cooldownUntil > 0 || lane.clean > 0 || lane.answered > 0 || lane.keys.size > 0;
  lane.level = 0;
  lane.gapLevel = 0;
  lane.answered = 0;
  lane.healFrom = 0;
  lane.clean = 0;
  lane.cooldownUntil = 0;
  lane.nextAt = 0;
  for (const [key, state] of lane.keys) {
    const policy = policyOf(key);
    if (state.badMs > 0 && at - state.badAt < PACE_RULES.badMemoryMs) lane.keys.set(key, { ...state, lastStartAt: 0, spacingMs: floorOf(state, policy, at) });
    else lane.keys.delete(key);
  }
  return changed;
}

/** Levels forgiven by now (E128): each needs its quiet period after the cooldown and twenty answered reads. */
export function heal(lane: LaneState, now: number): boolean {
  let changed = false;
  while (lane.level > 0 && lane.clean >= PACE_RULES.healReads && now - lane.healFrom >= PACE_RULES.healMs) {
    lane.level -= 1;
    lane.gapLevel = Math.max(0, lane.gapLevel - 1);
    lane.healFrom += PACE_RULES.healMs;
    lane.clean = 0;
    for (const [key, state] of lane.keys) {
      const policy = policyOf(key);
      lane.keys.set(key, { ...state, spacingMs: Math.max(floorOf(state, policy, now), Math.round(state.spacingMs / 2)) });
    }
    changed = true;
  }
  return changed;
}

/** Fansly answered a read with a valid envelope (E133: only that counts). */
export function served(lane: LaneState, now: number): void {
  lane.answered += 1;
  if (now - lane.healFrom >= PACE_RULES.healMs) lane.clean += 1;
}

/** The earliest start of a queued call of `key` by the gaps (cooldown aside). */
export function spacingDeadline(lane: LaneState, key: string): number {
  const state = lane.keys.get(key);
  const keyAt = state !== undefined && state.lastStartAt > 0 ? state.lastStartAt + state.spacingMs : 0;
  return Math.max(lane.nextAt, keyAt);
}

/** A call of `key` starts now: the lane gap and the key's spacing count from here. */
export function started(lane: LaneState, key: string, now: number): void {
  const policy = policyOf(key);
  const state = lane.keys.get(key) ?? freshKey(policy);
  lane.keys.set(key, { ...state, lastStartAt: now });
  lane.nextAt = Math.max(lane.nextAt, now + laneGapMs(lane.gapLevel));
  lane.usedAt = Math.max(lane.usedAt, now);
  trimKeys(lane);
}

/**
 * Pairs one sighting of our own 429 with the other channel's (§8.4 dedup): `from` holds the other channel's
 * unmatched times; a time within the window is consumed (the same response) and true is returned; otherwise `at` joins
 * `into` and false is returned (a limit of its own).
 */
export function pairOwn(from: number[], into: number[], at: number): boolean {
  let best = -1;
  for (let i = 0; i < from.length; i++) {
    const distance = Math.abs((from[i] ?? 0) - at);
    if (distance <= PACE_RULES.dedupMs && (best < 0 || distance < Math.abs((from[best] ?? 0) - at))) best = i;
  }
  if (best >= 0) {
    from.splice(best, 1);
    return true;
  }
  into.push(at);
  while (into.length > MAX_OWN) into.shift();
  return false;
}

/** Drops the sightings no later sighting can pair with any more (older than the facts live). */
export function pruneOwn(lane: LaneState, now: number): void {
  const keep = (at: number): boolean => now - at < PACE_RULES.badMemoryMs;
  lane.ownSeen = lane.ownSeen.filter(keep);
  lane.ownFacts = lane.ownFacts.filter(keep);
}

function trimKeys(lane: LaneState): void {
  while (lane.keys.size > MAX_KEYS) lane.keys.delete(lane.keys.keys().next().value as string);
}

/** Whether a lane holds anything worth keeping: a penalty, a cooldown, a remembered limit, an unmatched sighting. */
export function worthKeeping(lane: LaneState, now: number): boolean {
  return lane.level > 0 || lane.cooldownUntil > now || lane.ownSeen.length > 0 || lane.ownFacts.length > 0 || [...lane.keys.values()].some((state) => state.badMs > 0 && now - state.badAt < PACE_RULES.badMemoryMs);
}

// ── the stored form (storage.session; architecture §8.4) ─────────────────────

export interface StoredLane {
  readonly aliases: readonly string[];
  readonly usedAt: number;
  readonly cooldownUntil: number;
  readonly level: number;
  readonly gapLevel: number;
  readonly healFrom: number;
  readonly clean: number;
  readonly answered: number;
  /** key → [spacingMs, badMs, badAt] */
  readonly keys: Readonly<Record<string, readonly [number, number, number]>>;
  readonly ownSeen: readonly number[];
  readonly ownFacts: readonly number[];
}

export function storeLane(lane: LaneState): StoredLane {
  return {
    aliases: [...lane.aliases],
    usedAt: lane.usedAt,
    cooldownUntil: lane.cooldownUntil,
    level: lane.level,
    gapLevel: lane.gapLevel,
    healFrom: lane.healFrom,
    clean: lane.clean,
    answered: lane.answered,
    keys: Object.fromEntries([...lane.keys].map(([key, state]) => [key, [state.spacingMs, state.badMs, state.badAt] as const])),
    ownSeen: [...lane.ownSeen],
    ownFacts: [...lane.ownFacts],
  };
}

const time = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0);
const count = (value: unknown, max: number): number => Math.min(max, Math.round(time(value)));
const ID = /^[1-9][0-9]{0,39}$/;

/** A stored lane as it may come back: anything malformed is dropped or zeroed, never trusted; null — not a lane. */
export function readLane(raw: unknown, now: number, withAliases: boolean): LaneState | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const aliases = Array.isArray(value['aliases']) ? value['aliases'].filter((alias): alias is string => typeof alias === 'string' && ID.test(alias)).slice(0, 4) : [];
  if (withAliases && aliases.length === 0) return null;
  const lane = freshLane(aliases);
  lane.usedAt = time(value['usedAt']);
  // A cooldown saved before its cap existed must not park a creator for years.
  lane.cooldownUntil = Math.min(time(value['cooldownUntil']), now + PACE_RULES.retryAfterMaxMs);
  lane.level = count(value['level'], PACE_RULES.maxLevel);
  lane.gapLevel = Math.min(lane.level, count(value['gapLevel'], PACE_RULES.maxLevel));
  lane.healFrom = time(value['healFrom']);
  lane.clean = count(value['clean'], 1_000_000);
  lane.answered = count(value['answered'], 1_000_000);
  const keys = value['keys'];
  if (typeof keys === 'object' && keys !== null && !Array.isArray(keys)) {
    for (const [key, entry] of Object.entries(keys as Record<string, unknown>).slice(0, MAX_KEYS)) {
      if (!Array.isArray(entry) || key.length > 80) continue;
      const policy = policyOf(key);
      const spacingMs = Math.min(policy.ceilMs, Math.max(policy.startMs, time(entry[0])));
      lane.keys.set(key, { spacingMs, lastStartAt: 0, badMs: time(entry[1]), badAt: time(entry[2]) });
    }
  }
  const times = (list: unknown): number[] => (Array.isArray(list) ? list.map(time).filter((at) => at > 0).slice(-MAX_OWN) : []);
  lane.ownSeen = times(value['ownSeen']);
  lane.ownFacts = times(value['ownFacts']);
  return lane;
}
