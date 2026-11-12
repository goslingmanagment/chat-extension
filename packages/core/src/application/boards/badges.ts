// Fansly fans' badges in the boards (2026-10-28; contracts fan-badges.ts): «Онлайн», Spenders, «Рассылка» and «Новые»
// show beside a fan's name FBuddy's gem and Fansly's blue card. One store per board: the board says which fans it shows
// (`want`), the store asks the site for the ones it has not asked lately — a moment later, all of them together, a
// hundred a call, one round at a time (the background keeps each fan's card thirty minutes and asks Fansly and FBuddy
// itself, Fansly's reads of a model 5 s apart) — and tells the board when an answer came. A call not answered is asked
// again half a minute later, if the board still shows those fans. A site without badges (ChatSpace) has no `read`: the
// store asks nothing and knows nothing.
//
// 2026-11-12: the same answer says whether Fansly returned each fan's account to the background's latest read
// (`accounts`): Spenders and «Рассылка» lay it over the hub's word on the fan (domain/fans/account-state.ts).

import { type FanAccountRead } from '@cg/contracts/fan-account';
import { type FanBadgeMark, type FanBadges, type FbuddyState } from '@cg/contracts/fan-badges';

import { createFanRounds } from './fan-rounds';
import { type BoardsClock } from './ports';

/** What one read of the fans' badges answers: the badges, FBuddy's state and (absent — none) the reads of the fans' accounts. */
export interface FanBadgesAnswer {
  readonly fans: ReadonlyMap<string, FanBadges>;
  readonly fbuddy: FbuddyState;
  readonly accounts?: ReadonlyMap<string, FanAccountRead>;
}

/** The site's read of the fans' badges (the background's); null — not read. */
export type FanBadgesRead = (pageId: number, hostAccountId: string, fanRefs: readonly string[]) => Promise<FanBadgesAnswer | null>;

export const FAN_BADGES = {
  /** The fans one read names (the tab message's limit). */
  batch: 100,
  /** The fans one round asks at most: the board's first ones (the most relevant), the rest when they come up again. */
  round: 300,
  /**
   * A fan asked this recently is not asked again. Shorter than the background's thirty minutes on purpose: a card the
   * background could not read (a cooldown; it answers the tab «unknown» all the same) is asked again in five minutes,
   * and one it keeps is answered from its own memory, with no request to Fansly.
   */
  freshMs: 5 * 60_000,
  /** A fan whose call was not answered is asked again no sooner than this. */
  holdMs: 30_000,
  /** The fans wanted within this moment go in one round. */
  settleMs: 250,
} as const;

/**
 * What a fan's row shows, as the ticks of «Значки» name it (the kit's FanBadge draws the same): a gem's tier and the
 * card beside it; the card alone over Basic, as the row has it; Basic; nothing — no badge, or none known yet.
 */
export function fanBadgeMarks(badges: FanBadges | null): readonly FanBadgeMark[] {
  const card = badges?.recentSpender === true;
  const tier = badges?.tier ?? null;
  if (tier !== null && tier !== 'basic') return card ? [tier, 'card'] : [tier];
  if (card) return ['card'];
  return tier === 'basic' ? ['basic'] : ['none'];
}

const MARK_RANK: Readonly<Record<FanBadgeMark, number>> = { platinum: 5, gold: 4, silver: 3, bronze: 2, card: 1, basic: 0, none: 0 };

/** The higher a fan's best mark, the sooner they stand once ticks are on. */
export const fanBadgeRank = (badges: FanBadges | null): number => Math.max(...fanBadgeMarks(badges).map((mark) => MARK_RANK[mark]));

export interface FanBadgeStore {
  /** The fan's badges; null — none known (not read yet, or the site has none). */
  get(fanRef: string): FanBadges | null;
  /** Whether FBuddy's gems could be read on the last answer; null — not asked yet (or the site has none). */
  fbuddy(): FbuddyState | null;
  /** The background's latest read of the fan's account; null — none known (or the site has none). */
  account(fanRef: string): FanAccountRead | null;
  /** One more with every change of what the store knows: a list built over it is built again. */
  version(): number;
  /** The fans the board shows now, the most relevant first: those not asked lately are asked a moment later. */
  want(pageId: number, hostAccountId: string, fanRefs: readonly string[]): void;
  /** Another person, hub or account: everything is forgotten. */
  reset(): void;
  dispose(): void;
}

export function createFanBadgeStore(deps: { readonly read: FanBadgesRead | null; readonly clock: BoardsClock; readonly onChange: () => void }): FanBadgeStore {
  let known = new Map<string, FanBadges>();
  let fbuddy: FbuddyState | null = null;
  let accounts = new Map<string, FanAccountRead>();
  let version = 0;

  /** What a read could not say keeps the last word: a card not read, a tier of a FBuddy that did not answer, an older read of the account. */
  function merge(answer: FanBadgesAnswer): void {
    const next = new Map(known);
    for (const [fanRef, value] of answer.fans) {
      const last = next.get(fanRef);
      next.set(fanRef, { recentSpender: value.recentSpender ?? last?.recentSpender ?? null, tier: answer.fbuddy === 'failed' ? (value.tier ?? last?.tier ?? null) : value.tier });
    }
    known = next;
    fbuddy = answer.fbuddy;
    if (answer.accounts !== undefined && answer.accounts.size > 0) {
      const reads = new Map(accounts);
      for (const [fanRef, read] of answer.accounts) {
        const last = reads.get(fanRef);
        if (last === undefined || read.at >= last.at) reads.set(fanRef, read);
      }
      accounts = reads;
    }
    version += 1;
  }

  const rounds = createFanRounds<FanBadgesAnswer>({
    read: deps.read,
    clock: deps.clock,
    limits: FAN_BADGES,
    answered(answer) {
      merge(answer);
      deps.onChange();
    },
    forgotten() {
      known = new Map();
      fbuddy = null;
      accounts = new Map();
      version += 1;
    },
  });

  return { get: (fanRef) => known.get(fanRef) ?? null, fbuddy: () => fbuddy, account: (fanRef) => accounts.get(fanRef) ?? null, version: () => version, want: rounds.want, reset: rounds.reset, dispose: rounds.dispose };
}
