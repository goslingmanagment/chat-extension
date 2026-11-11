// The chat's length of the hub's `clientDeletedMessages` (`chat`) as a tab may take it (contracts chat-length.ts): a
// count that reads, a time that reads, who wrote it, whether it is what the hub has seen. Both sites' background chunks
// bound the same answer with it: Fansly's «Удалил» read with the group (2026-11-08), ChatSpace's own read with the fan
// as the conversation (2026-11-11, the owner: «и с хуя ли на чатспейсе его нет? там же все то же самое нужно»). Moved
// here from Fansly's chunk that day.
import { CHAT_LENGTH_LIMITS, type ChatAuthors, type ChatLength } from '@cg/contracts/chat-length';
import type { DeletedMessages } from '@cg/contracts/hub';

/** At most `max` UTF-16 units, never half of a pair. */
function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const end = /[\uD800-\uDBFF]/.test(text.charAt(max - 1)) ? max - 1 : max;
  return text.slice(0, end);
}

const isoOf = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};

/** A count the hub may send: a whole number, zero or more; null — none, or one that does not read. */
const exact = (value: number | null): number | null => (value !== null && Number.isSafeInteger(value) && value >= 0 ? value : null);

type HubChatAuthors = NonNullable<NonNullable<DeletedMessages['chat']>['authors']>;

/**
 * Who wrote the chat as a tab may take it: each chatter with a login and at least one message (others dropped), the
 * cap kept, logins cut; the fan's and the unattributed counts both or neither, and only beside the chat's own count.
 * null — the hub did not say, or its split does not read: no breakdown rather than a wrong one.
 */
function boundChatAuthors(authors: HubChatAuthors | undefined, messages: number | null): ChatAuthors | null {
  if (authors === undefined) return null;
  const chatters: ChatAuthors['chatters'][number][] = [];
  for (const chatter of authors.chatters) {
    const name = cut(chatter.name.trim(), CHAT_LENGTH_LIMITS.authorNameMaxChars);
    const count = exact(chatter.messages);
    if (name === '' || count === null || count < 1) continue;
    chatters.push({ name, isMe: chatter.isMe, messages: count });
    if (chatters.length === CHAT_LENGTH_LIMITS.authorsMax) break;
  }
  if (authors.fan === null && authors.unattributed === null) return { chatters, fan: null, unattributed: null };
  // The split needs the whole chat: both counts, beside the chat's own, or the answer does not read.
  const fan = exact(authors.fan);
  const unattributed = exact(authors.unattributed);
  if (messages === null || fan === null || unattributed === null) return null;
  return { chatters, fan, unattributed };
}

/** The chat's length as a tab may take it; null — the hub holds no such chat; undefined — the hub did not say (before 2026-11-08). */
export function boundChatLength(chat: DeletedMessages['chat']): ChatLength | null | undefined {
  if (chat === undefined || chat === null) return chat;
  const messages = exact(chat.messages);
  return {
    messages,
    firstMessageAt: isoOf(chat.firstMessageAt),
    authors: boundChatAuthors(chat.authors, messages),
    approximate: chat.approximate === true,
  };
}
