// «Фан удалил» in Fansly's chat header (hub `clientDeletedMessages`; contracts deleted-fansly.ts): what the mark shows of
// the background's answer, and when it asks. The chat a person opens is asked once; a sync while it stays open asks
// nothing. A deletion the page heard in that chat (`heard`) asks again a moment later, and twice more if the hub had
// not stored it yet: the hub hears the same socket and writes the mark itself. The tab keeps the last answers of this
// document, so a chat opened again shows its mark at once. Nothing while loading, nothing on a failed read.
//
// Fresh: deleted within the last hour and after the card was last opened for this fan in this tab. The mark stands out
// while a message is fresh; opening the card (`seen`) makes everything it shows seen.
//
// The same answer says how long the open chat is (2026-11-08, `chat`): the header's second badge reads it here, so it
// costs no read of its own. Shown once the read answered, never before (no date that a count then pushes aside). And
// who wrote it (2026-11-11, the owner: «кто из чатеров сколько сообщений оставил»): the card's breakdown, none when
// there is nothing in it. What the badge shows of an answer is both sites' since that day (application/chat-length,
// the owner of ChatSpace: «там же все то же самое нужно»); Fansly's own is the chat's id for a start the hub cannot say.
import type { ChatLength, ChatLengthClient, ChatLengthView } from '@cg/contracts/chat-length';
import type { DeletedMessageView, DeletedMessagesClient, DeletedMessagesView } from '@cg/contracts/deleted-fansly';
import type { FanslyDeletedMessages } from '@cg/contracts/tab-messages-fansly';

import { fanslyIdTimestampMs } from '../../../domain/hosts/fansly/snowflake';
import { chatLengthView as lengthView, sameChatLength } from '../../chat-length';

export interface DeletedMessagesTarget {
  readonly pageId: number;
  readonly accountId: string;
  readonly fanId: string;
  /** The open chat, Fansly's group id. */
  readonly groupId: string;
}

export type DeletedMessagesAnswer =
  | { readonly ok: true; readonly deleted: FanslyDeletedMessages; readonly chat?: ChatLength | null | undefined }
  | { readonly ok: false };

/**
 * What the badge shows of an answer: the hub's count and first message when it has them; otherwise no count and the
 * moment Fansly made the chat, which its id carries (a snowflake, like an account's: on prod the first message follows
 * within a day in 99% of chats). null — neither reads.
 */
export function chatLengthView(chat: ChatLength | null | undefined, groupId: string, now: number): ChatLengthView | null {
  return lengthView(chat, fanslyIdTimestampMs(groupId, now));
}

export const DELETED_NONE: DeletedMessagesView = { total: 0, messages: [], fresh: 0 };
/** How recent a deletion is fresh. */
export const DELETED_FRESH_MS = 60 * 60_000;
/** After the page heard a deletion: when to ask again, from the deletion on. */
export const DELETED_AGAIN_MS = [1_500, 6_000, 20_000] as const;
/** Answers the tab keeps for chats opened again; the oldest goes first. */
const KEPT = 50;

/** What the header shows of an answer: newest deleted first, each fresh or not; no message — DELETED_NONE. */
export function deletedMessagesView(deleted: FanslyDeletedMessages, seenUpTo: number, now: number): DeletedMessagesView {
  const messages: DeletedMessageView[] = [];
  for (const message of deleted.messages) {
    const deletedAt = Date.parse(message.deletedAt);
    if (!Number.isFinite(deletedAt)) continue;
    const sentAt = message.sentAt === null ? Number.NaN : Date.parse(message.sentAt);
    messages.push({
      id: message.id,
      text: message.text,
      attachments: message.attachments,
      sentAt: Number.isFinite(sentAt) ? sentAt : null,
      deletedAt,
      fresh: deletedAt > seenUpTo && now - deletedAt < DELETED_FRESH_MS,
    });
  }
  messages.sort((a, b) => b.deletedAt - a.deletedAt);
  const total = Math.max(deleted.total, messages.length);
  return total === 0 ? DELETED_NONE : { total, messages, fresh: messages.filter((message) => message.fresh).length };
}

export function createDeletedMessages(deps: {
  /** Who is signed in where: a new one forgets every answer. */
  session(): string | null;
  target(): DeletedMessagesTarget | null;
  read(target: DeletedMessagesTarget): Promise<DeletedMessagesAnswer>;
  now(): number;
  setTimer(ms: number, run: () => void): unknown;
  clearTimer(handle: unknown): void;
}): DeletedMessagesClient & { readonly chat: ChatLengthClient; sync(): void; heard(): void; dispose(): void } {
  let session: string | null = null;
  /** The chat open now, by page, account and fan; null — none (a chat closed and opened again is a new visit). */
  let visit: string | null = null;
  let target: DeletedMessagesTarget | null = null;
  let view: DeletedMessagesView = DELETED_NONE;
  let chatView: ChatLengthView | null = null;
  let disposed = false;
  /** Each read's turn: an answer of an older turn than the visit's last shown one is dropped. */
  let turn = 0;
  let shownTurn = 0;
  const kept = new Map<string, { readonly deleted: FanslyDeletedMessages; readonly chat: ChatLength | null | undefined }>();
  /** The newest deletion each fan's card showed when it was last opened in this tab. */
  const seenUpTo = new Map<string, number>();
  const timers = new Set<unknown>();
  const listeners = new Set<(view: DeletedMessagesView) => void>();
  const chatListeners = new Set<(view: ChatLengthView | null) => void>();

  const show = (next: DeletedMessagesView): void => {
    if (next === view) return;
    view = next;
    for (const listener of [...listeners]) listener(view);
  };
  const showChat = (next: ChatLengthView | null): void => {
    if (sameChatLength(next, chatView)) return;
    chatView = next;
    for (const listener of [...chatListeners]) listener(chatView);
  };
  const keep = (key: string, value: { readonly deleted: FanslyDeletedMessages; readonly chat: ChatLength | null | undefined }): void => {
    kept.delete(key);
    kept.set(key, value);
    while (kept.size > KEPT) kept.delete(kept.keys().next().value as string);
  };
  const stopTimers = (): void => {
    for (const handle of timers) deps.clearTimer(handle);
    timers.clear();
  };
  const render = (key: string): void => {
    const answer = kept.get(key);
    const now = deps.now();
    show(answer === undefined ? DELETED_NONE : deletedMessagesView(answer.deleted, seenUpTo.get(key) ?? Number.NEGATIVE_INFINITY, now));
    showChat(answer === undefined || target === null ? null : chatLengthView(answer.chat, target.groupId, now));
  };
  /** Asks for the open chat; `then` — told whether the answer brought a deletion the visit had not shown. */
  const read = (then?: (newer: boolean) => void): void => {
    const asked = target;
    const key = visit;
    if (asked === null || key === null) return;
    turn += 1;
    const mine = turn;
    const under = session;
    const before = kept.get(key)?.deleted.messages[0]?.deletedAt ?? '';
    void deps.read(asked).then(
      (answer) => {
        // A failed read changes nothing: no mark appears, none goes.
        if (disposed || !answer.ok || session !== under || mine < shownTurn) return;
        keep(key, { deleted: answer.deleted, chat: answer.chat });
        if (visit === key) {
          shownTurn = mine;
          render(key);
        }
        const newest = answer.deleted.messages[0]?.deletedAt ?? '';
        then?.(newest !== '' && Date.parse(newest) > (before === '' ? Number.NEGATIVE_INFINITY : Date.parse(before)));
      },
      () => undefined,
    );
  };

  const chat: ChatLengthClient = {
    view: () => chatView,
    subscribe(listener) {
      chatListeners.add(listener);
      return () => {
        chatListeners.delete(listener);
      };
    },
  };

  return {
    chat,
    view: () => view,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    seen() {
      if (visit === null || view.fresh === 0) return;
      const newest = view.messages[0]?.deletedAt;
      if (newest === undefined) return;
      seenUpTo.set(visit, Math.max(seenUpTo.get(visit) ?? Number.NEGATIVE_INFINITY, newest));
      render(visit);
    },
    sync() {
      if (disposed) return;
      const now = deps.session();
      if (now !== session) {
        session = now;
        visit = null;
        kept.clear();
        seenUpTo.clear();
      }
      const next = now === null ? null : deps.target();
      const key = next === null ? null : `${String(next.pageId)}|${next.accountId}|${next.fanId}`;
      if (key === visit) return;
      stopTimers();
      visit = key;
      target = next;
      shownTurn = turn;
      if (key === null) {
        show(DELETED_NONE);
        showChat(null);
        return;
      }
      render(key);
      read();
    },
    heard() {
      if (disposed || visit === null) return;
      // A second deletion while the first is awaited starts the waits over: the newest is the one to find.
      stopTimers();
      const key = visit;
      const steps = [...DELETED_AGAIN_MS];
      let at = 0;
      const next = (): void => {
        const wait = steps.shift();
        if (wait === undefined) return;
        const handle = deps.setTimer(wait - at, () => {
          timers.delete(handle);
          if (disposed || visit !== key) return;
          at = wait;
          read((newer) => {
            if (!newer && visit === key) next();
          });
        });
        timers.add(handle);
      };
      next();
    },
    dispose() {
      disposed = true;
      stopTimers();
      kept.clear();
      seenUpTo.clear();
      listeners.clear();
      chatListeners.clear();
    },
  };
}
