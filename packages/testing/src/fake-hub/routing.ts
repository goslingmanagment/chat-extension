// The fake hub's route table (architecture.md §8.1, §12 п. 2): the hub paths of
// every operation the client calls (HUB_ROUTE_PATHS, methods from HUB_ROUTES),
// the operations the client must never call (§8.1 «Никогда»: HUB_FORBIDDEN_
// OPERATIONS and the families behind them), and the mapping of a wire request
// (path params, query, JSON body, the AI capabilities header) to the
// facade-level request that HUB_ROUTE_SCHEMAS[route].request checks. The
// mapping mirrors the vendored SDK's `buildPath`/`buildQuery` and the hub's
// route params; sdk-alignment and routing tests pin both.

import { ClaimOpSchema, HUB_ROUTE_KEYS, HUB_ROUTE_SCHEMAS, HUB_ROUTES, type HUB_FORBIDDEN_OPERATIONS, type HubRouteKey } from '@cg/contracts';
import { ManualClaimGroupSchema } from '@cg/contracts/send-fansly';

import { HUB_ROUTE_PATHS } from '../scenarios/hub/types';
import { type BodySchemaLike } from './ai-rules';

/** The request header the AI stream carries its capability list in (comma list). */
export const AI_CAPABILITIES_HEADER = 'x-kernel-ai-capabilities';

/** Paths of the operations the client must never call: the hub routes behind HUB_FORBIDDEN_OPERATIONS (from the vendored SDK and hub-pr-plan.md §4.9). */
export const FORBIDDEN_OPERATION_ROUTES = {
  aiGatewayStream: { method: 'POST', path: '/api/v1/ai/gateway/stream' },
  aiPersonasList: { method: 'GET', path: '/api/v1/ai/personas' },
  aiPersonaUpsert: { method: 'PUT', path: '/api/v1/ai/personas/:key' },
  aiPersonaArchive: { method: 'DELETE', path: '/api/v1/ai/personas/:key' },
  eventsStream: { method: 'GET', path: '/api/v1/events/stream' },
  eventsSnapshot: { method: 'GET', path: '/api/v1/events/snapshot' },
  eventsV2Stream: { method: 'GET', path: '/api/v1/events/v2/stream' },
  eventsV2Snapshot: { method: 'GET', path: '/api/v1/events/v2/snapshot' },
  eventsV2Facts: { method: 'GET', path: '/api/v1/events/v2/facts' },
  followerOutreachAttempt: { method: 'POST', path: '/api/v1/pages/:pageLabel/follower-outreach/attempt' },
  pageTopSpenders: { method: 'GET', path: '/api/v1/pages/:pageLabel/top-spenders' },
  clientSendCustodyResolve: { method: 'POST', path: '/api/v1/pages/:pageLabel/client-send-custody/:attemptId/resolve' },
  clientSendCustodyList: { method: 'GET', path: '/api/v1/client-send-custody' },
} as const satisfies Record<(typeof HUB_FORBIDDEN_OPERATIONS)[number], { readonly method: string; readonly path: string }>;

/**
 * Whole families of hub routes the client never calls, whatever the method
 * (§8.1 «Никогда», NEG-OFAPI, NEG-NO-SYNC, NEG-LOCAL-HARVEST): OFAPI reads and
 * commands, the event streams, admin and agent routes, the session archive.
 */
export const FORBIDDEN_ROUTE_FAMILIES: ReadonlyArray<readonly [string, RegExp]> = [
  ['ofapi', /^\/api\/v\d+\/ofapi(?:\/|$)/],
  ['events', /^\/api\/v\d+\/events(?:\/|$)/],
  ['admin', /^\/api\/v\d+\/admin(?:\/|$)/],
  ['agent', /^\/api\/v\d+\/agent(?:\/|$)/],
  ['archive', /^\/api\/v\d+\/archive(?:\/|$)/],
  ['harvest', /harvest/i],
  ['conversation-messages', /^\/api\/v\d+\/pages\/[^/]+\/conversations\/[^/]+\/(?:messages|preview)(?:\/|$)/],
];

interface CompiledPath {
  readonly regex: RegExp;
  readonly params: readonly string[];
}

/** `:name` is a param only right after a slash (`/api/v2/spenders:batch` is a literal). */
function compile(template: string): CompiledPath {
  const params: string[] = [];
  const source = template
    .split('/')
    .map((segment) => {
      if (segment.startsWith(':')) {
        params.push(segment.slice(1));
        return '([^/]+)';
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { regex: new RegExp(`^${source}$`), params };
}

/**
 * The hub's router takes a literal segment over a parameter (`/voice-notes/allowance` before `/voice-notes/:id`): a
 * route with fewer parameters is tried first, in the table's order otherwise.
 */
const ROUTE_MATCHERS = HUB_ROUTE_KEYS.map((route) => ({ route, method: HUB_ROUTES[route].method, ...compile(HUB_ROUTE_PATHS[route]) })).sort((a, b) => a.params.length - b.params.length);
const FORBIDDEN_MATCHERS = Object.entries(FORBIDDEN_OPERATION_ROUTES).map(([operation, spec]) => ({ operation, method: spec.method, ...compile(spec.path) }));

export type RouteMatch =
  | { readonly kind: 'route'; readonly route: HubRouteKey; readonly params: Readonly<Record<string, string>> }
  | { readonly kind: 'forbidden'; readonly operation: string }
  | { readonly kind: 'unknown' };

function decodeParams(names: readonly string[], match: RegExpExecArray): Record<string, string> | null {
  const params: Record<string, string> = {};
  for (const [index, name] of names.entries()) {
    try {
      params[name] = decodeURIComponent(match[index + 1] ?? '');
    } catch {
      return null;
    }
  }
  return params;
}

/** Classifies one call by method and path: one of our routes, a forbidden operation or family, or unknown. */
export function matchRoute(method: string, rawPath: string): RouteMatch {
  // The SDK percent-encodes nothing in literal segments; a client that encoded the colon of `spenders:batch` still means it.
  const path = rawPath.replace(/%3a/gi, ':');
  const upper = method.toUpperCase();
  for (const matcher of ROUTE_MATCHERS) {
    if (matcher.method !== upper) continue;
    const match = matcher.regex.exec(path);
    if (match === null) continue;
    const params = decodeParams(matcher.params, match);
    if (params !== null) return { kind: 'route', route: matcher.route, params };
  }
  for (const matcher of FORBIDDEN_MATCHERS) {
    if (matcher.method === upper && matcher.regex.test(path)) return { kind: 'forbidden', operation: matcher.operation };
  }
  for (const [family, pattern] of FORBIDDEN_ROUTE_FAMILIES) if (pattern.test(path)) return { kind: 'forbidden', operation: family };
  return { kind: 'unknown' };
}

// ── wire → facade request ──────────────────────────────────────────────────

interface WireSpec {
  /** Path param on the wire → key of the facade request. */
  readonly params?: Readonly<Record<string, string>>;
  readonly query?: boolean;
  /** `merge`: body keys join the request; `nest`: the body is the request's `body`. */
  readonly body?: 'merge' | 'nest';
  /** Query keys and path params (by their request key) the hub reads as integers (`z.coerce.number().int()`). */
  readonly integers?: readonly string[];
}

const PAGE = { pageLabel: 'pageLabel' } as const;
const PAGE_FAN = { pageLabel: 'pageLabel', fanRef: 'fanRef' } as const;
const VOICE_NOTE = { pageLabel: 'pageLabel', id: 'voiceNoteId' } as const;

/** How each route's wire request becomes its facade request (null spec: the route takes nothing). */
export const WIRE_SPECS: Readonly<Record<Exclude<HubRouteKey, 'aiFeatureStream'>, WireSpec | null>> = {
  authIssueDeviceTokenWithPassword: { body: 'merge' },
  authRevokeCurrentDeviceToken: null,
  health: null,
  me: null,
  clientBootstrap: null,
  aiPersonaCatalog: null,
  aiRecapStatus: { query: true },
  pageConversationProfile: { params: { pageLabel: 'pageLabel', conversationId: 'fanRef' } },
  pageFanProfile: { params: { pageLabel: 'pageLabel', platformUserId: 'fanRef' } },
  spenders: { query: true, integers: ['limit', 'offset'] },
  spenderDetail: { params: { platform: 'platform', platformUserId: 'platformUserId' }, query: true },
  spenderBatch: { body: 'merge' },
  pageSpenderAutoLists: { params: PAGE, query: true },
  ingestObservations: { body: 'merge' },
  clientConversationRecaps: { params: PAGE_FAN, query: true },
  clientFanProfileFromGeneration: { params: PAGE_FAN, body: 'merge' },
  clientConversationFeed: { params: PAGE_FAN, query: true, integers: ['limit', 'summaryWindow'] },
  clientSpenderStats: { params: PAGE, query: true, integers: ['windowDays'] },
  clientSpenderAwaitingReply: { params: PAGE, query: true, integers: ['limit'] },
  clientFanClaim: { params: PAGE_FAN, body: 'nest' },
  clientFanClaimStatus: { params: PAGE_FAN },
  clientAudienceNew: { params: PAGE, query: true, integers: ['windowHours', 'limit'] },
  clientAiUsageDaily: { params: PAGE, query: true, integers: ['days'] },
  clientSendAttributions: { params: PAGE, body: 'merge' },
  clientActivity: { body: 'merge' },
  clientInConversation: { params: PAGE },
  clientFanCard: { params: PAGE_FAN },
  clientFanLinkDecide: { params: PAGE_FAN, body: 'merge' },
  clientFanFactChange: { params: { pageLabel: 'pageLabel', fanRef: 'fanRef', factId: 'factId' }, body: 'merge', integers: ['factId'] },
  clientWinBack: { params: PAGE },
  clientWinBackAttempt: { params: PAGE, body: 'merge' },
  clientHandoff: { params: PAGE },
  voiceNoteCreate: { params: PAGE, body: 'nest' },
  voiceNoteStatus: { params: VOICE_NOTE, integers: ['voiceNoteId'] },
  voiceNoteAudio: { params: VOICE_NOTE, integers: ['voiceNoteId'] },
  voiceNoteAllowance: { params: PAGE },
};

/** What arrived on the wire, already split (the hub's own request parsing). */
export interface WireRequest {
  readonly params: Readonly<Record<string, string>>;
  readonly query: URLSearchParams;
  /** Raw body text; '' when none. */
  readonly bodyText: string;
  readonly contentType: string | null;
  /** `x-kernel-ai-capabilities` (AI stream only). */
  readonly capabilitiesHeader: string | null;
}

export type FacadeRequestResult =
  | { readonly ok: true; readonly request: unknown }
  /** The request is malformed before any schema (bad JSON, duplicate keys, a body where none is taken). */
  | { readonly ok: false; readonly issues: readonly string[] };

const INTEGER = /^-?(?:0|[1-9]\d*)$/;

function queryObject(query: URLSearchParams, integers: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of new Set(query.keys())) {
    const values = query.getAll(key).map((value) => (integers.includes(key) && INTEGER.test(value) ? Number(value) : value));
    // A repeated key is an array, as the hub's querystring parser makes it: the strict schema then refuses it.
    out[key] = values.length === 1 ? values[0] : values;
  }
  return out;
}

function parseBody(wire: WireRequest): { ok: true; body: unknown } | { ok: false; issue: string } {
  if (wire.bodyText === '') return { ok: true, body: undefined };
  if (wire.contentType === null || !/^application\/json\b/i.test(wire.contentType)) return { ok: false, issue: 'body: content-type is not application/json' };
  try {
    return { ok: true, body: JSON.parse(wire.bodyText) as unknown };
  } catch {
    return { ok: false, issue: 'body: not valid JSON' };
  }
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Wire → facade request; the schema check comes after (validateRequest). */
export function facadeRequestOf(route: HubRouteKey, wire: WireRequest): FacadeRequestResult {
  const parsed = parseBody(wire);
  if (!parsed.ok) return { ok: false, issues: [parsed.issue] };
  if (route === 'aiFeatureStream') {
    const header = wire.capabilitiesHeader;
    const capabilities = header === null || header.trim() === '' ? [] : header.split(',').map((item) => item.trim());
    if ([...wire.query.keys()].length > 0) return { ok: false, issues: ['query: the AI stream takes none'] };
    return { ok: true, request: { feature: wire.params['feature'] ?? '', body: parsed.body, capabilities } };
  }
  const spec = WIRE_SPECS[route];
  if (spec === null) {
    const issues = [...([...wire.query.keys()].length > 0 ? ['query: this route takes none'] : []), ...(parsed.body !== undefined ? ['body: this route takes none'] : [])];
    return issues.length > 0 ? { ok: false, issues } : { ok: true, request: null };
  }
  const request: Record<string, unknown> = {};
  for (const [wireName, key] of Object.entries(spec.params ?? {})) {
    const value = wire.params[wireName];
    request[key] = value !== undefined && spec.integers?.includes(key) === true && INTEGER.test(value) ? Number(value) : value;
  }
  const issues: string[] = [];
  const merge = (part: string, extra: Record<string, unknown>): void => {
    for (const [key, value] of Object.entries(extra)) {
      if (Object.prototype.hasOwnProperty.call(request, key)) issues.push(`${part}: \`${key}\` repeats a path parameter`);
      else request[key] = value;
    }
  };
  const query = queryObject(wire.query, spec.integers ?? []);
  if (spec.query === true) merge('query', query);
  else if (Object.keys(query).length > 0) issues.push('query: this route takes none');
  if (spec.body === undefined) {
    if (parsed.body !== undefined) issues.push('body: this route takes none');
  } else if (spec.body === 'nest') {
    request['body'] = parsed.body;
  } else if (parsed.body !== undefined) {
    if (!isPlainObject(parsed.body)) issues.push('body: not a JSON object');
    else merge('body', parsed.body);
  }
  return issues.length > 0 ? { ok: false, issues } : { ok: true, request };
}

// ── the hub's own route schemas (the vendored SDK's `routeSchemas`) ────────

/** One route of the hub as its server reads it: `routeSchemas[route]` of the vendored SDK fits. */
export interface HubRouteSchemasLike {
  readonly params?: BodySchemaLike;
  readonly querystring?: BodySchemaLike;
  readonly body?: BodySchemaLike;
  readonly response: Readonly<Partial<Record<number, BodySchemaLike>>>;
}

/** The hub's route table by operation key; `routeSchemas` of the vendored SDK fits. */
export type HubRouteTableLike = Readonly<Partial<Record<string, HubRouteSchemasLike>>>;

/**
 * What the hub's server refuses in a wire request before its handler runs: the
 * decoded path params, the query (a repeated key is an array, every value a
 * string — the hub's querystring parser) and the JSON body, each by the route's
 * own schema. A part the route has no schema for is not read. The issues name
 * the part, never a value.
 */
export function hubSchemaRefusal(route: HubRouteSchemasLike, wire: { readonly params: Readonly<Record<string, string>>; readonly query: URLSearchParams; readonly body: unknown }): readonly string[] {
  const query: Record<string, string | string[]> = {};
  for (const key of new Set(wire.query.keys())) {
    const values = wire.query.getAll(key);
    query[key] = values.length === 1 ? (values[0] ?? '') : values;
  }
  const parts: readonly (readonly ['params' | 'querystring' | 'body', BodySchemaLike | undefined, unknown])[] = [
    ['params', route.params, wire.params],
    ['querystring', route.querystring, query],
    ['body', route.body, wire.body],
  ];
  return parts.filter(([, schema, value]) => schema !== undefined && !schema.safeParse(value).success).map(([part]) => `${part}: refused by the hub’s own ${part} schema (vendored SDK)`);
}

export type ValidationResult = { readonly ok: true; readonly request: unknown } | { readonly ok: false; readonly issues: readonly string[] };

/** The contracts' request schema of the route (HUB_ROUTE_SCHEMAS), as the hub's 400 does it. Issues name paths and rules, never values. */
export function validateRequest(route: HubRouteKey, request: unknown): ValidationResult {
  // P4c keeps the shared claim schema AI-only for ChatSpace. The fake accepts the hub's wider HF-3 body:
  // validate the manual shape, then all the unchanged fields using a one-part AI placeholder (the old schema
  // takes UUID generation refs only). This placeholder never enters custody. Keep the wire group for
  // platform admission (OnlyFans must refuse it). The real SDK schema is also checked by the HTTP pipeline.
  if (route === 'clientFanClaim' && typeof request === 'object' && request !== null && 'body' in request) {
    const body = request.body;
    if (typeof body === 'object' && body !== null && 'group' in body && typeof body.group === 'object' && body.group !== null) {
      if ('kind' in body.group) {
        const manual = ManualClaimGroupSchema.safeParse(body.group);
        if (!manual.success || !('purpose' in body)) return { ok: false, issues: ['body.group: a manual group needs a lower-case sha256 fingerprint'] };
        const checked = ClaimOpSchema.safeParse({ ...request, body: { ...body, group: { generationRef: '00000000-0000-4000-8000-000000000000', variant: 0, partCount: 1 } } });
        return checked.success
          ? { ok: true, request: { ...checked.data, body: { ...checked.data.body, group: manual.data } } }
          : { ok: false, issues: ['body: invalid manual greeting'] };
      }
      if ('generationRef' in body.group && typeof body.group.generationRef === 'string' && body.group.generationRef.startsWith('manual:')) {
        return { ok: false, issues: ['body.group.generationRef: the manual namespace is reserved'] };
      }
    }
  }
  const schema = HUB_ROUTE_SCHEMAS[route].request;
  if (schema === null) return request === null ? { ok: true, request: null } : { ok: false, issues: ['this route takes no request'] };
  const result = schema.safeParse(request);
  if (result.success) return { ok: true, request: result.data };
  return {
    ok: false,
    issues: result.error.issues.map((issue) => `${issue.path.length === 0 ? '(root)' : issue.path.map(String).join('.')}: ${issue.code}${issue.message === '' ? '' : ` (${issue.message})`}`),
  };
}

/** The hub path of a route with its params filled in (for tests and the control client). */
export function routePath(route: HubRouteKey, params: Readonly<Record<string, string>> = {}): string {
  return HUB_ROUTE_PATHS[route].replace(/\/:([A-Za-z0-9_]+)/g, (_match, name: string) => {
    const value = params[name];
    if (value === undefined) throw new Error(`routePath(${route}): missing param ${name}`);
    return `/${encodeURIComponent(value)}`;
  });
}

export interface WireCall {
  readonly method: string;
  /** Path with params filled in and the query string, if any. */
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  /** JSON body text, when the route takes one. */
  readonly body?: string;
}

/**
 * The HTTP request the client sends for a facade request — the inverse of
 * facadeRequestOf, built like the vendored SDK's buildPath/buildQuery
 * (undefined query values skipped). For tests that call the fake hub by hand.
 */
export function wireOf(route: HubRouteKey, request: unknown): WireCall {
  const method = HUB_ROUTES[route].method;
  const headers: Record<string, string> = {};
  if (route === 'aiFeatureStream') {
    const { feature, body, capabilities } = request as { feature: string; body: unknown; capabilities: readonly string[] };
    if (capabilities.length > 0) headers[AI_CAPABILITIES_HEADER] = capabilities.join(',');
    headers['content-type'] = 'application/json';
    return { method, path: routePath(route, { feature }), headers, body: JSON.stringify(body) };
  }
  const spec = WIRE_SPECS[route];
  if (spec === null) return { method, path: routePath(route), headers };
  const rest: Record<string, unknown> = { ...(request as Record<string, unknown>) };
  const params: Record<string, string> = {};
  for (const [wireName, key] of Object.entries(spec.params ?? {})) {
    params[wireName] = String(rest[key]);
    delete rest[key];
  }
  let path = routePath(route, params);
  if (spec.body === 'nest') {
    headers['content-type'] = 'application/json';
    return { method, path, headers, body: JSON.stringify(rest['body']) };
  }
  if (spec.body === 'merge') {
    headers['content-type'] = 'application/json';
    return { method, path, headers, body: JSON.stringify(rest) };
  }
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(rest)) {
    if (value === undefined || value === null) continue;
    // Query values are scalars (the SDK's buildQuery); anything else is a test bug.
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') throw new Error(`wireOf(${route}): query \`${key}\` is not a scalar`);
    search.append(key, String(value));
  }
  const query = search.toString();
  if (query !== '') path = `${path}?${query}`;
  return { method, path, headers };
}
