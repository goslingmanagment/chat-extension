// The pacer's rules as data (R20 docs/project-unite/architecture.md §8.4;
// spec FS-NET-3, NF-037, RB-023). They are the old Fansly extension's
// `fansly-pacer` (E130–E135 in fansly-chat docs/decisions.md; its
// src/background/fansly-pacer/policy.ts, pacer.ts), measured on production
// there and kept as they are — what changes here is around them: a mode per
// call (allowlist.ts), a cooldown from ANY 429 (ours and the page's, seen by
// the core's `webRequest.onCompleted`), state that survives the event page.
//
// A new key or a different pace is a row here, not a change of the pacer.

export interface KeyPolicy {
  /** Spacing between two starts of the key; a limit only ever widens it. */
  readonly startMs: number;
  /** However often the key is limited, its spacing stops here. */
  readonly ceilMs: number;
  /**
   * Measured to be limited on its own (E128): its first limit slows only this key, not the lane. Without that
   * evidence one limit slows everything (E133).
   */
  readonly isolated?: true;
}

export const PACE_RULES = {
  /** E130: the gap between any two starts of one creator's calls; 0–100 ms jitter rides on the deadline that binds (E133). */
  laneGapMs: 400,
  /** E130: each unhealed limit doubles the lane gap, up to here. */
  laneGapMaxMs: 8000,
  jitterMs: 100,
  /** E130: a key's own spacing, by default. FBuddy starts every route at 400 ms and only speeds up; ours never does. */
  keyDefault: { startMs: 500, ceilMs: 8000 } satisfies KeyPolicy,
  /**
   * Keys that evidence says share a limit (allowlist.ts names each route's key). `/account*` is a live measurement
   * (E128): the only 429 was the third `/account?ids=` read 2 s apart and also the fifth `/account*` read in 10 s, so
   * the follower pages share the key with the id reads and the identity.
   */
  keys: { 'GET /account*': { startMs: 5000, ceilMs: 20_000, isolated: true } } satisfies Record<string, KeyPolicy>,
  /**
   * E133: a cooldown = max(Retry-After, capped; the ladder 30/60/120/240/300 s by level; 1.25 s per read answered since
   * the previous limit, up to 300 s). The page's 429 carries no Retry-After for us (`onCompleted` has no headers): its
   * ladder and answers decide.
   */
  cooldownBaseMs: 30_000,
  cooldownMaxMs: 300_000,
  cooldownPerAnswerMs: 1250,
  /** A server-requested wait is honoured up to here: a skewed HTTP date must not park a creator for days. */
  retryAfterMaxMs: 6 * 3600_000,
  /** Levels of penalty a creator's lane climbs to. */
  maxLevel: 5,
  /** E128: one level is forgiven after this long since the cooldown ended AND then this many answered reads. */
  healMs: 300_000,
  healReads: 20,
  /** E121: a lane idle this long starts over; what Fansly refused (a key's limit) is not forgotten by waiting. */
  idleMs: 900_000,
  /** E130: a limited spacing is remembered this long, and the key stays a quarter above it. */
  badMemoryMs: 24 * 3600_000,
  badMargin: 1.25,
  /**
   * §8.4: a 429 of our own request is seen twice — by the client, and by the core's listener (a fact `own`). Two
   * sightings of one creator closer than this are one response, one limit.
   */
  dedupMs: 10_000,
} as const;

/** RB-023: how a request is asked and asked again. */
export const REQUEST_RULES = {
  /** A read of a running pass is asked again after these on a 5xx; a 429 is asked again after the cooldown. */
  retryDelaysMs: [1000, 2000, 4000],
  /** No answer in this long is no answer (the request is aborted). */
  timeoutMs: 30_000,
  /** A body of ours is a note or a greeting: far below this. */
  bodyMaxChars: 64 * 1024,
} as const;

/** The policy of a key; a saved key outlives the code that wrote it: an unknown one gets the default. */
export function policyOf(key: string): KeyPolicy {
  const keys: Readonly<Record<string, KeyPolicy>> = PACE_RULES.keys;
  return Object.prototype.hasOwnProperty.call(keys, key) ? (keys[key] ?? PACE_RULES.keyDefault) : PACE_RULES.keyDefault;
}

/** The lane gap at a level of widening. */
export const laneGapMs = (gapLevel: number): number => Math.min(PACE_RULES.laneGapMaxMs, PACE_RULES.laneGapMs * 2 ** gapLevel);
