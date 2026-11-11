// The fan's deleted messages of a page (hub `clientDeletedMessages`, capability `deleted-messages-v1`; 2026-11-03,
// the owner: «показывать удаленные сообщения фана», a mark in the Fansly chat header). A Fansly deletion is a fact about
// the message, not an erasure (the owner, 2026-09-28): the hub keeps the text the page's socket carried, and this read
// is the one that serves it. The conversation feed and the AI still read a deleted message as an empty row.
//
// The request mirrors the hub's strict path; the answer is open like every hub answer.
//
// 2026-11-11 (the owner: «чтобы писалось, кто из чатеров сколько сообщений оставил»): the chat's length also says who
// wrote its messages (`chat.authors`), for the same card in the header.
//
// 2026-11-11, the owner of ChatSpace: «и с хуя ли на чатспейсе его нет? там же все то же самое нужно»: the same read
// for an OnlyFans page, with the fan as the conversation (the chat is the fan there). The hub then says its numbers are
// what its archive holds (`chat.approximate`).

import * as z from 'zod/mini';

import { NativeIdSchema } from '../primitives';
import { PageLabelSchema } from './wire';

/** The most deleted messages of one fan the hub answers (hub CLIENT_DELETED_MESSAGES_MAX), the latest deleted first. */
export const DELETED_MESSAGES_MAX = 50;
/** The most chatters `chat.authors` names (hub CLIENT_CHAT_LENGTH_CHATTERS_MAX), the most messages first. */
export const CHAT_AUTHORS_MAX = 50;

/**
 * Path `pageLabel` and `fanRef` (the fan's account id on the platform); `conversationRef` — the open chat: Fansly's group
 * id, on an OnlyFans page the fan's own id; the answer then also says how long that chat is (`chat`; 2026-11-08). A hub
 * before it ignores the query string.
 */
export const DeletedMessagesQuerySchema = z.strictObject({ pageLabel: PageLabelSchema, fanRef: NativeIdSchema, conversationRef: z.optional(NativeIdSchema) });
export type DeletedMessagesQuery = z.infer<typeof DeletedMessagesQuerySchema>;

/** The fan's messages the page's socket saw deleted, the latest deleted first, and how many there are in all. */
export const DeletedMessagesSchema = z.object({
  pageLabel: z.string(),
  fanRef: z.string(),
  total: z.number(),
  messages: z.array(
    z.object({
      platformMessageId: z.string(),
      /** Fansly's group id; null when the socket's frame named none. */
      conversationRef: z.nullable(z.string()),
      /** "" — a message without text; null — the hub kept none. */
      text: z.nullable(z.string()),
      attachments: z.number(),
      sentAt: z.nullable(z.string()),
      deletedAt: z.string(),
    }),
  ),
  /**
   * Only for a request with `conversationRef`: how many messages the chat ever had (both sides, deleted ones included)
   * and when its first was sent, both null until the hub holds the chat from its first message; null — the page has no
   * thread of that group with this fan. Absent — a hub before 2026-11-08.
   */
  chat: z.optional(
    z.nullable(
      z.object({
        conversationRef: z.string(),
        messages: z.nullable(z.number()),
        firstMessageAt: z.nullable(z.string()),
        /**
         * Who wrote them (2026-11-11). `chatters`: the page's messages by the person who sent them, recorded since
         * 2026-10-24 for sends made through the extension, exact even while `messages` is null; the most first.
         * `fan` and `unattributed` (the page's messages with no known author: mass messages, sends from elsewhere,
         * anything before authors were recorded) are null while `messages` is; then all of them add up to `messages`.
         * Absent — a hub before 2026-11-11.
         */
        authors: z.optional(
          z.object({
            chatters: z.array(z.object({ userId: z.number(), name: z.string(), isMe: z.boolean(), messages: z.number() })),
            fan: z.nullable(z.number()),
            unattributed: z.nullable(z.number()),
          }),
        ),
        /**
         * 2026-11-11: true on an OnlyFans page: the hub has no proof of the chat's first message there, so `messages`,
         * `firstMessageAt` and the split are what its archive holds (in practice everything since it began to capture
         * the page; the oldest messages may be missing). Absent or false: exact, as above.
         */
        approximate: z.optional(z.boolean()),
      }),
    ),
  ),
  serverNow: z.string(),
});
export type DeletedMessages = z.infer<typeof DeletedMessagesSchema>;
