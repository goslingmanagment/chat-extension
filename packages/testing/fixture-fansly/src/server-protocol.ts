// The stand's own protocol with the fake Fansly (packages/testing/src/
// fake-fansly, R20 P6b) — none of it is Fansly's: where the stand page finds
// its API and socket, and the commands a test (or the page's control) scripts
// the server with. Browser-safe: no Node imports.

import type { WireFollow, WireMessage } from './wire';

/**
 * `<meta name=… content=…>` of the stand page, filled by the stand server when it serves the page: the API origin
 * (`http://localhost:<port>`), the socket address (`ws://localhost:<port>?v=3`) and the page's session token. With
 * all three the page asks the fake Fansly — real XHR, a real socket; without them (a DOM test, a page served by hand)
 * it answers itself from its in-page world.
 */
export const FANSLY_SERVER_META = { api: 'stand-fansly-api', socket: 'stand-fansly-socket', token: 'stand-fansly-token' } as const;

/** The fake Fansly's control endpoint on its API origin: POST a command, GET `…/journal?since=`. */
export const FANSLY_CONTROL_PATH = '/__stand/fansly';
/** Control requests carry this header (the same name as the ChatSpace stand's); they are journaled as `control`. */
export const FANSLY_CONTROL_HEADER = 'x-stand-control';

/** Who made a call, as the server can tell (journal.ts `classifyCaller`). */
export type FanslyCaller = 'page' | 'ours' | 'neighbour' | 'control' | 'foreign';

/** How the server answers a scripted API call instead of (or, with `effect`, after) doing it. */
export type ApiOutcome =
  /** An HTTP status with Fansly's error envelope: 429 (with `Retry-After` if given), 401, 403, 5xx. */
  | { readonly kind: 'status'; readonly status: number; readonly retryAfterS?: number }
  /** HTTP 200 with `{success: false, error: {code}}`: a refusal inside a good status. */
  | { readonly kind: 'refuse'; readonly code: number }
  /** The normal answer, this much later. */
  | { readonly kind: 'delay'; readonly ms: number }
  /** No answer at all until the server is reset or closed. */
  | { readonly kind: 'hang' }
  /** The connection dies without an answer. */
  | { readonly kind: 'drop' }
  /** HTTP 200 with a body that is not JSON (an edge page). */
  | { readonly kind: 'garbage' };

export interface ApiRule {
  /** Valid JSON larger than MAIN's passive body limit; the page still reads its normal data (P11a). */
  readonly paddingChars?: number;
  /** A route's name (`message.send`, journal.ts `FanslyRoute`) or `*` — any API call. */
  readonly route: string;
  /** Only calls of this caller; any caller without it. */
  readonly caller?: FanslyCaller;
  /** How many calls it answers; without it — every one until `reset`. */
  readonly times?: number;
  readonly outcome: ApiOutcome;
  /**
   * The request takes effect first (a send is stored and echoed, a note is written) and only its ANSWER is replaced:
   * the lost answer of a write. Without it the request does nothing.
   */
  readonly effect?: boolean;
}

/** When the socket echo of a `POST /message` goes out relative to its HTTP answer (both orders happen, architecture.md §5.9). */
export type SendEcho = 'after' | 'before' | 'none';

export type FakeFanslyCommand =
  /** The world, the scripts and the socket settings back to the start; every socket closed; the journal kept. */
  | { readonly op: 'reset' }
  | { readonly op: 'status' }
  /** A message appears in a group and its `5/1` frame goes out (`silent` — no frame: the socket «lost» it). */
  | {
      readonly op: 'message';
      readonly groupId: string;
      readonly text: string;
      /** `fan` (default), `creator`, or an account id. */
      readonly from?: string;
      readonly type?: number;
      readonly correlationId?: string | null;
      readonly inReplyTo?: string | null;
      /** Seconds; the page drops a socket message older than 180 s. */
      readonly createdAt?: number;
      readonly id?: string;
      readonly silent?: boolean;
    }
  /** A mass send: a `type 3` parent in the creator's mass-send group and a copy with its `correlationId` in each group. */
  | { readonly op: 'broadcast'; readonly text: string; readonly groupIds: readonly string[]; readonly silent?: boolean }
  /** Deletes a message: ONE `5/10` frame, for it; the copies of a `type 3` parent go with it on the server. */
  | { readonly op: 'delete'; readonly messageId: string; readonly silent?: boolean }
  /** A receipt `4/2`: the fan of the messages' group read them (type 2) unless told otherwise. */
  | { readonly op: 'ack'; readonly messageIds: readonly string[]; readonly userId?: string; readonly type?: number }
  /** `5/22`: the group's fan types (or the account named). */
  | { readonly op: 'typing'; readonly groupId: string; readonly accountId?: string }
  /** A new follower and its `3/2` frame; `dmRulesUnmet` — the fan's DM rules the creator does not meet, in the chat `POST /group` makes. */
  | { readonly op: 'follow'; readonly followerId?: string; readonly silent?: boolean; readonly dmRulesUnmet?: boolean }
  /**
   * A new conversation of the creator with `fanId` and no message yet, as `POST /group` makes one (its `4/8` frame;
   * the fan's account is made up). The fan's existing conversation is a refusal: a test means a new one.
   */
  | { readonly op: 'conversation'; readonly fanId: string }
  /** A group changes: its members other than the creator (`4/6`, `4/7` frames), its DM rules, its fan's status. */
  | { readonly op: 'group'; readonly groupId: string; readonly partners?: number; readonly dmRulesUnmet?: boolean; readonly status?: 1 | 2 | 3 | 4 }
  /** Raw text frames to every verified socket as they are (a damaged frame, an unknown `t`); `batch` — inside one `t: 10001`. */
  | { readonly op: 'frames'; readonly frames: readonly string[]; readonly batch?: boolean }
  /**
   * The socket: `close` every connection (the page makes a new one — a new epoch); `stall` the next N connections
   * (never opened: the page replaces one after 3 s); answer pings or not; verify sessions or not, and how long after
   * the page's request (`t: 1`).
   */
  | { readonly op: 'socket'; readonly close?: boolean; readonly stall?: number; readonly pong?: boolean; readonly verify?: boolean; readonly verifyDelayMs?: number }
  /** Scripted API outcomes, appended; the first rule that matches a call answers it. */
  | { readonly op: 'api'; readonly rules: readonly ApiRule[] }
  /** `POST /message`: the order and the delays of its answer and its socket echo. */
  | { readonly op: 'send'; readonly echo?: SendEcho; readonly receiptDelayMs?: number; readonly echoDelayMs?: number }
  /** The session: `expire` — the page's token stops working (401, `t: 0` on the socket); `issue` — one more token, whose calls are journaled under that name. */
  | { readonly op: 'session'; readonly expire?: boolean; readonly issue?: 'neighbour' };

export interface FakeFanslySocketView {
  /** Counts up with every connection the server took: the socket's epoch on the server's side. */
  readonly id: number;
  readonly caller: FanslyCaller;
  readonly via: 'direct' | 'proxy';
  /** A `t: 1` went out on it. */
  readonly verified: boolean;
  readonly pings: number;
}

export interface FakeFanslyStatus {
  readonly creatorId: string;
  /** The page's session token (synthetic): what an `authorization` header must carry. */
  readonly token: string;
  /** Open sockets. */
  readonly sockets: readonly FakeFanslySocketView[];
  /** Connections taken since the start (stalled ones included). */
  readonly connections: number;
  /** Scripted API rules not used up yet. */
  readonly rules: number;
}

/** What a command answers with. */
export interface FakeFanslyResult {
  readonly ok: true;
  readonly status?: FakeFanslyStatus;
  readonly message?: WireMessage;
  /** `broadcast`: the copies; `delete`: what went with a `type 3` parent. */
  readonly messages?: readonly WireMessage[];
  readonly follow?: WireFollow;
  /** `conversation`: the new group's id. */
  readonly groupId?: string;
  /** `session.issue`: the new token. */
  readonly token?: string;
  /** How many sockets a frame went to. */
  readonly sent?: number;
}
