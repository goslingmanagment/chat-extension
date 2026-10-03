// Ingest (acceptance + client_health, H-11/H-14), the user's AI usage
// (H-15), the H-5 save schedule (§7), and the routes this client never
// calls (§8.1 «Никогда», AU-029) — parity TL-001…TL-012 (hub part),
// AI-067, AI-068, AU-029, HB-006.

import {
  HUB_FORBIDDEN_OPERATIONS,
  HUB_ROUTE_KEYS,
  INGEST_LIMITS,
  isHubCallError,
  type AcceptanceEvent,
  type ProfileFromGenerationRequest,
} from '@cg/contracts';
import { HUB_SAMPLES, clientHealth, uuid as fixtureUuid } from '@cg/contracts/fixtures';
import { BOOTSTRAP_PILOT_ON, HTTP_SCENARIOS, HUB_ROUTE_PATHS, NOW_MS, PAGE, SSE_SCENARIOS, WORLD, sseText, uuid } from '@cg/testing/hub';
import { kernelOperations } from '@kernel/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SDK_ALLOWED_OPERATIONS, errorWireOf, stableEventId } from '../src/index';
import { fullStreamTransport, hubError, json, sse } from './support/fake-hub';
import { flush, makeHarness, signIn, type Harness } from './support/harness';
import { okBody, scenarioNamed, signInWorld } from './support/world';

const SIGN_IN = scenarioNamed(HTTP_SCENARIOS, 'sign-in-and-bootstrap-all-off');
const WORLD_PILOT = signInWorld(SIGN_IN, BOOTSTRAP_PILOT_ON, WORLD.user.username);
const WITH_HEALTH = { ...BOOTSTRAP_PILOT_ON, capabilities: [...BOOTSTRAP_PILOT_ON.capabilities, 'client-health-perf-v1'] };

const acceptance = (n: number): AcceptanceEvent => ({
  clientEventId: fixtureUuid(0x1000 + n),
  kind: 'ai_acceptance',
  observedAt: '2026-10-03T10:00:00Z',
  pageLabel: PAGE,
  payload: { generationRef: fixtureUuid(6), lifecycle: 'shown', opId: fixtureUuid(2), feature: 'reply', surface: 'dock' },
});

let h: Harness;
beforeEach(() => {
  vi.useFakeTimers({ now: NOW_MS, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  h = makeHarness({ paths: HUB_ROUTE_PATHS, streamTransport: fullStreamTransport() });
});
afterEach(() => {
  h.facade.dispose();
  vi.useRealTimers();
});

describe('[TL-009] [TL-012] ingest: acceptance always, client_health only under its capability, in its own batches', () => {
  it('[TL-009] batches of at most 100, the events as they are (stable clientEventId, page, no text)', async () => {
    await signIn(h, WORLD_PILOT);
    h.hub.on('ingestObservations', (request) => json(200, { accepted: (request.body as { events: unknown[] }).events.length - 1, duplicates: 1 }));
    const events = Array.from({ length: 250 }, (_, n) => acceptance(n));
    await expect(h.facade.ingest(events)).resolves.toEqual({ accepted: 247, duplicates: 3 });
    const batches = h.hub.of('ingestObservations').map((request) => (request.body as { events: Record<string, unknown>[] }).events);
    expect(batches.map((batch) => batch.length)).toEqual([INGEST_LIMITS.maxEventsPerBatch, 100, 50]);
    expect(batches[0]?.[0]).toEqual({ clientEventId: events[0]?.clientEventId, kind: 'ai_acceptance', observedAt: events[0]?.observedAt, pageLabel: PAGE, payload: events[0]?.payload });
  });

  it('[TL-012] client_health without client-health-perf-v1 is refused locally (CG-HUB-CAPABILITY)', async () => {
    await signIn(h, WORLD_PILOT);
    const error = await h.facade.ingest([clientHealth]).catch((reason: unknown) => reason);
    expect(errorWireOf(error)).toEqual({ code: 'CG-HUB-CAPABILITY', detail: 'client-health-perf-v1' });
    expect(h.hub.of('ingestObservations')).toEqual([]);
  });

  it('[TL-012] with the capability: its own batch, a stable id per report so a retry is deduplicated', async () => {
    await signIn(h, { ...WORLD_PILOT, bootstrap: WITH_HEALTH });
    h.hub.on('ingestObservations', () => json(200, { accepted: 1, duplicates: 0 }));
    await h.facade.ingest([acceptance(1), clientHealth]);
    await h.facade.ingest([clientHealth]);
    const bodies = h.hub.of('ingestObservations').map((request) => request.body as { events: { clientEventId: string; kind: string; observedAt: string; payload: Record<string, unknown> }[] });
    expect(bodies.map((body) => body.events.map((event) => event.kind))).toEqual([['ai_acceptance'], ['client_health'], ['client_health']]);
    const health = bodies[1]?.events[0];
    expect(health?.clientEventId).toBe(bodies[2]?.events[0]?.clientEventId);
    expect(health?.observedAt).toBe(clientHealth.window.to);
    expect(health?.payload).not.toHaveProperty('kind');
    expect(health?.payload['client']).toEqual(clientHealth.client);
  });

  it('[TL-010] a refused batch reads by the hub canon; an invalid event is never sent', async () => {
    await signIn(h, WORLD_PILOT);
    h.hub.on('ingestObservations', () => hubError(400, 'bad_request'));
    expect(errorWireOf(await h.facade.ingest([acceptance(1)]).catch((reason: unknown) => reason))?.code).toBe('CG-HUB-REQUEST');
    const before = h.hub.of('ingestObservations').length;
    const bad = { ...acceptance(2), clientEventId: 'not-a-uuid' };
    expect(errorWireOf(await h.facade.ingest([bad]).catch((reason: unknown) => reason))?.code).toBe('CG-HUB-REQUEST');
    expect(h.hub.of('ingestObservations')).toHaveLength(before);
    await expect(h.facade.ingest([])).resolves.toEqual({ accepted: 0, duplicates: 0 });
  });

  it('[TL-012] the stable id is a UUID that depends only on the report', () => {
    const a = stableEventId('client_health|0.1.0|a|b');
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(stableEventId('client_health|0.1.0|a|b')).toBe(a);
    expect(stableEventId('client_health|0.1.0|a|c')).not.toBe(a);
  });
});

describe('[TL-013] the user\'s own AI spend (H-15, debug only)', () => {
  it('[TL-013] refused locally without ai-usage-v1; with it, the report of a granted page', async () => {
    await signIn(h, { ...WORLD_PILOT, bootstrap: { ...BOOTSTRAP_PILOT_ON, capabilities: BOOTSTRAP_PILOT_ON.capabilities.filter((capability) => capability !== 'ai-usage-v1') } });
    expect(errorWireOf(await h.facade.aiUsage({ pageLabel: PAGE, date: '2026-10-03' }).catch((reason: unknown) => reason))?.code).toBe('CG-HUB-CAPABILITY');
    await signIn(h, WORLD_PILOT);
    h.hub.on('clientAiUsageDaily', () => json(200, HUB_SAMPLES.usageReport));
    await expect(h.facade.aiUsage({ pageLabel: PAGE, date: '2026-10-03', days: 7 })).resolves.toEqual(HUB_SAMPLES.usageReport);
    expect(h.hub.of('clientAiUsageDaily')[0]).toMatchObject({ path: `/api/v1/client/pages/${PAGE}/ai-usage`, query: { date: '2026-10-03', days: '7' } });
  });
});

describe('[AI-067] [AI-068] the dossier save from a full recap follows the §7 schedule', () => {
  const save: ProfileFromGenerationRequest = { pageLabel: PAGE, fanRef: WORLD.fan, generationRef: uuid(0x200), clientRequestId: uuid(0x100) };
  const created = scenarioNamed(HTTP_SCENARIOS, 'recaps-and-dossier').exchanges.find((exchange) => exchange.route === 'clientFanProfileFromGeneration' && exchange.response.status === 200)?.response.body;

  it('[AI-068] not ready → 5 s, 15 s, 60 s, then every 3 min; the idempotent write lands', async () => {
    await signIn(h, WORLD_PILOT);
    const times: number[] = [];
    h.hub.on('clientFanProfileFromGeneration', () => {
      times.push(Date.now() - NOW_MS);
      return times.length < 5 ? hubError(409, 'generation_not_ready') : json(200, created);
    });
    const outcome = h.facade.saveRecapProfile(save, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(5_000 + 15_000 + 60_000 + 180_000);
    await expect(outcome).resolves.toMatchObject({ state: 'saved' });
    expect(times).toEqual([0, 5_000, 20_000, 80_000, 260_000]);
  });

  it('[AI-067] gives up after 30 min with not-ready (the caller shows CG-RECAP-SAVE); a closed tab stops it', async () => {
    await signIn(h, WORLD_PILOT);
    h.hub.on('clientFanProfileFromGeneration', () => hubError(409, 'generation_not_ready'));
    const outcome = h.facade.saveRecapProfile(save, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(31 * 60_000);
    await expect(outcome).resolves.toEqual({ state: 'not-ready' });
    const asked = h.hub.of('clientFanProfileFromGeneration').length;
    // 0, 5, 20, 80 s, then every 180 s up to 1700 s: the next (1880 s) is past 30 min.
    expect(asked).toBe(13);
    const tab = new AbortController();
    const stopped = h.facade.saveRecapProfile(save, tab.signal).catch((reason: unknown) => reason);
    await vi.advanceTimersByTimeAsync(1_000);
    tab.abort();
    const error = await stopped;
    expect(isHubCallError(error) && error.failure).toEqual({ kind: 'transport', failure: 'aborted' });
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(h.hub.of('clientFanProfileFromGeneration')).toHaveLength(asked + 1);
  });
});

describe('[AU-029] routes this client never calls (§8.1 «Никогда»)', () => {
  it('[AU-029] the SDK transport knows only the contract\'s SDK routes (+ pages for the dev bootstrap)', () => {
    for (const forbidden of HUB_FORBIDDEN_OPERATIONS) expect(SDK_ALLOWED_OPERATIONS).not.toContain(forbidden);
    for (const operation of SDK_ALLOWED_OPERATIONS) {
      const path = (kernelOperations as Record<string, { path: string }>)[operation]?.path ?? '';
      expect(path).not.toMatch(/^\/api\/v1\/(ofapi|events)|\/ai\/gateway|\/ai\/personas(\/|$)/);
    }
    expect([...SDK_ALLOWED_OPERATIONS].sort()).toEqual([...HUB_ROUTE_KEYS.filter((key) => !key.startsWith('client')), 'pages'].sort());
  });

  it('[AU-029] a whole working session touches no OFAPI, events, full personas or raw gateway', async () => {
    h.env.debug = true;
    await signIn(h, WORLD_PILOT);
    h.hub.on('health', () => json(200, okBody(SIGN_IN, 'health')));
    await h.facade.checkConnection();
    const reply = scenarioNamed(SSE_SCENARIOS, 'reply-normal');
    const response = reply.responses[0];
    if (response?.kind !== 'stream') throw new Error('stream expected');
    h.hub.on('aiFeatureStream', () => sse(sseText(response)));
    await h.facade.stream(reply.request, () => undefined, new AbortController().signal);
    h.hub.serve(scenarioNamed(HTTP_SCENARIOS, 'feed-pages').exchanges);
    await h.facade.feed({ pageLabel: PAGE, fanRef: WORLD.fan, limit: 50 });
    h.hub.serve(scenarioNamed(HTTP_SCENARIOS, 'recaps-and-dossier').exchanges);
    await h.facade.recaps({ pageLabel: PAGE, fanRef: WORLD.fan, personaDefinitionId: WORLD.persona.definitionId });
    await h.facade.signOut();
    await flush(20);
    expect(h.hub.requests.length).toBeGreaterThan(8);
    for (const request of h.hub.requests) {
      expect(request.path).not.toMatch(/^\/api\/v1\/(ofapi|events)|\/ai\/gateway|\/ai\/personas(\/|$)|outreach|top-spenders/);
      expect(request.route).not.toBeNull();
      expect(request.origin).toBe(WORLD.hubOrigin);
    }
    expect(h.hub.unexpected).toEqual([]);
  });

  it('[AU-029] spenderBatch reaches its literal-colon path (the SDK path builder cannot)', async () => {
    await signIn(h, WORLD_PILOT);
    h.hub.on('spenderBatch', () => json(200, HUB_SAMPLES.spenderBatch));
    const batch = { scope: 'page' as const, pageLabel: PAGE, fans: [{ platform: 'onlyfans' as const, platformUserId: '5000' }] };
    await expect(h.facade.spenderBatch(batch)).resolves.toEqual(HUB_SAMPLES.spenderBatch);
    expect(h.hub.of('spenderBatch')[0]).toMatchObject({ path: '/api/v2/spenders:batch', method: 'POST', headers: { authorization: `Bearer ${String(WORLD_PILOT.issued['token'])}`, 'x-client-version': 'chat-extension/0.2.0' } });
  });
});
