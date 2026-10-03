// The «Отправить» row of each part (architecture.md §6.7.4, §6.7.7–§6.7.9;
// ui-design §4.13; X8-01…X8-09 controller side): which of the nine states a
// part is in, why the button is off, and what stands behind an earlier part.
// The controller explains the reason on the button; MAIN checks the page
// conditions again in the same step as the queue call, and the hub checks
// the switch, the rate and the lease on every dispatch. Nothing here sends:
// a send is one human click of one part, through the R10 coordinator.

import { type CgCode } from '@cg/contracts/errors';
import { type PreviewSendPreflight, type SendAttemptView, type SendGroup } from '@cg/contracts/send';
import { PREVIEW_SEND_CONDITION_CODES, type PreviewSendConditionCode, type SendAttemptState } from '@cg/contracts/send-rules';
import { type IsoTimestamp } from '@cg/contracts/primitives';
import { SEND_REASON_KEYS, previewSendStateOf, type OpenInsertVM, type PreviewSendView, type ReasonVM, type SendOrderVM } from '@cg/contracts/vm';

import { groupProgress, sendOrderOf, type FanAttempt } from '../../domain/send/groups';
import { msg } from '../boards/views';

/** One attempt of one part, as this tab knows it. */
export interface PartAttempt {
  readonly attemptId: string;
  readonly view: SendAttemptView;
  /** When the linked receipt and echo were seen (local clock, ISO). */
  readonly sentAt: IsoTimestamp | null;
  /** Since when the outcome is unknown. */
  readonly uncertainSince: IsoTimestamp | null;
}

export const partKey = (variant: number | null, index: number): string => `${variant ?? 0}:${index}`;

/** States in which a part is on its way: no other part of the fan starts meanwhile. */
const IN_FLIGHT: readonly SendAttemptState[] = ['preparing', 'nativeEnqueued', 'nativeAccepted'];

export function inFlight(state: SendAttemptState): boolean {
  return IN_FLIGHT.includes(state);
}

/** A condition code as a preflight refusal; a code outside the table is the host's own unavailability. */
export function refusal(code: CgCode): PreviewSendPreflight {
  const known = (PREVIEW_SEND_CONDITION_CODES as readonly CgCode[]).includes(code);
  return { ok: false, code: known ? (code as PreviewSendConditionCode) : 'CG-SEND-HOST' };
}

export interface SendRowInput {
  readonly attempt: PartAttempt | null;
  /** The click of this part is on its way to the coordinator and has no attempt id yet. */
  readonly clicked: boolean;
  /** The first failed condition of the controller and MAIN, or ok. */
  readonly gate: PreviewSendPreflight;
  /** When the fan wrote after the generation, if the time is known. */
  readonly staleAt: IsoTimestamp | null;
  /** Local clock, ISO: stands in for a time the attempt did not record. */
  readonly nowIso: IsoTimestamp;
}

/** The row of one part: the contract's state table plus its texts and times. */
export function sendRow(input: SendRowInput): PreviewSendView {
  if (input.clicked && input.attempt === null) return { s: 'queued' };
  const state = previewSendStateOf(input.attempt?.view ?? null, input.gate);
  switch (state.s) {
    case 'available':
    case 'queued':
    case 'sending':
    case 'accepted':
      return state;
    case 'unavailable':
      return { s: 'unavailable', code: state.code, reason: msg(SEND_REASON_KEYS[state.code]) };
    case 'held-stale':
      return { s: 'held-stale', at: input.staleAt };
    case 'sent':
      return { s: 'sent', at: input.attempt?.sentAt ?? input.nowIso };
    case 'rejected': {
      const detail = input.attempt?.view.detail;
      const text = detail?.guardTopics !== undefined && detail.guardTopics.length > 0 ? detail.guardTopics.join(', ') : detail?.upstream;
      return text === undefined ? { s: 'rejected', code: state.code, canRetry: state.canRetry } : { s: 'rejected', code: state.code, detail: text, canRetry: state.canRetry };
    }
    case 'uncertain':
      return { s: 'uncertain', since: input.attempt?.uncertainSince ?? input.nowIso, attemptId: state.attemptId };
  }
}

/** Whether a click of «Отправить» (or «Отправить ещё раз») may start an attempt from this row. */
export function clickable(row: PreviewSendView, order: SendOrderVM | null): boolean {
  if (order !== null) return false;
  return row.s === 'available' || (row.s === 'rejected' && row.canRetry);
}

/** Attempts of a result as the group rules read them. */
export function fanAttempts(attempts: ReadonlyMap<string, PartAttempt>, purpose: FanAttempt['purpose'], group: SendGroup, clicked: ReadonlySet<string>): FanAttempt[] {
  const out: FanAttempt[] = [];
  for (const [key, attempt] of attempts) {
    const [variant, index] = key.split(':').map(Number) as [number, number];
    if (variant !== group.variant) continue;
    out.push({ attemptId: attempt.attemptId, purpose, group, partIndex: index, state: attempt.view.state });
  }
  for (const key of clicked) {
    const [variant, index] = key.split(':').map(Number) as [number, number];
    if (variant !== group.variant || attempts.has(key)) continue;
    out.push({ attemptId: `click:${key}`, purpose, group, partIndex: index, state: 'preparing' });
  }
  return out;
}

/**
 * The order hint of a part: behind an uncertain earlier part, behind the
 * first earlier part that is not delivered, or behind any part on its way —
 * one part of one fan is in work at a time.
 */
export function partOrder(group: SendGroup, index: number, attempts: readonly FanAttempt[]): SendOrderVM | null {
  const own = sendOrderOf(group, index, attempts);
  if (own !== null) return own;
  const busy = attempts.find((attempt) => attempt.partIndex !== index && inFlight(attempt.state));
  return busy === undefined ? null : { kind: 'after', part: busy.partIndex + 1 };
}

export function progressOf(group: SendGroup, attempts: readonly FanAttempt[]): { readonly sent: number; readonly total: number } {
  return groupProgress(group, attempts);
}

export interface OpenInsertInput {
  readonly row: PreviewSendView;
  /** «Открыть и вставить» of this very part waits for the chat's composer until then. */
  readonly waitingUntil: number | null;
  /** Why it cannot start (insertion off, the host cannot navigate, no live lease); null — it can. */
  readonly blocked: ReasonVM | null;
}

/**
 * «Открыть и вставить» of a part. Hidden once the part is sent or on its
 * way, and while its outcome is unknown: an uncertain part offers only
 * «Открыть чат для проверки» (§6.7.8).
 */
export function openInsertRow(input: OpenInsertInput): OpenInsertVM {
  const s = input.row.s;
  if (s === 'sent' || s === 'queued' || s === 'sending' || s === 'accepted' || s === 'uncertain') return { s: 'hidden' };
  if (input.waitingUntil !== null) return { s: 'waiting', until: input.waitingUntil };
  if (input.blocked !== null) return { s: 'unavailable', reason: input.blocked };
  return { s: 'available' };
}
