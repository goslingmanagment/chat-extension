// Auto-recap before the first question of a Coach session (AI-096;
// architecture.md §5.6 `generation.coach.autoRecap`, §7 «ход Coach с
// авто-рекапом — один составной слот»). Once per session, when the setting
// is `short` or `full` and the hub has no fresh matching recap, the turn
// first builds one and then asks the Coach — one composite turn, one cancel.
// `short` is satisfied by any fresh recap, `full` only by a fresh full one
// made at the current deep window. A recap older than 24 hours is not
// fresh. If the recap step fails for a reason of the conversation itself
// (too little history, an unusable answer) the question is still asked;
// any other failure stops the turn and keeps the question.

import { type CgCode } from '@cg/contracts/errors';
import { type RecapStatus } from '@cg/contracts/hub';
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
  /** `aiRecapStatus` of this page, fan and persona; null — the read failed or was not made. */
  readonly status: RecapStatus | null;
  /** The deep window a full recap would be made with now. */
  readonly deepWindow: number;
}

/** Which recap the turn builds first, or null — ask right away. */
export function autoRecapFor(facts: AutoRecapFacts): 'short' | 'full' | null {
  if (facts.mode === 'off' || facts.attempted || facts.hasExchanges) return null;
  const status = facts.status;
  if (facts.mode === 'short') return status !== null && (fresh(status.short) || fresh(status.full)) ? null : 'short';
  return status !== null && fresh(status.full) && status.full?.requestedCount === facts.deepWindow ? null : 'full';
}

/** Failures of the recap step that still let the question go to the Coach. */
const PROCEED_CODES: readonly CgCode[] = ['CG-OUTPUT-UNUSABLE', 'CG-GATE-HISTORY', 'CG-PROVIDER-EMPTY'];

/** What a failed recap step does to the composite turn. */
export function recapStepVerdict(code: CgCode): 'proceed' | 'stop' {
  return PROCEED_CODES.includes(code) ? 'proceed' : 'stop';
}
