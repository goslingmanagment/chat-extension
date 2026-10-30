// Hub failure → CG code (architecture.md Appendix A «Колонка chat-extension»,
// §7, §8.2; contracts hub/error-map.ts). Pure: a reading of the contract's
// tables, no I/O and no clock of its own (the caller passes `now`). The hub
// facade (R08) attaches this reading to every HubCallError; core services
// may also call it for a failure they observe themselves.
//
// Order of the reading:
// - transport failures by HUB_TRANSPORT_CODES (route class first, then the default);
// - SSE `error` frames by HUB_SSE_ERROR_CODES, unknown `provider*` codes and
//   anything else by HUB_SSE_FALLBACKS; `retryAfterMs` becomes an absolute
//   display deadline, never an automatic retry;
// - HTTP answers by the FIRST matching HUB_HTTP_ERROR_RULES entry (route
//   class, status, reason and the call's facts); the table ends in a catch-all.
//   Its first rule ignores any answer to an older sign-in (AU-014): only an
//   HTTP answer can carry a 401 that would wipe the sign-in.

import {
  HUB_HTTP_ERROR_RULES,
  HUB_ROUTES,
  HUB_SSE_ERROR_CODES,
  HUB_SSE_FALLBACKS,
  HUB_TRANSPORT_CODES,
  type CgCode,
  type CgErrorWire,
  type HubErrorCondition,
  type HubErrorContext,
  type HubErrorResolution,
  type HubFailure,
  type HubHttpErrorRule,
  type HubRouteClass,
  type ResolveHubError,
} from '@cg/contracts';

const DAY_MS = 86_400_000;

/** The next 00:00 UTC strictly after `now`: the AI quota's day boundary (CG-QUOTA-DAILY). */
export function nextUtcMidnight(now: number): number {
  return Math.floor(now / DAY_MS) * DAY_MS + DAY_MS;
}

/** Moscow is UTC+3 all year (no DST since 2014). */
const MSK_OFFSET_MS = 3 * 3_600_000;

/** The next 00:00 Moscow time strictly after `now`: the personal AI limit's day boundary (CG-AI-LIMIT). */
export function nextMskMidnight(now: number): number {
  return nextUtcMidnight(now + MSK_OFFSET_MS) - MSK_OFFSET_MS;
}

function conditionHolds(condition: HubErrorCondition, context: HubErrorContext): boolean {
  switch (condition) {
    case 'stale-sign-in':
      return !context.currentSignIn;
    case 'page-not-granted':
      return context.pageGranted === false;
    case 'fan-lookup':
      return context.fanLookup;
    case 'before-first-frame':
      return context.beforeFirstFrame;
    case 'dispatch':
      return context.claimAction === 'dispatch';
  }
}

function statusMatches(rule: HubHttpErrorRule, status: number): boolean {
  if (rule.status === undefined) return true;
  if (rule.status === '5xx') return status >= 500 && status <= 599;
  return rule.status === status;
}

function ruleMatches(rule: HubHttpErrorRule, failure: Extract<HubFailure, { kind: 'http' }>, routeClass: HubRouteClass, context: HubErrorContext): boolean {
  return (
    (rule.error === null || rule.error === failure.error) &&
    statusMatches(rule, failure.status) &&
    (rule.reason === undefined || rule.reason === failure.reason) &&
    (rule.routes === undefined || rule.routes.includes(routeClass)) &&
    (rule.when === undefined || conditionHolds(rule.when, context))
  );
}

/** The first rule of HUB_HTTP_ERROR_RULES that reads this HTTP failure (the table's catch-all always matches). */
export function hubHttpRuleFor(failure: Extract<HubFailure, { kind: 'http' }>, context: HubErrorContext): HubHttpErrorRule {
  const routeClass = HUB_ROUTES[context.route].routeClass;
  const rule = HUB_HTTP_ERROR_RULES.find((candidate) => ruleMatches(candidate, failure, routeClass, context));
  /* v8 ignore next -- the table ends in a catch-all; a contract test pins it */
  if (rule === undefined) return { error: null, cg: 'CG-HUB-UNKNOWN', disposition: 'show' };
  return rule;
}

function transportCode(failure: Extract<HubFailure, { kind: 'transport' }>, routeClass: HubRouteClass): CgCode | null {
  const codes: Readonly<Partial<Record<HubRouteClass | 'default', CgCode | null>>> = HUB_TRANSPORT_CODES[failure.failure];
  const byClass = codes[routeClass];
  return byClass !== undefined ? byClass : (codes.default ?? null);
}

function sseCode(code: string): CgCode {
  const known: Readonly<Record<string, CgCode>> = HUB_SSE_ERROR_CODES;
  if (Object.prototype.hasOwnProperty.call(known, code)) return known[code] as CgCode;
  return code.startsWith(HUB_SSE_FALLBACKS.providerPrefix) ? HUB_SSE_FALLBACKS.provider : HUB_SSE_FALLBACKS.other;
}

/** Pure: the CG code, what to do besides showing it, and the absolute retry deadline (fixed once, ER-007). */
export const resolveHubError: ResolveHubError = (failure: HubFailure, context: HubErrorContext): HubErrorResolution => {
  const routeClass = HUB_ROUTES[context.route].routeClass;
  switch (failure.kind) {
    case 'transport':
      return { code: transportCode(failure, routeClass), disposition: 'show', retryAt: null, httpStatus: null };
    case 'sse-error':
      return {
        code: sseCode(failure.code),
        disposition: 'show',
        retryAt: failure.retryAfterMs === null ? null : context.now + failure.retryAfterMs,
        httpStatus: null,
      };
    case 'http': {
      const rule = hubHttpRuleFor(failure, context);
      const retryAt =
        rule.retryAt === 'next-utc-midnight'
          ? nextUtcMidnight(context.now)
          : rule.retryAt === 'next-msk-midnight'
            ? nextMskMidnight(context.now)
            : rule.retryAt === 'retry-after' && failure.retryAfterMs !== null
            ? context.now + failure.retryAfterMs
            : null;
      return { code: rule.cg, disposition: rule.disposition, retryAt, httpStatus: failure.status };
    }
  }
};

/**
 * The wire form of a resolution for a tab or a page (CgErrorWire): null when
 * there is nothing to show (`ignore`, `empty`). `detail` is the technical
 * line («HTTP 429 • …», ≤ 400 characters) — never a hub message as text.
 */
export function hubErrorWire(resolution: HubErrorResolution, detail?: string): CgErrorWire | null {
  if (resolution.code === null) return null;
  return {
    code: resolution.code,
    ...(detail === undefined ? {} : { detail: detail.slice(0, 400) }),
    ...(resolution.retryAt === null ? {} : { retryAt: resolution.retryAt }),
    ...(resolution.httpStatus === null ? {} : { httpStatus: resolution.httpStatus }),
  };
}
