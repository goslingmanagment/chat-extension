// The fake hub's voice-notes lane (voice.ts) through the hub's own client — the
// vendored SDK's `createClient` and `fetchVoiceNoteAudio`, its schemas checking
// every request and answer — on both sites: the render from admission to its
// MP3, the outcomes a test scripts, the replay, the source and identity checks
// of the hub (HF-4а; OnlyFans since hub #757), its switches, and the voice
// script's own gate (ai-rules.ts).

import { createHash } from 'node:crypto';

import { VOICE_TAGS, type AiFeatureStreamBody, type HubRouteKey } from '@cg/contracts';
import { createClient, fetchVoiceNoteAudio, KernelApiError, routeSchemas, type KernelClientOptions } from '@kernel/sdk';
import { describe, expect, it, vi } from 'vitest';

import { meta } from '../scenarios/hub/sse';
import { WORLD, uuid } from '../scenarios/hub/world';
import { type Generation } from './ai';
import { voiceScriptRefusal } from './ai-rules';
import { PILOT_CAPABILITIES, fanslyPageFlags, pilotPageFlags } from './config';
import { createFakeHub, type FakeHub, type FakeHubOptions } from './hub';
import { hubCall, readSse, type FetchLike } from './kit';
import { facadeRequestOf, matchRoute, wireOf } from './routing';
import { startFakeHub } from './server';
import { HUB_VOICE_TAGS, VOICE_RENDER_MS, VoiceLane, canonicalVoiceScript, voiceRequestHash } from './voice';
import { voiceAudioSamples } from './voice-audio';

const CLIENT_VERSION = 'chat-extension/1.0.0';
const SCRIPT = '[warmly] Hey you, it is lovely to hear from you.';

/** A chat of each site: on OnlyFans the chat is the fan; on Fansly a group with its fan. */
const OF = { platform: 'onlyfans', pageLabel: WORLD.pages.one.pageLabel, chat: WORLD.fan, fan: WORLD.fan } as const;
const FANSLY = { platform: 'fansly', pageLabel: WORLD.pages.fansly.pageLabel, chat: WORLD.fansly.chats.a.group, fan: WORLD.fansly.chats.a.fan } as const;
interface Chat {
  readonly platform: 'onlyfans' | 'fansly';
  readonly pageLabel: string;
  readonly chat: string;
  readonly fan: string;
}

type Client = ReturnType<typeof createClient>;
type CreateBody = Parameters<Client['voiceNoteCreate']>[0]['body'];

interface Lane {
  readonly hub: FakeHub;
  readonly sdk: KernelClientOptions;
  /** A voice-script stream of the chat, as the client asks for it. */
  stream(chat: Chat, over?: Partial<AiFeatureStreamBody>): Promise<Response>;
  /** A finished voice script of the chat: its generation, the source of a take. */
  script(chat: Chat, over?: Partial<AiFeatureStreamBody>): Promise<string>;
  /** A create's body: a new take of SCRIPT from `source`, the chat and its fan named. */
  body(source: string, chat?: Chat, over?: Partial<CreateBody>): CreateBody;
  create(chat: Chat, body: CreateBody): ReturnType<Client['voiceNoteCreate']>;
  status(chat: Chat, id: number): ReturnType<Client['voiceNoteStatus']>;
  audio(chat: Chat, id: number): Promise<Response>;
  /** One call by hand: the hub's answer as it is. */
  call(route: HubRouteKey, request: unknown, options?: { readonly token?: string; readonly signal?: AbortSignal }): Promise<{ readonly status: number; readonly body: unknown }>;
}

/** A fake hub with the vendored SDK's schemas, the Fansly page switched on, renders at once unless `timeScale` says otherwise. */
function lane(options: FakeHubOptions = {}): Lane {
  const hub = createFakeHub({ routeSchemas, streamBodySchema: routeSchemas.aiFeatureStream.body, timeScale: 0, ...options, config: { ...fanslyPageFlags(), ...options.config } });
  return laneOver(hub, { origin: hub.origin, fetch: hub.fetch });
}

/** The lane of `hub` as a client reaches it at `via` (in-process, or over the loopback). */
function laneOver(hub: FakeHub, via: { readonly origin: string; readonly fetch: FetchLike }): Lane {
  const token = hub.issueToken();
  const sdk: KernelClientOptions = { baseUrl: via.origin, fetch: via.fetch, headers: { 'x-client-version': CLIENT_VERSION }, auth: { mode: 'bearer', token: () => token } };
  const client = createClient(sdk);
  let ids = 0x7000;
  const stream = (chat: Chat, over: Partial<AiFeatureStreamBody> = {}): Promise<Response> =>
    hubCall(via.fetch, via.origin, 'aiFeatureStream', {
      feature: 'voice-script',
      body: { clientRequestId: uuid((ids += 1)), pageLabel: chat.pageLabel, platform: chat.platform, conversationRef: chat.chat, fanRef: chat.fan, draftText: 'hey, i missed you', replyTone: 'casual', messageCount: 100, ...over },
      capabilities: [],
    }, { token, clientVersion: CLIENT_VERSION });
  return {
    hub,
    sdk,
    stream,
    async script(chat, over = {}) {
      const response = await stream(chat, over);
      expect(response.status).toBe(200);
      const read = await readSse(response);
      expect(read.end).toBe('eof');
      return (read.frames[0] as { readonly requestId: string }).requestId;
    },
    body: (source, chat = OF, over = {}) => ({ clientRequestId: uuid((ids += 1)), conversationRef: chat.chat, fanRef: chat.fan, sourceGenerationRef: source, script: SCRIPT, ...over }),
    create: (chat, body) => client.voiceNoteCreate({ params: { pageLabel: chat.pageLabel }, body }),
    status: (chat, id) => client.voiceNoteStatus({ params: { pageLabel: chat.pageLabel, id } }),
    audio: (chat, id) => fetchVoiceNoteAudio(sdk, { pageLabel: chat.pageLabel, id }),
    async call(route, request, options = {}) {
      const response = await hubCall(via.fetch, via.origin, route, request, { token: options.token ?? token, clientVersion: CLIENT_VERSION, ...(options.signal === undefined ? {} : { signal: options.signal }) });
      return { status: response.status, body: (await response.json()) as unknown };
    },
  };
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const refusal = (status: number, error: string, reason?: string) => ({ status, body: expect.objectContaining({ error, statusCode: status, ...(reason === undefined ? {} : { reason }) }) as unknown });

describe('[fake hub] the voice-notes lane on both sites (hub HF-4а/б, #757)', () => {
  it.each([OF, FANSLY])('a take on $platform: 202 dispatched, then completed — its MP3 is the bytes the status names (sha256, length); the next take speaks another sample', async (chat) => {
    const h = lane();
    const source = await h.script(chat);
    const first = await h.create(chat, h.body(source, chat));
    expect(first).toEqual({ voiceNoteId: 1, state: 'dispatched', scriptChars: SCRIPT.length, billed: null, audioSha256: null, audioBytesLen: null, createdAt: expect.any(String) as unknown });
    const done = await h.status(chat, first.voiceNoteId);
    expect(done).toMatchObject({ voiceNoteId: 1, state: 'completed', billed: true });
    expect(done).not.toHaveProperty('errorCode');
    const response = await h.audio(chat, first.voiceNoteId);
    expect([response.status, response.headers.get('content-type'), response.headers.get('cache-control')]).toEqual([200, 'audio/mpeg', 'private, no-store']);
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([bytes.byteLength, Number(response.headers.get('content-length')), sha256(bytes)]).toEqual([done.audioBytesLen, done.audioBytesLen, done.audioSha256]);
    // An MP3 the studio can play: its ID3 tag, then MPEG audio frames.
    expect(new TextDecoder().decode(bytes.slice(0, 3))).toBe('ID3');
    const second = await h.status(chat, (await h.create(chat, h.body(source, chat))).voiceNoteId);
    expect(second.audioSha256).not.toBe(done.audioSha256);
    expect(h.hub.status().voiceNotes).toEqual([
      { voiceNoteId: 1, pageLabel: chat.pageLabel, clientRequestId: expect.any(String) as unknown, state: 'completed' },
      { voiceNoteId: 2, pageLabel: chat.pageLabel, clientRequestId: expect.any(String) as unknown, state: 'completed' },
    ]);
  });

  it('the samples: three spoken takes of the synthetic script, MP3s of a few seconds, each its own', () => {
    const samples = voiceAudioSamples();
    expect(samples.map((sample) => sample.name)).toEqual(['take-1.mp3', 'take-2.mp3', 'take-3.mp3']);
    expect(new Set(samples.map((sample) => sample.sha256)).size).toBe(3);
    for (const sample of samples) {
      expect([sample.name, sample.bytes.byteLength > 10_000 && sample.bytes.byteLength < 40_000, sample.sha256]).toEqual([sample.name, true, sha256(sample.bytes)]);
    }
  });

  it('a render runs on the hub clock, scaled by timeScale: dispatched until it ends; past two at once they wait queued; not ready is the 404 of no audio', async () => {
    const h = lane({ timeScale: 1 });
    const source = await h.script(OF);
    const [a, b, c] = [await h.create(OF, h.body(source)), await h.create(OF, h.body(source)), await h.create(OF, h.body(source))];
    expect([a.state, b.state, c.state]).toEqual(['dispatched', 'dispatched', 'queued']);
    expect((await h.status(OF, a.voiceNoteId)).state).toBe('dispatched');
    expect((await h.audio(OF, a.voiceNoteId)).status).toBe(404);
    h.hub.control({ op: 'clock', advanceMs: VOICE_RENDER_MS - 1 });
    expect((await h.status(OF, a.voiceNoteId)).state).toBe('dispatched');
    h.hub.control({ op: 'clock', advanceMs: 1 });
    expect([(await h.status(OF, a.voiceNoteId)).state, (await h.status(OF, c.voiceNoteId)).state]).toEqual(['completed', 'dispatched']);
    h.hub.control({ op: 'clock', advanceMs: VOICE_RENDER_MS });
    expect((await h.status(OF, c.voiceNoteId)).state).toBe('completed');
  });

  it('a replay: the same id with the same request answers the same note, admitted once; another request under the id is 409 idempotency_mismatch', async () => {
    const h = lane();
    const source = await h.script(OF);
    const request = h.body(source);
    const first = await h.create(OF, request);
    // The hub's canonical script: the same request, whatever its line ends and edges.
    const replay = await h.create(OF, { ...request, script: `  ${SCRIPT}\r\n` });
    expect([replay.voiceNoteId, replay.state]).toEqual([first.voiceNoteId, 'completed']);
    expect(h.hub.status().voiceNotes).toHaveLength(1);
    expect(await h.call('voiceNoteCreate', { pageLabel: OF.pageLabel, body: { ...request, script: 'Another text.' } })).toEqual(refusal(409, 'idempotency_mismatch'));
    // The hash holds the page: the id on another page of the user is another request.
    expect(await h.call('voiceNoteCreate', { pageLabel: WORLD.pages.vip.pageLabel, body: request })).toEqual(refusal(409, 'idempotency_mismatch'));
    expect(voiceRequestHash(WORLD.pages.one.pageId, OF.chat, source, canonicalVoiceScript(`  ${SCRIPT}\r\n`))).toBe(voiceRequestHash(WORLD.pages.one.pageId, OF.chat, source, SCRIPT));
  });

  it('a note is the user\'s and the page\'s: another user, another page or an unknown id read the same 404', async () => {
    const h = lane();
    const note = await h.create(OF, h.body(await h.script(OF)));
    expect(await h.call('voiceNoteStatus', { pageLabel: OF.pageLabel, voiceNoteId: 99 })).toEqual(refusal(404, 'not_found'));
    expect(await h.call('voiceNoteAudio', { pageLabel: OF.pageLabel, voiceNoteId: 99 })).toEqual(refusal(404, 'not_found'));
    expect(await h.call('voiceNoteStatus', { pageLabel: WORLD.pages.vip.pageLabel, voiceNoteId: note.voiceNoteId })).toEqual(refusal(404, 'not_found'));
    const other = h.hub.issueToken({ username: WORLD.otherUser.username });
    expect(await h.call('voiceNoteStatus', { pageLabel: OF.pageLabel, voiceNoteId: note.voiceNoteId }, { token: other })).toEqual(refusal(404, 'not_found'));
  });
});

describe('[fake hub] what the hub admits a render from (HF-4а)', () => {
  it('the script, by the hub\'s rules: 600 characters, no < or >, only its ten tags — the extension\'s list is the hub\'s', async () => {
    expect([...VOICE_TAGS]).toEqual(HUB_VOICE_TAGS);
    const h = lane();
    const source = await h.script(OF);
    for (const script of ['x'.repeat(601), 'Hi <b>you</b>', '[shouting] Hey you', '[Warmly] Hey you', '   ']) {
      expect([script.slice(0, 20), await h.call('voiceNoteCreate', { pageLabel: OF.pageLabel, body: h.body(source, OF, { script }) })]).toEqual([script.slice(0, 20), refusal(400, 'voice_script_invalid')]);
    }
    expect((await h.create(OF, h.body(source, OF, { script: `${HUB_VOICE_TAGS.join(' Hey. ')} Bye.` }))).state).toBe('dispatched');
    expect((await h.create(OF, h.body(source, OF, { script: 'x'.repeat(600) }))).scriptChars).toBe(600);
  });

  it('the source: a whole voice script of this user, page, chat and fan — anything else is 400 voice_source_invalid', async () => {
    const h = lane();
    const own = await h.script(OF);
    // A Reply of the same chat is no voice script.
    const fastReply = await hubCall(h.hub.fetch, h.hub.origin, 'aiFeatureStream', { feature: 'fast-reply', body: { clientRequestId: uuid(0x7f01), pageLabel: OF.pageLabel, platform: 'onlyfans', conversationRef: OF.chat, messageCount: 100 }, capabilities: [] }, { token: h.hub.issueToken(), clientVersion: CLIENT_VERSION });
    const replyRef = (await readSse(fastReply)).frames.map((frame) => frame as { type: string; requestId?: string }).find((frame) => frame.type === 'meta')?.requestId ?? '';
    const otherFan = await h.script({ ...OF, chat: WORLD.otherFan, fan: WORLD.otherFan });
    const otherPage = await h.script({ ...OF, pageLabel: WORLD.pages.vip.pageLabel });
    // Cut at the model's token ceiling, and broken off: neither is a whole script.
    const truncatedRef = uuid(0x7f02);
    const brokenRef = uuid(0x7f03);
    h.hub.control({
      op: 'scriptSse',
      feature: 'voice-script',
      responses: [
        { kind: 'stream', steps: [{ kind: 'frame', frame: meta('voice-script', { requestId: truncatedRef }) }, { kind: 'frame', frame: { type: 'content_delta', text: '[warmly] Hey' } }, { kind: 'frame', frame: { type: 'done', stopReason: 'max_tokens' } }, { kind: 'eof' }] },
        { kind: 'stream', steps: [{ kind: 'frame', frame: meta('voice-script', { requestId: brokenRef }) }, { kind: 'frame', frame: { type: 'content_delta', text: '[warmly] Hey' } }, { kind: 'reset' }] },
      ],
    });
    await readSse(await h.stream(OF));
    await readSse(await h.stream(OF));
    const other = h.hub.issueToken({ username: WORLD.otherUser.username });
    const othersOwn = await (async () => {
      const response = await hubCall(h.hub.fetch, h.hub.origin, 'aiFeatureStream', { feature: 'voice-script', body: { clientRequestId: uuid(0x7f04), pageLabel: OF.pageLabel, platform: 'onlyfans', conversationRef: OF.chat, fanRef: OF.fan, draftText: 'hi', messageCount: 100 }, capabilities: [] }, { token: other, clientVersion: CLIENT_VERSION });
      return ((await readSse(response)).frames[0] as { readonly requestId: string }).requestId;
    })();
    for (const [what, source] of [['unknown', uuid(0x7f05)], ['a Reply', replyRef], ['another fan\'s', otherFan], ['another page\'s', otherPage], ['truncated', truncatedRef], ['broken off', brokenRef], ['another user\'s', othersOwn]] as const) {
      expect([what, await h.call('voiceNoteCreate', { pageLabel: OF.pageLabel, body: h.body(source) })]).toEqual([what, refusal(400, 'voice_source_invalid')]);
    }
    // A control character in a ref: refused before the hash it would forge.
    expect(await h.call('voiceNoteCreate', { pageLabel: OF.pageLabel, body: h.body(own, OF, { conversationRef: `${OF.chat}\n` }) })).toEqual(refusal(400, 'voice_source_invalid'));
    expect((await h.create(OF, h.body(own))).state).toBe('dispatched');
  });

  it('OnlyFans, where the chat is the fan (hub #757): with or without the fan named again; a fan apart from the chat is 409 conversation_fan_mismatch — through the client its source names the chat as the fan, so it is refused there first', async () => {
    const h = lane();
    const source = await h.script(OF);
    const { fanRef: _named, ...plain } = h.body(source);
    expect((await h.create(OF, plain)).state).toBe('dispatched');
    expect((await h.create(OF, h.body(source))).state).toBe('dispatched');
    expect(await h.call('voiceNoteCreate', { pageLabel: OF.pageLabel, body: h.body(source, OF, { fanRef: WORLD.otherFan }) })).toEqual(refusal(400, 'voice_source_invalid'));

    // A source that names the chat and another fan passes the source check (an OnlyFans script never does): the render's own rule refuses it.
    const generation: Generation = {
      requestId: uuid(0x7f10), clientRequestId: uuid(0x7f11), feature: 'voice-script', pageLabel: OF.pageLabel, fanRef: WORLD.otherFan, conversationRef: OF.chat, userId: WORLD.user.userId, summaryMode: null,
      messageCount: 100, personaDefinitionId: null, startedAt: 0, completedAt: 1, outcome: 'done', text: SCRIPT, stopReason: 'end_turn', window: { requested: 100, served: 10 },
    };
    const input = { userId: WORLD.user.userId, now: 0, timeScale: 0, laneOff: false, generations: new Map([[generation.requestId, generation]]), pair: () => 'verified' as const };
    const body = { clientRequestId: uuid(0x7f12), conversationRef: OF.chat, fanRef: WORLD.otherFan, sourceGenerationRef: generation.requestId, script: SCRIPT };
    expect(new VoiceLane().create(body, { ...input, page: { pageId: WORLD.pages.one.pageId, pageLabel: OF.pageLabel, chatIsFan: true } })).toEqual({ kind: 'refuse', error: 'conversation_fan_mismatch' });
    // On Fansly the same pair is the capture's to judge.
    expect(new VoiceLane().create(body, { ...input, page: { pageId: WORLD.pages.fansly.pageId, pageLabel: OF.pageLabel, chatIsFan: false } })).toMatchObject({ kind: 'view', status: 202 });
  });

  it('Fansly: a group the page\'s capture holds as another fan\'s by now is 409 conversation_fan_mismatch; one it cannot vouch for is admitted', async () => {
    const h = lane();
    const source = await h.script(FANSLY);
    h.hub.control({ op: 'thread', pageLabel: FANSLY.pageLabel, conversationRef: FANSLY.chat, fanRef: WORLD.fansly.chats.b.fan });
    expect(await h.call('voiceNoteCreate', { pageLabel: FANSLY.pageLabel, body: h.body(source, FANSLY) })).toEqual(refusal(409, 'conversation_fan_mismatch'));
    h.hub.control({ op: 'thread', pageLabel: FANSLY.pageLabel, conversationRef: FANSLY.chat, fanRef: null });
    expect((await h.create(FANSLY, h.body(source, FANSLY))).state).toBe('dispatched');
  });
});

describe('[fake hub] what a test scripts of the lane (`scriptVoice`)', () => {
  it('the end of each render, and what the hub says of its billing', async () => {
    const h = lane();
    const source = await h.script(OF);
    h.hub.control({ op: 'scriptVoice', outcomes: ['failed_definite', 'failed_after_dispatch', 'indeterminate', 'slow', { outcome: 'completed', ms: 5_000 }] });
    expect(h.hub.status().script.voiceLeft).toBe(5);
    const ends: Awaited<ReturnType<Lane['status']>>[] = [];
    for (let n = 0; n < 5; n += 1) {
      const note = await h.create(OF, h.body(source));
      expect(note.state).toBe('dispatched');
      ends.push(await h.status(OF, note.voiceNoteId));
    }
    expect(ends.map(({ state, billed, audioSha256, errorCode }) => ({ state, billed, sha: audioSha256 !== null, errorCode }))).toEqual([
      { state: 'failed_definite', billed: false, sha: false, errorCode: 'voice_failed_definite' },
      { state: 'failed_after_dispatch', billed: null, sha: false, errorCode: 'voice_failed_after_dispatch' },
      { state: 'indeterminate', billed: null, sha: false, errorCode: 'voice_indeterminate' },
      { state: 'completed', billed: true, sha: true, errorCode: undefined },
      { state: 'completed', billed: true, sha: true, errorCode: undefined },
    ]);
    expect((await h.audio(OF, 1)).status).toBe(404);
    expect(h.hub.status().script.voiceLeft).toBe(0);
  });

  it('their time: indeterminate stays dispatched through the hub\'s lease, slow outlasts the studio\'s 45 s, `ms` sets its own', async () => {
    const at = async (outcome: Parameters<FakeHub['control']>[0], steps: readonly number[]): Promise<string[]> => {
      const h = lane({ timeScale: 1 });
      const source = await h.script(OF);
      h.hub.control(outcome);
      const note = await h.create(OF, h.body(source));
      const states: string[] = [];
      for (const step of steps) {
        h.hub.control({ op: 'clock', advanceMs: step });
        states.push((await h.status(OF, note.voiceNoteId)).state);
      }
      return states;
    };
    expect(await at({ op: 'scriptVoice', outcomes: ['indeterminate'] }, [VOICE_RENDER_MS, 120_000 - VOICE_RENDER_MS - 1, 1])).toEqual(['dispatched', 'dispatched', 'indeterminate']);
    expect(await at({ op: 'scriptVoice', outcomes: ['slow'] }, [45_000, 14_999, 1])).toEqual(['dispatched', 'dispatched', 'completed']);
    expect(await at({ op: 'scriptVoice', outcomes: [{ outcome: 'indeterminate', ms: 3_000 }] }, [2_999, 1])).toEqual(['dispatched', 'indeterminate']);
  });

  it('artifact_expired: the render completes, its audio is gone when asked for — 410, and the note says so from then', async () => {
    const h = lane();
    const source = await h.script(FANSLY);
    h.hub.control({ op: 'scriptVoice', outcomes: ['artifact_expired'] });
    const note = await h.create(FANSLY, h.body(source, FANSLY));
    const ready = await h.status(FANSLY, note.voiceNoteId);
    expect(ready).toMatchObject({ state: 'completed', billed: true });
    const audio = await h.audio(FANSLY, note.voiceNoteId);
    expect([audio.status, await audio.json()]).toEqual([410, expect.objectContaining({ error: 'artifact_expired', statusCode: 410 })]);
    expect(await h.status(FANSLY, note.voiceNoteId)).toEqual({ ...ready, state: 'artifact_expired', errorCode: 'artifact_expired' });
  });

  it('a refusal admits and charges nothing — 403, 503, 409 or 429 by its code —, and the same id may be admitted later', async () => {
    const h = lane();
    const source = await h.script(OF);
    const codes = [['voice_disabled', 403], ['voice_provider_unavailable', 503], ['voice_not_allowlisted', 403], ['voice_no_profile', 409], ['voice_quota_denied', 429]] as const;
    h.hub.control({ op: 'scriptVoice', outcomes: codes.map(([code]) => code) });
    const request = h.body(source);
    for (const [code, status] of codes) expect(await h.call('voiceNoteCreate', { pageLabel: OF.pageLabel, body: request })).toEqual(refusal(status, code));
    expect(h.hub.status().voiceNotes).toEqual([]);
    expect((await h.create(OF, request)).voiceNoteId).toBe(1);
  });

  it('each outcome waits for the create that gets as far as its place: a switch\'s before the script is read, the budget\'s after the source; a replay is never one', async () => {
    const h = lane();
    const source = await h.script(OF);
    const admitted = h.body(source);
    await h.create(OF, admitted);
    h.hub.control({ op: 'scriptVoice', outcomes: ['voice_quota_denied', 'voice_disabled', 'failed_definite'] });
    // A replay runs no admission gate and uses nothing scripted.
    expect((await h.create(OF, admitted)).voiceNoteId).toBe(1);
    // The script is refused before the budget is asked: the budget's refusal waits for the next.
    expect(await h.call('voiceNoteCreate', { pageLabel: OF.pageLabel, body: h.body(source, OF, { script: '[shouting] Hey' }) })).toEqual(refusal(400, 'voice_script_invalid'));
    expect(await h.call('voiceNoteCreate', { pageLabel: OF.pageLabel, body: h.body(source) })).toEqual(refusal(429, 'voice_quota_denied'));
    // The switch is asked before the script: even a script the hub would refuse meets it.
    expect(await h.call('voiceNoteCreate', { pageLabel: OF.pageLabel, body: h.body(source, OF, { script: '[shouting] Hey' }) })).toEqual(refusal(403, 'voice_disabled'));
    const failed = await h.create(OF, h.body(source));
    expect((await h.status(OF, failed.voiceNoteId)).state).toBe('failed_definite');
    // clearScripts drops what is left.
    h.hub.control({ op: 'scriptVoice', outcomes: ['voice_disabled'] });
    h.hub.control({ op: 'clearScripts' });
    expect([h.hub.status().script.voiceLeft, (await h.create(OF, h.body(source))).state]).toEqual([0, 'dispatched']);
  });

  it('a lost answer: `drop` fails the fetch like a broken connection while the render goes on — the same id finds it, charged once; `hang` answers nothing until the client gives up', async () => {
    const h = lane();
    const source = await h.script(OF);
    h.hub.control({ op: 'scriptVoice', outcomes: ['drop', 'hang'] });
    const dropped = h.body(source);
    const lost = await h.create(OF, dropped).catch((error: unknown) => error);
    expect(lost).toBeInstanceOf(KernelApiError);
    expect(lost).toMatchObject({ category: 'network', code: 'network_error' });
    // «Проверить»: the same id again — the note the hub admitted, nothing new charged.
    expect(await h.create(OF, dropped)).toMatchObject({ voiceNoteId: 1, state: 'completed', billed: true });
    const controller = new AbortController();
    const hung = h.call('voiceNoteCreate', { pageLabel: OF.pageLabel, body: h.body(source) }, { signal: controller.signal });
    await vi.waitFor(() => expect(h.hub.status().voiceNotes).toHaveLength(2));
    controller.abort();
    await expect(hung).rejects.toMatchObject({ name: 'AbortError' });
    expect(h.hub.read().entries.filter((entry) => entry.route === 'voiceNoteCreate').map((entry) => [entry.status, entry.reason])).toEqual([[0, 'connection_dropped'], [202, null], [0, 'no_answer']]);
    expect(h.hub.violations()).toEqual([]);
  });

  it('a lost answer over the loopback: the server closes the socket with no answer — a drop at once, a hang once the client gives up', async () => {
    const server = await startFakeHub({ routeSchemas, streamBodySchema: routeSchemas.aiFeatureStream.body, timeScale: 0, config: fanslyPageFlags() });
    try {
      const h = laneOver(server.hub, { origin: server.origin, fetch: (input, init) => fetch(input, init) });
      const source = await h.script(FANSLY);
      server.hub.control({ op: 'scriptVoice', outcomes: ['drop', 'hang'] });
      await expect(h.call('voiceNoteCreate', { pageLabel: FANSLY.pageLabel, body: h.body(source, FANSLY) })).rejects.toThrow(TypeError);
      const controller = new AbortController();
      const hung = h.call('voiceNoteCreate', { pageLabel: FANSLY.pageLabel, body: h.body(source, FANSLY) }, { signal: controller.signal });
      await vi.waitFor(() => expect(server.hub.status().voiceNotes).toHaveLength(2));
      controller.abort();
      await expect(hung).rejects.toMatchObject({ name: 'AbortError' });
      expect((await h.status(FANSLY, 2)).state).toBe('completed');
    } finally {
      await server.close();
    }
  });

  it('the command is checked: an unknown outcome or field is the test\'s error', () => {
    const h = createFakeHub({ routeSchemas });
    expect(() => h.control({ op: 'scriptVoice', outcomes: ['quota'] } as never)).toThrow(/scriptVoice\.outcomes is not valid/);
    expect(() => h.control({ op: 'scriptVoice', outcomes: [{ outcome: 'slow', ms: -1 }] })).toThrow(/not valid/);
    expect(() => h.control({ op: 'scriptVoice', outcomes: [{ outcome: 'slow', after: 5 }] } as never)).toThrow(/not valid/);
    expect(() => h.control({ op: 'scriptVoice' } as never)).toThrow(/needs «outcomes»/);
    expect(h.control({ op: 'scriptVoice', outcomes: ['slow', { outcome: 'drop' }] })).toEqual({ ok: true, outcomes: 2 });
  });
});

describe('[fake hub] the lane\'s gates', () => {
  it('the stand\'s pages have it: `voice` on both sites\' pages, `voice-notes-v1` served, the lane serving them', async () => {
    const h = lane();
    const bootstrap = await createClient(h.sdk).clientBootstrap();
    expect(bootstrap.capabilities).toContain('voice-notes-v1');
    expect(bootstrap.pages.map((page) => [page.pageLabel, page.features['voice']])).toEqual([
      [WORLD.pages.one.pageLabel, { available: true }],
      [WORLD.pages.vip.pageLabel, { available: true }],
      [WORLD.pages.fansly.pageLabel, { available: true }],
    ]);
  });

  it('a narrow token, on every call: the page granted (409 not_granted), its `voice`, the served capability, the version; a full token is asked for none of them', async () => {
    const h = lane();
    const note = await h.create(OF, h.body(await h.script(OF)));
    const status = { pageLabel: OF.pageLabel, voiceNoteId: note.voiceNoteId };
    h.hub.control({ op: 'config', patch: pilotPageFlags({ voice: false }) });
    for (const route of ['voiceNoteStatus', 'voiceNoteAudio'] as const) expect(await h.call(route, status)).toEqual(refusal(409, 'client_feature_disabled', 'flag_off'));
    const full = h.hub.issueToken({ client: null });
    expect((await h.call('voiceNoteStatus', status, { token: full })).status).toBe(200);
    h.hub.control({ op: 'config', patch: { ...pilotPageFlags({ voice: true }), capabilities: PILOT_CAPABILITIES.filter((capability) => capability !== 'voice-notes-v1') } });
    expect(await h.call('voiceNoteStatus', status)).toEqual(refusal(409, 'client_feature_disabled', 'hub_not_ready'));
    h.hub.control({ op: 'config', patch: { capabilities: PILOT_CAPABILITIES, minVersion: '9.0.0' } });
    expect(await h.call('voiceNoteStatus', status)).toEqual(refusal(409, 'client_feature_disabled', 'client_outdated'));
    h.hub.control({ op: 'config', patch: { minVersion: '0.1.0' } });
    h.hub.control({ op: 'grantPages', username: WORLD.user.username, pages: [WORLD.pages.fansly.pageLabel] });
    expect(await h.call('voiceNoteStatus', status)).toEqual(refusal(409, 'client_feature_disabled', 'not_granted'));
    expect(await h.call('voiceNoteStatus', status, { token: full })).toEqual(refusal(404, 'not_found'));
  });

  it('the lane off for a page: `lane_off` in its bootstrap, its voice script gate_voice_disabled, a fresh create voice_disabled — what was admitted stays readable and replayable', async () => {
    const h = lane();
    const source = await h.script(OF);
    const admitted = h.body(source);
    const note = await h.create(OF, admitted);
    h.hub.control({ op: 'config', patch: { voiceLaneOff: [OF.pageLabel] } });
    const bootstrap = await createClient(h.sdk).clientBootstrap();
    expect(bootstrap.pages.find((page) => page.pageLabel === OF.pageLabel)?.features['voice']).toEqual({ available: false, reason: 'lane_off' });
    const stream = await h.stream(OF);
    expect([stream.status, ((await stream.json()) as { error: string }).error]).toEqual([400, 'gate_voice_disabled']);
    expect(await h.call('voiceNoteCreate', { pageLabel: OF.pageLabel, body: h.body(source) })).toEqual(refusal(403, 'voice_disabled'));
    expect((await h.create(OF, admitted)).voiceNoteId).toBe(note.voiceNoteId);
    expect((await h.status(OF, note.voiceNoteId)).state).toBe('completed');
    expect((await h.audio(OF, note.voiceNoteId)).status).toBe(200);
    // The other site's page is served as before.
    expect((await h.create(FANSLY, h.body(await h.script(FANSLY), FANSLY))).state).toBe('dispatched');
  });

  it('the hub\'s own schemas: a malformed id, a body that is no create, a query — 400 before anything is read', async () => {
    const h = lane();
    const source = await h.script(OF);
    const raw = (path: string, init: RequestInit = {}): Promise<Response> => h.hub.fetch(`${h.hub.origin}${path}`, { ...init, headers: { authorization: `Bearer ${h.hub.issueToken()}`, 'x-client-version': CLIENT_VERSION, ...(init.headers as Record<string, string> | undefined) } });
    expect((await raw(`/api/v1/pages/${OF.pageLabel}/voice-notes/abc`)).status).toBe(400);
    expect((await raw(`/api/v1/pages/${OF.pageLabel}/voice-notes/0/audio`)).status).toBe(400);
    expect((await raw(`/api/v1/pages/${OF.pageLabel}/voice-notes/1?x=1`)).status).toBe(400);
    expect((await raw(`/api/v1/pages/${OF.pageLabel}/voice-notes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...h.body(source), clientRequestId: 'take-1' }) })).status).toBe(400);
    expect((await raw(`/api/v1/pages/${OF.pageLabel}/voice-notes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...h.body(source), extra: true }) })).status).toBe(400);
    expect(h.hub.violations().map((entry) => entry.status)).toEqual([400, 400, 400, 400, 400]);
  });
});

describe('[fake hub] the voice script\'s gate on both sites (ai-rules.ts, hub #757)', () => {
  const body = (over: Partial<AiFeatureStreamBody> & { readonly clientContext?: unknown }) => ({ platform: 'onlyfans' as const, conversationRef: OF.chat, fanRef: OF.fan, ...over });

  it('a page of the lane\'s platforms; the fan always named, and wherever no pair is checked the chat itself; then the lane\'s switch', () => {
    expect(voiceScriptRefusal(body({}), false)).toBeNull();
    expect(voiceScriptRefusal(body({ fanRef: WORLD.otherFan }), false)).toBe('gate_voice_identity_required');
    expect(voiceScriptRefusal(body({ fanRef: null }), false)).toBe('gate_voice_identity_required');
    expect(voiceScriptRefusal(body({ fanRef: undefined }), false)).toBe('gate_voice_identity_required');
    expect(voiceScriptRefusal(body({ platform: 'fansly', conversationRef: FANSLY.chat, fanRef: FANSLY.fan }), false)).toBeNull();
    expect(voiceScriptRefusal(body({ platform: 'fansly', conversationRef: FANSLY.chat, fanRef: FANSLY.fan, clientContext: {} }), false)).toBe('gate_voice_identity_required');
    expect(voiceScriptRefusal(body({ platform: 'fansly', conversationRef: FANSLY.fan, fanRef: FANSLY.fan, clientContext: {} }), false)).toBeNull();
    expect(voiceScriptRefusal(body({}), true)).toBe('gate_voice_disabled');
    expect(voiceScriptRefusal({ ...body({}), platform: 'reddit' as never }, false)).toBe('gate_voice_unsupported_platform');
  });

  it('through the hub: OnlyFans now writes a script for its fan; another fan named is 400 gate_voice_identity_required; the page\'s `voice` decides a narrow token\'s', async () => {
    const h = lane();
    expect(await h.script(OF)).toMatch(/^[0-9a-f-]{36}$/);
    const other = await h.stream(OF, { fanRef: WORLD.otherFan });
    expect([other.status, ((await other.json()) as { error: string }).error]).toEqual([400, 'gate_voice_identity_required']);
    h.hub.control({ op: 'config', patch: pilotPageFlags({ voice: false }) });
    const off = await h.stream(OF);
    expect([off.status, (await off.json()) as unknown]).toEqual([409, expect.objectContaining({ error: 'client_feature_disabled', reason: 'flag_off' })]);
  });
});

describe('[fake hub] the voice routes on the wire', () => {
  it('our facade requests are the SDK\'s: the create\'s body nested, the note\'s id an integer path param; the journal keeps the ids, never the script', async () => {
    const body = { clientRequestId: uuid(0x7f20), conversationRef: OF.chat, fanRef: OF.fan, sourceGenerationRef: uuid(0x7f21), script: SCRIPT };
    const create = wireOf('voiceNoteCreate', { pageLabel: OF.pageLabel, body });
    expect([create.method, create.path, JSON.parse(create.body ?? '')]).toEqual(['POST', `/api/v1/pages/${OF.pageLabel}/voice-notes`, body]);
    expect([wireOf('voiceNoteStatus', { pageLabel: OF.pageLabel, voiceNoteId: 7 }).path, wireOf('voiceNoteAudio', { pageLabel: OF.pageLabel, voiceNoteId: 7 }).path]).toEqual([
      `/api/v1/pages/${OF.pageLabel}/voice-notes/7`,
      `/api/v1/pages/${OF.pageLabel}/voice-notes/7/audio`,
    ]);
    expect(matchRoute('GET', `/api/v1/pages/${OF.pageLabel}/voice-notes/7/audio`)).toEqual({ kind: 'route', route: 'voiceNoteAudio', params: { pageLabel: OF.pageLabel, id: '7' } });
    expect(facadeRequestOf('voiceNoteStatus', { params: { pageLabel: OF.pageLabel, id: '7' }, query: new URLSearchParams(), bodyText: '', contentType: null, capabilitiesHeader: null })).toEqual({ ok: true, request: { pageLabel: OF.pageLabel, voiceNoteId: 7 } });
    expect(routeSchemas.voiceNoteCreate.body.safeParse(body).success).toBe(true);
    expect(routeSchemas.voiceNoteStatus.params.safeParse({ pageLabel: OF.pageLabel, id: '7' }).success).toBe(true);

    const h = lane();
    const source = await h.script(OF);
    const request = h.body(source);
    await h.create(OF, request);
    const [entry] = h.hub.read().entries.filter((call) => call.route === 'voiceNoteCreate');
    expect(entry?.request).toEqual({ pageLabel: OF.pageLabel, body: { ...request, script: `‹${SCRIPT.length} chars›` } });
  });
});
