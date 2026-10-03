// Spenders (architecture.md §8.5, §8.7; hub H-8): the ranked board
// (`spenders` v2), the fan panel (`spenderDetail`), batch metrics
// (`spenderBatch`), tier buckets (`pageSpenderAutoLists`) — existing SDK
// operations, mirrored — and the new statistics and «ждут ответа» queue
// (H-8b/H-8c). Money is integer mills (signed); `null` is unknown, never 0.
// The client shows the hub's totals; it never rebuilds page totals from rows.

import * as z from 'zod/mini';

import { CountSchema, HubIntIdSchema, IsoTimestampSchema, MoneyMillsSchema, NativeIdSchema, OpenTokenSchema, TimeZoneSchema, boundedText } from '../primitives';
import { HUB_PLATFORMS, HubPageRefSchema } from './auth';
import { BusinessDateSchema, HubCursorSchema, PageLabelSchema } from './wire';

/** Board pages: 5 × 200 rows, 2 in parallel, one 120 s budget, 10 min shared cache (§8.5). */
export const SPENDERS_BOARD = {
  pageSize: 200,
  maxPages: 5,
  maxRows: 1000,
  parallel: 2,
  budgetMs: 120_000,
  cacheMs: 10 * 60_000,
} as const;

export const HUB_SPENDER_PERIODS = ['today', '7d', '30d', '90d', '180d', 'mtd', 'custom', 'lifetime'] as const;
export const HubSpenderPeriodSchema = z.enum(HUB_SPENDER_PERIODS);
export type HubSpenderPeriod = z.infer<typeof HubSpenderPeriodSchema>;

export const HUB_TRANSACTION_TYPES = [
  'subscription',
  'tip',
  'message_purchase',
  'post_purchase',
  'stream_tip',
  'chargeback',
  'refund',
  'payout_reversal',
  'other',
] as const;
export const HUB_TRANSACTION_STATES = ['pending', 'posted', 'unknown'] as const;
export const SPENDER_RETENTION_STATUSES = ['active', 'cooling', 'inactive', 'needs_reactivation'] as const;
/** The board's retention filter: a status or `all`. */
export const SPENDER_RETENTION_FILTERS = ['all', 'active', 'cooling', 'inactive', 'needs_reactivation'] as const;
export const SPENDER_SORT_KEYS = [
  'grossAmountMills',
  'creatorNetAmountMills',
  'postedGrossAmountMills',
  'pendingGrossAmountMills',
  'postedCreatorNetAmountMills',
  'pendingCreatorNetAmountMills',
  'lifetimeGrossAmountMills',
  'lifetimeCreatorNetAmountMills',
  'lastTransactionAt',
  'platformUserId',
  'username',
  'displayName',
] as const;

const Int = z.int();
const Mills = MoneyMillsSchema;

const customPeriodHolds = (q: { period?: HubSpenderPeriod | undefined; from?: string | undefined; to?: string | undefined }): boolean =>
  q.period === 'custom' ? q.from !== undefined && q.to !== undefined && q.from <= q.to : q.from === undefined && q.to === undefined;
const CUSTOM_PERIOD_RULE = { message: '`from`/`to` go with period=custom only, both, in order' } as const;

/** `spenders` v2, page scope (the only scope this client reads). */
export const SpendersQuerySchema = z
  .strictObject({
    scope: z.literal('page'),
    pageLabel: PageLabelSchema,
    period: HubSpenderPeriodSchema,
    from: z.optional(BusinessDateSchema),
    to: z.optional(BusinessDateSchema),
    limit: z.int().check(z.gte(1), z.lte(SPENDERS_BOARD.pageSize)),
    offset: CountSchema,
    query: z.optional(boundedText(200)),
    sortBy: z.optional(z.enum(SPENDER_SORT_KEYS)),
    sortDir: z.optional(z.enum(['asc', 'desc'])),
    retentionStatus: z.optional(z.enum(SPENDER_RETENTION_FILTERS)),
  })
  .check(z.refine((q) => customPeriodHolds(q), CUSTOM_PERIOD_RULE));
export type SpendersQuery = z.infer<typeof SpendersQuerySchema>;

export const SpenderFanSchema = z.object({
  platform: z.enum(HUB_PLATFORMS),
  platformUserId: z.string(),
  username: z.nullable(z.string()),
  displayName: z.nullable(z.string()),
  createdAtExternal: z.nullable(IsoTimestampSchema),
  pageAlias: z.nullable(z.string()),
});
export type SpenderFan = z.infer<typeof SpenderFanSchema>;

export const SpenderPeriodMetaSchema = z.object({
  timeZone: z.string(),
  fromBusinessDate: z.nullable(BusinessDateSchema),
  toBusinessDateInclusive: z.nullable(BusinessDateSchema),
  asOf: z.nullable(IsoTimestampSchema),
});

export const SpenderScopeSchema = z.object({
  kind: z.enum(['page', 'model', 'agency']),
  platform: z.enum(HUB_PLATFORMS),
  pageCount: Int,
  page: z.nullable(HubPageRefSchema),
  model: z.nullable(z.object({ slug: z.string(), name: z.string() })),
});

const WindowMetricsSchema = z.object({
  grossAmountMills: Mills,
  creatorNetAmountMills: Mills,
  postedGrossAmountMills: Mills,
  pendingGrossAmountMills: Mills,
  unknownGrossAmountMills: Mills,
  postedCreatorNetAmountMills: Mills,
  pendingCreatorNetAmountMills: Mills,
  unknownCreatorNetAmountMills: Mills,
  transactionCount: Int,
  lastTransactionAt: z.nullable(IsoTimestampSchema),
});

export const SpenderMetricsSchema = z.object({
  window: z.nullable(WindowMetricsSchema),
  lifetime: z.object({
    scopeGrossAmountMills: Mills,
    scopeCreatorNetAmountMills: Mills,
    platformGrossAmountMills: Mills,
    platformCreatorNetAmountMills: Mills,
  }),
  comparison: z.nullable(
    z.object({
      previousGrossAmountMills: Mills,
      previousCreatorNetAmountMills: Mills,
      deltaGrossAmountMills: Mills,
      deltaCreatorNetAmountMills: Mills,
      deltaPct: z.nullable(z.number()),
    }),
  ),
});

export const SpenderListItemSchema = z.object({
  fan: SpenderFanSchema,
  metrics: SpenderMetricsSchema,
  lifetimeLastTransactionAt: z.nullable(IsoTimestampSchema),
  lastFanMessageAt: z.nullable(IsoTimestampSchema),
  conversation: z.object({
    platformConversationId: z.nullable(z.string()),
    unreadCount: Int,
    lastMessageAt: z.nullable(IsoTimestampSchema),
    lastFanMessageAt: z.nullable(IsoTimestampSchema),
    lastModelMessageAt: z.nullable(IsoTimestampSchema),
    lastMessagePreview: z.nullable(z.string()),
    storedMessageCount: Int,
    messageCoverageStatus: z.enum(['pending_backfill', 'partial_window', 'complete']),
    messageBackfillComplete: z.boolean(),
  }),
  lastTransaction: z.nullable(
    z.object({
      canonicalType: z.enum(HUB_TRANSACTION_TYPES),
      transactionState: z.enum(HUB_TRANSACTION_STATES),
      grossAmountMills: Mills,
      creatorNetAmountMills: Mills,
      occurredAt: IsoTimestampSchema,
    }),
  ),
  retentionStatus: z.enum(SPENDER_RETENTION_STATUSES),
});
export type SpenderListItem = z.infer<typeof SpenderListItemSchema>;

export const SpenderDiagnosticsSchema = z.object({
  totalGrossAmountMills: Mills,
  totalCreatorNetAmountMills: Mills,
  attributedGrossAmountMills: Mills,
  attributedCreatorNetAmountMills: Mills,
  unattributedGrossAmountMills: Mills,
  unattributedCreatorNetAmountMills: Mills,
});

/** One page of the ranked board (`spenderListResponseSchema`). */
export const SpendersPageSchema = z.object({
  scope: SpenderScopeSchema,
  period: SpenderPeriodMetaSchema,
  diagnostics: SpenderDiagnosticsSchema,
  items: z.array(SpenderListItemSchema),
  limit: Int,
  offset: Int,
  total: Int,
});
export type SpendersPage = z.infer<typeof SpendersPageSchema>;

/** `pageSpenderAutoLists`: the hub's tier buckets (§8.5 «Тиры»). */
export const AutoListsSchema = z.object({
  page: HubPageRefSchema,
  currency: z.literal('USD'),
  metric: z.enum(['grossAmountMills', 'lifetimeGrossAmountMills']),
  period: SpenderPeriodMetaSchema,
  asOf: z.nullable(IsoTimestampSchema),
  totalEntries: CountSchema,
  lists: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      minAmountMills: z.int().check(z.gte(0)),
      maxAmountMillsExclusive: z.nullable(z.int().check(z.gte(1))),
      entryCount: CountSchema,
    }),
  ),
});
export type AutoLists = z.infer<typeof AutoListsSchema>;

/**
 * The board the background assembles for a tab (`spenders.board`): up to
 * 1000 rows from up to five hub pages of one scope, period and sign-in
 * epoch. Ranking first; statistics come separately (H-8).
 */
export const SpendersBoardSchema = z.object({
  pageLabel: PageLabelSchema,
  period: HubSpenderPeriodSchema,
  scope: SpenderScopeSchema,
  periodMeta: SpenderPeriodMetaSchema,
  diagnostics: SpenderDiagnosticsSchema,
  items: z.array(SpenderListItemSchema).check(z.maxLength(SPENDERS_BOARD.maxRows)),
  /** The hub's total of the scope; more than `items` when the board is cut at 1000. */
  total: Int,
  /** Every page within the cap arrived inside the budget. */
  complete: z.boolean(),
  fetchedAt: IsoTimestampSchema,
  /**
   * The shelves: the hub's tier buckets (`pageSpenderAutoLists`, §8.5 «Тиры»)
   * read with the board; null when that read failed — the board still shows,
   * without shelves.
   */
  tiers: z.nullable(AutoListsSchema),
});
export type SpendersBoard = z.infer<typeof SpendersBoardSchema>;

const TypeBreakdownItemSchema = z.object({
  canonicalType: z.enum(HUB_TRANSACTION_TYPES),
  grossAmountMills: Mills,
  creatorNetAmountMills: Mills,
  transactionCount: Int,
});

/** `spenderDetail`: path `platform` + `platformUserId`, query page scope + period. */
export const SpenderDetailQuerySchema = z
  .strictObject({
    platform: z.enum(HUB_PLATFORMS),
    platformUserId: NativeIdSchema,
    scope: z.literal('page'),
    pageLabel: PageLabelSchema,
    period: HubSpenderPeriodSchema,
    from: z.optional(BusinessDateSchema),
    to: z.optional(BusinessDateSchema),
  })
  .check(z.refine((q) => customPeriodHolds(q), CUSTOM_PERIOD_RULE));
export type SpenderDetailQuery = z.infer<typeof SpenderDetailQuerySchema>;

export const SpenderDetailSchema = z.object({
  scope: SpenderScopeSchema,
  fan: SpenderFanSchema,
  period: SpenderPeriodMetaSchema,
  metrics: SpenderMetricsSchema,
  typeBreakdown: z.array(TypeBreakdownItemSchema),
  pages: z.array(
    z.object({
      pageId: HubIntIdSchema,
      pageLabel: z.string(),
      modelSlug: z.string(),
      modelName: z.string(),
      inScope: z.boolean(),
      grossAmountMills: Mills,
      creatorNetAmountMills: Mills,
      lastTransactionAt: z.nullable(IsoTimestampSchema),
      isFollower: z.boolean(),
      followerSince: z.nullable(IsoTimestampSchema),
      isSubscriber: z.boolean(),
      subscriberSince: z.nullable(IsoTimestampSchema),
      subscriptionExpiresAt: z.nullable(IsoTimestampSchema),
      autoRenew: z.nullable(z.boolean()),
      autoRenewOffDetectedAt: z.nullable(IsoTimestampSchema),
    }),
  ),
});
export type SpenderDetail = z.infer<typeof SpenderDetailSchema>;

/** `spenderBatch` body (page scope). */
export const SpenderBatchQuerySchema = z
  .strictObject({
    scope: z.literal('page'),
    pageLabel: PageLabelSchema,
    period: z.optional(HubSpenderPeriodSchema),
    from: z.optional(BusinessDateSchema),
    to: z.optional(BusinessDateSchema),
    fans: z
      .array(z.strictObject({ platform: z.enum(HUB_PLATFORMS), platformUserId: NativeIdSchema }))
      .check(z.minLength(1), z.maxLength(200)),
  })
  .check(
    z.refine((q) => (q.period === undefined ? q.from === undefined && q.to === undefined : customPeriodHolds(q)), {
      message: '`from`/`to` go with period=custom only',
    }),
  );
export type SpenderBatchQuery = z.infer<typeof SpenderBatchQuerySchema>;

export const SpenderBatchSchema = z.object({
  scope: SpenderScopeSchema,
  period: SpenderPeriodMetaSchema,
  items: z.array(
    z.object({
      requestedFan: z.object({ platform: z.enum(HUB_PLATFORMS), platformUserId: z.string() }),
      found: z.boolean(),
      fan: z.nullable(SpenderFanSchema),
      metrics: z.nullable(SpenderMetricsSchema),
      typeBreakdown: z.nullable(z.array(TypeBreakdownItemSchema)),
      lifetimeLastTransactionAt: z.nullable(IsoTimestampSchema),
      subscription: z.nullable(
        z.object({
          status: z.enum(['active', 'expired', 'never']),
          expiresAt: z.nullable(IsoTimestampSchema),
          autoRenew: z.nullable(z.boolean()),
          autoRenewOffDetectedAt: z.nullable(IsoTimestampSchema),
        }),
      ),
    }),
  ),
});
export type SpenderBatch = z.infer<typeof SpenderBatchSchema>;

// ── H-8b statistics (`spenders-stats-v1`) ──────────────────────────────────

/** Path `pageLabel`; v1 serves only the 30-day window. */
export const StatsQuerySchema = z.strictObject({
  pageLabel: PageLabelSchema,
  windowDays: z.literal(30),
  timeZone: TimeZoneSchema,
});
export type StatsQuery = z.infer<typeof StatsQuerySchema>;

const MoneyWindowSchema = z.object({
  grossMills: Mills,
  purchasesGrossMills: Mills,
  adjustmentsMills: Mills,
  creatorNetMills: Mills,
  purchaseCount: CountSchema,
  payerCount: CountSchema,
});
const SilenceBucketSchema = z.object({ fans: CountSchema, lifetimeGrossMills: Mills });

/** §8.7 definitions; the client shows these numbers as sent. */
export const SpendersStatsSchema = z.object({
  pageLabel: z.string(),
  metricVersion: z.int().check(z.gte(1)),
  moneyUnit: z.literal('USD-mills'),
  basis: z.literal('gross'),
  timeZone: z.string(),
  /** Local dates YYYY-MM-DD. */
  from: z.string(),
  to: z.string(),
  asOf: IsoTimestampSchema,
  projectionAsOf: z.nullable(IsoTimestampSchema),
  includedStates: z.array(OpenTokenSchema),
  coverage: z.object({ state: OpenTokenSchema, reasons: z.array(OpenTokenSchema) }),
  days: z.array(
    z.object({
      date: z.string(),
      grossMills: Mills,
      purchasesGrossMills: Mills,
      adjustmentsMills: Mills,
      creatorNetMills: Mills,
      purchaseCount: CountSchema,
      byState: z.record(OpenTokenSchema, Mills),
    }),
  ),
  totals: z.object({
    today: MoneyWindowSchema,
    d7: MoneyWindowSchema,
    prev7: MoneyWindowSchema,
    d30: MoneyWindowSchema,
    /** null when prev7 = 0. */
    d7DeltaPct: z.nullable(z.number()),
  }),
  avgCheckMills: z.nullable(Mills),
  tiers: z.array(
    z.object({
      key: OpenTokenSchema,
      label: z.string(),
      minMills: z.nullable(Mills),
      maxMills: z.nullable(Mills),
      members: CountSchema,
      windowPayers: CountSchema,
      windowGrossMills: Mills,
    }),
  ),
  silence: z.object({ d8to21: SilenceBucketSchema, over21: SilenceBucketSchema, unknown: SilenceBucketSchema }),
  newPayers: z.object({ count: CountSchema, firstPurchaseKnown: z.boolean() }),
  queueSummary: z.object({ total: CountSchema, unknown: CountSchema }),
});
export type SpendersStats = z.infer<typeof SpendersStatsSchema>;

// ── H-8c «ждут ответа» (`awaiting-reply-v1`) ───────────────────────────────

export const QueueQuerySchema = z.strictObject({
  pageLabel: PageLabelSchema,
  cursor: z.optional(HubCursorSchema),
  limit: z.optional(z.int().check(z.gte(1), z.lte(100))),
});
export type QueueQuery = z.infer<typeof QueueQuerySchema>;

export const READ_STATES = ['unread', 'read', 'unknown'] as const;

export const QueuePageSchema = z.object({
  items: z.array(
    z.object({
      fanRef: NativeIdSchema,
      username: z.nullable(z.string()),
      displayName: z.nullable(z.string()),
      lifetimeGrossMills: Mills,
      lastFanMessageAt: IsoTimestampSchema,
      lastModelMessageAt: z.nullable(IsoTimestampSchema),
      unreadCount: z.nullable(CountSchema),
      /** unread | read | unknown («ждёт ответа; прочтение неизвестно»). */
      readState: OpenTokenSchema,
    }),
  ),
  total: CountSchema,
  loaded: CountSchema,
  unknown: CountSchema,
  nextCursor: z.nullable(HubCursorSchema),
  asOf: IsoTimestampSchema,
});
export type QueuePage = z.infer<typeof QueuePageSchema>;
