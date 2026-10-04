// «Архив отстаёт от чата на K сообщений» (NEW-02, AI-070, AI-097, Б6).
// Recap, Review and Coach are built from the hub's archive only; the open
// chat on the page may already hold newer messages. This compares the
// archive point a result was built from — the served head of the
// generation, the head of the archive feed, or the moment a stored recap
// was generated — with what the page holds, and counts the messages after
// it. Page memory is read only to count: nothing of it goes anywhere. An
// honest answer has three shapes: not behind (null), behind by K, behind by
// an unknown number (`messages: null`). Message ids are compared for
// equality only: their size is not an order.

import { type ChatWindow, type LiveTextTail } from '@cg/contracts/host';

/** Where the archive stood: a message, a moment, or both. */
export interface ArchivePoint {
  readonly messageRef: string | null;
  /** ISO time of that message, or of the result itself. */
  readonly at: string | null;
}

export interface ArchiveLag {
  /** How many page messages are newer than the archive point; null — some, the number is not known. */
  readonly messages: number | null;
}

export interface PageFacts {
  /** The visible tail of the open chat, oldest first; null — not readable. */
  readonly tail: LiveTextTail | null;
  readonly window: ChatWindow | null;
}

const time = (iso: string | null): number | null => {
  if (iso === null) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
};

/** The archive's lag behind the page, or null when it is not behind (or nothing can be said). */
export function archiveLag(point: ArchivePoint | null, page: PageFacts): ArchiveLag | null {
  if (point === null || (point.messageRef === null && point.at === null)) return null;
  const messages = page.tail?.messages ?? [];
  if (messages.length > 0) {
    const index = point.messageRef === null ? -1 : messages.findLastIndex((message) => message.platformMessageId === point.messageRef);
    if (index >= 0) {
      const newer = messages.length - 1 - index;
      return newer === 0 ? null : { messages: newer };
    }
    const at = time(point.at);
    if (at !== null) {
      const newer = messages.filter((message) => (time(message.sentAt) ?? -Infinity) > at).length;
      if (newer === 0) return null;
      // Every visible message is newer: there may be more of them above the tail.
      return { messages: newer === messages.length ? null : newer };
    }
    // The archive's head is a message the tail does not show and its time is unknown: behind or far ahead — not known.
    return null;
  }
  const at = time(point.at);
  const window = page.window;
  if (at === null || window === null || window.state !== 'ready') return null;
  const newest = Math.max(time(window.lastFanMessageAt) ?? -Infinity, time(window.lastModelMessageAt) ?? -Infinity);
  return newest > at ? { messages: null } : null;
}
