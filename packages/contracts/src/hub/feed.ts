// Archive feed of one conversation (architecture.md §8.5 «Лента»; hub H-9c,
// `archive-feed-v1`): preview text for Spenders and «Новые», «Обновить
// переписку», archive freshness. Database only on the hub (no OFAPI, no
// refresh), so reading it never marks a chat read. Rows go newest → oldest;
// the summary (Ping segment, fan silence) comes on the first page only and
// is computed by the hub with the generation's own rules: the client never
// derives it from the first 100 rows.

import * as z from 'zod/mini';

import { CountSchema, IsoTimestampSchema, MoneyMillsSchema, NativeIdSchema, OpenTokenSchema } from '../primitives';
import { HubCursorSchema, PageLabelSchema } from './wire';

export const FEED_LIMITS = {
  defaultLimit: 50,
  maxLimit: 100,
  /** Summary window: Ping's window by default; capped at the readers' 1500 (critic item 15). */
  summaryWindowDefault: 100,
  summaryWindowMin: 5,
  summaryWindowMax: 1500,
} as const;

export const FEED_SENDERS = ['fan', 'model', 'system', 'unknown'] as const;
export type FeedSender = (typeof FEED_SENDERS)[number];
export const PING_SEGMENTS = ['active', 'segment-a', 'segment-b', 'unknown'] as const;
export type PingSegment = (typeof PING_SEGMENTS)[number];

/** Path `pageLabel` + `fanRef`; query `cursor`, `limit`, `summaryWindow`. A fanRef is the OF fan id (= chat id). */
export const FeedQuerySchema = z.strictObject({
  pageLabel: PageLabelSchema,
  fanRef: NativeIdSchema,
  cursor: z.optional(HubCursorSchema),
  limit: z.optional(z.int().check(z.gte(1), z.lte(FEED_LIMITS.maxLimit))),
  summaryWindow: z.optional(z.int().check(z.gte(FEED_LIMITS.summaryWindowMin), z.lte(FEED_LIMITS.summaryWindowMax))),
});
export type FeedQuery = z.infer<typeof FeedQuerySchema>;

export const FeedItemSchema = z.object({
  messageId: z.string(),
  at: z.nullable(IsoTimestampSchema),
  /** fan | model | system | unknown. */
  sender: OpenTokenSchema,
  text: z.string(),
  /** The archive has no automation signal on OF → null. */
  automatic: z.nullable(z.boolean()),
  /** Tombstones stay as rows, flagged. */
  deleted: z.boolean(),
  tipMills: z.nullable(MoneyMillsSchema),
  priceMills: z.nullable(MoneyMillsSchema),
  attachmentLabels: z.array(z.string().check(z.maxLength(80))).check(z.maxLength(50)),
});
export type FeedItem = z.infer<typeof FeedItemSchema>;

export const FeedSummarySchema = z.object({
  /** active | segment-a | segment-b | unknown. */
  pingSegment: OpenTokenSchema,
  fanSilenceDays: z.nullable(CountSchema),
  window: z.object({ requested: CountSchema, served: CountSchema }),
  coverage: OpenTokenSchema,
  asOf: IsoTimestampSchema,
});
export type FeedSummary = z.infer<typeof FeedSummarySchema>;

export const FeedPageSchema = z.object({
  target: z.object({ pageLabel: z.string(), fanRef: NativeIdSchema }),
  /** The reader that served the page, same switch as the generation: archive | union. */
  source: OpenTokenSchema,
  /** Opaque snapshot id; heads compare equal only on one snapshot. */
  snapshotRevision: z.string(),
  asOf: IsoTimestampSchema,
  /** complete | partial | unknown. */
  coverage: OpenTokenSchema,
  head: z.nullable(z.object({ messageRef: z.string(), at: z.nullable(IsoTimestampSchema), sender: OpenTokenSchema })),
  newestKnownAt: z.nullable(IsoTimestampSchema),
  nextOlderCursor: z.nullable(HubCursorSchema),
  items: z.array(FeedItemSchema).check(z.maxLength(FEED_LIMITS.maxLimit)),
  /** First page (no cursor) only. */
  summary: z.nullable(FeedSummarySchema),
});
export type FeedPage = z.infer<typeof FeedPageSchema>;
