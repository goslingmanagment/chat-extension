// The contracts' hub DTOs against the vendored @kernel/sdk (test-only import;
// nothing that ships reaches the SDK outside the background): operation
// keys, methods and paths; the SDK's own schemas accept our scenario
// answers, requests (path, query and body, as the hub's route reads them)
// and error bodies; and its response types are assignable to ours (a
// misnamed or missing field fails the build). A contract route the SDK does
// not have must stay `since` its hub change until a re-vendor brings it;
// since hub c8514c5c there is none.
//
// And the request side of the AI stream, with the hub's REAL body schema
// (`routeSchemas.aiFeatureStream.body` of the vendored SDK — hub main
// c8514c5c) and the rules of the hub's own handler (fake-hub/ai-rules.ts):
// every feature's body, as its driver builds it from a start the tab can
// make, must be one the hub accepts. The first live check met a body the
// hub answers 400 to (the Coach preset sent with our own question) that no
// test of ours had refused.

import {
  AI_REQUEST_LIMITS,
  COACH_LIMITS,
  FEATURE_IDS,
  HUB_ROUTE_KEYS,
  HUB_ROUTES,
  HubErrorBodySchema,
  HubStreamRequestSchema,
  TONES,
  type AiUsageReport,
  type AudienceNewPage,
  type AutoLists,
  type Bootstrap,
  type ClaimState,
  type FeedPage,
  type Dossier,
  type FeatureId,
  type HubAuthState,
  type HubBinding,
  type HubHealth,
  type HubStreamRequest,
  type IngestResult,
  type PersonaCatalog,
  type ProfileFromGenerationResponse,
  type QueuePage,
  type RecapStatus,
  type SharedRecaps,
  type SpenderBatch,
  type SpenderDetail,
  type SpendersPage,
  type SpendersStats,
  type StartOp,
} from '@cg/contracts';
import { AI_FEATURE_DRIVERS, FEATURE_POLICIES } from '@cg/core/domain/features';
import { kernelOperations, routeSchemas, type KernelOperationResponse } from '@kernel/sdk';
import { describe, expect, it } from 'vitest';

import { streamBodyRefusal } from '../../fake-hub/ai-rules';
import { BOOTSTRAP_PILOT_ON, BOOTSTRAP_PILOT_PAGES, HTTP_SCENARIOS, pageFeaturesOff } from './http';
import { SSE_SCENARIOS } from './sse';
import { HUB_ROUTE_PATHS } from './types';
import { WORLD, uuid } from './world';

type Assignable<From extends To, To> = [From, To];
export type SdkResponsesFitOurDtos = [
  Assignable<KernelOperationResponse<'health'>, HubHealth>,
  Assignable<KernelOperationResponse<'me'>, HubAuthState>,
  Assignable<KernelOperationResponse<'aiPersonaCatalog'>, PersonaCatalog>,
  Assignable<KernelOperationResponse<'aiRecapStatus'>, RecapStatus>,
  Assignable<KernelOperationResponse<'pageConversationProfile'>, Dossier>,
  Assignable<KernelOperationResponse<'pageFanProfile'>, Dossier>,
  Assignable<KernelOperationResponse<'spenders'>, SpendersPage>,
  Assignable<KernelOperationResponse<'spenderDetail'>, SpenderDetail>,
  Assignable<KernelOperationResponse<'spenderBatch'>, SpenderBatch>,
  Assignable<KernelOperationResponse<'pageSpenderAutoLists'>, AutoLists>,
  Assignable<KernelOperationResponse<'ingestObservations'>, IngestResult>,
  // The client/* routes that arrived with hub e7e1037b: the SDK's own answers fit our DTOs.
  Assignable<KernelOperationResponse<'clientBootstrap'>, Bootstrap>,
  Assignable<KernelOperationResponse<'clientConversationRecaps'>, SharedRecaps>,
  Assignable<KernelOperationResponse<'clientFanProfileFromGeneration'>, ProfileFromGenerationResponse>,
  Assignable<KernelOperationResponse<'clientAiUsageDaily'>, AiUsageReport>,
  // The six that arrived with hub c8514c5c (hub PRs #477–#481).
  Assignable<KernelOperationResponse<'clientConversationFeed'>, FeedPage>,
  Assignable<KernelOperationResponse<'clientSpenderStats'>, SpendersStats>,
  Assignable<KernelOperationResponse<'clientSpenderAwaitingReply'>, QueuePage>,
  Assignable<KernelOperationResponse<'clientFanClaim'>, ClaimState>,
  Assignable<KernelOperationResponse<'clientFanClaimStatus'>, ClaimState>,
  Assignable<KernelOperationResponse<'clientAudienceNew'>, AudienceNewPage>,
];

interface LooseSchema {
  safeParse(value: unknown): { success: boolean; error?: unknown };
}
interface LooseRoute {
  readonly params?: LooseSchema;
  readonly querystring?: LooseSchema;
  readonly body?: LooseSchema;
  readonly response: Readonly<Record<number, LooseSchema>>;
}
const sdkRoutes = routeSchemas as unknown as Readonly<Record<string, LooseRoute>>;
const sdkOperations = kernelOperations as unknown as Readonly<Record<string, { method: string; path: string }>>;

const existing = HUB_ROUTE_KEYS.filter((key) => HUB_ROUTES[key].since === 'sdk');

type RequestPart = 'params' | 'querystring' | 'body';

/**
 * Our facade request → what the hub's route reads of it: path params,
 * querystring (every value a string, as on the wire) or body. A client/*
 * route's request is one flat object (request-parts.ts of @cg/hub): its path
 * params by the SDK's manifest path, the rest the query (GET) or the body (a
 * claim carries its body under `body`). The other routes whose request we
 * mirror one to one go whole.
 */
function sdkRequestOf(route: string, request: Record<string, unknown>): readonly { part: RequestPart; value: unknown }[] {
  switch (route) {
    case 'authIssueDeviceTokenWithPassword':
    case 'spenderBatch':
    case 'ingestObservations':
      return [{ part: 'body', value: request }];
    case 'aiRecapStatus':
    case 'spenders':
      return [{ part: 'querystring', value: request }];
    default:
      break;
  }
  if (!route.startsWith('client')) return [];
  const operation = sdkOperations[route];
  if (operation === undefined) throw new Error(route);
  const rest: Record<string, unknown> = { ...request };
  const params: Record<string, unknown> = {};
  for (const [, name = ''] of operation.path.matchAll(/\/:([A-Za-z0-9_]+)/g)) {
    params[name] = rest[name];
    delete rest[name];
  }
  const parts: { part: RequestPart; value: unknown }[] = Object.keys(params).length > 0 ? [{ part: 'params', value: params }] : [];
  if (operation.method === 'GET') {
    const query = Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value as string | number | boolean)]));
    parts.push({ part: 'querystring', value: query });
  } else {
    parts.push({ part: 'body', value: route === 'clientFanClaim' ? rest['body'] : rest });
  }
  return parts;
}

describe('contracts vs the vendored SDK', () => {
  it('existing operations: same key, method and path; new ones not vendored yet', () => {
    for (const key of HUB_ROUTE_KEYS) {
      const operation = sdkOperations[key];
      if (HUB_ROUTES[key].since === 'sdk') {
        expect(operation, key).toEqual({ method: HUB_ROUTES[key].method, path: HUB_ROUTE_PATHS[key] });
      } else {
        expect(operation, `${key} arrived in the SDK: set its \`since\` to 'sdk' and drop the raw call`).toBeUndefined();
      }
    }
  });

  it("the SDK accepts our scenarios' answers, requests and error bodies on existing routes", () => {
    for (const s of HTTP_SCENARIOS) {
      for (const exchange of s.exchanges) {
        if (!existing.includes(exchange.route)) continue;
        const route = sdkRoutes[exchange.route];
        if (route === undefined) throw new Error(exchange.route);
        const label = `${s.name} ${exchange.route} ${exchange.response.status}`;
        // A 5xx the route does not declare comes from the hub's own error handler, which answers any route in the
        // error shape (an unavailable database, a restart): the SDK has no schema for it, the hub's error body is the check.
        const status = exchange.response.status;
        const answer = route.response[status] ?? (status >= 500 ? HubErrorBodySchema : undefined);
        expect(answer, `${label}: status declared by the SDK`).toBeDefined();
        const parsed = answer?.safeParse(exchange.response.body);
        expect(parsed?.success, `${label}: ${JSON.stringify(parsed?.error ?? '').slice(0, 300)}`).toBe(true);
        const parts = exchange.request === null ? [] : sdkRequestOf(exchange.route, exchange.request as Record<string, unknown>);
        for (const { part, value } of parts) {
          const schema = route[part];
          // The hub's route reads no such part (a route without query or body): ours must not send one either.
          if (schema === undefined) expect([label, part, value]).toEqual([label, part, {}]);
          else expect(schema.safeParse(value).success, `${label} request ${part}`).toBe(true);
        }
      }
    }
  });

  it('every contract route is an SDK operation: the six of hub c8514c5c joined the four of e7e1037b; nothing is left for a raw call', () => {
    const arrived = [
      'clientBootstrap',
      'clientConversationRecaps',
      'clientFanProfileFromGeneration',
      'clientAiUsageDaily',
      'clientConversationFeed',
      'clientSpenderStats',
      'clientSpenderAwaitingReply',
      'clientFanClaim',
      'clientFanClaimStatus',
      'clientAudienceNew',
    ] as const;
    for (const key of arrived) expect([key, HUB_ROUTES[key].since, sdkOperations[key]?.path]).toEqual([key, 'sdk', HUB_ROUTE_PATHS[key]]);
    expect(HUB_ROUTE_KEYS.filter((key) => HUB_ROUTES[key].since !== 'sdk')).toEqual([]);
  });

  it('every client/* scenario request is one the hub\'s route reads: path, query and body, each part checked', () => {
    const checked = new Set<string>();
    for (const s of HTTP_SCENARIOS) {
      for (const exchange of s.exchanges) {
        if (!exchange.route.startsWith('client') || exchange.request === null) continue;
        for (const { part } of sdkRequestOf(exchange.route, exchange.request as Record<string, unknown>)) checked.add(`${exchange.route}.${part}`);
      }
    }
    for (const key of ['clientConversationFeed.params', 'clientConversationFeed.querystring', 'clientSpenderStats.querystring', 'clientSpenderAwaitingReply.querystring', 'clientFanClaim.body', 'clientFanClaimStatus.params', 'clientAudienceNew.querystring']) {
      expect(checked, key).toContain(key);
    }
    // And the hub refuses what our contract refuses: a dispatch past its 32-bit revisions (contracts 1.6.0), an extra query key.
    const body = sdkRoutes['clientFanClaim']?.body;
    const query = sdkRoutes['clientConversationFeed']?.querystring;
    if (body === undefined || query === undefined) throw new Error('claim body / feed query');
    const dispatch = { action: 'dispatch', attemptId: uuid(0x4a9), instanceId: WORLD.instanceId, purpose: 'preview-reply', group: { generationRef: uuid(0x200), variant: 0, partCount: 1 }, partIndex: 0, textRevision: 0, flagRevision: 1 };
    expect(body.safeParse(dispatch).success).toBe(true);
    expect(body.safeParse({ ...dispatch, textRevision: 2_147_483_648 }).success).toBe(false);
    expect(query.safeParse({ limit: '50' }).success).toBe(true);
    expect(query.safeParse({ limit: '50', persona: 'x' }).success).toBe(false);
  });

  it('the stream body of every scenario passes the SDK\'s own body schema — the H-4b/H-4c fields included', () => {
    const body = sdkRoutes['aiFeatureStream']?.body;
    if (body === undefined) throw new Error('aiFeatureStream body');
    let withH4 = 0;
    for (const s of SSE_SCENARIOS) {
      expect(body.safeParse(s.request.body).success, s.name).toBe(true);
      expect(streamBodyRefusal(s.request.feature, s.request.body), s.name).toBeNull();
      if (s.request.body.knownFanMessageIds !== undefined || s.request.body.liveTextContext !== undefined) withH4 += 1;
    }
    expect(withH4).toBeGreaterThan(0);
    // The hub's body is strict: it is this strictness the test stands on.
    const [first] = SSE_SCENARIOS;
    expect(body.safeParse({ ...first?.request.body, someLaterField: true }).success).toBe(false);
  });
});

describe('[AI-134] [AI-142] every feature\'s request, as its driver builds it, is one the real hub accepts', () => {
  const realBody = sdkRoutes['aiFeatureStream']?.body;
  if (realBody === undefined) throw new Error('aiFeatureStream body');

  const binding: HubBinding = {
    hubOrigin: WORLD.hubOrigin,
    principalId: WORLD.user.userId,
    loginEpoch: 1,
    host: 'chatspace',
    hostAccountId: WORLD.pages.one.hostAccountId,
    platform: 'onlyfans',
    platformAccountId: WORLD.pages.one.platformAccountId,
    pageId: WORLD.pages.one.pageId,
    pageLabel: WORLD.pages.one.pageLabel,
    bindingRevision: WORLD.pages.one.bindingRevision,
  };
  const chat = { host: 'chatspace', hostAccountId: WORLD.pages.one.hostAccountId, platformFanId: WORLD.fan } as const;
  const draft = { text: 'hey, i missed you — what were you up to today?', revision: 2, digest: 'feedbeef00000001' };
  const fresh = { capturedAt: '2026-10-03T09:59:55.000Z', messages: [{ platformMessageId: WORLD.messages.fanLatest, direction: 'fan' as const, sentAt: '2026-10-03T09:59:50.000Z', text: 'hey there' }] };
  const checkpoint = {
    documentEpoch: 'doc1',
    socketEpoch: 1,
    subscriptionEpoch: 1,
    hostAccountId: chat.hostAccountId,
    platformFanId: chat.platformFanId,
    fanSequence: 3,
    lastFanMessageId: WORLD.messages.fanLatest,
    knownFanMessageIds: [WORLD.messages.fanLatest, WORLD.messages.fanFirst],
  };
  const start = (feature: FeatureId, over: Partial<StartOp> = {}): StartOp => ({
    feature,
    surface: feature === 'coach' ? 'coach' : 'dock',
    target: { binding, chat, fanRef: WORLD.fan, conversationRef: WORLD.fan },
    cause: { kind: 'click', actionToken: 'tok_0000000000000001' },
    tone: null,
    split: false,
    window: 100,
    ...(feature === 'fix' ? { draft } : {}),
    ...(feature === 'coach' ? { coach: { question: 'How do I answer him?', history: [] } } : {}),
    ...over,
  });

  /** Starts the tab can make for a feature: the plain one and every option that changes its body. */
  function startsOf(feature: FeatureId): readonly (readonly [string, StartOp])[] {
    const policy = FEATURE_POLICIES[feature];
    const out: [string, StartOp][] = [
      ['plain', start(feature)],
      ['regenerated', start(feature, { regenerateOf: uuid(0x99) })],
      ['the smallest window', start(feature, { window: AI_REQUEST_LIMITS.messageCountMin })],
      ['the largest window', start(feature, { window: AI_REQUEST_LIMITS.messageCountMax })],
      ['with the ids the tab saw', start(feature, { checkpoint: checkpoint as StartOp['checkpoint'] })],
    ];
    if (policy.split) out.push(['Split asked', start(feature, { split: true })]);
    if (policy.freshText) out.push(['with fresh page text', start(feature, { fresh, checkpoint: checkpoint as StartOp['checkpoint'] })]);
    if (policy.tone) for (const tone of TONES) out.push([`tone ${tone}`, start(feature, { tone })]);
    if (feature === 'fix') out.push(['the longest draft', start(feature, { draft: { ...draft, text: 'd'.repeat(AI_REQUEST_LIMITS.draftMaxChars) } })]);
    if (feature === 'hi') for (const variantCount of [1, 3] as const) out.push([`${variantCount} variant(s)`, start(feature, { variantCount })]);
    if (feature === 'hi') out.push(['from «Новые»', start(feature, { surface: 'newcomers' })]);
    if (feature === 'coach') {
      const history = Array.from({ length: COACH_LIMITS.historyMaxTurns }, (_unused, index) => ({ question: `question ${index}`, answer: `answer ${index}` }));
      out.push(
        ['a question with the whole history', start(feature, { coach: { question: 'And now?', history } })],
        ['the longest question', start(feature, { coach: { question: 'q'.repeat(COACH_LIMITS.questionMaxChars), history: [] } })],
        ['the preset alone', start(feature, { coach: { preset: 'situation', history: [] } })],
        // What the panel dispatches for the «Что сейчас в чате?» chip: the chip's words AND the preset.
        ['the preset chip as the panel sends it', start(feature, { coach: { question: 'Что сейчас в чате?', preset: 'situation', history: [] } })],
        ['the preset after a dialog', start(feature, { coach: { question: 'Что сейчас в чате?', preset: 'situation', history: history.slice(0, 3) } })],
        ['with my reply attached', start(feature, { coach: { question: 'Is this good?', history: [], attachDraft: draft.text } })],
        ['Split asked of a draft answer', start(feature, { split: true, coach: { question: 'Write it for me', history: [] } })],
      );
    }
    return out;
  }

  /** The hubs a request may be built for: the pilot both ways, a hub older than the SDK, one with switches off. */
  const HUBS: readonly (readonly [string, Bootstrap])[] = [
    ['the pilot, page by page', BOOTSTRAP_PILOT_PAGES],
    ['the pilot through "*"', BOOTSTRAP_PILOT_ON],
    ['a hub that declares no capability', { ...BOOTSTRAP_PILOT_PAGES, capabilities: [] }],
    ['fresh text and split-all off on the page', pageFeaturesOff(BOOTSTRAP_PILOT_PAGES, ['freshText', 'splitAll'])],
    ['a small deep window', { ...BOOTSTRAP_PILOT_PAGES, limits: { ...BOOTSTRAP_PILOT_PAGES.limits, deepMax: 1500 } }],
  ];

  const built: { readonly name: string; readonly request: HubStreamRequest }[] = [];
  for (const feature of FEATURE_IDS) {
    for (const [what, op] of startsOf(feature)) {
      for (const [hub, bootstrap] of HUBS) {
        for (const debug of [false, true]) {
          const result = AI_FEATURE_DRIVERS[feature].build(op, { opId: uuid(0x100), persona: { key: WORLD.persona.key, definitionId: WORLD.persona.definitionId }, bootstrap, debug });
          const name = `${feature} · ${what} · ${hub}${debug ? ' · debug' : ''}`;
          if (!result.ok) throw new Error(`${name}: the driver refused its own start (${result.issues})`);
          built.push({ name, request: result.request });
        }
      }
    }
  }

  it('by the hub\'s own body schema (the vendored SDK\'s, strict)', () => {
    expect(built.length).toBeGreaterThan(400);
    const refused = built.filter(({ request }) => !realBody.safeParse(request.body).success).map(({ name }) => name);
    expect(refused).toEqual([]);
  });

  it('by the rules of the hub\'s own handler: a draft where one is needed, a Coach question or its preset — never both — and no field of another feature', () => {
    const refused = built.flatMap(({ name, request }) => {
      const refusal = streamBodyRefusal(request.feature, request.body);
      return refusal === null ? [] : [`${name}: ${refusal.message}`];
    });
    expect(refused).toEqual([]);
    // The preset never travels with a question, whatever words the start carried for the dialog.
    const presets = built.filter(({ request }) => request.body.preset !== undefined);
    expect(presets.length).toBeGreaterThan(0);
    for (const { name, request } of presets) expect([name, 'chatterQuestion' in request.body]).toEqual([name, false]);
  });

  it('by our own mirror of the request, which now refuses what the hub refuses', () => {
    for (const { name, request } of built) expect(HubStreamRequestSchema.safeParse(request).success, name).toBe(true);
    const coach = built.find(({ request }) => request.feature === 'coach-chat' && request.body.preset !== undefined)?.request;
    if (coach === undefined) throw new Error('a preset request');
    const both = { ...coach, body: { ...coach.body, chatterQuestion: 'Что сейчас в чате?' } };
    expect(HubStreamRequestSchema.safeParse(both).success).toBe(false);
    expect(realBody.safeParse(both.body).success).toBe(true); // the body schema alone cannot tell: the hub's handler does
    expect(streamBodyRefusal(both.feature, both.body)).toEqual({ error: 'bad_request', message: 'coach-chat preset forbids chatterQuestion' });
  });

  it('what a feature never sends: no fresh text outside the draft features, no Split for Recap and Review, nothing a hub older than the SDK did not declare', () => {
    for (const { name, request } of built) {
      const draftFeature = ['fast-reply', 'improve-draft', 'hi-greeting', 'ping'].includes(request.feature);
      if (!draftFeature) expect([name, request.body.liveTextContext]).toEqual([name, undefined]);
      if (['chat-review', 'fan-summary'].includes(request.feature)) expect([name, request.body.replyMode]).toEqual([name, undefined]);
      if (name.includes('declares no capability')) {
        expect([name, request.capabilities.filter((capability) => capability !== 'debug-input-v1')]).toEqual([name, []]);
        expect([name, request.body.liveTextContext, request.body.knownFanMessageIds]).toEqual([name, undefined, undefined]);
      }
    }
  });
});
