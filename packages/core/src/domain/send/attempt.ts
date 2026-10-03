// The X8 attempt machine (architecture.md §6.7.6–§6.7.8, contracts
// SEND_ATTEMPT_TRANSITIONS): ready → preparing → held | notEnqueued |
// nativeEnqueued → nativeAccepted → sentObserved, with rejected for a proven
// final native refusal and uncertain for everything not proven after a
// possible queue call. Facts link by the server's message id, never by text:
// the receipt of exactly this attempt gives the id, the outgoing echo with
// the same id proves the send. A 401 is never an outcome. An echo that comes
// before its receipt waits in a short buffer. `uncertain` moves only to
// `sentObserved`, and only when the late second half of an already linked
// pair arrives; it never goes back to `ready`, so nothing is ever re-sent.

import { type CgCode } from '@cg/contracts/errors';
import { type SendAttemptInput, type SendAttemptView } from '@cg/contracts/send';
import { SEND_ATTEMPT_TRANSITIONS, isNativeRefusalStatus, type SendAttemptState } from '@cg/contracts/send-rules';

/** Echo ids kept while the receipt is not known yet. */
export const ECHO_BUFFER_MAX = 8;

export interface AttemptTrack {
  readonly view: SendAttemptView;
  /** The server id from the intercepted response of exactly this attempt. */
  readonly receiptMessageId: string | null;
  /** Outgoing echo ids seen before the receipt. */
  readonly echoes: readonly string[];
  /** ChatSpace's local id of the queued record. */
  readonly pendingId: string | null;
}

export function newAttempt(attemptId: string): AttemptTrack {
  return { view: { attemptId, state: 'ready' }, receiptMessageId: null, echoes: [], pendingId: null };
}

export function canMoveAttempt(from: SendAttemptState, to: SendAttemptState): boolean {
  return (SEND_ATTEMPT_TRANSITIONS[from] as readonly SendAttemptState[]).includes(to);
}

/** Whether `to` can be reached from `from` along the frozen transitions (reports may skip a step). */
export function attemptReachable(from: SendAttemptState, to: SendAttemptState): boolean {
  if (from === to) return false;
  const seen = new Set<SendAttemptState>([from]);
  const queue: SendAttemptState[] = [from];
  while (queue.length > 0) {
    const state = queue.shift() as SendAttemptState;
    for (const next of SEND_ATTEMPT_TRANSITIONS[state] as readonly SendAttemptState[]) {
      if (next === to) return true;
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return false;
}

export interface AttemptStep {
  readonly track: AttemptTrack;
  readonly changed: boolean;
  /** Why the input changed nothing (a 401, a duplicate, a late or impossible input). */
  readonly ignored?: string;
}

const same = (track: AttemptTrack, ignored: string): AttemptStep => ({ track, changed: false, ignored });

function moved(track: AttemptTrack, state: SendAttemptState, extra: Partial<SendAttemptView> = {}, rest: Partial<Omit<AttemptTrack, 'view'>> = {}): AttemptStep {
  const view: SendAttemptView = { attemptId: track.view.attemptId, state, ...extra };
  return { track: { ...track, ...rest, view }, changed: true };
}

const withId = (id: string | null): Partial<SendAttemptView> => (id === null ? {} : { platformMessageId: id });

function uncertain(track: AttemptTrack, code: CgCode = 'CG-SEND-UNCERTAIN'): AttemptStep {
  return moved(track, 'uncertain', { code, ...withId(track.receiptMessageId) });
}

function bufferEcho(track: AttemptTrack, id: string): AttemptStep {
  if (track.echoes.includes(id)) return same(track, 'duplicate echo');
  const echoes = [...track.echoes, id].slice(-ECHO_BUFFER_MAX);
  return { track: { ...track, echoes }, changed: false, ignored: 'echo buffered until its receipt' };
}

function onReceipt(track: AttemptTrack, status: number, id: string | null): AttemptStep {
  const state = track.view.state;
  if (status === 401) return same(track, '401 is not an outcome');
  if (state === 'preparing') return onReceipt(moved(track, 'nativeEnqueued').track, status, id);
  const ok = status >= 200 && status <= 299;
  if (state === 'nativeEnqueued') {
    if (ok && id !== null) {
      const accepted = moved(track, 'nativeAccepted', { platformMessageId: id }, { receiptMessageId: id });
      return track.echoes.includes(id) ? moved(accepted.track, 'sentObserved', { platformMessageId: id }) : accepted;
    }
    if (isNativeRefusalStatus(status)) return moved(track, 'rejected', { code: 'CG-SEND-REJECTED', httpStatus: status });
    return uncertain(track);
  }
  if (state === 'nativeAccepted') {
    if (ok && id === track.receiptMessageId) return same(track, 'duplicate receipt');
    return uncertain(track);
  }
  if (state === 'uncertain') {
    if (!ok || id === null) return same(track, 'no linked receipt');
    if (track.receiptMessageId !== null && track.receiptMessageId !== id) return same(track, 'another receipt id');
    if (track.echoes.includes(id)) return moved(track, 'sentObserved', { platformMessageId: id }, { receiptMessageId: id });
    if (track.receiptMessageId === id) return same(track, 'receipt already linked');
    return { track: { ...track, receiptMessageId: id, view: { ...track.view, platformMessageId: id } }, changed: true };
  }
  return same(track, `receipt in ${state}`);
}

function onEcho(track: AttemptTrack, id: string): AttemptStep {
  const state = track.view.state;
  if (state === 'nativeAccepted') return id === track.receiptMessageId ? moved(track, 'sentObserved', { platformMessageId: id }) : same(track, 'echo of another message');
  if (state === 'uncertain') {
    if (track.receiptMessageId === id) return moved(track, 'sentObserved', { platformMessageId: id });
    return bufferEcho(track, id);
  }
  if (state === 'preparing' || state === 'nativeEnqueued') return bufferEcho(track, id);
  return same(track, `echo in ${state}`);
}

/** Applies one input; inputs that the frozen transitions do not allow change nothing. */
export function applyAttemptInput(track: AttemptTrack, input: SendAttemptInput): AttemptStep {
  const state = track.view.state;
  switch (input.type) {
    case 'click':
      return state === 'ready' ? moved(track, 'preparing') : same(track, `click in ${state}`);
    case 'held':
      return state === 'preparing' ? moved(track, 'held', { code: input.code }) : same(track, `held in ${state}`);
    case 'notEnqueued':
      return state === 'preparing' ? moved(track, 'notEnqueued', { code: input.code }) : same(track, `notEnqueued in ${state}`);
    case 'nativeEnqueued':
      return state === 'preparing' ? moved(track, 'nativeEnqueued', {}, { pendingId: input.pendingId === '' ? null : input.pendingId }) : same(track, `nativeEnqueued in ${state}`);
    case 'receipt':
      return onReceipt(track, input.httpStatus, input.platformMessageId);
    case 'echo':
      return onEcho(track, input.platformMessageId);
    case 'nativeRejected': {
      if (state !== 'preparing' && state !== 'nativeEnqueued') return same(track, `rejected in ${state}`);
      const status = isNativeRefusalStatus(input.httpStatus) ? { httpStatus: input.httpStatus } : {};
      const detail = input.guardTopics === undefined ? {} : { detail: { guardTopics: [...input.guardTopics] } };
      return moved(track, 'rejected', { code: input.code, ...status, ...detail });
    }
    case 'lost':
      if (state === 'preparing' || state === 'nativeEnqueued' || state === 'nativeAccepted') return uncertain(track, input.code);
      return same(track, `lost in ${state}`);
  }
}

/**
 * A state the tab reports (it forwards what MAIN observed), turned into the
 * inputs that lead there. A report that cannot be reached from the current
 * state — late, duplicated, out of order — changes nothing (RB-020).
 */
export function applyReportedView(track: AttemptTrack, reported: SendAttemptView, pendingId?: string): AttemptStep {
  if (reported.attemptId !== track.view.attemptId) return same(track, 'another attempt');
  const state = track.view.state;
  const id = reported.platformMessageId ?? null;
  switch (reported.state) {
    case 'ready':
    case 'preparing':
      return same(track, 'not a host observation');
    case 'held':
    case 'notEnqueued':
      if (state !== 'preparing') return same(track, `${reported.state} in ${state}`);
      return applyAttemptInput(track, reported.state === 'held' ? { type: 'held', code: reported.code ?? 'CG-SEND-HOST' } : { type: 'notEnqueued', code: reported.code ?? 'CG-SEND-QUEUE' });
    case 'nativeEnqueued':
      return applyAttemptInput(track, { type: 'nativeEnqueued', pendingId: pendingId ?? track.pendingId ?? '' });
    case 'nativeAccepted':
      if (id === null) return same(track, 'accepted without an id');
      return applyAttemptInput(track, { type: 'receipt', httpStatus: 200, platformMessageId: id });
    case 'sentObserved': {
      if (id === null) return same(track, 'sent without an id');
      if (state === 'uncertain' && track.receiptMessageId !== null && track.receiptMessageId !== id) return same(track, 'another receipt id');
      const received = state === 'uncertain' || state === 'nativeAccepted' ? { track, changed: false } : applyAttemptInput(track, { type: 'receipt', httpStatus: 200, platformMessageId: id });
      const echoed = applyAttemptInput(state === 'uncertain' ? { ...received.track, receiptMessageId: id } : received.track, { type: 'echo', platformMessageId: id });
      return echoed.track.view.state === 'sentObserved' ? { track: echoed.track, changed: true } : echoed;
    }
    case 'rejected': {
      const status = reported.httpStatus ?? 0;
      const code = reported.code ?? (isNativeRefusalStatus(status) ? 'CG-SEND-REJECTED' : 'CG-SEND-HOST');
      const guardTopics = reported.detail?.guardTopics;
      return applyAttemptInput(track, { type: 'nativeRejected', httpStatus: status, code, ...(guardTopics === undefined ? {} : { guardTopics }) });
    }
    case 'uncertain': {
      const lost = applyAttemptInput(track, { type: 'lost', code: reported.code ?? 'CG-SEND-UNCERTAIN' });
      if (id === null || lost.track.view.state !== 'uncertain') return lost;
      const linked = applyAttemptInput(lost.track, { type: 'receipt', httpStatus: 200, platformMessageId: id });
      return { track: linked.track, changed: lost.changed || linked.changed };
    }
  }
}
