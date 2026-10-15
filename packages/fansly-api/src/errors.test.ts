// Fansly's envelope and our errors (architecture.md §8.3; ER-050, ER-051).

import { CgAnyErrorWireSchema } from '@cg/contracts/errors-fansly';
import { describe, expect, it } from 'vitest';

import { FanslyApiError, readEnvelope, retryAfterMs } from './errors';

describe('the envelope', () => {
  it('[ER-051] [FS-NET-3] `success: false` with HTTP 200 is an error, not an answer: CG-FAN-REQUEST, the status and Fansly\'s code kept', () => {
    const refused = readEnvelope(200, JSON.stringify({ success: false, error: { code: 1001, details: 'Some text Fansly wrote' } }));
    expect(refused.ok).toBe(false);
    const error = (refused as { error: FanslyApiError }).error;
    expect(error).toMatchObject({ kind: 'refused', code: 'CG-FAN-REQUEST', httpStatus: 200, fanslyCode: '1001', sent: true });
    // The wire form carries no text of Fansly's.
    expect(error.toWire()).toEqual({ code: 'CG-FAN-REQUEST', httpStatus: 200 });
    expect(CgAnyErrorWireSchema.safeParse(error.toWire()).success).toBe(true);
    expect((readEnvelope(200, JSON.stringify({ success: false, error: { code: 'not a token!' } })) as { error: FanslyApiError }).error.fanslyCode).toBeUndefined();
    expect((readEnvelope(200, '{"response":{}}') as { error: FanslyApiError }).error.kind).toBe('refused');
  });

  it('[ER-051] a 2xx that is not the envelope is malformed: an edge page, an array, no response', () => {
    expect((readEnvelope(200, '<!doctype html><title>edge</title>') as { error: FanslyApiError }).error).toMatchObject({ kind: 'malformed', code: 'CG-FAN-REQUEST' });
    expect((readEnvelope(200, '[]') as { error: FanslyApiError }).error.kind).toBe('malformed');
    expect((readEnvelope(200, '{"success":true}') as { error: FanslyApiError }).error.kind).toBe('malformed');
    expect(readEnvelope(200, '{"success":true}', true)).toEqual({ ok: true, response: undefined });
    expect(readEnvelope(200, '{"success":true,"response":{"id":"300000000000000001"}}')).toEqual({ ok: true, response: { id: '300000000000000001' } });
  });

  it('[ER-050] [FS-NET-3] the codes: no session, an expired one, a cooldown with its end, a refusal before the request is provably unsent', () => {
    expect(new FanslyApiError('session', { sent: false })).toMatchObject({ code: 'CG-FAN-SESSION', sent: false });
    expect(new FanslyApiError('expired', { sent: true, httpStatus: 401 }).code).toBe('CG-FAN-EXPIRED');
    const cooling = new FanslyApiError('cooling', { sent: false, retryAt: 1_792_065_630_000.4 });
    expect(cooling.toWire()).toEqual({ code: 'CG-FAN-RATE-LIMIT', retryAt: 1_792_065_630_000 });
    expect(new FanslyApiError('rate-limited', { sent: true, httpStatus: 429, retryAt: 5 }).toWire()).toEqual({ code: 'CG-FAN-RATE-LIMIT', retryAt: 5, httpStatus: 429 });
    expect(new FanslyApiError('network', { sent: true, httpStatus: 0 }).toWire()).toEqual({ code: 'CG-FAN-REQUEST' });
  });

  it('[NF-037] Retry-After in seconds or as an HTTP date', () => {
    const now = Date.UTC(2026, 9, 15, 12, 0, 0);
    expect(retryAfterMs('5', now)).toBe(5000);
    expect(retryAfterMs(' 1.5 ', now)).toBe(1500);
    expect(retryAfterMs(new Date(now + 90_000).toUTCString(), now)).toBe(90_000);
    expect(retryAfterMs(new Date(now - 90_000).toUTCString(), now)).toBe(0);
    expect(retryAfterMs('soon', now)).toBeUndefined();
    expect(retryAfterMs(null, now)).toBeUndefined();
  });
});
