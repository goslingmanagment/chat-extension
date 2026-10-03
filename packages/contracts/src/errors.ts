// Error vocabulary (architecture.md §5.7, §9.5, Appendix A). The codes are the
// full list of Appendix A, in its order; a code and its meaning never change
// after the first release — a removed code stays as a `retired` entry. The
// entries themselves (kind, severity, texts, recovery, retry, telemetry,
// settings route per code) live in the CG registry.

import * as z from 'zod/mini';

import { EpochMsSchema, displayText } from './primitives';

/** `CG-<AREA>-<NAME>`: readable without a lookup, never clashing with the old numeric `CG-HUB-NNN` / `CG-FLOW-NN`. */
export const CG_CODE_PATTERN = /^CG-[A-Z]+(?:-[A-Z0-9]+)*$/;

export const CG_CODES = [
  'CG-LOGIN-CREDENTIALS',
  'CG-LOGIN-RATE-LIMIT',
  'CG-LOGIN-UNAVAILABLE',
  'CG-LOGIN-TIMEOUT',
  'CG-LOGIN-PENDING',
  'CG-LOGIN-INCOMPLETE',
  'CG-AUTH-REQUIRED',
  'CG-AUTH-REVOKED',
  'CG-AUTH-EXPIRED',
  'CG-AUTH-REJECTED',
  'CG-HUB-URL',
  'CG-HUB-HOST-PERMISSION',
  'CG-HUB-UNAVAILABLE',
  'CG-HUB-OUTDATED',
  'CG-HUB-REQUEST',
  'CG-HUB-FORBIDDEN',
  'CG-HUB-RATE-LIMIT',
  'CG-HUB-TIMEOUT',
  'CG-HUB-CAPABILITY',
  'CG-HUB-UNKNOWN',
  'CG-BINDING-MISSING',
  'CG-BINDING-AMBIGUOUS',
  'CG-BINDING-NOT-GRANTED',
  'CG-PERSONA-NONE',
  'CG-PERSONA-UNASSIGNED',
  'CG-PERSONA-UNAVAILABLE',
  'CG-PERSONA-CHANGED',
  'CG-FEATURE-DISABLED',
  'CG-CONTEXT-CHANGED',
  'CG-CONTEXT-CONFLICT',
  'CG-QUOTA-DAILY',
  'CG-GATE-DRAFT',
  'CG-GATE-HISTORY',
  'CG-GATE-HI',
  'CG-GATE-PING',
  'CG-GATE-LANGUAGE',
  'CG-GATE-FAN-BLOCKED',
  'CG-GATE-FAN-UNKNOWN',
  'CG-GATE-CHAT-LOADING',
  'CG-GATE-OVERLAY',
  'CG-OP-CHAT-BUSY',
  'CG-OP-TAB-LIMIT',
  'CG-OP-COACH-BUSY',
  'CG-OP-INTERRUPTED',
  'CG-PROVIDER-BILLING',
  'CG-PROVIDER-AUTH',
  'CG-PROVIDER-RATE-LIMIT',
  'CG-PROVIDER-UNAVAILABLE',
  'CG-PROVIDER-PROXY',
  'CG-PROVIDER-STREAM',
  'CG-PROVIDER-USAGE-MISSING',
  'CG-PROVIDER-INCOMPLETE',
  'CG-PROVIDER-UNKNOWN',
  'CG-PROVIDER-EMPTY',
  'CG-OUTPUT-UNUSABLE',
  'CG-OUTPUT-COACH-LIMIT',
  'CG-STREAM-TRUNCATED',
  'CG-RECAP-NOT-FOUND',
  'CG-RECAP-SAVE',
  'CG-DATA-UNAVAILABLE',
  'CG-DATA-NOT-READY',
  'CG-DATA-PARTIAL',
  'CG-DATA-TIMEOUT',
  'CG-HOST-NOT-READY',
  'CG-HOST-CONTRACT',
  'CG-HOST-COMPOSER-MISSING',
  'CG-RUNTIME-RELOADED',
  'CG-INSERT-CHAT-CHANGED',
  'CG-INSERT-FAILED',
  'CG-INSERT-UNCERTAIN',
  'CG-INSERT-MISPLACED',
  'CG-INSERT-CANCELED',
  'CG-DRAFT-CHANGED',
  'CG-NAV-FAILED',
  'CG-NAV-TIMEOUT',
  'CG-CLIPBOARD',
  'CG-CLAIM-BUSY',
  'CG-CLAIM-EXPIRED',
  'CG-CLAIM-ROW-CHANGED',
  'CG-CLAIM-ROW-BUSY',
  'CG-SEND-OFF',
  'CG-SEND-HOST',
  'CG-SEND-RECEIPT',
  'CG-SEND-ACTIVE-CHAT',
  'CG-SEND-PERMISSION',
  'CG-SEND-FAN',
  'CG-SEND-MIMIC',
  'CG-SEND-TRANSLATOR',
  'CG-SEND-STALE',
  'CG-SEND-FRESHNESS',
  'CG-SEND-BUSY',
  'CG-SEND-QUEUE',
  'CG-SEND-PART',
  'CG-SEND-GUARD',
  'CG-SEND-REJECTED',
  'CG-SEND-UNCERTAIN',
  'CG-NETWORK',
  'CG-TIMEOUT',
  'CG-STORAGE-READ',
  'CG-STORAGE-WRITE',
  'CG-STORAGE-VERSION',
  'CG-STORAGE-FULL',
  'CG-AUDIO-BLOCKED',
  'CG-UI-FAILED',
  'CG-RUNTIME-UNREACHABLE',
  'CG-UNKNOWN',
] as const;

export const CgCodeSchema = z.enum(CG_CODES);
export type CgCode = z.infer<typeof CgCodeSchema>;

export function isCgCode(value: unknown): value is CgCode {
  return typeof value === 'string' && (CG_CODES as readonly string[]).includes(value);
}

export const CG_SEVERITIES = ['info', 'warn', 'error'] as const;
export type CgSeverity = (typeof CG_SEVERITIES)[number];

/** What the person can do about it. */
export const CG_RECOVERIES = [
  'none',
  'retry',
  'new-generation',
  'wait-until',
  'sign-in',
  'open-settings',
  'reload-tab',
  'update-extension',
  'open-chat',
  'contact-owner',
] as const;
export type CgRecovery = (typeof CG_RECOVERIES)[number];

/**
 * What may be repeated at all (Appendix A «Повтор»): a safe read, a new human
 * click, a manual retry after a deadline, or never.
 */
export const CG_RETRIES = ['safe-read', 'new-click', 'after-deadline', 'never'] as const;
export type CgRetry = (typeof CG_RETRIES)[number];

/** Telemetry class: plain count, count with a sample, or a P1 incident counter. */
export const CG_TELEMETRY_CLASSES = ['count', 'count+sample', 'p1'] as const;
export type CgTelemetryClass = (typeof CG_TELEMETRY_CLASSES)[number];

/** Sections of the options page (§9.9); an error deep-links to one of them. */
export const SETTINGS_SECTIONS = ['status', 'account', 'personas', 'accounts', 'generation', 'hotkeys', 'appearance', 'diagnostics'] as const;
export const SettingsSectionSchema = z.enum(SETTINGS_SECTIONS);
export type SettingsSection = z.infer<typeof SettingsSectionSchema>;

/** Deep link into the options page: `options.html#<section>:<CODE>` (ST-007…ST-010). */
export const SettingsRouteSchema = z.strictObject({
  section: SettingsSectionSchema,
  code: z.optional(CgCodeSchema),
});
export type SettingsRoute = z.infer<typeof SettingsRouteSchema>;

// TODO(R01-2c): replace this alias with the typed key union from the i18n key
// catalog that part 2c adds next to cg-registry.ts; CgEntry then type-checks
// its texts against the catalog.
/** A key of the i18n catalog. */
export type I18nKey = string;

/** One entry of the CG registry (§5.7). */
export interface CgEntry {
  readonly code: CgCode;
  /** Short machine kind for diagnostics grouping (auth, hub, gate, host, send…). */
  readonly kind: string;
  readonly severity: CgSeverity;
  readonly title: I18nKey;
  readonly body: I18nKey;
  readonly recovery: CgRecovery;
  readonly retry: CgRetry;
  readonly telemetry: CgTelemetryClass;
  readonly settings?: SettingsRoute;
  /** A code removed after release stays as a record. */
  readonly retired?: { readonly at: string; readonly reason: string };
}

/** Technical detail line: «HTTP 429 • …», at most 400 characters (ER-005…ER-007). */
export const CG_DETAIL_MAX_CHARS = 400;

/**
 * An error as it crosses a runtime boundary (background → tab/page): the code
 * and facts only. Texts are rendered on the receiving side from the registry
 * and the i18n catalog; server texts are never shown as markup.
 */
export const CgErrorWireSchema = z.strictObject({
  code: CgCodeSchema,
  detail: z.optional(displayText(CG_DETAIL_MAX_CHARS)),
  /** The retry deadline, fixed once (ER-007). */
  retryAt: z.optional(EpochMsSchema),
  httpStatus: z.optional(z.int().check(z.gte(100), z.lte(599))),
});
export type CgErrorWire = z.infer<typeof CgErrorWireSchema>;

/** An error ready for display (§5.7): localized title and body, plain text only. */
export const CgErrorViewSchema = z.strictObject({
  code: CgCodeSchema,
  title: displayText(200),
  body: displayText(2000),
  detail: z.optional(displayText(CG_DETAIL_MAX_CHARS)),
  retryAt: z.optional(EpochMsSchema),
  settings: z.optional(SettingsRouteSchema),
});
export type CgErrorView = z.infer<typeof CgErrorViewSchema>;
