// Fansly's proof of an AI start (docs/project-unite/architecture.md §5.8, §9.1;
// spec FS-TAIL-1, FS-TAIL-6, FS-TAIL-10; R20 P8b1): MAIN's generation snapshot
// of the Generate click as the shared proof every host's start may carry
// (`CoverageProof`, contracts 1.15.0, P4b1). Pure: no port, no clock.
//
// - The check window is the chat's last min(60, N) messages, N the messageCount
//   the start asks the hub for (FS-TAIL-1; Hi — 25): with a window wider than N
//   the hub would rightly answer the oldest ids `outside_window`, and every Fix
//   (25 by default) would read as a miss.
// - The ids go as MAIN gave them, in its order — the window and the deleted ones
//   oldest first, the hub's answers keep that order; the fan's known ids newest
//   first, as the hub body takes them (`knownFanMessageIds`).
// - The deleted ones are at most the hub's 60 (`COVERAGE_CHECK_LIMITS`). MAIN
//   names every deletion of the window's span it saw (its ring holds 120); with
//   more than 60 the tab cannot have the hub check them all, and a stale context
//   could pass unseen: the newest 60 go, and the observation reads `unknown` —
//   «свежесть не проверена», never a guess.
// - The tail — Reply, Fix, Hi and Ping only, and only where the page admits fresh
//   text (D-14: `AiProofAsk.fresh`) — is cut to the bootstrap's limits as
//   ChatSpace's tail is (`trimFreshTail`): the newest texts, each within the
//   limit. Recap, Review and Coach never carry one (FS-TAIL-10).

import type { FanslySnapshot } from '@cg/contracts/fansly';
import type { FeatureId } from '@cg/contracts/features';
import { AI_REQUEST_LIMITS, COVERAGE_CHECK_LIMITS } from '@cg/contracts/limits';
import type { AiProofAsk, CoverageProof } from '@cg/contracts/ops';
import type { SettingsV1 } from '@cg/contracts/settings';

import { messageWindowFor } from '../../../../domain/ops/request';

/** The person's message windows of the settings (Б5): what a start's messageCount is made of. */
export type MessageWindows = SettingsV1['generation']['windows'];

/**
 * FS-TAIL-1: the check window of a start — min(60, its messageCount). The count is the one the shared plan gives a
 * start without a one-off window (`windowFor`); the deep windows (Review, Recap: at least 100) and their cap by the
 * bootstrap's `deepMax` give 60 whatever they are. Should the plan still ask for less than the window (a cap below
 * 60, a setting changed in between), the background raises the count to the window (`buildStreamRequest`).
 */
export function checkWindowOf(feature: FeatureId, windows: MessageWindows): number {
  return Math.min(COVERAGE_CHECK_LIMITS.windowMax, messageWindowFor(feature, windows, AI_REQUEST_LIMITS.messageCountMax));
}

/** The snapshot's texts as a start may carry them: the newest `maxItems`, each within `maxChars` (D-14). */
function tailOf(tail: NonNullable<FanslySnapshot['tail']>, fresh: NonNullable<AiProofAsk['fresh']>): NonNullable<Extract<CoverageProof, { kind: 'tab-snapshot' }>['tail']> {
  return tail.slice(-fresh.maxItems).map((message) => (message.text.length > fresh.maxChars ? { ...message, text: message.text.slice(0, fresh.maxChars) } : message));
}

/**
 * The start's proof of one snapshot: the snapshot's chat, observation, window and ids; its texts only where the start
 * may carry fresh text (`fresh` non-null). `takenAt` — when the tab took it (the tail's `capturedAt` on the wire).
 */
export function startProofOf(snapshot: FanslySnapshot, fresh: AiProofAsk['fresh'], takenAt: string): Extract<CoverageProof, { kind: 'tab-snapshot' }> {
  const deletedIds = snapshot.deletedIds.slice(-COVERAGE_CHECK_LIMITS.deletedMax);
  const tail = fresh === null || snapshot.tail === undefined ? undefined : tailOf(snapshot.tail, fresh);
  return {
    kind: 'tab-snapshot',
    conversationRef: snapshot.identity.groupId,
    completeness: deletedIds.length < snapshot.deletedIds.length ? 'unknown' : snapshot.completeness,
    takenAt,
    window: snapshot.window.map((entry) => ({ id: entry.id, dir: entry.dir })),
    knownFanMessageIds: [...snapshot.knownFanMessageIds].reverse(),
    deletedIds,
    ...(tail === undefined ? {} : { tail }),
    truncated: tail !== undefined && snapshot.truncated,
  };
}
