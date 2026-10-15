// The observation of the account's chats (docs/project-unite/architecture.md
// §5.5, §5.6; FS-TAIL-3, FS-TAIL-5): every chat the page's socket and answers
// bring — the socket speaks of every chat of the account — in a ring of its
// last RING_RECORDS messages, at most MAX_CHATS chats, and the texts of the
// last TEXTS_PER_CHAT messages of the TEXT_CHATS most recently active ones.
//
// - **Compact rings** (spike P3a: an object a record costs 167 B, and 300 ×
//   120 of them would not fit 4 MiB): per chat a sorted array of id strings,
//   and in typed arrays beside it the time (`createdAt`, seconds), the
//   observation number it came at, the hash of its folded text (the welcome
//   rule, automation.ts) and its flags — the fan's, media, deleted, made by
//   something, has a text. A correlation id and a text are kept in arrays of
//   their own, made only for a chat that has one.
// - **Order** is the snowflake's (the shorter id is the older, then the string
//   order), never `createdAt`: messages of one second come in reverse (S2 Q1.5).
// - **Sources** — whatever brings messages or their ids, the page's network
//   only, never the DOM: new messages of the socket (5/1) and of the page's own
//   `POST /message`; the history (`/message?groupId=`, the fresh end and older
//   pages), messages by id (`/messages?ids=`) — into the rings; deletions
//   (5/10, a deleted mass-send parent `type 3` taking its copies in every chat
//   by `correlationId`) — flags, tombstones; ids of the inbox, of a group's
//   `lastMessage` and of the unread list — never into the rings: a source that
//   names a message the observation lacks only lowers the chat (`unseen`, after
//   a grace in which the socket may still bring it). Read receipts name no
//   chat: they neither add nor lower anything. A nested `inReplyToMessage` is
//   no message of the chat.
// - **What a certificate says** (certificate.ts, the rule of §5.12): in the
//   span of the latest request's certificate the ring holds exactly its
//   messages, those whose socket frame came after its request began, and the
//   deleted (flagged, kept for `deletedIds`). Only frames add there; other
//   answers — our own send's too — add and remove nothing; one asked within
//   the segment after the governing request that names a message the chat
//   lacks makes the chat wait for that message's frame, then lowers it. A
//   creation frame behind the answer is a conflict. Tombstones come from the
//   socket's deletions (`5/10`) only — a message is never undeleted — and win
//   over any answer.
// - **One memory account** (memory.ts): every ring, text and tombstone is
//   counted as it comes and goes; over a limit the least recently active
//   chat's texts go first, then whole chats — evicted, `unknown`. The focused
//   chat goes last.
// - Completeness and certificates: certificate.ts; the rules it holds are
//   applied here, where the ring is.

import type { Plain } from '@cg/host-kit/main/check';

import { madeBySomething, textHash, type Automation } from './automation';
import { behind, certifiable, certify, compareIds, degrade, governor, newer, uncertified, type Completeness, type Stamp } from './certificate';
import type { FrameMessage } from './frame-parse';
import type { Identity } from './identity';
import { enforce, type Memory } from './memory';
import {
  CASCADES,
  COMPLETE,
  COST_CHAT,
  COST_CORR,
  COST_RECORD,
  COST_SLOT,
  COST_TEXT,
  COST_TOMB,
  EVT_COVERAGE,
  EVT_DELETED,
  HISTORY_PAGE,
  MAX_CHATS,
  RING_RECORDS,
  TEXT_CHATS,
  TEXTS_PER_CHAT,
  TOMBSTONES,
  UNKNOWN,
  UNSEEN_GRACE_MS,
  UNSEEN_MAX,
  WHY_CERTIFICATE,
  WHY_EVICTED,
  WHY_FRAME,
  WHY_PARTICIPANTS,
  WHY_UNSEEN,
} from './protocol';

/** A record's flags. */
export const FAN = 1;
export const MEDIA = 2;
export const DELETED = 4;
/** Made by something (`type 2`, a `correlationId` without `inReplyTo`) — the model's; the welcome rule adds its hash. */
export const MADE = 8;
export const TEXT = 16;
/** Seen live: its socket frame `5/1` (or the page's own send) came; the record's second word is when. */
export const LIVE = 32;

/** Three 32-bit words a record: its time, the observation number its frame came at (0 — none), its welcome hash. */
const WORDS = 3;

export { compareIds };

export interface Chat extends Completeness {
  readonly id: string;
  /** Message ids, oldest first. */
  ids: string[];
  /** `[createdAt seconds (0 — unknown), observation number of its `5/1` (0 — none), welcome hash]` a record. */
  words: Uint32Array;
  bits: Uint8Array;
  /** `correlationId` a record; null until the chat has one. */
  corr: Array<string | null> | null;
  /** The text a record, the last TEXTS_PER_CHAT of them; null — the chat holds none. */
  texts: Array<string | undefined> | null;
  textCount: number;
  textBytes: number;
  /** Bytes of its ring in the account (its own object, slots, ids, correlation ids). */
  bytes: number;
  /** Its place in the order of activity: the larger, the more recent. */
  active: number;
}

export interface ObservationDeps {
  readonly memory: Memory;
  readonly identity: Identity;
  readonly automation: Automation;
  /** An event of the stream. */
  readonly event: (t: string, p: Plain) => void;
  readonly now: () => number;
  /** The settle of a waited-for message, this many ms from now (the runtime ends the call after it). */
  readonly wake: (ms: number) => void;
  /** The next observation number (a loss takes one). */
  readonly tick: () => number;
  /** The current one. */
  readonly seq: () => number;
}

/** The socket as a certificate sees it: the newest epoch and whether `t:1` came on it. */
export interface Socket {
  readonly epoch: number;
  readonly confirmed: boolean;
}

export interface Observation {
  /** The group of the open route (`fx.focus`), or null. */
  focus: string | null;
  /** The focused chat's view may have changed: the runtime sends `fx.chat` again if it did. */
  dirty: boolean;
  chat(id: string): Chat | undefined;
  /** A new message of the socket (5/1): live. */
  live(m: FrameMessage): void;
  /** The answer of the page's own `POST /message`: an answer like another; inside the interval its echo frame adds it. */
  sent(m: FrameMessage, stamp: Stamp | undefined, socket: Socket): void;
  /** The fresh end of a chat: a certificate, when `certifiable`; `limit` — the page's own (`limit=` of its address). */
  history(groupId: string, messages: readonly FrameMessage[], count: number, stamp: Stamp | undefined, socket: Socket, limit: number | null): void;
  /** An older page, messages by id, a fresh end that is no certificate: into the rings outside what certificates govern. */
  answer(messages: readonly FrameMessage[], groupId: string | null, stamp: Stamp | undefined, socket: Socket): void;
  /** 5/10: a message deleted; a deleted mass-send parent (`cascade`) takes its copies in every chat. */
  deleted(id: string, groupId: string | null, cascade: boolean): void;
  /** A source named a message of a chat (`lastMessageId`, `lastMessage`, the unread list). */
  hint(groupId: string, id: string, stamp: Stamp | undefined, socket: Socket): void;
  /** Who is in the group changed (4/6, 4/7). */
  participants(groupId: string): void;
  /** A loss: the chats named, or every one (null); every chat named is said, as the tap said it since P7a. */
  lose(groupIds: readonly string[] | null, reason: string): void;
  /** Messages named and not seen, whose grace is over, lower their chats. */
  settle(): void;
  /** A message named and not seen waits for the socket in this chat: it is not provably complete. */
  waiting(groupId: string): boolean;
  /** The chat is the focused one, or became active. */
  touch(groupId: string): void;
  /** The model's message `i` is automated: made by something, or a welcome text. */
  automated(chat: Chat, i: number): boolean;
  /** The account within its limits; `stream` — drop the bridge's queue (`fx.gap {memory}`), false when nothing is left. */
  enforce(stream: () => boolean): void;
  /** Forgets every chat (the creator changed): all unknown. */
  reset(reason: string): void;
  /** The newest message not seen deleted, or -1. */
  newest(chat: Chat): number;
  /** Chats observed now (a test's and the health's). */
  size(): number;
}

export function createObservation(deps: ObservationDeps): Observation {
  const { memory, identity, automation, event, now, wake, tick, seq } = deps;
  const chats = new Map<string, Chat>();
  /** Ids seen deleted (5/10) and their chat (null — not named). */
  const tombs = new Map<string, string | null>();
  const cascades = new Set<string>();
  /** Messages a source named, not seen yet: id → its chat and when its grace ends. */
  const waited = new Map<string, { readonly g: string; readonly due: number; readonly since: number }>();
  let clock = 0;
  let textChats = 0;
  let allLoss = 0;
  let woken = false;

  const coverage = (groupIds: readonly string[] | 'all', state: string, reason: string): void => event(EVT_COVERAGE, { groupIds: groupIds === 'all' ? groupIds : [...groupIds], state, reason });

  // ── the ring ────────────────────────────────────────────────────────────

  const find = (chat: Chat, id: string): number => {
    let lo = 0;
    let hi = chat.ids.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const c = compareIds(chat.ids[mid] as string, id);
      if (c === 0) return mid;
      if (c < 0) lo = mid + 1;
      else hi = mid - 1;
    }
    return ~lo;
  };

  const charge = (chat: Chat, bytes: number): void => {
    chat.bytes += bytes;
    memory.rings += bytes;
  };

  const room = (chat: Chat): void => {
    const cap = chat.bits.length;
    if (chat.ids.length < cap || cap >= RING_RECORDS) return;
    const next = cap < 32 ? 32 : RING_RECORDS;
    const words = new Uint32Array(next * WORDS);
    words.set(chat.words);
    const bits = new Uint8Array(next);
    bits.set(chat.bits);
    chat.words = words;
    chat.bits = bits;
    charge(chat, (next - cap) * COST_SLOT);
  };

  const dropText = (chat: Chat, i: number): void => {
    const text = chat.texts?.[i];
    if (chat.texts === null || text === undefined) return;
    chat.texts[i] = undefined;
    const cost = COST_TEXT + 2 * text.length;
    chat.textCount -= 1;
    chat.textBytes -= cost;
    memory.texts -= cost;
  };

  const removeAt = (chat: Chat, i: number): void => {
    dropText(chat, i);
    const n = chat.ids.length;
    chat.words.copyWithin(i * WORDS, (i + 1) * WORDS, n * WORDS);
    chat.bits.copyWithin(i, i + 1, n);
    chat.bits[n - 1] = 0;
    chat.ids.splice(i, 1);
    const corr = chat.corr?.splice(i, 1)[0] ?? null;
    chat.texts?.splice(i, 1);
    charge(chat, -(COST_RECORD + (corr === null ? 0 : COST_CORR)));
  };

  /** Inserts a record at its place; -1 — it is older than a full ring holds. A live one (`LIVE`) notes when its frame came. */
  const insert = (chat: Chat, id: string, at: number, hash: number, bits: number, corr: string | null): number => {
    let i = find(chat, id);
    if (i >= 0) return i;
    i = ~i;
    if (chat.ids.length >= RING_RECORDS) {
      if (i === 0) return -1;
      // The ring rolls over its oldest record: the interval now starts after it, and a proof of the start is gone.
      removeAt(chat, 0);
      i -= 1;
      chat.start = false;
      const oldest = chat.ids[0];
      if (oldest !== undefined && (chat.floor === null || compareIds(oldest, chat.floor) > 0)) chat.floor = oldest;
    }
    room(chat);
    const n = chat.ids.length;
    chat.words.copyWithin((i + 1) * WORDS, i * WORDS, n * WORDS);
    chat.bits.copyWithin(i + 1, i, n);
    chat.words[i * WORDS] = at;
    chat.words[i * WORDS + 1] = bits & LIVE ? seq() : 0;
    chat.words[i * WORDS + 2] = hash;
    chat.bits[i] = bits;
    chat.ids.splice(i, 0, id);
    if (corr !== null && chat.corr === null) chat.corr = chat.ids.map(() => null);
    else chat.corr?.splice(i, 0, corr);
    if (chat.corr !== null) chat.corr[i] = corr;
    chat.texts?.splice(i, 0, undefined);
    charge(chat, COST_RECORD + (corr === null ? 0 : COST_CORR));
    return i;
  };

  // ── chats, texts and the order of activity ──────────────────────────────

  const newest = (chat: Chat): number => {
    for (let i = chat.ids.length - 1; i >= 0; i -= 1) if (!((chat.bits[i] as number) & DELETED)) return i;
    return -1;
  };

  /** The least recently active chat but `keep`, the focused one only when no other is left; `texts` — only with texts. */
  const leastActive = (keep: Chat | null, texts: boolean): Chat | null => {
    let found: Chat | null = null;
    for (const chat of chats.values()) {
      if (chat === keep || (texts && chat.texts === null)) continue;
      const focused = chat.id === observation.focus;
      if (found === null || (found.id === observation.focus && !focused) || (focused === (found.id === observation.focus) && chat.active < found.active)) found = chat;
    }
    return found;
  };

  /** A loss of one chat; said when it was complete (an observation-made loss, not the tap's). */
  const lower = (chat: Chat, reason: string): void => {
    if (degrade(chat, reason, tick())) coverage([chat.id], UNKNOWN, reason);
    if (chat.id === observation.focus) observation.dirty = true;
  };

  const dropTexts = (chat: Chat): void => {
    if (chat.texts === null) return;
    memory.texts -= chat.textBytes;
    chat.texts = null;
    chat.textCount = 0;
    chat.textBytes = 0;
    textChats -= 1;
    lower(chat, WHY_EVICTED);
  };

  const evict = (chat: Chat): void => {
    if (chat.texts !== null) {
      memory.texts -= chat.textBytes;
      textChats -= 1;
    }
    memory.rings -= chat.bytes;
    chats.delete(chat.id);
    for (const [id, wait] of waited) if (wait.g === chat.id) waited.delete(id);
    if (chat.ever) coverage([chat.id], UNKNOWN, WHY_EVICTED);
    if (chat.id === observation.focus) observation.dirty = true;
  };

  const ensure = (id: string): Chat => {
    let chat = chats.get(id);
    if (chat === undefined) {
      if (chats.size >= MAX_CHATS) {
        const victim = leastActive(null, false);
        if (victim !== null) evict(victim);
      }
      chat = { ...uncertified(), id, ids: [], words: new Uint32Array(8 * WORDS), bits: new Uint8Array(8), corr: null, texts: null, textCount: 0, textBytes: 0, bytes: 0, active: 0 };
      chats.set(id, chat);
      charge(chat, COST_CHAT + 8 * COST_SLOT);
    }
    return chat;
  };

  const setText = (chat: Chat, i: number, text: string): void => {
    if (chat.texts === null) {
      if (textChats >= TEXT_CHATS) {
        const victim = leastActive(chat, true);
        if (victim !== null) dropTexts(victim);
      }
      chat.texts = chat.ids.map(() => undefined);
      textChats += 1;
    }
    if (chat.texts[i] !== undefined) return;
    chat.texts[i] = text;
    const cost = COST_TEXT + 2 * text.length;
    chat.textCount += 1;
    chat.textBytes += cost;
    memory.texts += cost;
    // The newest texts stay: the check window is at most TEXTS_PER_CHAT messages.
    for (let j = 0; chat.textCount > TEXTS_PER_CHAT && j < chat.ids.length; j += 1) dropText(chat, j);
  };

  /**
   * A deletion remembered. Deletion knowledge is never forgotten silently: an answer still on its way may hold the
   * message, and nothing would say it is gone. The oldest one forgotten makes its chat (or, unnamed, every chat)
   * unknown until a certificate of a request begun after (§5.12).
   */
  const tomb = (id: string, groupId: string | null): void => {
    if (tombs.has(id)) return;
    tombs.set(id, groupId);
    memory.tombs += COST_TOMB;
    if (tombs.size > TOMBSTONES) {
      const [oldest, chat] = tombs.entries().next().value as [string, string | null];
      tombs.delete(oldest);
      memory.tombs -= COST_TOMB;
      observation.lose(chat === null ? null : [chat], WHY_EVICTED);
    }
  };

  const gone = (m: FrameMessage): boolean => tombs.has(m.id) || (m.correlationId !== null && cascades.has(m.correlationId));

  /**
   * A message into its chat's ring — `live` when its socket frame (or the page's own send) brought it; the index, and
   * whether it was new. A deleted one comes in flagged, without its text.
   */
  const ingest = (chat: Chat, m: FrameMessage, live: boolean): { readonly i: number; readonly fresh: boolean } => {
    const known = find(chat, m.id);
    const deleted = gone(m);
    if (known >= 0) {
      if (live && !((chat.bits[known] as number) & LIVE)) {
        chat.bits[known] = (chat.bits[known] as number) | LIVE;
        chat.words[known * WORDS + 1] = seq();
      }
      if (!deleted && m.content !== '' && !((chat.bits[known] as number) & DELETED)) {
        chat.bits[known] = (chat.bits[known] as number) | TEXT;
        setText(chat, known, m.content);
      }
      return { i: known, fresh: false };
    }
    const fromFan = m.senderId !== identity.creator;
    const bits =
      (fromFan ? FAN : 0) | (m.media ? MEDIA : 0) | (deleted ? DELETED : 0) | (!fromFan && madeBySomething(m.type, m.correlationId, m.inReplyTo) ? MADE : 0) | (m.content === '' ? 0 : TEXT) | (live ? LIVE : 0);
    const at = m.createdAt === null ? 0 : Math.min(Math.floor(m.createdAt), 0xffffffff);
    const i = insert(chat, m.id, at, fromFan ? 0 : textHash(m.content), bits, m.correlationId);
    if (i >= 0 && !deleted && m.content !== '') setText(chat, i, m.content);
    return { i, fresh: i >= 0 };
  };

  /** Whether `id` lies in what the chat's certificates govern: it is complete, and `id` is at or after its floor. */
  const governed = (chat: Chat, id: string): boolean => chat.complete && (chat.floor === null || compareIds(id, chat.floor) >= 0);

  /**
   * A source names `id`, which the chat lacks inside what its certificates govern: a sign of a loss only if its request
   * began within this segment and after the request of the certificate that governs `id` — an older one is explained
   * by the time between them (a frame tells every change since the governing request began).
   */
  const signals = (chat: Chat, id: string, stamp: Stamp | undefined, socket: Socket): boolean =>
    certifiable(stamp, socket.epoch, socket.confirmed, chat, allLoss) && stamp.seq > governor(chat);

  const wait = (chat: Chat, id: string): void => {
    if (waited.has(id)) return;
    if (waited.size >= UNSEEN_MAX) {
      lower(chat, WHY_UNSEEN);
      return;
    }
    waited.set(id, { g: chat.id, due: now() + UNSEEN_GRACE_MS, since: seq() });
    if (!woken) {
      woken = true;
      wake(UNSEEN_GRACE_MS);
    }
  };

  /**
   * A message made, by a frame of the socket. One made before the newest message of the governing certificate, which
   * that answer lacks, was deleted before the server made it: the frame is behind the answer — a conflict, the chat
   * unknown until a later certificate (§5.12).
   */
  const created = (m: FrameMessage): void => {
    if (identity.creator === null) return;
    const chat = ensure(m.groupId);
    chat.active = clock += 1;
    if (governed(chat, m.id) && find(chat, m.id) < 0 && !gone(m) && behind(chat, m.id)) {
      lower(chat, WHY_FRAME);
      return;
    }
    waited.delete(m.id);
    ingest(chat, m, true);
    if (chat.id === observation.focus) observation.dirty = true;
  };

  const sorted = (messages: readonly FrameMessage[], groupId: string): FrameMessage[] => messages.filter((m) => m.groupId === groupId).sort((a, b) => compareIds(a.id, b.id));

  const observation: Observation = {
    focus: null,
    dirty: false,
    chat: (id) => chats.get(id),
    live(m) {
      created(m);
    },
    sent(m, stamp, socket) {
      if (identity.creator === null) return;
      const chat = ensure(m.groupId);
      // Outside what certificates govern, or known already: data. Inside, only frames add: the send's answer may come
      // before the socket's frames of what happened before the message was made — its echo comes after them, in order.
      // Asked within this segment after the governing request, it says the message exists: the chat waits for the echo.
      if (!governed(chat, m.id) || find(chat, m.id) >= 0) ingest(chat, m, false);
      else if (!gone(m) && signals(chat, m.id, stamp, socket)) wait(chat, m.id);
      if (chat.id === observation.focus) observation.dirty = true;
    },
    history(groupId, messages, count, stamp, socket, limit) {
      if (identity.creator === null) return;
      const chat = ensure(groupId);
      chat.active = clock += 1;
      const own = sorted(messages, groupId);
      // Short by the page's own count: a message left out here (another chat's) does not make a page short.
      const short = limit !== null && count < Math.min(limit, HISTORY_PAGE);
      const lo = short ? null : (own[0]?.id ?? null);
      // No certificate: begun before `t:1` or the chat's last loss, or a full page that showed nothing.
      if (!certifiable(stamp, socket.epoch, socket.confirmed, chat, allLoss) || (!short && own.length === 0)) {
        observation.answer(messages, groupId, stamp, socket);
        return;
      }
      // An answer to a request begun before the governing one's governs nothing: it is only a late answer.
      if (!newer(chat, stamp.seq)) {
        observation.answer(messages, groupId, stamp, socket);
        return;
      }
      const mine = (id: string): boolean => lo === null || compareIds(id, lo) >= 0;
      const held = new Set(own.map((m) => m.id));
      const top = own.at(-1)?.id ?? null;
      // In its span the chat holds exactly: its messages, those whose frame came after its request began, the deleted.
      // Anything else was gone by the time the server made it (and is not kept from a tombstone: a later sighting —
      // a frame, a later certificate — brings it back). A message whose frame came after the request began but which
      // was made before the answer's newest and is not in it: deleted before the answer was made, the deletion's frame
      // still on the way — the socket is behind the answer (a conflict, below).
      let lagging = false;
      for (let i = chat.ids.length - 1; i >= 0; i -= 1) {
        const id = chat.ids[i] as string;
        const bits = chat.bits[i] as number;
        if (bits & DELETED || held.has(id) || !mine(id)) continue;
        if (bits & LIVE && (chat.words[i * WORDS + 1] as number) >= stamp.seq) {
          if (top === null || compareIds(id, top) > 0) continue;
          lagging = true;
        }
        removeAt(chat, i);
      }
      for (const m of own) ingest(chat, m, false);
      // A proof of the start rests on the whole answer: messages that came while it was in flight may have filled the
      // ring, so its older part never entered it.
      const retained = own.every((m) => find(chat, m.id) >= 0);
      const verdict = certify(chat, stamp.seq, lo, top, short && retained);
      // The interval cannot start below what the ring holds.
      const first = chat.ids[0];
      if (chat.floor !== null && first !== undefined && compareIds(first, chat.floor) > 0) chat.floor = first;
      // A message waited for since before this request began is settled by it: held, gone, or below the interval now.
      for (const [id, w] of waited) if (w.g === groupId && w.since < stamp.seq) waited.delete(id);
      if (verdict !== 'held') coverage([groupId], COMPLETE, WHY_CERTIFICATE);
      if (lagging) lower(chat, WHY_FRAME);
      if (groupId === observation.focus) observation.dirty = true;
    },
    answer(messages, groupId, stamp, socket) {
      if (identity.creator === null) return;
      const groups = groupId === null ? [...new Set(messages.map((m) => m.groupId))] : [groupId];
      for (const id of groups) {
        const chat = ensure(id);
        for (const m of sorted(messages, id)) {
          // Outside what certificates govern — or known already (its text, say) — it is data.
          if (!governed(chat, m.id) || find(chat, m.id) >= 0) {
            ingest(chat, m, false);
            continue;
          }
          // Inside, an answer adds nothing: it is older than what governs, or its frame is on the way. Asked within
          // this segment, it names a message the chat lacks: a loss, unless that frame comes (`unseen`).
          if (!gone(m) && signals(chat, m.id, stamp, socket)) wait(chat, m.id);
        }
        if (id === observation.focus) observation.dirty = true;
      }
    },
    deleted(id, groupId, cascade) {
      tomb(id, groupId);
      if (cascade && !cascades.has(id)) {
        cascades.add(id);
        if (cascades.size > CASCADES) {
          // A mass send's copies may be in any chat: forgetting its deletion loses every chat (above).
          cascades.delete(cascades.values().next().value as string);
          observation.lose(null, WHY_EVICTED);
        }
      }
      waited.delete(id);
      const hits = new Map<Chat, string[]>();
      const flag = (chat: Chat, i: number): void => {
        if ((chat.bits[i] as number) & DELETED) return;
        chat.bits[i] = (chat.bits[i] as number) | DELETED;
        dropText(chat, i);
        hits.set(chat, [...(hits.get(chat) ?? []), chat.ids[i] as string]);
      };
      if (groupId !== null && identity.creator !== null) {
        // Known to be of this chat: flagged, or kept flagged, so the order of a deletion and an answer changes nothing.
        const chat = ensure(groupId);
        const i = insert(chat, id, 0, 0, 0, null);
        if (i >= 0) flag(chat, i);
      }
      for (const chat of chats.values()) {
        if (groupId === null) {
          const i = find(chat, id);
          if (i >= 0) flag(chat, i);
        }
        if (cascade && chat.corr !== null) for (let i = 0; i < chat.ids.length; i += 1) if (chat.corr[i] === id) flag(chat, i);
      }
      for (const [chat, ids] of hits) {
        if (chat.id !== observation.focus) continue;
        event(EVT_DELETED, { groupId: chat.id, ids: ids.sort(compareIds) });
        observation.dirty = true;
      }
    },
    hint(groupId, id, stamp, socket) {
      const chat = chats.get(groupId);
      if (chat === undefined || !governed(chat, id) || tombs.has(id) || find(chat, id) >= 0) return;
      if (signals(chat, id, stamp, socket)) wait(chat, id);
    },
    participants(groupId) {
      const chat = chats.get(groupId);
      if (chat !== undefined) lower(chat, WHY_PARTICIPANTS);
      if (groupId === observation.focus) observation.dirty = true;
    },
    lose(groupIds, reason) {
      const at = tick();
      if (groupIds === null || groupIds.length === 0 || groupIds.length > MAX_CHATS) {
        allLoss = at;
        for (const chat of chats.values()) degrade(chat, reason, at);
        coverage('all', UNKNOWN, reason);
      } else {
        // A chat not observed yet still remembers the loss: a request begun before it is no certificate.
        for (const id of groupIds) {
          if (identity.creator === null && !chats.has(id)) continue;
          const chat = ensure(id);
          degrade(chat, reason, at);
        }
        coverage(groupIds, UNKNOWN, reason);
      }
      observation.dirty = true;
    },
    settle() {
      woken = false;
      const time = now();
      let next = Infinity;
      for (const [id, w] of waited) {
        if (w.due > time) {
          next = Math.min(next, w.due);
          continue;
        }
        waited.delete(id);
        const chat = chats.get(w.g);
        if (chat !== undefined && !tombs.has(id)) lower(chat, WHY_UNSEEN);
      }
      if (next !== Infinity) {
        woken = true;
        wake(next - time);
      }
    },
    waiting(groupId) {
      for (const w of waited.values()) if (w.g === groupId) return true;
      return false;
    },
    touch(groupId) {
      const chat = chats.get(groupId);
      if (chat !== undefined) chat.active = clock += 1;
    },
    automated: (chat, i) => !((chat.bits[i] as number) & FAN) && (((chat.bits[i] as number) & MADE) !== 0 || automation.welcome(chat.words[i * WORDS + 2] as number)),
    enforce(stream) {
      const focus = observation.focus === null ? null : (chats.get(observation.focus) ?? null);
      enforce(memory, {
        texts: () => {
          const victim = leastActive(null, true);
          if (victim !== null) dropTexts(victim);
          return victim !== null;
        },
        chat: () => {
          const victim = chats.size > 1 ? leastActive(focus, false) : null;
          if (victim !== null) evict(victim);
          return victim !== null;
        },
        avatar: () => identity.evictAvatar(),
        group: () => identity.evict(observation.focus),
        stream,
      });
    },
    reset(reason) {
      for (const chat of [...chats.values()]) evict(chat);
      waited.clear();
      observation.lose(null, reason);
    },
    newest,
    size: () => chats.size,
  };
  return observation;
}

/** A record's time as ISO 8601, or null (unknown, or past what a four-digit year holds). */
export function isoOf(seconds: number): string | null {
  return seconds > 0 ? new Date(seconds * 1000).toISOString() : null;
}

/** The time of record `i`. */
export const timeOf = (chat: Chat, i: number): number => chat.words[i * WORDS] as number;
