// The client/* routes, all of them through the vendored SDK since the
// re-vendor of hub c8514c5c: archive feed (H-9), «Новые» (H-7c), claim and
// custody (H-7b), Spenders statistics and «ждут ответа» (H-8), shared recaps
// and the dossier (H-13, H-5), every scenario of the fake hub with its
// expected reading (parity NF-010, NF-023, NF-026, SN-012, AI-060…AI-071,
// AI-097, NEW-02, HB-006).

import { CLAIM_REVISION_MAX, CLIENT_FEATURE_FLAG_NAMES, HUB_ROUTE_KEYS, HUB_ROUTES, isHubCallError, isHubCheckError, type ClaimOp } from '@cg/contracts';
import { HUB_SAMPLES } from '@cg/contracts/fixtures';
import { BOOTSTRAP_PILOT_ON, HTTP_SCENARIOS, HUB_ROUTE_PATHS, NOW_MS, PAGE, WORLD, uuid, type HttpExchange, pageFeaturesOff } from '@cg/testing/hub';
import { kernelOperations } from '@kernel/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { errorWireOf, isSdkRoute, sdkInputOf, type ChatExtensionHub } from '../src/index';
import { hubError, json } from './support/fake-hub';
import { flush, makeHarness, signIn, type Harness } from './support/harness';
import { scenarioNamed, signInWorld } from './support/world';

const SIGN_IN = scenarioNamed(HTTP_SCENARIOS, 'sign-in-and-bootstrap-all-off');
/**
 * Every page feature available (X8 included), so only the hub's own answers decide — and every top-level flag
 * false, as on a hub whose owner switches pages on one by one: the facade reads the page, never those.
 */
const BOOTSTRAP_ALL_ON = {
  ...BOOTSTRAP_PILOT_ON,
  flags: Object.fromEntries(CLIENT_FEATURE_FLAG_NAMES.map((flag) => [flag, false])),
  pages: BOOTSTRAP_PILOT_ON.pages.map((page) => (page.platform === 'onlyfans' ? { ...page, features: Object.fromEntries(CLIENT_FEATURE_FLAG_NAMES.map((flag) => [flag, { available: true }])) } : page)),
};
const WORLD_ON = signInWorld(SIGN_IN, BOOTSTRAP_ALL_ON, WORLD.user.username);

/** The facade method of one scenario exchange (the routes the data scenarios use). */
function call(facade: ChatExtensionHub, exchange: HttpExchange): Promise<unknown> {
  const request = exchange.request as never;
  // eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check -- only the data scenarios' routes
  switch (exchange.route) {
    case 'clientConversationFeed':
      return facade.feed(request);
    case 'clientAudienceNew':
      return facade.audienceNew(request);
    case 'clientFanClaim':
      return facade.claim(request);
    case 'clientFanClaimStatus': {
      const { pageLabel, fanRef } = exchange.request as { pageLabel: string; fanRef: string };
      return facade.claimStatus(pageLabel, fanRef);
    }
    case 'clientConversationRecaps':
      return facade.recaps(request);
    case 'clientFanProfileFromGeneration':
      return facade.profileFromGeneration(request);
    case 'pageConversationProfile':
      return facade.dossier(request);
    case 'pageFanProfile':
      return facade.fanDossier(request);
    case 'clientSpenderStats':
      return facade.spendersStats(request);
    case 'clientSpenderAwaitingReply':
      return facade.awaitingReply(request);
    case 'pageSpenderAutoLists':
      return facade.autoLists((exchange.request as { pageLabel: string }).pageLabel);
    default:
      throw new Error(`no facade call for ${exchange.route}`);
  }
}

let h: Harness;
beforeEach(async () => {
  vi.useFakeTimers({ now: NOW_MS, toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
  h = makeHarness({ paths: HUB_ROUTE_PATHS });
  await signIn(h, WORLD_ON);
  await flush(20);
});
afterEach(() => {
  h.facade.dispose();
  vi.useRealTimers();
});

const DATA_SCENARIOS = [
  'feed-pages',
  'audience-new',
  'claim-greeting-two-parts',
  'claim-uncertain-held',
  'claim-refusals',
  'preview-reply-rejected-then-sent',
  'register-native-send',
  'recaps-and-dossier',
] as const;

describe('[NF-010] [NF-023] [AI-061] every client-route scenario of the fake hub, exchange by exchange', () => {
  for (const name of DATA_SCENARIOS) {
    const scenario = scenarioNamed(HTTP_SCENARIOS, name);
    it(`[NF-010] ${name}: ${scenario.description}`, async () => {
      for (const exchange of scenario.exchanges) {
        // The fake hub answers exactly this request (path, query, body), once.
        const before = h.hub.requests.length;
        const served = h.hub.serve([exchange]);
        const outcome = await call(h.facade, exchange).then(
          (value) => ({ ok: true as const, value }),
          (error: unknown) => ({ ok: false as const, error }),
        );
        const sent = h.hub.requests.slice(before).filter((request) => request.route === exchange.route);
        if (exchange.facts?.pageGranted === false) {
          // A page outside the bootstrap is refused before any request.
          expect(sent).toEqual([]);
          expect(outcome.ok ? null : isHubCheckError(outcome.error) && outcome.error.code).toBe(exchange.expect?.cg);
          continue;
        }
        expect(served.left()).toEqual([]);
        expect(sent).toHaveLength(1);
        if (exchange.expect === undefined) {
          if (!outcome.ok) throw outcome.error as Error;
          if (exchange.route === 'clientFanProfileFromGeneration') expect(outcome.value).toEqual({ state: 'saved', response: exchange.response.body });
          else expect(outcome.value).toEqual(exchange.response.body);
          continue;
        }
        // An error answer: the expected reading, or the facade's settled outcome for it.
        if (exchange.expect.disposition === 'not-ready') {
          expect(outcome).toEqual({ ok: true, value: { state: 'not-ready' } });
          continue;
        }
        if (exchange.route === 'clientFanProfileFromGeneration') {
          expect(outcome).toEqual({ ok: true, value: { state: 'rejected', reason: (exchange.response.body as { reason?: string }).reason ?? null } });
          continue;
        }
        if (exchange.expect.disposition === 'empty') {
          expect(outcome).toEqual({ ok: true, value: null });
          continue;
        }
        expect(outcome.ok).toBe(false);
        const error = outcome.ok ? null : outcome.error;
        expect(isHubCallError(error) && error.resolution).toMatchObject({ code: exchange.expect.cg, disposition: exchange.expect.disposition });
        if (exchange.response.retryAfterSec !== undefined) expect(errorWireOf(error)?.retryAt).toBe(NOW_MS + exchange.response.retryAfterSec * 1000);
      }
      expect(h.hub.unexpected).toEqual([]);
    });
  }

  it('[AI-061] [AI-060] the recap status line: metadata only, by page, conversation, fan and persona', async () => {
    h.hub.on('aiRecapStatus', () => json(200, HUB_SAMPLES.recapStatus));
    const query = { pageLabel: PAGE, conversationRef: WORLD.fan, fanRef: WORLD.fan, personaDefinitionId: WORLD.persona.definitionId };
    await expect(h.facade.recapStatus(query)).resolves.toEqual(HUB_SAMPLES.recapStatus);
    expect(h.hub.of('aiRecapStatus')[0]).toMatchObject({ path: '/api/v1/ai/recap-status', query: { pageLabel: PAGE, conversationRef: WORLD.fan, fanRef: WORLD.fan, personaDefinitionId: WORLD.persona.definitionId } });
    expect(errorWireOf(await h.facade.recapStatus({ ...query, pageLabel: 'not-my-page' }).catch((reason: unknown) => reason))?.code).toBe('CG-BINDING-NOT-GRANTED');
  });

  it('[AI-069] the shared recaps of a page, fan and persona come as the hub keeps them', async () => {
    const exchange = scenarioNamed(HTTP_SCENARIOS, 'recaps-and-dossier').exchanges[0];
    h.hub.serve(exchange === undefined ? [] : [exchange]);
    await expect(h.facade.recaps({ pageLabel: PAGE, fanRef: WORLD.fan, personaDefinitionId: WORLD.persona.definitionId })).resolves.toEqual(exchange?.response.body);
  });

  it('[AI-071] the dossier of an unknown fan is null (a granted page\'s 404 on a fan lookup)', async () => {
    h.hub.on('pageConversationProfile', () => hubError(404, 'not_found'));
    await expect(h.facade.dossier({ pageLabel: PAGE, fanRef: WORLD.otherFan })).resolves.toBeNull();
  });
});

describe('[NF-026] claim and custody: never repeated, flags checked for taking work only', () => {
  const dispatch = (purpose: 'greeting' | 'preview-reply'): ClaimOp => ({
    pageLabel: PAGE,
    fanRef: WORLD.newFan,
    body: {
      action: 'dispatch',
      attemptId: uuid(0x4a1),
      instanceId: WORLD.instanceId,
      purpose,
      group: { generationRef: uuid(0x200), variant: 0, partCount: 1 },
      partIndex: 0,
      textRevision: 0,
      ...(purpose === 'greeting' ? { leaseToken: uuid(0x300) } : {}),
      flagRevision: WORLD.configRevision,
    },
  });

  it('[NF-026] a dispatch that fails (503, network, timeout) is asked exactly once', async () => {
    for (const answer of [() => hubError(503, 'service_unavailable'), () => 'network-error' as const]) {
      const before = h.hub.of('clientFanClaim').length;
      h.hub.on('clientFanClaim', answer);
      const error = await h.facade.claim(dispatch('preview-reply')).catch((reason: unknown) => reason);
      expect(isHubCallError(error)).toBe(true);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(h.hub.of('clientFanClaim').length - before).toBe(1);
    }
    h.hub.on('clientFanClaim', () => 'hang');
    const before = h.hub.of('clientFanClaim').length;
    const timedOut = h.facade.claim(dispatch('preview-reply')).catch((reason: unknown) => reason);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(errorWireOf(await timedOut)?.code).toBe('CG-HUB-TIMEOUT');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.hub.of('clientFanClaim').length - before).toBe(1);
  });

  it('[NF-026] previewSend off on the page: a dispatch is refused locally with CG-SEND-OFF; registerNativeSend and reports still go', async () => {
    await signIn(h, { ...WORLD_ON, bootstrap: BOOTSTRAP_PILOT_ON });
    expect(errorWireOf(await h.facade.claim(dispatch('preview-reply')).catch((reason: unknown) => reason))).toEqual({ code: 'CG-SEND-OFF', detail: 'flag_off' });
    expect(h.hub.of('clientFanClaim')).toEqual([]);
    const state = scenarioNamed(HTTP_SCENARIOS, 'register-native-send').exchanges[0];
    h.hub.on('clientFanClaim', () => json(200, state?.response.body));
    await h.facade.claim(state?.request as ClaimOp);
    await h.facade.claim({ pageLabel: PAGE, fanRef: WORLD.newFan, body: { action: 'failed', attemptId: uuid(0x4a2), instanceId: WORLD.instanceId, reason: 'not_enqueued' } });
    expect(h.hub.of('clientFanClaim')).toHaveLength(2);
  });

  it('[NF-023] «Новые» off: a lease is refused locally; a status read is not', async () => {
    const off = pageFeaturesOff(BOOTSTRAP_ALL_ON, ['newcomers']);
    await signIn(h, { ...WORLD_ON, bootstrap: off });
    const lease: ClaimOp = { pageLabel: PAGE, fanRef: WORLD.newFan, body: { action: 'claim', leaseToken: uuid(0x300), instanceId: WORLD.instanceId } };
    expect(errorWireOf(await h.facade.claim(lease).catch((reason: unknown) => reason))).toEqual({ code: 'CG-FEATURE-DISABLED', detail: 'flag_off' });
    expect(errorWireOf(await h.facade.audienceNew({ pageLabel: PAGE, windowHours: 48 }).catch((reason: unknown) => reason))?.code).toBe('CG-FEATURE-DISABLED');
    h.hub.on('clientFanClaimStatus', () => json(200, scenarioNamed(HTTP_SCENARIOS, 'claim-greeting-two-parts').exchanges[0]?.response.body));
    await expect(h.facade.claimStatus(PAGE, WORLD.newFan)).resolves.toMatchObject({ greeting: { state: 'none' } });
  });
});

/** The six client/* routes that came with the re-vendor of hub c8514c5c (hub PRs #477–#481). */
const ARRIVED_C8514C5C = ['clientAudienceNew', 'clientConversationFeed', 'clientFanClaim', 'clientFanClaimStatus', 'clientSpenderAwaitingReply', 'clientSpenderStats'] as const;

describe('[HB-006] one transport: every client/* route goes through the vendored SDK', () => {
  it('[HB-006] every contract route is an SDK operation, at the fake hub\'s path and method — the six of hub c8514c5c included', () => {
    for (const key of HUB_ROUTE_KEYS) expect([key, isSdkRoute(key), kernelOperations[key]]).toEqual([key, true, { method: HUB_ROUTES[key].method, path: HUB_ROUTE_PATHS[key] }]);
    for (const key of ARRIVED_C8514C5C) expect([key, HUB_ROUTES[key].since]).toEqual([key, 'sdk']);
  });

  it('[HB-006] a client route goes by the SDK\'s own manifest path: the same request, the path parameters taken out of it', async () => {
    expect(sdkInputOf('clientBootstrap', null)).toEqual({});
    expect(sdkInputOf('clientConversationRecaps', { pageLabel: 'model one', fanRef: WORLD.fan, personaDefinitionId: WORLD.persona.definitionId })).toEqual({
      params: { pageLabel: 'model one', fanRef: WORLD.fan },
      query: { personaDefinitionId: WORLD.persona.definitionId },
    });
    const save = scenarioNamed(HTTP_SCENARIOS, 'recaps-and-dossier').exchanges.find((exchange) => exchange.route === 'clientFanProfileFromGeneration');
    const { pageLabel, fanRef, ...body } = save?.request as { pageLabel: string; fanRef: string } & Record<string, unknown>;
    expect(sdkInputOf('clientFanProfileFromGeneration', save?.request)).toEqual({ params: { pageLabel, fanRef }, body });
    expect(sdkInputOf('clientConversationFeed', { pageLabel: 'model one', fanRef: WORLD.fan, cursor: 'a/b', limit: 50, summaryWindow: 100 })).toEqual({
      params: { pageLabel: 'model one', fanRef: WORLD.fan },
      query: { cursor: 'a/b', limit: 50, summaryWindow: 100 },
    });
    expect(sdkInputOf('clientSpenderStats', { pageLabel: PAGE, windowDays: 30, timeZone: 'Europe/Moscow' })).toEqual({ params: { pageLabel: PAGE }, query: { windowDays: 30, timeZone: 'Europe/Moscow' } });
    expect(sdkInputOf('clientSpenderAwaitingReply', { pageLabel: PAGE, limit: 50 })).toEqual({ params: { pageLabel: PAGE }, query: { limit: 50 } });
    expect(sdkInputOf('clientAudienceNew', { pageLabel: PAGE, windowHours: 48 })).toEqual({ params: { pageLabel: PAGE }, query: { windowHours: 48 } });
    // A claim carries its body under `body`: that object is the POST body; the status read takes the path alone.
    const claim = scenarioNamed(HTTP_SCENARIOS, 'claim-greeting-two-parts').exchanges[1]?.request as ClaimOp;
    expect(sdkInputOf('clientFanClaim', claim)).toEqual({ params: { pageLabel: claim.pageLabel, fanRef: claim.fanRef }, body: claim.body });
    expect(sdkInputOf('clientFanClaimStatus', { pageLabel: PAGE, fanRef: WORLD.newFan })).toEqual({ params: { pageLabel: PAGE, fanRef: WORLD.newFan } });
    // A request outside its contract schema is our bug: never turned into a call.
    expect(() => sdkInputOf('clientConversationRecaps', { pageLabel: PAGE, fanRef: WORLD.fan, persona: 'x' })).toThrow(TypeError);
    expect(() => sdkInputOf('clientConversationRecaps', { fanRef: WORLD.fan })).toThrow(TypeError);
    expect(() => sdkInputOf('clientConversationFeed', { pageLabel: PAGE, fanRef: WORLD.fan, limit: 500 })).toThrow(TypeError);
    expect(() => sdkInputOf('clientAudienceNew', { pageLabel: PAGE, windowHours: 48, persona: 'x' })).toThrow(TypeError);

    // End to end: the recaps read leaves through the SDK with the SDK's headers, at the path with its parameters encoded.
    h.hub.serve(scenarioNamed(HTTP_SCENARIOS, 'recaps-and-dossier').exchanges);
    const recaps = scenarioNamed(HTTP_SCENARIOS, 'recaps-and-dossier').exchanges.find((exchange) => exchange.route === 'clientConversationRecaps');
    await h.facade.recaps(recaps?.request as never);
    const sent = h.hub.of('clientConversationRecaps')[0];
    expect(sent?.headers).toMatchObject({ authorization: `Bearer ${String(WORLD_ON.issued['token'])}`, 'x-client-version': 'chat-extension/0.2.0' });
    expect(sent?.path).toBe(`/api/v1/client/pages/${PAGE}/conversations/${WORLD.fan}/recaps`);
  });

  it('[HB-006] on the wire: the feed\'s query encoded, the claim body as the POST body, the status read a GET of the same path, «Новые» with its window', async () => {
    const feed = scenarioNamed(HTTP_SCENARIOS, 'feed-pages').exchanges[0];
    h.hub.on('clientConversationFeed', () => json(200, feed?.response.body));
    await h.facade.feed({ pageLabel: PAGE, fanRef: WORLD.fan, cursor: 'a/b', limit: 50 });
    expect(h.hub.of('clientConversationFeed')[0]).toMatchObject({ method: 'GET', path: `/api/v1/client/pages/${PAGE}/conversations/${WORLD.fan}/feed`, query: { cursor: 'a/b', limit: '50' }, body: undefined });

    const [, dispatch] = scenarioNamed(HTTP_SCENARIOS, 'claim-greeting-two-parts').exchanges;
    h.hub.on('clientFanClaim', () => json(200, dispatch?.response.body));
    await h.facade.claim(dispatch?.request as ClaimOp);
    expect(h.hub.of('clientFanClaim')[0]).toMatchObject({ method: 'POST', path: `/api/v1/client/pages/${PAGE}/fans/${WORLD.newFan}/claim`, query: {}, body: (dispatch?.request as ClaimOp).body });
    expect(h.hub.of('clientFanClaim')[0]?.headers).toMatchObject({ 'content-type': 'application/json', authorization: `Bearer ${String(WORLD_ON.issued['token'])}`, 'x-client-version': 'chat-extension/0.2.0' });

    h.hub.on('clientFanClaimStatus', () => json(200, dispatch?.response.body));
    await h.facade.claimStatus(PAGE, WORLD.newFan);
    expect(h.hub.of('clientFanClaimStatus')[0]).toMatchObject({ method: 'GET', path: `/api/v1/client/pages/${PAGE}/fans/${WORLD.newFan}/claim`, query: {}, body: undefined });

    const audience = scenarioNamed(HTTP_SCENARIOS, 'audience-new').exchanges[0];
    h.hub.on('clientAudienceNew', () => json(200, audience?.response.body));
    await h.facade.audienceNew({ pageLabel: PAGE, windowHours: 48 });
    expect(h.hub.of('clientAudienceNew')[0]).toMatchObject({ method: 'GET', path: `/api/v1/client/pages/${PAGE}/audience-new`, query: { windowHours: '48' } });
  });

  it('[HB-006] a request outside its schema is never sent; an extra key is our bug — a dispatch past the hub\'s 32-bit revisions too (1.6.0)', async () => {
    const error = await h.facade.feed({ pageLabel: PAGE, fanRef: WORLD.fan, limit: 500 }).catch((reason: unknown) => reason);
    expect(errorWireOf(error)?.code).toBe('CG-HUB-REQUEST');
    expect(h.hub.of('clientConversationFeed')).toEqual([]);
    const tooFar: ClaimOp = {
      pageLabel: PAGE,
      fanRef: WORLD.newFan,
      body: { action: 'dispatch', attemptId: uuid(0x4a9), instanceId: WORLD.instanceId, purpose: 'preview-reply', group: { generationRef: uuid(0x200), variant: 0, partCount: 1 }, partIndex: 0, textRevision: CLAIM_REVISION_MAX + 1, flagRevision: WORLD.configRevision },
    };
    expect(errorWireOf(await h.facade.claim(tooFar).catch((reason: unknown) => reason))?.code).toBe('CG-HUB-REQUEST');
    expect(h.hub.of('clientFanClaim')).toEqual([]);
  });

  it('[HB-006] an answer outside its schema is a hub failure, never data — whichever of the SDK\'s schema and our mirror refuses it', async () => {
    h.hub.on('clientConversationFeed', () => json(200, { items: 'nope' }));
    const error = await h.facade.feed({ pageLabel: PAGE, fanRef: WORLD.fan, limit: 50 }).catch((reason: unknown) => reason);
    expect(isHubCallError(error) && error.failure).toEqual({ kind: 'transport', failure: 'contract' });
    expect(errorWireOf(error)?.code).toBe('CG-HUB-REQUEST');
    // A claim state the hub's own schema refuses (a lease state no automaton has): never read as data.
    const [, dispatch] = scenarioNamed(HTTP_SCENARIOS, 'claim-greeting-two-parts').exchanges;
    const state = dispatch?.response.body as Record<string, Record<string, unknown>>;
    h.hub.on('clientFanClaimStatus', () => json(200, { ...state, lease: { ...state['lease'], state: 'stolen' } }));
    const refused = await h.facade.claimStatus(PAGE, WORLD.newFan).catch((reason: unknown) => reason);
    expect(isHubCallError(refused) && refused.failure).toEqual({ kind: 'transport', failure: 'contract' });
    // A success status the SDK does not declare for the route is not an answer either.
    h.hub.on('clientSpenderStats', () => json(201, HUB_SAMPLES.stats));
    const undeclared = await h.facade.spendersStats({ pageLabel: PAGE, windowDays: 30, timeZone: 'UTC' }).catch((reason: unknown) => reason);
    expect(isHubCallError(undeclared) && undeclared.failure).toEqual({ kind: 'transport', failure: 'contract' });
  });
});

describe('[HB-006] what the journal keeps of a hub call: facts as single machine words, and how long a slow one took', () => {
  const recapsQuery = { pageLabel: PAGE, fanRef: WORLD.fan, personaDefinitionId: WORLD.persona.definitionId };

  it('[HB-006] a refused call names its status, its error and its reason each in a field of its own (a sentence would be cut by the redaction)', async () => {
    h.hub.on('clientConversationRecaps', () => hubError(409, 'client_feature_disabled', 'disabled'));
    await h.facade.recaps(recapsQuery).catch(() => undefined);
    const line = h.logs.lines.filter((entry) => entry.message === 'hub: call failed').at(-1);
    expect(line).toEqual({
      level: 'warn',
      message: 'hub: call failed',
      fields: { route: 'clientConversationRecaps', failure: 'http', status: 409, error: 'client_feature_disabled', reason: 'disabled', code: 'CG-FEATURE-DISABLED', disposition: 'refresh-bootstrap', epoch: 1 },
    });
    // Every string of the line is one token without spaces: the journal's redaction keeps them as they are.
    for (const value of Object.values(line?.fields ?? {})) if (typeof value === 'string') expect(value).toMatch(/^[A-Za-z0-9_.:-]+$/);
  });

  it('[AI-061] a call the hub answers at once but that travels 20 s is said as slow, with its time — the «Проверяю сохранённые Recap…» of the first live check', async () => {
    h.hub.serve(scenarioNamed(HTTP_SCENARIOS, 'recaps-and-dossier').exchanges);
    await h.facade.recaps(recapsQuery);
    expect(h.logs.lines.filter((entry) => entry.message === 'hub: slow call')).toEqual([]);

    const answer = scenarioNamed(HTTP_SCENARIOS, 'recaps-and-dossier').exchanges.find((exchange) => exchange.route === 'clientConversationRecaps')?.response.body;
    h.hub.on('clientConversationRecaps', () => new Promise((resolve) => setTimeout(() => resolve(json(200, answer)), 20_000)));
    const slow = h.facade.recaps(recapsQuery);
    await vi.advanceTimersByTimeAsync(20_000);
    await slow;
    expect(h.logs.lines.filter((entry) => entry.message === 'hub: slow call')).toEqual([
      { level: 'warn', message: 'hub: slow call', fields: { route: 'clientConversationRecaps', ms: 20_000, outcome: 'answered', status: 200, epoch: 1 } },
    ]);
  });
});

describe('[AI-097] [NEW-02] the archive feed is database-only on the hub and never retried by the facade', () => {
  it('[NEW-02] a forged cursor reads «restart from the first page» and the facade does not restart by itself', async () => {
    h.hub.on('clientConversationFeed', () => hubError(400, 'bad_request', 'cursor_invalid'));
    const error = await h.facade.feed({ pageLabel: PAGE, fanRef: WORLD.fan, cursor: 'forged', limit: 50 }).catch((reason: unknown) => reason);
    expect(isHubCallError(error) && error.resolution?.disposition).toBe('restart-cursor');
    expect(h.hub.of('clientConversationFeed')).toHaveLength(1);
  });
});
