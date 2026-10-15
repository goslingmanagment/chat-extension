// host-fansly/main — Fansly's MAIN world, at document_start (docs/project-unite/
// architecture.md §5, §3.1, §6): one self-contained bundle, `fansly-main.js`
// (≤ 16 KiB gzip, ≤ 1 ms at document_start). The shared boot of host-kit — the
// handshake with the isolated script, the MessagePort, `probe`, `guard` —
// with Fansly's runtime attached at once, so both traps stand before the
// first script of the page (§5.1):
// - natives captured now, only what we call ourselves (§5.1):
//   `Reflect.construct`, `EventTarget.prototype.addEventListener`,
//   `JSON.parse`/`stringify`, `requestIdleCallback`, `setTimeout`, `URL`;
//   never the XHR prototype's `open`/`send`/`setRequestHeader` (FBuddy hooks
//   them after us, S5 §2.3) and never `Map.prototype` (FBuddy swaps it at the
//   start);
// - the socket's tap (ws-tap.ts) and the XHR observer (xhr-tap.ts): Proxies
//   with one trap, `construct`, and our listeners on the page's own instances;
// - every frame read, three levels, packages, its completeness sign
//   (frame-parse.ts); the response table and its bounded deferred queue
//   (responses.ts);
// - the projections MAIN acts on from P7a on: every new message (5/1, ours
//   too) as `fx.incoming` — freshness and the sound; a new follower (3/2) as
//   `fx.follow`; the creator of `/account/me` as `fx.identity`; a confirmed
//   vault upload as `fx.vaultAdded`; and every loss — a new socket, its end, a
//   frame not read whole, frames seen and none read (FS-WS-5), an answer over
//   the parse limit, a late install — as `fx.coverage … unknown`. Deletions,
//   receipts, members and the table's other answers are the observation's
//   (P7b), our own sends' echo and receipt the send's (P7f), the old
//   extension and FBuddy's markers P7g's: read here, not acted on yet;
// - the stream (emitter.ts): one `fx.batch` per listener call under the
//   credits, states coalesced, one `fx.gap` when the isolated side stopped
//   taking them;
// - the requests: `fx.state` (and the stream starts), `fx.ack`, `fx.health`;
//   `fx.focus`, `fx.generationSnapshot`, `fx.windowMeta` answer `not-ready`
//   until the observation is there (P7b).
//
// The page's own world: nothing of ours may throw into it (decision X22).
// Every callback the page or the browser calls is a `guard(…)`; a Proxy's
// trap lets the native constructor's own error through and keeps ours.

import { installMainBridge, type MainBridgeHandle, type MainContext, type MainRuntime } from '@cg/host-kit/main/bridge';
import { idOf, int, isPlain, shape, type Plain } from '@cg/host-kit/main/check';
import { ERR_BAD_REQUEST, ERR_NOT_READY, ERR_UNKNOWN_REQUEST } from '@cg/host-kit/main/protocol';

import { createEmitter } from './emitter';
import { readFrame, type FrameMessage } from './frame-parse';
import {
  ANCHOR_NOT_YET,
  ANCHOR_OK,
  ANCHOR_SHAPE,
  EVT_CONTRACT,
  EVT_COVERAGE,
  EVT_FOLLOW,
  EVT_IDENTITY,
  EVT_INCOMING,
  EVT_VAULT,
  FRAMES_UNREAD_SIGN,
  PARSE_BOUNDS,
  REQ_ACK,
  REQ_HEALTH,
  REQ_LATER,
  REQ_STATE,
  RESPONSE_MAX_CHARS,
  RESPONSE_NOW_CHARS,
  SILENT_MS,
  TAP_OK,
  TAP_SILENT,
  TAP_WRAPPED,
  UNKNOWN,
  WHY_FRAME,
  WHY_LATE,
  WHY_PARSE_LIMIT,
  WHY_SOCKET,
} from './protocol';
import { classifyAddress, createResponseQueue, readResponse, type ApiCall, type Deferred, type ResponseRead } from './responses';
import { installWsTap, type TapNatives } from './ws-tap';
import { installXhrTap } from './xhr-tap';

/** Where the page's socket and API are (FS-WS-1, §5.4): the site's addresses, handed in by the entry point. */
export interface FanslyNetwork {
  /** Host names of the page's socket, compared with the parsed host of its address. */
  readonly socketHosts: readonly string[];
  /** Origins of the page's API, whose paths are `/api/v1/…`; an origin matches with a port after it too. */
  readonly apiOrigins: readonly string[];
}

/** An XHR's place at `loadstart` (§5.6): its number in the order of observations and the socket epoch it began in. */
interface Stamp {
  readonly seq: number;
  readonly epoch: number;
  readonly confirmed: boolean;
}

/** A parse-time histogram over PARSE_BOUNDS: bucket i counts values ≤ bounds[i], the last one what is above them all. */
function histogram(): { add(ms: number): void; read(): Plain } {
  const counts: number[] = PARSE_BOUNDS.map(() => 0).concat(0);
  let count = 0;
  let sum = 0;
  let max = 0;
  return {
    add(ms) {
      let bucket = 0;
      while (bucket < PARSE_BOUNDS.length && ms > (PARSE_BOUNDS[bucket] as number)) bucket += 1;
      counts[bucket] = (counts[bucket] as number) + 1;
      count += 1;
      sum += ms;
      if (ms > max) max = ms;
    },
    read: () => ({ counts: [...counts], count, sum, max }),
  };
}

const isEmpty = (payload: unknown): boolean => isPlain(payload) && Object.keys(payload).length === 0;
const isAck = /* @__PURE__ */ shape({ n: int(1) });
/** Seconds of a message's `createdAt` → ISO 8601 UTC; null past the year 9999 (no four-digit year) or before 1970. */
const MAX_ISO_MS = 253_402_300_799_999;

/** The runtime of Fansly's MAIN world over the boot's context (installMainBridge's `runtime`). */
export function createFanslyRuntime(context: MainContext, network: FanslyNetwork): MainRuntime {
  const win = context.win as Window & typeof globalThis;
  const { guard, fault, now } = context;
  // Natives, captured at document_start (§5.1).
  const parse = JSON.parse as (text: string) => unknown;
  const stringify = JSON.stringify as (value: unknown) => string;
  // eslint-disable-next-line @typescript-eslint/unbound-method -- native captured at load, always invoked with .call
  const add = win.EventTarget.prototype.addEventListener;
  const natives: TapNatives = { construct: Reflect.construct, listenOn: (target, type, listener) => add.call(target, type, listener), guard, fault };
  const idle = typeof win.requestIdleCallback === 'function' ? win.requestIdleCallback.bind(win) : null;
  const later = win.setTimeout.bind(win);
  const late = win.document.readyState !== 'loading';

  const emitter = createEmitter((t, payload) => context.post(t, payload), stringify);

  // What MAIN knows.
  let creator: string | null = null;
  /** The page's sockets so far; the newest one's epoch. */
  let epoch = 0;
  /** `t:1` came on the newest socket. */
  let confirmed = false;
  let lastFrameAt = 0;
  /** Frames of the newest socket: seen, and of them the ones the page reads (FS-WS-5). */
  let socketSeen = 0;
  let socketKnown = 0;
  /** FS-WS-5 said for the newest socket: frames come, and none is one the page reads. */
  let unread = false;
  /** The order of observations in this document (§5.6): a frame's item, an XHR's `loadstart`. */
  let seq = 0;
  const frames = { seen: 0, parsed: 0, lost: 0 };
  const responses = { seen: 0, parsed: 0, deferred: 0, lost: 0 };
  const frameTimes = histogram();
  const xhrTimes = histogram();
  let contractSent = '';

  /** Every chat (null or more than a batch may name) or the chats given become unknown, and why. */
  const lower = (groupIds: readonly string[] | null, reason: string): void =>
    emitter.event(EVT_COVERAGE, { groupIds: groupIds === null || groupIds.length === 0 || groupIds.length > 300 ? 'all' : [...groupIds], state: UNKNOWN, reason });

  // FBuddy's markers and the old extension are P7g's: until then MAIN says it saw neither.
  const identity = (): Plain => ({
    creatorId: creator,
    accountMeSeen: creator !== null,
    legacy: false,
    fbuddy: { windowBridge: false, networkHook: false, styleFixes: false, wordFilter: false },
  });

  const contract = (): Plain => ({
    anchors: {
      accountMe: creator === null ? ANCHOR_NOT_YET : ANCHOR_OK,
      socket: epoch === 0 ? ANCHOR_NOT_YET : ANCHOR_OK,
      frames: unread ? ANCHOR_SHAPE : frames.parsed > 0 ? ANCHOR_OK : ANCHOR_NOT_YET,
      xhr: responses.seen > 0 ? ANCHOR_OK : ANCHOR_NOT_YET,
    },
    tap: ws.wrapped() || xhr.wrapped() ? TAP_WRAPPED : confirmed && now() - lastFrameAt > SILENT_MS ? TAP_SILENT : TAP_OK,
  });

  /** The end of a listener call: the contract if it changed, then at most one batch. */
  const end = (): void => {
    const current = contract();
    const text = stringify(current);
    if (text !== contractSent) {
      contractSent = text;
      emitter.state(EVT_CONTRACT, current);
    }
    emitter.flush();
  };

  const incoming = (m: FrameMessage): void => {
    // Before `/account/me` nobody is known to be the creator: no message is said to be the fan's.
    const fromFan = creator !== null && m.senderId !== creator;
    const ms = m.createdAt === null ? NaN : m.createdAt * 1000;
    emitter.event(EVT_INCOMING, {
      groupId: m.groupId,
      // Who the group's fan is — the observation of groups (P7b).
      fanId: null,
      msgId: m.id,
      fromFan,
      // The old rule (S4 HF-5): a message of the model of type 2, or made by something (a `correlationId`) without a reply.
      automated: !fromFan && (m.type === 2 || (m.correlationId !== null && m.inReplyTo === null)),
      tip: m.tip,
      createdAt: ms >= 0 && ms <= MAX_ISO_MS ? new Date(ms).toISOString() : null,
    });
  };

  const ws = installWsTap(win, natives, network.socketHosts, {
    created() {
      epoch += 1;
      confirmed = false;
      socketSeen = 0;
      socketKnown = 0;
      unread = false;
      // A new socket: whatever came between the old one and it is not known (FS-WS-5).
      lower(null, WHY_SOCKET);
      end();
    },
    frame(text, current) {
      const started = now();
      const read = readFrame(text, parse);
      frames.seen += 1;
      if (read.known) frames.parsed += 1;
      if (!read.whole) frames.lost += 1;
      if (current) {
        lastFrameAt = started;
        socketSeen += 1;
        if (read.known) socketKnown += 1;
      }
      for (const item of read.items) {
        seq += 1;
        if (item.k === 'session') confirmed ||= current;
        else if (item.k === 'message') incoming(item.m);
        else if (item.k === 'follow') emitter.event(EVT_FOLLOW, { eventId: item.eventId, accountId: item.accountId, followerId: item.followerId });
        // 'deleted', 'read', 'members': the observation's (P7b).
      }
      if (!read.whole) lower(read.touched, WHY_FRAME);
      if (current && !unread && socketKnown === 0 && socketSeen >= FRAMES_UNREAD_SIGN) {
        // Frames come, and not one is a frame the page reads: the format changed under us.
        unread = true;
        lower(null, WHY_SOCKET);
      }
      frameTimes.add(now() - started);
      end();
    },
    lost() {
      confirmed = false;
      lower(null, WHY_SOCKET);
      end();
    },
  });

  const respond = (read: ResponseRead, stamp: Stamp | undefined): void => {
    if (read.kind === 'me') {
      creator = idOf((read.response as { account: Plain }).account['id']);
      emitter.state(EVT_IDENTITY, identity());
    } else if (read.kind === 'vault') {
      emitter.event(EVT_VAULT, { seq: stamp?.seq ?? seq });
    }
    // The fresh end and older pages, messages by id, unread, groups, automated: the observation's (P7b); the
    // receipt of `POST /message`: the send's (P7f).
  };

  /** Reads one answer of the table, at once or deferred, within its measure (`xhrParseMs`). */
  const readOne = (item: Deferred<Stamp>): void => {
    const started = now();
    const read = readResponse(item.call, item.text, parse);
    if (read !== null) {
      responses.parsed += 1;
      respond(read, item.stamp);
    }
    xhrTimes.add(now() - started);
  };

  const queue = createResponseQueue<Stamp>({ now, idle, later, guard }, readOne, end);

  const lose = (call: ApiCall): void => {
    responses.lost += 1;
    lower(call.groupId === null ? null : [call.groupId], WHY_PARSE_LIMIT);
  };

  const xhr = installXhrTap<Stamp>(win, natives, {
    start() {
      seq += 1;
      return { seq, epoch, confirmed };
    },
    end(request, stamp) {
      const call = classifyAddress(request.responseURL, network.apiOrigins);
      if (call === null) return;
      responses.seen += 1;
      const status = request.status;
      const type = request.responseType;
      if (call.kind !== 'other' && status >= 200 && status < 300 && (type === '' || type === 'text')) {
        const text = request.responseText;
        if (text.length > RESPONSE_MAX_CHARS) lose(call);
        else if (text.length <= RESPONSE_NOW_CHARS) readOne({ call, text, stamp });
        else if (queue.push({ call, text, stamp })) responses.deferred += 1;
        else lose(call);
      }
      end();
    },
  });

  // Injected after the page began, MAIN missed what the page did before it: its socket, its answers (FS-WS-5).
  if (late) lower(null, WHY_LATE);

  return {
    handle(t, payload) {
      if (t === REQ_STATE) {
        if (!isEmpty(payload)) return ERR_BAD_REQUEST;
        const lastBatch = emitter.start();
        const current = contract();
        contractSent = stringify(current);
        // The stream goes on after this answer, not before it: the next turn.
        context.setTimer(end, 0);
        return { identity: identity(), socket: { epoch, confirmed }, chat: null, contract: current, lastBatch };
      }
      if (t === REQ_ACK) {
        if (!isAck(payload)) return ERR_BAD_REQUEST;
        emitter.ack((payload as { n: number }).n);
        return null;
      }
      if (t === REQ_HEALTH) {
        if (!isEmpty(payload)) return ERR_BAD_REQUEST;
        return { frames: { ...frames }, responses: { ...responses }, stream: emitter.stats(), perf: { frameParseMs: frameTimes.read(), xhrParseMs: xhrTimes.read() } };
      }
      return REQ_LATER.includes(t) ? ERR_NOT_READY : ERR_UNKNOWN_REQUEST;
    },
    dispose() {
      ws.restore();
      xhr.restore();
    },
  };
}

/** Installs Fansly's MAIN world in `win`: the shared boot of host-kit with Fansly's runtime attached at once. */
export function installFanslyMain(win: Window, network: FanslyNetwork): MainBridgeHandle {
  return installMainBridge(win, { runtime: (context) => createFanslyRuntime(context, network) });
}
