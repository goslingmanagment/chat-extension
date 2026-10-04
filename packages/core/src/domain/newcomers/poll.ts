// When «Новые» asks the hub again, and which subscriptions are news
// (architecture.md §8.5, §9.8; NF-004, SN-012). The list is polled every 30 s
// while its window is open and every 60 s for the subscriber sound while a
// working tab lives — with a spread so tabs do not fire together, paused
// while the browser is offline, slowed down after failures. Not every 700 ms
// as the Fansly scan did. The first snapshot and the first one after a
// reconnect are silent: old subscriptions are not news. A subscription is
// news once, by the hub's stable event id.

/** AUDIENCE_LIMITS.pollOpenMs / pollSoundMs of the contracts (a test pins them equal). */
export const POLL_OPEN_MS = 30_000;
export const POLL_SOUND_MS = 60_000;
/** Each delay is spread by ±10 %. */
export const POLL_JITTER = 0.1;
/** After failures the period doubles, up to this. */
export const POLL_MAX_BACKOFF_MS = 5 * 60_000;
/** The first poll after coming back online waits up to this long, so tabs do not stampede. */
export const POLL_RESUME_SPREAD_MS = 5_000;
/** Event ids remembered for the «news once» rule. */
export const SEEN_EVENTS_MAX = 2000;

export type PollMode = 'open' | 'sound' | 'off';

/** Why the hub is polled now: the window is open, or only for the subscriber sound, or not at all. */
export function pollMode(input: { readonly windowOpen: boolean; readonly liveTab: boolean; readonly soundOn: boolean }): PollMode {
  if (input.windowOpen) return 'open';
  return input.liveTab && input.soundOn ? 'sound' : 'off';
}

export interface PollState {
  readonly mode: PollMode;
  readonly online: boolean;
  /** Failed polls in a row. */
  readonly failures: number;
}

/** `random` in [0, 1). The delay until the next poll, or null — no poll is due (off, or offline until the browser is back). */
export function nextPollDelay(state: PollState, random: number): number | null {
  if (state.mode === 'off' || !state.online) return null;
  const base = state.mode === 'open' ? POLL_OPEN_MS : POLL_SOUND_MS;
  const backedOff = Math.min(POLL_MAX_BACKOFF_MS, base * 2 ** Math.min(state.failures, 8));
  const spread = 1 + POLL_JITTER * (2 * Math.min(Math.max(random, 0), 0.999_999) - 1);
  return Math.round(backedOff * spread);
}

/** The delay of the first poll after the browser came back online. */
export function resumeDelay(random: number): number {
  return Math.round(POLL_RESUME_SPREAD_MS * Math.min(Math.max(random, 0), 1));
}

export interface SeenEvents {
  /** Event ids already counted, oldest first. */
  readonly ids: readonly string[];
  /** A snapshot was taken since the last (re)connect: the next one may bring news. */
  readonly primed: boolean;
}

export const NO_SEEN_EVENTS: SeenEvents = { ids: [], primed: false };

/** A reconnect (offline, a failed poll, a restarted background): the next snapshot is silent again. */
export function unprime(seen: SeenEvents): SeenEvents {
  return seen.primed ? { ids: seen.ids, primed: false } : seen;
}

/**
 * One snapshot of the list. `fresh` — events this tracker has not counted
 * before AND that came after a primed snapshot: the first snapshot and the
 * one after a reconnect only prime it.
 */
export function observeEvents(seen: SeenEvents, eventRefs: readonly string[]): { readonly seen: SeenEvents; readonly fresh: string[] } {
  const known = new Set(seen.ids);
  const added: string[] = [];
  for (const ref of eventRefs) {
    if (known.has(ref)) continue;
    known.add(ref);
    added.push(ref);
  }
  const ids = [...seen.ids, ...added].slice(-SEEN_EVENTS_MAX);
  return { seen: { ids, primed: true }, fresh: seen.primed ? added : [] };
}
