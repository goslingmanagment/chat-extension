// The Coach dialog as it goes back to the hub (AI-088; architecture.md
// §8.4 `coachHistory`): the last N finished exchanges, oldest first, N from
// the setting (1–20, default 10). A long answer is replayed as its head and
// tail with an explicit omission mark between them — the hub projects every
// replayed answer the same way again, so this only saves bandwidth and can
// never change what the model sees. Failed, canceled and pending turns are
// never replayed.

import { COACH_LIMITS } from '@cg/contracts/limits';
import { type CoachTurn } from '@cg/contracts/ops';
import { SETTINGS_RANGES } from '@cg/contracts/settings';

/** The replay projection (the hub's own numbers). */
export const COACH_PROJECTION = { maxChars: 10_000, headChars: 6_000, tailChars: 3_800 } as const;

/** `generation.coach.historyLimit` held to its range (1–20). */
export function clampHistoryLimit(limit: number): number {
  const { min, max } = SETTINGS_RANGES.coachHistoryLimit;
  if (!Number.isFinite(limit)) return min;
  return Math.max(min, Math.min(max, Math.trunc(limit)));
}

/**
 * An answer within 10 000 characters is replayed as it is; a longer one as
 * its first 6 000 and last 3 800 with «[… N chars omitted …]» between. By
 * code points: a surrogate pair is never split.
 */
export function projectCoachAnswer(answer: string): string {
  const points = Array.from(answer);
  if (points.length <= COACH_PROJECTION.maxChars) return answer;
  const head = points.slice(0, COACH_PROJECTION.headChars).join('');
  const tail = points.slice(points.length - COACH_PROJECTION.tailChars).join('');
  return `${head}\n[… ${points.length - COACH_PROJECTION.headChars - COACH_PROJECTION.tailChars} chars omitted …]\n${tail}`;
}

export interface ReplayableExchange {
  readonly question: string;
  readonly answerRaw: string;
}

/** The exchanges that would be replayed: the last `limit` ones that have both a question and an answer. */
function replayed<T extends ReplayableExchange>(exchanges: readonly T[], limit: number): T[] {
  return exchanges
    .slice(-clampHistoryLimit(limit))
    .slice(-COACH_LIMITS.historyMaxTurns)
    .filter((exchange) => exchange.question.trim().length > 0 && exchange.answerRaw.length > 0);
}

/** How many exchanges `serializeCoachHistory` would send — without projecting a single answer (a view asks this on every redraw). */
export function replayedCount(exchanges: readonly ReplayableExchange[], limit: number): number {
  return replayed(exchanges, limit).length;
}

/** The last `limit` exchanges for `coachHistory`, each within the hub body's bounds. */
export function serializeCoachHistory(exchanges: readonly ReplayableExchange[], limit: number): CoachTurn[] {
  return replayed(exchanges, limit).flatMap((exchange) => {
    const question = exchange.question.trim().slice(0, COACH_LIMITS.questionMaxChars);
    const answer = projectCoachAnswer(exchange.answerRaw).slice(0, COACH_LIMITS.answerMaxChars);
    return question.length === 0 || answer.length === 0 ? [] : [{ question, answer }];
  });
}
