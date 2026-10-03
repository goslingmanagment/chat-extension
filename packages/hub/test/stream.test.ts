// The AI stream (architecture.md §7, §8.4): every SSE scenario of the fake
// hub through the facade, the strict frame rules, the one transparent 503
// retry, the persona fence and catalog, the prompt echo and the quota
// (parity AI-140, AI-141, AU-026…AU-028, DB-002/003/006/008, TL-013).

import { STORAGE_KEYS, isHubCallError, isHubCheckError, type CgCode, type HubFrame, type HubStreamRequest } from '@cg/contracts';
import {
  BOOTSTRAP_ALL_OFF,
  BOOTSTRAP_PILOT_ON,
  HTTP_SCENARIOS,
  HUB_ROUTE_PATHS,
  NOW_MS,
  SSE_SCENARIOS,
  WORLD,
  meta,
  readStreamScenario,
  sseText,
  streamBody,
  type SseScenario,
} from '@cg/testing/hub';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CATALOG_TTL_MS, STREAM_RETRY_DELAY_MS, errorWireOf, sdkStreamTransport } from '../src/index';
import { fullStreamTransport, hubError, json, sse, sseFrame, testEnv } from './support/fake-hub';
import { flush, makeHarness, signIn, until, type Harness } from './support/harness';
import { scenarioNamed, signInWorld } from './support/world';

const SIGN_IN = scenarioNamed(HTTP_SCENARIOS, 'sign-in-and-bootstrap-all-off');
const WORLD_PILOT = signInWorld(SIGN_IN, BOOTSTRAP_PILOT_ON, WORLD.user.username);
const OP = streamBody().clientRequestId;
const PAGE_ID = WORLD.pages.one.pageId;

interface Run {
  readonly frames: HubFrame[];
  readonly error: unknown;
  readonly code: CgCode | null;
}

async function run(h: Harness, request: HubStreamRequest, signal: AbortSignal = new AbortController().signal, options: { advance?: number } = {}): Promise<Run> {
  const frames: HubFrame[] = [];
  const result = h.facade.stream(request, (frame) => frames.push(frame), signal).then(
    () => null,
    (error: unknown) => error,
  );
  await vi.advanceTimersByTimeAsync(options.advance ?? STREAM_RETRY_DELAY_MS);
  const error = await result;
  if (error !== null && !isHubCallError(error) && !isHubCheckError(error)) throw error as Error;
  return { frames, error, code: error === null ? null : (errorWireOf(error)?.code ?? null) };
}

function serveScenario(h: Harness, scenario: SseScenario): void {
  let index = 0;
  h.hub.on('aiFeatureStream', () => {
    const response = scenario.responses[index];
    index += 1;
    if (response === undefined) return hubError(599, 'no_more_responses');
    if (response.kind === 'http-error') return json(response.status, response.body);
    return sse(sseText(response));
  });
}

let h: Harness;
beforeEach(() => {
  vi.useFakeTimers({ now: NOW_MS, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  h = makeHarness({ paths: HUB_ROUTE_PATHS, streamTransport: fullStreamTransport() });
});
afterEach(() => {
  h.facade.dispose();
  vi.useRealTimers();
});

describe('[AI-140] [AI-141] every SSE scenario of the fake hub, read by the facade', () => {
  for (const scenario of SSE_SCENARIOS) {
    it(`[AI-141] ${scenario.name}: ${scenario.description}`, async () => {
      await signIn(h, WORLD_PILOT);
      await flush();
      const catalogReads = h.hub.of('aiPersonaCatalog').length;
      serveScenario(h, scenario);
      const result = await run(h, scenario.request);
      const posts = h.hub.of('aiFeatureStream');
      expect(posts).toHaveLength(scenario.expect.requests);
      for (const post of posts) {
        expect(post.body).toEqual(scenario.request.body);
        expect(post.headers['x-kernel-ai-capabilities']).toBe(scenario.request.capabilities.length === 0 ? undefined : scenario.request.capabilities.join(','));
        expect(post.headers['x-client-version']).toBe('chat-extension/0.2.0');
      }
      const reference = readStreamScenario(scenario, NOW_MS);
      const context = result.frames.find((frame) => frame.type === 'context_v1');
      if (scenario.expect.outcome === 'done') {
        expect(result.error).toBeNull();
        expect(result.frames[0]?.type).toBe('meta');
        expect(result.frames.at(-1)?.type).toBe('done');
        const text = result.frames.flatMap((frame) => (frame.type === 'content_delta' ? [frame.text] : [])).join('');
        expect(text).toBe(reference.text);
      } else {
        expect(result.code).toBe(scenario.expect.cg);
        const disposition = isHubCallError(result.error) ? result.error.resolution?.disposition : isHubCheckError(result.error) && result.error.check === 'personaChangedInMeta' ? 'refresh-catalog' : null;
        expect(disposition).toBe(scenario.expect.disposition);
        const retryAt = errorWireOf(result.error)?.retryAt ?? null;
        expect(retryAt === null ? null : retryAt - NOW_MS).toBe(scenario.expect.retryAfterMs);
        expect(result.frames.some((frame) => frame.type === 'done')).toBe(false);
      }
      expect(context === undefined ? null : { source: context.source, live: context.live.status }).toEqual(scenario.expect.context);
      if (scenario.expect.disposition === 'refresh-catalog') {
        await flush(20);
        expect(h.hub.of('aiPersonaCatalog').length).toBe(catalogReads + 1);
      }
      expect(h.hub.unexpected).toEqual([]);
    });
  }
});

describe('[AI-141] frames are read strictly: nothing before meta, nothing unknown, nothing after the end', () => {
  const reply: HubStreamRequest = { feature: 'fast-reply', body: streamBody({ replyTone: 'casual' }), capabilities: ['context-v1'] };
  const answer = (...frames: unknown[]) => () => sse(frames.map(sseFrame).join(''));

  beforeEach(async () => {
    await signIn(h, WORLD_PILOT);
  });

  it('[AI-141] a delta, usage or done before meta is a contract failure; the sink never sees it', async () => {
    for (const first of [{ type: 'content_delta', text: 'x' }, { type: 'usage', usage: { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0, costMicroUsd: 1, costApproximate: false }, providerResponseId: null, cacheHit: false }, { type: 'done', stopReason: null }]) {
      h.hub.on('aiFeatureStream', answer(first, meta('fast-reply'), { type: 'done', stopReason: null }));
      const result = await run(h, reply);
      expect(result.code).toBe('CG-HUB-REQUEST');
      expect(result.frames).toEqual([]);
    }
  });

  it('[AI-141] an unknown frame, a second meta, a foreign clientRequestId: contract failures', async () => {
    h.hub.on('aiFeatureStream', answer(meta('fast-reply'), { type: 'telemetry_v9', x: 1 }, { type: 'done', stopReason: null }));
    expect((await run(h, reply)).code).toBe('CG-HUB-REQUEST');
    h.hub.on('aiFeatureStream', answer(meta('fast-reply'), meta('fast-reply'), { type: 'done', stopReason: null }));
    expect((await run(h, reply)).code).toBe('CG-HUB-REQUEST');
    h.hub.on('aiFeatureStream', answer(meta('fast-reply', { clientRequestId: '00000000-0000-4000-8000-0000000000ff' }), { type: 'done', stopReason: null }));
    expect((await run(h, reply)).code).toBe('CG-HUB-REQUEST');
  });

  it('[AI-141] context_v1 after output, without the capability, or of another generation: contract failures', async () => {
    const context = SSE_SCENARIOS[0]?.responses[0];
    const contextFrame = context?.kind === 'stream' ? context.steps.flatMap((step) => (step.kind === 'frame' && step.frame.type === 'context_v1' ? [step.frame] : []))[0] : undefined;
    h.hub.on('aiFeatureStream', answer(meta('fast-reply'), { type: 'content_delta', text: 'x' }, contextFrame, { type: 'done', stopReason: null }));
    expect((await run(h, reply)).code).toBe('CG-HUB-REQUEST');
    h.hub.on('aiFeatureStream', answer(meta('fast-reply'), contextFrame, { type: 'done', stopReason: null }));
    expect((await run(h, { ...reply, capabilities: [] })).code).toBe('CG-HUB-REQUEST');
    h.hub.on('aiFeatureStream', answer(meta('fast-reply'), { ...contextFrame, generationRef: '00000000-0000-4000-8000-0000000000fe' }, { type: 'done', stopReason: null }));
    expect((await run(h, reply)).code).toBe('CG-HUB-REQUEST');
    h.hub.on('aiFeatureStream', answer(meta('fast-reply'), { type: 'debug_input_v1', systemBlocks: [{ text: 's', cache: 'none' }], userBlocks: [{ text: 'u', cache: 'none' }], contextManifest: null }, { type: 'done', stopReason: null }));
    expect((await run(h, reply)).code).toBe('CG-HUB-REQUEST');
  });

  it('[AI-141] frames after done are never delivered; the stream resolves at done', async () => {
    h.hub.on('aiFeatureStream', answer(meta('fast-reply'), { type: 'content_delta', text: 'ok' }, { type: 'done', stopReason: 'end_turn' }, { type: 'content_delta', text: 'late' }));
    const result = await run(h, reply);
    expect(result.error).toBeNull();
    expect(result.frames.map((frame) => frame.type)).toEqual(['meta', 'content_delta', 'done']);
  });

  it('[AI-141] a sink that throws ends the stream with its own error', async () => {
    h.hub.on('aiFeatureStream', answer(meta('fast-reply'), { type: 'content_delta', text: 'ok' }, { type: 'done', stopReason: null }));
    const failure = new Error('sink broke');
    await expect(
      h.facade.stream(
        reply,
        () => {
          throw failure;
        },
        new AbortController().signal,
      ),
    ).rejects.toBe(failure);
  });
});

describe('[AI-141] §7 retry rules: one transparent retry of a structured 503 before the first frame, nothing else', () => {
  const reply: HubStreamRequest = { feature: 'fast-reply', body: streamBody({ replyTone: 'casual' }), capabilities: [] };
  const done = sse([meta('fast-reply'), { type: 'content_delta', text: 'ok' }, { type: 'done', stopReason: null }].map(sseFrame).join(''));

  beforeEach(async () => {
    await signIn(h, WORLD_PILOT);
  });

  it('[AI-141] the retry waits 5 s, announces itself, and is the only one', async () => {
    let posts = 0;
    h.hub.on('aiFeatureStream', () => (++posts === 1 ? hubError(503, 'service_unavailable') : done.clone()));
    const frames: HubFrame[] = [];
    const result = h.facade.stream(reply, (frame) => frames.push(frame), new AbortController().signal);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(posts).toBe(1);
    expect(h.notices).toEqual([{ kind: 'retrying', clientRequestId: OP, retryAt: NOW_MS + STREAM_RETRY_DELAY_MS }]);
    await vi.advanceTimersByTimeAsync(1);
    await result;
    expect(posts).toBe(2);
    expect(frames.at(-1)?.type).toBe('done');
  });

  it('[AI-141] 502, an unstructured 503, a network failure and an EOF are never repeated', async () => {
    for (const answer of [() => hubError(502, 'bad_gateway'), () => new Response('<html>busy</html>', { status: 503 }), () => 'network-error' as const, () => sse(sseFrame(meta('fast-reply')))]) {
      const before = h.hub.of('aiFeatureStream').length;
      h.hub.on('aiFeatureStream', answer);
      const result = await run(h, reply, undefined, { advance: 60_000 });
      expect(result.error).not.toBeNull();
      expect(h.hub.of('aiFeatureStream').length - before).toBe(1);
    }
    expect(h.notices).toEqual([]);
  });

  it('[AI-141] a cancel during the 5 s pause makes no second POST', async () => {
    h.hub.on('aiFeatureStream', () => hubError(503, 'service_unavailable'));
    const controller = new AbortController();
    const result = h.facade.stream(reply, () => undefined, controller.signal).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(1_000);
    controller.abort();
    const error = await result;
    expect(isHubCallError(error) && error.failure).toEqual({ kind: 'transport', failure: 'aborted' });
    expect(errorWireOf(error)).toBeNull();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.hub.of('aiFeatureStream')).toHaveLength(1);
  });

  it('[AI-141] a cancel mid-stream reads as aborted (no code); a sign-out cancels the operation too', async () => {
    h.hub.on('aiFeatureStream', (request) => sse(sseFrame(meta('fast-reply')), { open: true, signal: request.signal }));
    const controller = new AbortController();
    const frames: HubFrame[] = [];
    const result = h.facade.stream(reply, (frame) => frames.push(frame), controller.signal).catch((error: unknown) => error);
    await until(() => frames.length > 0);
    expect(frames.map((frame) => frame.type)).toEqual(['meta']);
    controller.abort();
    expect(errorWireOf(await result)).toBeNull();
    const started = h.hub.of('aiFeatureStream').length;
    const second = h.facade.stream(reply, () => undefined, new AbortController().signal).catch((error: unknown) => error);
    await until(() => h.hub.of('aiFeatureStream').length > started);
    await h.facade.signOut();
    const error = await second;
    expect(isHubCallError(error) && error.failure).toEqual({ kind: 'transport', failure: 'aborted' });
  });
});

describe('[AI-140] [AU-028] the stream is a sensitive action: checked before any request', () => {
  const reply: HubStreamRequest = { feature: 'fast-reply', body: streamBody({ replyTone: 'casual' }), capabilities: [] };

  it('[AU-028] a persona missing from the catalog, an archived one, a changed definition, an empty catalog', async () => {
    await signIn(h, WORLD_PILOT);
    await flush(20);
    expect((await run(h, { ...reply, body: streamBody({ personaKey: 'nobody' }) })).code).toBe('CG-PERSONA-UNAVAILABLE');
    const reads = h.hub.of('aiPersonaCatalog').length;
    expect((await run(h, { ...reply, body: streamBody({ expectedPersonaDefinitionId: WORLD.persona.otherDefinitionId }) })).code).toBe('CG-PERSONA-CHANGED');
    await flush(20);
    expect(h.hub.of('aiPersonaCatalog').length).toBe(reads + 1);
    h.hub.on('aiPersonaCatalog', () => json(200, { personas: [] }));
    await h.facade.checkConnection().catch(() => undefined);
    expect((await run(h, reply)).code).toBe('CG-PERSONA-NONE');
    expect(h.hub.of('aiFeatureStream')).toEqual([]);
  });

  it('[AI-140] page not granted, a feature flag off, a capability the hub or the transport lacks, below minVersion, a bad request', async () => {
    await signIn(h, { ...WORLD_PILOT, bootstrap: BOOTSTRAP_ALL_OFF });
    expect((await run(h, { ...reply, body: streamBody({ pageLabel: 'not-my-page' }) })).code).toBe('CG-BINDING-NOT-GRANTED');
    expect((await run(h, { feature: 'chat-review', body: streamBody(), capabilities: [] })).code).toBe('CG-FEATURE-DISABLED');
    expect((await run(h, { ...reply, capabilities: ['context-v1'] })).code).toBe('CG-HUB-CAPABILITY');
    expect((await run(h, { ...reply, body: { ...streamBody(), model: 'x' } as never })).code).toBe('CG-HUB-REQUEST');
    h.hub.on('clientBootstrap', () => json(200, { ...BOOTSTRAP_PILOT_ON, minVersion: '9.0.0' }));
    await h.facade.bootstrap({ force: true });
    expect((await run(h, reply)).code).toBe('CG-HUB-OUTDATED');
    expect(h.hub.of('aiFeatureStream')).toEqual([]);
  });

  it('[AI-140] the vendored SDK carries debug-input-v1 only: context-v1 is refused locally, never sent', async () => {
    h = makeHarness({ paths: HUB_ROUTE_PATHS, streamTransport: sdkStreamTransport, env: testEnv({ debug: true }) });
    await signIn(h, WORLD_PILOT);
    expect(h.facade.streamCapabilities()).toEqual(['debug-input-v1']);
    expect((await run(h, { ...reply, capabilities: ['context-v1'] })).code).toBe('CG-HUB-CAPABILITY');
    expect(h.hub.of('aiFeatureStream')).toEqual([]);
  });

  it('[DB-002] through the vendored SDK: the debug header, the echo frame, the reply — end to end', async () => {
    h = makeHarness({ paths: HUB_ROUTE_PATHS, streamTransport: sdkStreamTransport, env: testEnv({ debug: true }) });
    await signIn(h, WORLD_PILOT);
    const scenario = scenarioNamed(SSE_SCENARIOS, 'debug-input-and-reasoning');
    const request: HubStreamRequest = { ...scenario.request, capabilities: ['debug-input-v1'] };
    const response = scenario.responses[0];
    if (response?.kind !== 'stream') throw new Error('stream expected');
    h.hub.on('aiFeatureStream', () => sse(sseText({ kind: 'stream', steps: response.steps.filter((step) => step.kind !== 'frame' || step.frame.type !== 'context_v1') })));
    const result = await run(h, request);
    expect(result.error).toBeNull();
    expect(result.frames.map((frame) => frame.type)).toEqual(['meta', 'debug_input_v1', 'reasoning_delta', 'content_delta', 'usage', 'done']);
    expect(h.hub.of('aiFeatureStream')[0]?.headers).toMatchObject({ 'x-kernel-ai-capabilities': 'debug-input-v1', 'x-client-version': 'chat-extension/0.2.0', accept: 'text/event-stream' });
    const ticket = h.facade.promptEchoTicket(request.body.clientRequestId);
    expect(ticket).toMatchObject({ state: 'ok', blocks: 2, chars: 'system'.length + 'transcript'.length, fromCache: false });
  });

  it('[AI-140] the vendored SDK without debug: no capability header; a 409 persona refusal refreshes the catalog', async () => {
    h = makeHarness({ paths: HUB_ROUTE_PATHS, streamTransport: sdkStreamTransport });
    await signIn(h, WORLD_PILOT);
    await flush(20);
    const reads = h.hub.of('aiPersonaCatalog').length;
    h.hub.on('aiFeatureStream', () => hubError(409, 'persona_definition_changed'));
    const result = await run(h, reply);
    expect(result.code).toBe('CG-PERSONA-CHANGED');
    expect(isHubCallError(result.error) && result.error.resolution?.disposition).toBe('refresh-catalog');
    expect(h.hub.of('aiFeatureStream')[0]?.headers['x-kernel-ai-capabilities']).toBeUndefined();
    await flush(20);
    expect(h.hub.of('aiPersonaCatalog').length).toBe(reads + 1);
  });
});

describe('[AU-026] [AU-027] the persona catalog', () => {
  it('[AU-026] metadata only, bound to the sign-in; [AU-027] refreshed every 5 min, at sign-in and on «Проверить связь»', async () => {
    await signIn(h, WORLD_PILOT);
    await flush(20);
    expect(h.hub.of('aiPersonaCatalog')).toHaveLength(1);
    expect(await h.facade.catalog()).toEqual(WORLD_PILOT.catalog);
    expect(h.hub.of('aiPersonaCatalog')).toHaveLength(1);
    expect(h.local.data.get(STORAGE_KEYS.cacheCatalog)).toMatchObject({ v: 1, epoch: 1, hubOrigin: WORLD.hubOrigin, userId: WORLD.user.userId });
    await vi.advanceTimersByTimeAsync(CATALOG_TTL_MS);
    await h.facade.catalog();
    expect(h.hub.of('aiPersonaCatalog')).toHaveLength(2);
    h.hub.on('health', () => json(200, { status: 'ok', timestamp: new Date(NOW_MS).toISOString(), contractHash: '1'.repeat(64), capabilities: ['desktop-lifecycle-v2'], checks: { api: { status: 'ok' }, database: { status: 'ok', latencyMs: 1, error: null } } }));
    await h.facade.checkConnection();
    expect(h.hub.of('aiPersonaCatalog')).toHaveLength(3);
    const changes: number[] = [];
    h.facade.onCatalogChange(() => changes.push(1));
    h.hub.on('aiPersonaCatalog', () => json(200, { personas: [] }));
    await h.facade.checkConnection();
    expect(changes).toEqual([1]);
    await h.facade.signOut();
    expect(h.local.data.has(STORAGE_KEYS.cacheCatalog)).toBe(false);
    await signIn(h, WORLD_PILOT);
    await flush(20);
    expect(await h.facade.catalog()).toEqual(WORLD_PILOT.catalog);
  });
});

describe('[AU-027] the catalog refreshes by itself', () => {
  it('[AU-027] every 5 min while signed in, and when the bootstrap\'s configRevision moves', async () => {
    await signIn(h, WORLD_PILOT);
    await flush(20);
    expect(h.hub.of('aiPersonaCatalog')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(CATALOG_TTL_MS);
    expect(h.hub.of('aiPersonaCatalog')).toHaveLength(2);
    h.hub.on('clientBootstrap', () => json(200, { ...BOOTSTRAP_PILOT_ON, configRevision: BOOTSTRAP_PILOT_ON.configRevision + 1 }));
    await h.facade.bootstrap({ force: true });
    await flush(20);
    expect(h.hub.of('aiPersonaCatalog')).toHaveLength(3);
    await h.facade.signOut();
    await vi.advanceTimersByTimeAsync(3 * CATALOG_TTL_MS);
    expect(h.hub.of('aiPersonaCatalog')).toHaveLength(3);
  });
});

describe('[TL-013] the quota snapshot', () => {
  it('[TL-013] meta reports the page quota; 429 quota_denied marks the page spent until 00:00 UTC', async () => {
    await signIn(h, WORLD_PILOT);
    const seen: unknown[] = [];
    h.facade.onQuotaChange((quota) => seen.push(quota));
    serveScenario(h, scenarioNamed(SSE_SCENARIOS, 'reply-normal'));
    await run(h, scenarioNamed(SSE_SCENARIOS, 'reply-normal').request);
    expect(h.facade.quotaOf(PAGE_ID)).toMatchObject({ pageId: PAGE_ID, remainingRequestsToday: 120, resetsAt: '2026-10-04T00:00:00.000Z' });
    serveScenario(h, scenarioNamed(SSE_SCENARIOS, 'quota-429'));
    await run(h, scenarioNamed(SSE_SCENARIOS, 'quota-429').request);
    expect(h.facade.quotaOf(PAGE_ID)).toMatchObject({ remainingRequestsToday: 0, resetsAt: '2026-10-04T00:00:00.000Z' });
    expect(seen).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(Date.UTC(2026, 9, 4) - NOW_MS);
    expect(h.facade.quotaOf(PAGE_ID)).toBeNull();
  });
});

describe('[DB-002] [DB-003] [DB-006] [DB-008] the prompt echo of debug mode', () => {
  const debugScenario = scenarioNamed(SSE_SCENARIOS, 'debug-input-and-reasoning');

  beforeEach(async () => {
    h.env.debug = true;
    await signIn(h, WORLD_PILOT);
  });

  it('[DB-006] a tab gets an opaque token and counters; the text opens only by that token, only in debug', async () => {
    serveScenario(h, debugScenario);
    await run(h, debugScenario.request);
    const ticket = h.facade.promptEchoTicket(debugScenario.request.body.clientRequestId);
    expect(ticket).toMatchObject({ state: 'ok', blocks: 2, fromCache: false });
    expect(JSON.stringify(ticket)).not.toContain('transcript');
    const view = h.facade.promptEcho(ticket?.token ?? '');
    expect(view).toMatchObject({ state: 'ok', feature: 'recap', fromCache: false, blocks: [{ name: 'system 1', text: 'system', truncated: false }, { name: 'user 1', text: 'transcript', truncated: false }] });
    expect(view.manifest).toContain('3000');
    h.env.debug = false;
    expect(h.facade.promptEcho(ticket?.token ?? '')).toMatchObject({ state: 'debug-off', blocks: [] });
    expect(h.facade.promptEcho('unknown-token')).toMatchObject({ state: 'debug-off' });
  });

  it('[DB-003] the owner\'s window closed: no echo is not an error, the ticket says «echo off»', async () => {
    const response = debugScenario.responses[0];
    if (response?.kind !== 'stream') throw new Error('stream expected');
    h.hub.on('aiFeatureStream', () => sse(sseText({ kind: 'stream', steps: response.steps.filter((step) => step.kind !== 'frame' || step.frame.type !== 'debug_input_v1') })));
    const result = await run(h, debugScenario.request);
    expect(result.error).toBeNull();
    const ticket = h.facade.promptEchoTicket(debugScenario.request.body.clientRequestId);
    expect(ticket?.state).toBe('echo-off');
    expect(h.facade.promptEcho(ticket?.token ?? '')).toMatchObject({ state: 'echo-off' });
  });

  it('[DB-008] a cached result shows its original\'s echo «из кэша»; snapshots expire after 12 min and go at sign-out', async () => {
    serveScenario(h, debugScenario);
    await run(h, debugScenario.request);
    const cachedOp = '00000000-0000-4000-8000-0000000000cc';
    h.facade.promptEchoFromCache(debugScenario.request.body.clientRequestId, cachedOp);
    const cached = h.facade.promptEchoTicket(cachedOp);
    expect(cached).toMatchObject({ state: 'ok', fromCache: true });
    expect(h.facade.promptEcho(cached?.token ?? '')).toMatchObject({ state: 'ok', fromCache: true });
    await vi.advanceTimersByTimeAsync(12 * 60_000);
    expect(h.facade.promptEcho(cached?.token ?? '')).toMatchObject({ state: 'expired' });
    serveScenario(h, debugScenario);
    await run(h, debugScenario.request);
    const fresh = h.facade.promptEchoTicket(debugScenario.request.body.clientRequestId);
    await h.facade.signOut();
    expect(h.facade.promptEcho(fresh?.token ?? '')).toMatchObject({ state: 'not-found' });
    expect(h.facade.promptEchoTicket(debugScenario.request.body.clientRequestId)).toBeNull();
  });

  it('[DB-002] at most 10 snapshots are kept; long blocks are cut for the viewer', async () => {
    const response = debugScenario.responses[0];
    if (response?.kind !== 'stream') throw new Error('stream expected');
    const long = 'x'.repeat(600_000);
    const steps = response.steps.map((step) =>
      step.kind === 'frame' && step.frame.type === 'debug_input_v1' ? { ...step, frame: { ...step.frame, systemBlocks: [{ text: long, cache: '1h' as const }] } } : step,
    );
    const tokens: string[] = [];
    for (let i = 0; i < 11; i += 1) {
      const opId = `00000000-0000-4000-8000-0000000001${i.toString(16).padStart(2, '0')}`;
      h.hub.on('aiFeatureStream', () =>
        sse(sseText({ kind: 'stream', steps: steps.map((step) => (step.kind === 'frame' && step.frame.type === 'meta' ? { ...step, frame: { ...step.frame, clientRequestId: opId } } : step)) }), { chunkSize: 65_536 }),
      );
      const request = { ...debugScenario.request, body: { ...debugScenario.request.body, clientRequestId: opId } };
      await run(h, request);
      tokens.push(h.facade.promptEchoTicket(opId)?.token ?? '');
    }
    expect(h.facade.promptEcho(tokens[0] ?? '')).toMatchObject({ state: 'expired' });
    const last = h.facade.promptEcho(tokens[10] ?? '');
    expect(last.state).toBe('ok');
    expect(last.blocks[0]).toMatchObject({ truncated: true });
    expect(last.blocks[0]?.text.length).toBe(500_000);
  });
});
