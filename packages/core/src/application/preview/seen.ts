// Whether the fan read our newest message, for a fan's preview (Spenders, «Новые», the palette): read live from the
// site when the card rests on the fan, never by opening the chat — on ChatSpace the account's chat list searched by
// the fan's username, then, only when its last message is ours and nothing in the chat is unread, the history's
// newest messages (OnlyFans' `isNew`; every fan message is read already, so nothing new is marked read); on Fansly
// the group's last message (the fan's `readAt`), which marks nothing read. A fan message that came between
// ChatSpace's two reads is marked read by the second: the answer says so (`raced`), and every card of the fan says it
// to the person until they open the fan's chat — no later read takes it back (it finds the fan's message the last and
// reads no history), nor a failed one, nor the card left before the answer came (audit 2026-10-23).
//
// - A walk through the list (J / K, ← →) asks nothing of the fans it passes: the read goes once the card has rested
//   on a fan for `settleMs`. An answer is shown again for `freshMs` without a new read; «Обновить» reads again at once.
// - While the open card says «не прочитано», it reads again every `pollMs`, for at most `pollForMs` on the fan (the
//   old OnlyFans client's read-state sweep): the mark turns when the fan opens the chat. Our own send drops the answer
//   and reads again.
// - The answer is about the conversation's newest message. It speaks only when that message is ours and the site said
//   whether it was read; it stays silent when the archive shows a newer message than the one the site named (the
//   answer is older than the feed).
// - A read that failed shows nothing — an answer kept from before is dropped — and is not repeated by itself: the next
//   rest on the fan asks again.

import { type ChatReadRead, type ChatReadState, type HostPort } from '@cg/contracts/host';
import { type ChatRef } from '@cg/contracts/ids';
import { CHAT_READ_LIMITS } from '@cg/contracts/limits';
import { type FeedItemVM, type PreviewVM } from '@cg/contracts/vm';

import { type BoardsClock } from '../boards/ports';

/** The fan a read is about: the chat, the username the chat list is searched by, the conversation (Fansly's group). */
export interface ChatReadTarget {
  readonly pageId: number;
  readonly chat: ChatRef;
  readonly username: string | null;
  readonly conversationRef: string | null;
}

/** The site's read of whether the fan read the newest message; it never rejects. */
export interface ChatReadPort {
  read(target: ChatReadTarget): Promise<ChatReadRead>;
}

const UNAVAILABLE: ChatReadRead = { ok: false, reason: 'unavailable' };

/** The read over the host's own chat list (ChatSpace's `chatReadState`), by the fan's username; null — a host without one. */
export function hostChatReadPort(host: Pick<HostPort, 'chatReadState'>): ChatReadPort | null {
  if (host.chatReadState === undefined) return null;
  return {
    read: ({ chat, username }) =>
      username === null || username.length === 0 || username.length > CHAT_READ_LIMITS.usernameMax ? Promise.resolve(UNAVAILABLE) : (host.chatReadState?.(chat, username) ?? Promise.resolve(UNAVAILABLE)),
  };
}

/** Answers kept at most: the fans of one long walk (also the races told and the chats opened). */
const KEPT_MAX = 500;

/** Lets the oldest entries go past `KEPT_MAX` (a Map and a Set keep the order things were put in). */
function trim(entries: Map<string, unknown> | Set<string>): void {
  for (const old of entries.keys()) {
    if (entries.size <= KEPT_MAX) break;
    entries.delete(old);
  }
}

type Target = () => ChatReadTarget | null;

/** The answer says our newest message is not read yet: the open card keeps asking for a while. */
const unread = (last: ChatReadState | null): boolean => last !== null && last.direction === 'model' && last.read === false;

export class SeenDesk {
  private readonly kept = new Map<string, { readonly at: number; readonly last: ChatReadState | null }>();
  /** Fans a read's race marked a message of read: told on their cards until the person opens the fan's chat. */
  private readonly marked = new Set<string>();
  /** The fan's run when the person last opened the fan's chat: a race of a read that went before it is no news. */
  private readonly opened = new Map<string, number>();
  private readonly timers = new Map<string, number>();
  private readonly runs = new Map<string, number>();
  /** Until when the open card of the fan reads again while it says «не прочитано». */
  private readonly polls = new Map<string, number>();
  /** Grows on a reset: a read that went before it is not heard. */
  private generation = 0;
  private disposed = false;

  constructor(
    private readonly deps: {
      readonly port: ChatReadPort | null;
      readonly clock: BoardsClock;
      /** An answer for the fan came: its cards draw again. */
      readonly changed: (key: string) => void;
    },
  ) {}

  /**
   * The card rests on the fan: read once it has rested `settleMs`, unless a fresh answer is kept. `force` — the person
   * asked («Обновить»): read now. `target` is asked when the read goes; null — nothing to read by (the card is gone, no
   * binding yet).
   */
  want(key: string, target: Target, force = false): void {
    const { port, clock } = this.deps;
    if (port === null || this.disposed) return;
    const kept = this.kept.get(key);
    if (!force && kept !== undefined && clock.now() - kept.at < CHAT_READ_LIMITS.freshMs) {
      if (unread(kept.last) && !this.timers.has(key)) this.poll(key, target);
      return;
    }
    this.later(key, force ? 0 : CHAT_READ_LIMITS.settleMs, target);
  }

  /** Our message went out: the kept answer is about an older one, and a read in flight may miss the new one. */
  drop(key: string): void {
    this.kept.delete(key);
    // A new message of ours: the card's window of asking again starts over.
    this.polls.delete(key);
    this.runs.set(key, (this.runs.get(key) ?? 0) + 1);
  }

  /** The card left the fan: nothing more is asked for it. */
  leave(key: string): void {
    this.polls.delete(key);
    const timer = this.timers.get(key);
    if (timer === undefined) return;
    this.deps.clock.clearTimer(timer);
    this.timers.delete(key);
  }

  /** The person opened the fan's chat: they see what the fan wrote; a race of a read that went before is told no more. */
  open(key: string): void {
    this.opened.delete(key);
    this.opened.set(key, this.runs.get(key) ?? 0);
    trim(this.opened);
    if (this.marked.delete(key)) this.deps.changed(key);
  }

  /** What the card says of the fan's newest message, over the feed it shows (oldest first). */
  vm(key: string, items: readonly FeedItemVM[]): PreviewVM['seen'] {
    const last = this.kept.get(key)?.last ?? null;
    if (last === null || last.direction !== 'model' || last.read === null) return null;
    const at = last.sentAt === null ? null : Date.parse(last.sentAt);
    const index = items.findIndex((item) => item.id === last.messageId);
    // The archive shows a message newer than the one the site named: the answer is older than the feed.
    const after = index >= 0 ? items.slice(index + 1) : items;
    if (after.some((item) => item.sender !== 'system' && (index >= 0 || (item.at !== null && at !== null && Date.parse(item.at) > at)))) return null;
    return { messageId: last.messageId, read: last.read, readAt: last.readAt, inFeed: index >= 0 };
  }

  /** The fan wrote while a read loaded the chat's history, and the chat was not opened since: that read marked it read. */
  raced(key: string): boolean {
    return this.marked.has(key);
  }

  /** Another sign-in, hub or account: nothing of the old one is kept or asked. */
  reset(): void {
    for (const key of [...this.timers.keys()]) this.leave(key);
    this.polls.clear();
    this.kept.clear();
    this.marked.clear();
    this.opened.clear();
    this.runs.clear();
    this.generation += 1;
  }

  dispose(): void {
    this.reset();
    this.disposed = true;
  }

  /** Read in `ms`; `until` — not at all once the clock is past it (a poll's window, also after the machine slept). */
  private later(key: string, ms: number, target: Target, until?: number): void {
    const timer = this.timers.get(key);
    if (timer !== undefined) this.deps.clock.clearTimer(timer);
    this.timers.set(
      key,
      this.deps.clock.setTimer(ms, () => {
        this.timers.delete(key);
        if (until === undefined || this.deps.clock.now() < until) this.read(key, target);
      }),
    );
  }

  private read(key: string, target: Target): void {
    const { port, clock } = this.deps;
    const asked = target();
    if (port === null || asked === null || this.disposed) return;
    const run = (this.runs.get(key) ?? 0) + 1;
    const generation = this.generation;
    this.runs.set(key, run);
    void port.read(asked).then((answer) => {
      if (this.disposed || this.generation !== generation) return;
      // The race marked the fan's message read whether the answer is still heard or not (a newer read, our send): it is
      // told from now on — unless the person opened the fan's chat since the read went, and sees the message.
      const raced = answer.ok && answer.raced === true && (this.opened.get(key) ?? -1) < run;
      if (raced) {
        this.marked.delete(key);
        this.marked.add(key);
        trim(this.marked);
      }
      if (this.runs.get(key) !== run) {
        if (raced) this.deps.changed(key);
        return;
      }
      if (!answer.ok) {
        if (this.kept.delete(key)) this.deps.changed(key);
        return;
      }
      this.kept.delete(key);
      this.kept.set(key, { at: clock.now(), last: answer.last });
      trim(this.kept);
      this.deps.changed(key);
      if (unread(answer.last) && !this.timers.has(key)) this.poll(key, target);
    });
  }

  /** The open card says «не прочитано»: read again in `pollMs`, while the card's window for the fan lasts. */
  private poll(key: string, target: Target): void {
    const now = this.deps.clock.now();
    const until = this.polls.get(key) ?? now + CHAT_READ_LIMITS.pollForMs;
    this.polls.set(key, until);
    if (now < until) this.later(key, CHAT_READ_LIMITS.pollMs, target, until);
  }
}
