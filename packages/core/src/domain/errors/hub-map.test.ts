import { type HubErrorContext, type HubFailure, type HubRouteKey } from '@cg/contracts';
import { describe, expect, it } from 'vitest';

import { resolveHubError } from './hub-map';

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
});

describe('hub error resolver: the AI stream', () => {
  it('[HF-9] a Fansly group and fan the hub does not pair (409 conversation_fan_mismatch): CG-CONTEXT-CHANGED, shown, never repeated as is', () => {
    expect(resolveHubError(http(409, 'conversation_fan_mismatch'), ctx('aiFeatureStream', { beforeFirstFrame: true }))).toEqual({
      code: 'CG-CONTEXT-CHANGED',
      disposition: 'show',
      retryAt: null,
      httpStatus: 409,
    });
  });
});

describe('hub error resolver: the send claim', () => {
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
});
