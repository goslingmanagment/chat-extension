// RouteTransport: the client/* routes of the hub plan that the vendored
// @kernel/sdk does not have yet — the archive feed (H-9c), the Spenders
// statistics and «ждут ответа» (H-8b, H-8c), the claim and its status (H-7b),
// «Новые» (H-7c): their hub PRs are still drafts. ONE module on purpose:
// once the hub is re-vendored with them, each key here becomes an SDK
// operation (`kernelOperations[key]`, `routeSchemas[key]`) and leaves this
// file — the sdk-alignment test in @cg/testing fails the day a key appears
// in the SDK. The routes that already arrived (bootstrap, shared recaps, the
// dossier save, the AI usage) go through the SDK path (transport.ts). Same
// auth and headers as the SDK path; requests and answers are checked with
// the frozen contract schemas (HUB_ROUTE_SCHEMAS) on both ends.

import { HUB_ROUTES, type HubRouteKey } from '@cg/contracts';

import { type FetchLike } from './ports';
import { bodyOf, requestParts } from './request-parts';

/** Hub routes this transport serves: every contract route not yet in the SDK. */
export type ClientRouteKey = {
  [K in HubRouteKey]: (typeof HUB_ROUTES)[K]['since'] extends 'sdk' ? never : K;
}[HubRouteKey];

/** Paths of hub-pr-plan §4 (contracts carry none: they are sdk-custody markers). */
export const CLIENT_ROUTE_PATHS = {
  clientConversationFeed: '/api/v1/client/pages/:pageLabel/conversations/:fanRef/feed',
  clientSpenderStats: '/api/v1/client/pages/:pageLabel/spenders/stats',
  clientSpenderAwaitingReply: '/api/v1/client/pages/:pageLabel/spenders/awaiting-reply',
  clientFanClaim: '/api/v1/client/pages/:pageLabel/fans/:fanRef/claim',
  clientFanClaimStatus: '/api/v1/client/pages/:pageLabel/fans/:fanRef/claim',
  clientAudienceNew: '/api/v1/client/pages/:pageLabel/audience-new',
} as const satisfies Record<ClientRouteKey, string>;

export const CLIENT_ROUTE_KEYS = Object.keys(CLIENT_ROUTE_PATHS) as ClientRouteKey[];

export function isClientRoute(route: HubRouteKey): route is ClientRouteKey {
  return Object.prototype.hasOwnProperty.call(CLIENT_ROUTE_PATHS, route);
}

export interface WireRequest {
  readonly method: 'GET' | 'POST' | 'DELETE';
  /** Path with the params filled in, plus the query string. */
  readonly pathAndQuery: string;
  readonly body: unknown;
}

/**
 * The facade-level request (path params + query, or path params + body; a
 * claim carries its body under `body`) → method, path and body. Throws when
 * the request fails its strict contract schema: that is our bug, never sent.
 */
export function clientWireRequest(route: ClientRouteKey, request: unknown): WireRequest {
  const { params, rest } = requestParts(route, CLIENT_ROUTE_PATHS[route], request);
  const path = CLIENT_ROUTE_PATHS[route].replace(/\/:([A-Za-z0-9_]+)/g, (_match, name: string) => `/${encodeURIComponent(String(params[name]))}`);
  const { method } = HUB_ROUTES[route];
  if (method === 'GET') return { method, pathAndQuery: `${path}${queryString(rest)}`, body: undefined };
  return { method, pathAndQuery: path, body: bodyOf(rest) };
}

/** Query values of the client routes are strings, numbers or booleans (the contract schemas are flat); anything else is our bug. */
function queryString(fields: Readonly<Record<string, unknown>>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') throw new TypeError(`query field ${key} is not a scalar`);
    search.append(key, String(value));
  }
  const text = search.toString();
  return text === '' ? '' : `?${text}`;
}

export interface RouteCaller {
  readonly hubOrigin: string;
  readonly token: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly fetch: FetchLike;
  readonly signal: AbortSignal;
}

/** One call of a client route; network errors propagate as thrown (the caller reads them with thrownFailure). */
export async function sendClientRoute(caller: RouteCaller, wire: WireRequest): Promise<Response> {
  const headers: Record<string, string> = { accept: 'application/json', ...caller.headers, authorization: `Bearer ${caller.token}` };
  const init: RequestInit = { method: wire.method, headers, signal: caller.signal };
  if (wire.body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(wire.body);
  }
  return caller.fetch(`${caller.hubOrigin}${wire.pathAndQuery}`, init);
}
