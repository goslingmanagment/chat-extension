// Errors as they cross runtimes and as the person sees them (architecture.md
// §5.7, §9.5, Appendix A; ER-001…ER-008). The registry is the single source:
// an error travels as `CgErrorWire` (code and facts only) and every receiver
// renders it into a `CgErrorView` in its current language. An error stored by
// an older build or with an unknown code is rendered by the CURRENT registry
// (ER-005); an unknown code is CG-UNKNOWN, never a raw string. Server texts
// are never markup and never parsed; the technical line is plain text of at
// most 400 characters, scrubbed like a log line.

import {
  CG_DETAIL_MAX_CHARS,
  CgErrorWireSchema,
  SETTINGS_SECTIONS,
  isCgCode,
  type CgCode,
  type CgErrorView,
  type CgErrorWire,
  type SettingsRoute,
  type SettingsSection,
} from '@cg/contracts/errors';
import { CG_REGISTRY, type CgRegistryEntry } from '@cg/contracts/errors/registry';

import { type Translator } from '../i18n';
import { scrubText, truncateText } from '../logging/redact';

export const UNKNOWN_CODE = 'CG-UNKNOWN' as const satisfies CgCode;

/** ER-001: the registry entry of a code. */
export function entryOf<C extends CgCode>(code: C): CgRegistryEntry<C> {
  return CG_REGISTRY[code];
}

/** Anything that is not a known code becomes CG-UNKNOWN (ER-005). */
export function normalizeCode(value: unknown): CgCode {
  return isCgCode(value) ? value : UNKNOWN_CODE;
}

/** ER-004: the first CG code named in a text (a pasted report, a toast). */
export function codeInText(text: string): CgCode | null {
  for (const match of text.matchAll(/\bCG(?:-[A-Z0-9]+)+\b/g)) {
    if (isCgCode(match[0])) return match[0];
  }
  return null;
}

/**
 * ER-007: «HTTP 429 • quota_denied • resetsAt=…» — parts joined by « • »,
 * control characters flattened, secrets and URL parameters scrubbed, at most
 * 400 characters. Undefined when nothing is left.
 */
export function technicalDetail(parts: readonly (string | number | null | undefined | false)[]): string | undefined {
  const words = parts
    .filter((part): part is string | number => part !== null && part !== undefined && part !== false && part !== '')
    .map((part) => String(part).replace(/[\p{Cc}\u2028\u2029]+/gu, ' ').replace(/\s+/g, ' ').trim())
    .filter((part) => part.length > 0);
  if (words.length === 0) return undefined;
  return truncateText(scrubText(words.join(' • ')), CG_DETAIL_MAX_CHARS);
}

export interface ErrorFacts {
  readonly detail?: string;
  /** Absolute deadline, epoch ms, fixed once (ER-006). */
  readonly retryAt?: number | null;
  readonly httpStatus?: number | null;
}

/** An error on the wire: the code and checked facts only. */
export function cgError(code: CgCode, facts: ErrorFacts = {}): CgErrorWire {
  const wire: { -readonly [K in keyof CgErrorWire]: CgErrorWire[K] } = { code };
  const detail = facts.detail === undefined ? undefined : technicalDetail([facts.detail]);
  if (detail !== undefined) wire.detail = detail;
  if (typeof facts.retryAt === 'number' && Number.isFinite(facts.retryAt) && facts.retryAt >= 0) wire.retryAt = Math.round(facts.retryAt);
  if (typeof facts.httpStatus === 'number' && Number.isInteger(facts.httpStatus) && facts.httpStatus >= 100 && facts.httpStatus <= 599) {
    wire.httpStatus = facts.httpStatus;
  }
  return wire;
}

/**
 * ER-005: whatever is stored or received, a wire the current registry can
 * render. A valid wire passes; a known code with broken facts keeps the code
 * and the facts that check; anything else is CG-UNKNOWN.
 */
export function readWire(value: unknown): CgErrorWire {
  const parsed = CgErrorWireSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  if (value === null || typeof value !== 'object') return { code: UNKNOWN_CODE };
  const record = value as Record<string, unknown>;
  const facts: { -readonly [K in keyof ErrorFacts]: ErrorFacts[K] } = {};
  if (typeof record['detail'] === 'string') facts.detail = record['detail'];
  if (typeof record['retryAt'] === 'number') facts.retryAt = record['retryAt'];
  if (typeof record['httpStatus'] === 'number') facts.httpStatus = record['httpStatus'];
  return cgError(normalizeCode(record['code']), facts);
}

/** Whether the code's countdown matters: a deadline to wait for (ER-006). */
export function usesDeadline(code: CgCode): boolean {
  const entry = CG_REGISTRY[code];
  return entry.retry === 'after-deadline' || entry.recovery === 'wait-until';
}

/** The technical line of a wire: the HTTP status leads unless the detail already starts with it. */
export function detailLine(wire: CgErrorWire): string | undefined {
  const status = wire.httpStatus === undefined ? undefined : `HTTP ${wire.httpStatus}`;
  if (wire.detail === undefined) return status;
  if (status === undefined || wire.detail.startsWith(status)) return technicalDetail([wire.detail]);
  return technicalDetail([status, wire.detail]);
}

/**
 * ER-005…ER-008: the card in the current language — «КОД: заголовок», the
 * explanation, the technical line, the fixed deadline (only for codes that
 * wait), and the settings section the card deep-links to.
 */
export function errorView(wire: CgErrorWire, t: Translator): CgErrorView {
  const code = normalizeCode(wire.code);
  const entry = CG_REGISTRY[code];
  const view: { -readonly [K in keyof CgErrorView]: CgErrorView[K] } = {
    code,
    title: t.text(entry.title),
    body: t.text(entry.body),
  };
  const detail = detailLine(wire);
  if (detail !== undefined) view.detail = detail;
  if (wire.retryAt !== undefined && usesDeadline(code)) view.retryAt = wire.retryAt;
  if (entry.settings !== undefined) view.settings = entry.settings;
  return view;
}

/** Straight from a code (a gate, a local refusal). */
export function viewOfCode(code: CgCode, t: Translator, facts: ErrorFacts = {}): CgErrorView {
  return errorView(cgError(code, facts), t);
}

/** «ChatGoose · CG-QUOTA-DAILY» — whose error it is, line 1 of the card (ui-design §4.8). */
export function errorSourceLine(code: CgCode, t: Translator): string {
  return t.text('common.errorSource', { code });
}

/** «КОД: заголовок» (ER-005), for toasts, reports and «Скопировать код». */
export function codeAndTitle(view: Pick<CgErrorView, 'code' | 'title'>): string {
  return `${view.code}: ${view.title}`;
}

// ── Settings deep links (ST-007…ST-010) ────────────────────────────────────

/** `options.html#<section>:<CODE>`. */
export function settingsHref(route: SettingsRoute): string {
  return `options.html#${route.section}${route.code === undefined ? '' : `:${route.code}`}`;
}

function isSection(value: string): value is SettingsSection {
  return (SETTINGS_SECTIONS as readonly string[]).includes(value);
}

/** Reads `#status:CG-HUB-URL`, `#account` or a full href; null for anything else. */
export function parseSettingsHash(hash: string): SettingsRoute | null {
  const fragment = hash.includes('#') ? hash.slice(hash.indexOf('#') + 1) : hash;
  const [section, code, extra] = fragment.split(':');
  if (section === undefined || extra !== undefined || !isSection(section)) return null;
  if (code === undefined || code === '') return { section };
  return isCgCode(code) ? { section, code } : null;
}

/** The deep link of a code: its registry section, or none. */
export function settingsRouteOf(code: CgCode): SettingsRoute | null {
  return CG_REGISTRY[code].settings ?? null;
}
