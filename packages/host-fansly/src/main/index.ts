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
// - the observation of the account's chats in compact rings under one memory
//   account (observation.ts, memory.ts), their completeness and certificates
//   (certificate.ts), who is who — the creator, groups and their fans, the DM
//   rules, the fans' avatars (identity.ts) — and what is automated
//   (automation.ts): every message, deletion, member change and answer of the
//   table goes there (P7b);
// - the stream (emitter.ts): one `fx.batch` per listener call under the
//   credits, states coalesced (`fx.identity`, `fx.chat` of the focused group,
//   `fx.contract`), one `fx.gap` when the isolated side stopped taking them —
//   every chat unknown then. Every new message (5/1, ours too) is
//   `fx.incoming` with its group's fan; a follow `fx.follow`; deletions of the
//   focused group `fx.deleted`; every loss and certificate `fx.coverage`; a
//   confirmed vault upload `fx.vaultAdded`. Our own sends' echo and receipt are
//   P7f's, the old extension and FBuddy's markers P7g's;
// - the requests: `fx.state` (and the stream starts), `fx.ack`, `fx.health`,
//   `fx.focus`, `fx.windowMeta` and `fx.generationSnapshot` (snapshot.ts).
//
// The page's own world: nothing of ours may throw into it (decision X22).
// Every callback the page or the browser calls is a `guard(…)`; a Proxy's
// trap lets the native constructor's own error through and keeps ours.

import { installMainBridge, type MainBridgeHandle, type MainContext, type MainRuntime } from '@cg/host-kit/main/bridge';
import { idOf, int, isPlain, shape, type Plain } from '@cg/host-kit/main/check';
import { ERR_BAD_REQUEST, ERR_UNKNOWN_REQUEST } from '@cg/host-kit/main/protocol';

import { createAutomation, madeBySomething, textHash, type Automation } from './automation';
import type { Stamp } from './certificate';
import { createEmitter } from './emitter';
import { frameMessage, readFrame, type FrameMessage } from './frame-parse';
import { createIdentity, type Identity } from './identity';
import { createMemory } from './memory';
import { createObservation, type Observation } from './observation';
import {
  ANCHOR_NOT_YET,
  ANCHOR_OK,
  ANCHOR_SHAPE,
  EVT_CHAT,
  EVT_CONTRACT,
  EVT_FOLLOW,
  EVT_IDENTITY,
  EVT_INCOMING,
  EVT_VAULT,
  EVT_VAULT_RELOADED,
  REQ_VAULT_STATE,
  FRAMES_UNREAD_SIGN,
  GAP_MEMORY,
  PARSE_BOUNDS,
  REQ_ACK,
  REQ_FOCUS,
  REQ_HEALTH,
  REQ_SNAPSHOT,
  REQ_STATE,
  REQ_WINDOW,
  RESPONSE_MAX_CHARS,
  RESPONSE_NOW_CHARS,
  SILENT_MS,
  SNAPSHOT_BOUNDS,
  SNAPSHOT_DRAIN_MS,
  TAP_OK,
  TAP_SILENT,
  TAP_WRAPPED,
  WHY_BFCACHE,
  WHY_FRAME,
  WHY_GAP,
  WHY_LATE,
  WHY_NOT_CERTIFIED,
  WHY_PARSE_LIMIT,
  WHY_SOCKET,
} from './protocol';
import { classifyAddress, createResponseQueue, readResponse, type ApiCall, type Deferred, type ResponseRead } from './responses';
import { createViews, isFocus, isSnapshotRequest, isWindowRequest, type Views } from './snapshot';
import { installWsTap, type TapNatives } from './ws-tap';
import { installXhrTap } from './xhr-tap';

/** Where the page's socket and API are (FS-WS-1, §5.4): the site's addresses, handed in by the entry point. */
export interface FanslyNetwork {
  /** Host names of the page's socket, compared with the parsed host of its address. */
  readonly socketHosts: readonly string[];
  /** Origins of the page's API, whose paths are `/api/v1/…`; an origin matches with a port after it too. */
  readonly apiOrigins: readonly string[];
}

/** A time histogram over `bounds`: bucket i counts values ≤ bounds[i], the last one what is above them all. */
function histogram(bounds: readonly number[]): { add(ms: number): void; read(): Plain } {
  const counts: number[] = bounds.map(() => 0).concat(0);
  let count = 0;
  let sum = 0;
  let max = 0;
  return {
    add(ms) {
      let bucket = 0;
      while (bucket < bounds.length && ms > (bounds[bucket] as number)) bucket += 1;
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

/**
 * The messages of an answer (`messages[]`), as MAIN keeps them, and how many the page sent. One MAIN cannot read is
 * never left out quietly: `lost` names its chat — null when it names none (every chat), `[]` when all were read.
 */
const messagesOf = (response: unknown): { readonly messages: FrameMessage[]; readonly count: number; readonly lost: string[] | null } => {
  const list = isPlain(response) && Array.isArray(response['messages']) ? (response['messages'] as unknown[]) : [];
  const messages: FrameMessage[] = [];
  let lost: string[] | null = [];
  for (const item of list) {
    const m = frameMessage(item);
    if (m !== null) messages.push(m);
    else {
      const groupId = isPlain(item) ? idOf(item['groupId']) : null;
      if (groupId === null) lost = null;
      else lost?.push(groupId);
    }
  }
  return { messages, count: list.length, lost };
};
const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? (value as unknown[]) : []);

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
  const Url = win.URL;
  const late = win.document.readyState !== 'loading';

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
  /** The order of observations in this document (§5.6): a frame's item, an XHR's `loadstart`, a loss. */
  let seq = 0;
  let vaultAlbum: string | null = null;
  let vaultSeen = 0;
  /** The route epoch of the last `fx.focus` (FS-RTE-4). */
  let routeEpoch = 0;
  const frames = { seen: 0, parsed: 0, lost: 0 };
  const responses = { seen: 0, parsed: 0, deferred: 0, lost: 0 };
  const frameTimes = histogram(PARSE_BOUNDS);
  const xhrTimes = histogram(PARSE_BOUNDS);
  const snapshotTimes = histogram(SNAPSHOT_BOUNDS);
  let contractSent = '';
  let chatSent = '';

  // A gap of the stream: the isolated side lost events — every chat unknown until the next certificate (§5.12).
  const emitter = createEmitter((t, payload) => context.post(t, payload), stringify, () => world().observation.lose(null, WHY_GAP));
  // eslint-disable-next-line prefer-const -- the queue's own drain needs the runtime's `end`, defined below it
  let queue: ReturnType<typeof createResponseQueue<Stamp>>;
  const memory = createMemory(() => 2 * queue.chars() + emitter.held());
  /**
   * What the observation is made of, built at its first use — the first frame, answer or request, never at
   * document_start: MAIN's whole synchronous start stays ≤ 1 ms (§3.1), whatever the observation's code weighs.
   */
  let built: { readonly identity: Identity; readonly automation: Automation; readonly observation: Observation; readonly views: Views } | null = null;
  const world = (): NonNullable<typeof built> => {
    if (built !== null) return built;
    // The groups of the chats observed, and the focused one, are the last to be forgotten.
    const identity = createIdentity(memory, parse, Url, (groupId) => observation.focus === groupId || observation.chat(groupId) !== undefined);
    const automation = createAutomation(parse);
    const observation = createObservation({
      memory,
      identity,
      automation,
      event: (t, p) => emitter.event(t, p),
      now,
      wake: (ms) =>
        context.setTimer(() => {
          observation.settle();
          end();
        }, ms),
      tick: () => (seq += 1),
      seq: () => seq,
    });
    built = { identity, automation, observation, views: createViews(observation, identity, stringify) };
    return built;
  };
  /** The creator of `/account/me`, without building anything for it. */
  const creator = (): string | null => built?.identity.creator ?? null;

  // FBuddy's markers and the old extension are P7g's: until then MAIN says it saw neither.
  const identityState = (): Plain => ({
    creatorId: creator(),
    accountMeSeen: creator() !== null,
    legacy: false,
    fbuddy: { windowBridge: false, networkHook: false, styleFixes: false, wordFilter: false },
  });

  const contract = (): Plain => ({
    anchors: {
      accountMe: creator() === null ? ANCHOR_NOT_YET : ANCHOR_OK,
      socket: epoch === 0 ? ANCHOR_NOT_YET : ANCHOR_OK,
      frames: unread ? ANCHOR_SHAPE : frames.parsed > 0 ? ANCHOR_OK : ANCHOR_NOT_YET,
      xhr: responses.seen > 0 ? ANCHOR_OK : ANCHOR_NOT_YET,
    },
    tap: ws.wrapped() || xhr.wrapped() ? TAP_WRAPPED : confirmed && now() - lastFrameAt > SILENT_MS ? TAP_SILENT : TAP_OK,
  });

  const focusedView = (): Plain | null => {
    const { observation, views } = world();
    return observation.focus === null ? null : views.chat(observation.focus, routeEpoch);
  };

  /**
   * The end of a listener call: the account within its limits, the focused chat and the contract if they changed,
   * then at most one batch.
   */
  const end = (): void => {
    const { observation } = world();
    observation.enforce(() => {
      if (emitter.stats().queued === 0) return false;
      emitter.gap(GAP_MEMORY);
      return true;
    });
    if (observation.dirty) {
      observation.dirty = false;
      const view = focusedView();
      const text = view === null ? '' : stringify(view);
      if (view !== null && text !== chatSent) emitter.state(EVT_CHAT, view);
      chatSent = text;
    }
    const current = contract();
    const text = stringify(current);
    if (text !== contractSent) {
      contractSent = text;
      emitter.state(EVT_CONTRACT, current);
    }
    emitter.flush();
  };

  const incoming = (m: FrameMessage): void => {
    const { identity, automation } = world();
    // Before `/account/me` nobody is known to be the creator: no message is said to be the fan's.
    const fromFan = identity.creator !== null && m.senderId !== identity.creator;
    const ms = m.createdAt === null ? NaN : m.createdAt * 1000;
    emitter.event(EVT_INCOMING, {
      groupId: m.groupId,
      fanId: identity.fan(m.groupId),
      msgId: m.id,
      fromFan,
      // The old rule (S4 HF-5, NF-033): the model's message of type 2, made by something without a reply, or a welcome text.
      automated: !fromFan && (madeBySomething(m.type, m.correlationId, m.inReplyTo) || automation.welcome(textHash(m.content))),
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
      world().observation.lose(null, WHY_SOCKET);
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
      const { identity, observation } = world();
      for (const item of read.items) {
        seq += 1;
        if (item.k === 'session') confirmed ||= current;
        else if (item.k === 'message') {
          observation.live(item.m);
          incoming(item.m);
        } else if (item.k === 'deleted') observation.deleted(item.id, item.groupId, item.cascade);
        else if (item.k === 'members') {
          if (identity.member(item.groupId, item.userId, item.type === 6, seq)) observation.participants(item.groupId);
        } else if (item.k === 'follow') emitter.event(EVT_FOLLOW, { eventId: item.eventId, accountId: item.accountId, followerId: item.followerId });
        // 'read': a receipt names no chat — nothing to add, nothing to lower; it never crosses the bridge (§5.3).
      }
      if (!read.whole) observation.lose(read.touched, WHY_FRAME);
      if (current && !unread && socketKnown === 0 && socketSeen >= FRAMES_UNREAD_SIGN) {
        // Frames come, and not one is a frame the page reads: the format changed under us.
        unread = true;
        observation.lose(null, WHY_SOCKET);
      }
      frameTimes.add(now() - started);
      end();
    },
    lost() {
      confirmed = false;
      world().observation.lose(null, WHY_SOCKET);
      end();
    },
  });

  /** A group of an answer asked at observation `seen`, and what its `lastMessage` says of the chat's observation. */
  const group = (value: unknown, seen: number, stamp: Stamp | undefined): void => {
    const { identity, observation } = world();
    const id = identity.readGroup(value, seen);
    if (id === null) return;
    const last = isPlain(value) && isPlain(value['lastMessage']) ? idOf(value['lastMessage']['id']) : null;
    if (last !== null) observation.hint(id, last, stamp, { epoch, confirmed });
    if (id === observation.focus) observation.dirty = true;
  };

  const respond = (read: ResponseRead, stamp: Stamp | undefined): void => {
    const { identity, automation, observation } = world();
    const r = read.response;
    /** The answer's place in the order of observations: its `loadstart`. */
    const seen = stamp?.seq ?? seq;
    /**
     * The messages of the answer; one MAIN cannot read loses its chat (`fallback` — the chat of the address, when the
     * message names none) before anything is merged, so the answer certifies nothing (§5.6).
     */
    const messagesIn = (fallback: string | null): ReturnType<typeof messagesOf> => {
      const found = messagesOf(r);
      const { lost } = found;
      if (lost === null) observation.lose(fallback === null ? null : [fallback], WHY_PARSE_LIMIT);
      else if (lost.length > 0) observation.lose(lost, WHY_PARSE_LIMIT);
      return found;
    };
    switch (read.kind) {
      case 'me': {
        const was = identity.creator;
        identity.creator = idOf((r as { account: Plain }).account['id']);
        if (was !== identity.creator) { vaultAlbum = null; vaultSeen = seq; }
        // Another account in the same document: nothing observed under the old one says anything of this one.
        if (was !== null && was !== identity.creator) observation.reset(WHY_NOT_CERTIFIED);
        emitter.state(EVT_IDENTITY, identityState());
        observation.dirty = true;
        return;
      }
      case 'history': {
        const { messages, count } = messagesIn(read.groupId);
        observation.history(read.groupId as string, messages, count, stamp, { epoch, confirmed }, read.limit ?? null);
        return;
      }
      case 'older':
        observation.answer(messagesIn(read.groupId).messages, read.groupId, stamp, { epoch, confirmed });
        return;
      case 'byIds':
        observation.answer(messagesIn(null).messages, null, stamp, { epoch, confirmed });
        return;
      case 'receipt': {
        // The page's own `POST /message`: its new message, under the same rule as a frame (§5.12; the send is P7f's).
        const m = frameMessage(r);
        if (m !== null) observation.sent(m, stamp, { epoch, confirmed });
        return;
      }
      case 'unread':
        for (const item of listOf((r as Plain)['messageInteractions'])) {
          if (!isPlain(item) || (item['deletedAt'] !== null && item['deletedAt'] !== undefined && item['deletedAt'] !== 0)) continue;
          const groupId = idOf(item['groupId']);
          const messageId = idOf(item['messageId']);
          if (groupId !== null && messageId !== null) observation.hint(groupId, messageId, stamp, { epoch, confirmed });
        }
        return;
      case 'group':
        group(r, seen, stamp);
        return;
      case 'groups': {
        const aggregation = (r as Plain)['aggregationData'];
        for (const item of listOf(isPlain(aggregation) ? aggregation['groups'] : null)) group(item, seen, stamp);
        for (const item of listOf(isPlain(aggregation) ? aggregation['accounts'] : null)) identity.readAccount(item);
        for (const item of listOf((r as Plain)['data'])) {
          const groupId = isPlain(item) ? idOf(item['groupId']) : null;
          const last = isPlain(item) ? idOf(item['lastMessageId']) : null;
          if (groupId !== null && last !== null) observation.hint(groupId, last, stamp, { epoch, confirmed });
        }
        return;
      }
      case 'accounts':
        for (const item of r as unknown[]) identity.readAccount(item);
        return;
      case 'automated':
        automation.read(r as unknown[]);
        return;
      case 'vaultReload':
        if (stamp !== undefined && stamp.seq > vaultSeen && read.albumId !== undefined) {
          vaultSeen = stamp.seq;
          vaultAlbum = read.albumId;
          emitter.event(EVT_VAULT_RELOADED, { seq: stamp.seq, albumId: read.albumId });
        }
        return;
      case 'vault':
        if (stamp !== undefined) emitter.event(EVT_VAULT, { seq: stamp.seq });
        return;
      case 'other':
        // Never read: `readResponse` takes the table's kinds only.
        return;
    }
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

  queue = createResponseQueue<Stamp>({ now, idle, later, guard }, readOne, end);

  const lose = (call: ApiCall): void => {
    responses.lost += 1;
    world().observation.lose(call.groupId === null ? null : [call.groupId], WHY_PARSE_LIMIT);
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

  // Back from the back-forward cache: what happened meanwhile is not known (§5.6).
  try {
    natives.listenOn(
      win,
      'pageshow',
      guard('pageShow', (event: Event) => {
        if (!(event as PageTransitionEvent).persisted) return;
        world().observation.lose(null, WHY_BFCACHE);
        end();
      }),
    );
  } catch {
    fault('pageShow');
  }

  // Injected after the page began, MAIN missed what the page did before it: its socket, its answers (FS-WS-5).
  if (late) world().observation.lose(null, WHY_LATE);

  return {
    handle(t, payload) {
      if (t === REQ_STATE) {
        if (!isEmpty(payload)) return ERR_BAD_REQUEST;
        const lastBatch = emitter.start();
        const current = contract();
        contractSent = stringify(current);
        const chat = focusedView();
        chatSent = chat === null ? '' : stringify(chat);
        // The stream goes on after this answer, not before it: the next turn.
        context.setTimer(end, 0);
        return { identity: identityState(), socket: { epoch, confirmed }, chat, contract: current, lastBatch };
      }
      if (t === REQ_ACK) {
        if (!isAck(payload)) return ERR_BAD_REQUEST;
        emitter.ack((payload as { n: number }).n);
        return null;
      }
      if (t === REQ_VAULT_STATE) {
        if (!isEmpty(payload)) return ERR_BAD_REQUEST;
        return { seq, albumId: vaultAlbum, creatorId: world().identity.creator };
      }
      if (t === REQ_HEALTH) {
        if (!isEmpty(payload)) return ERR_BAD_REQUEST;
        return {
          frames: { ...frames },
          responses: { ...responses },
          stream: emitter.stats(),
          perf: { frameParseMs: frameTimes.read(), xhrParseMs: xhrTimes.read(), snapshotMs: snapshotTimes.read() },
        };
      }
      if (t === REQ_FOCUS) {
        if (!isFocus(payload)) return ERR_BAD_REQUEST;
        const focus = payload as { groupId: string | null; routeEpoch: number };
        const { observation } = world();
        observation.focus = focus.groupId;
        routeEpoch = focus.routeEpoch;
        if (focus.groupId !== null) observation.touch(focus.groupId);
        observation.dirty = true;
        // `fx.chat` of this group follows the answer, with the same route epoch.
        chatSent = '';
        context.setTimer(end, 0);
        return null;
      }
      if (t === REQ_WINDOW) {
        if (!isWindowRequest(payload)) return ERR_BAD_REQUEST;
        return world().views.chat((payload as { groupId: string }).groupId, routeEpoch);
      }
      if (t === REQ_SNAPSHOT) {
        if (!isSnapshotRequest(payload)) return ERR_BAD_REQUEST;
        const started = now();
        // A bounded drain: the answers still waiting are read now, within the budget, or the snapshot says so.
        const drained = queue.drain(SNAPSHOT_DRAIN_MS);
        const { observation, views } = world();
        observation.settle();
        const snapshot = views.snapshot(payload, { document: context.documentEpoch, socket: epoch, route: routeEpoch }, drained);
        snapshotTimes.add(now() - started);
        // What the drain read goes out after this answer.
        context.setTimer(end, 0);
        return snapshot;
      }
      return ERR_UNKNOWN_REQUEST;
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
