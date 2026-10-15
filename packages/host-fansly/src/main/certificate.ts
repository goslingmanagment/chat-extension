// Completeness of a chat's observation and its certificates (docs/project-
// unite/architecture.md §5.6; FS-TAIL-4): the state of one chat and the rules
// that move it. The rings themselves are observation.ts's.
//
// - A **certificate** is the page's answer to its own `GET /message?groupId=…`
//   of the fresh end (no `before`), whose request began after `t:1` of the
//   current socket (its `loadstart` in that epoch, confirmed) and ended in the
//   same epoch with no loss for the chat between the two — no new socket, no
//   frame or answer of it lost, no gap of the bridge (`certifiable`). A request
//   begun before `t:1` — the page's first one at load — is none.
// - The **first** certificate of a chat in this document starts its continuous
//   observation at the oldest message of the answer, whatever MAIN knew of the
//   group before (the inbox and `/group` come before the history at a normal
//   load).
// - After a **loss** (`degrade`: a new socket or its end, a frame not read
//   whole, an answer over the parse limit, a source naming a message never
//   seen, an eviction, bfcache, `fx.gap`) a certificate restores the chat only
//   if it overlaps the observation: it holds the last message known before the
//   loss and not seen deleted (`boundary`), or it reaches the start of the
//   conversation (shorter than a page). A deleted boundary proves nothing: the
//   chat stays `unknown` until a certificate that overlaps, or a reload.
// - A certificate shorter than a page (`limit`, 25 as the page asks) proves the
//   **start** of the conversation (the old rule, S4 HF-5). The proof — and the
//   count of personal messages on it — lives while its base does: an unbroken
//   observation since, no record of the chat evicted (observation.ts drops it
//   when the ring rolls over its oldest record).
// - `lossSeq` and the runtime's `allLoss` are the observation numbers of the
//   last loss of this chat and of every chat: a request is a certificate only if
//   both are older than its `loadstart`.

import { WHY_NO_OVERLAP, WHY_NOT_CERTIFIED } from './protocol';

export interface Completeness {
  /** A certificate came for this chat in this document: its observation has a continuous interval. */
  ever: boolean;
  complete: boolean;
  /** Certified once, then lost: only a certificate that overlaps restores it. */
  loss: boolean;
  /** The last message known before the loss, not seen deleted; null — none was known. */
  boundary: string | null;
  /** The oldest message of the continuous interval; null — the interval starts at the start of the conversation. */
  floor: string | null;
  /** A short certificate proved the start, and its base lives. */
  start: boolean;
  /** The observation number of the chat's last loss. */
  lossSeq: number;
  /** The `loadstart` of its last certificate's request, and where that answer begins (null — at the start). */
  certSeq: number;
  certFrom: string | null;
  /** Why it is unknown (FANSLY_COVERAGE_REASONS). */
  why: string;
}

export const uncertified = (): Completeness => ({
  ever: false,
  complete: false,
  loss: false,
  boundary: null,
  floor: null,
  start: false,
  lossSeq: 0,
  certSeq: 0,
  certFrom: null,
  why: WHY_NOT_CERTIFIED,
});

/** The place of a request at its `loadstart`: its observation number, the socket epoch, whether `t:1` had come. */
export interface Stamp {
  readonly seq: number;
  readonly epoch: number;
  readonly confirmed: boolean;
}

/** A loss at observation `at`; `newest` — the chat's newest message not seen deleted. True — it was complete. */
export function degrade(chat: Completeness, reason: string, newest: string | null, at: number): boolean {
  const was = chat.complete;
  if (was) {
    chat.loss = true;
    chat.boundary = newest;
  }
  chat.complete = false;
  chat.lossSeq = at;
  if (chat.ever) chat.why = reason;
  return was;
}

/** The answer to the fresh end of a request with this stamp is a certificate (the header). */
export function certifiable(stamp: Stamp | undefined, epoch: number, confirmed: boolean, chat: Completeness, allLoss: number): boolean {
  return stamp !== undefined && stamp.confirmed && stamp.epoch === epoch && confirmed && chat.lossSeq < stamp.seq && allLoss < stamp.seq;
}

export type Verdict = 'first' | 'recovered' | 'held' | 'no-overlap';

/**
 * A certificate for the chat: `oldest` of the answer (null — empty), whether it holds an id, whether it is short, and
 * whether the ring retained all of it (`retained`: a proof of the start needs its whole base). The chat's ring already
 * holds what it could of the answer. `first`/`recovered` — complete now; `held` — it was complete; `no-overlap` — it
 * stays unknown.
 */
export function certify(chat: Completeness, stamp: Stamp, oldest: string | null, holds: (id: string) => boolean, short: boolean, retained: boolean): Verdict {
  let verdict: Verdict;
  if (!chat.ever) verdict = 'first';
  else if (chat.complete) verdict = 'held';
  else if (short || (chat.boundary !== null && holds(chat.boundary))) verdict = 'recovered';
  else {
    chat.why = WHY_NO_OVERLAP;
    return 'no-overlap';
  }
  if (verdict === 'first') chat.floor = oldest;
  if (short) {
    chat.floor = oldest;
    // A short answer reaches the start; it proves it only while the ring holds all of it.
    if (retained) chat.start = true;
  }
  chat.ever = true;
  chat.complete = true;
  chat.loss = false;
  chat.boundary = null;
  chat.certSeq = stamp.seq;
  chat.certFrom = short ? null : oldest;
  return verdict;
}
