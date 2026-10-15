// R20 P8b1 (AI-142; docs/project-unite/architecture.md §9.1; spec FS-TAIL-1, FS-TAIL-6, FS-IDN-6): the request of a
// start on Fansly as the extension builds it — MAIN's snapshot as the start's proof (Fansly's policy,
// `startProofOf`), the shared plan and its StartOp schema, the background's request (`buildStreamRequest`) — against
// the hub's own rules: the vendored SDK's body schema, the rules of its handler the fake hub repeats
// (`streamBodyRefusal`), and the fake hub itself, which answers the window check as the hub does (HF-8в). The body
// carries no `clientContext`: the group beside the fan, the window check, the fan's known ids, a draft's texts, a
// count no smaller than the window.

import { coverageCheckVerdict, HubStreamRequestSchema, narrowCoverageCheck, type Bootstrap, type FeatureId, type HubBinding, type HubStreamRequest, type Target } from '@cg/contracts';
import { FanslySnapshotSchema, type FanslySnapshot } from '@cg/contracts/fansly';
import { DEFAULT_SETTINGS } from '@cg/contracts/settings';
import { checkWindowOf, startProofOf } from '@cg/core/application/hosts/fansly/ai';
import { planStart } from '@cg/core/domain/features';
import { buildStreamRequest } from '@cg/core/domain/ops';
import { routeSchemas, streamAiFeature } from '@kernel/sdk';
import { beforeEach, describe, expect, it } from 'vitest';

import { NOW, WORLD, uuid } from '../scenarios/hub';
import { streamBodyRefusal, type CoverageCheckAnswer } from './ai-rules';
import { fanslyPageFlags } from './config';
import { createFakeHub, type FakeHub } from './hub';
import { hubCall } from './kit';

const PAGE = WORLD.pages.fansly;
const { a: A } = WORLD.fansly.chats;
const realBody = (routeSchemas as unknown as Readonly<Record<string, { readonly body: { safeParse(value: unknown): { success: boolean } } }>>)['aiFeatureStream']?.body;

/** The chat on the page: 71 messages, fan and model by turns, every fifth one media only; the 66th deleted. */
const idOf = (n: number): string => String(830000000000000000n + BigInt(n));
const COUNT = 71;
const DELETED = 65;
const dirOf = (n: number): 'fan' | 'model' => (n % 2 === 0 ? 'fan' : 'model');
const textOf = (n: number): string | null => (n % 5 === 4 ? null : `message ${n}`);

/** MAIN's snapshot of that chat (host-fansly main/snapshot.ts): the last min(60, window) live messages, the deleted of their span. */
function snapshot(feature: FeatureId, window: number, withText: boolean): FanslySnapshot {
  const live = Array.from({ length: COUNT }, (_, n) => n).filter((n) => n !== DELETED);
  const picked = live.slice(-Math.min(60, window));
  const entries = picked.map((n) => ({ id: idOf(n), dir: dirOf(n) }));
  return FanslySnapshotSchema.parse({
    feature,
    identity: { creatorId: PAGE.platformAccountId, groupId: A.group, fanId: A.fan },
    epochs: { document: 'doc1', socket: 1, route: 1 },
    completeness: 'complete',
    window: entries,
    knownFanMessageIds: entries.filter((entry) => entry.dir === 'fan').slice(-10).map((entry) => entry.id),
    deletedIds: (picked[0] ?? 0) < DELETED ? [idOf(DELETED)] : [],
    ...(withText ? { tail: picked.flatMap((n) => { const text = textOf(n); return text === null ? [] : [{ platformMessageId: idOf(n), direction: dirOf(n), sentAt: NOW, text }]; }) } : {}),
    truncated: false,
  });
}

let hub: FakeHub;
let token: string;
let bootstrap: Bootstrap;

/** The hub's archive of the chat: every message up to `upTo` (exclusive), the deleted one as the hub's tombstone. */
const archive = (upTo: number): unknown =>
  hub.control({
    op: 'archiveConversation',
    pageLabel: PAGE.pageLabel,
    conversationRef: A.group,
    messages: Array.from({ length: upTo }, (_, n) => ({ id: idOf(n), sender: dirOf(n), ...(n === DELETED ? { state: 'deleted' as const } : {}) })),
  });

const binding = (): HubBinding => ({
  hubOrigin: WORLD.hubOrigin,
  principalId: WORLD.user.userId,
  loginEpoch: 1,
  host: 'fansly-web',
  hostAccountId: PAGE.platformAccountId,
  platform: 'fansly',
  platformAccountId: PAGE.platformAccountId,
  pageId: PAGE.pageId,
  pageLabel: PAGE.pageLabel,
  bindingRevision: PAGE.bindingRevision,
});
const target = (): Target => ({ binding: binding(), chat: { host: 'fansly-web', hostAccountId: PAGE.platformAccountId, platformFanId: A.fan }, fanRef: A.fan, conversationRef: A.group });

/** A start in the open chat as the tab plans it, with the snapshot's proof; and the request the background makes of it. */
function requestOf(feature: FeatureId): { readonly request: HubStreamRequest; readonly proof: ReturnType<typeof startProofOf> } {
  const draft = feature === 'reply' || feature === 'fix' || feature === 'hi' || feature === 'ping';
  const fresh = draft ? { maxItems: 60, maxChars: 5000 } : null;
  const proof = startProofOf(snapshot(feature, checkWindowOf(feature, DEFAULT_SETTINGS.generation.windows), fresh !== null), fresh, NOW);
  const plan = planStart({
    feature,
    surface: 'dock',
    target: target(),
    cause: { kind: 'click', actionToken: uuid(0x8b1) },
    options: feature === 'coach' ? { question: 'What now?' } : {},
    settings: DEFAULT_SETTINGS,
    bootstrap,
    tone: null,
    draft: feature === 'fix' ? { plainText: 'a draft to fix', revision: 1, digest: 'feedbeef00000001' } : null,
    fields: { proof },
    freshText: true,
  });
  if (!plan.ok) throw new Error(`${feature}: ${plan.code}`);
  expect(plan.start.proof).toEqual(proof);
  const built = buildStreamRequest(plan.start, { opId: uuid(0x8b10), persona: { key: WORLD.persona.key, definitionId: WORLD.persona.definitionId }, bootstrap, debug: false, freshText: true });
  if (!built.ok) throw new Error(`${feature}: ${built.issues}`);
  return { request: built.request, proof };
}

type Frame = Record<string, unknown> & { type: string };
async function stream(request: HubStreamRequest): Promise<Frame> {
  const frames: Frame[] = [];
  await streamAiFeature({ baseUrl: hub.origin, fetch: hub.fetch, headers: { 'x-client-version': 'chat-extension/1.0.0' }, auth: { mode: 'bearer', token: () => token } } as never, {
    feature: request.feature,
    body: request.body,
    capabilities: request.capabilities,
    onFrame: (frame: unknown) => frames.push(frame as Frame),
  }).done;
  const context = frames.find((frame) => frame.type === 'context_v1');
  if (context === undefined) throw new Error('no context_v1 frame');
  return context;
}

beforeEach(async () => {
  hub = createFakeHub({ streamBodySchema: routeSchemas.aiFeatureStream.body, routeSchemas });
  token = hub.issueToken();
  hub.control({ op: 'config', patch: fanslyPageFlags() });
  bootstrap = (await (await hubCall(hub.fetch, hub.origin, 'clientBootstrap', null, { token })).json()) as Bootstrap;
});

describe('[host:fansly] R20 P8b1: a Fansly start’s request against the hub’s own rules', () => {
  it('[AI-142] every feature’s body is one the hub takes — its body schema, its handler’s rules, our mirror —: the group beside the fan, no `clientContext`, the window check under its token, the known ids, texts only for a draft, a count no smaller than the window', () => {
    if (realBody === undefined) throw new Error('aiFeatureStream body');
    expect(bootstrap.capabilities).toEqual(expect.arrayContaining(['context-v1', 'coverage-check-v1']));
    for (const feature of ['reply', 'fix', 'hi', 'ping', 'review', 'recap', 'recap-short', 'coach'] as const) {
      const { request, proof } = requestOf(feature);
      const { body } = request;
      expect([feature, realBody.safeParse(body).success, HubStreamRequestSchema.safeParse(request).success, streamBodyRefusal(request.feature, body, request.capabilities)]).toEqual([feature, true, true, null]);
      expect([feature, body.platform, body.conversationRef, body.fanRef, 'clientContext' in body]).toEqual([feature, 'fansly', A.group, A.fan, false]);
      expect([feature, request.capabilities.includes('coverage-check-v1'), body.coverageCheck]).toEqual([feature, true, { window: proof.window, deletedIds: proof.deletedIds }]);
      expect([feature, body.knownFanMessageIds]).toEqual([feature, proof.knownFanMessageIds]);
      expect([feature, (body.messageCount ?? 0) >= proof.window.length]).toEqual([feature, true]);
      const draft = ['reply', 'fix', 'hi', 'ping'].includes(feature);
      expect([feature, body.liveTextContext?.items.map((item) => item.platformMessageId)]).toEqual([feature, draft ? proof.tail?.map((message) => message.platformMessageId) : undefined]);
    }
  });

  it('[AI-142] the hub answers each id of the window and of the deleted once, in the body’s order: a message it has not got yet is a miss; once it has, the check reads fresh', async () => {
    archive(COUNT - 1);
    const { request, proof } = requestOf('reply');
    const first = await stream(request);
    const answer = first['coverageCheck'] as CoverageCheckAnswer;
    expect(answer.window.map((item) => item.id)).toEqual(proof.window.map((entry) => entry.id));
    expect(answer.deleted).toEqual([{ id: idOf(DELETED), state: 'deleted' }]);
    // The newest fan message reached the tab before the hub: the one window id the hub cannot count.
    expect(answer.window.filter((item) => item.state !== 'included')).toEqual([{ id: idOf(COUNT - 1), state: 'absent' }]);
    expect(coverageCheckVerdict(proof, narrowCoverageCheck(answer))).toBe('miss');
    expect(first['live']).toMatchObject({ status: 'served', accepted: proof.tail?.length });

    archive(COUNT);
    const again = await stream({ ...request, body: { ...request.body, clientRequestId: uuid(0x8b11) } });
    expect(coverageCheckVerdict(proof, narrowCoverageCheck(again['coverageCheck'] as CoverageCheckAnswer))).toBe('fresh');
    // Review: the same check, no text (FS-TAIL-10).
    const review = requestOf('review');
    expect(coverageCheckVerdict(review.proof, narrowCoverageCheck((await stream(review.request))['coverageCheck'] as CoverageCheckAnswer))).toBe('fresh');
    expect(hub.violations()).toEqual([]);
  });
});
