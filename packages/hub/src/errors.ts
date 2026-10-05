// The two ways a facade call fails (contracts hub/facade.ts, 1.1.0): a
// HubCallError carries the hub's answer or the transport failure plus the
// facade's reading of it; a HubCheckError is the hub layer refusing by
// itself. Messages carry the route and the facts only — never the token, a
// hub message text or anything the person typed.

import {
  HUB_CLIENT_CHECK_CODES,
  type CgCode,
  type ClientFeatureFlag,
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

/**
 * The check a refused page feature reads as, by its reason — the same reading as the tab's
 * (`flagRefusalCode`, @cg/core/domain/ops) and as the hub's own 409: no binding, a page not granted, a hub
 * that does not serve the feature and an outdated client keep their own codes; everything else (the master
 * switch, the flag, the platform) is «выключено». A preview send is always X8's own «отправка выключена».
 */
const FLAG_REASON_CHECKS: Readonly<Record<string, HubClientCheck>> = {
  binding_missing: 'bindingMissing',
  not_granted: 'pageNotGranted',
  hub_not_ready: 'capabilityMissing',
  client_outdated: 'belowMinVersion',
};

export function flagRefused(flag: ClientFeatureFlag, reason: string | null, route: HubRouteKey, epoch: number): FacadeCheckError {
  const byReason = reason !== null && Object.prototype.hasOwnProperty.call(FLAG_REASON_CHECKS, reason) ? FLAG_REASON_CHECKS[reason] : undefined;
  return new FacadeCheckError(flag === 'previewSend' ? 'previewSendOff' : (byReason ?? 'featureDisabled'), route, epoch, reason ?? undefined);
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

/**
 * A failure as fields of a log line: machine words only, one per field (`failure` — its kind, `status`,
 * `error`, `reason`). The journal's redaction keeps a string only when it is a token without spaces, so the
 * one-line `describeFailure` («HTTP 409 client_feature_disabled/disabled») would reach a log as its length —
 * and the first live check could not read from its own journal what the hub had answered.
 */
export function failureFields(failure: HubFailure): Readonly<Record<string, string | number | null>> {
  switch (failure.kind) {
    case 'http':
      return { failure: 'http', status: failure.status, error: failure.error, reason: failure.reason };
    case 'sse-error':
      return { failure: 'sse-error', error: failure.code };
    case 'transport':
      return { failure: failure.failure };
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
