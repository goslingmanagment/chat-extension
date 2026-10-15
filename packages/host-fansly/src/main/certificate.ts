// Completeness of a chat's observation and its certificates (docs/project-
// unite/architecture.md §5.6, §5.12 «Правило полноты»; FS-TAIL-4): the state
// of one chat and the one rule that moves it. The rings themselves are
// observation.ts's.
//
// The rule rests on what the page's socket guarantees: on one socket, after
// its `t:1`, the server pushes every creation (`5/1`) and deletion (`5/10`)
// in order, and nothing is lost without the tap seeing it (a closed or new
// socket, a frame not read whole — a loss). Within such a **segment**:
// - A **certificate** is the page's own fresh-end answer (`GET /message?
//   groupId=…` without `before`) to a request begun after `t:1` of the current
//   socket, with no loss of the chat since. Whatever moment the server made it
//   at, that moment is after the request began, so every event since then
//   comes as a frame. Its **span** — from its oldest message up (a page shorter
//   than the page's `limit` reaches the start of the conversation: all of it).
// - Inside a certificate's span the chat holds exactly: the certificate's
//   messages, the messages whose frame came after its request began, less the
//   deleted. That is the state at a moment after the request began.
// - Of two certificates, the one whose request began later governs where their
//   spans meet; an earlier one governs only below the later one's span. A late
//   answer to an earlier request is no newer evidence than a later request.
// - Any other answer (an older page, messages by id, a fresh end that is no
//   certificate) adds nothing inside a governed span and removes nothing: what
//   it says is either explained by frames, or older. One asked within this
//   segment that names a message the chat lacks is a sign of a loss: the chat
//   waits for that message's frame, then is lowered (observation.ts).
// - A **loss** ends the segment for the chat: it is `unknown` until a
//   certificate of a request begun after the loss, and its interval starts
//   again at that certificate — what was held before cannot be trusted: a
//   deletion during the gap is never told.
// - A certificate shorter than a page proves the **start** of the conversation
//   while the ring holds all of it and the segment lasts.

import { WHY_NOT_CERTIFIED } from './protocol';

/** Snowflake order of two Fansly ids (contracts compareFanslyIds): the shorter is the older, then the string order. */
export const compareIds = (a: string, b: string): number => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);

/** A certificate of the current segment that still governs a part of the chat. */
export interface Governing {
  /** The observation number of its request's `loadstart`. */
  readonly ls: number;
  /** Its oldest message; null — a short page: from the start of the conversation. */
  readonly lo: string | null;
}

/** At most this many certificates kept per chat; one older than the dropped ones governs nothing. */
const KEPT = 4;

export interface Completeness {
  /** Certified at least once in this document: the window is bounded by the interval. */
  ever: boolean;
  complete: boolean;
  /** Where the continuous interval starts; null — at the start of the conversation. */
  floor: string | null;
  /** A short certificate of this segment proved the start, and the ring still holds all of it. */
  start: boolean;
  /** The observation number of the chat's last loss. */
  lossSeq: number;
  /** Why it is unknown (FANSLY_COVERAGE_REASONS). */
  why: string;
  /** The certificates of this segment that govern a part of the chat, the latest request first. */
  certs: Governing[];
  /** A certificate whose request began at or before this governs nothing (one newer than it was dropped). */
  cutoff: number;
}

export const uncertified = (): Completeness => ({ ever: false, complete: false, floor: null, start: false, lossSeq: 0, why: WHY_NOT_CERTIFIED, certs: [], cutoff: 0 });

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
  chat.certs = [];
  chat.cutoff = 0;
  chat.start = false;
  chat.lossSeq = at;
  if (chat.ever) chat.why = reason;
  return was;
}

/** An answer to a request with this stamp is evidence of the current segment: begun after `t:1`, no loss since. */
export function certifiable(stamp: Stamp | undefined, epoch: number, confirmed: boolean, chat: Completeness, allLoss: number): stamp is Stamp {
  return stamp !== undefined && stamp.confirmed && stamp.epoch === epoch && confirmed && chat.lossSeq < stamp.seq && allLoss < stamp.seq;
}

/**
 * The part of the chat a certificate of a request begun at `ls`, from `lo` up, governs: up to (not including) `hi`,
 * the oldest message of a certificate begun later (undefined — to the top). Null — none: a later short page, or a
 * later one reaching as low, governs all of it.
 */
export function governs(chat: Completeness, ls: number, lo: string | null): { readonly hi: string | undefined } | null {
  if (ls <= chat.cutoff) return null;
  let hi: string | undefined;
  for (const c of chat.certs) {
    if (c.ls <= ls) continue;
    if (c.lo === null) return null;
    if (hi === undefined || compareIds(c.lo, hi) < 0) hi = c.lo;
  }
  if (lo !== null && hi !== undefined && compareIds(lo, hi) >= 0) return null;
  return { hi };
}

/**
 * The `loadstart` of the certificate that governs `id` (the latest request whose span reaches it); the cutoff when the
 * one that did was dropped. An answer to a request begun before it is older evidence than what governs.
 */
export function governor(chat: Completeness, id: string): number {
  for (const c of chat.certs) if (c.lo === null || compareIds(c.lo, id) <= 0) return c.ls;
  return chat.cutoff;
}

export type Verdict = 'first' | 'recovered' | 'held';

/**
 * A certificate (it governs a part: `governs`) is applied: the chat's ring holds its part already. `proves` — a short
 * page the ring retained whole. `first`/`recovered` — complete now (the interval starts at it); `held` — it was.
 */
export function certify(chat: Completeness, ls: number, lo: string | null, proves: boolean): Verdict {
  const verdict: Verdict = chat.certs.length > 0 ? 'held' : chat.ever ? 'recovered' : 'first';
  if (verdict !== 'held') {
    chat.floor = lo;
    chat.start = false;
  } else if (lo === null || (chat.floor !== null && compareIds(lo, chat.floor) < 0)) chat.floor = lo;
  if (proves) chat.start = true;
  // Those it covers whole, begun earlier, govern nothing any more.
  const kept = chat.certs.filter((c) => !(c.ls < ls && (lo === null || (c.lo !== null && compareIds(c.lo, lo) >= 0))));
  kept.push({ ls, lo });
  kept.sort((a, b) => b.ls - a.ls);
  for (const dropped of kept.splice(KEPT)) chat.cutoff = Math.max(chat.cutoff, dropped.ls);
  chat.certs = kept;
  chat.ever = true;
  chat.complete = true;
  return verdict;
}
