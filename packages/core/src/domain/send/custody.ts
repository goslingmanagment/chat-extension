// The hub custody of a preview send (architecture.md §6.7.7 п. 4–6, §6.7.11,
// H-7, contracts SEND_CUSTODY_REPORTS): every click asks `dispatch`, which
// checks the flag, rights, rate, lease and any unresolved send to the fan
// atomically and answers ONE short ticket for exactly this attempt. What
// ends an attempt is reported only on proof: `held`/`notEnqueued` (nothing
// reached the queue) → `failed: not_enqueued`; a proven native refusal →
// `failed: native_rejected` with its 4xx; receipt + echo → `sent`;
// `uncertain` reports nothing — the custody stays until the late linked pair
// or an owner's `resolve` in the hub. `dispatch` itself is never repeated.

import { type CgCode } from '@cg/contracts/errors';
import { CUSTODY_BLOCKING_STATES, isCustodyTransition, type ClaimBody, type ClaimState, type CustodyState, type HubFailure } from '@cg/contracts/hub';
import { type DispatchTicket, type SEND_PURPOSES, type SendGroup } from '@cg/contracts/send';
import { SEND_CUSTODY_REPORTS, isNativeRefusalStatus, localDeadline, type SendAttemptState } from '@cg/contracts/send-rules';

export type SendPurpose = (typeof SEND_PURPOSES)[number];

export interface DispatchInput {
  readonly attemptId: string;
  readonly instanceId: string;
  readonly purpose: SendPurpose;
  readonly group: SendGroup;
  readonly partIndex: number;
  readonly textRevision: number;
  readonly leaseToken?: string;
  /** bootstrap configRevision the client acted on. */
  readonly flagRevision: number;
}

export function dispatchBody(input: DispatchInput): ClaimBody {
  return {
    action: 'dispatch',
    attemptId: input.attemptId,
    instanceId: input.instanceId,
    purpose: input.purpose,
    group: { generationRef: input.group.generationRef, variant: input.group.variant, partCount: input.group.partCount },
    partIndex: input.partIndex,
    textRevision: input.textRevision,
    ...(input.leaseToken === undefined ? {} : { leaseToken: input.leaseToken }),
    flagRevision: input.flagRevision,
  };
}

export type DispatchReading =
  | { readonly kind: 'ticket'; readonly ticket: DispatchTicket }
  /** No usable ticket: nothing may go to MAIN. `opened`: the hub holds a custody of ours to close. */
  | { readonly kind: 'no-ticket'; readonly code: CgCode; readonly opened: boolean };

/**
 * The answer to our `dispatch`: a ticket for exactly this attempt, moved onto
 * the local clock from the server's own time (a skewed client clock neither
 * holds every send nor lets MAIN commit late), with a safety margin.
 */
export function readDispatch(state: ClaimState, attemptId: string, partIndex: number, receivedAt: number): DispatchReading {
  const custody = state.custody;
  if (custody === null || custody.attemptId !== attemptId) {
    const partSent = state.group !== null && state.group.sentParts.includes(partIndex);
    const blocked = custody !== null && (CUSTODY_BLOCKING_STATES as readonly CustodyState[]).includes(custody.state);
    return { kind: 'no-ticket', code: partSent ? 'CG-SEND-PART' : blocked ? 'CG-SEND-UNCERTAIN' : 'CG-HUB-REQUEST', opened: false };
  }
  if (custody.state !== 'dispatching') return { kind: 'no-ticket', code: custody.state === 'sent' ? 'CG-SEND-PART' : 'CG-HUB-REQUEST', opened: false };
  if (custody.ticket === null || custody.ticketExpiresAt === null) return { kind: 'no-ticket', code: 'CG-HUB-REQUEST', opened: true };
  const expiresAt = localDeadline(custody.ticketExpiresAt, state.serverNow, receivedAt);
  if (expiresAt === null || expiresAt <= receivedAt) return { kind: 'no-ticket', code: 'CG-TIMEOUT', opened: true };
  return { kind: 'ticket', ticket: { attemptId, ticket: custody.ticket, expiresAt } };
}

export interface ReportInput {
  readonly attemptId: string;
  readonly instanceId: string;
  readonly state: SendAttemptState;
  readonly httpStatus?: number;
  readonly platformMessageId?: string;
  /** The attempt reached the hub's `dispatch` (or may have: its answer was lost). */
  readonly dispatched: boolean;
}

/** The custody report an ended attempt owes the hub, or null (SEND_CUSTODY_REPORTS). */
export function custodyReport(input: ReportInput): ClaimBody | null {
  if (!input.dispatched) return null;
  const report = SEND_CUSTODY_REPORTS[input.state];
  switch (report) {
    case null:
      return null;
    case 'failed-not-enqueued':
      return { action: 'failed', attemptId: input.attemptId, instanceId: input.instanceId, reason: 'not_enqueued' };
    case 'failed-native-rejected':
      if (input.httpStatus === undefined || !isNativeRefusalStatus(input.httpStatus)) return null;
      return { action: 'failed', attemptId: input.attemptId, instanceId: input.instanceId, reason: 'native_rejected', httpStatus: input.httpStatus };
    case 'sent':
      if (input.platformMessageId === undefined) return null;
      return { action: 'sent', attemptId: input.attemptId, instanceId: input.instanceId, platformMessageId: input.platformMessageId, evidence: 'receipt+echo' };
  }
}

/** A custody that blocks every new dispatch to the fan until it ends (`dispatching`, `uncertain-held`). */
export function custodyBlocks(state: CustodyState): boolean {
  return (CUSTODY_BLOCKING_STATES as readonly CustodyState[]).includes(state);
}

/**
 * Whether the hub can still take this report for a custody in `state`
 * (CUSTODY_TRANSITIONS): `sent` ends `dispatching` and `uncertain-held`;
 * `failed` ends only `dispatching` — once the ticket expired unreported the
 * custody is `uncertain-held` and only the late proof or a resolve ends it.
 */
export function reportAccepted(body: ClaimBody, state: CustodyState): boolean {
  if (body.action === 'sent') return state !== 'sent' && isCustodyTransition(state, 'sent');
  if (body.action === 'failed') return isCustodyTransition(state, 'failed') && state !== 'failed';
  return false;
}

/** A custody report is repeated (same attemptId) after these failures only: no answer, or a busy hub. */
export function reportRetryable(failure: HubFailure): boolean {
  if (failure.kind === 'transport') return true;
  return failure.kind === 'http' && (failure.status === 429 || failure.status >= 500);
}
