// X8 rules as plain data (architecture.md §6.7.4–§6.7.11): the attempt
// states and their transitions, which ends allow a new click, the condition
// codes, what the background reports to the hub custody, and the server
// deadline on the local clock. No schema constructors: the UI and the
// controllers read these without loading the X8 schemas (send.ts).

import { type CgCode } from './errors';

/** §6.7.7. */
export const SEND_ATTEMPT_STATES = [
  'ready',
  'preparing',
  'held',
  'notEnqueued',
  'nativeEnqueued',
  'nativeAccepted',
  'sentObserved',
  'rejected',
  'uncertain',
] as const;
export type SendAttemptState = (typeof SEND_ATTEMPT_STATES)[number];

/**
 * Allowed transitions (§6.7.7):
 * - ready → preparing on a trusted click (local fan lock, hub dispatch);
 * - preparing → held: freshness, a condition or the lease failed BEFORE the native queue;
 * - preparing → notEnqueued: the queue returned null with the call boundary intact;
 * - preparing → nativeEnqueued: ChatSpace returned its pending id, the send has started;
 * - nativeEnqueued → nativeAccepted: the exact server id from the intercepted response;
 * - nativeAccepted → sentObserved: the outgoing echo with the same id, account and fan;
 * - a proven final native refusal (4xx except 401, e.g. Message Guard) → rejected;
 * - after a possible queue call: timeout, reload, lost answer, 401 without a receipt of
 *   the finished chain, observer failure or ambiguity → uncertain;
 * - uncertain → sentObserved only when the late second half of an already linked pair
 *   (receipt and echo with the same id) arrives. Never back to ready.
 */
export const SEND_ATTEMPT_TRANSITIONS = {
  ready: ['preparing'],
  preparing: ['held', 'notEnqueued', 'nativeEnqueued', 'uncertain'],
  held: [],
  notEnqueued: [],
  nativeEnqueued: ['nativeAccepted', 'rejected', 'uncertain'],
  nativeAccepted: ['sentObserved', 'uncertain'],
  sentObserved: [],
  rejected: [],
  uncertain: ['sentObserved'],
} as const satisfies Record<SendAttemptState, readonly SendAttemptState[]>;

/** States after which a NEW attempt (new click, new attemptId) may be allowed for this part; isRetryableEnd decides by code. */
export const SEND_ATTEMPT_RETRYABLE_ENDS = ['held', 'notEnqueued'] as const satisfies readonly SendAttemptState[];

/**
 * Hold codes that another click of the same part cannot lift (§6.7.5,
 * §6.7.8): a newer fan message or a changed part/identity needs a new
 * generation (or «Открыть и вставить»), an unresolved send to the fan needs
 * the hub's `resolve`, a colleague's lease or a confirmed greeting ends the
 * greeting. A new attempt would only hold again after one more hub dispatch.
 */
export const SEND_HOLD_CODES_WITHOUT_RETRY = [
  'CG-SEND-STALE',
  'CG-SEND-PART',
  'CG-CONTEXT-CHANGED',
  'CG-SEND-UNCERTAIN',
  'CG-CLAIM-BUSY',
] as const satisfies readonly CgCode[];

/** Whether a new click may start a new attempt after this end state (and its code). */
export function isRetryableEnd(state: SendAttemptState, code: CgCode | undefined): boolean {
  if (!(SEND_ATTEMPT_RETRYABLE_ENDS as readonly SendAttemptState[]).includes(state)) return false;
  return code === undefined || !(SEND_HOLD_CODES_WITHOUT_RETRY as readonly CgCode[]).includes(code);
}

/** States that keep the hub custody and hold the fan and the group (§6.7.7 п. 4–6, §6.7.9). */
export const SEND_ATTEMPT_CUSTODY_STATES = ['preparing', 'nativeEnqueued', 'nativeAccepted', 'uncertain'] as const satisfies readonly SendAttemptState[];

/**
 * Codes of the §6.7.4 send conditions, in table order: what a preflight
 * refusal or a MAIN `held` may say. Condition 13 refuses a busy account queue
 * with CG-SEND-BUSY before the call (CG-SEND-QUEUE is the queue's own null),
 * condition 14 holds with CG-SEND-STALE or CG-SEND-FRESHNESS, CG-SEND-HOST
 * covers a queue or contract that is unavailable as a whole.
 */
export const PREVIEW_SEND_CONDITION_CODES = [
  'CG-SEND-PART',
  'CG-CONTEXT-CHANGED',
  'CG-SEND-OFF',
  'CG-SEND-RECEIPT',
  'CG-SEND-PERMISSION',
  'CG-SEND-ACTIVE-CHAT',
  'CG-SEND-HISTORY',
  'CG-SEND-FAN',
  'CG-SEND-MIMIC',
  'CG-SEND-TRANSLATOR',
  'CG-SEND-BUSY',
  'CG-SEND-STALE',
  'CG-SEND-FRESHNESS',
  'CG-CLAIM-BUSY',
  'CG-CLAIM-EXPIRED',
  'CG-SEND-HOST',
] as const satisfies readonly CgCode[];
export type PreviewSendConditionCode = (typeof PREVIEW_SEND_CONDITION_CODES)[number];

/**
 * The served-context check of §6.7.5 («обслуженный контекст»): the hold for
 * fan messages the page saw before Generate lifts only when the hub says
 * `included` for every id the checkpoint named; `absent`, `deleted`,
 * `unknown`, a missing answer or a missing frame keep it. No known id — the
 * check has nothing to prove (the counters after Generate still apply).
 */
export function servedContextCovers(knownIds: readonly string[], answers: readonly { readonly id: string; readonly state: string | null }[] | undefined): boolean {
  if (knownIds.length === 0) return true;
  if (answers === undefined) return false;
  return knownIds.every((id) => answers.some((answer) => answer.id === id && answer.state === 'included'));
}

/** A proven final native refusal: 4xx other than 401 (§6.7.6 п. 4; a 401 is never an outcome). */
export function isNativeRefusalStatus(status: number): boolean {
  return status >= 400 && status <= 499 && status !== 401;
}

/**
 * What the background reports to the hub custody (H-7 `claim`) when an
 * attempt that was dispatched ends; the send journal is the proof that no
 * command went to MAIN. `failed-not-enqueued` covers MAIN's `held` and
 * `notEnqueued`, a ticket that expired or got lost before the command reached
 * MAIN, and a `dispatch` whose answer was lost (no ticket, so no command: the
 * hub's refusal of a report for a custody it never opened is ignored).
 * `rejected` is reported only with its `httpStatus`; without one (Guard after
 * a 401) nothing is reported. `uncertain` reports nothing: the custody stays
 * until the late linked pair (`sent`) or the hub's `resolve`. A `dispatch` is
 * never repeated automatically; a report is repeated with the same attemptId
 * until the hub answers, within the ticket's lifetime.
 */
export const SEND_CUSTODY_REPORTS = {
  ready: null,
  preparing: null,
  held: 'failed-not-enqueued',
  notEnqueued: 'failed-not-enqueued',
  nativeEnqueued: null,
  nativeAccepted: null,
  sentObserved: 'sent',
  rejected: 'failed-native-rejected',
  uncertain: null,
} as const satisfies Record<SendAttemptState, 'sent' | 'failed-not-enqueued' | 'failed-native-rejected' | null>;

/** Taken off every server deadline moved onto the local clock: a late command is held, never sent late (§6.7.11). */
export const SERVER_DEADLINE_MARGIN_MS = 1000;

/**
 * A hub deadline on the local clock: the time the answer arrived plus the
 * server's own remaining time (`deadline − serverNow`), minus a margin — so a
 * client clock that is off by minutes neither holds every send nor lets MAIN
 * commit after the hub moved the custody on. Used for the dispatch ticket
 * (`custody.ticketExpiresAt`) and the greeting lease (`lease.expiresAt`).
 * null when either instant does not parse.
 */
export function localDeadline(serverDeadline: string, serverNow: string, receivedAtMs: number, marginMs: number = SERVER_DEADLINE_MARGIN_MS): number | null {
  const deadline = Date.parse(serverDeadline);
  const now = Date.parse(serverNow);
  if (Number.isNaN(deadline) || Number.isNaN(now)) return null;
  return receivedAtMs + (deadline - now) - marginMs;
}
