// 1.15.0 P14b2: local, bounded diagnostic projections. Never session material.
import * as z from 'zod/mini';
import { FeatureIdSchema } from './features';
import { HostKindSchema } from './ids';
import { CountSchema, EpochMsSchema, NativeIdSchema, boundedText } from './primitives';

/** MAIN/isolated observations. Booleans and numeric counters only, no page text. */
export const PageDiagnosticsSchema = z.strictObject({
  observedAt: EpochMsSchema,
  companion: z.nullable(z.strictObject({ windowBridge: z.boolean(), networkHook: z.boolean(), styleFixes: z.boolean(), wordFilter: z.boolean() })),
  mainAvailable: z.boolean(),
  counters: z.record(z.string().check(z.regex(/^[a-zA-Z][a-zA-Z0-9.]{0,95}$/)), CountSchema).check(z.refine((v) => Object.keys(v).length <= 128)),
});
export type PageDiagnostics = z.infer<typeof PageDiagnosticsSchema>;

/** Whitelisted header NAMES only. No value, token, cookie, URL or request id. */
export const NetworkSessionSnapshotSchema = z.strictObject({
  present: z.boolean(),
  ageMs: z.nullable(CountSchema),
  accountId: z.nullable(NativeIdSchema),
  headerNames: z.array(z.string().check(z.regex(/^[a-z][a-z0-9-]{0,63}$/))).check(z.maxLength(16)),
});
export type NetworkSessionSnapshot = z.infer<typeof NetworkSessionSnapshotSchema>;

export const FRESHNESS_COUNTS = ['generations', 'marked', 'unknown', 'rejectedTail', 'truncated', 'nonLiveUnion'] as const;
export const FreshnessCountsSchema = z.strictObject(Object.fromEntries(FRESHNESS_COUNTS.map((key) => [key, CountSchema])) as Record<(typeof FRESHNESS_COUNTS)[number], typeof CountSchema>);
export const FreshnessDaySchema = z.strictObject({
  since: EpochMsSchema,
  until: EpochMsSchema,
  /** Hour buckets: the first partial hour is excluded, so never older than 24h. */
  resolutionMs: z.literal(3_600_000),
  persisted: z.boolean(),
  dropped: CountSchema,
  rows: z.array(z.strictObject({ host: HostKindSchema, build: z.nullable(boundedText(80)), feature: FeatureIdSchema, counts: FreshnessCountsSchema })).check(z.maxLength(128)),
});
export type FreshnessDay = z.infer<typeof FreshnessDaySchema>;
