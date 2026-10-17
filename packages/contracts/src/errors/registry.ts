// The CG registry (architecture.md §5.7, §9.5, Appendix A): one entry per
// code — kind, severity, i18n title and body, recovery, retry, telemetry
// class and the settings section an error deep-links to. `retry` follows
// Appendix A's «Повтор» column (a test reads the column); `p1` marks the
// codes whose Appendix A meaning carries «(P1)». docs/error-registry.md is
// generated from this file and the `ru` catalog (tools/cg-registry).
//
// A code and its meaning never change after the first release: a removed
// code keeps its entry with `retired` set. None is retired yet.

import { CG_CODES, type CgCode, type CgEntry, type CgKind, type CgRecovery, type CgRetry, type CgSeverity, type CgTelemetryClass, type SettingsSection } from '../errors';
import { cgBodyKey, cgTitleKey, type CgBodyKey, type CgTitleKey } from '../i18n/keys';

/** Appendix A «Повтор» column word for each retry rule. */
export const CG_RETRY_APPENDIX_A: Readonly<Record<CgRetry, string>> = {
  'safe-read': 'чтение',
  'new-click': 'клик',
  'after-deadline': 'срок',
  never: 'никогда',
  none: '—',
};

interface CgSpec {
  readonly kind: CgKind;
  readonly severity: CgSeverity;
  readonly recovery: CgRecovery;
  readonly retry: CgRetry;
  readonly telemetry: CgTelemetryClass;
  /** Options-page section the error card's «Настройки» opens (`options.html#<section>:<CODE>`, ST-007…ST-010). */
  readonly settings?: SettingsSection;
  readonly retired?: { readonly at: string; readonly reason: string };
}

const SPECS = {
  'CG-LOGIN-CREDENTIALS': { kind: 'auth', severity: 'error', recovery: 'sign-in', retry: 'new-click', telemetry: 'count', settings: 'account' },
  'CG-LOGIN-RATE-LIMIT': { kind: 'auth', severity: 'warn', recovery: 'wait-until', retry: 'after-deadline', telemetry: 'count', settings: 'account' },
  'CG-LOGIN-UNAVAILABLE': { kind: 'auth', severity: 'error', recovery: 'retry', retry: 'new-click', telemetry: 'count', settings: 'account' },
  'CG-LOGIN-TIMEOUT': { kind: 'auth', severity: 'error', recovery: 'retry', retry: 'new-click', telemetry: 'count', settings: 'account' },
  'CG-LOGIN-PENDING': { kind: 'auth', severity: 'info', recovery: 'none', retry: 'none', telemetry: 'count', settings: 'account' },
  'CG-LOGIN-INCOMPLETE': { kind: 'auth', severity: 'warn', recovery: 'retry', retry: 'safe-read', telemetry: 'count+sample', settings: 'account' },
  'CG-AUTH-REQUIRED': { kind: 'auth', severity: 'info', recovery: 'sign-in', retry: 'none', telemetry: 'count', settings: 'account' },
  'CG-AUTH-REVOKED': { kind: 'auth', severity: 'warn', recovery: 'sign-in', retry: 'none', telemetry: 'count', settings: 'account' },
  'CG-AUTH-EXPIRED': { kind: 'auth', severity: 'warn', recovery: 'sign-in', retry: 'none', telemetry: 'count', settings: 'account' },
  'CG-AUTH-REJECTED': { kind: 'auth', severity: 'error', recovery: 'retry', retry: 'new-click', telemetry: 'count+sample', settings: 'account' },
  'CG-HUB-URL': { kind: 'hub', severity: 'error', recovery: 'open-settings', retry: 'none', telemetry: 'count', settings: 'account' },
  'CG-HUB-HOST-PERMISSION': { kind: 'hub', severity: 'error', recovery: 'open-settings', retry: 'none', telemetry: 'count', settings: 'account' },
  'CG-HUB-UNAVAILABLE': { kind: 'hub', severity: 'error', recovery: 'retry', retry: 'safe-read', telemetry: 'count', settings: 'status' },
  'CG-HUB-OUTDATED': { kind: 'hub', severity: 'error', recovery: 'update-extension', retry: 'none', telemetry: 'count', settings: 'status' },
  'CG-HUB-REQUEST': { kind: 'hub', severity: 'error', recovery: 'contact-owner', retry: 'none', telemetry: 'count+sample' },
  'CG-HUB-FORBIDDEN': { kind: 'hub', severity: 'error', recovery: 'contact-owner', retry: 'none', telemetry: 'count', settings: 'account' },
  'CG-HUB-RATE-LIMIT': { kind: 'hub', severity: 'warn', recovery: 'wait-until', retry: 'after-deadline', telemetry: 'count' },
  'CG-HUB-TIMEOUT': { kind: 'hub', severity: 'error', recovery: 'retry', retry: 'safe-read', telemetry: 'count', settings: 'status' },
  'CG-HUB-CAPABILITY': { kind: 'hub', severity: 'warn', recovery: 'contact-owner', retry: 'none', telemetry: 'count', settings: 'status' },
  'CG-HUB-UNKNOWN': { kind: 'hub', severity: 'error', recovery: 'contact-owner', retry: 'none', telemetry: 'count+sample' },
  'CG-BINDING-MISSING': { kind: 'page', severity: 'warn', recovery: 'contact-owner', retry: 'none', telemetry: 'count', settings: 'accounts' },
  'CG-BINDING-AMBIGUOUS': { kind: 'page', severity: 'error', recovery: 'contact-owner', retry: 'none', telemetry: 'count+sample', settings: 'accounts' },
  'CG-BINDING-NOT-GRANTED': { kind: 'page', severity: 'warn', recovery: 'contact-owner', retry: 'none', telemetry: 'count', settings: 'accounts' },
  'CG-PERSONA-NONE': { kind: 'page', severity: 'warn', recovery: 'contact-owner', retry: 'none', telemetry: 'count', settings: 'personas' },
  'CG-PERSONA-UNASSIGNED': { kind: 'page', severity: 'warn', recovery: 'open-settings', retry: 'none', telemetry: 'count', settings: 'personas' },
  'CG-PERSONA-UNAVAILABLE': { kind: 'page', severity: 'warn', recovery: 'open-settings', retry: 'none', telemetry: 'count', settings: 'personas' },
  'CG-PERSONA-CHANGED': { kind: 'page', severity: 'info', recovery: 'new-generation', retry: 'new-click', telemetry: 'count' },
  'CG-FEATURE-DISABLED': { kind: 'page', severity: 'info', recovery: 'none', retry: 'none', telemetry: 'count', settings: 'status' },
  'CG-CONTEXT-CHANGED': { kind: 'context', severity: 'info', recovery: 'new-generation', retry: 'new-click', telemetry: 'count' },
  'CG-CONTEXT-CONFLICT': { kind: 'context', severity: 'warn', recovery: 'new-generation', retry: 'new-click', telemetry: 'count' },
  'CG-QUOTA-DAILY': { kind: 'quota', severity: 'warn', recovery: 'wait-until', retry: 'after-deadline', telemetry: 'count', settings: 'status' },
  'CG-GATE-DRAFT': { kind: 'gate', severity: 'info', recovery: 'none', retry: 'none', telemetry: 'count' },
  'CG-GATE-HISTORY': { kind: 'gate', severity: 'info', recovery: 'none', retry: 'none', telemetry: 'count' },
  'CG-GATE-HI': { kind: 'gate', severity: 'info', recovery: 'none', retry: 'none', telemetry: 'count' },
  'CG-GATE-PING': { kind: 'gate', severity: 'info', recovery: 'none', retry: 'none', telemetry: 'count' },
  'CG-GATE-LANGUAGE': { kind: 'gate', severity: 'info', recovery: 'none', retry: 'none', telemetry: 'count' },
  'CG-GATE-FAN-BLOCKED': { kind: 'gate', severity: 'info', recovery: 'none', retry: 'none', telemetry: 'count' },
  'CG-GATE-FAN-UNKNOWN': { kind: 'gate', severity: 'warn', recovery: 'open-chat', retry: 'none', telemetry: 'count+sample' },
  'CG-GATE-CHAT-LOADING': { kind: 'gate', severity: 'info', recovery: 'none', retry: 'none', telemetry: 'count' },
  'CG-GATE-OVERLAY': { kind: 'gate', severity: 'info', recovery: 'none', retry: 'none', telemetry: 'count' },
  'CG-OP-CHAT-BUSY': { kind: 'op', severity: 'info', recovery: 'none', retry: 'none', telemetry: 'count' },
  'CG-OP-TAB-LIMIT': { kind: 'op', severity: 'info', recovery: 'none', retry: 'none', telemetry: 'count' },
  'CG-OP-COACH-BUSY': { kind: 'op', severity: 'info', recovery: 'none', retry: 'none', telemetry: 'count' },
  'CG-OP-INTERRUPTED': { kind: 'op', severity: 'warn', recovery: 'new-generation', retry: 'new-click', telemetry: 'count' },
  'CG-PROVIDER-BILLING': { kind: 'provider', severity: 'error', recovery: 'contact-owner', retry: 'never', telemetry: 'count', settings: 'status' },
  'CG-PROVIDER-AUTH': { kind: 'provider', severity: 'error', recovery: 'contact-owner', retry: 'never', telemetry: 'count', settings: 'status' },
  'CG-PROVIDER-RATE-LIMIT': { kind: 'provider', severity: 'warn', recovery: 'wait-until', retry: 'after-deadline', telemetry: 'count' },
  'CG-PROVIDER-UNAVAILABLE': { kind: 'provider', severity: 'error', recovery: 'new-generation', retry: 'new-click', telemetry: 'count' },
  'CG-PROVIDER-PROXY': { kind: 'provider', severity: 'error', recovery: 'contact-owner', retry: 'never', telemetry: 'count', settings: 'status' },
  'CG-PROVIDER-STREAM': { kind: 'provider', severity: 'error', recovery: 'new-generation', retry: 'new-click', telemetry: 'count' },
  'CG-PROVIDER-USAGE-MISSING': { kind: 'provider', severity: 'error', recovery: 'new-generation', retry: 'new-click', telemetry: 'count+sample' },
  'CG-PROVIDER-INCOMPLETE': { kind: 'provider', severity: 'error', recovery: 'new-generation', retry: 'new-click', telemetry: 'count+sample' },
  'CG-PROVIDER-UNKNOWN': { kind: 'provider', severity: 'error', recovery: 'new-generation', retry: 'new-click', telemetry: 'count+sample' },
  'CG-PROVIDER-EMPTY': { kind: 'provider', severity: 'warn', recovery: 'new-generation', retry: 'new-click', telemetry: 'count' },
  'CG-OUTPUT-UNUSABLE': { kind: 'output', severity: 'error', recovery: 'new-generation', retry: 'new-click', telemetry: 'count+sample' },
  'CG-OUTPUT-COACH-LIMIT': { kind: 'output', severity: 'warn', recovery: 'new-generation', retry: 'new-click', telemetry: 'count' },
  'CG-STREAM-TRUNCATED': { kind: 'output', severity: 'error', recovery: 'new-generation', retry: 'new-click', telemetry: 'count+sample' },
  'CG-RECAP-NOT-FOUND': { kind: 'recap', severity: 'info', recovery: 'none', retry: 'none', telemetry: 'count' },
  'CG-RECAP-SAVE': { kind: 'recap', severity: 'warn', recovery: 'retry', retry: 'safe-read', telemetry: 'count+sample' },
  'CG-DATA-UNAVAILABLE': { kind: 'data', severity: 'error', recovery: 'retry', retry: 'safe-read', telemetry: 'count' },
  'CG-DATA-NOT-READY': { kind: 'data', severity: 'info', recovery: 'retry', retry: 'safe-read', telemetry: 'count' },
  'CG-DATA-PARTIAL': { kind: 'data', severity: 'info', recovery: 'none', retry: 'none', telemetry: 'count' },
  'CG-DATA-TIMEOUT': { kind: 'data', severity: 'warn', recovery: 'retry', retry: 'safe-read', telemetry: 'count' },
  'CG-HOST-NOT-READY': { kind: 'host', severity: 'info', recovery: 'none', retry: 'none', telemetry: 'count' },
  'CG-HOST-CONTRACT': { kind: 'host', severity: 'warn', recovery: 'none', retry: 'none', telemetry: 'count+sample', settings: 'status' },
  'CG-HOST-COMPOSER-MISSING': { kind: 'host', severity: 'warn', recovery: 'none', retry: 'none', telemetry: 'count+sample' },
  // 1.28.0 (X53): a read of the vault from the host's API failed; the page has no session token for it.
  'CG-HOST-MEDIA': { kind: 'host', severity: 'warn', recovery: 'retry', retry: 'safe-read', telemetry: 'count' },
  'CG-HOST-SESSION': { kind: 'host', severity: 'warn', recovery: 'reload-tab', retry: 'none', telemetry: 'count' },
  'CG-RUNTIME-RELOADED': { kind: 'host', severity: 'warn', recovery: 'reload-tab', retry: 'none', telemetry: 'count' },
  'CG-INSERT-CHAT-CHANGED': { kind: 'insert', severity: 'warn', recovery: 'retry', retry: 'new-click', telemetry: 'count' },
  'CG-INSERT-FAILED': { kind: 'insert', severity: 'error', recovery: 'retry', retry: 'new-click', telemetry: 'count+sample' },
  'CG-INSERT-UNCERTAIN': { kind: 'insert', severity: 'warn', recovery: 'none', retry: 'never', telemetry: 'count+sample' },
  'CG-INSERT-MISPLACED': { kind: 'insert', severity: 'error', recovery: 'none', retry: 'never', telemetry: 'p1' },
  'CG-INSERT-CANCELED': { kind: 'insert', severity: 'info', recovery: 'none', retry: 'none', telemetry: 'count' },
  'CG-DRAFT-CHANGED': { kind: 'insert', severity: 'warn', recovery: 'none', retry: 'none', telemetry: 'count' },
  'CG-NAV-FAILED': { kind: 'nav', severity: 'error', recovery: 'retry', retry: 'new-click', telemetry: 'count' },
  'CG-NAV-TIMEOUT': { kind: 'nav', severity: 'warn', recovery: 'retry', retry: 'new-click', telemetry: 'count+sample' },
  'CG-CLIPBOARD': { kind: 'insert', severity: 'error', recovery: 'retry', retry: 'new-click', telemetry: 'count' },
  'CG-CLAIM-BUSY': { kind: 'claim', severity: 'info', recovery: 'none', retry: 'none', telemetry: 'count' },
  'CG-CLAIM-EXPIRED': { kind: 'claim', severity: 'warn', recovery: 'retry', retry: 'new-click', telemetry: 'count' },
  'CG-CLAIM-ROW-CHANGED': { kind: 'claim', severity: 'warn', recovery: 'none', retry: 'none', telemetry: 'count' },
  'CG-CLAIM-ROW-BUSY': { kind: 'claim', severity: 'info', recovery: 'none', retry: 'none', telemetry: 'count' },
  'CG-SEND-OFF': { kind: 'send', severity: 'info', recovery: 'none', retry: 'none', telemetry: 'count', settings: 'status' },
  'CG-SEND-HOST': { kind: 'send', severity: 'warn', recovery: 'none', retry: 'none', telemetry: 'count+sample', settings: 'status' },
  'CG-SEND-RECEIPT': { kind: 'send', severity: 'warn', recovery: 'none', retry: 'none', telemetry: 'count+sample', settings: 'status' },
  'CG-SEND-FUSE': { kind: 'send', severity: 'warn', recovery: 'open-settings', retry: 'none', telemetry: 'count+sample', settings: 'status' },
  'CG-SEND-ACTIVE-CHAT': { kind: 'send', severity: 'info', recovery: 'none', retry: 'none', telemetry: 'count' },
  'CG-SEND-HISTORY': { kind: 'send', severity: 'info', recovery: 'open-chat', retry: 'none', telemetry: 'count' },
  'CG-SEND-PERMISSION': { kind: 'send', severity: 'warn', recovery: 'contact-owner', retry: 'none', telemetry: 'count' },
  'CG-SEND-FAN': { kind: 'send', severity: 'info', recovery: 'none', retry: 'none', telemetry: 'count' },
  'CG-SEND-MIMIC': { kind: 'send', severity: 'info', recovery: 'none', retry: 'none', telemetry: 'count' },
  'CG-SEND-TRANSLATOR': { kind: 'send', severity: 'info', recovery: 'none', retry: 'none', telemetry: 'count' },
  'CG-SEND-STALE': { kind: 'send', severity: 'warn', recovery: 'new-generation', retry: 'new-click', telemetry: 'count' },
  'CG-SEND-FRESHNESS': { kind: 'send', severity: 'warn', recovery: 'none', retry: 'none', telemetry: 'count+sample' },
  'CG-SEND-BUSY': { kind: 'send', severity: 'info', recovery: 'none', retry: 'none', telemetry: 'count' },
  'CG-SEND-QUEUE': { kind: 'send', severity: 'warn', recovery: 'retry', retry: 'new-click', telemetry: 'count' },
  'CG-SEND-PART': { kind: 'send', severity: 'warn', recovery: 'new-generation', retry: 'none', telemetry: 'count' },
  'CG-SEND-GUARD': { kind: 'send', severity: 'warn', recovery: 'none', retry: 'none', telemetry: 'count' },
  'CG-SEND-REJECTED': { kind: 'send', severity: 'error', recovery: 'none', retry: 'none', telemetry: 'count+sample' },
  'CG-SEND-UNCERTAIN': { kind: 'send', severity: 'error', recovery: 'open-chat', retry: 'never', telemetry: 'count+sample' },
  /** 1.28.0 (X53): the picked media cannot go yet — the price, a message of free previews only, the release forms. */
  'CG-SEND-MEDIA': { kind: 'send', severity: 'info', recovery: 'none', retry: 'none', telemetry: 'count' },
  'CG-NETWORK': { kind: 'network', severity: 'error', recovery: 'retry', retry: 'safe-read', telemetry: 'count' },
  'CG-TIMEOUT': { kind: 'network', severity: 'error', recovery: 'retry', retry: 'safe-read', telemetry: 'count' },
  'CG-STORAGE-READ': { kind: 'storage', severity: 'error', recovery: 'retry', retry: 'safe-read', telemetry: 'count+sample', settings: 'diagnostics' },
  'CG-STORAGE-WRITE': { kind: 'storage', severity: 'error', recovery: 'retry', retry: 'new-click', telemetry: 'count+sample', settings: 'diagnostics' },
  'CG-STORAGE-VERSION': { kind: 'storage', severity: 'warn', recovery: 'update-extension', retry: 'none', telemetry: 'count', settings: 'diagnostics' },
  'CG-STORAGE-FULL': { kind: 'storage', severity: 'error', recovery: 'open-settings', retry: 'none', telemetry: 'count', settings: 'diagnostics' },
  'CG-AUDIO-BLOCKED': { kind: 'system', severity: 'info', recovery: 'retry', retry: 'new-click', telemetry: 'count', settings: 'appearance' },
  'CG-UI-FAILED': { kind: 'system', severity: 'error', recovery: 'retry', retry: 'new-click', telemetry: 'count+sample', settings: 'diagnostics' },
  'CG-RUNTIME-UNREACHABLE': { kind: 'system', severity: 'error', recovery: 'reload-tab', retry: 'new-click', telemetry: 'count' },
  'CG-UNKNOWN': { kind: 'system', severity: 'error', recovery: 'contact-owner', retry: 'none', telemetry: 'count+sample', settings: 'diagnostics' },
} as const satisfies Record<CgCode, CgSpec>;

/** A registry entry with its text keys pinned to its code. */
export interface CgRegistryEntry<C extends CgCode = CgCode> extends CgEntry {
  readonly code: C;
  readonly kind: CgKind;
  readonly title: CgTitleKey<C>;
  readonly body: CgBodyKey<C>;
}

function toEntry<C extends CgCode>(code: C, spec: CgSpec): CgRegistryEntry<C> {
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

/** Every code's entry, keyed by code; iteration order is Appendix A order. */
export const CG_REGISTRY = Object.fromEntries(CG_CODES.map((code) => [code, toEntry(code, SPECS[code])])) as {
  readonly [C in CgCode]: CgRegistryEntry<C>;
};

export function cgEntry<C extends CgCode>(code: C): CgRegistryEntry<C> {
  return CG_REGISTRY[code];
}

/** Codes counted as P1 incidents (§0.4, §9.6): an exact proof of an insert into another chat. */
export const CG_P1_CODES: readonly CgCode[] = CG_CODES.filter((code) => CG_REGISTRY[code].telemetry === 'p1');

/** Codes removed after release; kept as entries so a number is never reused. */
export const CG_RETIRED_CODES: readonly CgCode[] = CG_CODES.filter((code) => CG_REGISTRY[code].retired !== undefined);
