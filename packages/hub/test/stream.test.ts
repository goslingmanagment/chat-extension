// The AI stream (architecture.md §7, §8.4): every SSE scenario of the fake
// hub through the facade, the strict frame rules, the one transparent 503
// retry, the persona fence and catalog, the prompt echo and the quota
// (parity AI-140, AI-141, AU-026…AU-028, DB-002/003/006/008, TL-013).

import { AI_STREAM_CAPABILITIES, isHubCallError, isHubCheckError, type CgCode, type HubFrame, type HubStreamRequest } from '@cg/contracts';
import {
  BOOTSTRAP_ALL_OFF,
  BOOTSTRAP_PILOT_ON,
  BOOTSTRAP_PILOT_PAGES,
  HTTP_SCENARIOS,
  HUB_ROUTE_PATHS,
  NOW_MS,
  SSE_SCENARIOS,
  WORLD,
  meta,
  pageFeaturesOff,
  readStreamScenario,
  sseText,
  streamBody,
  type SseScenario,
} from '@cg/testing/hub';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { STREAM_RETRY_DELAY_MS, errorWireOf } from '../src/index';
import { hubError, json, sse, sseFrame } from './support/fake-hub';
import { flush, makeHarness, signIn, type Harness } from './support/harness';
import { scenarioNamed, signInWorld } from './support/world';

const SIGN_IN = scenarioNamed(HTTP_SCENARIOS, 'sign-in-and-bootstrap-all-off');
const WORLD_PILOT = signInWorld(SIGN_IN, BOOTSTRAP_PILOT_ON, WORLD.user.username);
const OP = streamBody().clientRequestId;

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
});
