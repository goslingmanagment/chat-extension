// Hub failure → CG code (architecture.md Appendix A «Колонка chat-extension»
// §2 SSE and §3 HTTP; hub-pr-plan.md §4.11 new codes; hub
// docs/error-handling.md §2–§3). Data only: the resolver is a pure function
// over these tables, implemented in core (its signature is below). We never
// parse provider or hub message text; only the machine `error`/`reason`/`code`.

import { type CgCode } from '../errors';
import { type ClaimAction } from './newcomers';
import { type HubRouteClass, type HubRouteKey } from './routes';

// ── §2 SSE `error` frames ──────────────────────────────────────────────────

export const HUB_SSE_ERROR_CODES = {
  provider_billing: 'CG-PROVIDER-BILLING',
  provider_auth: 'CG-PROVIDER-AUTH',
  /** The only code with a `retryAfterMs`: kept as an absolute display deadline, never an automatic retry. */
  provider_rate_limited: 'CG-PROVIDER-RATE-LIMIT',
  provider_unavailable: 'CG-PROVIDER-UNAVAILABLE',
  provider_proxy_unreachable: 'CG-PROVIDER-PROXY',
  provider_stream_failed: 'CG-PROVIDER-STREAM',
  provider_usage_missing: 'CG-PROVIDER-USAGE-MISSING',
  provider_stream_incomplete: 'CG-PROVIDER-INCOMPLETE',
  provider_output_empty: 'CG-PROVIDER-EMPTY',
  coach_output_too_long: 'CG-OUTPUT-COACH-LIMIT',
} as const satisfies Record<string, CgCode>;

/** Codes the table does not know, and the EOF that is not a hub code at all. */
export const HUB_SSE_FALLBACKS = {
  /** An unknown code starting with this prefix is a provider failure. */
  providerPrefix: 'provider',
  provider: 'CG-PROVIDER-UNKNOWN',
  other: 'CG-HUB-UNKNOWN',
  /** EOF without `done` and without an `error` frame. */
  truncated: 'CG-STREAM-TRUNCATED',
} as const satisfies { providerPrefix: string; provider: CgCode; other: CgCode; truncated: CgCode };

// ── §3 HTTP errors ─────────────────────────────────────────────────────────

/**
 * The HTTP status each hub code comes with (hub error canon §3, hub-pr-plan
 * §4.11, critic item 6). The fake hub answers with these; a code that comes
 * with another status is still read by its code.
 */
export const HUB_ERROR_STATUSES = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  unknown_ai_feature: 404,
  conflict: 409,
  persona_definition_changed: 409,
  rate_limit_exceeded: 429,
  quota_denied: 429,
  internal_error: 500,
  service_unavailable: 503,
  gate_draft_required: 400,
  gate_min_messages: 400,
  gate_hi_greeting_limit: 400,
  gate_ping_active: 400,
  context_conflict: 400,
  client_feature_disabled: 409,
  generation_not_ready: 409,
  generation_not_eligible: 409,
  claim_busy: 409,
  claim_expired: 409,
  custody_held: 409,
  greeting_done: 409,
  part_already_sent: 409,
  generation_mismatch: 409,
  attempt_conflict: 409,
  custody_not_owned: 409,
  preview_send_rate_limited: 429,
} as const satisfies Record<string, number>;
export type HubErrorCode = keyof typeof HUB_ERROR_STATUSES;

/** What the caller does besides showing the code. */
export const HUB_ERROR_DISPOSITIONS = [
  /** Show the code; nothing else. */
  'show',
  /** 401 with `token_revoked`/`token_expired` for the CURRENT token and sign-in epoch: wipe the sign-in. */
  'clear-sign-in',
  /** An answer meant for an older sign-in (AU-014): touch nothing, show nothing. */
  'ignore',
  /** AI only: a structured 503 before the first output frame → one transparent retry after 5 s («Сервис недоступен, повтор через 5 с…»). */
  'retry-once',
  /** Drop the result, refresh the persona catalog, show the code. */
  'refresh-catalog',
  /** The hub refused by flags or version: refresh bootstrap, show the code. */
  'refresh-bootstrap',
  /** A rejected cursor: read again from the first page once, no toast. */
  'restart-cursor',
  /** H-5 `generation_not_ready`: the §7 schedule of idempotent link writes; the code only when it runs out. */
  'not-ready',
  /** A granted page's 404 on a fan lookup (dossier, fan card): the facade answers null. */
  'empty',
  /** Custody says the part is already sent: read the claim status, no toast. */
  'read-status',
] as const;
export type HubErrorDisposition = (typeof HUB_ERROR_DISPOSITIONS)[number];

/** Facts of the failing call that some rules depend on (from HubErrorContext). */
export const HUB_ERROR_CONDITIONS = [
  /** The call carried an older token or sign-in epoch than the current one. */
  'stale-sign-in',
  /** The page is not among the current bootstrap's pages («не любой 404»). */
  'page-not-granted',
  /** A lookup of one fan (dossier, fan card). */
  'fan-lookup',
  /** AI stream: no output frame has arrived yet. */
  'before-first-frame',
  /** Claim route, action `dispatch`. */
  'dispatch',
] as const;
export type HubErrorCondition = (typeof HUB_ERROR_CONDITIONS)[number];

export interface HubHttpErrorRule {
  /** The hub's `error` code; null matches any code. */
  readonly error: string | null;
  /** Narrows by status; `5xx` = 500–599. */
  readonly status?: number | '5xx';
  /** The machine `reason`; omitted = any reason. */
  readonly reason?: string;
  /** Route classes the rule applies to; omitted = every route. */
  readonly routes?: readonly HubRouteClass[];
  readonly when?: HubErrorCondition;
  /** null = no code to show (ignore, empty). */
  readonly cg: CgCode | null;
  readonly disposition: HubErrorDisposition;
  /** Where the deadline comes from: the failure's `retryAfterMs`, or the AI quota's 00:00 UTC. */
  readonly retryAt?: 'retry-after' | 'next-utc-midnight';
}

const show = (error: string | null, cg: CgCode, extra: Omit<HubHttpErrorRule, 'error' | 'cg' | 'disposition'> = {}): HubHttpErrorRule => ({
  error,
  cg,
  disposition: 'show',
  ...extra,
});

/**
 * Ordered: the first rule that matches wins. Route- and fact-dependent rules
 * come before the general rule of the same code; status fallbacks and the
 * catch-all come last. Unknown codes on a known 4xx/5xx status fall to the
 * status rules; anything else is CG-HUB-UNKNOWN (kept apart in diagnostics).
 */
export const HUB_HTTP_ERROR_RULES: readonly HubHttpErrorRule[] = [
  // Any answer to an older sign-in changes nothing (AU-014).
  { error: null, when: 'stale-sign-in', cg: null, disposition: 'ignore' },

  // ── sign-in and the token ──
  { error: 'unauthorized', reason: 'token_revoked', cg: 'CG-AUTH-REVOKED', disposition: 'clear-sign-in' },
  { error: 'unauthorized', reason: 'token_expired', cg: 'CG-AUTH-EXPIRED', disposition: 'clear-sign-in' },
  show('unauthorized', 'CG-LOGIN-CREDENTIALS', { routes: ['sign-in'] }),
  /** 401 without a reason (or with one we do not know) never wipes the sign-in. */
  show('unauthorized', 'CG-AUTH-REJECTED'),
  /** 403 never wipes the sign-in. */
  show('forbidden', 'CG-HUB-FORBIDDEN'),
  show('rate_limit_exceeded', 'CG-LOGIN-RATE-LIMIT', { routes: ['sign-in'], retryAt: 'retry-after' }),
  show(null, 'CG-LOGIN-UNAVAILABLE', { routes: ['sign-in'], status: '5xx' }),

  // ── limits ──
  show('rate_limit_exceeded', 'CG-HUB-RATE-LIMIT', { retryAt: 'retry-after' }),
  show('preview_send_rate_limited', 'CG-HUB-RATE-LIMIT', { routes: ['claim'], retryAt: 'retry-after' }),
  show('quota_denied', 'CG-QUOTA-DAILY', { retryAt: 'next-utc-midnight' }),

  // ── availability: one transparent AI retry, never for a send ──
  { error: 'service_unavailable', routes: ['ai-stream'], when: 'before-first-frame', cg: 'CG-HUB-UNAVAILABLE', disposition: 'retry-once' },
  show('service_unavailable', 'CG-HUB-UNAVAILABLE'),
  show('internal_error', 'CG-HUB-UNAVAILABLE'),

  // ── AI ──
  show('unknown_ai_feature', 'CG-HUB-CAPABILITY'),
  { error: 'persona_definition_changed', cg: 'CG-PERSONA-CHANGED', disposition: 'refresh-catalog' },
  show('gate_draft_required', 'CG-GATE-DRAFT'),
  show('gate_min_messages', 'CG-GATE-HISTORY'),
  show('gate_hi_greeting_limit', 'CG-GATE-HI'),
  show('gate_ping_active', 'CG-GATE-PING'),
  show('context_conflict', 'CG-CONTEXT-CONFLICT'),

  // ── client routes (hub-pr-plan §4.11) ──
  { error: 'client_feature_disabled', reason: 'binding_missing', cg: 'CG-BINDING-MISSING', disposition: 'refresh-bootstrap' },
  { error: 'client_feature_disabled', reason: 'client_outdated', cg: 'CG-HUB-OUTDATED', disposition: 'refresh-bootstrap' },
  { error: 'client_feature_disabled', routes: ['claim'], when: 'dispatch', cg: 'CG-SEND-OFF', disposition: 'refresh-bootstrap' },
  { error: 'client_feature_disabled', cg: 'CG-FEATURE-DISABLED', disposition: 'refresh-bootstrap' },
  { error: 'bad_request', reason: 'cursor_invalid', cg: 'CG-HUB-REQUEST', disposition: 'restart-cursor' },
  { error: 'bad_request', reason: 'cursor_window_mismatch', cg: 'CG-HUB-REQUEST', disposition: 'restart-cursor' },
  show('bad_request', 'CG-HUB-REQUEST', { reason: 'live_text_not_allowed' }),
  show('bad_request', 'CG-HUB-REQUEST', { reason: 'capability_required' }),
  { error: 'generation_not_ready', routes: ['recap-profile'], cg: 'CG-RECAP-SAVE', disposition: 'not-ready' },
  show('generation_not_eligible', 'CG-HUB-REQUEST'),
  show('claim_busy', 'CG-CLAIM-BUSY'),
  /** The fan is already greeted: a sub-case of «busy». */
  show('greeting_done', 'CG-CLAIM-BUSY'),
  show('claim_expired', 'CG-CLAIM-EXPIRED'),
  /** An unresolved send to this fan, the desktop's included. */
  show('custody_held', 'CG-SEND-UNCERTAIN'),
  { error: 'part_already_sent', routes: ['claim'], cg: 'CG-SEND-PART', disposition: 'read-status' },
  show('generation_mismatch', 'CG-CONTEXT-CHANGED'),
  show('attempt_conflict', 'CG-HUB-REQUEST'),
  show('custody_not_owned', 'CG-HUB-REQUEST'),

  // ── general codes that read by route ──
  show('conflict', 'CG-CLAIM-BUSY', { routes: ['claim'] }),
  show('conflict', 'CG-HUB-REQUEST'),
  /** H-5: not this user's, page's or fan's generation → rejected for good. */
  show('not_found', 'CG-HUB-REQUEST', { routes: ['recap-profile'] }),
  show('not_found', 'CG-BINDING-NOT-GRANTED', { routes: ['page', 'claim'], when: 'page-not-granted' }),
  { error: 'not_found', routes: ['page'], when: 'fan-lookup', cg: null, disposition: 'empty' },
  show('not_found', 'CG-HUB-REQUEST'),
  show('bad_request', 'CG-HUB-REQUEST'),

  // ── unknown codes: by status, then the catch-all ──
  show(null, 'CG-HUB-REQUEST', { status: 400 }),
  show(null, 'CG-LOGIN-CREDENTIALS', { status: 401, routes: ['sign-in'] }),
  show(null, 'CG-AUTH-REJECTED', { status: 401 }),
  show(null, 'CG-HUB-FORBIDDEN', { status: 403 }),
  show(null, 'CG-LOGIN-RATE-LIMIT', { status: 429, routes: ['sign-in'], retryAt: 'retry-after' }),
  show(null, 'CG-HUB-RATE-LIMIT', { status: 429, retryAt: 'retry-after' }),
  show(null, 'CG-HUB-UNAVAILABLE', { status: '5xx' }),
  show(null, 'CG-HUB-UNKNOWN'),
];

// ── Failures that are not a hub error code ─────────────────────────────────

export const HUB_TRANSPORT_FAILURES = ['network', 'timeout', 'contract', 'truncated', 'aborted'] as const;
export type HubTransportFailure = (typeof HUB_TRANSPORT_FAILURES)[number];

/**
 * - network: no connection (sign-in: «хаб недоступен при входе»);
 * - timeout: our deadline (sign-in 20 s, §8.2);
 * - contract: a response or frame failed its schema, an undeclared status, an unknown frame;
 * - truncated: SSE EOF without `done`;
 * - aborted: we cancelled (no code; the operation is `canceled`).
 */
export const HUB_TRANSPORT_CODES = {
  network: { default: 'CG-NETWORK', 'sign-in': 'CG-LOGIN-UNAVAILABLE' },
  timeout: { default: 'CG-HUB-TIMEOUT', 'sign-in': 'CG-LOGIN-TIMEOUT' },
  contract: { default: 'CG-HUB-REQUEST' },
  truncated: { default: 'CG-STREAM-TRUNCATED' },
  aborted: { default: null },
} as const satisfies Record<HubTransportFailure, { readonly default: CgCode | null } & Partial<Record<HubRouteClass, CgCode>>>;

/** Outcomes of the hub layer's own checks (§8.2, §8.3, §8.4, H-3 echo rule). */
export const HUB_CLIENT_CHECK_CODES = {
  /** The hub answered a pending reservation: never stored. */
  signInPending: 'CG-LOGIN-PENDING',
  /** Signed in, but bootstrap did not arrive. */
  signInIncomplete: 'CG-LOGIN-INCOMPLETE',
  /** No `client: 'chat-extension'` echo or no `identity.tokenClient`: a full token was issued → revoke it. */
  narrowTokenMissing: 'CG-HUB-OUTDATED',
  bootstrapProtocol: 'CG-HUB-OUTDATED',
  belowMinVersion: 'CG-HUB-OUTDATED',
  /** The vendored SDK's hash is not in `health.compatibleClientSdks`. */
  sdkNotCompatible: 'CG-HUB-OUTDATED',
  bindingMissing: 'CG-BINDING-MISSING',
  bindingAmbiguous: 'CG-BINDING-AMBIGUOUS',
  pageNotGranted: 'CG-BINDING-NOT-GRANTED',
  catalogEmpty: 'CG-PERSONA-NONE',
  personaUnassigned: 'CG-PERSONA-UNASSIGNED',
  personaUnavailable: 'CG-PERSONA-UNAVAILABLE',
  /** `meta.personaDefinitionId` differs from the one we asked for (§7 «Ограда»). */
  personaChangedInMeta: 'CG-PERSONA-CHANGED',
  /** A flag is off or the page's feature is unavailable. */
  featureDisabled: 'CG-FEATURE-DISABLED',
  /** A capability the feature needs is not declared. */
  capabilityMissing: 'CG-HUB-CAPABILITY',
  /** Shared recap absent on «Открыть последний». */
  recapNotFound: 'CG-RECAP-NOT-FOUND',
  /** Split asked for, the parse produced no usable part. */
  outputUnusable: 'CG-OUTPUT-UNUSABLE',
} as const satisfies Record<string, CgCode>;

// ── The resolver (implemented in core) ────────────────────────────────────

export type HubFailure =
  | {
      readonly kind: 'http';
      readonly status: number;
      /** Body `error`; null when the body is not the hub's error shape. */
      readonly error: string | null;
      readonly reason: string | null;
      /** From a `Retry-After` header or body, when present. */
      readonly retryAfterMs: number | null;
    }
  | { readonly kind: 'sse-error'; readonly code: string; readonly retryAfterMs: number | null }
  | { readonly kind: 'transport'; readonly failure: HubTransportFailure };

export interface HubErrorContext {
  readonly route: HubRouteKey;
  /** The failing call carried the current token and sign-in epoch. */
  readonly currentSignIn: boolean;
  /** The page is in the current bootstrap; null when the route has no page. */
  readonly pageGranted: boolean | null;
  /** AI stream: no output frame arrived before the failure. */
  readonly beforeFirstFrame: boolean;
  readonly claimAction: ClaimAction | null;
  /** The call looks up one fan (dossier, fan card). */
  readonly fanLookup: boolean;
  /** Epoch ms, for absolute deadlines. */
  readonly now: number;
}

export interface HubErrorResolution {
  readonly code: CgCode | null;
  readonly disposition: HubErrorDisposition;
  /** Absolute deadline, epoch ms, fixed once (ER-007). */
  readonly retryAt: number | null;
  readonly httpStatus: number | null;
}

/** Pure: SSE codes by HUB_SSE_ERROR_CODES/HUB_SSE_FALLBACKS, HTTP by the first matching HUB_HTTP_ERROR_RULES entry, the rest by HUB_TRANSPORT_CODES. */
export type ResolveHubError = (failure: HubFailure, context: HubErrorContext) => HubErrorResolution;
