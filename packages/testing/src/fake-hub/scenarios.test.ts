// Scenario control of the fake hub (architecture.md §12 п. 2): every HTTP
// scenario of @cg/testing/hub replays answer for answer behind the hub's own
// checks (auth and the contract schema come first); scripts match exactly or
// by route; a request a strict script does not expect is a 500 and a journal
// violation, a lenient one falls back to the model.

import { describe, expect, it } from 'vitest';

import { HTTP_SCENARIOS, PAGE, WORLD, type HttpScenario } from '../scenarios/hub';
import { createFakeHub } from './hub';
import { hubCall } from './kit';

describe('fake hub scenarios: every HTTP scenario replays answer for answer', () => {
  for (const scenario of HTTP_SCENARIOS) {
    it(scenario.name, async () => {
      const hub = createFakeHub();
      const token = hub.issueToken();
      expect(hub.control({ op: 'useHttpScenario', scenario: scenario.name })).toEqual({ ok: true, exchanges: scenario.exchanges.length });
      for (const exchange of scenario.exchanges) {
        const response = await hubCall(hub.fetch, hub.origin, exchange.route, exchange.request, { token });
        expect({ route: exchange.route, status: response.status, body: (await response.json()) as unknown }).toEqual({ route: exchange.route, status: exchange.response.status, body: exchange.response.body });
        expect(response.headers.get('retry-after')).toBe(exchange.response.retryAfterSec === undefined ? null : String(exchange.response.retryAfterSec));
      }
      expect(hub.status().script).toEqual({ httpLeft: 0, sseLeft: 0, httpLeftRoutes: [] });
      expect(hub.violations()).toEqual([]);
      expect(new Set(hub.read().entries.map((entry) => entry.servedBy))).toEqual(new Set(['script']));
    });
  }
});

describe('fake hub scenarios: script control', () => {
  const statsRequest = { pageLabel: PAGE, windowDays: 30, timeZone: 'Europe/Moscow' };
  const scripted = { status: 200, body: { scripted: true } };

  it('a strict script refuses what it does not expect: 500 unscripted_request, journaled as a violation', async () => {
    const hub = createFakeHub();
    const token = hub.issueToken();
    hub.control({ op: 'useHttpScenario', scenario: 'spenders-stats-and-queue' });
    const response = await hubCall(hub.fetch, hub.origin, 'clientSpenderStats', { ...statsRequest, timeZone: 'UTC' }, { token });
    expect({ status: response.status, body: (await response.json()) as unknown }).toEqual({ status: 500, body: { error: 'internal_error', message: 'fake hub: internal_error', statusCode: 500, reason: 'unscripted_request' } });
    expect(hub.violations().map((entry) => [entry.route, entry.servedBy])).toEqual([['clientSpenderStats', 'unscripted']]);
    expect(hub.status().script.httpLeftRoutes).toEqual(['clientSpenderStats', 'clientSpenderAwaitingReply', 'clientSpenderAwaitingReply', 'pageSpenderAutoLists', 'clientSpenderStats']);
  });

  it('a lenient script lets the model answer the rest', async () => {
    const hub = createFakeHub();
    const token = hub.issueToken();
    hub.control({ op: 'useHttpScenario', scenario: 'spenders-stats-and-queue', unscripted: 'model' });
    const response = await hubCall(hub.fetch, hub.origin, 'clientSpenderStats', { ...statsRequest, timeZone: 'UTC' }, { token });
    expect(response.status).toBe(200);
    expect(hub.read().entries.at(-1)?.servedBy).toBe('model');
    expect(hub.violations()).toEqual([]);
  });

  it('`route` matching takes the path params only: any query or body of the same page and fan', async () => {
    const hub = createFakeHub();
    const token = hub.issueToken();
    hub.control({ op: 'scriptHttp', match: 'route', exchanges: [{ route: 'clientSpenderStats', request: statsRequest, response: scripted }] });
    const otherPage = await hubCall(hub.fetch, hub.origin, 'clientSpenderStats', { ...statsRequest, pageLabel: WORLD.pages.vip.pageLabel }, { token });
    expect(await otherPage.json()).not.toEqual({ scripted: true });
    const sameRoute = await hubCall(hub.fetch, hub.origin, 'clientSpenderStats', { ...statsRequest, timeZone: 'UTC' }, { token });
    expect(await sameRoute.json()).toEqual({ scripted: true });
    expect(hub.status().script.httpLeft).toBe(0);
  });

  it('`exact` matching (the default) needs the same request; scriptHttp appends and keeps the model behind', async () => {
    const hub = createFakeHub();
    const token = hub.issueToken();
    expect(hub.control({ op: 'scriptHttp', exchanges: [{ route: 'clientSpenderStats', request: statsRequest, response: scripted }] })).toEqual({ ok: true, exchanges: 1 });
    expect(await (await hubCall(hub.fetch, hub.origin, 'clientSpenderStats', { ...statsRequest, timeZone: 'UTC' }, { token })).json()).not.toEqual({ scripted: true });
    expect(await (await hubCall(hub.fetch, hub.origin, 'clientSpenderStats', statsRequest, { token })).json()).toEqual({ scripted: true });
  });

  it('the hub’s own checks come first: a script never answers an unauthenticated or invalid request', async () => {
    const hub = createFakeHub();
    const token = hub.issueToken();
    hub.control({ op: 'scriptHttp', match: 'route', exchanges: [{ route: 'clientSpenderStats', request: statsRequest, response: scripted }] });
    expect((await hubCall(hub.fetch, hub.origin, 'clientSpenderStats', statsRequest)).status).toBe(401);
    expect((await hubCall(hub.fetch, hub.origin, 'clientSpenderStats', { ...statsRequest, windowDays: 7 }, { token })).status).toBe(400);
    expect(hub.status().script.httpLeft).toBe(1);
  });

  it('inline scenarios, clearScripts, and an unknown scenario name', async () => {
    const hub = createFakeHub();
    const token = hub.issueToken();
    const inline: HttpScenario = { name: 'inline', description: 'one exchange', exchanges: [{ route: 'me', request: null, response: { status: 503, body: { error: 'service_unavailable', message: 'x', statusCode: 503 }, retryAfterSec: 3 } }] };
    hub.control({ op: 'useHttpScenario', scenario: inline });
    const me = await hubCall(hub.fetch, hub.origin, 'me', null, { token });
    expect({ status: me.status, retryAfter: me.headers.get('retry-after') }).toEqual({ status: 503, retryAfter: '3' });
    expect(hub.read().entries.at(-1)).toMatchObject({ error: 'service_unavailable', servedBy: 'script' });
    hub.control({ op: 'useHttpScenario', scenario: inline });
    hub.control({ op: 'clearScripts' });
    expect((await hubCall(hub.fetch, hub.origin, 'me', null, { token })).status).toBe(200);
    expect(() => hub.control({ op: 'useHttpScenario', scenario: 'no-such' })).toThrow(/no HTTP scenario/);
  });
});
