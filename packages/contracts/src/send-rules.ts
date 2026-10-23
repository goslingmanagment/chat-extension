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
 * generation (or «Открыть и вставить»), a colleague's lease or a confirmed
 * greeting ends the greeting. A new attempt would only hold again after one
 * more hub dispatch. The stale hold is the one warning the person may pass:
 * the click that carries «Отправить всё равно» (`acceptFreshness`) lifts it in
 * the coordinator, a plain click does not (2026-10-20 audit, row 3). The hub's
 * refusal while another send to the fan is inside its ticket (`custody_held`,
 * CG-SEND-UNCERTAIN) is not listed: it holds nothing, the next click asks the
 * hub again, and past the ticket the hub sets that send aside (row 2;
 * 2026-10-23 audit).
 */
export const SEND_HOLD_CODES_WITHOUT_RETRY = [
  'CG-SEND-STALE',
  'CG-SEND-PART',
  'CG-CONTEXT-CHANGED',
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
  'CG-SEND-FAN',
  'CG-SEND-MIMIC',
  'CG-SEND-TRANSLATOR',
  'CG-SEND-BUSY',
  'CG-SEND-STALE',
  'CG-SEND-FRESHNESS',
  'CG-CLAIM-BUSY',
  'CG-SEND-HOST',
] as const satisfies readonly CgCode[];
export type PreviewSendConditionCode = (typeof PREVIEW_SEND_CONDITION_CODES)[number];

/**
 * How a receipt profile let X8 in (1.11.0, decision X25): `exact` — a profile
 * names exactly the send-path modules the page loaded (a reviewed build);
 * `anyBuild` — the hub lists the «any build» sentinel for this adapter
 * (ReceiptProfile `modules` = `{"*":"*"}`): any ChatSpace build whose send-path
 * modules are loaded passes, without a review. The fuse watches what follows.
 */
export const RECEIPT_MATCH_KINDS = ['exact', 'anyBuild'] as const;
export type ReceiptMatchKind = (typeof RECEIPT_MATCH_KINDS)[number];

/**
 * Why the X8 fuse tripped (1.11.0, decision X25), after a send whose outcome
 * is known:
 * - `text` — the message ChatSpace sent or confirmed carries another text than
 *   the part we queued (compared as ChatSpace shows it: tags, entities and
 *   white space aside);
 * - `count` — one click made more than one outgoing message in the chat (a
 *   second POST through the receipt observer, a second queue entry, a second
 *   outgoing echo with the same text);
 * - `target` — the request, the queue entry or the echo of our receipt names
 *   another chat or account;
 * - `uncertain` — SEND_FUSE_UNCERTAIN_RUN sends in a row ended with an unknown
 *   outcome.
 * The fuse never sends and never retries: it only turns X8 off in this
 * browser until the ChatSpace build changes or the person resets it.
 */
export const SEND_FUSE_REASONS = ['text', 'count', 'target', 'uncertain'] as const;
export type SendFuseReason = (typeof SEND_FUSE_REASONS)[number];

/** Where the evidence of a trip was seen: the intercepted request or response, the socket's echo, the queue's entries, the run of outcomes. */
export const SEND_FUSE_EVIDENCE = ['request', 'response', 'echo', 'queue', 'outcomes'] as const;
export type SendFuseEvidence = (typeof SEND_FUSE_EVIDENCE)[number];

/** Sends in a row that end `uncertain` before the fuse trips with reason `uncertain`; a known outcome starts the run over. */
export const SEND_FUSE_UNCERTAIN_RUN = 3;

/**
 * Whether a tripped fuse holds X8 on a tab of this ChatSpace build (`build` of its host report): the build the fuse
 * names, or any when it names none; a tab whose build is not known (null, undefined) is held by any fuse. Plain data
 * (no schema): the early isolated start reads it.
 */
export function sendFuseHolds(fuse: { readonly build: string | null } | null, build: string | null | undefined): boolean {
  return fuse !== null && (fuse.build === null || build === undefined || build === null || fuse.build === build);
}

/**
 * The «any build» sentinel of `limits.previewSendReceiptProfiles` (1.11.0, decision X25): a ReceiptProfile whose
 * `modules` is exactly `{"*":"*"}` lets X8 in on any ChatSpace build for the adapter version it names, while the
 * page has loaded a module of every send-path role; its id is free text. A sentinel of another adapter version
 * matches nothing. Exact profiles keep working beside it, and one that matches is named first. Data only, as every
 * profile: no code, no selectors.
 */
export const ANY_BUILD_MODULE = '*';

/** The profile is the «any build» sentinel: one role `*` with the fingerprint `*`, nothing else. */
export function isAnyBuildReceiptProfile(profile: { readonly modules: Readonly<Record<string, string>> }): boolean {
  const entries = Object.entries(profile.modules);
  return entries.length === 1 && entries[0]?.[0] === ANY_BUILD_MODULE && entries[0][1] === ANY_BUILD_MODULE;
}

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
