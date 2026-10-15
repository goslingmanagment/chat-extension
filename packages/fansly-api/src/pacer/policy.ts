/** Pacing policy is data. A route family has its own spacing; a limit can
 * also widen the creator lane (E133). A new family or pace is one row here,
 * rather than a scheduler change (E130). */
export interface PacePolicy {
  /** Spacing between starts on this key; a limit only ever widens it. */
  startMs: number;
  /** Spacing never grows past this, however often the key is limited. */
  ceilMs: number;
  /** Measured to be limited on its own: its first limit slows only this key,
   * not the lane. Without that evidence one limit slows everything (E133). */
  isolated?: boolean;
}

export const LANE_GAP_MS = 400;
export const LANE_GAP_MAX_MS = 8000;
/** Uniform 0..JITTER added to every lane gap: no metronome signature. */
export const LANE_JITTER_MS = 100;
export const READ_RETRY_DELAYS_MS = [1000, 2000, 4000] as const;

/** E130–E135 after E133's correction: idle never proves a refused pace safe. */
export const RECOVERY = {
  maxLevel: 5, healMs: 300_000, healReads: 20, idleMs: 900_000,
  cooldownStepMs: 30_000, cooldownMaxMs: 300_000, perAnswerMs: 1250,
  retryAfterMaxMs: 6 * 3600_000, saveEveryMs: 60_000,
} as const;

/** FBuddy starts every route at 400 ms and only speeds up from there. Here
 * 400 ms is the gap of the whole creator lane and one key runs at 500 ms. */
const DEFAULT_POLICY: PacePolicy = { startMs: 500, ceilMs: 8000 };

/** Families group paths that evidence says share a limit. `/account*` is a
 * live measurement (E128): the only 429 was the third `/account?ids=` read 2 s
 * apart and also the fifth `/account*` read in 10 s. One trace cannot tell
 * those apart, so follower pages share the key with the id reads. */
const FAMILIES: ReadonlyArray<{ key: string; method: string; match: RegExp; policy: PacePolicy }> = [
  { key: 'GET /account*', method: 'GET', match: /^\/api\/v1\/account(?:\/|$)/, policy: { startMs: 5000, ceilMs: 20_000, isolated: true } },
];

/** A saved key outlives the code that wrote it; an unknown one gets the default. */
export const policyOf = (key: string): PacePolicy => FAMILIES.find((entry) => entry.key === key)?.policy ?? DEFAULT_POLICY;

export function paceFor(method: string, pathname: string): { key: string; policy: PacePolicy } {
  const family = FAMILIES.find((entry) => entry.method === method.toUpperCase() && entry.match.test(pathname));
  if (family) return { key: family.key, policy: family.policy };
  const path = pathname.replace(/^\/api\/v\d+/, '').split('/').map((part) => (/^\d+$/.test(part) ? ':id' : part)).join('/');
  return { key: `${method.toUpperCase()} ${path}`, policy: DEFAULT_POLICY };
}
