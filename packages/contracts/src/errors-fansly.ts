// The CG codes of fansly.com (1.15.0; R20 docs/project-unite/architecture.md
// §1.6, §12; docs/architecture.md Appendix A «Коды Fansly»): session, API and
// relay (`CG-FAN-*`), «Заметки» (`CG-NOTE-*`), vault (`CG-VAULT-*`) and
// Fansly's «Новые» (`CG-FNEW-*`). Voice notes (`CG-VOICE-*`) are on both sites
// since 1.47.0: the shared registry's.
//
// A registry of the site's own, beside the shared one (errors.ts,
// errors/registry.ts), with the same rules: `CG-<AREA>-<NAME>`, readable
// without a lookup; a code and its meaning never change after the first
// release that carries it; a removed code stays as a `retired` entry. The old
// Fansly extension's numeric codes are not borrowed (`CG-FAN-01`,
// `CG-VOICE-12`…: their meanings are listed in Appendix A beside the new
// names), and its retired numbers — CG-API-02/03/04, CG-AUTH-01/02 — are
// never taken again (ER-083: a stored error of the old one must not read as
// a new meaning).
//
// Where they live. Merged with the shared registry only in a Fansly tab, on
// the extension pages and in the `bg/fansly` chunk: no ChatSpace bundle
// carries them (this module is not in the package index, and nothing a
// ChatSpace bundle imports imports it). The texts are the Fansly catalogs
// (core/src/domain/hosts/fansly/i18n). On the wire a Fansly code travels
// inside the payload of a Fansly message (`CgAnyErrorWireSchema`): the shared
// envelope's error and the shared views (op, send, toast) carry shared codes
// only, so a ChatSpace parse never meets a code it does not know. A failure
// the hub reports on a shared path (an AI stream) reads as a shared code:
// `conversation_fan_mismatch` → CG-CONTEXT-CHANGED (hub/error-map.ts).

import * as z from 'zod/mini';

import { CG_CODES, CgErrorWireSchema, type CgRecovery, type CgRetry, type CgSeverity, type CgTelemetryClass, type SettingsSection } from './errors';
import { cgBodyKey, cgTitleKey, type CgBodyKey, type CgTitleKey } from './i18n/keys';

/** In Appendix A «Коды Fansly» order. */
export const CG_FANSLY_CODES = [
  'CG-FAN-OFF',
  'CG-FAN-SESSION',
  'CG-FAN-EXPIRED',
  'CG-FAN-REQUEST',
  'CG-FAN-RATE-LIMIT',
  'CG-FAN-TAB',
  'CG-FAN-GROUP',
  'CG-FAN-NETWORK',
  'CG-NOTE-READ',
  'CG-NOTE-WRITE',
  'CG-NOTE-UNCERTAIN',
  'CG-NOTE-TOO-LONG',
  'CG-VAULT-NO-ALBUM',
  'CG-VAULT-UPLOAD',
  'CG-VAULT-UNCERTAIN',
  'CG-VAULT-STOPPED',
  'CG-FNEW-PARTIAL',
  'CG-FNEW-ACCOUNT',
  'CG-FNEW-DM-CLOSED',
  'CG-FNEW-HISTORY',
  'CG-FNEW-UNVERIFIED',
] as const;

export type CgFanslyCode = (typeof CG_FANSLY_CODES)[number];
export const CgFanslyCodeSchema = z.enum(CG_FANSLY_CODES);

/**
 * The numbers the old Fansly extension retired (ER-083): CG-AUTH-01 missing_api_key, CG-AUTH-02 invalid_api_key,
 * CG-API-02 insufficient_balance, CG-API-03 model_unavailable, CG-API-04 context_too_long. Its stored errors may
 * still carry them; no code of ours ever takes them (nor any numeric code of the old one).
 */
export const FANSLY_RETIRED_OLD_CODES = ['CG-AUTH-01', 'CG-AUTH-02', 'CG-API-02', 'CG-API-03', 'CG-API-04'] as const;

/** A code of either registry: the vocabulary of a Fansly tab, the extension pages and `bg/fansly`. */
export const CG_ANY_CODES = [...CG_CODES, ...CG_FANSLY_CODES] as const;
export type CgAnyCode = (typeof CG_ANY_CODES)[number];
export const CgAnyCodeSchema = z.enum(CG_ANY_CODES);

export function isCgFanslyCode(value: unknown): value is CgFanslyCode {
  return typeof value === 'string' && (CG_FANSLY_CODES as readonly string[]).includes(value);
}

export function isCgAnyCode(value: unknown): value is CgAnyCode {
  return typeof value === 'string' && (CG_ANY_CODES as readonly string[]).includes(value);
}

/** CgErrorWire whose code may be a Fansly one: the failure inside a Fansly message's payload. */
export const CgAnyErrorWireSchema = z.extend(CgErrorWireSchema, { code: CgAnyCodeSchema });
export type CgAnyErrorWire = z.infer<typeof CgAnyErrorWireSchema>;

/** Diagnostics grouping of the Fansly codes (the shared `CgKind`s are the shared registry's). */
export const CG_FANSLY_KINDS = ['fansly', 'note', 'vault', 'newcomers'] as const;
export type CgFanslyKind = (typeof CG_FANSLY_KINDS)[number];

/** One entry of the Fansly registry: the fields of a shared entry (errors.ts `CgEntry`), its texts pinned to its code. */
export interface CgFanslyEntry<C extends CgFanslyCode = CgFanslyCode> {
  readonly code: C;
  readonly kind: CgFanslyKind;
  readonly severity: CgSeverity;
  readonly title: CgTitleKey<C>;
  readonly body: CgBodyKey<C>;
  readonly recovery: CgRecovery;
  readonly retry: CgRetry;
  readonly telemetry: CgTelemetryClass;
  readonly settings?: { readonly section: SettingsSection; readonly code: C };
  readonly retired?: { readonly at: string; readonly reason: string };
}

interface Spec {
  readonly kind: CgFanslyKind;
  readonly severity: CgSeverity;
  readonly recovery: CgRecovery;
  readonly retry: CgRetry;
  readonly telemetry: CgTelemetryClass;
  readonly settings?: SettingsSection;
  readonly retired?: { readonly at: string; readonly reason: string };
}

const SPECS = {
  // ── session, API, relay ──
  'CG-FAN-OFF': { kind: 'fansly', severity: 'info', recovery: 'open-settings', retry: 'none', telemetry: 'count', settings: 'status' },
  'CG-FAN-SESSION': { kind: 'fansly', severity: 'warn', recovery: 'retry', retry: 'new-click', telemetry: 'count', settings: 'status' },
  'CG-FAN-EXPIRED': { kind: 'fansly', severity: 'warn', recovery: 'reload-tab', retry: 'new-click', telemetry: 'count', settings: 'status' },
  'CG-FAN-REQUEST': { kind: 'fansly', severity: 'error', recovery: 'retry', retry: 'new-click', telemetry: 'count+sample' },
  'CG-FAN-RATE-LIMIT': { kind: 'fansly', severity: 'warn', recovery: 'wait-until', retry: 'after-deadline', telemetry: 'count', settings: 'status' },
  'CG-FAN-TAB': { kind: 'fansly', severity: 'warn', recovery: 'reload-tab', retry: 'new-click', telemetry: 'count', settings: 'status' },
  'CG-FAN-GROUP': { kind: 'fansly', severity: 'warn', recovery: 'retry', retry: 'new-click', telemetry: 'count' },
  // 2026-10-21 (audit №9; the old extension's CG-NET-01): our direct request got no answer — where Fansly opens only
  // through a VPN or proxy, «Fansly через вкладку» (Аккаунты → Fansly) is the way.
  'CG-FAN-NETWORK': { kind: 'fansly', severity: 'warn', recovery: 'retry', retry: 'new-click', telemetry: 'count', settings: 'accounts' },
  // ── «Заметки» ──
  'CG-NOTE-READ': { kind: 'note', severity: 'warn', recovery: 'retry', retry: 'safe-read', telemetry: 'count' },
  'CG-NOTE-WRITE': { kind: 'note', severity: 'error', recovery: 'retry', retry: 'new-click', telemetry: 'count' },
  'CG-NOTE-UNCERTAIN': { kind: 'note', severity: 'warn', recovery: 'retry', retry: 'safe-read', telemetry: 'count+sample' },
  'CG-NOTE-TOO-LONG': { kind: 'note', severity: 'warn', recovery: 'none', retry: 'none', telemetry: 'count' },
  // ── vault ──
  'CG-VAULT-NO-ALBUM': { kind: 'vault', severity: 'info', recovery: 'none', retry: 'none', telemetry: 'count' },
  'CG-VAULT-UPLOAD': { kind: 'vault', severity: 'error', recovery: 'retry', retry: 'new-click', telemetry: 'count' },
  'CG-VAULT-UNCERTAIN': { kind: 'vault', severity: 'warn', recovery: 'none', retry: 'new-click', telemetry: 'count+sample' },
  'CG-VAULT-STOPPED': { kind: 'vault', severity: 'warn', recovery: 'retry', retry: 'new-click', telemetry: 'count' },
  // ── «Новые» of Fansly (Б17) ──
  'CG-FNEW-PARTIAL': { kind: 'newcomers', severity: 'warn', recovery: 'retry', retry: 'new-click', telemetry: 'count' },
  'CG-FNEW-ACCOUNT': { kind: 'newcomers', severity: 'warn', recovery: 'retry', retry: 'new-click', telemetry: 'count+sample' },
  'CG-FNEW-DM-CLOSED': { kind: 'newcomers', severity: 'info', recovery: 'none', retry: 'none', telemetry: 'count' },
  'CG-FNEW-HISTORY': { kind: 'newcomers', severity: 'warn', recovery: 'none', retry: 'new-click', telemetry: 'count' },
  'CG-FNEW-UNVERIFIED': { kind: 'newcomers', severity: 'info', recovery: 'retry', retry: 'new-click', telemetry: 'count' },
} as const satisfies Record<CgFanslyCode, Spec>;

function toEntry<C extends CgFanslyCode>(code: C, spec: Spec): CgFanslyEntry<C> {
  return {
    code,
    kind: spec.kind,
    severity: spec.severity,
    title: cgTitleKey(code),
    body: cgBodyKey(code),
    recovery: spec.recovery,
    retry: spec.retry,
    telemetry: spec.telemetry,
    ...(spec.settings === undefined ? {} : { settings: { section: spec.settings, code } }),
    ...(spec.retired === undefined ? {} : { retired: spec.retired }),
  };
}

/** Every Fansly code's entry, keyed by code; iteration order is Appendix A order. */
export const CG_FANSLY_REGISTRY = Object.fromEntries(CG_FANSLY_CODES.map((code) => [code, toEntry(code, SPECS[code])])) as {
  readonly [C in CgFanslyCode]: CgFanslyEntry<C>;
};

export function cgFanslyEntry<C extends CgFanslyCode>(code: C): CgFanslyEntry<C> {
  return CG_FANSLY_REGISTRY[code];
}

/** Codes removed after release; kept as entries so a name is never reused. None yet. */
export const CG_FANSLY_RETIRED_CODES: readonly CgFanslyCode[] = CG_FANSLY_CODES.filter((code) => CG_FANSLY_REGISTRY[code].retired !== undefined);

// ── Texts ────────────────────────────────────────────────────────────────────

/** The i18n keys of the Fansly codes: a title and a body each, in Appendix A order (the Fansly catalogs carry exactly these). */
export type CgFanslyI18nKey = CgTitleKey<CgFanslyCode> | CgBodyKey<CgFanslyCode>;
export const CG_FANSLY_I18N_KEYS: readonly CgFanslyI18nKey[] = CG_FANSLY_CODES.flatMap((code) => [cgTitleKey(code), cgBodyKey(code)]);

/** A Fansly catalog of one locale: plain texts without parameters (an error crosses runtimes as code and facts). */
export type CgFanslyCatalog = { readonly [K in CgFanslyI18nKey]: string };
