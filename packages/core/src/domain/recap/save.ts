// Saving a full Recap as the fan's dossier (AI-067, AI-068, AI-071;
// architecture.md §7 «Recap: общий и досье», H-5). On `done` of a full
// `fan-summary` the background writes the dossier link
// (`profileFromGeneration`): an idempotent server-side reference write,
// never a new generation and never the text. The hub may not have the
// generation ready yet: `not-ready` is repeated after 5 s, 15 s, 60 s, then
// every 3 minutes, for at most 30 minutes, while the tab is open. The end
// is «Сохранено в хаб» or CG-RECAP-SAVE with «Сохранить ещё раз», which
// repeats only that write. A short recap has no dossier.

import { HUB_FACADE_TIMING } from '@cg/contracts/hub';

export type SaveAnswer = 'saved' | 'not-ready' | 'rejected' | 'error';

export type RecapSaveState =
  /** A short recap, or nothing to save. */
  | { readonly s: 'not-applicable' }
  /** The write is on its way or waits for its next attempt at `nextAt` (null — in flight). */
  | { readonly s: 'saving'; readonly startedAt: number; readonly attempts: number; readonly nextAt: number | null }
  | { readonly s: 'saved'; readonly at: string | null }
  /** CG-RECAP-SAVE: refused, failed, or not ready for 30 minutes. */
  | { readonly s: 'failed'; readonly reason: 'rejected' | 'error' | 'gave-up' | 'tab-closed' };

/** The pause before attempt `n + 1` after `n` attempts answered `not-ready` (n ≥ 1). */
export function saveRetryDelay(attempts: number): number {
  return HUB_FACADE_TIMING.profileSaveDelaysMs[attempts - 1] ?? HUB_FACADE_TIMING.profileSaveThenEveryMs;
}

export function saveStarted(now: number): RecapSaveState {
  return { s: 'saving', startedAt: now, attempts: 0, nextAt: null };
}

/**
 * The state after one attempt answered. `not-ready` schedules the next
 * attempt unless it would start later than 30 minutes after the first; a
 * transport failure is not repeated by itself.
 */
export function saveAnswered(state: RecapSaveState, answer: SaveAnswer, now: number, savedAt: string | null = null): RecapSaveState {
  if (state.s !== 'saving') return state;
  if (answer === 'saved') return { s: 'saved', at: savedAt };
  if (answer === 'rejected' || answer === 'error') return { s: 'failed', reason: answer };
  const attempts = state.attempts + 1;
  const nextAt = now + saveRetryDelay(attempts);
  if (nextAt - state.startedAt > HUB_FACADE_TIMING.profileSaveGiveUpMs) return { s: 'failed', reason: 'gave-up' };
  return { s: 'saving', startedAt: state.startedAt, attempts, nextAt };
}

/** The whole schedule of retry moments, as offsets from the first attempt (for tests and the docs). */
export function saveSchedule(): number[] {
  const offsets: number[] = [];
  let state = saveStarted(0);
  let now = 0;
  for (;;) {
    state = saveAnswered(state, 'not-ready', now);
    if (state.s !== 'saving' || state.nextAt === null) return offsets;
    now = state.nextAt;
    offsets.push(now);
  }
}
