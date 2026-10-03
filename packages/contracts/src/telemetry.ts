// Telemetry (architecture.md §5.7, §9.6, D-22; hub H-11a, H-14): the
// `ai_acceptance` lifecycle and `client_health` with fixed-bound histograms.
// Both leave the browser only with the `technicalAndInteraction` consent. No
// text, no fan/chat/operation ids in `perf`; percentiles are the server's job
// (a mean of partial p95s is meaningless).

import * as z from 'zod/mini';

import { FeatureIdSchema, SurfaceSchema } from './features';
import { HostContractReportSchema } from './host';
import { HostKindSchema } from './ids';
import { TELEMETRY_LIMITS } from './limits';
import {
  CountSchema,
  EpochMsSchema,
  IsoTimestampSchema,
  NativeIdSchema,
  RefSchema,
  UuidSchema,
  boundedText,
  displayText,
} from './primitives';

export const ACCEPTANCE_LIFECYCLE = ['shown', 'copied', 'inserted', 'sent'] as const;

/**
 * One acceptance event. `sent` exists only from a linked receipt + echo with
 * the same message id (§6.6 `via: 'composer'`, §6.7.6 `via: 'preview'`).
 */
export const AcceptanceEventSchema = z.strictObject({
  /** Stable across retries; the hub deduplicates by it. */
  clientEventId: UuidSchema,
  kind: z.literal('ai_acceptance'),
  observedAt: IsoTimestampSchema,
  pageLabel: boundedText(120),
  payload: z
    .strictObject({
      /** Hub `meta.requestId` (TL-007, TL-008). */
      generationRef: RefSchema,
      lifecycle: z.enum(ACCEPTANCE_LIFECYCLE),
      /** By draft revision and provenance, never by text similarity. */
      edited: z.optional(z.boolean()),
      opId: UuidSchema,
      feature: FeatureIdSchema,
      surface: SurfaceSchema,
      part: z.optional(z.int().check(z.gte(0), z.lte(9))),
      variant: z.optional(z.int().check(z.gte(0), z.lte(2))),
      via: z.optional(z.enum(['composer', 'preview'])),
      attemptId: z.optional(UuidSchema),
      platformMessageId: z.optional(NativeIdSchema),
    })
    .check(
      z.refine((p) => p.lifecycle !== 'sent' || (p.via !== undefined && p.platformMessageId !== undefined), {
        message: '`sent` needs `via` and the platform message id',
      }),
      z.refine((p) => p.via !== 'preview' || p.attemptId !== undefined, { message: 'a preview send needs its attemptId' }),
      z.refine(
        (p) => p.lifecycle === 'sent' || (p.via === undefined && p.attemptId === undefined && p.platformMessageId === undefined),
        { message: 'send fields belong to `sent` only' },
      ),
      z.refine((p) => p.edited === undefined || p.lifecycle === 'sent', { message: '`edited` belongs to `sent`' }),
    ),
});
export type AcceptanceEvent = z.infer<typeof AcceptanceEventSchema>;

/** Counter names, anchor ids, disabled features: machine tokens only, never free text (hub `healthCode`). */
export const HEALTH_CODE_PATTERN = /^[A-Za-z0-9._:-]{1,80}$/;
export const HealthCodeSchema = z.string().check(z.regex(HEALTH_CODE_PATTERN));

/** P1 incident counters (§0.4) and the prevented-insert counter, always present in `counters`. */
export const P1_COUNTERS = ['p1.insert-misplaced', 'p1.send-without-human', 'p1.read-without-human'] as const;
export const SAFETY_COUNTERS = ['insert.prevented', 'send.held', 'send.uncertain'] as const;

/**
 * Performance metrics with FIXED histogram bounds, ms (§11; names and bounds
 * frozen here, hub-pr-plan §4.8 proposed them). Changing a metric's bounds or
 * meaning bumps its schemaVersion. `counts` has bounds.length + 1 buckets:
 * bucket i counts values ≤ bounds[i] (and > bounds[i-1]); the last one counts
 * values above the last bound.
 */
export const PERF_METRICS = {
  /** Route change → dock updated (budget p95 ≤ 50 ms winpc). */
  routeToDockMs: { schemaVersion: 1, bounds: [1, 2, 4, 8, 16, 32, 50, 75, 100, 150, 250, 500, 1000] },
  /** Hotkey or click → visible response (p95 ≤ 50 ms; cold ≤ 250 ms). */
  panelOpenMs: { schemaVersion: 1, bounds: [4, 8, 16, 32, 50, 75, 100, 150, 250, 500, 1000, 2500] },
  /** Click → request sent: our client overhead (p95 ≤ 30 ms). */
  requestOverheadMs: { schemaVersion: 1, bounds: [1, 2, 4, 8, 16, 32, 50, 100, 250, 500] },
  /** Click → first chunk, end to end (provider latency included; compared with old clients by hub logs). */
  ttfcMs: { schemaVersion: 1, bounds: [250, 500, 1000, 1500, 2000, 3000, 4000, 6000, 8000, 12000, 20000, 30000, 60000] },
  /** First chunk → painted (≤ 50 ms). */
  firstChunkPaintMs: { schemaVersion: 1, bounds: [4, 8, 16, 32, 50, 75, 100, 150, 250, 500] },
  /** Guarded insert with verification (p95 ≤ 100 ms). */
  insertMs: { schemaVersion: 1, bounds: [4, 8, 16, 32, 50, 75, 100, 150, 250, 500, 1000] },
  /** Board open from cache (p95 ≤ 150 ms). */
  boardOpenMs: { schemaVersion: 1, bounds: [8, 16, 32, 50, 75, 100, 150, 250, 500, 1000, 2500] },
  /** Search over up to 1000 rows (≤ 50 ms). */
  searchMs: { schemaVersion: 1, bounds: [1, 2, 4, 8, 16, 32, 50, 100, 250, 500] },
  /** Our synchronous handlers, sampled 1 in 20 (≤ 2 ms; none > 16 ms). */
  handlerMs: { schemaVersion: 1, bounds: [0.1, 0.5, 1, 2, 4, 8, 16, 50, 100] },
  /** Event Timing of our hotkeys and clicks → next paint. */
  eventLatencyMs: { schemaVersion: 1, bounds: [8, 16, 24, 32, 50, 75, 100, 150, 250, 500, 1000] },
  /** Input delay in ChatSpace's composer with the extension on (≤ baseline + 5 ms). */
  composerInputDelayMs: { schemaVersion: 1, bounds: [1, 2, 4, 8, 16, 32, 50, 100, 250] },
} as const satisfies Record<string, { readonly schemaVersion: number; readonly bounds: readonly number[] }>;

export type PerfMetric = keyof typeof PERF_METRICS;
export const PERF_METRIC_NAMES = Object.keys(PERF_METRICS) as PerfMetric[];
export const PerfMetricSchema = z.enum(PERF_METRIC_NAMES as [PerfMetric, ...PerfMetric[]]);

export const PerfHistogramSchema = z
  .strictObject({
    metric: PerfMetricSchema,
    unit: z.literal('ms'),
    schemaVersion: z.int().check(z.gte(1)),
    bounds: z.array(z.number().check(z.gte(0))).check(z.minLength(1), z.maxLength(32)),
    counts: z.array(CountSchema).check(z.minLength(2), z.maxLength(33)),
    count: CountSchema,
    sum: z.number().check(z.gte(0)),
    max: z.number().check(z.gte(0)),
  })
  .check(
    z.refine((h) => h.counts.length === h.bounds.length + 1, { message: 'counts must have bounds.length + 1 buckets' }),
    z.refine((h) => h.counts.reduce((a, b) => a + b, 0) === h.count, { message: 'count must equal the sum of counts' }),
    z.refine(
      (h) => {
        const fixed = PERF_METRICS[h.metric];
        return h.schemaVersion === fixed.schemaVersion && h.bounds.length === fixed.bounds.length && h.bounds.every((b, i) => b === fixed.bounds[i]);
      },
      { message: 'bounds and schemaVersion must be the fixed ones of the metric' },
    ),
    z.refine((h) => h.count > 0 || (h.sum === 0 && h.max === 0), { message: 'an empty histogram has zero sum and max' }),
  );
export type PerfHistogram = z.infer<typeof PerfHistogramSchema>;

const healthList = z.array(HealthCodeSchema).check(z.maxLength(TELEMETRY_LIMITS.healthMaxListItems));
const healthCounters = z
  .record(HealthCodeSchema, z.int().check(z.gte(0), z.lte(TELEMETRY_LIMITS.healthMaxCounterValue)))
  .check(z.refine((r) => Object.keys(r).length <= TELEMETRY_LIMITS.healthMaxCounters, { message: 'too many counters' }));
const perfList = z
  .array(PerfHistogramSchema)
  .check(
    z.maxLength(TELEMETRY_LIMITS.healthMaxPerf),
    z.refine((list) => new Set(list.map((h) => h.metric)).size === list.length, { message: 'one histogram per metric' }),
  );

/**
 * One `client_health` report over a 15-minute window (H-11). The hub facade
 * moves `kind` into the ingest envelope; the rest is the hub's
 * `clientHealthReportV1Schema` body.
 */
export const ClientHealthV1Schema = z.strictObject({
  kind: z.literal('client_health'),
  v: z.literal(1),
  window: z.strictObject({ from: IsoTimestampSchema, to: IsoTimestampSchema }),
  client: z.strictObject({
    name: z.literal('chat-extension'),
    version: boundedText(32),
    browser: z.literal('firefox'),
    browserMajor: z.int().check(z.gte(1)),
    os: z.enum(['windows', 'macos', 'linux', 'other']),
  }),
  host: z.strictObject({
    kind: HostKindSchema,
    build: z.nullable(displayText(80)),
    contractOk: z.boolean(),
    missing: healthList,
  }),
  /** Turned off by flags or by the host contract. */
  disabled: healthList,
  perf: perfList,
  /** Errors by code, prevented inserts, P1. */
  counters: healthCounters,
  /** Sizes of our own caches only; never heap. */
  footprint: z.strictObject({ kind: z.literal('owned-estimate'), cachesKB: CountSchema, logsKB: CountSchema }),
});
export type ClientHealthV1 = z.infer<typeof ClientHealthV1Schema>;

/** What a tab reports to the background (`health.report`): deltas since its last report; the background aggregates. */
export const TabHealthReportSchema = z.strictObject({
  windowFrom: EpochMsSchema,
  windowTo: EpochMsSchema,
  host: z.nullable(HostContractReportSchema),
  perf: perfList,
  counters: healthCounters,
  footprint: z.strictObject({ cachesKB: CountSchema, domNodes: CountSchema }),
});
export type TabHealthReport = z.infer<typeof TabHealthReportSchema>;
