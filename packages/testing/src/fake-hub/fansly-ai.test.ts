// R20 P6c4: HF-4а/б, HF-6 and notes fill, against hub bd3eec065 (#592/#603/#583).
// SDK on both sides: server validates its real schemas, client validates streams and voice views.
import { type AiFeatureStreamBody, type HubAiFeature } from '@cg/contracts';
import { createClient, routeSchemas, streamAiFeature, type AiFeatureStreamFrame, type AiStreamCapability } from '@kernel/sdk';
import { beforeEach, describe, expect, it } from 'vitest';

import { PAGE, WORLD, meta, streamBody, uuid } from '../scenarios/hub';
import { streamBodyRefusal, voiceScriptRefusal } from './ai-rules';
import { fanslyPageFlags } from './config';
import { createFakeHub, type FakeHub } from './hub';
import { type VoiceCreateBody } from './voice';

const FANSLY = WORLD.pages.fansly.pageLabel;
const { a: A, b: B } = WORLD.fansly.chats;
let hub: FakeHub;
let token: string;
let seq = 0;
const options = (as = token) => ({ baseUrl: hub.origin, fetch: hub.fetch, headers: { 'x-client-version': 'chat-extension/1.0.0' }, auth: { mode: 'bearer' as const, token: () => as } });
const client = (as = token) => createClient(options(as));
const body = (over: Partial<AiFeatureStreamBody> = {}): AiFeatureStreamBody => streamBody({ pageLabel: FANSLY, platform: 'fansly', conversationRef: A.group, fanRef: A.fan, clientRequestId: uuid(0xc400 + ++seq), ...over });
async function generate(feature: HubAiFeature, over: Partial<AiFeatureStreamBody> = {}, capabilities: readonly AiStreamCapability[] = ['context-v1'], as = token): Promise<AiFeatureStreamFrame[]> {
  const frames: AiFeatureStreamFrame[] = [];
  await streamAiFeature(options(as), { feature, body: body(over), capabilities, onFrame: (frame) => frames.push(frame) }).done;
  return frames;
}
const textOf = (frames: readonly AiFeatureStreamFrame[]): string => frames.flatMap((frame) => frame.type === 'content_delta' ? [frame.text] : []).join('');
const contextOf = (frames: readonly AiFeatureStreamFrame[]) => frames.find((frame) => frame.type === 'context_v1');
const render = (source: string, over: Partial<VoiceCreateBody> = {}): VoiceCreateBody => ({ clientRequestId: uuid(0xd400 + ++seq), conversationRef: A.group, fanRef: A.fan, sourceGenerationRef: source, script: '[warmly] Hey you.', ...over });
const create = (input: VoiceCreateBody, as = token, pageLabel: string = FANSLY) => client(as).voiceNoteCreate({ params: { pageLabel }, body: input });
async function script(over: Partial<AiFeatureStreamBody> = {}, as = token): Promise<string> {
  const frames = await generate('voice-script', { draftText: 'A synthetic draft.', ...over }, ['context-v1'], as);
  const meta = frames.find((frame) => frame.type === 'meta');
  if (meta === undefined) throw new Error('missing meta');
  return meta.requestId;
}
const error = (code: string, status = 400) => ({ code, status });
const seed = (pageLabel: string, conversationRef: string, count: number) => hub.control({ op: 'archiveConversation', pageLabel, conversationRef, messages: Array.from({ length: count }, (_, n) => ({ id: String(90000 + n), sender: n % 2 === 0 ? 'fan' as const : 'model' as const })) });

beforeEach(() => {
  hub = createFakeHub({ streamBodySchema: routeSchemas.aiFeatureStream.body, routeSchemas, timeScale: 0, config: fanslyPageFlags() });
  token = hub.issueToken();
});

describe('[host:fansly] voice identity and the narrow token (HF-4а/б)', () => {
  it('script → SDK create with group ≠ fan; status; queued audio is not ready; replay admits one render', async () => {
    const request = render(await script());
    const view = await create(request);
    expect(view).toMatchObject({ voiceNoteId: 1, state: 'queued', billed: null, scriptChars: request.script.length });
    expect(await create({ ...request, script: `  ${request.script}\r\n` })).toEqual(view);
    expect(await client().voiceNoteStatus({ params: { pageLabel: FANSLY, id: view.voiceNoteId } })).toEqual(view);
    expect((await client().raw('voiceNoteAudio', { params: { pageLabel: FANSLY, id: view.voiceNoteId } })).status).toBe(404);
    await expect(create({ ...request, script: 'Different take.' })).rejects.toMatchObject(error('idempotency_mismatch', 409));
    expect(hub.read().entries.filter((entry) => entry.route === 'voiceNoteCreate').length).toBe(3);
    expect(JSON.stringify(hub.read())).not.toContain(request.script);
  });

  it('refuses a contradicted pair on the script before quota and on the render before a row; fixing the pair admits the same request', async () => {
    const quota = hub.config().quotaRequestsToday;
    await expect(script({ fanRef: B.fan })).rejects.toMatchObject(error('conversation_fan_mismatch', 409));
    expect(hub.config().quotaRequestsToday).toBe(quota);
    const request = render(await script());
    hub.control({ op: 'thread', pageLabel: FANSLY, conversationRef: A.group, fanRef: B.fan });
    await expect(create(request)).rejects.toMatchObject(error('conversation_fan_mismatch', 409));
    hub.control({ op: 'thread', pageLabel: FANSLY, conversationRef: A.group, fanRef: A.fan });
    expect(await create(request)).toMatchObject({ voiceNoteId: 1 });
  });

  it('unverified pairs are admitted; the source must match feature, user, page, conversation and exact fan', async () => {
    hub.control({ op: 'thread', pageLabel: FANSLY, conversationRef: A.group, fanRef: null });
    const request = render(await script());
    for (const over of [{ sourceGenerationRef: uuid(123) }, { conversationRef: B.group }, { fanRef: B.fan }, { fanRef: WORLD.fansly.twinFan }, { fanRef: undefined }]) {
      await expect(create({ ...request, ...over })).rejects.toMatchObject(error('voice_source_invalid'));
    }
    const reply = await generate('fast-reply');
    const meta = reply.find((frame) => frame.type === 'meta');
    await expect(create({ ...request, sourceGenerationRef: meta?.requestId ?? '' })).rejects.toMatchObject(error('voice_source_invalid'));
    const other = hub.issueToken({ username: WORLD.otherUser.username });
    await expect(create(request, other)).rejects.toMatchObject(error('voice_source_invalid'));
    // A granted wrong page has no voice flag; page grant and platform gate run before source admission.
    await expect(create(request, token, PAGE)).rejects.toMatchObject(error('client_feature_disabled', 409));
    expect(await create(request)).toMatchObject({ voiceNoteId: 1 });
  });

  it('old render form has no fanRef: requires fan/fan source, skips the pair; fanRef stays outside the replay hash', async () => {
    const source = await script({ conversationRef: A.fan });
    const request = render(source, { conversationRef: A.fan, fanRef: undefined });
    hub.control({ op: 'thread', pageLabel: FANSLY, conversationRef: A.fan, fanRef: B.fan });
    const view = await create(request);
    expect(view.voiceNoteId).toBe(1);
    expect(await create({ ...request, fanRef: A.fan })).toEqual(view);
    await expect(create({ ...request, clientRequestId: uuid(++seq), fanRef: A.fan })).rejects.toMatchObject(error('conversation_fan_mismatch', 409));
    expect(voiceScriptRefusal({ ...body(), clientContext: {} }, false)).toBe('gate_voice_identity_required');
    expect(voiceScriptRefusal({ ...body({ conversationRef: A.fan }), clientContext: {} }, false)).toBeNull();
  });

  it('draft, fan and platform gates use the hub codes; a disabled lane spends no AI quota', async () => {
    const quota = hub.config().quotaRequestsToday;
    await expect(generate('voice-script')).rejects.toMatchObject(error('gate_draft_required'));
    await expect(script({ fanRef: undefined })).rejects.toMatchObject(error('gate_voice_identity_required'));
    await expect(script({ pageLabel: PAGE, platform: 'onlyfans', conversationRef: WORLD.fan, fanRef: WORLD.fan })).rejects.toMatchObject(error('gate_voice_unsupported_platform'));
    hub.control({ op: 'config', patch: { voiceLaneOff: [FANSLY] } });
    await expect(script()).rejects.toMatchObject(error('gate_voice_disabled'));
    const boot = await client().clientBootstrap();
    expect(boot.pages.find((page) => page.pageLabel === FANSLY)?.features.voice).toEqual({ available: false, reason: 'lane_off' });
    expect(hub.config().quotaRequestsToday).toBe(quota);
  });

  it('voice flag, master, binding and capability gate all three routes and replays; full tokens bypass the client flag', async () => {
    const request = render(await script());
    const view = await create(request);
    const paths = [{ route: 'voiceNoteCreate' as const, params: { pageLabel: FANSLY }, body: request }, { route: 'voiceNoteStatus' as const, params: { pageLabel: FANSLY, id: view.voiceNoteId } }, { route: 'voiceNoteAudio' as const, params: { pageLabel: FANSLY, id: view.voiceNoteId } }];
    for (const reason of ['flag_off', 'disabled', 'binding_missing', 'hub_not_ready'] as const) {
      hub.control({ op: 'config', patch: { master: reason !== 'disabled', ...fanslyPageFlags({ voice: reason !== 'flag_off' }), capabilities: reason === 'hub_not_ready' ? hub.config().capabilities.filter((cap) => cap !== 'voice-notes-v1') : [...new Set([...hub.config().capabilities, 'voice-notes-v1'])] } });
      hub.control({ op: 'pageAccount', pageLabel: FANSLY, platformAccountId: reason === 'binding_missing' ? null : WORLD.pages.fansly.platformAccountId });
      for (const call of paths) {
        const response = await client().raw(call.route, call);
        expect(response.status, `${reason} ${call.route}`).toBe(409);
        expect(await response.json()).toMatchObject({ error: 'client_feature_disabled', reason });
      }
      await expect(script()).rejects.toMatchObject(error('client_feature_disabled', 409));
    }
    const full = hub.issueToken({ client: null });
    expect(await client(full).voiceNoteStatus({ params: { pageLabel: FANSLY, id: view.voiceNoteId } })).toEqual(view);
    hub.control({ op: 'config', patch: { capabilities: [...hub.config().capabilities, 'voice-notes-v1'], voiceLaneOff: [FANSLY] } });
    expect(await create(request)).toEqual(view);
    await expect(create({ ...request, clientRequestId: uuid(++seq) })).rejects.toMatchObject(error('voice_disabled', 403));
  });

  it('unreadable/old versions refuse every narrow voice route; prior reasons and full-token reads keep their precedence', async () => {
    const request = render(await script());
    const view = await create(request);
    hub.control({ op: 'config', patch: { minVersion: '2.0.0' } });
    for (const route of ['voiceNoteCreate', 'voiceNoteStatus', 'voiceNoteAudio'] as const) {
      const response = await client().raw(route, { params: { pageLabel: FANSLY, id: view.voiceNoteId }, ...(route === 'voiceNoteCreate' ? { body: request } : {}) });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ reason: 'client_outdated' });
    }
    const unreadable = await client().raw('voiceNoteCreate', { params: { pageLabel: FANSLY }, body: request, headers: { 'x-client-version': 'chat-extension/e2e' } });
    expect(await unreadable.json()).toMatchObject({ reason: 'client_outdated' });
    expect(await create(request, hub.issueToken({ client: null }))).toEqual(view);
    hub.control({ op: 'config', patch: { master: false } });
    const wrongPlatform = await client().raw('voiceNoteCreate', { params: { pageLabel: PAGE }, body: request });
    expect(await wrongPlatform.json()).toMatchObject({ reason: 'disabled' }); // HF-15: master precedes platform and client version
  });

  it('an incomplete, failed or truncated source never admits a render', async () => {
    for (const ending of ['eof', 'error', 'max_tokens', 'length'] as const) {
      const source = uuid(0xe400 + ++seq);
      hub.control({ op: 'scriptSse', feature: 'voice-script', responses: [{ kind: 'stream', steps: [
        { kind: 'frame', frame: meta('voice-script', { requestId: source, pageLabel: FANSLY }) },
        { kind: 'frame', frame: { type: 'content_delta', text: 'Synthetic script.' } },
        ...(ending === 'eof' ? [] : ending === 'error'
          ? [{ kind: 'frame' as const, frame: { type: 'error' as const, code: 'internal_error', message: 'Synthetic failure', retryAfterMs: null } }]
          : [{ kind: 'frame' as const, frame: { type: 'done' as const, stopReason: ending } }]),
        { kind: 'eof' },
      ] }] });
      await generate('voice-script', { draftText: 'draft' }).catch(() => undefined);
      await expect(create(render(source))).rejects.toMatchObject(error('voice_source_invalid'));
    }
    expect((await create(render(await script()))).voiceNoteId).toBe(1);
  });

  it('real SDK schema, script validation and access protect render admission', async () => {
    const request = render(await script());
    for (const over of [{ clientRequestId: 'not-a-uuid' }, { fanRef: '' }, { script: 'x'.repeat(8001) }]) {
      const response = await client().raw('voiceNoteCreate', { params: { pageLabel: FANSLY }, body: { ...request, ...over } });
      expect(response.status).toBe(400);
    }
    for (const script of [' ', '<speak>hello</speak>', '[unknown] hello', 'x'.repeat(601)]) await expect(create({ ...request, script })).rejects.toMatchObject(error('voice_script_invalid'));
    await expect(create({ ...request, fanRef: `${A.fan}\n` })).rejects.toMatchObject(error('voice_source_invalid'));
    hub.control({ op: 'grantPages', username: WORLD.user.username, pages: [] });
    await expect(create(request)).rejects.toMatchObject(error('client_feature_disabled', 409));
    await expect(create(request, hub.issueToken({ client: null }))).rejects.toMatchObject(error('not_found', 404));
    const response = await hub.fetch(`${hub.origin}/api/v1/pages/${FANSLY}/voice-notes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) });
    expect(response.status).toBe(401);
  });
});

describe('[host:fansly] notes fill and conversation markers', () => {
  it('fills the requested labels through SDK, requires a fan and labels, isolates notes fields, obeys notesFill', async () => {
    const noteFields = ['Name', 'Hobbies'];
    expect(textOf(await generate('fan-notes-fill', { noteFields }))).toBe('Name: Synthetic fact from the chat.\nHobbies: Synthetic fact from the chat.');
    // R20 P11b2: the merge mode, by its switch alone — quotes under each value, a field the hub names itself.
    expect(textOf(await generate('fan-notes-fill', { noteFields, noteValues: ['', ''] }))).toBe('Name: Synthetic fact from the chat.\n> «my Name, in synthetic words»\nHobbies: Synthetic fact from the chat.\n> «my Hobbies, in synthetic words»\n+ Питомцы: synthetic cat\n> «my synthetic cat»');
    await expect(generate('fan-notes-fill')).rejects.toMatchObject(error('bad_request'));
    await expect(generate('fan-notes-fill', { noteFields, fanRef: undefined })).rejects.toMatchObject(error('bad_request'));
    await expect(generate('fast-reply', { noteFields })).rejects.toMatchObject(error('bad_request'));
    expect(streamBodyRefusal('fan-notes-fill', { noteFields, noteValues: [''] })).toEqual({ error: 'bad_request', message: 'noteValues must hold exactly one value per noteFields label' });
    expect(streamBodyRefusal('fast-reply', { noteValues: [] })?.message).toBe('fast-reply does not accept noteValues');
    hub.control({ op: 'config', patch: fanslyPageFlags({ notesFill: false }) });
    await expect(generate('fan-notes-fill', { noteFields })).rejects.toMatchObject(error('client_feature_disabled', 409));
    hub.control({ op: 'config', patch: fanslyPageFlags() });
    seed(FANSLY, A.group, 0);
    await expect(generate('fan-notes-fill', { noteFields })).rejects.toMatchObject(error('gate_min_messages'));
    hub.control({ op: 'archiveConversation', pageLabel: FANSLY, conversationRef: A.group, messages: [{ id: '999', sender: 'fan', state: 'deleted' }, { id: '998', sender: 'model', state: 'held' }] });
    await expect(generate('fan-notes-fill', { noteFields })).rejects.toMatchObject(error('gate_min_messages'));
  });

  it('aiNameFan tags every split/variant by group, even for two groups of the same fan; analysis stays untagged', async () => {
    hub.control({ op: 'config', patch: { aiNameFan: true } });
    for (const group of [A.group, B.group]) {
      hub.control({ op: 'thread', pageLabel: FANSLY, conversationRef: group, fanRef: A.fan });
      const text = textOf(await generate('fast-reply', { conversationRef: group, replyMode: 'preferSplit' }));
      expect(text.match(new RegExp(`@${group}`, 'g'))).toHaveLength(2);
      expect(text).not.toContain(`@${A.fan}`);
    }
    expect(textOf(await generate('voice-script', { draftText: 'hi' }))).toContain(`@${A.group}`);
    expect(textOf(await generate('fan-notes-fill', { noteFields: ['Name'] }))).not.toContain('@');
  });
});

describe('[host:fansly] [host:chatspace] HF-6 depth, one owner setting and the actual reader window', () => {
  it.each([1500, 3000, 5000])('deepMax %i in bootstrap caps full recap; notes fill has a 3000 floor, both platforms', async (depth) => {
    hub.control({ op: 'config', patch: { limits: { deepMax: depth } } });
    expect((await client().clientBootstrap()).limits.deepMax).toBe(depth);
    for (const target of [{ pageLabel: FANSLY, platform: 'fansly' as const, conversationRef: A.group, fanRef: A.fan }, { pageLabel: PAGE, platform: 'onlyfans' as const, conversationRef: WORLD.fan, fanRef: WORLD.fan }]) {
      seed(target.pageLabel, target.conversationRef, 5100);
      const frames = await generate('fan-summary', { ...target, messageCount: 5000 });
      expect(contextOf(frames)?.window).toEqual({ requested: 5000, served: depth });
      expect(contextOf(await generate('fan-summary', { ...target, messageCount: 5000, summaryMode: 'short' }))?.window).toEqual({ requested: 300, served: 300 });
      expect(contextOf(await generate('chat-review', { ...target, messageCount: 5000 }))?.window).toEqual({ requested: 5000, served: 1500 });
    }
    expect(contextOf(await generate('fan-notes-fill', { messageCount: 5000, noteFields: ['Name'] }))?.window).toEqual({ requested: 5000, served: Math.max(3000, depth) });
    expect(contextOf(await generate('fan-summary', { messageCount: 20 }))?.window).toEqual({ requested: 20, served: 20 });
    expect(contextOf(await generate('fan-notes-fill', { messageCount: undefined, noteFields: ['Name'] }))?.window).toEqual({ requested: 1500, served: 1500 });
    const recaps = await client().clientConversationRecaps({ params: { pageLabel: FANSLY, fanRef: A.fan }, query: { conversationRef: A.group, personaDefinitionId: WORLD.persona.definitionId } });
    expect(recaps.full?.coverage.keptCount).toBe(20);
  });

  it('coverage-check describes the capped reader, and recap provenance records the same cap', async () => {
    seed(FANSLY, A.group, 5100);
    hub.control({ op: 'config', patch: { limits: { deepMax: 1500 } } });
    const frames = await generate('fan-summary', { messageCount: 3000, coverageCheck: { window: [{ id: '90000', dir: 'fan' }, { id: '95099', dir: 'model' }], deletedIds: [] } }, ['context-v1', 'coverage-check-v1']);
    expect(contextOf(frames)?.window).toEqual({ requested: 3000, served: 1500 });
    expect(contextOf(frames)?.coverageCheck?.window).toEqual([{ id: '90000', state: 'outside_window' }, { id: '95099', state: 'included' }]);
    const recap = await client().clientConversationRecaps({ params: { pageLabel: FANSLY, fanRef: A.fan }, query: { conversationRef: A.group, personaDefinitionId: WORLD.persona.definitionId } });
    expect(recap.full?.coverage).toMatchObject({ requestedCount: 3000, keptCount: 1500, transcriptCoverage: 'window' });
  });

  it('without context-v1 the reader stays at 1500; wire 5001 is refused by SDK and fake before spend; bad owner depths fail control', async () => {
    seed(FANSLY, A.group, 5100);
    hub.control({ op: 'config', patch: { limits: { deepMax: 5000 } } });
    const frames = await generate('fan-summary', { messageCount: 5000 }, []);
    expect(contextOf(frames)).toBeUndefined();
    const recap = await client().clientConversationRecaps({ params: { pageLabel: FANSLY, fanRef: A.fan }, query: { conversationRef: A.group, personaDefinitionId: WORLD.persona.definitionId } });
    expect(recap.full?.coverage).toMatchObject({ requestedCount: 5000, keptCount: 1500, transcriptCoverage: 'window' });
    expect(routeSchemas.aiFeatureStream.body.safeParse(body({ messageCount: 5001 })).success).toBe(false);
    const quota = hub.config().quotaRequestsToday;
    await expect(generate('fan-summary', { messageCount: 5001 })).rejects.toMatchObject(error('bad_request'));
    expect(hub.config().quotaRequestsToday).toBe(quota);
    expect(() => hub.control({ op: 'config', patch: { limits: { deepMax: 3001 } } })).toThrow('deepMax');
  });
});
