// «Новые» on Fansly: the source of the pass controller over Fansly's own messages (R20 P10a; docs/project-unite/
// architecture.md §8.7, §8.17; FS-NEW-1; NF-004, NF-006, NF-010, NF-011, NF-026, NF-027, FX-017). The window asks
// Fansly's background module (`bg/fansly`) through the tab's port: `fansly.followers.scan` opens the pass of the tab's
// creator and period, `read` gives its rows a page at a time, `history` a fan's conversation as the pass read it,
// `close` lets it go; `fansly.followers.changed` tells the rows that changed — the window never polls (the old one
// asked for the whole snapshot every 700 ms). The port hands answers and events over already checked by Fansly's
// registry (the composition's `fanslyRequest`, NF-027); here they become the neutral words of a pass
// (domain/hosts/fansly/newcomers). A failure is a failure — of the envelope or of the payload — never an empty list.
// R20 P10b1: the queue's buttons — `pause`, `resume`, `prioritize` (NF-038). R20 P10b2: `exclude` (FS-NEW-2).
// R20 P10c: the card's greeting — `proof`, `draft`, `send`, `sent` (FS-NEW-3, FS-NEW-6, FS-NEW-7); `outcomes` — where each
// fan's greeting stands, for the list (2026-10-22).

import { type CgErrorWire } from '@cg/contracts/errors';
import { type FanslySendView } from '@cg/contracts/send-fansly';
import { type FanslyTabEventPayload, type FanslyTabRequestPayload, type FanslyTabResponsePayload } from '@cg/contracts/tab-messages-fansly';
import { type NewcomersFailureVM } from '@cg/contracts/vm';

import {
  FANSLY_NEWCOMERS_HISTORY,
  FANSLY_NEWCOMERS_PAGE,
  FANSLY_NEWCOMERS_READ_MAX,
  FANSLY_NEWCOMERS_WINDOWS,
  failureOf,
  fanslyChatPath,
  messageOf,
  passChangeOf,
  passRowOf,
  passStateOf,
} from '../../../domain/hosts/fansly/newcomers';
import { type NewcomersPassSource, type PassGreetingSource, type PassSendOutcome, type SourceAnswer } from '../../newcomers/source';

/** The window's requests of Fansly's registry. */
export type FanslyFollowersRequest =
  | 'fansly.followers.scan'
  | 'fansly.followers.read'
  | 'fansly.followers.history'
  | 'fansly.followers.close'
  // R20 P10b1: the queue's buttons (NF-038).
  | 'fansly.followers.pause'
  | 'fansly.followers.resume'
  | 'fansly.followers.prioritize'
  // R20 P10b2: «Исключить из очереди» / «Вернуть в очередь» (FS-NEW-2).
  | 'fansly.followers.exclude'
  // R20 P10c: the card's greeting.
  | 'fansly.followers.proof'
  | 'fansly.followers.draft'
  | 'fansly.followers.outcomes'
  | 'fansly.followers.send'
  | 'fansly.followers.sent';

export type FanslyFollowersAnswer<T extends FanslyFollowersRequest> = { readonly ok: true; readonly payload: FanslyTabResponsePayload<T> } | { readonly ok: false; readonly error: CgErrorWire };

/** The tab's port to Fansly's background module as the window uses it: answers and events checked by Fansly's registry. */
export interface FanslyFollowersPort {
  request<T extends FanslyFollowersRequest>(type: T, payload: FanslyTabRequestPayload<T>): Promise<FanslyFollowersAnswer<T>>;
  onChanged(listener: (change: FanslyTabEventPayload<'fansly.followers.changed'>) => void): () => void;
  /** The port to the background came back after a loss. */
  onReconnect(listener: () => void): () => void;
}

const envelope = (error: CgErrorWire): NewcomersFailureVM => ({ code: error.code, retryAt: error.retryAt ?? null });

/** `origin` — the page's own (fansly.com, the stand in a test build): the fan's chat opens there, in a new tab. */
export function createFanslyNewcomersSource(port: FanslyFollowersPort, origin: string): NewcomersPassSource {
  return {
    windows: FANSLY_NEWCOMERS_WINDOWS,
    pageSize: FANSLY_NEWCOMERS_PAGE,
    readMax: FANSLY_NEWCOMERS_READ_MAX,
    historyPage: FANSLY_NEWCOMERS_HISTORY.page,
    historyCap: FANSLY_NEWCOMERS_HISTORY.cap,
    async scan(hostAccountId, windowHours) {
      const answer = await port.request('fansly.followers.scan', { hostAccountId, windowHours });
      if (!answer.ok) return { ok: false, failure: envelope(answer.error) };
      const payload = answer.payload;
      return payload.ok ? { ok: true, value: passStateOf(payload.pass) } : { ok: false, failure: failureOf(payload.error) };
    },
    async read(passId, offset, limit, query) {
      const answer = await port.request('fansly.followers.read', { passId, offset, limit, query });
      if (!answer.ok) return { ok: false, failure: envelope(answer.error) };
      const { pass, rows, total, seq, counts } = answer.payload;
      // A legacy unfiltered page cannot answer a whole-pass query: never pass its incomplete counts off as zero.
      if (pass !== null && counts === undefined) return { ok: false, failure: { code: 'CG-DATA-UNAVAILABLE', retryAt: null } };
      return { ok: true, value: { pass: pass === null ? null : passStateOf(pass), rows: rows.map(passRowOf), total, seq: seq ?? null, counts: counts ?? null } };
    },
    async history(passId, fanRef, before, limit) {
      const answer = await port.request('fansly.followers.history', { passId, fanRef, before, limit });
      if (!answer.ok) return { ok: false, failure: envelope(answer.error) } satisfies SourceAnswer<never>;
      const payload = answer.payload;
      return payload.ok ? { ok: true, value: { messages: payload.messages.map(messageOf), more: payload.more } } : { ok: false, failure: failureOf(payload.error) };
    },
    async setRunning(passId, running) {
      if (running) {
        const answer = await port.request('fansly.followers.resume', { passId });
        if (!answer.ok) return { ok: false, failure: envelope(answer.error) };
        return answer.payload.ok ? { ok: true, value: passStateOf(answer.payload.pass) } : { ok: false, failure: failureOf(answer.payload.error) };
      }
      const answer = await port.request('fansly.followers.pause', { passId });
      if (!answer.ok) return { ok: false, failure: envelope(answer.error) };
      return { ok: true, value: answer.payload.pass === null ? null : passStateOf(answer.payload.pass) };
    },
    async checkNext(passId, fanRef, next) {
      const answer = await port.request('fansly.followers.prioritize', { passId, fanRef, ...(next === true ? { next: true as const } : {}) });
      return answer.ok ? { ok: true, value: answer.payload.recorded } : { ok: false, failure: envelope(answer.error) };
    },
    async exclude(passId, fanRef, excluded) {
      const answer = await port.request('fansly.followers.exclude', { passId, fanRef, excluded });
      return answer.ok ? { ok: true, value: answer.payload.recorded } : { ok: false, failure: envelope(answer.error) };
    },
    close(passId) {
      // Nobody waits for it: the pass keeps its results either way.
      void port.request('fansly.followers.close', { passId }).catch(() => undefined);
    },
    onChange: (listener) => port.onChanged((change) => listener(passChangeOf(change))),
    onReconnect: (listener) => port.onReconnect(listener),
    chatHref: (conversationRef) => `${origin}${fanslyChatPath(conversationRef)}`,
    greeting: greetingSource(port),
  };
}

/** Where the background's attempt stands as the card reads it: gone out (a receipt is a message Fansly made), refused, unknown. */
function outcomeOf(attempt: FanslySendView): PassSendOutcome {
  switch (attempt.state) {
    case 'sent':
    case 'receipted':
      return { s: 'sent' };
    case 'refused':
      return { s: 'refused', code: attempt.code ?? 'CG-SEND-REJECTED' };
    case 'uncertain':
      return { s: 'uncertain', code: attempt.code };
    case 'ready':
    case 'claimed':
    case 'routed':
    case 'dispatched':
    case 'intentWritten':
    case 'requestStarted':
      return { s: 'pending' };
  }
}

/** R20 P10c: the card's greeting over Fansly's module — the pass's proof, the draft, the send, the person's own send. */
function greetingSource(port: FanslyFollowersPort): PassGreetingSource {
  return {
    async proof(passId, fanRef) {
      const answer = await port.request('fansly.followers.proof', { passId, fanRef });
      if (!answer.ok) return { ok: false, failure: envelope(answer.error) };
      const payload = answer.payload;
      if (!payload.ok) return { ok: false, failure: failureOf(payload.error) };
      const { groupId, ...proof } = payload.proof;
      // The group the pass resolved: the conversation, never the fan's id (FS-IDN-6).
      return { ok: true, value: { ...proof, conversationRef: groupId } };
    },
    async draft(passId, fanRef, text, generation) {
      const answer = await port.request('fansly.followers.draft', { passId, fanRef, ...(text === undefined ? {} : { text }), ...(generation === undefined ? {} : { generation }) });
      if (!answer.ok) return { ok: false, failure: envelope(answer.error) };
      if (!answer.payload.ok) return { ok: false, failure: failureOf(answer.payload.error) };
      const { attempt, generation: saved, ...draft } = answer.payload.draft;
      return { ok: true, value: { ...draft, ...(saved === undefined ? {} : { generation: saved }), ...(attempt === undefined ? {} : { outcome: outcomeOf(attempt) }) } };
    },
    async outcomes(passId) {
      const answer = await port.request('fansly.followers.outcomes', { passId });
      if (!answer.ok) return { ok: false, failure: envelope(answer.error) };
      if (!answer.payload.ok) return { ok: false, failure: failureOf(answer.payload.error) };
      return { ok: true, value: answer.payload.attempts.map((attempt) => ({ fanRef: attempt.fanRef, outcome: outcomeOf(attempt) })) };
    },
    async send(click) {
      const { conversationRef, opId, ...rest } = click;
      const answer = await port.request('fansly.followers.send', { ...rest, groupId: conversationRef, ...(opId === undefined ? {} : { opId }) });
      if (!answer.ok) return { ok: false, failure: envelope(answer.error) };
      return answer.payload.ok ? { ok: true, value: outcomeOf(answer.payload.attempt) } : { ok: false, failure: failureOf(answer.payload.error) };
    },
    async sent(report) {
      const { conversationRef, ...rest } = report;
      const answer = await port.request('fansly.followers.sent', { ...rest, groupId: conversationRef });
      return answer.ok ? { ok: true, value: answer.payload.recorded } : { ok: false, failure: envelope(answer.error) };
    },
  };
}
