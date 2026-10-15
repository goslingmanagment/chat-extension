import type { CgFanslyCode } from '@cg/contracts/errors-fansly';

/** No response text, URL, body or session material ever enters an error. */
export class FanslyApiError extends Error {
  constructor(
    readonly code: Extract<CgFanslyCode, 'CG-FAN-REQUEST' | 'CG-FAN-SESSION' | 'CG-FAN-EXPIRED' | 'CG-FAN-RATE-LIMIT'>,
    readonly phase: 'before-dispatch' | 'after-dispatch',
    readonly status = 0,
    readonly retryAt = 0,
  ) { super(code); this.name = 'FanslyApiError'; }
}

export function retryAfterMs(value: string | null, now: number): number {
  if (value === null) return 0;
  const seconds = /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) * 1000 : Date.parse(value) - now;
  return Number.isFinite(seconds) ? Math.max(0, Math.min(6 * 3600_000, seconds)) : 0;
}

export function readEnvelope(value: unknown, status: number, emptyAllowed: boolean): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || !('success' in value) || value.success !== true || (!emptyAllowed && (!('response' in value) || value.response === undefined || value.response === null))) {
    throw new FanslyApiError('CG-FAN-REQUEST', 'after-dispatch', status);
  }
  return 'response' in value ? value.response : undefined;
}
