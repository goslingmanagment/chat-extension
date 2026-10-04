// The two ways a facade call fails (contracts hub/facade.ts, 1.1.0): a
// HubCallError carries the hub's answer or the transport failure plus the
// facade's reading of it; a HubCheckError is the hub layer refusing by
// itself. Messages carry the route and the facts only — never the token, a
// hub message text or anything the person typed.

import {
  HUB_CLIENT_CHECK_CODES,
  type CgCode,
  type HubCallError,
  type HubCheckError,
  type HubClientCheck,
  type HubErrorResolution,
  type HubFailure,
  type HubRouteKey,
} from '@cg/contracts';

export class FacadeCallError extends Error implements HubCallError {
  override readonly name = 'HubCallError' as const;
  readonly route: HubRouteKey;
  readonly failure: HubFailure;
  readonly epoch: number;
  readonly resolution?: HubErrorResolution;

  constructor(route: HubRouteKey, failure: HubFailure, epoch: number, resolution?: HubErrorResolution) {
    super(`${route}: ${describeFailure(failure)}`);
    this.route = route;
    this.failure = failure;
    this.epoch = epoch;
    if (resolution !== undefined) this.resolution = resolution;
  }
}

export class FacadeCheckError extends Error implements HubCheckError {
  override readonly name = 'HubCheckError' as const;
  readonly check: HubClientCheck;
  readonly code: CgCode;
  readonly route: HubRouteKey | null;
  readonly epoch: number;
  readonly reason?: string;

  constructor(check: HubClientCheck, route: HubRouteKey | null, epoch: number, reason?: string) {
    super(`${route ?? 'hub'}: ${check}${reason === undefined ? '' : ` (${reason})`}`);
    this.check = check;
    this.code = HUB_CLIENT_CHECK_CODES[check];
    this.route = route;
    this.epoch = epoch;
    if (reason !== undefined) this.reason = reason;
  }
}

export function describeFailure(failure: HubFailure): string {
  switch (failure.kind) {
    case 'http':
      return `HTTP ${failure.status}${failure.error === null ? '' : ` ${failure.error}`}${failure.reason === null ? '' : `/${failure.reason}`}`;
    case 'sse-error':
      return `SSE error ${failure.code}`;
    case 'transport':
      return failure.failure;
  }
}

/** The technical line of an error card: «HTTP 429 • quota_denied», ≤ 400 characters (ER-005). */
export function failureDetail(failure: HubFailure): string {
  return describeFailure(failure).replace(/^HTTP (\d+) /, 'HTTP $1 • ').slice(0, 400);
}

export const transportFailure = (failure: Extract<HubFailure, { kind: 'transport' }>['failure']): HubFailure => ({ kind: 'transport', failure });

/** Rejections of the hub layer are Errors (FacadeCallError, FacadeCheckError); anything else is wrapped without its text. */
export function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error('hub: non-error rejection');
}
