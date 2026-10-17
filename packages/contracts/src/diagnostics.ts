// 1.15.0 P14b2: local, bounded diagnostic projections. Never session material.
import * as z from 'zod/mini';
import { FeatureIdSchema } from './features';
import { HostKindSchema } from './ids';
import { CountSchema, EpochMsSchema, IsoTimestampSchema, NativeIdSchema, boundedText } from './primitives';

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

/** 1.20.0 (DB-022, decision X47): the local AI spend journal's totals — numbers only, never a text. */
const SpendTotalsShape = {
  runs: CountSchema,
  inserts: CountSchema,
  inputTokens: CountSchema,
  outputTokens: CountSchema,
  cacheReadTokens: CountSchema,
  cacheWriteTokens: CountSchema,
  costMicroUsd: CountSchema,
  /** Some cost was approximate (the hub said so). */
  approximate: z.boolean(),
  /** Cache reads / all input; null with no input. */
  cacheShare: z.nullable(z.number().check(z.gte(0), z.lte(1))),
};
const LocalDaySchema = z.string().check(z.regex(/^\d{4}-\d{2}-\d{2}$/));
/** Features of the journal: the shared ones and a site's own, as the journal keys them. */
export const SPEND_REPORT_FEATURES_MAX = 32;

/**
 * 1.20.0 (DB-022, Б4): `usage.local` — what this browser spent on AI by feature over the last `days` local days
 * (`core/domain/debug` LocalSpendJournal). Only this browser (the page labels it «только этот браузер»), never the
 * person's full spend.
 */
export const LocalSpendReportSchema = z.strictObject({
  source: z.literal('local-browser'),
  fromDay: LocalDaySchema,
  toDay: LocalDaySchema,
  total: z.strictObject(SpendTotalsShape),
  byFeature: z
    .array(z.strictObject({ feature: z.string().check(z.regex(/^[a-z][a-z0-9-]{0,63}$/)), ...SpendTotalsShape }))
    .check(z.maxLength(SPEND_REPORT_FEATURES_MAX)),
});
export type LocalSpendReport = z.infer<typeof LocalSpendReportSchema>;

/**
 * 1.20.0 (DB-027, decision X47): `account.advanced` — «Аккаунт → Дополнительно» in debug mode. `signIn.key` — the
 * hub's display prefix of this device's key («agh_dev_Zx81…»), never a part of the secret itself; null — the hub gave
 * none. `hosts` — «Поток»: the build and the contract result of each site with a tab open now. `app` — «Приложение»:
 * the version, the browser and the OS in one line.
 */
export const AccountAdvancedSchema = z.strictObject({
  signIn: z.nullable(z.strictObject({ key: z.nullable(boundedText(80)), issuedAt: z.nullable(IsoTimestampSchema), expiresAt: z.nullable(IsoTimestampSchema) })),
  hosts: z.array(z.strictObject({ host: HostKindSchema, build: z.nullable(boundedText(80)), contractOk: z.nullable(z.boolean()) })).check(z.maxLength(8)),
  app: boundedText(160),
});
export type AccountAdvanced = z.infer<typeof AccountAdvancedSchema>;
