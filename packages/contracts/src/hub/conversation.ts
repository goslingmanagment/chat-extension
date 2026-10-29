// Chat Memory week 1 (hub `docs/plans/2026-10-24-chat-memory/plan.md` §2–§3): the extension's beat and «в разговоре».
//
// - The beat (`clientActivity`, `chatter-activity-v1`): once a minute while the person is signed in and a tab is
//   bound to a page, the pages the background has open and how long ago the person was last active on each (a key, a
//   click, a scroll — never what); once more with `closed` and no pages when the last such tab goes or the person
//   signs out. A report of what is, never owed: a lost beat is just lost. The hub computes the actual shift from it.
// - «В разговоре» (`clientInConversation`, `in-conversation-v1`): who wrote to which fan of the page in the last 15
//   minutes (a message with an author). A warning a chatter can pass, never a block.
//
// The request mirrors the hub's strict body exactly; the answers are open like every hub answer.

import * as z from 'zod/mini';

import { HubIntIdSchema, IsoTimestampSchema, NativeIdSchema, boundedText } from '../primitives';
import { PageLabelSchema } from './wire';

export const ACTIVITY_LIMITS = {
  /** How often the background beats (hub CLIENT_ACTIVITY_BEAT_SECONDS). */
  beatMs: 60_000,
  /** Pages one beat may name (hub CLIENT_ACTIVITY_MAX_PAGES). */
  maxPages: 20,
  /** Hub CLIENT_ACTIVITY_MAX_IDLE_MS; input at or beyond this age is reported as null, never clamped. */
  maxIdleMs: 24 * 60 * 60_000,
} as const;

/** The install's id as the hub takes it. */
export const ACTIVITY_INSTANCE_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export const ActivityBeatRequestSchema = z.strictObject({
  instanceId: z.string().check(z.regex(ACTIVITY_INSTANCE_PATTERN)),
  pages: z
    .array(
      z.strictObject({
        pageLabel: PageLabelSchema,
        /** Milliseconds since input in this sign-in on this page's tabs; null — none inside the idle window. */
        idleMs: z.nullable(z.int().check(z.gte(0), z.lte(ACTIVITY_LIMITS.maxIdleMs))),
      }),
    )
    .check(z.maxLength(ACTIVITY_LIMITS.maxPages)),
  /** The last tab closed or the person signed out: this beat closes the install. */
  closed: z.optional(z.literal(true)),
});
export type ActivityBeatRequest = z.infer<typeof ActivityBeatRequestSchema>;

export const ActivityBeatResultSchema = z.object({ recorded: z.number(), serverNow: z.string() });
export type ActivityBeatResult = z.infer<typeof ActivityBeatResultSchema>;

/** How long a message keeps its author «в разговоре» (hub IN_CONVERSATION_MINUTES). */
export const IN_CONVERSATION_MS = 15 * 60_000;
/** How often the background asks the hub for a page with an open tab. */
export const IN_CONVERSATION_POLL_MS = 30_000;

export const InConversationQuerySchema = z.strictObject({ pageLabel: PageLabelSchema });
export type InConversationQuery = z.infer<typeof InConversationQuerySchema>;

export const InConversationResultSchema = z.object({
  pageLabel: z.string(),
  fans: z.array(
    z.object({
      fanRef: NativeIdSchema,
      conversationRef: z.nullable(NativeIdSchema),
      chatters: z.array(
        z.object({
          userId: HubIntIdSchema,
          name: boundedText(128),
          isMe: z.boolean(),
          lastSentAt: IsoTimestampSchema,
          until: IsoTimestampSchema,
        }),
      ),
    }),
  ),
  serverNow: z.string(),
});
export type InConversationResult = z.infer<typeof InConversationResultSchema>;
