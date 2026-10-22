// Auto-recap before the first question of a Coach session (AI-096;
// architecture.md §5.6 `generation.coach.autoRecap`, §7 «ход Coach с
// авто-рекапом — один составной слот»). Once per session, when the setting
// is `short` or `full` and the hub has no fresh matching recap, the turn
// first builds one and then asks the Coach — one composite turn, one cancel.
// `short` is satisfied by any fresh recap, `full` only by a fresh full one
// made at the current deep window. A recap older than 24 hours is not
// fresh. A status that could not be read says nothing about what the hub
// holds: nothing is built on a guess, the question goes right away. If the
// recap step fails for a reason of the conversation itself (too little
// history, an unusable answer) the question is still asked; any other
// failure stops the turn and keeps the question.
//
// The turn is one start (`StartOp.coach.autoRecap`): the tab asks once, with
// the token of the click, and the background runs both steps under one
// admission — `coachTurnSteps` is how it reads that start, `recapStepVerdict`
// how it decides whether the question goes on after the recap step.

import { type CgCode } from '@cg/contracts/errors';
import { type RecapStatus } from '@cg/contracts/hub';
import { type StartOp } from '@cg/contracts/ops';
import { type CoachAutoRecap } from '@cg/contracts/settings';

export const COACH_RECAP_FRESH_MS = 24 * 60 * 60 * 1000;

type Slot = RecapStatus['full'];

const fresh = (slot: Slot): boolean => slot !== null && slot.ageMs <= COACH_RECAP_FRESH_MS;

export interface AutoRecapFacts {
  readonly mode: CoachAutoRecap;
  /** The session already tried it (once per session). */
  readonly attempted: boolean;
  /** The session already has a finished exchange: the recap comes before the FIRST question only. */
  readonly hasExchanges: boolean;
  /** `aiRecapStatus` of this page, fan and persona; null — the read failed, so what the hub holds is not known. */
  readonly status: RecapStatus | null;
  /** The deep window a full recap would be made with now. */
  readonly deepWindow: number;
}

/** Which recap the turn builds first, or null — ask right away. */
export function autoRecapFor(facts: AutoRecapFacts): 'short' | 'full' | null {
  if (facts.mode === 'off' || facts.attempted || facts.hasExchanges) return null;
  const status = facts.status;
  // Nothing is built on a guess: a fresh recap may well be there, and a build is paid.
  if (status === null) return null;
  if (facts.mode === 'short') return fresh(status.short) || fresh(status.full) ? null : 'short';
  return fresh(status.full) && status.full?.requestedCount === facts.deepWindow ? null : 'full';
}

/** A copy of a shared Recap as the tab holds it: when it was made. */
interface HeldRecap {
  readonly revision: string;
}

/**
 * What the next first question of a session would build first, as far as the tab's own copies tell — the line of the
 * empty dialog that says the first answer comes later. The status the hub answers at the question decides
 * (`autoRecapFor`); a full Recap made at another depth is not seen here.
 */
export function autoRecapAhead(mode: CoachAutoRecap, held: { readonly short: HeldRecap | null; readonly full: HeldRecap | null }, now: number): 'short' | 'full' | null {
  const young = (copy: HeldRecap | null): boolean => copy !== null && now - Date.parse(copy.revision) <= COACH_RECAP_FRESH_MS;
  if (mode === 'off') return null;
  if (mode === 'short') return young(held.short) || young(held.full) ? null : 'short';
  return young(held.full) ? null : 'full';
}

/** The two steps of a composite Coach turn. */
export interface CoachTurnSteps {
  /** The recap built first: a generation of its own for the same target, past the cache — never a message to the fan. */
  readonly recap: StartOp;
  /** The question itself: the same start without the recap. */
  readonly answer: StartOp;
}

/** How a Coach start that asks for its auto-recap reads as two steps; null — an ordinary start. */
export function coachTurnSteps(start: StartOp): CoachTurnSteps | null {
  const coach = start.feature === 'coach' ? start.coach : undefined;
  if (coach === undefined || coach.autoRecap === undefined) return null;
  const { autoRecap, ...question } = coach;
  return {
    recap: {
      feature: autoRecap.length === 'full' ? 'recap' : 'recap-short',
      surface: start.surface,
      target: start.target,
      cause: start.cause,
      tone: null,
      split: false,
      window: autoRecap.window,
      force: true,
      ...(start.fresh === undefined ? {} : { fresh: start.fresh }),
      ...(start.proof === undefined ? {} : { proof: start.proof }),
    },
    answer: { ...start, coach: question },
  };
}

/** Failures of the recap step that still let the question go to the Coach. */
const PROCEED_CODES: readonly CgCode[] = ['CG-OUTPUT-UNUSABLE', 'CG-GATE-HISTORY', 'CG-PROVIDER-EMPTY'];

/** What a failed recap step does to the composite turn. */
export function recapStepVerdict(code: CgCode): 'proceed' | 'stop' {
  return PROCEED_CODES.includes(code) ? 'proceed' : 'stop';
}
