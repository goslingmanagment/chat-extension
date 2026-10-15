// The AI stream (architecture.md §7, §8.4): every SSE scenario of the fake
// hub through the facade, the strict frame rules, the one transparent 503
// retry, the persona fence and catalog, the prompt echo and the quota
// (parity AI-140, AI-141, AU-026…AU-028, DB-002/003/006/008, TL-013).

import { AI_STREAM_CAPABILITIES, HUB_AI_FEATURES, STORAGE_KEYS, isHubCallError, isHubCheckError, type CgCode, type HubFrame, type HubStreamRequest } from '@cg/contracts';
import {
  BOOTSTRAP_ALL_OFF,
  BOOTSTRAP_PILOT_ON,
  BOOTSTRAP_PILOT_PAGES,
  HTTP_SCENARIOS,
  HUB_ROUTE_PATHS,
  NOW_MS,
  SSE_SCENARIOS,
  WORLD,
  hubServing,
  meta,
  pageFeaturesOff,
  readStreamScenario,
  sseText,
  streamBody,
  type SseScenario,
} from '@cg/testing/hub';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PromptEchoStore } from '../src/debug-echo';
import { CATALOG_TTL_MS, STREAM_RETRY_DELAY_MS, errorWireOf, featureOfHub, sdkStreamTransport, type AiStreamTransport } from '../src/index';
import { hubError, json, sse, sseFrame, testEnv } from './support/fake-hub';
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
  vi.useFakeTimers({ now: NOW_MS, toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
  h = makeHarness({ paths: HUB_ROUTE_PATHS });
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
        // The SDK writes the header itself: the tokens of the request, in the order of AI_STREAM_CAPABILITIES, joined by «, ».
        expect(post.headers['x-kernel-ai-capabilities']).toBe(scenario.request.capabilities.length === 0 ? undefined : AI_STREAM_CAPABILITIES.filter((capability) => scenario.request.capabilities.includes(capability)).join(', '));
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
    // What the operation is told, in order: the request left, the hub answered 503, the one retry waits.
    expect(h.notices).toEqual([
      { kind: 'sent', clientRequestId: OP, attempt: 1, at: NOW_MS },
      { kind: 'answered', clientRequestId: OP, attempt: 1, at: NOW_MS, status: 503 },
      { kind: 'retrying', clientRequestId: OP, retryAt: NOW_MS + STREAM_RETRY_DELAY_MS },
    ]);
    await vi.advanceTimersByTimeAsync(1);
    await result;
    expect(posts).toBe(2);
    expect(frames.at(-1)?.type).toBe('done');
    expect(h.notices.slice(3)).toEqual([
      { kind: 'sent', clientRequestId: OP, attempt: 2, at: NOW_MS + STREAM_RETRY_DELAY_MS },
      { kind: 'answered', clientRequestId: OP, attempt: 2, at: NOW_MS + STREAM_RETRY_DELAY_MS, status: 200 },
    ]);
  });

  it('[AI-141] 502, an unstructured 503, a network failure and an EOF are never repeated', async () => {
    for (const answer of [() => hubError(502, 'bad_gateway'), () => new Response('<html>busy</html>', { status: 503 }), () => 'network-error' as const, () => sse(sseFrame(meta('fast-reply')))]) {
      const before = h.hub.of('aiFeatureStream').length;
      h.hub.on('aiFeatureStream', answer);
      const result = await run(h, reply, undefined, { advance: 60_000 });
      expect(result.error).not.toBeNull();
      expect(h.hub.of('aiFeatureStream').length - before).toBe(1);
    }
    expect(h.notices.filter((notice) => notice.kind === 'retrying')).toEqual([]);
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
    // The page's own row: Review off there, no capability declared — and every top-level flag false, which decides nothing.
    const reviewOff = { ...pageFeaturesOff(BOOTSTRAP_PILOT_PAGES, ['review']), capabilities: [] };
    await signIn(h, { ...WORLD_PILOT, bootstrap: reviewOff });
    expect((await run(h, { ...reply, body: streamBody({ pageLabel: 'not-my-page' }) })).code).toBe('CG-BINDING-NOT-GRANTED');
    const review = await run(h, { feature: 'chat-review', body: streamBody(), capabilities: [] });
    expect(errorWireOf(review.error)).toEqual({ code: 'CG-FEATURE-DISABLED', detail: 'flag_off' });
    expect((await run(h, { ...reply, capabilities: ['context-v1'] })).code).toBe('CG-HUB-CAPABILITY');
    expect((await run(h, { ...reply, body: { ...streamBody(), model: 'x' } as never })).code).toBe('CG-HUB-REQUEST');
    h.hub.on('clientBootstrap', () => json(200, { ...BOOTSTRAP_PILOT_ON, minVersion: '9.0.0' }));
    await h.facade.bootstrap({ force: true });
    expect((await run(h, reply)).code).toBe('CG-HUB-OUTDATED');
    expect(h.hub.of('aiFeatureStream')).toEqual([]);
  });

  it('[AI-140] the owner\'s master switch off for the page: no AI call leaves at all — Reply included, which has no flag of its own', async () => {
    await signIn(h, { ...WORLD_PILOT, bootstrap: BOOTSTRAP_ALL_OFF });
    for (const request of [reply, { feature: 'chat-review', body: streamBody(), capabilities: [] } as HubStreamRequest]) {
      expect(errorWireOf((await run(h, request)).error)).toEqual({ code: 'CG-FEATURE-DISABLED', detail: 'disabled' });
    }
    expect(h.hub.of('aiFeatureStream')).toEqual([]);
  });

  it('[AI-140] a pilot switched on page by page (every top-level flag false): Review and Reply go out', async () => {
    await signIn(h, { ...WORLD_PILOT, bootstrap: BOOTSTRAP_PILOT_PAGES });
    h.hub.on('aiFeatureStream', (call) => sse([meta(call.path.endsWith('/chat-review') ? 'chat-review' : 'fast-reply'), { type: 'content_delta', text: 'ok' }, { type: 'done', stopReason: null }].map(sseFrame).join('')));
    expect((await run(h, { feature: 'chat-review', body: streamBody(), capabilities: [] })).error).toBeNull();
    expect((await run(h, reply)).error).toBeNull();
    expect(h.hub.of('aiFeatureStream')).toHaveLength(2);
  });

  it('[AI-140] the vendored SDK announces what the request asks — context-v1 and split-all-v1 on its own header — and reads `context_v1` by its own schema', async () => {
    h = makeHarness({ paths: HUB_ROUTE_PATHS, env: testEnv({ debug: true }) });
    await signIn(h, WORLD_PILOT);
    // Declared by the hub ∩ carried by the transport: coverage-check-v1 (HF-8в) and hi-start-proof-v1 (HF-5) included.
    // A request announces only what it asks for: ChatSpace sends neither proof capability (below).
    expect(h.facade.streamCapabilities()).toEqual(['debug-input-v1', 'context-v1', 'split-all-v1', 'coverage-check-v1', 'hi-start-proof-v1']);
    const scenario = scenarioNamed(SSE_SCENARIOS, 'hi-three-variants');
    expect(scenario.request.capabilities).toEqual(['context-v1', 'split-all-v1']);
    serveScenario(h, scenario);
    const result = await run(h, scenario.request);
    expect(result.error).toBeNull();
    expect(h.hub.of('aiFeatureStream')[0]?.headers['x-kernel-ai-capabilities']).toBe('context-v1, split-all-v1');
    // The frame passed the SDK's schema and then the contract's: the snapshot that served the generation.
    expect(result.frames.find((frame) => frame.type === 'context_v1')).toMatchObject({ type: 'context_v1', source: expect.any(String) as string, live: { status: expect.any(String) as string } });
  });

  it('[AI-140] a `context_v1` frame with a key this build does not know yet is served; one the SDK\'s schema refuses is a contract failure, never a crash', async () => {
    await signIn(h, WORLD_PILOT);
    const scenario = scenarioNamed(SSE_SCENARIOS, 'reply-normal');
    const response = scenario.responses[0];
    if (response?.kind !== 'stream') throw new Error('stream expected');
    const frames = response.steps.flatMap((step) => (step.kind === 'frame' ? [step.frame] : []));
    const context = frames.find((frame) => frame.type === 'context_v1');
    if (context === undefined) throw new Error('the scenario has a context frame');
    const withFrame = (replacement: unknown) => () => sse(frames.map((frame) => sseFrame(frame.type === 'context_v1' ? replacement : frame)).join(''));
    // A later hub adds a key: the frame is not strict on either side.
    h.hub.on('aiFeatureStream', withFrame({ ...context, servedBy: 'a-later-reader' }));
    const later = await run(h, scenario.request);
    expect(later.error).toBeNull();
    expect(later.frames.map((frame) => frame.type)).toContain('context_v1');
    // A frame that is not what the SDK knows as `context_v1` (no `window`): refused before anything of it is used.
    const { window: _window, ...broken } = context;
    h.hub.on('aiFeatureStream', withFrame(broken));
    const refused = await run(h, scenario.request);
    expect(isHubCallError(refused.error) && refused.error.failure).toEqual({ kind: 'transport', failure: 'contract' });
    expect(refused.code).toBe('CG-HUB-REQUEST');
    expect(refused.frames.map((frame) => frame.type)).not.toContain('context_v1');
  });

  it('[AI-140] a hub older than the SDK: what its bootstrap does not declare is never announced — refused locally (CG-HUB-CAPABILITY), nothing sent; a capability this build does not know changes nothing', async () => {
    h = makeHarness({ paths: HUB_ROUTE_PATHS, env: testEnv({ debug: true }) });
    // Prod lags main: the bootstrap declares neither `context-v1` nor `split-all-v1`, and one token of a later hub.
    await signIn(h, { ...WORLD_PILOT, bootstrap: hubServing(BOOTSTRAP_PILOT_PAGES, ['shared-recaps-v1', 'recap-profile-v1', 'some-later-capability-v9']) });
    expect(h.facade.streamCapabilities()).toEqual(['debug-input-v1']);
    for (const capability of ['context-v1', 'split-all-v1'] as const) {
      const refused = await run(h, { ...reply, capabilities: [capability] });
      expect(errorWireOf(refused.error)).toEqual({ code: 'CG-HUB-CAPABILITY', detail: capability });
    }
    expect(h.hub.of('aiFeatureStream')).toEqual([]);
    // What depends on them reads «хаб не готов», in the hub's own word.
    expect(h.facade.flagState('freshText', WORLD.pages.one.pageLabel)).toEqual({ usable: false, reason: 'hub_not_ready' });
    expect(h.facade.flagState('splitAll', WORLD.pages.one.pageLabel)).toEqual({ usable: false, reason: 'hub_not_ready' });
    expect(h.facade.flagState('recap', WORLD.pages.one.pageLabel)).toEqual({ usable: true, reason: null });
    // And a plain request goes out without the header and runs.
    h.hub.on('aiFeatureStream', () => sse([meta('fast-reply'), { type: 'content_delta', text: 'ok' }, { type: 'done', stopReason: null }].map(sseFrame).join('')));
    const plain = await run(h, reply);
    expect(plain.error).toBeNull();
    expect(h.hub.of('aiFeatureStream')[0]?.headers['x-kernel-ai-capabilities']).toBeUndefined();
  });

  it('[DB-002] through the vendored SDK: the debug header, the echo frame, the reply — end to end', async () => {
    h = makeHarness({ paths: HUB_ROUTE_PATHS, env: testEnv({ debug: true }) });
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
    h = makeHarness({ paths: HUB_ROUTE_PATHS });
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

describe('[AI-141] where a request stands is said, never guessed: sent, answered, or not at all', () => {
  const reply: HubStreamRequest = { feature: 'fast-reply', body: streamBody({ replyTone: 'casual' }), capabilities: [] };
  const lines = (prefix: string) => h.logs.lines.filter((line) => line.message.startsWith(prefix));

  beforeEach(async () => {
    await signIn(h, WORLD_PILOT);
    await flush(20);
  });

  it('[AI-141] an answered request leaves two lines — «request sent», «answered» — with the route, the attempt and timings, and never a payload', async () => {
    h.hub.on('aiFeatureStream', () => sse([meta('fast-reply'), { type: 'content_delta', text: 'a secret reply text' }, { type: 'done', stopReason: null }].map(sseFrame).join('')));
    expect((await run(h, reply)).error).toBeNull();
    expect(lines('hub: stream request sent')).toEqual([{ level: 'info', message: 'hub: stream request sent', fields: { route: 'aiFeatureStream', feature: 'fast-reply', attempt: 1, epoch: 1, prepareMs: 0 } }]);
    expect(lines('hub: stream answered')).toEqual([{ level: 'info', message: 'hub: stream answered', fields: { route: 'aiFeatureStream', feature: 'fast-reply', attempt: 1, epoch: 1, status: 200, answerMs: 0 } }]);
    expect(lines('hub: stream aborted')).toEqual([]);
    expect(h.notices).toEqual([
      { kind: 'sent', clientRequestId: OP, attempt: 1, at: NOW_MS },
      { kind: 'answered', clientRequestId: OP, attempt: 1, at: NOW_MS, status: 200 },
    ]);
    // Facts only: nothing of the request body or of the answer reaches the log.
    expect(h.logs.text()).not.toContain('a secret reply text');
    expect(h.logs.text()).not.toContain(reply.body.conversationRef);
    expect(h.logs.text()).not.toContain(String(WORLD_PILOT.issued['token']));
  });

  it('[AI-141] sent and never answered: the caller\'s deadline cuts it, and the log says the hub had not answered — after how long', async () => {
    h.hub.on('aiFeatureStream', () => 'hang');
    const controller = new AbortController();
    const result = h.facade.stream(reply, () => undefined, controller.signal).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(lines('hub: stream request sent')).toHaveLength(1);
    expect(lines('hub: stream answered')).toEqual([]);
    // The operation's `until-meta` deadline (the scheduler's) aborts the call.
    controller.abort();
    const error = await result;
    expect(isHubCallError(error) && error.failure).toEqual({ kind: 'transport', failure: 'aborted' });
    expect(lines('hub: stream aborted')).toEqual([
      { level: 'warn', message: 'hub: stream aborted before the hub answered', fields: { route: 'aiFeatureStream', feature: 'fast-reply', attempt: 1, epoch: 1, waitedMs: 30_000 } },
    ]);
    expect(h.notices).toEqual([{ kind: 'sent', clientRequestId: OP, attempt: 1, at: NOW_MS }]);
  });

  it('[AI-141] the browser could not send it: CG-NETWORK at once — not a wait for the deadline — with its own log line', async () => {
    h.hub.on('aiFeatureStream', () => 'network-error');
    const result = await run(h, reply, undefined, { advance: 0 });
    expect(isHubCallError(result.error) && result.error.failure).toEqual({ kind: 'transport', failure: 'network' });
    expect(result.code).toBe('CG-NETWORK');
    expect(lines('hub: stream answered')).toEqual([]);
    expect(lines('hub: call failed').at(-1)).toMatchObject({ level: 'warn', fields: { route: 'aiFeatureStream', failure: 'network', code: 'CG-NETWORK' } });
    expect(h.hub.of('aiFeatureStream')).toHaveLength(1);
  });

  it('[AI-141] a failure before the request is handed to the network — in the transport, while the request is put together — ends at once as CG-HUB-REQUEST with a log line', async () => {
    const broken: AiStreamTransport = {
      capabilities: sdkStreamTransport.capabilities,
      open: () => Promise.reject(new RangeError('the request could not be put together')),
    };
    h.facade.dispose();
    h = makeHarness({ paths: HUB_ROUTE_PATHS, streamTransport: broken });
    await signIn(h, WORLD_PILOT);
    await flush(20);
    const result = await run(h, reply, undefined, { advance: 0 });
    expect(isHubCallError(result.error) && result.error.failure).toEqual({ kind: 'transport', failure: 'contract' });
    expect(result.code).toBe('CG-HUB-REQUEST');
    expect(lines('hub: stream request not sent')).toEqual([
      { level: 'error', message: 'hub: stream request not sent', fields: { route: 'aiFeatureStream', feature: 'fast-reply', attempt: 1, epoch: 1, error: 'RangeError' } },
    ]);
    expect(lines('hub: call failed').at(-1)).toMatchObject({ fields: { route: 'aiFeatureStream', code: 'CG-HUB-REQUEST' } });
    expect(h.hub.of('aiFeatureStream')).toEqual([]);
    expect(h.notices).toEqual([]);
    // The message of what threw is not logged: only its name.
    expect(h.logs.text()).not.toContain('could not be put together');
  });

  it('[AI-141] a request the hub layer refuses itself (a page not granted, a capability missing) is logged with its check before it throws', async () => {
    const refused = await run(h, { ...reply, body: streamBody({ pageLabel: 'not-my-page' }) });
    expect(refused.code).toBe('CG-BINDING-NOT-GRANTED');
    expect(lines('hub: stream refused before the request')).toEqual([
      { level: 'warn', message: 'hub: stream refused before the request', fields: { route: 'aiFeatureStream', feature: 'fast-reply', kind: 'pageNotGranted', code: 'CG-BINDING-NOT-GRANTED', reason: null, epoch: 1 } },
    ]);
    expect(h.hub.of('aiFeatureStream')).toEqual([]);
  });

  it('[AI-141] cut before anything was sent (the sign-in ended while the request was prepared): the log says it never left', async () => {
    const slow: AiStreamTransport = {
      capabilities: sdkStreamTransport.capabilities,
      // Never reaches `onRequest`: resolves quietly when the call is aborted, as the SDK's stream does.
      open: (input) => new Promise((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true })),
    };
    h.facade.dispose();
    h = makeHarness({ paths: HUB_ROUTE_PATHS, streamTransport: slow });
    await signIn(h, WORLD_PILOT);
    await flush(20);
    const controller = new AbortController();
    const result = h.facade.stream(reply, () => undefined, controller.signal).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(1_200);
    controller.abort();
    expect(isHubCallError(await result)).toBe(true);
    expect(lines('hub: stream aborted')).toEqual([
      { level: 'warn', message: 'hub: stream aborted before the request was sent', fields: { route: 'aiFeatureStream', feature: 'fast-reply', attempt: 1, epoch: 1, waitedMs: 1_200 } },
    ]);
  });
});

describe('[AI-141] [HB-011] a generation never waits silently for a bootstrap refresh', () => {
  // The first live check: Fix and Hi ended with CG-HUB-TIMEOUT after 30 s and the hub had seen no request of
  // theirs — the stream was waiting for a bootstrap refresh that hung on the network path, and said nothing.
  const reply: HubStreamRequest = { feature: 'fast-reply', body: streamBody({ replyTone: 'casual' }), capabilities: [] };
  const lines = (prefix: string) => h.logs.lines.filter((line) => line.message.startsWith(prefix));
  const TTL_MS = BOOTSTRAP_PILOT_ON.ttlSec * 1000;
  const facts = { route: 'aiFeatureStream', feature: 'fast-reply', epoch: 1 };
  const answered = () => sse([meta('fast-reply'), { type: 'content_delta', text: 'ok' }, { type: 'done', stopReason: null }].map(sseFrame).join(''));

  beforeEach(async () => {
    await signIn(h, WORLD_PILOT);
    await flush(20);
    h.hub.on('aiFeatureStream', answered);
  });

  it('[AI-141] the bootstrap ran out a moment ago and its refresh hangs: the generation goes out at once on the cached one, and the log says so', async () => {
    h.hub.on('clientBootstrap', () => 'hang');
    await vi.advanceTimersByTimeAsync(TTL_MS + 200); // expired; the refresh of its ttl is in flight and never answers
    expect(h.facade.cachedBootstrap()?.fresh).toBe(false);
    const reads = h.hub.of('clientBootstrap').length;
    const result = await run(h, reply, undefined, { advance: 0 });
    expect(result.error).toBeNull();
    expect(result.frames.map((frame) => frame.type)).toEqual(['meta', 'content_delta', 'done']);
    expect(h.hub.of('aiFeatureStream')).toHaveLength(1);
    expect(lines('hub: stream served from a just-expired bootstrap')).toEqual([
      { level: 'info', message: 'hub: stream served from a just-expired bootstrap', fields: { ...facts, expiredMs: 200, refresh: 'running' } },
    ]);
    expect(lines('hub: stream waits')).toEqual([]);
    // The refresh already in flight is the only one: a generation does not pile requests onto a slow link.
    expect(h.hub.of('clientBootstrap')).toHaveLength(reads);
  });

  it('[AI-141] the refresh failed and waits for its pause: still served from the cached one for 2 × ttl after the expiry — the hub checks every call itself', async () => {
    h.hub.on('clientBootstrap', () => hubError(503, 'service_unavailable'));
    await vi.advanceTimersByTimeAsync(TTL_MS + 1_000);
    expect((await run(h, reply, undefined, { advance: 0 })).error).toBeNull();
    expect(lines('hub: stream served from a just-expired bootstrap').at(-1)?.fields).toEqual({ ...facts, expiredMs: 1_000, refresh: 'scheduled' });
    expect(lines('hub: bootstrap refresh failed')[0]).toEqual({
      level: 'warn',
      message: 'hub: bootstrap refresh failed',
      fields: { route: 'clientBootstrap', failures: 1, retryInMs: 5_000, cached: 'expired', epoch: 1 },
    });
    // The last moment of the grace: 2 × ttl after the expiry.
    await vi.advanceTimersByTimeAsync(2 * TTL_MS - 1_000);
    expect((await run(h, reply, undefined, { advance: 0 })).error).toBeNull();
    expect(lines('hub: stream served from a just-expired bootstrap').at(-1)?.fields).toMatchObject({ expiredMs: 2 * TTL_MS });
    expect(h.hub.of('aiFeatureStream')).toHaveLength(2);
    // What the cached bootstrap does not allow is still refused here, expired or not.
    expect((await run(h, { ...reply, body: streamBody({ pageLabel: 'not-my-page' }) }, undefined, { advance: 0 })).code).toBe('CG-BINDING-NOT-GRANTED');
    expect(h.hub.of('aiFeatureStream')).toHaveLength(2);
  });

  it('[AI-141] expired longer ago than that, the refresh still hanging: the generation waits — only as long as the operation lives — and the log says it waited and that nothing was sent', async () => {
    h.hub.on('clientBootstrap', () => 'hang');
    await vi.advanceTimersByTimeAsync(3 * TTL_MS + 1_000);
    const before = h.logs.lines.length;
    const controller = new AbortController();
    const result = h.facade.stream(reply, () => undefined, controller.signal).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(lines('hub: stream waits for a bootstrap refresh')).toEqual([{ level: 'info', message: 'hub: stream waits for a bootstrap refresh', fields: { ...facts, cached: 'expired' } }]);
    controller.abort(); // the operation's deadline (the scheduler's until-meta), or «Отменить»
    const error = await result;
    expect(isHubCallError(error) && { route: error.route, failure: error.failure }).toEqual({ route: 'aiFeatureStream', failure: { kind: 'transport', failure: 'aborted' } });
    expect(h.logs.lines.slice(before).filter((line) => line.message.startsWith('hub: stream'))).toEqual([
      { level: 'info', message: 'hub: stream waits for a bootstrap refresh', fields: { ...facts, cached: 'expired' } },
      { level: 'warn', message: 'hub: stream waited for a bootstrap refresh', fields: { ...facts, waitMs: 10_000, outcome: 'aborted' } },
      { level: 'warn', message: 'hub: stream aborted before the request was sent', fields: { ...facts, attempt: 1, waitedMs: 10_000 } },
    ]);
    // Nothing left for the hub, and nothing says it did.
    expect(h.hub.of('aiFeatureStream')).toEqual([]);
    expect(h.notices).toEqual([]);
    // The refresh lands later: it never revives the operation that was cut.
    h.hub.on('clientBootstrap', () => json(200, BOOTSTRAP_PILOT_ON));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(h.facade.cachedBootstrap()?.fresh).toBe(true);
    expect(h.hub.of('aiFeatureStream')).toEqual([]);
    expect(lines('hub: stream request sent')).toEqual([]);
  });

  it('[AI-141] the awaited refresh lands in time: the generation goes out, and the log says how long it waited', async () => {
    h.hub.on('clientBootstrap', () => 'hang');
    // 901 s in: every refresh so far has timed out and the next retry waits for its pause; the one this
    // generation starts answers after 4 s.
    await vi.advanceTimersByTimeAsync(3 * TTL_MS + 1_000);
    h.hub.on('clientBootstrap', async () => {
      await new Promise((resolve) => setTimeout(resolve, 4_000));
      return json(200, { ...BOOTSTRAP_PILOT_ON, issuedAt: new Date(Date.now()).toISOString() });
    });
    expect(h.facade.cachedBootstrap()?.fresh).toBe(false);
    const result = await run(h, reply, undefined, { advance: 4_000 });
    expect(result.error).toBeNull();
    expect(lines('hub: stream waited for a bootstrap refresh')).toEqual([{ level: 'warn', message: 'hub: stream waited for a bootstrap refresh', fields: { ...facts, waitMs: 4_000, outcome: 'refreshed' } }]);
    expect(lines('hub: stream request sent')).toHaveLength(1);
    expect(h.hub.of('aiFeatureStream')).toHaveLength(1);
  });

  it('[AI-141] the awaited refresh fails first: its own error ends the generation, with the bootstrap call\'s «slow call» and «call failed» lines next to the wait', async () => {
    h.hub.on('clientBootstrap', () => 'hang');
    await vi.advanceTimersByTimeAsync(3 * TTL_MS + 1_000);
    const before = h.logs.lines.length;
    const result = await run(h, reply, undefined, { advance: 30_000 });
    expect(result.code).toBe('CG-HUB-TIMEOUT');
    expect(isHubCallError(result.error) && result.error.route).toBe('clientBootstrap');
    const after = h.logs.lines.slice(before);
    expect(after.map((line) => line.message)).toEqual([
      'hub: stream waits for a bootstrap refresh',
      'hub: slow call',
      'hub: call failed',
      'hub: bootstrap refresh failed',
      'hub: stream waited for a bootstrap refresh',
    ]);
    expect(after[1]?.fields).toEqual({ route: 'clientBootstrap', ms: 30_000, outcome: 'failed', failure: 'timeout', epoch: 1 });
    expect(after[2]?.fields).toEqual({ route: 'clientBootstrap', failure: 'timeout', code: 'CG-HUB-TIMEOUT', disposition: 'show', epoch: 1 });
    expect(after[4]?.fields).toEqual({ ...facts, waitMs: 30_000, outcome: 'failed' });
    expect(h.hub.of('aiFeatureStream')).toEqual([]);
    expect(h.notices).toEqual([]);
  });

  it('[AI-141] an operation that is already cut when its stream is asked for: no request, no «request sent» — through the vendored SDK too, which would not stop it by itself', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await run(h, reply, controller.signal, { advance: 0 });
    expect(isHubCallError(result.error) && result.error.failure).toEqual({ kind: 'transport', failure: 'aborted' });
    expect(lines('hub: stream')).toEqual([{ level: 'warn', message: 'hub: stream aborted before the request was sent', fields: { ...facts, attempt: 1, waitedMs: 0 } }]);
    expect(h.hub.of('aiFeatureStream')).toEqual([]);
    expect(h.notices).toEqual([]);
    // The transport by itself: an aborted call is never handed to fetch and never reported as handed over.
    const fetched = vi.fn<typeof fetch>();
    const onRequest = vi.fn();
    await sdkStreamTransport.open({
      hubOrigin: 'https://hub.example.test',
      token: 'synthetic',
      headers: {},
      fetch: fetched,
      feature: reply.feature,
      body: reply.body,
      capabilities: [],
      signal: controller.signal,
      onFrame: () => undefined,
      onAuthError: () => undefined,
      onRequest,
    });
    expect(fetched).not.toHaveBeenCalled();
    expect(onRequest).not.toHaveBeenCalled();
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

  it('Fansly\'s two hub features are its own operations; their echo opens without a shared feature\'s name (contracts 1.15.0, P4b3)', () => {
    expect(HUB_AI_FEATURES.map((feature) => featureOfHub(feature, undefined))).toEqual(['reply', 'fix', 'hi', 'ping', 'review', 'recap', 'coach', 'voice-script', 'notes-fill']);
    expect(featureOfHub('fan-summary', 'short')).toBe('recap-short');
    let n = 0;
    const store = new PromptEchoStore({ now: () => NOW_MS, monotonic: () => 0 }, () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, '0')}`);
    store.requested('op-voice', 'voice-script');
    store.record('op-voice', { type: 'debug_input_v1', systemBlocks: [{ text: 'system', cache: 'none' }], userBlocks: [{ text: 'draft', cache: 'none' }], contextManifest: null });
    const ticket = store.ticket('op-voice');
    expect(ticket).toMatchObject({ state: 'ok', blocks: 2 });
    expect(store.view(ticket?.token ?? '', true)).toMatchObject({ state: 'ok', feature: null, blocks: [{ name: 'system 1', text: 'system' }, { name: 'user 1', text: 'draft' }] });
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
