// The fan's deleted messages of a page (hub `clientDeletedMessages`, capability `deleted-messages-v1`; 2026-11-03,
// the owner: «показывать удаленные сообщения фана», a mark in the Fansly chat header). A Fansly deletion is a fact about
// the message, not an erasure (the owner, 2026-09-28): the hub keeps the text the page's socket carried, and this read
// is the one that serves it. The conversation feed and the AI still read a deleted message as an empty row.
//
// The request mirrors the hub's strict path; the answer is open like every hub answer.

import * as z from 'zod/mini';

import { NativeIdSchema } from '../primitives';
import { PageLabelSchema } from './wire';

/** The most deleted messages of one fan the hub answers (hub CLIENT_DELETED_MESSAGES_MAX), the latest deleted first. */
export const DELETED_MESSAGES_MAX = 50;

/** Path `pageLabel` and `fanRef` (the fan's Fansly account id). */
export const DeletedMessagesQuerySchema = z.strictObject({ pageLabel: PageLabelSchema, fanRef: NativeIdSchema });
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
  serverNow: z.string(),
});
export type DeletedMessages = z.infer<typeof DeletedMessagesSchema>;
