// AI stream scenarios (architecture.md §7, §8.4; hub H-4b, H-10): frame
// sequences the fake hub plays on `aiFeatureStream`, with what the client
// must make of each. Covers the normal stream, Split markers (also across a
// chunk boundary), Hi variants, every pre-stream refusal (persona 409, quota
// 429, 503 with its one retry), terminal error frames, truncation, the
// persona fence on `meta`, and the context_v1 variants.

import {
  type AiFeatureStreamBody,
  type ContextFrame,
  type HubAiFeature,
  type HubErrorBody,
  type HubErrorCode,
  type HubFrame,
  type HubStreamRequest,
  type MetaFrame,
} from '@cg/contracts';

import { statusOf } from './reference';
import { type SseExpectation, type SseResponse, type SseScenario, type SseStep } from './types';
import { PAGE, WORLD, at, uuid } from './world';

const OP = uuid(0x100);
const GEN = uuid(0x200);
const { fan } = WORLD;
const { definitionId } = WORLD.persona;

export function streamBody(over: Partial<AiFeatureStreamBody> = {}): AiFeatureStreamBody {
  return {
    clientRequestId: OP,
    pageLabel: PAGE,
    platform: 'onlyfans',
    conversationRef: fan,
    fanRef: fan,
    personaKey: WORLD.persona.key,
    expectedPersonaDefinitionId: definitionId,
    messageCount: 100,
    isRegeneration: false,
    ...over,
  };
}

const request = (feature: HubAiFeature, body: Partial<AiFeatureStreamBody> = {}, capabilities: HubStreamRequest['capabilities'] = ['context-v1']): HubStreamRequest => ({
  feature,
  body: streamBody(body),
  capabilities,
});

export function meta(feature: HubAiFeature, over: Partial<MetaFrame> = {}): MetaFrame {
  return {
    type: 'meta',
    requestId: GEN,
    clientRequestId: OP,
    feature,
    pageLabel: PAGE,
    model: 'model-x',
    provider: 'anthropic',
    providerResponseId: null,
    personaDefinitionId: definitionId,
    quota: { accepted: true, remainingRequestsToday: 120, remainingMicroUsdToday: null },
    ...over,
  };
}

export function contextFrame(over: Partial<ContextFrame> = {}): ContextFrame {
  return {
    type: 'context_v1',
    generationRef: GEN,
    source: 'union',
    servedHead: { messageRef: WORLD.messages.fanLatest, occurredAt: at(-60), isFromFan: true },
    archiveHead: { messageRef: WORLD.messages.modelReply, occurredAt: at(-600), isFromFan: false },
    window: { requested: 100, served: 42 },
    coverage: 'complete',
    knownFanMessage: { id: WORLD.messages.fanLatest, state: 'included' },
    live: { status: 'served', accepted: 3, rejected: 0 },
    fanLanguageEvidence: 'latin',
    ...over,
  };
}

const frame = (f: HubFrame, afterMs?: number): SseStep => (afterMs === undefined ? { kind: 'frame', frame: f } : { kind: 'frame', frame: f, afterMs });
const delta = (text: string): SseStep => frame({ type: 'content_delta', text }, 20);
const usage: SseStep = frame({
  type: 'usage',
  usage: { inputTokens: 1800, outputTokens: 60, cacheWriteTokens: 0, cacheReadTokens: 1500, costMicroUsd: 3100, costApproximate: false },
  providerResponseId: 'resp_01',
  cacheHit: true,
});
const done: SseStep = frame({ type: 'done', stopReason: 'end_turn' });
const eof: SseStep = { kind: 'eof' };
const stream = (...steps: SseStep[]): SseResponse => ({ kind: 'stream', steps: [...steps, eof] });

function refusal(error: HubErrorCode, message: string, reason?: string): SseResponse {
  const status = statusOf(error);
  const body: HubErrorBody = reason === undefined ? { error, message, statusCode: status } : { error, message, statusCode: status, reason };
  return { kind: 'http-error', status, body };
}

const ok = (result: string[][], context: SseExpectation['context'] = { source: 'union', live: 'served' }): SseExpectation => ({
  outcome: 'done',
  requests: 1,
  cg: null,
  disposition: null,
  retryAfterMs: null,
  result,
  context,
});
const failed = (cg: SseExpectation['cg'], disposition: SseExpectation['disposition'], over: Partial<SseExpectation> = {}): SseExpectation => ({
  outcome: 'failed',
  requests: 1,
  cg,
  disposition,
  retryAfterMs: null,
  result: null,
  context: null,
  ...over,
});

const reply = request('fast-reply', { replyTone: 'flirty', replyMode: 'preferSplit', knownFanMessageId: WORLD.messages.fanLatest });

export const SSE_SCENARIOS: readonly SseScenario[] = [
  {
    name: 'reply-normal',
    description: 'Reply: meta → context_v1 → deltas → usage → done; one part.',
    request: request('fast-reply', { replyTone: 'casual' }),
    responses: [stream(frame(meta('fast-reply')), frame(contextFrame()), delta('Hey you, '), delta('missed me?'), usage, done)],
    expect: ok([['Hey you, missed me?']]),
  },
  {
    name: 'reply-split-across-chunks',
    description: 'Split asked: the [NEXT] marker arrives cut between two chunks and still splits after `done`.',
    request: reply,
    responses: [stream(frame(meta('fast-reply')), frame(contextFrame()), delta('First part [NE'), delta('XT] second part'), usage, done)],
    expect: ok([['First part', 'second part']]),
  },
  {
    name: 'reply-split-one-part',
    description: 'Split asked, one part came: «Получилась одна часть», no automatic regeneration (AI-011).',
    request: reply,
    responses: [stream(frame(meta('fast-reply')), frame(contextFrame()), delta('Just one message'), usage, done)],
    expect: ok([['Just one message']]),
  },
  {
    name: 'hi-three-variants',
    description: 'Hi in the dock: three [VARIANT]s, parts inside by [NEXT] (split-all-v1).',
    request: request('hi-greeting', { variantCount: 3, replyMode: 'preferSplit' }, ['context-v1', 'split-all-v1']),
    responses: [
      stream(
        frame(meta('hi-greeting')),
        frame(contextFrame({ live: { status: 'served', accepted: 1, rejected: 0 } })),
        delta('Hi there [NEXT] glad you joined'),
        delta('[VARIANT]Hey you!'),
        delta('[VARIANT]Welcome [NEXT] want a peek?'),
        usage,
        done,
      ),
    ],
    expect: ok([['Hi there', 'glad you joined'], ['Hey you!'], ['Welcome', 'want a peek?']]),
  },
  {
    name: 'persona-409',
    description: 'The persona changed after the catalog was read: 409 before the stream; refresh the catalog.',
    request: reply,
    responses: [refusal('persona_definition_changed', 'Persona changed')],
    expect: failed('CG-PERSONA-CHANGED', 'refresh-catalog'),
  },
  {
    name: 'persona-changed-in-meta',
    description: 'meta names another persona definition: drop the result, refresh the catalog (§7 «Ограда»).',
    request: reply,
    responses: [stream(frame(meta('fast-reply', { personaDefinitionId: WORLD.persona.otherDefinitionId })), delta('text'), usage, done)],
    expect: failed('CG-PERSONA-CHANGED', 'refresh-catalog'),
  },
  {
    name: 'quota-429',
    description: 'The daily AI quota is spent: CG-QUOTA-DAILY until 00:00 UTC.',
    request: reply,
    responses: [refusal('quota_denied', 'Quota denied')],
    expect: failed('CG-QUOTA-DAILY', 'show', { retryAfterMs: Date.UTC(2026, 9, 4) - Date.UTC(2026, 9, 3, 10) }),
  },
  {
    name: 'unavailable-503-then-stream',
    description: 'A structured 503 before the first frame: one transparent retry after 5 s, which streams.',
    request: reply,
    responses: [refusal('service_unavailable', 'Service unavailable'), stream(frame(meta('fast-reply')), frame(contextFrame()), delta('Back online'), usage, done)],
    expect: { ...ok([['Back online']]), requests: 2 },
  },
  {
    name: 'unavailable-503-twice',
    description: 'The retry is refused too: CG-HUB-UNAVAILABLE, no third request.',
    request: reply,
    responses: [refusal('service_unavailable', 'Service unavailable'), refusal('service_unavailable', 'Service unavailable')],
    expect: failed('CG-HUB-UNAVAILABLE', 'show', { requests: 2 }),
  },
  {
    name: 'error-frame-provider-rate-limited',
    description: 'A terminal error frame with retryAfterMs: an absolute display deadline, no automatic retry.',
    request: reply,
    responses: [
      stream(
        frame(meta('fast-reply')),
        frame(contextFrame()),
        delta('Partial'),
        frame({ type: 'error', code: 'provider_rate_limited', message: 'AI provider rate limit reached', retryAfterMs: 30_000 }),
      ),
    ],
    expect: failed('CG-PROVIDER-RATE-LIMIT', 'show', { retryAfterMs: 30_000, context: { source: 'union', live: 'served' } }),
  },
  {
    name: 'error-frame-unknown-provider-code',
    description: 'An unknown provider* code maps to the provider fallback; its text is never parsed.',
    request: reply,
    responses: [stream(frame(meta('fast-reply')), frame({ type: 'error', code: 'provider_new_failure', message: 'Something new', retryAfterMs: null }))],
    expect: failed('CG-PROVIDER-UNKNOWN', 'show'),
  },
  {
    name: 'error-frame-unknown-code',
    description: 'Any other unknown code is CG-HUB-UNKNOWN (kept apart in diagnostics).',
    request: reply,
    responses: [stream(frame(meta('fast-reply')), frame({ type: 'error', code: 'kernel_new_failure', message: 'Something new', retryAfterMs: null }))],
    expect: failed('CG-HUB-UNKNOWN', 'show'),
  },
  {
    name: 'coach-output-too-long',
    description: 'Coach crossed the 64 000-character ceiling: the crossing delta, then the error, no done.',
    request: request('coach-chat', { chatterQuestion: 'How do I upsell here?', coachHistory: [] }),
    responses: [stream(frame(meta('coach-chat')), frame(contextFrame({ live: { status: 'not_sent', accepted: 0, rejected: 0 } })), delta('Long answer…'), frame({ type: 'error', code: 'coach_output_too_long', message: 'Too long', retryAfterMs: null }))],
    expect: failed('CG-OUTPUT-COACH-LIMIT', 'show', { context: { source: 'union', live: 'not_sent' } }),
  },
  {
    name: 'truncated-mid-stream',
    description: 'EOF after deltas without done: CG-STREAM-TRUNCATED; the partial text is not usable.',
    request: reply,
    responses: [stream(frame(meta('fast-reply')), frame(contextFrame()), delta('Half a'), { kind: 'heartbeat' })],
    expect: failed('CG-STREAM-TRUNCATED', 'show', { context: { source: 'union', live: 'served' } }),
  },
  {
    name: 'truncated-before-meta',
    description: 'The 200 stream closes before any frame.',
    request: reply,
    responses: [stream()],
    expect: failed('CG-STREAM-TRUNCATED', 'show'),
  },
  {
    name: 'context-archive-live-disabled',
    description: 'Fix with the freshText flag off on the hub: archive served, our text ignored (live.status disabled, no 400).',
    request: request('improve-draft', {
      draftText: 'my draft',
      replyMode: 'default',
      liveTextContext: { capturedAt: at(-5), items: [{ platformMessageId: WORLD.messages.fanLatest, direction: 'fan', occurredAt: at(-60), text: 'hey' }] },
    }),
    responses: [stream(frame(meta('improve-draft')), frame(contextFrame({ source: 'archive', live: { status: 'disabled', accepted: 0, rejected: 0 } })), delta('Better draft'), usage, done)],
    expect: ok([['Better draft']], { source: 'archive', live: 'disabled' }),
  },
  {
    name: 'context-live-rejected',
    description: 'The hub rejected our fresh items (tombstoned in the archive): rejected count, still served.',
    request: request('ping', {}, ['context-v1']),
    responses: [
      stream(
        frame(meta('ping')),
        frame(contextFrame({ live: { status: 'rejected', accepted: 0, rejected: 2 }, knownFanMessage: { id: WORLD.messages.fanDeleted, state: 'deleted' } })),
        delta('Thinking of you'),
        usage,
        done,
      ),
    ],
    expect: ok([['Thinking of you']], { source: 'union', live: 'rejected' }),
  },
  {
    name: 'context-known-fan-absent',
    description: 'The checkpoint’s fan message is not in the served snapshot: the preview holds the send (§6.7.5).',
    request: request('fast-reply', { knownFanMessageId: WORLD.messages.fanLatest }),
    responses: [
      stream(
        frame(meta('fast-reply')),
        frame(contextFrame({ source: 'archive', servedHead: { messageRef: WORLD.messages.modelReply, occurredAt: at(-600), isFromFan: false }, knownFanMessage: { id: WORLD.messages.fanLatest, state: 'absent' }, live: { status: 'not_sent', accepted: 0, rejected: 0 } })),
        delta('Reply'),
        usage,
        done,
      ),
    ],
    expect: ok([['Reply']], { source: 'archive', live: 'not_sent' }),
  },
  {
    name: 'context-future-tokens',
    description: 'A reader and a fresh-text status this XPI does not know, plus a new key: still parsed (open tokens).',
    request: reply,
    responses: [stream(frame(meta('fast-reply')), frame({ ...contextFrame({ source: 'mirror_v2', live: { status: 'partial', accepted: 1, rejected: 1 } }), coverage: 'partial' }), delta('Hello'), usage, done)],
    expect: ok([['Hello']], { source: 'mirror_v2', live: 'partial' }),
  },
  {
    name: 'no-context-without-capability',
    description: 'Without context-v1 the hub sends no context_v1 frame (old clients see the stream byte for byte as before).',
    request: request('chat-review', {}, []),
    responses: [stream(frame(meta('chat-review')), delta('<review>ok</review>'), usage, done)],
    expect: ok([['<review>ok</review>']], null),
  },
  {
    name: 'debug-input-and-reasoning',
    description: 'Debug mode: debug_input_v1 right after meta, reasoning deltas between content.',
    request: request('fan-summary', { messageCount: 3000 }, ['debug-input-v1', 'context-v1']),
    responses: [
      stream(
        frame(meta('fan-summary')),
        frame({ type: 'debug_input_v1', systemBlocks: [{ text: 'system', cache: '1h' }], userBlocks: [{ text: 'transcript', cache: 'none' }], contextManifest: { window: 3000 } }),
        frame(contextFrame({ window: { requested: 3000, served: 1500 }, coverage: 'partial', live: { status: 'not_sent', accepted: 0, rejected: 0 } })),
        frame({ type: 'reasoning_delta', text: 'Looking at spend' }),
        delta('## Recap\nLikes [NEXT] markers stay in recaps.'),
        usage,
        done,
      ),
    ],
    expect: ok([['## Recap\nLikes [NEXT] markers stay in recaps.']], { source: 'union', live: 'not_sent' }),
  },
];
