// Telemetry ingest (`ingestObservations`, hub H-11/H-14) and the user's own
// AI spend for debug (H-15, `ai-usage-v1`). Ingest takes an open envelope:
// the background moves `kind` of our AcceptanceEvent / ClientHealthV1 into it
// and mints `clientEventId`/`observedAt` where the event has none; the hub
// deduplicates by (user, clientEventId). `client_health` is sent only when
// bootstrap declares `client-health-perf-v1`, in its own batch.

import * as z from 'zod/mini';

import { CountSchema, HubIntIdSchema, IsoTimestampSchema, MicroUsdSchema, OpenTokenSchema, TimeZoneSchema, UuidSchema, boundedText } from '../primitives';
import { BusinessDateSchema, PageLabelSchema } from './wire';

/** Kinds this client ingests; the narrow token's profile allows exactly these (H-3, H-11b). */
export const INGEST_KINDS = ['ai_acceptance', 'client_health'] as const;
export const INGEST_LIMITS = { maxEventsPerBatch: 100 } as const;

export const IngestEventSchema = z.strictObject({
  clientEventId: UuidSchema,
  kind: boundedText(120),
  observedAt: IsoTimestampSchema,
  payload: z.record(z.string(), z.unknown()),
  pageLabel: z.optional(PageLabelSchema),
});
export type IngestEvent = z.infer<typeof IngestEventSchema>;

export const IngestBatchSchema = z.strictObject({
  events: z.array(IngestEventSchema).check(z.minLength(1), z.maxLength(INGEST_LIMITS.maxEventsPerBatch)),
});
export type IngestBatch = z.infer<typeof IngestBatchSchema>;

/** Both counts let the client prune its queue (TL-009…TL-012). */
export const IngestResultSchema = z.object({ accepted: CountSchema, duplicates: CountSchema });
export type IngestResult = z.infer<typeof IngestResultSchema>;

// ── H-15 own AI spend (debug only, Б4) ─────────────────────────────────────

export const AI_USAGE_LIMITS = { maxDays: 7, defaultTimeZone: 'Europe/Moscow' } as const;

/** Path `pageLabel`; `date` is the LAST day of the range; the hub refuses a future date or one older than 8 days. */
export const AiUsageQuerySchema = z.strictObject({
  pageLabel: PageLabelSchema,
  date: BusinessDateSchema,
  days: z.optional(z.int().check(z.gte(1), z.lte(AI_USAGE_LIMITS.maxDays))),
  timeZone: z.optional(TimeZoneSchema),
});
export type AiUsageQuery = z.infer<typeof AiUsageQuerySchema>;

export const AiUsageTotalsSchema = z.object({
  requestCount: CountSchema,
  costMicroUsd: MicroUsdSchema,
  costApproximate: z.boolean(),
  tokens: z.object({ input: CountSchema, output: CountSchema, cacheWrite: CountSchema, cacheRead: CountSchema }),
  completed: CountSchema,
  failed: CountSchema,
  cancelled: CountSchema,
  quotaDenied: CountSchema,
  openReservations: CountSchema,
  regenerations: CountSchema,
});
export type AiUsageTotals = z.infer<typeof AiUsageTotalsSchema>;

export const AiUsageDaySchema = z.object({
  date: z.string(),
  from: IsoTimestampSchema,
  toExclusive: IsoTimestampSchema,
  /** complete | partial (day open, open reservations, approximate cost). */
  coverage: OpenTokenSchema,
  coverageReasons: z.array(OpenTokenSchema),
  totals: AiUsageTotalsSchema,
  features: z.array(z.extend(AiUsageTotalsSchema, { feature: OpenTokenSchema })),
});
export type AiUsageDay = z.infer<typeof AiUsageDaySchema>;

/** Only the caller's own spend on a granted page; the owner too sees only their own. */
export const AiUsageReportSchema = z.object({
  scope: z.object({ pageLabel: z.string(), userId: HubIntIdSchema }),
  timeZone: z.string(),
  asOf: IsoTimestampSchema,
  moneyUnit: z.literal('micro-USD'),
  days: z.array(AiUsageDaySchema),
  /** The quota's day ends at 00:00 UTC, unlike the report's zone. */
  quota: z.nullable(
    z.object({
      dayBoundary: z.literal('UTC'),
      remainingRequestsToday: z.nullable(CountSchema),
      remainingMicroUsdToday: z.nullable(MicroUsdSchema),
    }),
  ),
});
export type AiUsageReport = z.infer<typeof AiUsageReportSchema>;
