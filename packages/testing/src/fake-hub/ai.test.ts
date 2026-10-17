// The fake hub's model of the AI stream (architecture.md §8.4; hub H-3, H-4b,
// H-4c, H-5, H-10, H-13, H-15): what the hub checks before the stream
// (persona fence, quota, feature flags of the narrow token, fresh text only
// with context-v1 and only for draft features), what it streams (meta,
// debug, context_v1 with the served head and known ids, Split markers only
// where honoured), and what a finished generation leaves behind (shared
// recaps, dossier from generation, own AI spend). The vendored SDK accepts
// every frame the model writes.

import { FEATURE_IDS, HUB_AI_FEATURES, HUB_FEATURE_MAP, HubFrameSchema, SPLIT_MARKERS, type HubAiFeature } from '@cg/contracts';
import { routeSchemas, streamAiFeature } from '@kernel/sdk';
import { beforeEach, describe, expect, it } from 'vitest';

import { PAGE, WORLD, streamBody, uuid } from '../scenarios/hub';
import { generationText, namedForFan } from './ai';
import { streamBodyRefusal } from './ai-rules';
import { pilotPageFlags } from './config';
import { createFakeHub, type FakeHub } from './hub';
import { hubCall, readSse } from './kit';

let hub: FakeHub;
let token: string;
let seq = 0;

type Body = Parameters<typeof streamBody>[0];
const stream = (feature: HubAiFeature, body: Body = {}, capabilities: string[] = [], as: string = token): Promise<Response> =>
  hubCall(hub.fetch, hub.origin, 'aiFeatureStream', { feature, body: streamBody({ clientRequestId: uuid(0x800 + ++seq), ...body }), capabilities }, { token: as });
const framesOf = async (response: Response): Promise<Array<Record<string, unknown> & { type: string }>> => {
  expect(response.status).toBe(200);
  return (await readSse(response)).frames as Array<Record<string, unknown> & { type: string }>;
};
const textOf = (frames: ReadonlyArray<{ type: string; text?: unknown }>): string => frames.flatMap((f) => (f.type === 'content_delta' ? [String(f.text)] : [])).join('');
const refusal = async (response: Response): Promise<{ status: number; error: string; reason?: string }> => {
  const body = (await response.json()) as { error: string; reason?: string };
  return body.reason === undefined ? { status: response.status, error: body.error } : { status: response.status, error: body.error, reason: body.reason };
};
/** A greeting is for a conversation that has barely started: the scenario's own fan has a long archive, the new one has not. */
const GREETED = { fanRef: WORLD.newFan, conversationRef: WORLD.newFan } as const;
const NEEDS: Partial<Record<HubAiFeature, Body>> = { 'improve-draft': { draftText: 'my draft' }, 'coach-chat': { chatterQuestion: 'What now?' }, 'hi-greeting': GREETED };
const needs = (feature: HubAiFeature): Body => NEEDS[feature] ?? {};
/**
 * The hub features of the shared AI features — what this fake hub serves on its OnlyFans pages. The two of Fansly's
 * own operations (`voice-script`, `fan-notes-fill`, contracts 1.15.0 P4b3) are in `HUB_AI_FEATURES` too; their pages,
 * bodies and the hub's rules for them come with the Fansly fake hub (R20 P6c1, P6c4).
 */
const SHARED_HUB_FEATURES: readonly HubAiFeature[] = [...new Set(FEATURE_IDS.map((feature) => HUB_FEATURE_MAP[feature].hub))];

beforeEach(() => {
  hub = createFakeHub();
  token = hub.issueToken();
});

describe('fake hub AI: the stream the model writes', () => {
  it('the vendored SDK accepts every frame of every feature, debug included', async () => {
    expect(HUB_AI_FEATURES.filter((feature) => !SHARED_HUB_FEATURES.includes(feature))).toEqual(['voice-script', 'fan-notes-fill']);
    for (const feature of SHARED_HUB_FEATURES) {
      const frames: unknown[] = [];
      const handle: { done: Promise<void> } = streamAiFeature(
        { baseUrl: hub.origin, fetch: hub.fetch, auth: { mode: 'bearer', token: () => token } } as never,
        { feature, body: streamBody({ clientRequestId: uuid(0x900 + ++seq), ...needs(feature) }), debugPromptEcho: true, onFrame: (f: unknown) => frames.push(f) },
      );
      await handle.done;
      expect(frames.map((f) => (f as { type: string }).type).filter((type, i, all) => all.indexOf(type) === i), feature).toEqual(['meta', 'debug_input_v1', 'reasoning_delta', 'content_delta', 'usage', 'done']);
    }
  });

  it('meta echoes the request, names the persona actually used and the quota left; every frame passes the contract schema', async () => {
    const frames = await framesOf(await stream('fast-reply', { replyTone: 'casual' }, ['context-v1']));
    for (const f of frames) expect(HubFrameSchema.safeParse(f).success, f.type).toBe(true);
    expect(frames[0]).toMatchObject({ type: 'meta', clientRequestId: uuid(0x800 + seq), feature: 'fast-reply', pageLabel: PAGE, personaDefinitionId: WORLD.persona.definitionId, quota: { remainingRequestsToday: 119 } });
    expect(types(frames)).toEqual(['meta', 'context_v1', 'content_delta', 'content_delta', 'content_delta', 'usage', 'done']);
  });

  it('no context_v1 without context-v1; no debug frames without debug-input-v1', async () => {
    expect([...new Set(types(await framesOf(await stream('chat-review'))))]).toEqual(['meta', 'content_delta', 'usage', 'done']);
  });

  it('context_v1: the archive head it served, the window, and the state of each known fan message', async () => {
    const frames = await framesOf(await stream('ping', { messageCount: 3000, knownFanMessageIds: ['6000', '6007', '9999'] }, ['context-v1']));
    expect(frames.find((f) => f.type === 'context_v1')).toMatchObject({
      source: 'archive',
      servedHead: { messageRef: '6000', occurredAt: '2026-10-03T10:00:00.000Z', isFromFan: true },
      window: { requested: 3000, served: 112 },
      coverage: 'complete',
      knownFanMessages: [
        { id: '6000', state: 'included' },
        { id: '6007', state: 'deleted' },
        { id: '9999', state: 'absent' },
      ],
      live: { status: 'not_sent', accepted: 0, rejected: 0 },
    });
  });

  it('a new archive message moves the served head (and the feed’s)', async () => {
    hub.control({ op: 'clock', advanceMs: 60_000 });
    const added = hub.control({ op: 'archiveMessage', pageLabel: PAGE, fanRef: WORLD.fan, messageId: '6500' });
    expect(added).toEqual({ ok: true, messageId: '6500' });
    const frames = await framesOf(await stream('fast-reply', { knownFanMessageIds: ['6500'] }, ['context-v1']));
    expect(frames.find((f) => f.type === 'context_v1')).toMatchObject({ servedHead: { messageRef: '6500', occurredAt: '2026-10-03T10:01:00.000Z' }, knownFanMessages: [{ id: '6500', state: 'included' }] });
    const feed = (await (await hubCall(hub.fetch, hub.origin, 'clientConversationFeed', { pageLabel: PAGE, fanRef: WORLD.fan, limit: 1 }, { token })).json()) as { head: { messageRef: string }; snapshotRevision: string };
    expect(feed).toMatchObject({ head: { messageRef: '6500' }, snapshotRevision: 'snap-2' });
  });

  it('fresh text (H-4c): served with the freshText flag, ignored without it, refused without context-v1 or outside draft features', async () => {
    const live = { liveTextContext: { capturedAt: '2026-10-03T09:59:55.000Z', items: [{ platformMessageId: '6600', direction: 'fan' as const, occurredAt: '2026-10-03T09:59:50.000Z', text: 'hey there' }] } };
    const served = await framesOf(await stream('fast-reply', live, ['context-v1']));
    expect(served.find((f) => f.type === 'context_v1')).toMatchObject({ source: 'union', live: { status: 'served', accepted: 1, rejected: 0 } });
    hub.control({ op: 'config', patch: pilotPageFlags({ freshText: false }) });
    const ignored = await framesOf(await stream('fast-reply', live, ['context-v1']));
    expect(ignored.find((f) => f.type === 'context_v1')).toMatchObject({ source: 'archive', live: { status: 'disabled', accepted: 0 } });
    expect(await refusal(await stream('fast-reply', live))).toEqual({ status: 400, error: 'bad_request', reason: 'capability_required' });
    expect(await refusal(await stream('chat-review', live, ['context-v1']))).toEqual({ status: 400, error: 'bad_request', reason: 'live_text_not_allowed' });
    expect(await refusal(await stream('fan-summary', live, ['context-v1']))).toEqual({ status: 400, error: 'bad_request', reason: 'live_text_not_allowed' });
  });

  it('[X51] the PPV state: taken where fresh text is, on an OnlyFans page; refused elsewhere with the fresh text’s reason', async () => {
    const state = { livePpvContext: { capturedAt: '2026-10-03T09:59:55.000Z', items: [{ platformMessageId: '6601', priceUsd: 25, purchased: true }] } };
    expect((await stream('fast-reply', state, ['context-v1'])).status).toBe(200);
    expect(await refusal(await stream('chat-review', state, ['context-v1']))).toEqual({ status: 400, error: 'bad_request', reason: 'live_text_not_allowed' });
    expect(await refusal(await stream('coach-chat', { ...state, ...needs('coach-chat') }, ['context-v1']))).toEqual({ status: 400, error: 'bad_request', reason: 'live_text_not_allowed' });
  });

  it('Split (H-10): Reply and Fix split when asked; Hi, Ping and Coach only with split-all-v1 and the splitAll flag', async () => {
    const split = (feature: HubAiFeature, capabilities: string[] = []) => stream(feature, { replyMode: 'preferSplit', ...needs(feature) }, capabilities);
    expect(textOf(await framesOf(await split('fast-reply')))).toContain(SPLIT_MARKERS.next);
    expect(textOf(await framesOf(await split('improve-draft')))).toContain(SPLIT_MARKERS.next);
    for (const feature of ['ping', 'coach-chat', 'hi-greeting'] as const) {
      expect(textOf(await framesOf(await split(feature))), `${feature} without split-all-v1`).not.toContain(SPLIT_MARKERS.next);
      expect(textOf(await framesOf(await split(feature, ['split-all-v1']))), `${feature} with split-all-v1`).toContain(SPLIT_MARKERS.next);
    }
    hub.control({ op: 'config', patch: pilotPageFlags({ splitAll: false }) });
    expect(textOf(await framesOf(await split('ping', ['split-all-v1'])))).not.toContain(SPLIT_MARKERS.next);
    expect(textOf(await framesOf(await stream('fast-reply', { replyMode: 'default' })))).not.toContain(SPLIT_MARKERS.next);
  });

  it('the hub\'s Hi gate: a greeting is for a conversation of at most ten stored messages — EVERY message counts, whoever sent it; past that the answer is 400 `gate_hi_greeting_limit`, and nothing is spent', async () => {
    const hi = (fanRef: string) => stream('hi-greeting', { fanRef, conversationRef: fanRef });
    // The scenario's own fan has a long archive: a dialogue, not a first hello.
    const quota = hub.config().quotaRequestsToday;
    expect(await refusal(await hi(WORLD.fan))).toEqual({ status: 400, error: 'gate_hi_greeting_limit' });
    expect(hub.config().quotaRequestsToday).toBe(quota);
    // A new fan: ten messages of ours and none of theirs still pass; the eleventh message closes the gate.
    const fresh = '2099';
    for (let i = 0; i < 10; i += 1) hub.control({ op: 'archiveMessage', pageLabel: PAGE, fanRef: fresh, sender: 'model', messageId: String(9100 + i) });
    expect(textOf(await framesOf(await hi(fresh)))).toContain('Hi and welcome!');
    hub.control({ op: 'archiveMessage', pageLabel: PAGE, fanRef: fresh, sender: 'model', messageId: '9110' });
    expect(await refusal(await hi(fresh))).toEqual({ status: 400, error: 'gate_hi_greeting_limit' });
    // The gate is Hi's alone: a Reply to the same conversation goes through.
    expect(textOf(await framesOf(await stream('fast-reply', { fanRef: fresh, conversationRef: fresh })))).not.toBe('');
  });

  it('the rules of the hub\'s own handler: a Coach preset forbids our question, Coach without either is refused, coach fields and summaryMode stay with their features — with the hub\'s own messages', async () => {
    const refusedWith = async (response: Response): Promise<{ status: number; error: string; message: string }> => {
      const body = (await response.json()) as { error: string; message: string };
      return { status: response.status, error: body.error, message: body.message };
    };
    // What the first live check met on the real hub (400 in 10 ms): the preset chip sent with its own words.
    expect(await refusedWith(await stream('coach-chat', { preset: 'situation', chatterQuestion: 'Что сейчас в чате?' }))).toEqual({ status: 400, error: 'bad_request', message: 'fake hub: coach-chat preset forbids chatterQuestion' });
    expect(await refusedWith(await stream('coach-chat', {}))).toEqual({ status: 400, error: 'bad_request', message: 'fake hub: coach-chat requires chatterQuestion' });
    expect(await refusedWith(await stream('coach-chat', { chatterQuestion: '   ' }))).toMatchObject({ status: 400, message: 'fake hub: coach-chat requires chatterQuestion' });
    expect(await refusedWith(await stream('improve-draft', {}))).toEqual({ status: 400, error: 'gate_draft_required', message: 'fake hub: improve-draft requires draftText' });
    // The same rules as a function, for every shared feature (ai-rules.ts mirrors hub `prepareAiFeatureStream`).
    for (const feature of SHARED_HUB_FEATURES) {
      expect([feature, streamBodyRefusal(feature, needs(feature) ?? {})]).toEqual([feature, null]);
      if (feature === 'coach-chat') continue;
      expect(streamBodyRefusal(feature, { ...needs(feature), preset: 'situation' })?.message).toBe(`${feature} does not accept coach fields`);
      expect(streamBodyRefusal(feature, { ...needs(feature), coachHistory: [] })?.message).toBe(`${feature} does not accept coach fields`);
      if (feature !== 'fan-summary') expect(streamBodyRefusal(feature, { ...needs(feature), summaryMode: 'short' })?.message).toBe(`${feature} does not accept summaryMode`);
    }
    // And the accepted forms run: the preset alone, a question alone.
    expect(types(await framesOf(await stream('coach-chat', { preset: 'situation' })))).toContain('done');
    expect(types(await framesOf(await stream('coach-chat', { chatterQuestion: 'What now?', coachHistory: [{ question: 'q', answer: 'a' }] })))).toContain('done');
  });

  it('with the hub\'s REAL body schema (the vendored SDK\'s) every body is checked by it first: what the real hub would answer 400 to is refused here', async () => {
    const real = createFakeHub({ streamBodySchema: routeSchemas.aiFeatureStream.body });
    const realToken = real.issueToken();
    const send = (feature: HubAiFeature, body: Record<string, unknown>, capabilities: string[] = []): Promise<Response> =>
      real.fetch(`${real.origin}/api/v1/ai/features/${feature}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${realToken}`, 'content-type': 'application/json', ...(capabilities.length === 0 ? {} : { 'x-kernel-ai-capabilities': capabilities.join(', ') }) },
        body: JSON.stringify(body),
      });
    const good = streamBody({ clientRequestId: uuid(0xa00), replyTone: 'casual' });
    expect((await send('fast-reply', good)).status).toBe(200);
    // The hub's body is strict: a key it does not know, a count outside its bounds (≤ 5000 since hub HF-6), a tone it never had.
    for (const bad of [{ ...good, clientRequestId: uuid(0xa01), someLaterField: true }, { ...good, clientRequestId: uuid(0xa02), messageCount: 5001 }, { ...good, clientRequestId: uuid(0xa03), replyTone: 'tender' }]) {
      const response = await send('fast-reply', bad);
      expect([response.status, ((await response.json()) as { message: string }).message]).toEqual([400, 'fake hub: body: refused by the hub’s own body schema (vendored SDK)']);
    }
    // Every scenario body of this package passes it — the H-4 fields included (the SDK has them since hub e7e1037b).
    const live = { liveTextContext: { capturedAt: '2026-10-03T09:59:55.000Z', items: [{ platformMessageId: '6600', direction: 'fan' as const, occurredAt: '2026-10-03T09:59:50.000Z', text: 'hey there' }] } };
    expect((await send('fast-reply', streamBody({ clientRequestId: uuid(0xa04), knownFanMessageIds: ['6000'], ...live }), ['context-v1'])).status).toBe(200);
  });

  it('Hi answers the variants asked for; recaps and reviews are whole', () => {
    const hi = (variantCount: 1 | 3) => generationText({ feature: 'hi-greeting', body: streamBody({ variantCount }), capabilities: [] }, true);
    expect(hi(3).split(SPLIT_MARKERS.variant)).toHaveLength(3);
    expect(hi(1).split(SPLIT_MARKERS.variant)).toHaveLength(1);
    expect(generationText({ feature: 'fan-summary', body: streamBody({ summaryMode: 'short' }), capabilities: [] }, true)).toContain('Short recap');
    expect(generationText({ feature: 'chat-review', body: streamBody({ replyMode: 'preferSplit' }), capabilities: ['split-all-v1'] }, true)).not.toContain(SPLIT_MARKERS.next);
  });
});

describe('fake hub AI: `aiNameFan` — a draft says whose chat it was written for', () => {
  it('every part and every variant of a draft ends with the fan’s id; analysis is left as it is; off by default', async () => {
    const fan = WORLD.fan;
    expect(textOf(await framesOf(await stream('fast-reply', { replyMode: 'preferSplit' })))).not.toContain('@');
    hub.control({ op: 'config', patch: { aiNameFan: true } });
    expect(textOf(await framesOf(await stream('fast-reply', { replyMode: 'preferSplit' }))).split(SPLIT_MARKERS.next).map((part) => part.trim())).toEqual([`Hey you, thanks for writing! @${fan}`, `How was your day? @${fan}`]);
    expect(textOf(await framesOf(await stream('fast-reply', { replyMode: 'default' })))).toBe(`Hey you, thanks for writing! How was your day? @${fan}`);
    const hi = textOf(await framesOf(await stream('hi-greeting', { variantCount: 3, ...needs('hi-greeting') })));
    expect(hi.split(SPLIT_MARKERS.variant).map((variant) => variant.trim())).toEqual([`Hi and welcome! @${WORLD.newFan}`, `Hey, glad you are here! @${WORLD.newFan}`, `Welcome in, nice to meet you! @${WORLD.newFan}`]);
    expect(namedForFan('<review/>', { feature: 'chat-review', body: streamBody({}), capabilities: [] })).toBe('<review/>');
    expect(textOf(await framesOf(await stream('fan-summary', needs('fan-summary'))))).not.toContain('@');
  });
});

describe('fake hub AI: `aiTexts` — the model’s whole answer per feature', () => {
  it('a named feature answers with the given text as it is, markers included; the others keep their synthetic answer; `{}` restores them', async () => {
    const review = '<rating>7</rating><evaluation>ВЕРДИКТ: fine.</evaluation><recommendations>1. Ask more.</recommendations>';
    hub.control({ op: 'config', patch: { aiTexts: { 'chat-review': review, 'fast-reply': `one ${SPLIT_MARKERS.next} two ${SPLIT_MARKERS.next} three` } } });
    expect(textOf(await framesOf(await stream('chat-review', needs('chat-review'))))).toBe(review);
    expect(textOf(await framesOf(await stream('fast-reply', { replyMode: 'default' }))).split(SPLIT_MARKERS.next)).toHaveLength(3);
    expect(textOf(await framesOf(await stream('ping', needs('ping'))))).toBe('Thinking of you today, how are things?');
    hub.control({ op: 'config', patch: { aiTexts: {} } });
    expect(textOf(await framesOf(await stream('fast-reply', { replyMode: 'default' })))).toBe('Hey you, thanks for writing! How was your day?');
    expect(() => hub.control({ op: 'config', patch: { aiTexts: { 'fast-reply': 5 } } } as never)).toThrow(/aiTexts is not a map/);
  });
});

describe('fake hub AI: checks before the stream', () => {
  it('the persona fence: an unknown key is 404, a stale definition 409 (also after the owner changes the persona)', async () => {
    expect(await refusal(await stream('fast-reply', { personaKey: 'nobody' }))).toEqual({ status: 404, error: 'not_found', reason: 'persona_not_found' });
    hub.control({ op: 'persona', key: WORLD.persona.key, definitionId: WORLD.persona.otherDefinitionId });
    expect(await refusal(await stream('fast-reply'))).toEqual({ status: 409, error: 'persona_definition_changed' });
    const catalog = (await (await hubCall(hub.fetch, hub.origin, 'aiPersonaCatalog', null, { token })).json()) as { personas: Array<{ key: string; version: number; definitionId: string }> };
    expect(catalog.personas[0]).toMatchObject({ key: WORLD.persona.key, version: 4, definitionId: WORLD.persona.otherDefinitionId });
    expect((await stream('fast-reply', { expectedPersonaDefinitionId: WORLD.persona.otherDefinitionId })).status).toBe(200);
    hub.control({ op: 'persona', key: 'new-one', definitionId: 'pdef_new0000000000001', status: 'archived' });
    expect(await refusal(await stream('fast-reply', { personaKey: 'new-one', expectedPersonaDefinitionId: undefined }))).toMatchObject({ status: 404 });
    expect((await stream('fast-reply', { personaKey: null, expectedPersonaDefinitionId: undefined })).status).toBe(200);
  });

  it('the daily quota: the last request passes with 0 left, the next is 429 quota_denied and counted', async () => {
    hub.control({ op: 'config', patch: { quotaRequestsToday: 1 } });
    const frames = await framesOf(await stream('ping'));
    expect(frames[0]).toMatchObject({ quota: { remainingRequestsToday: 0 } });
    expect(await refusal(await stream('ping'))).toEqual({ status: 429, error: 'quota_denied' });
    const usage = (await (await hubCall(hub.fetch, hub.origin, 'clientAiUsageDaily', { pageLabel: PAGE, date: '2026-10-03', timeZone: 'UTC' }, { token })).json()) as { days: Array<{ totals: { requestCount: number; completed: number; quotaDenied: number; costMicroUsd: number } }> };
    expect(usage.days[0]?.totals).toMatchObject({ requestCount: 2, completed: 1, quotaDenied: 1, costMicroUsd: 2500 });
    hub.control({ op: 'config', patch: { quotaRequestsToday: null } });
    expect((await framesOf(await stream('ping')))[0]).toMatchObject({ quota: { remainingRequestsToday: null } });
  });

  it('the narrow token’s AI is behind the master switch and the coach/recap/review flags; a full token is not', async () => {
    const full = hub.issueToken({ client: null });
    hub.control({ op: 'config', patch: { pageFlags: { [PAGE]: { coach: false, recap: false, review: false } } } });
    for (const feature of ['coach-chat', 'fan-summary', 'chat-review'] as const) {
      expect(await refusal(await stream(feature, needs(feature))), feature).toEqual({ status: 409, error: 'client_feature_disabled', reason: 'flag_off' });
      expect((await stream(feature, needs(feature), [], full)).status, feature).toBe(200);
    }
    expect((await stream('fast-reply')).status).toBe(200);
    hub.control({ op: 'config', patch: { master: false } });
    expect(await refusal(await stream('fast-reply'))).toEqual({ status: 409, error: 'client_feature_disabled', reason: 'disabled' });
  });

  it('a body that picks a model, an effort, a prompt or a transcript is 400 (the hub owns AI)', async () => {
    for (const extra of [{ model: 'x' }, { reasoningEffort: 'max' }, { systemPrompt: 'x' }, { transcript: [] }, { greetingMode: 'x' }, { clientContext: {} }]) {
      const response = await hubCall(hub.fetch, hub.origin, 'aiFeatureStream', { feature: 'fast-reply', body: { ...streamBody({ clientRequestId: uuid(0x990) }), ...extra }, capabilities: [] }, { token });
      expect(await refusal(response), Object.keys(extra)[0]).toEqual({ status: 400, error: 'bad_request' });
    }
  });
});

describe('fake hub AI: what a generation leaves behind', () => {
  const generate = async (feature: 'fan-summary', body: Body = {}): Promise<string> => {
    const frames = await framesOf(await stream(feature, { messageCount: 3000, ...body }));
    return String(frames[0]?.['requestId']);
  };
  const profile = (generationRef: string, clientRequestId?: string, as: string = token) =>
    hubCall(hub.fetch, hub.origin, 'clientFanProfileFromGeneration', { pageLabel: PAGE, fanRef: WORLD.fan, generationRef, ...(clientRequestId === undefined ? {} : { clientRequestId }) }, { token: as });

  it('a finished full recap is the shared recap (H-13) for every chatter; a short one fills the short slot', async () => {
    const full = await generate('fan-summary');
    const short = await generate('fan-summary', { summaryMode: 'short' });
    const other = hub.issueToken({ username: WORLD.otherUser.username });
    const recaps = (await (await hubCall(hub.fetch, hub.origin, 'clientConversationRecaps', { pageLabel: PAGE, fanRef: WORLD.fan }, { token: other })).json()) as {
      full: { generationRef: string; coverage: unknown; text: string };
      short: { generationRef: string };
      fullSavedToProfile: boolean;
    };
    expect(recaps).toMatchObject({ full: { generationRef: full, coverage: { transcriptCoverage: 'full-history', requestedCount: 3000, keptCount: 112 } }, short: { generationRef: short }, fullSavedToProfile: false });
    expect(recaps.full.text).toContain('Recap');
    const status = (await (await hubCall(hub.fetch, hub.origin, 'aiRecapStatus', { pageLabel: PAGE, conversationRef: WORLD.fan, fanRef: WORLD.fan }, { token })).json()) as { full: { ageMs: number }; short: { ageMs: number } };
    expect(status).toMatchObject({ full: { ageMs: 0, keptCount: 112 }, short: { ageMs: 0 } });
  });

  it('H-5: not ready while the generation is not visible, then created once, then existing', async () => {
    hub.control({ op: 'config', patch: { generationVisibleAfterMs: 5_000 } });
    const ref = await generate('fan-summary');
    expect(await refusal(await profile(ref))).toEqual({ status: 409, error: 'generation_not_ready' });
    hub.control({ op: 'clock', advanceMs: 5_000 });
    expect(await (await profile(ref)).json()).toMatchObject({ outcome: 'created', profile: { version: 4 } });
    expect(await (await profile(ref)).json()).toMatchObject({ outcome: 'existing', profile: { version: 4 } });
  });

  it('H-5: an unfinished, a short, a failed, a foreign or an unknown generation is refused', async () => {
    const short = await generate('fan-summary', { summaryMode: 'short' });
    expect(await refusal(await profile(short))).toEqual({ status: 409, error: 'generation_not_eligible', reason: 'not_full_summary' });
    const full = await generate('fan-summary');
    const other = hub.issueToken({ username: WORLD.otherUser.username });
    expect(await refusal(await profile(full, undefined, other))).toEqual({ status: 404, error: 'not_found' });
    expect(await refusal(await profile(uuid(0x123)))).toEqual({ status: 404, error: 'not_found' });
    // Still streaming: the generation is open; its clientRequestId is in flight.
    hub.control({ op: 'scriptSse', feature: 'fan-summary', responses: [{ kind: 'stream', steps: [{ kind: 'frame', frame: { type: 'meta', requestId: uuid(0x125), clientRequestId: uuid(1), feature: 'fan-summary', pageLabel: PAGE, model: 'm', provider: 'anthropic', providerResponseId: null, quota: { accepted: true, remainingRequestsToday: null, remainingMicroUsdToday: null } } }, { kind: 'gate', name: 'open' }, { kind: 'reset' }] }] });
    const open = readSse(await stream('fan-summary', { messageCount: 3000 }));
    await until(() => hub.status().waitingGates.includes('open'));
    expect(await refusal(await profile(uuid(0x125)))).toEqual({ status: 409, error: 'generation_not_ready' });
    expect(await refusal(await profile(uuid(0x126), uuid(0x800 + seq)))).toEqual({ status: 409, error: 'generation_not_ready' });
    hub.control({ op: 'release', gate: 'open' });
    await open;
    expect(await refusal(await profile(uuid(0x125)))).toEqual({ status: 409, error: 'generation_not_eligible', reason: 'not_completed' });
  });

  it('own AI spend (H-15) counts completed, failed and cancelled streams of this user and page only', async () => {
    await framesOf(await stream('ping'));
    hub.control({ op: 'scriptSse', responses: [{ kind: 'stream', steps: [{ kind: 'frame', frame: { type: 'meta', requestId: uuid(0x130), clientRequestId: uuid(1), feature: 'ping', pageLabel: PAGE, model: 'm', provider: 'anthropic', providerResponseId: null, quota: { accepted: true, remainingRequestsToday: null, remainingMicroUsdToday: null } } }, { kind: 'reset' }] }] });
    await readSse(await stream('ping'));
    const other = hub.issueToken({ username: WORLD.otherUser.username });
    await framesOf(await stream('ping', {}, [], other));
    await framesOf(await stream('ping', { pageLabel: WORLD.pages.vip.pageLabel }));
    const report = (await (await hubCall(hub.fetch, hub.origin, 'clientAiUsageDaily', { pageLabel: PAGE, date: '2026-10-03', timeZone: 'UTC' }, { token })).json()) as {
      days: Array<{ totals: Record<string, unknown>; features: Array<{ feature: string }> }>;
    };
    expect(report.days[0]?.totals).toMatchObject({ requestCount: 2, completed: 1, failed: 1, cancelled: 0 });
    expect(report.days[0]?.features.map((item) => item.feature)).toEqual(['ping']);
  });
});

async function until(predicate: () => boolean): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > 2_000) throw new Error('condition not reached');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function types(frames: ReadonlyArray<{ type: string }>): string[] {
  return frames.map((f) => f.type);
}
