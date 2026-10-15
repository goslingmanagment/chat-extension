// Completeness of a chat's observation and its certificates (docs/project-
// unite/architecture.md §5.12 «Правило полноты»; FS-TAIL-4): the state of one
// chat and the one rule that moves it. The rings themselves are
// observation.ts's.
//
// On one socket, after its `t:1`, the server pushes every creation (`5/1`) and
// deletion (`5/10`) in order, and nothing is lost without the tap seeing it (a
// closed or new socket, a frame not read whole — a loss). Within such a
// **segment** of a chat:
// - A **certificate** is the page's own fresh-end answer (`GET /message?
//   groupId=…` without `before`) to a request begun after `t:1` of the current
//   socket, with no loss of the chat since. Its **span** — from its oldest
//   message up; a page shorter than the page's `limit` reaches the start of
//   the conversation.
// - The certificate of the **latest request** governs: the chat's interval is
//   its span, and there the chat holds exactly its messages, those whose
//   creation frame came after its request began, less the deleted. An answer
//   to an earlier request — late or not — governs nothing.
// - Its **newest message** dates what it lacks: one made before it (a smaller
//   snowflake) that the answer lacks was deleted before the server made the
//   answer. Its creation frame, coming after the request began, means the socket
//   is behind the answer: a conflict, the chat `unknown` until a later
//   certificate.
// - Any other answer — our own send's too — adds nothing inside the interval
//   and removes nothing: an HTTP answer may come before the socket's frames of
//   what happened before it; frames come in order. Only one case stays
//   undecidable (architecture.md §5.12): a message made after the answer's
//   newest and deleted before the answer was made, both its frames late.
// - A **loss** ends the segment: `unknown` until a certificate of a request
//   begun after it, the interval starting there.
// - A **short** certificate the ring retains whole proves the start of the
//   conversation, while it governs and the ring does not roll.

import { WHY_NOT_CERTIFIED } from './protocol';

/** Snowflake order of two Fansly ids (contracts compareFanslyIds): the shorter is the older, then the string order. */
export const compareIds = (a: string, b: string): number => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);

/** The governing certificate. */
export interface Governing {
  /** The observation number of its request's `loadstart`. */
  readonly ls: number;
  /** Its oldest message; null — a short page: from the start of the conversation. */
  readonly lo: string | null;
  /** Its newest message; null — it was empty. */
  readonly top: string | null;
}

export interface Completeness {
  /** Certified at least once in this document: the window is bounded by the interval. */
  ever: boolean;
  complete: boolean;
  /** Where the interval starts; null — at the start of the conversation. */
  floor: string | null;
  /** The governing certificate was short, and the ring holds all of it since. */
  start: boolean;
  /** The observation number of the chat's last loss. */
  lossSeq: number;
  /** Why it is unknown (FANSLY_COVERAGE_REASONS). */
  why: string;
  /** The certificate of this segment's latest request; null — none since the last loss. */
  cert: Governing | null;
}

export const uncertified = (): Completeness => ({ ever: false, complete: false, floor: null, start: false, lossSeq: 0, why: WHY_NOT_CERTIFIED, cert: null });

/** The place of a request at its `loadstart`: its observation number, the socket epoch, whether `t:1` had come. */
export interface Stamp {
  readonly seq: number;
  readonly epoch: number;
  readonly confirmed: boolean;
}

/** A loss at observation `at`: the segment ends for the chat. True — it was complete. */
export function degrade(chat: Completeness, reason: string, at: number): boolean {
  const was = chat.complete;
  chat.complete = false;
  chat.cert = null;
  chat.start = false;
  chat.lossSeq = at;
  if (chat.ever) chat.why = reason;
  return was;
}

/** An answer to a request with this stamp is evidence of the current segment: begun after `t:1`, no loss since. */
export function certifiable(stamp: Stamp | undefined, epoch: number, confirmed: boolean, chat: Completeness, allLoss: number): stamp is Stamp {
  return stamp !== undefined && stamp.confirmed && stamp.epoch === epoch && confirmed && chat.lossSeq < stamp.seq && allLoss < stamp.seq;
}

/** A request begun at `ls` is later than the one that governs: its certificate governs from now on. */
export const newer = (chat: Completeness, ls: number): boolean => chat.cert === null || ls > chat.cert.ls;

/** The `loadstart` of the governing request; an answer to a request begun before it is older evidence. */
export const governor = (chat: Completeness): number => chat.cert?.ls ?? 0;

/** `id` was made before the governing answer's newest message: if that answer lacks it, it was deleted. */
export function behind(chat: Completeness, id: string): boolean {
  const top = chat.cert?.top ?? null;
  return top !== null && compareIds(id, top) < 0;
}

export type Verdict = 'first' | 'recovered' | 'held';

/**
 * The certificate of a later request governs (the ring holds its span already): the interval is its span, the start
 * proven by it alone (`proves` — short, retained whole). `first`/`recovered` — complete now; `held` — it was.
 */
export function certify(chat: Completeness, ls: number, lo: string | null, top: string | null, proves: boolean): Verdict {
  const verdict: Verdict = chat.cert !== null ? 'held' : chat.ever ? 'recovered' : 'first';
  chat.floor = lo;
  chat.start = proves;
  chat.cert = { ls, lo, top };
  chat.ever = true;
  chat.complete = true;
  return verdict;
}
