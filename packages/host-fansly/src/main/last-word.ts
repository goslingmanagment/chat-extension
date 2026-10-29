// Who has the last word in each chat (2026-10-29): the mark of a chat waiting for a reply in Fansly's own list of
// chats, where the page shows the last message's text and never whose it is.
//
// Of every message MAIN reads — the inbox's `lastMessage` and `lastUnreadMessageId`, a group's `lastMessage`, the
// pages of a history, the unread list, the socket's new messages and the page's own sends — a chat keeps two ids: the
// fan's newest message and the model's newest personal one. A mass send, a welcome text, anything made by something
// answers no fan (automation.ts): it changes nothing, so a fan who wrote before it still waits. The word is `fan` while
// the fan's message is the newer, `model` once a personal one of the model's is; a chat of which MAIN knows only
// automated messages has none. A deleted message is forgotten and the word falls to what is left: no older ids are
// kept for it.
//
// At most LAST_WORDS_MAX chats, the least recently changed forgotten first (their word goes out as null). What changed
// since the last `drain()` goes out as `fx.lastWord`; `replay()` says every word again (after `fx.state`).

import { compareIds } from './certificate';
import { LAST_WORDS_MAX } from './protocol';

export type Word = 'fan' | 'model';

export interface WordChange {
  readonly groupId: string;
  readonly word: Word | null;
}

export interface LastWords {
  /** A message of a chat: the fan's, or the model's — an automated one of the model's says nothing. */
  message(groupId: string, id: string, fan: boolean, automated: boolean): void;
  /** A message deleted (5/10); `groupId` null — the chat is not named. */
  deleted(id: string, groupId: string | null): void;
  /** Every chat forgotten: another creator in the same document. */
  reset(): void;
  /** The words that changed since the last drain, the oldest change first. */
  drain(): WordChange[];
  /** Every word known goes out again at the next drain. */
  replay(): void;
  word(groupId: string): Word | null;
  size(): number;
}

interface Chat {
  fan: string | null;
  own: string | null;
}

const wordOf = (chat: Chat): Word | null => {
  if (chat.fan === null) return chat.own === null ? null : 'model';
  return chat.own === null || compareIds(chat.fan, chat.own) > 0 ? 'fan' : 'model';
};

export function createLastWords(max: number = LAST_WORDS_MAX): LastWords {
  /** In the order of their last change: the first is the one forgotten first. */
  const chats = new Map<string, Chat>();
  /** Chats whose word goes out at the next drain, with the word last said (undefined — never said). */
  const changed = new Map<string, Word | null | undefined>();
  const said = new Map<string, Word | null>();

  const touch = (groupId: string, chat: Chat, before: Word | null): void => {
    chats.delete(groupId);
    chats.set(groupId, chat);
    if (wordOf(chat) !== before && !changed.has(groupId)) changed.set(groupId, said.get(groupId));
    while (chats.size > max) {
      const oldest = chats.keys().next().value as string;
      chats.delete(oldest);
      if (!changed.has(oldest)) changed.set(oldest, said.get(oldest));
    }
  };

  return {
    message(groupId, id, fan, automated) {
      if (!fan && automated) return;
      const chat = chats.get(groupId) ?? { fan: null, own: null };
      const before = wordOf(chat);
      const known = fan ? chat.fan : chat.own;
      if (known !== null && compareIds(id, known) <= 0) return;
      if (fan) chat.fan = id;
      else chat.own = id;
      touch(groupId, chat, before);
    },
    deleted(id, groupId) {
      const forget = (key: string, chat: Chat): void => {
        if (chat.fan !== id && chat.own !== id) return;
        const before = wordOf(chat);
        if (chat.fan === id) chat.fan = null;
        if (chat.own === id) chat.own = null;
        touch(key, chat, before);
      };
      if (groupId !== null) {
        const chat = chats.get(groupId);
        if (chat !== undefined) forget(groupId, chat);
        return;
      }
      for (const [key, chat] of [...chats]) forget(key, chat);
    },
    reset() {
      for (const key of chats.keys()) if (!changed.has(key)) changed.set(key, said.get(key));
      chats.clear();
    },
    drain() {
      const out: WordChange[] = [];
      for (const [groupId, was] of changed) {
        const chat = chats.get(groupId);
        const word = chat === undefined ? null : wordOf(chat);
        // Nothing new, or nothing to take back from a side that never heard a word of this chat.
        if (word === was || (word === null && was === undefined)) {
          if (chat === undefined) said.delete(groupId);
          continue;
        }
        out.push({ groupId, word });
        if (chat === undefined) said.delete(groupId);
        else said.set(groupId, word);
      }
      changed.clear();
      return out;
    },
    replay() {
      said.clear();
      for (const key of chats.keys()) changed.set(key, undefined);
    },
    word: (groupId) => {
      const chat = chats.get(groupId);
      return chat === undefined ? null : wordOf(chat);
    },
    size: () => chats.size,
  };
}
