// The client/* routes of hub PRs #414… through the RouteTransport: archive
// feed (H-9), «Новые» (H-7c), claim and custody (H-7b), shared recaps and
// the dossier (H-13, H-5), every scenario of the fake hub with its
// expected reading (parity NF-010, NF-023, NF-026, SN-012, AI-060…AI-071,
// AI-097, NEW-02, HB-006).

import { CLIENT_FEATURE_FLAG_NAMES, HUB_ROUTE_KEYS, HUB_ROUTES, isHubCallError, isHubCheckError, type ClaimOp } from '@cg/contracts';
import { BOOTSTRAP_PILOT_ON, HTTP_SCENARIOS, HUB_ROUTE_PATHS, NOW_MS, PAGE, WORLD, uuid, type HttpExchange } from '@cg/testing/hub';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CLIENT_ROUTE_KEYS, CLIENT_ROUTE_PATHS, clientWireRequest, errorWireOf, isClientRoute, type ChatExtensionHub } from '../src/index';
import { hubError, json } from './support/fake-hub';
import { flush, makeHarness, signIn, type Harness } from './support/harness';
import { scenarioNamed, signInWorld } from './support/world';

const SIGN_IN = scenarioNamed(HTTP_SCENARIOS, 'sign-in-and-bootstrap-all-off');
/** Every page feature available (X8 included), so only the hub's own answers decide. */
const BOOTSTRAP_ALL_ON = {
  ...BOOTSTRAP_PILOT_ON,
  flags: Object.fromEntries(CLIENT_FEATURE_FLAG_NAMES.map((flag) => [flag, true])),
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
  vi.useFakeTimers({ now: NOW_MS, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
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
    const off = { ...BOOTSTRAP_ALL_ON, flags: { ...BOOTSTRAP_ALL_ON.flags, newcomers: false } };
    await signIn(h, { ...WORLD_ON, bootstrap: off });
    const lease: ClaimOp = { pageLabel: PAGE, fanRef: WORLD.newFan, body: { action: 'claim', leaseToken: uuid(0x300), instanceId: WORLD.instanceId } };
    expect(errorWireOf(await h.facade.claim(lease).catch((reason: unknown) => reason))).toEqual({ code: 'CG-FEATURE-DISABLED', detail: 'flag_off' });
    expect(errorWireOf(await h.facade.audienceNew({ pageLabel: PAGE, windowHours: 48 }).catch((reason: unknown) => reason))?.code).toBe('CG-FEATURE-DISABLED');
    h.hub.on('clientFanClaimStatus', () => json(200, scenarioNamed(HTTP_SCENARIOS, 'claim-greeting-two-parts').exchanges[0]?.response.body));
    await expect(h.facade.claimStatus(PAGE, WORLD.newFan)).resolves.toMatchObject({ greeting: { state: 'none' } });
  });
});

describe('[HB-006] the RouteTransport: one module, the contract schemas on both ends', () => {
  it('[HB-006] serves exactly the contract routes the vendored SDK lacks, at the fake hub\'s paths', () => {
    const notInSdk = HUB_ROUTE_KEYS.filter((key) => HUB_ROUTES[key].since !== 'sdk');
    expect([...CLIENT_ROUTE_KEYS].sort()).toEqual([...notInSdk].sort());
    for (const key of CLIENT_ROUTE_KEYS) expect(CLIENT_ROUTE_PATHS[key]).toBe(HUB_ROUTE_PATHS[key]);
    expect(isClientRoute('clientBootstrap')).toBe(true);
    expect(isClientRoute('me')).toBe(false);
  });

  it('[HB-006] a request outside its schema is never sent; an extra key is our bug', async () => {
    expect(() => clientWireRequest('clientConversationFeed', { pageLabel: PAGE, fanRef: WORLD.fan, limit: 500 })).toThrow(TypeError);
    expect(() => clientWireRequest('clientAudienceNew', { pageLabel: PAGE, windowHours: 48, persona: 'x' })).toThrow(TypeError);
    expect(clientWireRequest('clientConversationFeed', { pageLabel: 'model one', fanRef: WORLD.fan, cursor: 'a/b', limit: 50 })).toEqual({
      method: 'GET',
      pathAndQuery: `/api/v1/client/pages/model%20one/conversations/${WORLD.fan}/feed?cursor=a%2Fb&limit=50`,
      body: undefined,
    });
    const error = await h.facade.feed({ pageLabel: PAGE, fanRef: WORLD.fan, limit: 500 }).catch((reason: unknown) => reason);
    expect(errorWireOf(error)?.code).toBe('CG-HUB-REQUEST');
    expect(h.hub.of('clientConversationFeed')).toEqual([]);
  });

  it('[HB-006] an answer outside its schema is a hub failure, never data; the auth and client headers are the SDK\'s', async () => {
    h.hub.on('clientConversationFeed', () => json(200, { items: 'nope' }));
    const error = await h.facade.feed({ pageLabel: PAGE, fanRef: WORLD.fan, limit: 50 }).catch((reason: unknown) => reason);
    expect(isHubCallError(error) && error.failure).toEqual({ kind: 'transport', failure: 'contract' });
    expect(errorWireOf(error)?.code).toBe('CG-HUB-REQUEST');
    const sent = h.hub.of('clientConversationFeed')[0];
    expect(sent?.headers).toMatchObject({ authorization: `Bearer ${String(WORLD_ON.issued['token'])}`, 'x-client-version': 'chat-extension/0.2.0', accept: 'application/json' });
  });

  it('[HB-006] the claim body goes as the POST body; the status read is a GET of the same path', () => {
    const exchange = scenarioNamed(HTTP_SCENARIOS, 'claim-greeting-two-parts').exchanges[1];
    expect(clientWireRequest('clientFanClaim', exchange?.request)).toEqual({
      method: 'POST',
      pathAndQuery: `/api/v1/client/pages/${PAGE}/fans/${WORLD.newFan}/claim`,
      body: (exchange?.request as ClaimOp).body,
    });
    expect(clientWireRequest('clientFanClaimStatus', { pageLabel: PAGE, fanRef: WORLD.newFan })).toEqual({
      method: 'GET',
      pathAndQuery: `/api/v1/client/pages/${PAGE}/fans/${WORLD.newFan}/claim`,
      body: undefined,
    });
    expect(clientWireRequest('clientBootstrap', null)).toEqual({ method: 'GET', pathAndQuery: '/api/v1/client/bootstrap', body: undefined });
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
