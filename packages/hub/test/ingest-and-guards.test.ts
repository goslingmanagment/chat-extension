// Ingest (acceptance + client_health, H-11/H-14) — what leaves for the hub: the events as they are, no text, and
// client_health only under its capability — and the routes this client never calls (§8.1 «Никогда», AU-029) — parity
// TL-007…TL-012 (hub part), AU-029.

import { HUB_FORBIDDEN_OPERATIONS, HUB_ROUTE_KEYS, HUB_ROUTES, INGEST_LIMITS, type AcceptanceEvent } from '@cg/contracts';
import { clientHealth, uuid as fixtureUuid } from '@cg/contracts/fixtures';
import { BOOTSTRAP_PILOT_ON, HTTP_SCENARIOS, HUB_ROUTE_PATHS, NOW_MS, PAGE, SSE_SCENARIOS, WORLD, sseText } from '@cg/testing/hub';
import { kernelOperations } from '@kernel/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SDK_ALLOWED_OPERATIONS } from '../src/index';
import { json, sse } from './support/fake-hub';
import { flush, makeHarness, signIn, type Harness } from './support/harness';
import { okBody, scenarioNamed, signInWorld } from './support/world';

const SIGN_IN = scenarioNamed(HTTP_SCENARIOS, 'sign-in-and-bootstrap-all-off');
const WORLD_PILOT = signInWorld(SIGN_IN, BOOTSTRAP_PILOT_ON, WORLD.user.username);

const acceptance = (n: number): AcceptanceEvent => ({
  clientEventId: fixtureUuid(0x1000 + n),
  kind: 'ai_acceptance',
  observedAt: '2026-10-03T10:00:00Z',
  pageLabel: PAGE,
  payload: { generationRef: fixtureUuid(6), lifecycle: 'shown', opId: fixtureUuid(2), feature: 'reply', surface: 'dock' },
});

let h: Harness;
beforeEach(() => {
  vi.useFakeTimers({ now: NOW_MS, toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
  h = makeHarness({ paths: HUB_ROUTE_PATHS });
});
afterEach(() => {
  h.facade.dispose();
  vi.useRealTimers();
});

describe('[TL-009] [TL-012] ingest: acceptance always, client_health only under its capability, in its own batches', () => {
  it('[TL-009] [TL-007] [TL-008] batches of at most 100, the events as they are (stable clientEventId, page, no text)', async () => {
    await signIn(h, WORLD_PILOT);
    h.hub.on('ingestObservations', (request) => json(200, { accepted: (request.body as { events: unknown[] }).events.length - 1, duplicates: 1 }));
    const events = Array.from({ length: 250 }, (_, n) => acceptance(n));
    await expect(h.facade.ingest(events)).resolves.toEqual({ accepted: 247, duplicates: 3, healthRefused: 0 });
    const batches = h.hub.of('ingestObservations').map((request) => (request.body as { events: Record<string, unknown>[] }).events);
    expect(batches.map((batch) => batch.length)).toEqual([INGEST_LIMITS.maxEventsPerBatch, 100, 50]);
    expect(batches[0]?.[0]).toEqual({ clientEventId: events[0]?.clientEventId, kind: 'ai_acceptance', observedAt: events[0]?.observedAt, pageLabel: PAGE, payload: events[0]?.payload });
  });

  it('[TL-012] client_health without client-health-perf-v1 is refused locally (CG-HUB-CAPABILITY), never sent', async () => {
    await signIn(h, WORLD_PILOT);
    await expect(h.facade.ingest([clientHealth])).resolves.toEqual({ accepted: 0, duplicates: 0, healthRefused: 1 });
    expect(h.hub.of('ingestObservations')).toEqual([]);
    expect(h.logs.lines.some((line) => line.fields?.['code'] === 'CG-HUB-CAPABILITY' && line.fields['count'] === 1)).toBe(true);
  });
});

describe('[AU-029] routes this client never calls (§8.1 «Никогда»)', () => {
  it('[AU-029] the SDK transport knows only the contract\'s SDK routes (+ pages for the dev bootstrap)', () => {
    for (const forbidden of HUB_FORBIDDEN_OPERATIONS) expect(SDK_ALLOWED_OPERATIONS).not.toContain(forbidden);
    for (const operation of SDK_ALLOWED_OPERATIONS) {
      const path = (kernelOperations as Record<string, { path: string }>)[operation]?.path ?? '';
      expect(path).not.toMatch(/^\/api\/v1\/(ofapi|events)|\/ai\/gateway|\/ai\/personas(\/|$)/);
    }
    // Every contract route (all of them SDK operations since hub c8514c5c), and nothing else.
    expect([...SDK_ALLOWED_OPERATIONS].sort()).toEqual([...HUB_ROUTE_KEYS.filter((key) => HUB_ROUTES[key].since === 'sdk'), 'pages'].sort());
    expect([...SDK_ALLOWED_OPERATIONS].sort()).toEqual([...HUB_ROUTE_KEYS, 'pages'].sort());
    // The cabinet's resolve and list of held sends came with the same SDK: a device token never reaches them.
    for (const cabinet of ['clientSendCustodyResolve', 'clientSendCustodyList']) {
      expect(kernelOperations).toHaveProperty(cabinet);
      expect(SDK_ALLOWED_OPERATIONS).not.toContain(cabinet);
    }
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
});
