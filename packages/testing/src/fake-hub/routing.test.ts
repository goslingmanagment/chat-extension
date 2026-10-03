// The fake hub's route table against the contracts and the vendored SDK: every
// route of HUB_ROUTES is served at its SDK path and method; every forbidden
// operation and family is recognised; the wire ↔ facade mapping round-trips
// every scenario request; malformed wire requests are refused before the
// schema, and schema violations name paths, never values.

import { HUB_FORBIDDEN_OPERATIONS, HUB_ROUTE_KEYS, HUB_ROUTES, type HubRouteKey } from '@cg/contracts';
import { kernelOperations } from '@kernel/sdk';
import { describe, expect, it } from 'vitest';

import { HTTP_SCENARIOS, HUB_ROUTE_PATHS, SSE_SCENARIOS } from '../scenarios/hub';
import { FORBIDDEN_OPERATION_ROUTES, FORBIDDEN_ROUTE_FAMILIES, facadeRequestOf, matchRoute, routePath, validateRequest, wireOf, type WireRequest } from './routing';

const sdkOperations = kernelOperations as unknown as Readonly<Record<string, { method: string; path: string }>>;

const SAMPLE_PARAMS: Readonly<Record<string, string>> = { pageLabel: 'model-one', fanRef: '2002', conversationId: '2002', platformUserId: '5001', platform: 'onlyfans', feature: 'fast-reply' };

/** The wire request of a facade request, as the fake hub's own parser sees it. */
function wireRequestOf(route: HubRouteKey, request: unknown): { readonly path: string; readonly wire: WireRequest } {
  const call = wireOf(route, request);
  const url = new URL(call.path, 'http://hub.test');
  const match = matchRoute(call.method, url.pathname);
  if (match.kind !== 'route' || match.route !== route) throw new Error(`${route}: ${call.method} ${url.pathname} did not route back (${match.kind})`);
  return {
    path: url.pathname,
    wire: {
      params: match.params,
      query: url.searchParams,
      bodyText: call.body ?? '',
      contentType: call.headers['content-type'] ?? null,
      capabilitiesHeader: call.headers['x-kernel-ai-capabilities'] ?? null,
    },
  };
}

const emptyWire = (over: Partial<WireRequest> = {}): WireRequest => ({ params: {}, query: new URLSearchParams(), bodyText: '', contentType: null, capabilitiesHeader: null, ...over });

describe('fake hub routing: the route table', () => {
  it('serves every route of HUB_ROUTES at its path and method', () => {
    expect(Object.keys(HUB_ROUTE_PATHS).sort()).toEqual([...HUB_ROUTE_KEYS].sort());
    for (const route of HUB_ROUTE_KEYS) {
      const params: Record<string, string> = Object.fromEntries([...HUB_ROUTE_PATHS[route].matchAll(/\/:([A-Za-z0-9_]+)/g)].map(([, name = '']): [string, string] => [name, SAMPLE_PARAMS[name] ?? 'x']));
      const path = routePath(route, params);
      const match = matchRoute(HUB_ROUTES[route].method, path);
      expect(match, route).toEqual({ kind: 'route', route, params });
    }
  });

  it('existing SDK operations sit at the SDK path and method (the client calls them through the SDK)', () => {
    for (const route of HUB_ROUTE_KEYS.filter((key) => HUB_ROUTES[key].since === 'sdk')) {
      expect(sdkOperations[route], route).toEqual({ method: HUB_ROUTES[route].method, path: HUB_ROUTE_PATHS[route] });
    }
  });

  it('claim and its status share a path and differ by method; another method on a known path is unknown', () => {
    const path = routePath('clientFanClaim', { pageLabel: 'model-one', fanRef: '2010' });
    expect(matchRoute('POST', path)).toMatchObject({ kind: 'route', route: 'clientFanClaim' });
    expect(matchRoute('get', path)).toMatchObject({ kind: 'route', route: 'clientFanClaimStatus' });
    expect(matchRoute('PUT', path)).toEqual({ kind: 'unknown' });
    expect(matchRoute('DELETE', '/api/v1/health')).toEqual({ kind: 'unknown' });
  });

  it('`spenders:batch` is a literal colon, encoded or not; the board and the fan card stay apart', () => {
    expect(matchRoute('POST', '/api/v2/spenders:batch')).toMatchObject({ kind: 'route', route: 'spenderBatch' });
    expect(matchRoute('POST', '/api/v2/spenders%3Abatch')).toMatchObject({ kind: 'route', route: 'spenderBatch' });
    expect(matchRoute('GET', '/api/v2/spenders')).toMatchObject({ kind: 'route', route: 'spenders' });
    expect(matchRoute('GET', '/api/v2/spenders/onlyfans/5001')).toMatchObject({ kind: 'route', route: 'spenderDetail', params: { platform: 'onlyfans', platformUserId: '5001' } });
  });

  it('decodes path params; a broken escape is no route', () => {
    expect(matchRoute('GET', '/api/v1/client/pages/model%20one/spenders/stats')).toMatchObject({ params: { pageLabel: 'model one' } });
    expect(matchRoute('GET', '/api/v1/client/pages/%E0%A4%A/spenders/stats')).toEqual({ kind: 'unknown' });
  });
});

describe('fake hub routing: operations the client must never call (§8.1 «Никогда»)', () => {
  it('every HUB_FORBIDDEN_OPERATIONS key has a path, and the SDK ones match the vendored SDK', () => {
    expect(Object.keys(FORBIDDEN_OPERATION_ROUTES).sort()).toEqual([...HUB_FORBIDDEN_OPERATIONS].sort());
    for (const [operation, spec] of Object.entries(FORBIDDEN_OPERATION_ROUTES)) {
      const sdk = sdkOperations[operation];
      if (sdk !== undefined) expect(spec, operation).toEqual(sdk);
      const path = spec.path.replace(/:([A-Za-z0-9_]+)/g, 'x1');
      expect(matchRoute(spec.method, path), operation).toEqual({ kind: 'forbidden', operation });
    }
  });

  it('whole families are forbidden whatever the method: OFAPI, events, admin, agent, archive, harvest, session messages', () => {
    const cases: Array<[string, string, string]> = [
      ['GET', '/api/v1/ofapi/read/chats', 'ofapi'],
      ['POST', '/api/v1/ofapi/commands', 'ofapi'],
      ['GET', '/api/v1/events/v2/facts', 'eventsV2Facts'],
      ['POST', '/api/v1/events/anything', 'events'],
      ['PATCH', '/api/v1/admin/users/by-id/7/device-tokens/1/harvest-capability', 'admin'],
      ['POST', '/api/v1/agent/search/messages', 'agent'],
      ['GET', '/api/v1/archive/conversations/x/messages', 'archive'],
      ['POST', '/api/v1/ingest/harvest', 'harvest'],
      ['GET', '/api/v1/pages/model-one/conversations/2002/messages', 'conversation-messages'],
      ['GET', '/api/v1/pages/model-one/conversations/2002/preview', 'conversation-messages'],
    ];
    for (const [method, path, operation] of cases) expect(matchRoute(method, path), path).toEqual({ kind: 'forbidden', operation });
    expect(FORBIDDEN_ROUTE_FAMILIES.map(([family]) => family)).toContain('ofapi');
  });

  it('no forbidden family shadows one of our routes', () => {
    for (const route of HUB_ROUTE_KEYS) {
      for (const [family, pattern] of FORBIDDEN_ROUTE_FAMILIES) expect(pattern.test(HUB_ROUTE_PATHS[route]), `${route} vs ${family}`).toBe(false);
    }
  });

  it('anything else is unknown', () => {
    expect(matchRoute('GET', '/')).toEqual({ kind: 'unknown' });
    expect(matchRoute('GET', '/api/v1/pages/model-one/top-spender')).toEqual({ kind: 'unknown' });
  });
});

describe('fake hub routing: wire ↔ facade request', () => {
  it('round-trips every request of every HTTP scenario and passes the contract schema', () => {
    for (const scenario of HTTP_SCENARIOS) {
      for (const exchange of scenario.exchanges) {
        const { wire } = wireRequestOf(exchange.route, exchange.request);
        const facade = facadeRequestOf(exchange.route, wire);
        expect(facade, `${scenario.name} ${exchange.route}`).toEqual({ ok: true, request: exchange.request });
        if (facade.ok) expect(validateRequest(exchange.route, facade.request).ok, `${scenario.name} ${exchange.route}`).toBe(true);
      }
    }
  });

  it('round-trips every AI stream request, the capabilities header included', () => {
    for (const scenario of SSE_SCENARIOS) {
      const { wire } = wireRequestOf('aiFeatureStream', scenario.request);
      expect(facadeRequestOf('aiFeatureStream', wire), scenario.name).toEqual({ ok: true, request: JSON.parse(JSON.stringify(scenario.request)) as unknown });
    }
    expect(facadeRequestOf('aiFeatureStream', emptyWire({ params: { feature: 'ping' }, bodyText: '{}', contentType: 'application/json', capabilitiesHeader: ' context-v1 , split-all-v1 ' }))).toEqual({
      ok: true,
      request: { feature: 'ping', body: {}, capabilities: ['context-v1', 'split-all-v1'] },
    });
  });

  it('reads integer query keys as numbers, the rest as strings; a repeated key is an array (the schema refuses it)', () => {
    const query = new URLSearchParams('scope=page&pageLabel=model-one&period=30d&limit=200&offset=0&query=007');
    const facade = facadeRequestOf('spenders', emptyWire({ query }));
    expect(facade).toEqual({ ok: true, request: { scope: 'page', pageLabel: 'model-one', period: '30d', limit: 200, offset: 0, query: '007' } });
    const twice = facadeRequestOf('spenders', emptyWire({ query: new URLSearchParams('limit=1&limit=2') }));
    expect(twice.ok && (twice.request as Record<string, unknown>)['limit']).toEqual([1, 2]);
    const notInt = facadeRequestOf('clientConversationFeed', emptyWire({ params: { pageLabel: 'p', fanRef: '2002' }, query: new URLSearchParams('limit=1.5') }));
    expect(notInt.ok && validateRequest('clientConversationFeed', notInt.request).ok).toBe(false);
  });

  it('refuses malformed wire requests before any schema', () => {
    const json = { contentType: 'application/json' };
    expect(facadeRequestOf('me', emptyWire({ query: new URLSearchParams('x=1') }))).toEqual({ ok: false, issues: ['query: this route takes none'] });
    expect(facadeRequestOf('me', emptyWire({ bodyText: '{}', ...json }))).toEqual({ ok: false, issues: ['body: this route takes none'] });
    expect(facadeRequestOf('spenderBatch', emptyWire({ bodyText: '{', ...json }))).toEqual({ ok: false, issues: ['body: not valid JSON'] });
    expect(facadeRequestOf('spenderBatch', emptyWire({ bodyText: '{}', contentType: 'text/plain' }))).toEqual({ ok: false, issues: ['body: content-type is not application/json'] });
    expect(facadeRequestOf('spenderBatch', emptyWire({ bodyText: '[1]', ...json }))).toEqual({ ok: false, issues: ['body: not a JSON object'] });
    expect(facadeRequestOf('clientFanClaimStatus', emptyWire({ params: { pageLabel: 'p', fanRef: '1' }, query: new URLSearchParams('a=1') }))).toEqual({ ok: false, issues: ['query: this route takes none'] });
    expect(facadeRequestOf('clientFanClaimStatus', emptyWire({ params: { pageLabel: 'p', fanRef: '1' }, bodyText: '{}', ...json }))).toEqual({ ok: false, issues: ['body: this route takes none'] });
    expect(facadeRequestOf('clientSpenderStats', emptyWire({ params: { pageLabel: 'p' }, query: new URLSearchParams('pageLabel=q') }))).toEqual({
      ok: false,
      issues: ['query: `pageLabel` repeats a path parameter'],
    });
    expect(facadeRequestOf('aiFeatureStream', emptyWire({ params: { feature: 'ping' }, query: new URLSearchParams('x=1') }))).toEqual({ ok: false, issues: ['query: the AI stream takes none'] });
  });

  it('schema issues name the path and the rule, never the value', () => {
    const result = validateRequest('authIssueDeviceTokenWithPassword', { username: 'chatter1', password: 'secret-value', label: 'x', mode: 'active', extra: 'leak-me' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.join(' ')).not.toContain('secret-value');
      expect(result.issues.join(' ')).not.toContain('leak-me');
      expect(result.issues.join(' ')).toContain('unrecognized_keys');
    }
    expect(validateRequest('me', null)).toEqual({ ok: true, request: null });
    expect(validateRequest('me', {})).toEqual({ ok: false, issues: ['this route takes no request'] });
  });
});
