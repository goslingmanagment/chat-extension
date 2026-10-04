import { HUB_HTTP_ERROR_RULES, HUB_ROUTE_KEYS, HUB_ROUTES, type HubErrorContext, type HubFailure, type HubRouteKey } from '@cg/contracts';
import { describe, expect, it } from 'vitest';

import { hubErrorWire, hubHttpRuleFor, nextUtcMidnight, resolveHubError } from './hub-map';

const NOW = Date.UTC(2026, 9, 3, 10, 0, 0);
const ctx = (route: HubRouteKey, over: Partial<HubErrorContext> = {}): HubErrorContext => ({
  route,
  currentSignIn: true,
  pageGranted: true,
  beforeFirstFrame: false,
  claimAction: null,
  fanLookup: false,
  now: NOW,
  ...over,
});
const http = (status: number, error: string | null, reason: string | null = null, retryAfterMs: number | null = null): HubFailure => ({
  kind: 'http',
  status,
  error,
  reason,
  retryAfterMs,
});

describe('[AU-010] [AU-011] [AU-014] hub error resolver: sign-in rules', () => {
  it('[AU-010] a 401 token_revoked / token_expired of the current sign-in wipes it with its reason', () => {
    expect(resolveHubError(http(401, 'unauthorized', 'token_revoked'), ctx('me'))).toEqual({
      code: 'CG-AUTH-REVOKED',
      disposition: 'clear-sign-in',
      retryAt: null,
      httpStatus: 401,
    });
    expect(resolveHubError(http(401, 'unauthorized', 'token_expired'), ctx('clientConversationFeed')).code).toBe('CG-AUTH-EXPIRED');
  });

  it('[AU-011] a 401 without a reason never wipes: CG-AUTH-REJECTED; a 403 never wipes either', () => {
    expect(resolveHubError(http(401, 'unauthorized'), ctx('me'))).toMatchObject({ code: 'CG-AUTH-REJECTED', disposition: 'show' });
    expect(resolveHubError(http(401, 'unauthorized', 'some_future_reason'), ctx('me')).disposition).toBe('show');
    expect(resolveHubError(http(403, 'forbidden', 'token_revoked'), ctx('me'))).toMatchObject({ code: 'CG-HUB-FORBIDDEN', disposition: 'show' });
    expect(resolveHubError(http(401, null), ctx('me')).code).toBe('CG-AUTH-REJECTED');
  });

  it('[AU-014] an answer to an older sign-in changes nothing', () => {
    expect(resolveHubError(http(401, 'unauthorized', 'token_revoked'), ctx('me', { currentSignIn: false }))).toEqual({
      code: null,
      disposition: 'ignore',
      retryAt: null,
      httpStatus: 401,
    });
  });

  it('sign-in reads 401/429/5xx as login codes with the Retry-After deadline', () => {
    const route = 'authIssueDeviceTokenWithPassword';
    expect(resolveHubError(http(401, 'unauthorized'), ctx(route)).code).toBe('CG-LOGIN-CREDENTIALS');
    expect(resolveHubError(http(429, 'rate_limit_exceeded', null, 60_000), ctx(route))).toMatchObject({ code: 'CG-LOGIN-RATE-LIMIT', retryAt: NOW + 60_000 });
    expect(resolveHubError(http(429, 'rate_limit_exceeded'), ctx(route)).retryAt).toBeNull();
    expect(resolveHubError(http(502, null), ctx(route)).code).toBe('CG-LOGIN-UNAVAILABLE');
    expect(resolveHubError({ kind: 'transport', failure: 'timeout' }, ctx(route)).code).toBe('CG-LOGIN-TIMEOUT');
    expect(resolveHubError({ kind: 'transport', failure: 'network' }, ctx(route)).code).toBe('CG-LOGIN-UNAVAILABLE');
  });
});

describe('[TL-013] [AI-140] hub error resolver: the AI stream', () => {
  it('[TL-013] 429 quota_denied: CG-QUOTA-DAILY until the next 00:00 UTC', () => {
    const resolution = resolveHubError(http(429, 'quota_denied'), ctx('aiFeatureStream', { beforeFirstFrame: true }));
    expect(resolution).toMatchObject({ code: 'CG-QUOTA-DAILY', disposition: 'show' });
    expect(resolution.retryAt).toBe(Date.UTC(2026, 9, 4));
    expect(nextUtcMidnight(Date.UTC(2026, 9, 3, 23, 59, 59, 999))).toBe(Date.UTC(2026, 9, 4));
    expect(nextUtcMidnight(Date.UTC(2026, 9, 4))).toBe(Date.UTC(2026, 9, 5));
  });

  it('structured 503 before the first frame: retry-once; after a frame or elsewhere: show', () => {
    expect(resolveHubError(http(503, 'service_unavailable'), ctx('aiFeatureStream', { beforeFirstFrame: true })).disposition).toBe('retry-once');
    expect(resolveHubError(http(503, 'service_unavailable'), ctx('aiFeatureStream')).disposition).toBe('show');
    expect(resolveHubError(http(503, 'service_unavailable'), ctx('clientFanClaim', { claimAction: 'dispatch', beforeFirstFrame: true })).disposition).toBe('show');
    expect(resolveHubError(http(502, null), ctx('aiFeatureStream', { beforeFirstFrame: true }))).toMatchObject({ code: 'CG-HUB-UNAVAILABLE', disposition: 'show' });
  });

  it('[AI-140] persona 409 refreshes the catalog', () => {
    expect(resolveHubError(http(409, 'persona_definition_changed'), ctx('aiFeatureStream'))).toMatchObject({
      code: 'CG-PERSONA-CHANGED',
      disposition: 'refresh-catalog',
    });
  });

  it('SSE error frames: known codes, provider fallback, other fallback, retryAfterMs as a deadline', () => {
    expect(resolveHubError({ kind: 'sse-error', code: 'provider_billing', retryAfterMs: null }, ctx('aiFeatureStream')).code).toBe('CG-PROVIDER-BILLING');
    expect(resolveHubError({ kind: 'sse-error', code: 'provider_rate_limited', retryAfterMs: 30_000 }, ctx('aiFeatureStream'))).toEqual({
      code: 'CG-PROVIDER-RATE-LIMIT',
      disposition: 'show',
      retryAt: NOW + 30_000,
      httpStatus: null,
    });
    expect(resolveHubError({ kind: 'sse-error', code: 'provider_new', retryAfterMs: null }, ctx('aiFeatureStream')).code).toBe('CG-PROVIDER-UNKNOWN');
    expect(resolveHubError({ kind: 'sse-error', code: 'kernel_new', retryAfterMs: null }, ctx('aiFeatureStream')).code).toBe('CG-HUB-UNKNOWN');
    expect(resolveHubError({ kind: 'sse-error', code: 'constructor', retryAfterMs: null }, ctx('aiFeatureStream')).code).toBe('CG-HUB-UNKNOWN');
  });

  it('transport: truncated, contract, aborted, network', () => {
    expect(resolveHubError({ kind: 'transport', failure: 'truncated' }, ctx('aiFeatureStream')).code).toBe('CG-STREAM-TRUNCATED');
    expect(resolveHubError({ kind: 'transport', failure: 'contract' }, ctx('aiFeatureStream')).code).toBe('CG-HUB-REQUEST');
    expect(resolveHubError({ kind: 'transport', failure: 'aborted' }, ctx('aiFeatureStream')).code).toBeNull();
    expect(resolveHubError({ kind: 'transport', failure: 'network' }, ctx('spenders')).code).toBe('CG-NETWORK');
    expect(resolveHubError({ kind: 'transport', failure: 'timeout' }, ctx('spenders')).code).toBe('CG-HUB-TIMEOUT');
  });
});

describe('hub error resolver: page, claim and recap routes', () => {
  it('[SP-029] a page not granted, an empty fan lookup and a plain 404 are three different readings', () => {
    expect(resolveHubError(http(404, 'not_found'), ctx('clientConversationRecaps', { pageGranted: false })).code).toBe('CG-BINDING-NOT-GRANTED');
    expect(resolveHubError(http(404, 'not_found'), ctx('pageConversationProfile', { fanLookup: true }))).toMatchObject({ code: null, disposition: 'empty' });
    expect(resolveHubError(http(404, 'not_found'), ctx('spenders')).code).toBe('CG-HUB-REQUEST');
    expect(resolveHubError(http(404, 'not_found'), ctx('clientFanProfileFromGeneration')).code).toBe('CG-HUB-REQUEST');
  });

  it('claim: dispatch refused by a flag is CG-SEND-OFF; other client_feature_disabled reasons; custody codes', () => {
    expect(resolveHubError(http(409, 'client_feature_disabled', 'flag_off'), ctx('clientFanClaim', { claimAction: 'dispatch' }))).toMatchObject({
      code: 'CG-SEND-OFF',
      disposition: 'refresh-bootstrap',
    });
    expect(resolveHubError(http(409, 'client_feature_disabled', 'flag_off'), ctx('clientFanClaim', { claimAction: 'claim' })).code).toBe('CG-FEATURE-DISABLED');
    expect(resolveHubError(http(409, 'client_feature_disabled', 'binding_missing'), ctx('clientSpenderStats')).code).toBe('CG-BINDING-MISSING');
    expect(resolveHubError(http(409, 'client_feature_disabled', 'client_outdated'), ctx('aiFeatureStream')).code).toBe('CG-HUB-OUTDATED');
    expect(resolveHubError(http(409, 'part_already_sent'), ctx('clientFanClaim')).disposition).toBe('read-status');
    expect(resolveHubError(http(409, 'custody_held'), ctx('clientFanClaim')).code).toBe('CG-SEND-UNCERTAIN');
    expect(resolveHubError(http(429, 'preview_send_rate_limited', null, 20_000), ctx('clientFanClaim')).retryAt).toBe(NOW + 20_000);
    expect(resolveHubError(http(409, 'conflict'), ctx('clientFanClaim')).code).toBe('CG-CLAIM-BUSY');
    expect(resolveHubError(http(409, 'conflict'), ctx('spenders')).code).toBe('CG-HUB-REQUEST');
  });

  it('recap profile: not ready follows the §7 schedule; cursors restart; unknown codes fall to their status', () => {
    expect(resolveHubError(http(409, 'generation_not_ready'), ctx('clientFanProfileFromGeneration'))).toMatchObject({ code: 'CG-RECAP-SAVE', disposition: 'not-ready' });
    expect(resolveHubError(http(400, 'bad_request', 'cursor_invalid'), ctx('clientConversationFeed')).disposition).toBe('restart-cursor');
    expect(resolveHubError(http(409, 'some_future_conflict'), ctx('spenders')).code).toBe('CG-HUB-UNKNOWN');
    expect(resolveHubError(http(400, 'Bad Request'), ctx('spenders')).code).toBe('CG-HUB-REQUEST');
    expect(resolveHubError(http(418, null), ctx('spenders')).code).toBe('CG-HUB-UNKNOWN');
    expect(resolveHubError(http(429, null, null, 1_000), ctx('spenders'))).toMatchObject({ code: 'CG-HUB-RATE-LIMIT', retryAt: NOW + 1_000 });
  });

  it('agrees with the first matching rule of the table for every rule and every route class', () => {
    for (const route of HUB_ROUTE_KEYS) {
      for (const rule of HUB_HTTP_ERROR_RULES) {
        const failure = http(rule.status === '5xx' ? 503 : (rule.status ?? 400), rule.error, rule.reason ?? null) as Extract<HubFailure, { kind: 'http' }>;
        const context = ctx(route, { claimAction: HUB_ROUTES[route].routeClass === 'claim' ? 'dispatch' : null });
        expect(resolveHubError(failure, context).code).toBe(hubHttpRuleFor(failure, context).cg);
      }
    }
  });
});

describe('hubErrorWire', () => {
  it('drops nothing-to-show readings and keeps the deadline, status and a bounded detail', () => {
    expect(hubErrorWire({ code: null, disposition: 'ignore', retryAt: null, httpStatus: 401 })).toBeNull();
    expect(hubErrorWire({ code: 'CG-QUOTA-DAILY', disposition: 'show', retryAt: 5, httpStatus: 429 }, `HTTP 429 • ${'x'.repeat(500)}`)).toEqual({
      code: 'CG-QUOTA-DAILY',
      retryAt: 5,
      httpStatus: 429,
      detail: `HTTP 429 • ${'x'.repeat(389)}`,
    });
    expect(hubErrorWire({ code: 'CG-NETWORK', disposition: 'show', retryAt: null, httpStatus: null })).toEqual({ code: 'CG-NETWORK' });
  });
});
