// How a board asks about the fans it shows (badges.ts, other-pages.ts): the board says which fans it shows (`want`), the
// rounds ask for the ones not asked lately, a moment later, all of them together, a batch a call. Another page or account
// forgets everything. A site without the read asks nothing.
//
// 2026-11-12: one round at a time per store. A board that wants fans while a round runs (its own answer re-renders it)
// only adds them; the next round is armed when the running one ends. A batch that was not read (its answer null) is
// asked again when the board wants it after `holdMs`, not after the whole freshness.

import { type BoardsClock } from './ports';

export interface FanRoundLimits {
  /** The fans one read names (the tab message's limit). */
  readonly batch: number;
  /** The fans one round asks at most: the board's first ones (the most relevant), the rest when they come up again. */
  readonly round: number;
  /** A fan asked this recently is not asked again. */
  readonly freshMs: number;
  /** A fan whose batch was not read is asked again no sooner than this (when the board still wants it). */
  readonly holdMs: number;
  /** The fans wanted within this moment go in one round. */
  readonly settleMs: number;
}

export interface FanRounds {
  /** The fans the board shows now, the most relevant first: those not asked lately are asked a moment later. */
  readonly want: (pageId: number, hostAccountId: string, fanRefs: readonly string[]) => void;
  /** Another person, hub or account: everything is forgotten. */
  readonly reset: () => void;
  readonly dispose: () => void;
}

export function createFanRounds<A>(deps: {
  /** Null answer: not read; these fans keep what is known of them. */
  readonly read: ((pageId: number, hostAccountId: string, fanRefs: readonly string[]) => Promise<A | null>) | null;
  readonly clock: BoardsClock;
  readonly limits: FanRoundLimits;
  readonly answered: (answer: A, fanRefs: readonly string[]) => void;
  readonly forgotten: () => void;
}): FanRounds {
  const { read, clock, limits } = deps;
  /** When each fan may be asked again: fresh after it was asked (or is being asked now), sooner when its read failed. */
  let until = new Map<string, number>();
  /** The page and account the rounds are about: another one forgets everything. */
  let scope: string | null = null;
  let target: { readonly pageId: number; readonly hostAccountId: string } | null = null;
  let pending: string[] = [];
  let timer: number | null = null;
  /** A round is asking now: the next one waits for its end. */
  let running = false;
  let generation = 0;
  let disposed = false;

  const forget = (): void => {
    deps.forgotten();
    until = new Map();
    pending = [];
    generation += 1;
    // A round of the old scope ends at its next answer, which is dropped: the new scope does not wait for it.
    running = false;
    if (timer !== null) clock.clearTimer(timer);
    timer = null;
  };

  /** The next round a moment from now, unless one runs or is armed. */
  const arm = (): void => {
    if (disposed || running || timer !== null || pending.length === 0) return;
    timer = clock.setTimer(limits.settleMs, () => void round());
  };

  async function round(): Promise<void> {
    timer = null;
    const at = target;
    const fans = pending.slice(0, limits.round);
    pending = [];
    if (read === null || at === null || fans.length === 0) return;
    const run = generation;
    running = true;
    try {
      for (let offset = 0; offset < fans.length; offset += limits.batch) {
        const batch = fans.slice(offset, offset + limits.batch);
        const answer = await read(at.pageId, at.hostAccountId, batch).catch(() => null);
        if (disposed || run !== generation) return;
        if (answer !== null) deps.answered(answer, batch);
        else for (const fanRef of batch) until.set(fanRef, clock.now() + limits.holdMs);
      }
    } finally {
      if (run === generation) {
        running = false;
        arm();
      }
    }
  }

  return {
    want(pageId, hostAccountId, fanRefs) {
      if (read === null || disposed) return;
      const key = `${pageId}:${hostAccountId}`;
      if (key !== scope) {
        forget();
        scope = key;
      }
      target = { pageId, hostAccountId };
      const now = clock.now();
      for (const fanRef of fanRefs) {
        if (pending.length >= limits.round) break;
        const next = until.get(fanRef);
        if (next !== undefined && now < next) continue;
        until.set(fanRef, now + limits.freshMs);
        pending.push(fanRef);
      }
      arm();
    },
    reset() {
      forget();
      scope = null;
      target = null;
    },
    dispose() {
      disposed = true;
      forget();
    },
  };
}
