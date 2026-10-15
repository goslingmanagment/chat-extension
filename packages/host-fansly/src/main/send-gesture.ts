// The person's send on Fansly, attributed (docs/project-unite/architecture.md
// §5.9; spec FS-SEND-1, FS-SEND-2; spike P3a §3). We never send: the person
// presses Enter in Fansly's own field, or clicks its own Send, and the page
// makes the request. MAIN only watches, and says `fx.sent` when one send is
// proven to be that gesture's:
// - THE GESTURE. In the capture phase on the window, passive, the last
//   TRUSTED event of a send: `keydown` Enter without Shift and outside an IME
//   composition on `textarea.message-input` of the main conversation's
//   composer, or `click` on that composer's `.send-button`. A script's event
//   (`isTrusted: false`), the mini-chat's composer, a modal's or an editor's
//   are not. The event is let go by a timer — only the reference: the
//   predicate never waits for one.
// - THE MARK. An XHR whose native `loadstart` comes while that event is STILL
//   BEING DELIVERED (`eventPhase` not NONE, `currentTarget` set) on the same
//   address gets the gesture's mark. The microtasks between listeners — and
//   after the last one — run inside the delivery, so a send the page makes in
//   one is marked; a send begun later — a timer, a message channel, the send
//   with media that waits for its upload — sees NONE and is not. Fansly sends
//   a message without media synchronously inside the keydown or the click
//   (fansly-web.md §3, main:56169-56199).
// - THE RECEIPT. A marked answer at exactly `/api/v1/message` (not
//   `/message/ack`, `/typing`, `/broadcast`: the response table's `receipt`)
//   is the gesture's candidate. Its count is final at the first `loadend` of
//   the gesture's marked requests — the delivery is long over by then (a
//   synchronous request that ends inside it is settled a turn later). One
//   candidate whose answer names the gesture's chat, the creator as sender
//   and no media is the receipt; two candidates — not attributed; media — not
//   attributed, by rule (§5.9 п. 6).
// - THE ECHO. The socket's `5/1` with the receipt's id from the creator, in
//   either order: an echo that comes while a marked request is in flight
//   waits for its receipt, a receipt waits for its echo — at most
//   SEND_WAIT_MAX of each, SEND_WAIT_MS long. Both → `fx.sent {groupId,
//   msgId, contentDigest}`: the digest of the answer's `content`, normalized
//   as the isolated side digests the field (host-kit), so the text never
//   crosses. No echo — no `fx.sent`.
// - A send the neighbour's word filter swallowed (FBuddy, S5 §2.6) never
//   starts: no `loadstart`, no mark — nothing; the next send is attributed as
//   usual. What this file counts goes to `fx.health.sends`.
//
// The isolated side links an `fx.sent` to the draft it read at the same
// gesture (isolated/send-observe.ts).

import { digest, normalize } from '@cg/host-kit/common/digest';
import { idOf, isPlain } from '@cg/host-kit/main/check';

import type { FrameMessage } from './frame-parse';

/** The main conversation's composer (§7.3): a gesture anywhere else is not the send we watch. */
export const MAIN_COMPOSER = 'app-messages-conversation-route > app-group-message-container > app-group-message-input';
export const MAIN_FIELD = 'textarea.message-input';
export const SEND_BUTTON = '.send-button';
/** The gesture's event is let go this long after it: a reference only, the predicate never waits for it. */
export const GESTURE_RELEASE_MS = 1000;
/** Receipts waiting for their echo, and echoes waiting for their receipt: at most this many of each… */
export const SEND_WAIT_MAX = 16;
/** …each at most this long. */
export const SEND_WAIT_MS = 60_000;

/** A chat's address (FS-RTE-1): the group it names. */
const CHAT_PATH = /^\/messages\/([1-9]\d{0,29})$/;
/** `Event.NONE`: the event is not being delivered. */
const NONE = 0;

/** What the gesture's watch takes from the page and the runtime, captured at install. */
export interface GestureNatives {
  /** The target is an element of the page (`Element`, captured at install). */
  readonly element: (target: EventTarget | null) => target is Element;
  readonly closest: (element: Element, selector: string) => Element | null;
  readonly matches: (element: Element, selector: string) => boolean;
  /** The page's address path now. */
  readonly path: () => string;
  /** The creator of `/account/me`; null — not known yet. */
  readonly creator: () => string | null;
  /** The boot's timer, which guards its callback itself. */
  readonly setTimer: (callback: () => void, ms: number) => unknown;
  readonly now: () => number;
  /** MAIN still stands (no old extension, not disposed): asked right before a send is said. */
  readonly standing: () => boolean;
  /** `fx.sent`. */
  readonly sent: (payload: { readonly groupId: string; readonly msgId: string; readonly contentDigest: string; readonly gestureAt: number }) => void;
}

/** One gesture of the person and what its delivery started. */
export interface Gesture {
  /** The event while it may still be delivered; null once let go. */
  event: Event | null;
  /** The event's `timeStamp`: the gesture's name in both worlds (`fx.sent.gestureAt`). */
  readonly at: number;
  /** The address at the gesture, and the chat it names (null — no chat's address). */
  readonly path: string;
  readonly groupId: string | null;
  /** Requests whose `loadstart` came during the delivery, and how many of them ended. */
  marked: number;
  ended: number;
  /** Marked answers at exactly `/api/v1/message`. */
  candidates: number;
  receipt: { readonly msgId: string; readonly groupId: string; readonly contentDigest: string; readonly gestureAt: number } | null;
  media: boolean;
  settled: boolean;
}

export interface SendCounts {
  gestures: number;
  receipts: number;
  ambiguous: number;
  media: number;
  sent: number;
  echoFirst: number;
  receiptFirst: number;
}

export interface SendGesture {
  /** The capture listeners on the page's window. */
  onKey(event: Event): void;
  onClick(event: Event): void;
  /** A request's `loadstart`: the gesture whose delivery is still running marks it; null — none does. */
  mark(): Gesture | null;
  /**
   * The answer of a marked request at exactly `/api/v1/message`, read (the envelope's `response`). Read here, not as a
   * frame's message: what a receipt needs is its id, chat, sender, text and attachments — whatever else the answer
   * carries, or lacks, is not the receipt's business.
   */
  receipt(gesture: Gesture, response: unknown): void;
  /** A marked request ended (`loadend`); `candidate` — it was at exactly `/api/v1/message`. */
  ended(gesture: Gesture, candidate: boolean): void;
  /** A `5/1` of the socket. */
  echo(message: FrameMessage): void;
  counts(): SendCounts;
  dispose(): void;
}

const live = (event: Event | null): boolean => event !== null && event.eventPhase !== NONE && event.currentTarget !== null;

export function createSendGesture(natives: GestureNatives): SendGesture {
  const { element, closest, matches } = natives;
  const counts: SendCounts = { gestures: 0, receipts: 0, ambiguous: 0, media: 0, sent: 0, echoFirst: 0, receiptFirst: 0 };
  let last: Gesture | null = null;
  let disposed = false;
  /** Gestures with a marked request not settled yet: while there is one, an echo may come before its receipt. */
  const open = new Set<Gesture>();
  /** Echoes (id → group) that came while a marked request was in flight. */
  const echoes = new Map<string, { readonly groupId: string; readonly at: number }>();
  /** Receipts (id → receipt) waiting for their echo. */
  const waiting = new Map<string, { readonly groupId: string; readonly contentDigest: string; readonly gestureAt: number; readonly at: number }>();

  /** Keeps a waiting map within its bounds: the stale first, then the oldest. */
  const bound = <V extends { readonly at: number }>(map: Map<string, V>): void => {
    const now = natives.now();
    for (const [id, item] of map) if (now - item.at > SEND_WAIT_MS) map.delete(id);
    while (map.size > SEND_WAIT_MAX) map.delete(map.keys().next().value as string);
  };

  const say = (msgId: string, receipt: { readonly groupId: string; readonly contentDigest: string; readonly gestureAt: number }, echoFirst: boolean): void => {
    // The old extension may have come since the receipt: then this MAIN stands down, and says nothing more.
    if (!natives.standing()) return;
    counts.sent += 1;
    if (echoFirst) counts.echoFirst += 1;
    else counts.receiptFirst += 1;
    natives.sent({ groupId: receipt.groupId, msgId, contentDigest: receipt.contentDigest, gestureAt: receipt.gestureAt });
  };

  const remember = (event: Event): void => {
    counts.gestures += 1;
    const path = natives.path();
    const gesture: Gesture = { event, at: event.timeStamp, path, groupId: CHAT_PATH.exec(path)?.[1] ?? null, marked: 0, ended: 0, candidates: 0, receipt: null, media: false, settled: false };
    last = gesture;
    natives.setTimer(() => {
      gesture.event = null;
      if (last === gesture) last = null;
    }, GESTURE_RELEASE_MS);
  };

  const settle = (gesture: Gesture): void => {
    if (gesture.settled || gesture.ended < gesture.marked) return;
    gesture.settled = true;
    open.delete(gesture);
    const receipt = gesture.receipt;
    if (gesture.candidates > 1) counts.ambiguous += 1;
    else if (gesture.candidates === 1 && gesture.media) counts.media += 1;
    else if (gesture.candidates === 1 && receipt !== null) {
      // An echo that waited past its time pairs with nothing (review of P7f).
      bound(echoes);
      const echo = echoes.get(receipt.msgId);
      if (echo?.groupId === receipt.groupId) {
        echoes.delete(receipt.msgId);
        say(receipt.msgId, receipt, true);
      } else {
        waiting.set(receipt.msgId, { groupId: receipt.groupId, contentDigest: receipt.contentDigest, gestureAt: receipt.gestureAt, at: natives.now() });
        bound(waiting);
      }
    }
    // Nothing is in flight: no echo can be waiting for a receipt any more.
    if (open.size === 0) echoes.clear();
  };

  return {
    onKey(event) {
      if (disposed || event.isTrusted !== true) return;
      const key = event as KeyboardEvent;
      if (key.key !== 'Enter' || key.shiftKey || key.isComposing) return;
      const target = event.target;
      if (element(target) && matches(target, MAIN_FIELD) && closest(target, MAIN_COMPOSER) !== null) remember(event);
    },
    onClick(event) {
      if (disposed || event.isTrusted !== true) return;
      const target = event.target;
      if (!element(target)) return;
      const button = closest(target, SEND_BUTTON);
      if (button !== null && closest(button, MAIN_COMPOSER) !== null) remember(event);
    },
    mark() {
      const gesture = last;
      // Only while the gesture's own event is being delivered, and on the address it was made on.
      if (gesture === null || !live(gesture.event) || natives.path() !== gesture.path) return null;
      gesture.marked += 1;
      open.add(gesture);
      return gesture;
    },
    receipt(gesture, response) {
      if (gesture.settled || !isPlain(response)) return;
      const msgId = idOf(response['id']);
      const groupId = idOf(response['groupId']);
      const creator = natives.creator();
      if (msgId === null || groupId === null || creator === null || idOf(response['senderId']) !== creator || groupId !== gesture.groupId) return;
      counts.receipts += 1;
      const attachments = response['attachments'];
      // A send with anything attached is not a draft of ours alone: not attributed, by rule (§5.9 п. 6).
      if (Array.isArray(attachments) && attachments.length > 0) gesture.media = true;
      else {
        const content = response['content'];
        gesture.receipt = { msgId, groupId, contentDigest: digest(normalize(typeof content === 'string' ? content : '')), gestureAt: gesture.at };
      }
    },
    ended(gesture, candidate) {
      if (gesture.settled) return;
      if (candidate) gesture.candidates += 1;
      gesture.ended += 1;
      if (gesture.ended < gesture.marked) return;
      // A request that ended inside the delivery (a synchronous one): another may still be marked — a turn later.
      if (live(gesture.event)) natives.setTimer(() => settle(gesture), 0);
      else settle(gesture);
    },
    echo(message) {
      // A receipt that waited past its time is gone before any echo is matched to it (review of P7f).
      if (waiting.size > 0) bound(waiting);
      if (waiting.size === 0 && open.size === 0) return;
      const creator = natives.creator();
      if (creator === null || message.senderId !== creator) return;
      const receipt = waiting.get(message.id);
      if (receipt !== undefined) {
        waiting.delete(message.id);
        if (receipt.groupId === message.groupId) say(message.id, receipt, false);
        return;
      }
      if (open.size === 0) return;
      echoes.set(message.id, { groupId: message.groupId, at: natives.now() });
      bound(echoes);
    },
    counts: () => ({ ...counts }),
    dispose() {
      disposed = true;
      last = null;
      open.clear();
      echoes.clear();
      waiting.clear();
    },
  };
}
