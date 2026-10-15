// One text frame of the page's socket, read the way the page reads it
// (docs/project-unite/architecture.md §5.3; fansly-web.md §5; FS-WS-2, FS-WS-3):
// - `{t, d}` JSON; `t:10000` carries `d` — a JSON string `{serviceId, event}`
//   whose `event` is one more JSON string: three parses; `t:10001` is a
//   package — an array of wrapper strings, each read as a frame of its own;
//   `t:0/1/2` are read no further than the wrapper (`t:1` carries the session
//   token: its `d` is never parsed); the text `"p"` is a ping;
// - every frame is read, typing (5/22) and receipts (4/2, 5/2) too — no
//   filter by prefix (FS-WS-3, P3a: 1–4 µs each);
// - the result carries the projections of the one parse (§5.3): the messages
//   (5/1: the observation, the sound, the echo of a send), deletions (5/10, a
//   `type 3` deletes its copies in every chat — the observation's cascade),
//   receipts (4/2, 5/2), members (4/6–4/8), follows (3/2);
// - and its completeness sign (FS-WS-2): over a limit (1 MiB, packages deeper
//   than 4, more than 256 wrappers), damaged, or a package not an array — the
//   frame is not whole, and the chats it touched (all of them, when a chat
//   cannot be told) become unknown. No silent cut: the old extension stopped
//   its walk at the limits without a word (fansly-chat/src/shared/
//   fansly-ws-frame.ts:121-160).
//
// Pure: no DOM, no state. `parse` is the page's `JSON.parse` as captured at
// install. Ids leave as decimal strings (host-kit `idOf`: a number that is not
// a safe integer has lost digits already, so it is no id).

import { idOf, isPlain, type Plain } from '@cg/host-kit/main/check';

import { FRAME_MAX_CHARS, FRAME_MAX_DEPTH, FRAME_MAX_NODES, SOCKET_PING } from './protocol';

/** A message of a frame as MAIN keeps it (§5.5): ids, sides, time, kind — and its text, which never crosses the bridge. */
export interface FrameMessage {
  readonly id: string;
  readonly groupId: string;
  readonly senderId: string;
  /** 1 — a message, 2 — an automated one, 3 — the parent of a mass send. */
  readonly type: number;
  /** Seconds, as the page has it; null when absent. */
  readonly createdAt: number | null;
  readonly correlationId: string | null;
  readonly inReplyTo: string | null;
  readonly content: string;
  /** A tip: an attachment of content type 7 or a positive `totalTipAmount` (the old rule). */
  readonly tip: boolean;
  /** Any attachment but a tip: media, a bundle, a story. */
  readonly media: boolean;
}

/** What one frame says, item by item, in order. */
export type FrameItem =
  /** `t:1`: the session is verified on this socket — it is confirmed (§5.2). */
  | { readonly k: 'session' }
  /** 5/1: a new message, of any chat of the account, ours too. */
  | { readonly k: 'message'; readonly m: FrameMessage }
  /** 5/10: a message deleted; a `type 3` takes its copies in every chat with it (by `correlationId`). */
  | { readonly k: 'deleted'; readonly id: string; readonly groupId: string | null; readonly cascade: boolean }
  /** 4/2 (production) or 5/2: who read which messages. Never crosses the bridge (§5.3). */
  | { readonly k: 'read'; readonly userId: string | null; readonly ids: readonly string[] }
  /** 4/6 a member added, 4/7 removed, 4/8 a group created: who the group's fan is must be read again. */
  | { readonly k: 'members'; readonly type: number; readonly groupId: string; readonly userId: string | null }
  /** 3/2: a new follower of the account. */
  | { readonly k: 'follow'; readonly eventId: string; readonly accountId: string; readonly followerId: string };

export interface FrameRead {
  /** A frame the page reads: the ping, or a wrapper with a `t` it knows (FS-WS-5 counts frames seen and none of these). */
  readonly known: boolean;
  /** Read whole: nothing over a limit, nothing damaged (FS-WS-2). */
  readonly whole: boolean;
  /** When not whole: the chats it touched; null — they cannot be told, so every chat. */
  readonly touched: readonly string[] | null;
  readonly items: readonly FrameItem[];
  /** Typing announcements (5/22): read in full, counted, never passed on (§5.3). */
  readonly typing: number;
}

const T_ERROR = 0;
const T_SESSION = 1;
const T_PONG = 2;
const T_SERVICE = 10000;
const T_PACKAGE = 10001;
const SERVICE_FOLLOWER = 3;
const SERVICE_GROUP = 4;
const SERVICE_MESSAGE = 5;
const MESSAGE_CREATED = 1;
const MESSAGE_ACK = 2;
const MESSAGE_DELETED = 10;
const MESSAGE_TYPING = 22;
const GROUP_ACK = 2;
const FOLLOW_CREATED = 2;
const TIP_CONTENT_TYPE = 7;
const MASS_SEND_PARENT = 3;

type Parse = (text: string) => unknown;

/** A thrown parse is a damaged frame: `undefined`, which no JSON text parses to. */
function parsed(parse: Parse, text: unknown): unknown {
  if (typeof text !== 'string') return undefined;
  try {
    return parse(text);
  } catch {
    return undefined;
  }
}

const idOrNull = (value: unknown): string | null => (value === null || value === undefined ? null : idOf(value));

function attachments(message: Plain): { tip: boolean; media: boolean } {
  const amount = message['totalTipAmount'];
  let tip = typeof amount === 'number' && amount > 0;
  let media = false;
  const list = message['attachments'];
  if (Array.isArray(list)) {
    for (const item of list as unknown[]) {
      if (!isPlain(item)) continue;
      if (item['contentType'] === TIP_CONTENT_TYPE) tip = true;
      else media = true;
    }
  }
  return { tip, media };
}

/** A message of 5/1 as MAIN keeps it; null — not one (no id, chat or sender, no type). */
export function frameMessage(value: unknown): FrameMessage | null {
  if (!isPlain(value)) return null;
  const id = idOf(value['id']);
  const groupId = idOf(value['groupId']);
  const senderId = idOf(value['senderId']);
  const type = value['type'];
  if (id === null || groupId === null || senderId === null || typeof type !== 'number') return null;
  const createdAt = value['createdAt'];
  const content = value['content'];
  return {
    id,
    groupId,
    senderId,
    type,
    createdAt: typeof createdAt === 'number' && Number.isFinite(createdAt) && createdAt > 0 ? createdAt : null,
    correlationId: idOrNull(value['correlationId']),
    inReplyTo: idOrNull(value['inReplyTo']),
    content: typeof content === 'string' ? content : '',
    ...attachments(value),
  };
}

const ids = (value: unknown): string[] => {
  const out: string[] = [];
  if (!Array.isArray(value)) return out;
  for (const item of value as unknown[]) {
    const id = idOf(item);
    if (id !== null) out.push(id);
  }
  return out;
};

/** Reads one text frame of the page's socket. Never throws. */
export function readFrame(text: string, parse: Parse): FrameRead {
  const items: FrameItem[] = [];
  let known = false;
  let whole = true;
  let typing = 0;
  let nodes = 0;
  /** null — every chat; otherwise the chats a frame that was not read whole touched. */
  let touched: Set<string> | null = new Set<string>();

  const lose = (groupId: string | null): void => {
    whole = false;
    if (groupId === null) touched = null;
    else touched?.add(groupId);
  };

  /** A service event (`t:10000`): its `d` is `{serviceId, event}`, and `event` one more JSON string. */
  const service = (d: unknown): void => {
    const wrapper = parsed(parse, d);
    if (!isPlain(wrapper)) return lose(null);
    const event = parsed(parse, wrapper['event']);
    if (!isPlain(event)) return lose(null);
    const serviceId = wrapper['serviceId'];
    const type = event['type'];
    if (serviceId === SERVICE_MESSAGE) {
      if (type === MESSAGE_CREATED) {
        const m = frameMessage(event['message']);
        if (m === null) return lose(isPlain(event['message']) ? idOf(event['message']['groupId']) : null);
        items.push({ k: 'message', m });
      } else if (type === MESSAGE_DELETED) {
        const message = event['message'];
        const id = isPlain(message) ? idOf(message['id']) : null;
        const groupId = isPlain(message) ? idOf(message['groupId']) : null;
        if (id === null) return lose(groupId);
        items.push({ k: 'deleted', id, groupId, cascade: (message as Plain)['type'] === MASS_SEND_PARENT });
      } else if (type === MESSAGE_ACK) {
        const ack = event['messageAckEvent'] ?? event['ackCommand'];
        if (isPlain(ack)) items.push({ k: 'read', userId: idOrNull(ack['userId']), ids: ids(ack['messageIds']) });
      } else if (type === MESSAGE_TYPING) typing += 1;
    } else if (serviceId === SERVICE_GROUP) {
      if (type === GROUP_ACK) {
        const ack = event['ackCommand'];
        if (isPlain(ack)) items.push({ k: 'read', userId: idOrNull(ack['userId']), ids: ids(ack['messageIds']) });
      } else if (typeof type === 'number' && type >= 6 && type <= 8) {
        // Who is in a group changed and the group cannot be told: whose fan is whose is not known for any chat.
        const member = isPlain(event['groupUser']) ? event['groupUser'] : isPlain(event['group']) ? { groupId: event['group']['id'] } : null;
        const groupId = member === null ? null : idOf(member['groupId']);
        if (groupId === null) return lose(null);
        items.push({ k: 'members', type, groupId, userId: member === null ? null : idOrNull(member['userId']) });
      }
    } else if (serviceId === SERVICE_FOLLOWER && type === FOLLOW_CREATED) {
      const follow = event['follow'];
      const eventId = isPlain(follow) ? idOf(follow['id']) : null;
      const accountId = isPlain(follow) ? idOf(follow['accountId']) : null;
      const followerId = isPlain(follow) ? idOf(follow['followerId']) : null;
      // A follow names no chat: one the page cannot read is no loss of the observation.
      if (eventId !== null && accountId !== null && followerId !== null && accountId !== followerId) items.push({ k: 'follow', eventId, accountId, followerId });
    }
  };

  const wrapper = (value: unknown, depth: number): void => {
    nodes += 1;
    if (nodes > FRAME_MAX_NODES || depth > FRAME_MAX_DEPTH || !isPlain(value)) return lose(null);
    const t = value['t'];
    const d = value['d'];
    // A `t` the page does not know: nothing it reads, and so nothing lost.
    if (t !== T_ERROR && t !== T_SESSION && t !== T_PONG && t !== T_SERVICE && t !== T_PACKAGE) return;
    if (depth === 0) known = true;
    if (t === T_SESSION) items.push({ k: 'session' });
    else if (t === T_SERVICE) service(d);
    else if (t === T_PACKAGE) {
      // The page walks `d` by index: a package that is not an array of frames is not read (FS-WS-2).
      if (!Array.isArray(d)) return lose(null);
      for (const inner of d as unknown[]) {
        // Every chat is unknown already: the rest of the package changes nothing.
        if (!whole && touched === null) return;
        const frame = parsed(parse, inner);
        if (frame === undefined) lose(null);
        else wrapper(frame, depth + 1);
      }
    }
  };

  if (text === SOCKET_PING) return { known: true, whole: true, touched: null, items, typing };
  if (text.length > FRAME_MAX_CHARS) lose(null);
  else {
    const frame = parsed(parse, text);
    if (frame === undefined) lose(null);
    else wrapper(frame, 0);
  }
  const lost: Set<string> | null = touched;
  return { known, whole, touched: whole ? null : lost === null ? null : [...lost], items, typing };
}
