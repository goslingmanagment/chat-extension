// Chat Memory week 3 (hub `docs/plans/2026-10-24-chat-memory/week-3.md` §5): «Очередь» of a page — who waits for a
// reply (every fan who wrote in 30 days: `clientSpenderAwaitingReply` with `everyone`), whom to win back
// (`clientWinBack`, `win-back-v1`: a few fans and the owner's approaches; a chatter's pick is
// `clientWinBackAttempt`), and the shift handoff (`clientHandoff`, `handoff-v1`). The hub sends nothing to a fan: the
// chatter writes himself.
//
// The requests mirror the hub's strict ones; the answers are open like every hub answer.

import * as z from 'zod/mini';

import { HubIntIdSchema, NativeIdSchema } from '../primitives';
import { PageLabelSchema } from './wire';

/** Why a fan is on the win-back list (hub CLIENT_WIN_BACK_REASONS); open on the wire. */
export const WIN_BACK_REASONS = ['expiring', 'new_unattended', 'silent'] as const;

const Time = z.string();

export const WinBackQuerySchema = z.strictObject({ pageLabel: PageLabelSchema });
export type WinBackQuery = z.infer<typeof WinBackQuerySchema>;

export const WinBackListSchema = z.object({
  pageLabel: z.string(),
  approaches: z.array(z.object({ id: z.number(), label: z.string() })),
  items: z.array(
    z.object({
      fanRef: z.string(),
      conversationRef: z.nullable(z.string()),
      username: z.nullable(z.string()),
      displayName: z.nullable(z.string()),
      alias: z.nullable(z.string()),
      lifetimeGrossMills: z.number(),
      reason: z.string(),
      reasonAt: z.nullable(Time),
    }),
  ),
  serverNow: Time,
});
export type WinBackList = z.infer<typeof WinBackListSchema>;

/** Path `pageLabel`; the body is `fanRef` and `approachId`. */
export const WinBackAttemptRequestSchema = z.strictObject({ pageLabel: PageLabelSchema, fanRef: NativeIdSchema, approachId: HubIntIdSchema });
export type WinBackAttemptRequest = z.infer<typeof WinBackAttemptRequestSchema>;
export const WinBackAttemptResultSchema = z.object({ attemptId: z.number(), list: WinBackListSchema });
export type WinBackAttemptResult = z.infer<typeof WinBackAttemptResultSchema>;

export const HandoffQuerySchema = z.strictObject({ pageLabel: PageLabelSchema });
export type HandoffQuery = z.infer<typeof HandoffQuerySchema>;

export const HandoffSchema = z.object({
  pageLabel: z.string(),
  recent: z.array(
    z.object({
      fanRef: z.string(),
      conversationRef: z.nullable(z.string()),
      username: z.nullable(z.string()),
      alias: z.nullable(z.string()),
      lastSentAt: Time,
      messages: z.number(),
      chatters: z.array(z.string()),
      inConversation: z.array(z.string()),
    }),
  ),
  waiting: z.object({
    total: z.number(),
    head: z.array(
      z.object({
        fanRef: z.string(),
        conversationRef: z.nullable(z.string()),
        username: z.nullable(z.string()),
        alias: z.nullable(z.string()),
        lifetimeGrossMills: z.number(),
        lastFanMessageAt: Time,
      }),
    ),
  }),
  promises: z.array(z.object({ fanRef: z.string(), conversationRef: z.string(), text: z.string(), messageRef: z.string(), messageAt: z.nullable(Time) })),
  /** Chat Memory week 4: the page's open customs (ordered or paid), the oldest payment first. Absent from an older hub. */
  customs: z.optional(z.array(z.object({ fanRef: z.string(), conversationRef: z.nullable(z.string()), description: z.string(), state: z.string(), paidAt: z.nullable(Time), createdAt: Time }))),
  serverNow: Time,
});
export type Handoff = z.infer<typeof HandoffSchema>;
