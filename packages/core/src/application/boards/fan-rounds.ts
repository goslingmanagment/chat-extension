// How a board asks about the fans it shows (badges.ts, other-pages.ts): the board says which fans it shows (`want`), the
// rounds ask for the ones not asked lately, a moment later, all of them together, a batch a call. Another page or account
// forgets everything. A site without the read asks nothing.

import { type BoardsClock } from './ports';

export interface FanRoundLimits {
  /** The fans one read names (the tab message's limit). */
  readonly batch: number;
  /** The fans one round asks at most: the board's first ones (the most relevant), the rest when they come up again. */
  readonly round: number;
  /** A fan asked this recently is not asked again. */
  readonly freshMs: number;
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
  /** When each fan was last asked for (or is being asked now). */
  let asked = new Map<string, number>();
  /** The page and account the rounds are about: another one forgets everything. */
  let scope: string | null = null;
  let target: { readonly pageId: number; readonly hostAccountId: string } | null = null;
  let pending: string[] = [];
  let timer: number | null = null;
  let generation = 0;
  let disposed = false;

  const forget = (): void => {
    deps.forgotten();
    asked = new Map();
    pending = [];
    generation += 1;
    if (timer !== null) clock.clearTimer(timer);
    timer = null;
  };

  async function round(): Promise<void> {
    timer = null;
    const at = target;
    const fans = pending.slice(0, limits.round);
    pending = [];
    if (read === null || at === null || fans.length === 0) return;
    const run = generation;
    for (let offset = 0; offset < fans.length; offset += limits.batch) {
      const batch = fans.slice(offset, offset + limits.batch);
      const answer = await read(at.pageId, at.hostAccountId, batch).catch(() => null);
      if (disposed || run !== generation) return;
      if (answer !== null) deps.answered(answer, batch);
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
        const last = asked.get(fanRef);
        if (last !== undefined && now - last < limits.freshMs) continue;
        asked.set(fanRef, now);
        pending.push(fanRef);
      }
      if (pending.length > 0 && timer === null) timer = clock.setTimer(limits.settleMs, () => void round());
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
