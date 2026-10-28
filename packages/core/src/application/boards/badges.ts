// Fansly fans' badges in the boards (2026-10-28; contracts fan-badges.ts): «Онлайн», Spenders, «Рассылка» and «Новые»
// show beside a fan's name FBuddy's gem and Fansly's blue card. One store per board: the board says which fans it shows
// (`want`), the store asks the site for the ones it has not asked lately — a moment later, all of them together, a
// hundred a call (the background keeps each fan ten minutes and asks Fansly and FBuddy itself) — and tells the board
// when an answer came. A site without badges (ChatSpace) has no `read`: the store asks nothing and knows nothing.

import { type FanBadges, type FbuddyState } from '@cg/contracts/fan-badges';

import { type BoardsClock } from './ports';

/** The site's read of the fans' badges (the background's); null — not read. */
export type FanBadgesRead = (pageId: number, hostAccountId: string, fanRefs: readonly string[]) => Promise<{ readonly fans: ReadonlyMap<string, FanBadges>; readonly fbuddy: FbuddyState } | null>;

export const FAN_BADGES = {
  /** The fans one read names (the tab message's limit). */
  batch: 100,
  /** The fans one round asks at most: the board's first ones (the most relevant), the rest when they come up again. */
  round: 300,
  /** A fan asked this recently is not asked again (the background keeps its answer ten minutes). */
  freshMs: 5 * 60_000,
  /** The fans wanted within this moment go in one round. */
  settleMs: 250,
} as const;

export interface FanBadgeStore {
  /** The fan's badges; null — none known (not read yet, or the site has none). */
  get(fanRef: string): FanBadges | null;
  /** Whether FBuddy's gems could be read on the last answer; null — not asked yet (or the site has none). */
  fbuddy(): FbuddyState | null;
  /** The fans the board shows now, the most relevant first: those not asked lately are asked a moment later. */
  want(pageId: number, hostAccountId: string, fanRefs: readonly string[]): void;
  /** Another person, hub or account: everything is forgotten. */
  reset(): void;
  dispose(): void;
}

export function createFanBadgeStore(deps: { readonly read: FanBadgesRead | null; readonly clock: BoardsClock; readonly onChange: () => void }): FanBadgeStore {
  const { read, clock } = deps;
  let known = new Map<string, FanBadges>();
  let fbuddy: FbuddyState | null = null;
  /** When each fan was last asked for (or is being asked now). */
  let asked = new Map<string, number>();
  /** The page and account the store is about: another one forgets everything. */
  let scope: string | null = null;
  let target: { readonly pageId: number; readonly hostAccountId: string } | null = null;
  let pending: string[] = [];
  let timer: number | null = null;
  let generation = 0;
  let disposed = false;

  const forget = (): void => {
    known = new Map();
    fbuddy = null;
    asked = new Map();
    pending = [];
    generation += 1;
    if (timer !== null) clock.clearTimer(timer);
    timer = null;
  };

  /** What a read could not say keeps the last word: a card not read, a tier of a FBuddy that did not answer. */
  function merge(fans: ReadonlyMap<string, FanBadges>, state: FbuddyState): void {
    const next = new Map(known);
    for (const [fanRef, value] of fans) {
      const last = next.get(fanRef);
      next.set(fanRef, { recentSpender: value.recentSpender ?? last?.recentSpender ?? null, tier: state === 'failed' ? (value.tier ?? last?.tier ?? null) : value.tier });
    }
    known = next;
    fbuddy = state;
  }

  async function round(): Promise<void> {
    timer = null;
    const at = target;
    const fans = pending.slice(0, FAN_BADGES.round);
    pending = [];
    if (read === null || at === null || fans.length === 0) return;
    const run = generation;
    for (let offset = 0; offset < fans.length; offset += FAN_BADGES.batch) {
      const answer = await read(at.pageId, at.hostAccountId, fans.slice(offset, offset + FAN_BADGES.batch)).catch(() => null);
      if (disposed || run !== generation) return;
      if (answer === null) continue;
      merge(answer.fans, answer.fbuddy);
      deps.onChange();
    }
  }

  return {
    get: (fanRef) => known.get(fanRef) ?? null,
    fbuddy: () => fbuddy,
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
        if (pending.length >= FAN_BADGES.round) break;
        const last = asked.get(fanRef);
        if (last !== undefined && now - last < FAN_BADGES.freshMs) continue;
        asked.set(fanRef, now);
        pending.push(fanRef);
      }
      if (pending.length > 0 && timer === null) timer = clock.setTimer(FAN_BADGES.settleMs, () => void round());
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
