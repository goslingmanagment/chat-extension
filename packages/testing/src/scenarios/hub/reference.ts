// Reference readings for the fake hub's scenarios: the error resolver over
// the contracts' tables, the client's reading of one AI stream (§7: one
// transparent 503 retry before the first frame, terminal error frames, EOF
// without `done` = truncated, the persona fence) and the Split parse (D-15).
// Test-only and deliberately plain: core's real implementations are checked
// against the same scenarios.

import {
  HUB_ERROR_STATUSES,
  HUB_HTTP_ERROR_RULES,
  HUB_ROUTES,
  HUB_SSE_ERROR_CODES,
  HUB_SSE_FALLBACKS,
  HUB_TRANSPORT_CODES,
  SPLIT_MARKERS,
  type ContextFrame,
  type HubAiFeature,
  type HubErrorCondition,
  type HubErrorContext,
  type HubErrorResolution,
  type HubFailure,
  type HubFrame,
  type ResolveHubError,
} from '@cg/contracts';

import { type SseResponse, type SseScenario, type SseStep } from './types';

const DAY_MS = 86_400_000;

function holds(condition: HubErrorCondition, ctx: HubErrorContext): boolean {
  switch (condition) {
    case 'stale-sign-in':
      return !ctx.currentSignIn;
    case 'page-not-granted':
      return ctx.pageGranted === false;
    case 'fan-lookup':
      return ctx.fanLookup;
    case 'before-first-frame':
      return ctx.beforeFirstFrame;
    case 'dispatch':
      return ctx.claimAction === 'dispatch';
  }
}

export const resolveHubErrorReference: ResolveHubError = (failure: HubFailure, ctx: HubErrorContext): HubErrorResolution => {
  const routeClass = HUB_ROUTES[ctx.route].routeClass;
  if (failure.kind === 'transport') {
    const codes: Readonly<Record<string, string | null>> = HUB_TRANSPORT_CODES[failure.failure];
    const code = (codes[routeClass] ?? codes['default'] ?? null) as HubErrorResolution['code'];
    return { code, disposition: 'show', retryAt: null, httpStatus: null };
  }
  if (failure.kind === 'sse-error') {
    const known: Readonly<Record<string, HubErrorResolution['code']>> = HUB_SSE_ERROR_CODES;
    const code =
      known[failure.code] ?? (failure.code.startsWith(HUB_SSE_FALLBACKS.providerPrefix) ? HUB_SSE_FALLBACKS.provider : HUB_SSE_FALLBACKS.other);
    return { code, disposition: 'show', retryAt: failure.retryAfterMs === null ? null : ctx.now + failure.retryAfterMs, httpStatus: null };
  }
  const rule = HUB_HTTP_ERROR_RULES.find(
    (r) =>
      (r.error === null || r.error === failure.error) &&
      (r.status === undefined || (r.status === '5xx' ? failure.status >= 500 && failure.status <= 599 : r.status === failure.status)) &&
      (r.reason === undefined || r.reason === failure.reason) &&
      (r.routes === undefined || r.routes.includes(routeClass)) &&
      (r.when === undefined || holds(r.when, ctx)),
  );
  if (rule === undefined) throw new Error('HUB_HTTP_ERROR_RULES has no catch-all');
  const retryAt =
    rule.retryAt === 'next-utc-midnight'
      ? Math.floor(ctx.now / DAY_MS) * DAY_MS + DAY_MS
      : rule.retryAt === 'retry-after' && failure.retryAfterMs !== null
        ? ctx.now + failure.retryAfterMs
        : null;
  return { code: rule.cg, disposition: rule.disposition, retryAt, httpStatus: failure.status };
};

/** The status a hub code comes with (the fake hub's answer status). */
export function statusOf(code: keyof typeof HUB_ERROR_STATUSES): number {
  return HUB_ERROR_STATUSES[code];
}

/** D-15: Hi → `[VARIANT]` variants, each `[NEXT]` parts; Reply/Fix/Ping/Coach → `[NEXT]` parts; Recap/Review whole. */
export function parseResult(feature: HubAiFeature, text: string): string[][] {
  const parts = (chunk: string): string[] =>
    chunk
      .split(SPLIT_MARKERS.next)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
  if (feature === 'chat-review' || feature === 'fan-summary') return [[text.trim()]];
  const variants = feature === 'hi-greeting' ? text.split(SPLIT_MARKERS.variant) : [text];
  return variants.map(parts).filter((variant) => variant.length > 0);
}

export interface StreamReading {
  readonly outcome: 'done' | 'failed';
  readonly requests: number;
  readonly resolution: HubErrorResolution | null;
  readonly text: string;
  readonly result: string[][] | null;
  readonly context: ContextFrame | null;
  /** Order problems of the frames (meta first, context_v1 before the first delta, nothing after a terminal frame). */
  readonly orderProblems: readonly string[];
}

function readFrames(scenario: SseScenario, steps: readonly SseStep[], now: number): Omit<StreamReading, 'requests'> {
  const frames: HubFrame[] = steps.flatMap((step) => (step.kind === 'frame' ? [step.frame] : []));
  const orderProblems: string[] = [];
  if (frames.length > 0 && frames[0]?.type !== 'meta') orderProblems.push('first frame is not meta');
  const firstDelta = frames.findIndex((f) => f.type === 'content_delta');
  const contextIndex = frames.findIndex((f) => f.type === 'context_v1');
  if (contextIndex >= 0 && firstDelta >= 0 && contextIndex > firstDelta) orderProblems.push('context_v1 after the first content_delta');
  const terminal = frames.findIndex((f) => f.type === 'done' || f.type === 'error');
  if (terminal >= 0 && terminal < frames.length - 1) orderProblems.push('frames after the terminal frame');

  const ctx: HubErrorContext = {
    route: 'aiFeatureStream',
    currentSignIn: true,
    pageGranted: true,
    beforeFirstFrame: false,
    claimAction: null,
    fanLookup: false,
    now,
  };
  let text = '';
  let context: ContextFrame | null = null;
  for (const frame of frames) {
    switch (frame.type) {
      case 'meta': {
        const expected = scenario.request.body.expectedPersonaDefinitionId;
        if (expected !== undefined && frame.personaDefinitionId !== undefined && frame.personaDefinitionId !== expected) {
          return {
            outcome: 'failed',
            resolution: { code: 'CG-PERSONA-CHANGED', disposition: 'refresh-catalog', retryAt: null, httpStatus: null },
            text: '',
            result: null,
            context,
            orderProblems,
          };
        }
        break;
      }
      case 'context_v1':
        context = frame;
        break;
      case 'content_delta':
        text += frame.text;
        break;
      case 'error':
        return {
          outcome: 'failed',
          resolution: resolveHubErrorReference({ kind: 'sse-error', code: frame.code, retryAfterMs: frame.retryAfterMs }, ctx),
          text,
          result: null,
          context,
          orderProblems,
        };
      case 'done':
        return { outcome: 'done', resolution: null, text, result: parseResult(scenario.request.feature, text), context, orderProblems };
      case 'reasoning_delta':
      case 'usage':
      case 'debug_input_v1':
        break;
    }
  }
  return {
    outcome: 'failed',
    resolution: resolveHubErrorReference({ kind: 'transport', failure: 'truncated' }, ctx),
    text,
    result: null,
    context,
    orderProblems,
  };
}

/** The client's reading of a whole stream scenario, POST after POST. */
export function readStreamScenario(scenario: SseScenario, now: number): StreamReading {
  let requests = 0;
  for (const response of scenario.responses) {
    requests += 1;
    if (response.kind === 'stream') return { requests, ...readFrames(scenario, response.steps, now) };
    const resolution = resolveHubErrorReference(
      { kind: 'http', status: response.status, error: response.body.error, reason: response.body.reason ?? null, retryAfterMs: null },
      { route: 'aiFeatureStream', currentSignIn: true, pageGranted: true, beforeFirstFrame: true, claimAction: null, fanLookup: false, now },
    );
    const retryLeft = requests === 1 && scenario.responses.length > 1;
    if (resolution.disposition === 'retry-once' && retryLeft) continue;
    return {
      outcome: 'failed',
      requests,
      resolution: resolution.disposition === 'retry-once' ? { ...resolution, disposition: 'show' } : resolution,
      text: '',
      result: null,
      context: null,
      orderProblems: [],
    };
  }
  throw new Error(`${scenario.name}: no response for request ${requests + 1}`);
}

/** SSE body of a 200 stream response, framed like the hub (`event: ai`). */
export function sseText(response: Extract<SseResponse, { kind: 'stream' }>): string {
  return response.steps
    .map((step) => {
      if (step.kind === 'frame') return `event: ai\ndata: ${JSON.stringify(step.frame)}\n\n`;
      if (step.kind === 'heartbeat') return ': keep-alive\n\n';
      return '';
    })
    .join('');
}
