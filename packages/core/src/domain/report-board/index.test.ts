import { describe, expect, it } from 'vitest';

import { frameRequestAllowed, reportPulseOf } from './index';

describe('frameRequestAllowed: what a Workboard frame may ask of Hub with the device token', () => {
  it('lets everything under the board\'s prefix through, and the claim answer, and me', () => {
    expect(frameRequestAllowed('report', 'GET', '/api/v1/shift-reports')).toBe(true);
    expect(frameRequestAllowed('report', 'GET', '/api/v1/shift-reports/current')).toBe(true);
    expect(frameRequestAllowed('report', 'GET', '/api/v1/shift-reports?limit=20&cursor=abc')).toBe(true);
    expect(frameRequestAllowed('report', 'PUT', '/api/v1/shift-reports/42/lines/981337562090745305')).toBe(true);
    // A new operation of the board passes without a release of the extension: the token's profile is the boundary.
    expect(frameRequestAllowed('report', 'POST', '/api/v1/shift-reports/42/some-new-step')).toBe(true);
    expect(frameRequestAllowed('report', 'DELETE', '/api/v1/shift-reports/42/asks/7')).toBe(true);
    expect(frameRequestAllowed('report', 'POST', '/api/v1/sale-claims/7/answer')).toBe(true);
    expect(frameRequestAllowed('report', 'GET', '/api/v1/auth/me')).toBe(true);
  });

  it('refuses the rest, a path that hides a step out, another host, a method of none', () => {
    expect(frameRequestAllowed('report', 'POST', '/api/v1/auth/me')).toBe(false);
    expect(frameRequestAllowed('report', 'GET', '/api/v1/auth/devices')).toBe(false);
    expect(frameRequestAllowed('report', 'POST', '/api/v1/auth/password')).toBe(false);
    expect(frameRequestAllowed('report', 'POST', '/api/v1/client/sale-sightings')).toBe(false);
    expect(frameRequestAllowed('report', 'GET', '/api/v1/shift-reportsx')).toBe(false);
    expect(frameRequestAllowed('report', 'POST', '/api/v1/sale-claims/abc/answer')).toBe(false);
    expect(frameRequestAllowed('report', 'POST', '/api/v1/sale-claims/7/decide')).toBe(false);
    expect(frameRequestAllowed('report', 'GET', '/api/v1/shift-reports/../auth/devices')).toBe(false);
    expect(frameRequestAllowed('report', 'GET', '/api/v1/shift-reports/./current')).toBe(false);
    expect(frameRequestAllowed('report', 'GET', '/api/v1/shift-reports/%2e%2e/auth/devices')).toBe(false);
    expect(frameRequestAllowed('report', 'GET', '/api/v1/shift-reports//current')).toBe(false);
    expect(frameRequestAllowed('report', 'GET', '/api/v1/shift-reports/')).toBe(false);
    expect(frameRequestAllowed('report', 'GET', 'https://evil.example/api/v1/shift-reports/current')).toBe(false);
    expect(frameRequestAllowed('report', 'GET', '//evil.example/api/v1/shift-reports/current')).toBe(false);
    expect(frameRequestAllowed('report', 'GET', '/api/v1/shift-reports/current?x=1#y')).toBe(false);
    expect(frameRequestAllowed('report', 'GET', '/api/v1/shift-reports/current?a=1?b')).toBe(false);
    expect(frameRequestAllowed('report', 'PATCH', '/api/v1/shift-reports/current')).toBe(false);
    expect(frameRequestAllowed('custom' as 'report', 'GET', '/api/v1/shift-reports/current')).toBe(false);
  });
});

describe('reportPulseOf: the pulse read loosely', () => {
  it('is null without the right, for an older hub and for a wrong shape', () => {
    expect(reportPulseOf(undefined)).toBeNull();
    expect(reportPulseOf(null)).toBeNull();
    expect(reportPulseOf({ shiftId: 'x', phase: 'draft', needsMe: false })).toBeNull();
    expect(reportPulseOf({ shiftId: 12, phase: 'confirm', needsMe: true, extra: 1 })).toEqual({ shiftId: 12, phase: 'confirm', needsMe: true });
  });
});
