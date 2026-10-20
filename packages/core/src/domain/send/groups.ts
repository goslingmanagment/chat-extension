// Parts of one generation as one send group (architecture.md §6.7.9): one
// click — one part, each part its own attempt, custody and receipt, the
// group's freshness checkpoint shared. A confirmed part is never sent again;
// a proven refusal of an unchanged part is not retried; parts go in any
// order; an unknown outcome holds nothing — the person may send again; after a
// greeting's first confirmed part another generation is a second greeting
// and is refused, while the same owner may still send the rest of the group.
// There is no «send all», no timer and no automatic next part.

import { type CgCode } from '@cg/contracts/errors';
import { type PartRef } from '@cg/contracts/ids';
import { type OpView } from '@cg/contracts/ops';
import { type SendGroup } from '@cg/contracts/send';
import { type SendAttemptState } from '@cg/contracts/send-rules';
import { type SendOrderVM } from '@cg/contracts/vm';

import { type SendPurpose } from './custody';

/** What is known about one attempt to the same fan. */
export interface FanAttempt {
  readonly attemptId: string;
  readonly purpose: SendPurpose;
  readonly group: SendGroup;
  readonly partIndex: number;
  readonly state: SendAttemptState;
  /** The hub resolved it in an audited support action (H-7 `resolve`). */
  readonly resolved?: 'sent' | 'not-sent';
}

const sameGroup = (a: SendGroup, b: SendGroup): boolean => a.generationRef === b.generationRef && a.variant === b.variant;

/** Counted as delivered for the group rules: proven, or resolved «sent» in the hub. */
export function partDelivered(attempt: FanAttempt): boolean {
  return attempt.state === 'sentObserved' || attempt.resolved === 'sent';
}

export interface PartRequest {
  readonly purpose: SendPurpose;
  readonly group: SendGroup;
  readonly partIndex: number;
}

/** Why this part may not get a new attempt, from what is known about the fan; null — it may. */
export function partBlock(request: PartRequest, attempts: readonly FanAttempt[]): CgCode | null {
  // An unknown outcome holds nothing (2026-10-20 audit, row 2): the person looks at the chat and decides.
  for (const attempt of attempts) {
    if (attempt.resolved === 'sent' && sameGroup(attempt.group, request.group) && attempt.partIndex === request.partIndex) return 'CG-SEND-PART';
  }
  for (const attempt of attempts) {
    const samePart = sameGroup(attempt.group, request.group) && attempt.partIndex === request.partIndex;
    if (samePart && (partDelivered(attempt) || attempt.state === 'rejected')) return 'CG-SEND-PART';
  }
  if (request.purpose === 'greeting') {
    const greetedByOther = attempts.some((attempt) => attempt.purpose === 'greeting' && partDelivered(attempt) && !sameGroup(attempt.group, request.group));
    if (greetedByOther) return 'CG-CLAIM-BUSY';
  }
  return null;
}

/**
 * The order hint of a part (vm SendOrderVM): none of its own. Parts go in any order and may be skipped (2026-10-20
 * audit, row 13), and an unknown outcome of an earlier part holds nothing (row 2).
 */
export function sendOrderOf(_group: SendGroup, _partIndex: number, _attempts: readonly FanAttempt[]): SendOrderVM | null {
  return null;
}

/** «отправлено N из M» of a group. */
export function groupProgress(group: SendGroup, attempts: readonly FanAttempt[]): { readonly sent: number; readonly total: number } {
  const sent = new Set(attempts.filter((attempt) => sameGroup(attempt.group, group) && partDelivered(attempt)).map((attempt) => attempt.partIndex));
  return { sent: sent.size, total: group.partCount };
}

/**
 * The part of a preview's or a «Новые» card's finished result as a member of
 * its send group (§6.6, §6.7.9): what a proven human send of that part is
 * recorded and registered under. null — the operation is not such a result
 * (the dock's own have no preview custody), is not finished, or has no such
 * part.
 */
export function nativePartOf(view: OpView, part: PartRef): { readonly purpose: SendPurpose; readonly group: SendGroup; readonly partIndex: number } | null {
  if (view.surface !== 'preview' && view.surface !== 'newcomers') return null;
  if (view.state !== 'done' || view.generationRef === undefined || view.result === undefined) return null;
  const variant = part.variant ?? 0;
  const parts = view.result.kind === 'parts' ? (variant === 0 ? view.result.parts : undefined) : view.result.kind === 'variants' ? view.result.variants[variant] : undefined;
  if (parts === undefined || part.index >= parts.length) return null;
  return { purpose: view.surface === 'newcomers' ? 'greeting' : 'preview-reply', group: { generationRef: view.generationRef, variant, partCount: parts.length }, partIndex: part.index };
}
