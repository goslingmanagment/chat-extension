import { CG_CODES, CG_CODE_PATTERN, CgErrorViewSchema, type CgCode, type CgRecovery, type CgRetry, type SettingsSection } from '@cg/contracts/errors';
import { CG_REGISTRY, CG_RETIRED_CODES } from '@cg/contracts/errors/registry';
import { HUB_CLIENT_CHECK_CODES, HUB_HTTP_ERROR_RULES, HUB_SSE_ERROR_CODES, HUB_SSE_FALLBACKS, HUB_TRANSPORT_CODES } from '@cg/contracts/hub';
import { cgBodyKey, cgTitleKey } from '@cg/contracts/i18n/keys';
import { describe, expect, it } from 'vitest';

import { RU, createTranslator } from '../i18n';
import {
  COUNTDOWN_TICK_MS,
  LONG_TOASTS,
  TOAST_TIMING,
  cgError,
  codeAndTitle,
  codeInText,
  countdown,
  deadlineFrom,
  errorSourceLine,
  errorTone,
  errorView,
  formatCountdown,
  isP1,
  listViewState,
  mayRetryAutomatically,
  nextUtcMidnight,
  normalizeCode,
  parseSettingsHash,
  quotaCountdownText,
  readWire,
  recoveryActions,
  retryInText,
  retryVerdict,
  settingsHref,
  settingsRouteOf,
  technicalDetail,
  toastKey,
  toastKindOf,
  toastLifetimeMs,
  usesDeadline,
  viewOfCode,
} from './index';

const ru = createTranslator('ru');
const en = createTranslator('en');
const NOW = Date.UTC(2026, 9, 3, 6, 20, 1);
const CYRILLIC = /[А-Яа-яЁё]/;

/** First rule of the frozen hub table for a hub code with no route or fact narrowing (what R08's resolver reaches by default). */
function generalRule(error: string) {
  return HUB_HTTP_ERROR_RULES.find((rule) => rule.error === error && rule.routes === undefined && rule.when === undefined && rule.reason === undefined);
}
function signInRule(error: string | null, status?: number | '5xx') {
  return HUB_HTTP_ERROR_RULES.find((rule) => rule.error === error && rule.routes?.includes('sign-in') === true && (status === undefined || rule.status === status));
}

describe('[ER-001] the registry is the single source', () => {
  it('[ER-001] every code renders its registry title, body and settings link in both languages', () => {
    for (const code of CG_CODES) {
      for (const t of [ru, en]) {
        const view = viewOfCode(code, t);
        expect(view.title).toBe(t.text(cgTitleKey(code)));
        expect(view.body).toBe(t.text(cgBodyKey(code)));
        expect(view.settings).toEqual(CG_REGISTRY[code].settings);
        expect(CgErrorViewSchema.safeParse(view).success).toBe(true);
      }
    }
  });
});

describe('[ER-002] one registry for the new client', () => {
  it('[ER-002] no numeric codes of the old clients, every code readable without a lookup', () => {
    for (const code of CG_CODES) {
      expect(code).toMatch(CG_CODE_PATTERN);
      expect(code).not.toMatch(/^CG-(?:HUB|FLOW|NET|API|APP|FAN|UI)-\d+$/);
    }
    expect(normalizeCode('CG-HUB-09')).toBe('CG-UNKNOWN');
    expect(normalizeCode('CG-FLOW-02')).toBe('CG-UNKNOWN');
  });
});

describe('[ER-003] retired codes are never reused', () => {
  it('[ER-003] codes and their text keys are unique; retired entries keep their record', () => {
    expect(new Set(CG_CODES).size).toBe(CG_CODES.length);
    expect(new Set(CG_CODES.map((code) => cgTitleKey(code))).size).toBe(CG_CODES.length);
    for (const code of CG_RETIRED_CODES) {
      expect(CG_REGISTRY[code].retired?.reason.length).toBeGreaterThan(0);
      expect(viewOfCode(code, ru).title.length).toBeGreaterThan(0);
    }
  });
});

describe('[ER-004] key lookup by code', () => {
  it('[ER-004] text keys come from the code; a code is found in a pasted text', () => {
    expect(cgTitleKey('CG-HUB-HOST-PERMISSION')).toBe('cg.hubHostPermission.title');
    expect(codeInText('ChatGoose · CG-QUOTA-DAILY: Квота AI на сегодня')).toBe('CG-QUOTA-DAILY');
    expect(codeInText('legacy CG-HUB-09 then CG-NETWORK')).toBe('CG-NETWORK');
    expect(codeInText('nothing here')).toBeNull();
  });
});

describe('[ER-005] the error card', () => {
  it('[ER-005] «КОД: заголовок», the explanation and the technical line', () => {
    const view = errorView(cgError('CG-HUB-RATE-LIMIT', { httpStatus: 429, detail: 'rate_limit_exceeded', retryAt: NOW + 30_000 }), ru);
    expect(codeAndTitle(view)).toBe(`CG-HUB-RATE-LIMIT: ${RU['cg.hubRateLimit.title']}`);
    expect(view.body).toBe(RU['cg.hubRateLimit.body']);
    expect(view.detail).toBe('HTTP 429 • rate_limit_exceeded');
    expect(errorSourceLine('CG-HUB-RATE-LIMIT', ru)).toBe('ChatGoose · CG-HUB-RATE-LIMIT');
    expect(errorView(cgError('CG-HUB-REQUEST', { httpStatus: 400, detail: 'HTTP 400 • bad_request' }), ru).detail).toBe('HTTP 400 • bad_request');
    expect(errorView(cgError('CG-HUB-REQUEST', { httpStatus: 400 }), ru).detail).toBe('HTTP 400');
    expect(errorView({ code: 'CG-HUB-REQUEST' }, ru).detail).toBeUndefined();
  });

  it('[ER-005] an old or broken error is redrawn by the current registry', () => {
    expect(readWire({ code: 'CG-HUB-09', detail: 'old' })).toEqual({ code: 'CG-UNKNOWN', detail: 'old' });
    expect(readWire('CG-NETWORK')).toEqual({ code: 'CG-UNKNOWN' });
    expect(readWire(null)).toEqual({ code: 'CG-UNKNOWN' });
    expect(readWire({ code: 'CG-NETWORK', detail: 'x'.repeat(900), httpStatus: 42, retryAt: -5, extra: true })).toEqual({ code: 'CG-NETWORK', detail: expect.stringMatching(/…\[\+\d+\]$/) as unknown });
    expect(readWire({ code: 'CG-QUOTA-DAILY', retryAt: NOW })).toEqual({ code: 'CG-QUOTA-DAILY', retryAt: NOW });
    const view = errorView({ code: 'CG-NOT-A-CODE' as CgCode }, ru);
    expect(view.code).toBe('CG-UNKNOWN');
    expect(view.title).toBe(RU['cg.unknown.title']);
  });
});

describe('[ER-006] the retry deadline', () => {
  it('[ER-006] is kept only by codes that wait and counts down from the fixed moment', () => {
    expect(usesDeadline('CG-QUOTA-DAILY')).toBe(true);
    expect(usesDeadline('CG-NETWORK')).toBe(false);
    expect(errorView(cgError('CG-NETWORK', { retryAt: NOW + 5000 }), ru).retryAt).toBeUndefined();
    const deadline = deadlineFrom(NOW, 24_000);
    expect(deadline).toBe(NOW + 24_000);
    expect(deadlineFrom(NOW, null)).toBeNull();
    expect(deadlineFrom(NOW, -1)).toBeNull();
    const wire = cgError('CG-PROVIDER-RATE-LIMIT', { retryAt: deadline });
    // The same deadline gives the same text whenever it is recomputed: nothing is decremented.
    expect(retryInText(countdown(wire.retryAt ?? 0, NOW), ru)).toBe('через 24 с');
    expect(retryInText(countdown(wire.retryAt ?? 0, NOW + 10_400), ru)).toBe('через 14 с');
    expect(retryInText(countdown(wire.retryAt ?? 0, NOW + 24_000), ru)).toBeNull();
    expect(COUNTDOWN_TICK_MS).toBe(250);
  });

  it('[ER-006] retrying is manual only and waits for the deadline', () => {
    const wire = cgError('CG-PROVIDER-RATE-LIMIT', { retryAt: NOW + 24_000 });
    expect(retryVerdict(wire, NOW)).toEqual({ allowed: false, why: 'wait', at: NOW + 24_000 });
    expect(retryVerdict(wire, NOW + 24_000)).toEqual({ allowed: true, why: 'manual' });
    expect(retryVerdict(cgError('CG-PROVIDER-RATE-LIMIT'), NOW)).toEqual({ allowed: true, why: 'manual' });
    expect(retryVerdict(cgError('CG-SEND-UNCERTAIN'), NOW)).toEqual({ allowed: false, why: 'never' });
    expect(retryVerdict(cgError('CG-GATE-DRAFT'), NOW)).toEqual({ allowed: false, why: 'nothing' });
    expect(retryVerdict(cgError('CG-NETWORK'), NOW)).toEqual({ allowed: true, why: 'manual' });
    for (const code of CG_CODES) expect(mayRetryAutomatically(code)).toBe(false);
    const actions = recoveryActions(wire, NOW);
    expect(actions[0]).toEqual({ kind: 'retry', label: 'common.retry', enabled: false, availableAt: NOW + 24_000, settings: null });
    expect(recoveryActions(wire, NOW + 24_001)[0]?.enabled).toBe(true);
  });

  it('[ER-006] the countdown text cannot be taken for a time of day', () => {
    const at = NOW + (17 * 3600 + 39 * 60 + 12) * 1000;
    expect(formatCountdown(countdown(at, NOW), ru)).toBe('17 ч 39 мин');
    expect(formatCountdown(countdown(NOW + (39 * 60 + 12) * 1000, NOW), ru)).toBe('39 мин 12 с');
    expect(formatCountdown(countdown(NOW + 24_000, NOW), ru)).toBe('24 с');
    expect(formatCountdown(countdown(NOW + 24_000, NOW), en)).toBe('24 s');
    expect(formatCountdown(countdown(NOW, NOW), ru)).toBe('');
    expect(countdown(Number.NaN, NOW).expired).toBe(true);
  });

  it('[ER-006] the hour view changes once a minute, the minute view once a second', () => {
    const hours = countdown(NOW + 3 * 3600_000 + 59_500, NOW);
    expect(hours).toMatchObject({ style: 'hours', hours: 3, minutes: 1 });
    expect(hours.nextChangeMs).toBe(500);
    const next = countdown(NOW + 3 * 3600_000 + 59_500, NOW + hours.nextChangeMs);
    expect(next).toMatchObject({ hours: 3, minutes: 0 });
    expect(next.nextChangeMs).toBe(60_000);
    const minutes = countdown(NOW + 90_250, NOW);
    expect(minutes).toMatchObject({ style: 'minutes', minutes: 1, seconds: 31, nextChangeMs: 250 });
    expect(countdown(NOW + 2000, NOW)).toMatchObject({ style: 'seconds', totalSeconds: 2, nextChangeMs: 1000 });
  });
});

describe('[ER-007] the core’s explanation under the title', () => {
  it('[ER-007] one line, at most 400 characters, scrubbed of secrets and URL parameters', () => {
    const detail = technicalDetail(['HTTP 503', 'service_unavailable', `token=agency_hub_device_abcdef123 at https://h/x?fan=1\n\tnext`, 'y'.repeat(600)]);
    expect(detail?.length).toBeLessThanOrEqual(400);
    expect(detail).toContain('HTTP 503 • service_unavailable • token=[redacted]');
    expect(detail).toContain('https://h/x?[redacted] next');
    expect(detail).not.toMatch(/[\n\t]/);
    expect(technicalDetail([null, undefined, false, '', '   '])).toBeUndefined();
    expect(technicalDetail([429, 'quota_denied'])).toBe('429 • quota_denied');
  });
});

describe('[ER-008] error texts are Russian everywhere', () => {
  it('[ER-008] every code has a Russian title and body, no Fansly-only wording', () => {
    for (const code of CG_CODES) {
      const view = viewOfCode(code, ru);
      expect(view.title).toMatch(CYRILLIC);
      expect(view.body).toMatch(CYRILLIC);
      if (code !== 'CG-GATE-PING') expect(`${view.title} ${view.body}`).not.toMatch(/Fansly/);
      const english = viewOfCode(code, en);
      expect(english.title.length).toBeGreaterThan(0);
      expect(english.body.length).toBeGreaterThan(0);
    }
  });
});

describe('codes the hub and the core refuse with (the resolver is R08’s hub-map; the table is frozen in contracts)', () => {
  it('[ER-016] core refusals map to the gate codes', () => {
    expect(generalRule('gate_draft_required')?.cg).toBe('CG-GATE-DRAFT');
    expect(generalRule('gate_min_messages')?.cg).toBe('CG-GATE-HISTORY');
    expect(generalRule('gate_hi_greeting_limit')?.cg).toBe('CG-GATE-HI');
    expect(generalRule('gate_ping_active')?.cg).toBe('CG-GATE-PING');
    for (const code of ['CG-GATE-DRAFT', 'CG-GATE-HISTORY', 'CG-GATE-HI', 'CG-GATE-PING'] as const) {
      expect(retryVerdict(cgError(code), NOW).allowed).toBe(false);
      expect(errorTone(code)).toBe('state');
    }
  });

  it('[ER-017] hub and provider errors map to codes with the right retry rules', () => {
    expect(generalRule('rate_limit_exceeded')).toMatchObject({ cg: 'CG-HUB-RATE-LIMIT', retryAt: 'retry-after' });
    expect(generalRule('service_unavailable')?.cg).toBe('CG-HUB-UNAVAILABLE');
    expect(HUB_HTTP_ERROR_RULES.find((rule) => rule.error === null && rule.status === '5xx' && rule.routes === undefined)?.cg).toBe('CG-HUB-UNAVAILABLE');
    expect(generalRule('unauthorized')?.cg).toBe('CG-AUTH-REJECTED');
    expect(generalRule('forbidden')?.cg).toBe('CG-HUB-FORBIDDEN');
    expect(generalRule('unknown_ai_feature')?.cg).toBe('CG-HUB-CAPABILITY');
    expect(HUB_SSE_ERROR_CODES.provider_rate_limited).toBe('CG-PROVIDER-RATE-LIMIT');
    expect(HUB_SSE_FALLBACKS).toMatchObject({ provider: 'CG-PROVIDER-UNKNOWN', other: 'CG-HUB-UNKNOWN', truncated: 'CG-STREAM-TRUNCATED' });
    for (const code of Object.values(HUB_SSE_ERROR_CODES)) expect(CG_REGISTRY[code].kind === 'provider' || CG_REGISTRY[code].kind === 'output').toBe(true);
    expect(CG_REGISTRY['CG-HUB-RATE-LIMIT'].retry).toBe('after-deadline');
    expect(CG_REGISTRY['CG-HUB-UNAVAILABLE'].retry).toBe('safe-read');
  });

  it('[ER-018] sign-in errors map to the CG-LOGIN codes', () => {
    expect(signInRule('unauthorized')?.cg).toBe('CG-LOGIN-CREDENTIALS');
    expect(signInRule('rate_limit_exceeded')?.cg).toBe('CG-LOGIN-RATE-LIMIT');
    expect(signInRule(null, '5xx')?.cg).toBe('CG-LOGIN-UNAVAILABLE');
    expect(HUB_TRANSPORT_CODES.network['sign-in']).toBe('CG-LOGIN-UNAVAILABLE');
    expect(HUB_TRANSPORT_CODES.timeout['sign-in']).toBe('CG-LOGIN-TIMEOUT');
    expect(HUB_CLIENT_CHECK_CODES.signInIncomplete).toBe('CG-LOGIN-INCOMPLETE');
    expect(generalRule('forbidden')?.cg).toBe('CG-HUB-FORBIDDEN');
  });
});

describe('[ER-025] an error is not an empty list', () => {
  it('[ER-025] a failed read is `error`, an answered empty one `empty`', () => {
    expect(listViewState({ ok: false, error: cgError('CG-DATA-UNAVAILABLE') })).toBe('error');
    expect(listViewState({ ok: true, items: [] })).toBe('empty');
    expect(listViewState({ ok: true, items: [1] })).toBe('ready');
  });
});

interface CodeCase {
  readonly id: string;
  readonly code: CgCode;
  readonly recovery: CgRecovery;
  readonly retry: CgRetry;
  readonly section?: SettingsSection;
  readonly first?: string;
}

const CODE_CASES: readonly CodeCase[] = [
  { id: 'ER-030', code: 'CG-PERSONA-NONE', recovery: 'contact-owner', retry: 'none', section: 'personas', first: 'open-settings' },
  { id: 'ER-031', code: 'CG-PERSONA-UNASSIGNED', recovery: 'open-settings', retry: 'none', section: 'personas', first: 'open-settings' },
  { id: 'ER-032', code: 'CG-GATE-HISTORY', recovery: 'none', retry: 'none', first: 'copy-code' },
  { id: 'ER-033', code: 'CG-OP-CHAT-BUSY', recovery: 'none', retry: 'none', first: 'copy-code' },
  { id: 'ER-035', code: 'CG-CONTEXT-CHANGED', recovery: 'new-generation', retry: 'new-click', first: 'again' },
  { id: 'ER-036', code: 'CG-RUNTIME-RELOADED', recovery: 'reload-tab', retry: 'none', first: 'reload-tab' },
  { id: 'ER-038', code: 'CG-GATE-HI', recovery: 'none', retry: 'none' },
  { id: 'ER-039', code: 'CG-NETWORK', recovery: 'retry', retry: 'safe-read', first: 'retry' },
  { id: 'ER-040', code: 'CG-TIMEOUT', recovery: 'retry', retry: 'safe-read', first: 'retry' },
  { id: 'ER-041', code: 'CG-HUB-RATE-LIMIT', recovery: 'wait-until', retry: 'after-deadline', first: 'retry' },
  { id: 'ER-042', code: 'CG-HUB-UNAVAILABLE', recovery: 'retry', retry: 'safe-read', section: 'status', first: 'retry' },
  { id: 'ER-043', code: 'CG-OUTPUT-UNUSABLE', recovery: 'new-generation', retry: 'new-click', first: 'again' },
  { id: 'ER-044', code: 'CG-UNKNOWN', recovery: 'contact-owner', retry: 'none', section: 'diagnostics' },
  { id: 'ER-044', code: 'CG-GATE-DRAFT', recovery: 'none', retry: 'none' },
  { id: 'ER-045', code: 'CG-GATE-FAN-UNKNOWN', recovery: 'open-chat', retry: 'none', first: 'open-chat' },
  { id: 'ER-046', code: 'CG-RECAP-NOT-FOUND', recovery: 'none', retry: 'none' },
  { id: 'ER-047', code: 'CG-STORAGE-READ', recovery: 'retry', retry: 'safe-read', section: 'diagnostics', first: 'retry' },
  { id: 'ER-048', code: 'CG-HOST-NOT-READY', recovery: 'none', retry: 'none' },
  { id: 'ER-049', code: 'CG-HOST-CONTRACT', recovery: 'none', retry: 'none', section: 'status', first: 'open-settings' },
  { id: 'ER-052', code: 'CG-HUB-URL', recovery: 'open-settings', retry: 'none', section: 'account', first: 'open-settings' },
  { id: 'ER-053', code: 'CG-AUTH-REQUIRED', recovery: 'sign-in', retry: 'none', section: 'account', first: 'sign-in' },
  { id: 'ER-054', code: 'CG-AUTH-REJECTED', recovery: 'retry', retry: 'new-click', section: 'account', first: 'retry' },
  { id: 'ER-055', code: 'CG-HUB-HOST-PERMISSION', recovery: 'open-settings', retry: 'none', section: 'account', first: 'open-settings' },
  { id: 'ER-056', code: 'CG-BINDING-MISSING', recovery: 'contact-owner', retry: 'none', section: 'accounts', first: 'open-settings' },
  { id: 'ER-057', code: 'CG-HUB-TIMEOUT', recovery: 'retry', retry: 'safe-read', section: 'status', first: 'retry' },
  { id: 'ER-058', code: 'CG-HUB-REQUEST', recovery: 'contact-owner', retry: 'none', first: 'copy-code' },
  { id: 'ER-059', code: 'CG-RECAP-SAVE', recovery: 'retry', retry: 'safe-read', first: 'retry' },
  { id: 'ER-060', code: 'CG-QUOTA-DAILY', recovery: 'wait-until', retry: 'after-deadline', section: 'status', first: 'retry' },
  { id: 'ER-061', code: 'CG-PROVIDER-PROXY', recovery: 'contact-owner', retry: 'never', section: 'status' },
  { id: 'ER-061', code: 'CG-PROVIDER-UNKNOWN', recovery: 'new-generation', retry: 'new-click', first: 'again' },
  { id: 'ER-062', code: 'CG-HUB-CAPABILITY', recovery: 'contact-owner', retry: 'none', section: 'status' },
  { id: 'ER-063', code: 'CG-PROVIDER-BILLING', recovery: 'contact-owner', retry: 'never', section: 'status' },
  { id: 'ER-064', code: 'CG-PROVIDER-AUTH', recovery: 'contact-owner', retry: 'never', section: 'status' },
  { id: 'ER-065', code: 'CG-PROVIDER-RATE-LIMIT', recovery: 'wait-until', retry: 'after-deadline', first: 'retry' },
  { id: 'ER-066', code: 'CG-PROVIDER-UNAVAILABLE', recovery: 'new-generation', retry: 'new-click', first: 'again' },
  { id: 'ER-067', code: 'CG-STREAM-TRUNCATED', recovery: 'new-generation', retry: 'new-click', first: 'again' },
  { id: 'ER-068', code: 'CG-LOGIN-CREDENTIALS', recovery: 'sign-in', retry: 'new-click', section: 'account', first: 'sign-in' },
  { id: 'ER-070', code: 'CG-AUTH-REVOKED', recovery: 'sign-in', retry: 'none', section: 'account', first: 'sign-in' },
  { id: 'ER-070', code: 'CG-AUTH-EXPIRED', recovery: 'sign-in', retry: 'none', section: 'account', first: 'sign-in' },
  { id: 'ER-071', code: 'CG-LOGIN-RATE-LIMIT', recovery: 'wait-until', retry: 'after-deadline', section: 'account', first: 'retry' },
  { id: 'ER-072', code: 'CG-LOGIN-UNAVAILABLE', recovery: 'retry', retry: 'new-click', section: 'account', first: 'retry' },
  { id: 'ER-073', code: 'CG-LOGIN-INCOMPLETE', recovery: 'retry', retry: 'safe-read', section: 'account', first: 'retry' },
  { id: 'ER-074', code: 'CG-INSERT-FAILED', recovery: 'retry', retry: 'new-click', first: 'retry' },
];

describe('codes of the old clients’ errors in the new registry', () => {
  for (const c of CODE_CASES) {
    it(`[${c.id}] ${c.code}: recovery ${c.recovery}, retry ${c.retry}`, () => {
      const entry = CG_REGISTRY[c.code];
      expect(entry.recovery).toBe(c.recovery);
      expect(entry.retry).toBe(c.retry);
      expect(settingsRouteOf(c.code)).toEqual(c.section === undefined ? null : { section: c.section, code: c.code });
      const view = viewOfCode(c.code, ru);
      expect(view.title).toMatch(CYRILLIC);
      expect(`${view.title} ${view.body}`).not.toMatch(/Fansly/);
      const actions = recoveryActions(cgError(c.code), NOW);
      expect(actions.at(-1)?.kind).toBe('copy-code');
      if (c.first !== undefined) expect(actions[0]?.kind).toBe(c.first);
      if (c.section !== undefined) expect(actions.find((a) => a.kind === 'open-settings')?.settings).toEqual({ section: c.section, code: c.code });
    });
  }

  it('[ER-060] the daily quota counts down to 00:00 UTC', () => {
    const resetsAt = nextUtcMidnight(NOW);
    expect(new Date(resetsAt).toISOString()).toBe('2026-10-04T00:00:00.000Z');
    expect(nextUtcMidnight(Date.UTC(2026, 9, 4))).toBe(Date.UTC(2026, 9, 5));
    const view = errorView(cgError('CG-QUOTA-DAILY', { retryAt: resetsAt, httpStatus: 429, detail: 'quota_denied' }), ru);
    expect(view.retryAt).toBe(resetsAt);
    expect(quotaCountdownText(countdown(resetsAt, NOW), ru)).toBe('До обновления 17 ч 39 мин');
    expect(quotaCountdownText(countdown(resetsAt, resetsAt), ru)).toBeNull();
    expect(recoveryActions(cgError('CG-QUOTA-DAILY', { retryAt: resetsAt }), NOW)[0]).toMatchObject({ kind: 'retry', enabled: false, availableAt: resetsAt });
  });

  it('[ER-067] a truncated stream shows no server text', () => {
    const view = errorView(cgError('CG-STREAM-TRUNCATED'), ru);
    expect(view.detail).toBeUndefined();
    expect(view.body).toBe(RU['cg.streamTruncated.body']);
  });

  it('[ER-074] the insert error names the input field, not Fansly', () => {
    expect(viewOfCode('CG-INSERT-FAILED', ru).body).toContain('пол');
  });

  it('[ER-054] a 401 without a reason does not wipe the sign-in', () => {
    expect(generalRule('unauthorized')?.disposition).toBe('show');
    expect(HUB_HTTP_ERROR_RULES.filter((rule) => rule.disposition === 'clear-sign-in').every((rule) => rule.reason !== undefined)).toBe(true);
  });
});

describe('toasts, the card’s dot and P1', () => {
  it('[ER-009] toast kind and lifetime by severity; same code and scope replace each other', () => {
    expect(toastKindOf('CG-HUB-UNAVAILABLE')).toBe('error');
    expect(toastKindOf('CG-HOST-CONTRACT')).toBe('warning');
    expect(toastKindOf('CG-GATE-DRAFT')).toBe('info');
    expect(toastLifetimeMs('error')).toBe(6500);
    expect(toastLifetimeMs('success')).toBe(4500);
    expect(TOAST_TIMING.maxVisible).toBe(3);
    expect(toastKey('CG-NETWORK', 'dock')).toBe(toastKey('CG-NETWORK', 'dock'));
    expect(toastKey('CG-NETWORK', 'dock')).not.toBe(toastKey('CG-NETWORK', 'board'));
    expect(toastKey(null, 'dock')).toBe('none|dock');
  });

  it('[ER-011] the card and the toast deep-link into the settings section of the code', () => {
    const route = settingsRouteOf('CG-HUB-URL');
    expect(route).toEqual({ section: 'account', code: 'CG-HUB-URL' });
    if (route === null) throw new Error('no route');
    expect(settingsHref(route)).toBe('options.html#account:CG-HUB-URL');
    expect(settingsHref({ section: 'status' })).toBe('options.html#status');
    expect(parseSettingsHash('#account:CG-HUB-URL')).toEqual(route);
    expect(parseSettingsHash('moz-extension://x/options.html#status')).toEqual({ section: 'status' });
    expect(parseSettingsHash('status:')).toEqual({ section: 'status' });
    expect(parseSettingsHash('#nowhere')).toBeNull();
    expect(parseSettingsHash('#status:CG-NOPE')).toBeNull();
    expect(parseSettingsHash('#status:CG-NETWORK:x')).toBeNull();
    expect(settingsRouteOf('CG-GATE-DRAFT')).toBeNull();
  });

  it('[ER-010] the error toast carries the code, the explanation, the countdown and the technical line', () => {
    const retryAt = NOW + 24_000;
    const view = viewOfCode('CG-PROVIDER-RATE-LIMIT', ru, { retryAt, httpStatus: 429, detail: 'provider_rate_limited' });
    expect(toastKindOf(view.code)).toBe('warning');
    expect(codeAndTitle(view)).toMatch(/^CG-PROVIDER-RATE-LIMIT: \S/);
    expect(view.body.length).toBeGreaterThan(0);
    expect(view.detail).toBe('HTTP 429 • provider_rate_limited');
    expect(view.retryAt).toBe(retryAt);
    expect(retryInText(countdown(retryAt, NOW), ru)).toBe(ru.text('cg.retryIn', { n: 24 }));
    expect(CgErrorViewSchema.safeParse(view).success).toBe(true);
  });

  it('[ER-012] the unsynced shared recap is a warning that stays as long as an error', () => {
    expect(toastKindOf('CG-RECAP-SAVE')).toBe('warning');
    expect(LONG_TOASTS).toContain('CG-RECAP-SAVE');
    expect(toastLifetimeMs('warning', 'CG-RECAP-SAVE')).toBe(TOAST_TIMING.errorLifetimeMs);
    expect(toastLifetimeMs('warning', 'CG-HOST-CONTRACT')).toBe(TOAST_TIMING.lifetimeMs);
    expect(recoveryActions(cgError('CG-RECAP-SAVE'), NOW)[0]?.kind).toBe('retry');
  });

  it('[ER-013] the old toasts outside the registry are registry codes now, in Russian', () => {
    for (const code of ['CG-GATE-OVERLAY', 'CG-GATE-DRAFT', 'CG-OP-COACH-BUSY'] as const) {
      expect(toastKindOf(code)).toBe('info');
      expect(viewOfCode(code, ru).title).toMatch(CYRILLIC);
      expect(recoveryActions(cgError(code), NOW).map((a) => a.kind)).toEqual(['copy-code']);
    }
  });

  it('[ER-014] background generation toasts: «AI готово · фан», each its own, at most three on screen', () => {
    expect(ru.text('toast.aiReady', { fan: 'fan 1' })).toBe('AI готово · fan 1');
    expect(TOAST_TIMING.maxVisible).toBe(3);
    expect(toastKey(null, 'ai-ready:op-1')).not.toBe(toastKey(null, 'ai-ready:op-2'));
    expect(toastKindOf('CG-OP-TAB-LIMIT')).toBe('info');
  });

  it('[ER-020] the surface failure card: retry, the diagnostics section for the export, the code', () => {
    const actions = recoveryActions(cgError('CG-UI-FAILED'), NOW);
    expect(actions.map((a) => a.kind)).toEqual(['retry', 'open-settings', 'copy-code']);
    expect(actions[1]?.settings).toEqual({ section: 'diagnostics', code: 'CG-UI-FAILED' });
    expect(viewOfCode('CG-UI-FAILED', ru).title).toMatch(CYRILLIC);
  });

  it('[TL-013] the AI quota day ends at 00:00 UTC, whatever the local zone', () => {
    expect(nextUtcMidnight(Date.UTC(2026, 9, 3, 23, 59, 59))).toBe(Date.UTC(2026, 9, 4));
    expect(nextUtcMidnight(Date.UTC(2026, 9, 4))).toBe(Date.UTC(2026, 9, 5));
    expect(retryVerdict(cgError('CG-QUOTA-DAILY', { retryAt: Date.UTC(2026, 9, 4) }), NOW)).toEqual({ allowed: false, why: 'wait', at: Date.UTC(2026, 9, 4) });
  });

  it('a failure has a red dot, a state a ring; P1 is the misplaced insert', () => {
    expect(errorTone('CG-OP-INTERRUPTED')).toBe('state');
    expect(errorTone('CG-INSERT-FAILED')).toBe('failure');
    expect(isP1('CG-INSERT-MISPLACED')).toBe(true);
    expect(isP1('CG-INSERT-FAILED')).toBe(false);
    expect(recoveryActions(cgError('CG-HUB-OUTDATED'), NOW).map((a) => a.kind)).toEqual(['update-extension', 'open-settings', 'copy-code']);
    expect(recoveryActions(cgError('CG-SEND-UNCERTAIN'), NOW).map((a) => a.kind)).toEqual(['open-chat', 'copy-code']);
    expect(recoveryActions(cgError('CG-SEND-PART'), NOW)[0]).toMatchObject({ kind: 'again', enabled: true });
    expect(recoveryActions(cgError('CG-INSERT-UNCERTAIN'), NOW).map((a) => a.kind)).toEqual(['copy-code']);
  });
});
