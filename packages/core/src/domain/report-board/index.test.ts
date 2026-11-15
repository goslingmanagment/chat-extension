import { describe, expect, it } from 'vitest';

import { frameRequestAllowed, reportPulseOf } from './index';

describe('frameRequestAllowed: what a Workboard frame may ask of Hub with the device token', () => {
  it('lets the board operations through, path parameters digits only', () => {
    expect(frameRequestAllowed('report', 'GET', '/api/v1/shift-reports/current')).toBe(true);
    expect(frameRequestAllowed('report', 'GET', '/api/v1/shift-reports/42')).toBe(true);
    expect(frameRequestAllowed('report', 'GET', '/api/v1/shift-reports?limit=20&cursor=abc')).toBe(true);
    expect(frameRequestAllowed('report', 'PUT', '/api/v1/shift-reports/42/lines/981337562090745305')).toBe(true);
    expect(frameRequestAllowed('report', 'POST', '/api/v1/shift-reports/42/confirm')).toBe(true);
    expect(frameRequestAllowed('report', 'POST', '/api/v1/sale-claims/7/answer')).toBe(true);
  });

  it('refuses everything else: another method, another route, a parameter that is no number, a trick in the path', () => {
    expect(frameRequestAllowed('report', 'DELETE', '/api/v1/shift-reports/42')).toBe(false);
    expect(frameRequestAllowed('report', 'POST', '/api/v1/shift-reports/42')).toBe(false);
    expect(frameRequestAllowed('report', 'GET', '/api/v1/shift-reports/current/../../auth/devices')).toBe(false);
    expect(frameRequestAllowed('report', 'GET', '/api/v1/shift-reports/abc')).toBe(false);
    expect(frameRequestAllowed('report', 'GET', '/api/v1/shift-reports/0')).toBe(false);
    expect(frameRequestAllowed('report', 'GET', '/api/v1/auth/devices')).toBe(false);
    expect(frameRequestAllowed('report', 'POST', '/api/v1/auth/password')).toBe(false);
    expect(frameRequestAllowed('report', 'POST', '/api/v1/client/sale-sightings')).toBe(false);
    expect(frameRequestAllowed('report', 'GET', 'https://evil.example/api/v1/shift-reports/current')).toBe(false);
    expect(frameRequestAllowed('report', 'GET', '//evil.example/api/v1/shift-reports/current')).toBe(false);
    expect(frameRequestAllowed('report', 'GET', '/api/v1/shift-reports/current?x=1#y')).toBe(false);
    expect(frameRequestAllowed('report', 'GET', '/api/v1/shift-reports/current?a=1?b')).toBe(false);
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
