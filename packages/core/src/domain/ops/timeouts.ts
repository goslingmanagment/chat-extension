// Stream deadlines per feature (architecture.md §7 «Тайм-ауты», RB-002):
// until `meta`, first chunk after `meta`, longest silence between frames,
// and the whole operation. Pure: the scheduler asks for the next deadline
// after every frame and arms one timer. Any of them firing ends the
// operation as failed with CG-HUB-TIMEOUT (RB-003: a timeout is a timeout,
// a cancel is canceled, anything else is the network) — never retried.

import { type CgCode } from '@cg/contracts/errors';
import { type FeatureId } from '@cg/contracts/features';
import { OP_TIMEOUTS, type OpTimeouts } from '@cg/contracts/limits';

export type TimeoutKind = 'until-meta' | 'first-chunk' | 'silence' | 'max';

/** The moments one stream attempt is measured from (epoch ms). */
export interface StreamTimes {
  /** The first request of the operation: the whole-operation maximum counts from here (a retry wait included). */
  readonly opRequestAt: number;
  /** The current attempt's request. */
  readonly attemptAt: number;
  readonly metaAt: number | null;
  readonly firstChunkAt: number | null;
  /** The last frame of the current attempt (any type). */
  readonly lastFrameAt: number | null;
}

export interface Deadline {
  readonly at: number;
  readonly kind: TimeoutKind;
}

/** The code a fired deadline ends the operation with. */
export const TIMEOUT_CODE: CgCode = 'CG-HUB-TIMEOUT';

export function timeoutsOf(feature: FeatureId): OpTimeouts {
  return OP_TIMEOUTS[feature];
}

/** The earliest deadline that applies now; ties resolve to the more specific one. */
export function nextDeadline(feature: FeatureId, times: StreamTimes): Deadline {
  return nextDeadlineFor(timeoutsOf(feature), times);
}

/** A driver supplies its deadlines without adding its operation to the common feature table. */
export function nextDeadlineFor(t: OpTimeouts, times: StreamTimes): Deadline {
  const candidates: Deadline[] = [];
  if (times.metaAt === null) candidates.push({ at: times.attemptAt + t.untilMetaMs, kind: 'until-meta' });
  else {
    if (times.firstChunkAt === null) candidates.push({ at: times.metaAt + t.firstChunkAfterMetaMs, kind: 'first-chunk' });
    const since = Math.max(times.metaAt, times.lastFrameAt ?? times.metaAt);
    candidates.push({ at: since + t.silenceMs, kind: 'silence' });
  }
  candidates.push({ at: times.opRequestAt + t.maxMs, kind: 'max' });
  let best = candidates[0] as Deadline;
  for (const candidate of candidates) if (candidate.at < best.at) best = candidate;
  return best;
}

/** Which deadline (if any) has passed at `now`. */
export function expiredDeadline(feature: FeatureId, times: StreamTimes, now: number): Deadline | null {
  const deadline = nextDeadline(feature, times);
  return now >= deadline.at ? deadline : null;
}
