// The fake hub for Fansly (R20 P6c1; docs/project-unite/plan.md, architecture
// §11.1, §13), against the deployed hub bd3eec06 — the commit production runs
// and the SDK is vendored from:
// - the Fansly world: the page is the stand's creator, its chats the stand's;
//   ids are 18-digit strings above 2^53 (17 for an old account), and a chat's
//   group is never its fan (FS-ACC-1);
// - the switches by platform (HF-2): a Fansly page is on only by its own row,
//   never by `"*"`, and each switch needs on Fansly what the hub's table says;
// - the narrow token's AI switch by platform (client-ai-switch.ts);
// - the pair `groupId ↔ fanRef` (HF-9): the page's capture of the group decides,
//   for a generation and for a read;
// - the window check (HF-8в): the fake hub answers every hub case of the matrix
//   the hub and this client share exactly as the hub does, one answer per id,
//   and refuses every request the hub refuses — through the vendored SDK's own
//   schemas.

import { readFileSync } from 'node:fs';

import { CLIENT_FEATURE_FLAG_NAMES, CLIENT_HUB_CAPABILITY_NAMES, HUB_ERROR_STATUSES, coverageCheckVerdict, narrowCoverageCheck, type AiFeatureStreamBody, type Bootstrap, type BootstrapPage, type HubAiFeature } from '@cg/contracts';
import {
  CLIENT_FEATURE_FLAG_NAMES as SDK_FLAG_NAMES,
  CLIENT_HUB_CAPABILITY_NAMES as SDK_CAPABILITY_NAMES,
  routeSchemas,
  streamAiFeature,
} from '@kernel/sdk';
import { beforeEach, describe, expect, it } from 'vitest';

import { createWorld, standIds } from '../../fixture-fansly/src/data';
import { HUB_FEATURE_REQUIREMENTS, WORLD, hubFeatureNeedsOn, streamBody, uuid } from '../scenarios/hub';
import { aiFeatureExistsOn, aiFeatureFlag, classifyPair, resolveCoverageCheck, type CoverageCheckAnswer, type CoverageCheckAsked, type StoreState } from './ai-rules';
import { FAKE_PAGES, FANSLY_PAGE_FLAGS, PILOT_CAPABILITIES, fanslyPageFlags, featureVerdict, pilotPageFlags } from './config';
import { createFakeHub, type FakeHub } from './hub';
import { hubCall, readSse } from './kit';

const FANSLY = WORLD.pages.fansly.pageLabel;
const { a: A, b: B } = WORLD.fansly.chats;
const OLD = WORLD.fansly.old;

let hub: FakeHub;
let token: string;
let seq = 0;

/** A Fansly body: the page's group and its fan, apart. */
const fanslyBody = (over: Partial<AiFeatureStreamBody> = {}): AiFeatureStreamBody =>
  streamBody({ clientRequestId: uuid(0xf000 + ++seq), pageLabel: FANSLY, platform: 'fansly', conversationRef: A.group, fanRef: A.fan, ...over });
const stream = (feature: HubAiFeature, body: AiFeatureStreamBody, capabilities: string[] = ['context-v1'], on: FakeHub = hub, as: string = token): Promise<Response> =>
  hubCall(on.fetch, on.origin, 'aiFeatureStream', { feature, body, capabilities }, { token: as });
const refusal = async (response: Response): Promise<{ status: number; error: string; reason?: string }> => {
  const body = (await response.json()) as { error: string; reason?: string };
  return body.reason === undefined ? { status: response.status, error: body.error } : { status: response.status, error: body.error, reason: body.reason };
};
type Frame = Record<string, unknown> & { type: string };
const contextOf = async (response: Response): Promise<Frame> => {
  expect(response.status).toBe(200);
  const frames = (await readSse(response)).frames as Frame[];
  const context = frames.find((frame) => frame.type === 'context_v1');
  if (context === undefined) throw new Error('no context_v1 frame');
  return context;
};
const bootstrapPage = async (pageLabel: string = FANSLY, on: FakeHub = hub): Promise<BootstrapPage> => {
  const boot = (await (await hubCall(on.fetch, on.origin, 'clientBootstrap', null, { token })).json()) as Bootstrap;
  const page = boot.pages.find((candidate) => candidate.pageLabel === pageLabel);
  if (page === undefined) throw new Error(`no page ${pageLabel}`);
  return page;
};
const featuresOf = (page: BootstrapPage, flags: readonly string[]): Record<string, unknown> => Object.fromEntries(flags.map((flag) => [flag, page.features[flag]]));
const OFF = (reason: string) => ({ available: false, reason });
const ON = { available: true };
const quota = (): number | null => hub.config().quotaRequestsToday;

beforeEach(() => {
  hub = createFakeHub();
  token = hub.issueToken();
});

describe('[host:fansly] the Fansly world of the fake hub: ids as Fansly makes them', () => {
  it('the page is the stand’s creator and its chats are the stand’s, so a stand tab and the hub name the same chats', () => {
    const stand = standIds(createWorld());
    expect(WORLD.pages.fansly.platformAccountId).toBe(stand.creator);
    expect([A.group, B.group]).toEqual(stand.groups.slice(0, 2));
    expect([A.fan, B.fan]).toEqual([stand.fans[A.group], stand.fans[B.group]]);
    // The old fan's chat is not one of the stand's: its group is the hub's alone.
    expect(createWorld().byId.has(OLD.group)).toBe(false);
  });

  it('ids are strings of 18 digits above 2^53 (17 for an old account); a chat’s group is never its fan; neighbours `Number()` merges stay two', () => {
    for (const id of [WORLD.pages.fansly.platformAccountId, A.group, A.fan, B.group, B.fan, OLD.group, WORLD.fansly.twinFan]) {
      expect(id).toMatch(/^[1-9]\d{17}$/);
      expect(BigInt(id) > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);
    }
    for (const id of [OLD.fan, WORLD.fansly.oldCreator]) expect(id).toMatch(/^[1-9]\d{16}$/);
    for (const chat of [A, B, OLD]) expect(chat.group).not.toBe(chat.fan);
    // HF-8а: two fans one double apart.
    expect(Number(WORLD.fansly.twinFan)).toBe(Number(A.fan));
    expect(WORLD.fansly.twinFan).not.toBe(A.fan);
  });

  it('the hub’s names of switches and capabilities are the vendored SDK’s', () => {
    expect(CLIENT_FEATURE_FLAG_NAMES).toEqual(SDK_FLAG_NAMES);
    expect([...CLIENT_HUB_CAPABILITY_NAMES].sort()).toEqual([...SDK_CAPABILITY_NAMES].sort());
    // Every switch of the SDK is in the hub's table, on at least one platform.
    for (const flag of CLIENT_FEATURE_FLAG_NAMES) expect(Object.keys(HUB_FEATURE_REQUIREMENTS[flag]).length, flag).toBeGreaterThan(0);
  });
});

describe('[host:fansly] the switches by platform (hub HF-2)', () => {
  const NOT_ON_FANSLY = CLIENT_FEATURE_FLAG_NAMES.filter((flag) => !FANSLY_PAGE_FLAGS.includes(flag));

  it('without a row of its own a Fansly page reads flag_off for every switch Fansly has, platform_unsupported for the rest — whatever `"*"` says', async () => {
    expect(NOT_ON_FANSLY).toEqual(['stats', 'previewSend', 'previewSendMarkAiGenerated', 'navigation', 'wsTap']);
    const expected = { ...Object.fromEntries(FANSLY_PAGE_FLAGS.map((flag) => [flag, OFF('flag_off')])), ...Object.fromEntries(NOT_ON_FANSLY.map((flag) => [flag, OFF('platform_unsupported')])) };
    // The default hub: the pilot as the owner runs it, a row per OnlyFans page and none for Fansly (as production).
    expect(featuresOf(await bootstrapPage(), CLIENT_FEATURE_FLAG_NAMES)).toEqual(expected);
    // Every switch on in `"*"`: an OnlyFans page takes it, the Fansly page does not.
    hub.control({ op: 'config', patch: { flags: Object.fromEntries(CLIENT_FEATURE_FLAG_NAMES.map((flag) => [flag, true])) } });
    expect(featuresOf(await bootstrapPage(), CLIENT_FEATURE_FLAG_NAMES)).toEqual(expected);
    expect((await bootstrapPage(WORLD.pages.vip.pageLabel)).features['previewSend']).toEqual(ON);
    hub.control({ op: 'preset', name: 'pilot-on' });
    expect(featuresOf(await bootstrapPage(), CLIENT_FEATURE_FLAG_NAMES)).toEqual(expected);
  });

  it('its own row switches it on, flag by flag; the row decides both ways', async () => {
    hub.control({ op: 'config', patch: fanslyPageFlags() });
    expect(featuresOf(await bootstrapPage(), FANSLY_PAGE_FLAGS)).toEqual(Object.fromEntries(FANSLY_PAGE_FLAGS.map((flag) => [flag, ON])));
    expect(featuresOf(await bootstrapPage(), NOT_ON_FANSLY)).toEqual(Object.fromEntries(NOT_ON_FANSLY.map((flag) => [flag, OFF('platform_unsupported')])));
    // A row naming a switch off wins over a `"*"` that has it on.
    hub.control({ op: 'config', patch: { flags: { review: true }, ...fanslyPageFlags({ drafts: false, review: false }) } });
    expect(featuresOf(await bootstrapPage(), ['drafts', 'review', 'coach'])).toEqual({ drafts: OFF('flag_off'), review: OFF('flag_off'), coach: ON });
  });

  it('each switch needs on Fansly what the hub’s Fansly column says: Recap and the preview read by conversation, «Новые» are the manual greeting', async () => {
    // The OnlyFans pilot rows have «Новые» on already; the Fansly page gets its own row.
    hub.control({ op: 'config', patch: fanslyPageFlags() });
    const without = async (missing: string): Promise<{ fansly: Record<string, unknown>; onlyfans: Record<string, unknown> }> => {
      hub.control({ op: 'config', patch: { capabilities: PILOT_CAPABILITIES.filter((capability) => capability !== missing) } });
      return { fansly: featuresOf(await bootstrapPage(), ['recap', 'preview', 'newcomers']), onlyfans: featuresOf(await bootstrapPage(WORLD.pages.one.pageLabel), ['recap', 'preview', 'newcomers']) };
    };
    expect(await without('conversation-recaps-v1')).toEqual({ fansly: { recap: OFF('hub_not_ready'), preview: OFF('hub_not_ready'), newcomers: ON }, onlyfans: { recap: ON, preview: ON, newcomers: ON } });
    expect(await without('audience-new-v1')).toEqual({ fansly: { recap: ON, preview: ON, newcomers: ON }, onlyfans: { recap: ON, preview: ON, newcomers: OFF('hub_not_ready') } });
    expect(await without('manual-greeting-v1')).toEqual({ fansly: { recap: ON, preview: ON, newcomers: OFF('hub_not_ready') }, onlyfans: { recap: ON, preview: ON, newcomers: ON } });
    expect((await without('voice-notes-v1')).fansly).toEqual({ recap: ON, preview: ON, newcomers: ON });
    expect((await bootstrapPage()).features['voice']).toEqual(OFF('hub_not_ready'));
    expect(hubFeatureNeedsOn('newcomers', 'fansly')?.capabilities).not.toContain('audience-new-v1');
  });

  it('`voice` runs on the hub’s voice-notes lane: where the lane does not serve the page the bootstrap reads `lane_off` (HF-4б)', async () => {
    hub.control({ op: 'config', patch: fanslyPageFlags({ voice: true }) });
    expect((await bootstrapPage()).features['voice']).toEqual(ON);
    hub.control({ op: 'config', patch: { voiceLaneOff: [FANSLY] } });
    expect((await bootstrapPage()).features['voice']).toEqual(OFF('lane_off'));
    // The lane is asked only of a feature the evaluation offers.
    hub.control({ op: 'config', patch: fanslyPageFlags({ voice: false }) });
    expect((await bootstrapPage()).features['voice']).toEqual(OFF('flag_off'));
  });

  it('every page lists every contract flag; platform_unsupported precedes the master switch, as on the deployed hub', async () => {
    const own = ['drafts', 'voice', 'notesFill', 'notes', 'vault', 'registration'];
    hub.control({ op: 'config', patch: pilotPageFlags({ drafts: true, voice: true, notes: true }) });
    hub.control({ op: 'config', patch: fanslyPageFlags() });
    for (const master of [false, true]) {
      hub.control({ op: 'config', patch: { master } });
      const fansly = await bootstrapPage();
      expect(featuresOf(fansly, FANSLY_PAGE_FLAGS)).toEqual(Object.fromEntries(FANSLY_PAGE_FLAGS.map((flag) => [flag, master ? ON : OFF('disabled')])));
      expect(featuresOf(fansly, NOT_ON_FANSLY)).toEqual(Object.fromEntries(NOT_ON_FANSLY.map((flag) => [flag, OFF('platform_unsupported')])));
      for (const page of FAKE_PAGES) {
        const boot = await bootstrapPage(page.pageLabel);
        expect(Object.keys(boot.features)).toEqual(CLIENT_FEATURE_FLAG_NAMES);
        if (page.platform === 'onlyfans') {
          expect(featuresOf(boot, own)).toEqual(Object.fromEntries(own.map((flag) => [flag, OFF('platform_unsupported')])));
          expect(own.map((flag) => featureVerdict(hub.config(), page, flag))).toEqual(own.map(() => OFF('platform_unsupported')));
        }
      }
    }
  });

  it('a Fansly page binds by its own account id: unlinked, an OnlyMonster binding names no Fansly page (binding_missing) and the bootstrap drops it', async () => {
    hub.control({ op: 'config', patch: fanslyPageFlags() });
    hub.control({ op: 'pageAccount', pageLabel: FANSLY, platformAccountId: null });
    hub.control({ op: 'config', patch: { bindingsByHost: { 'onlymonster:1001': WORLD.pages.one.pageId, 'onlymonster:9001': WORLD.pages.fansly.pageId } } });
    expect((await bootstrapPage()).features['insertion']).toEqual(OFF('binding_missing'));
    const boot = (await (await hubCall(hub.fetch, hub.origin, 'clientBootstrap', null, { token })).json()) as Bootstrap;
    expect(boot.bindingsByHost).toEqual({ 'onlymonster:1001': WORLD.pages.one.pageId });
  });

  it('an old account: the page linked to a 17-digit creator is served with that id, exactly', async () => {
    hub.control({ op: 'config', patch: fanslyPageFlags() });
    hub.control({ op: 'pageAccount', pageLabel: FANSLY, platformAccountId: WORLD.fansly.oldCreator });
    const page = await bootstrapPage();
    expect([page.platformAccountId, page.features['drafts']]).toEqual([WORLD.fansly.oldCreator, ON]);
  });

  it('the routes: Fansly’s reads wait for its own row; the hub’s list of new subscribers and the statistics are not Fansly’s', async () => {
    const read = { pageLabel: FANSLY, fanRef: A.fan, conversationRef: A.group };
    expect(await refusal(await hubCall(hub.fetch, hub.origin, 'clientConversationFeed', read, { token }))).toEqual({ status: 409, error: 'client_feature_disabled', reason: 'flag_off' });
    hub.control({ op: 'config', patch: fanslyPageFlags() });
    expect((await hubCall(hub.fetch, hub.origin, 'clientConversationFeed', read, { token })).status).toBe(200);
    expect((await hubCall(hub.fetch, hub.origin, 'clientConversationRecaps', read, { token })).status).toBe(200);
    // «Новые» on: the hub's list still is OnlyFans' alone (hub `clientFeatureNeedsOn`) — Fansly finds its own.
    expect(await refusal(await hubCall(hub.fetch, hub.origin, 'clientAudienceNew', { pageLabel: FANSLY, windowHours: 48 }, { token }))).toEqual({
      status: 409,
      error: 'client_feature_disabled',
      reason: 'platform_unsupported',
    });
    expect(await refusal(await hubCall(hub.fetch, hub.origin, 'clientSpenderStats', { pageLabel: FANSLY, windowDays: 30, timeZone: 'UTC' }, { token }))).toEqual({
      status: 409,
      error: 'client_feature_disabled',
      reason: 'platform_unsupported',
    });
  });
});

describe('[host:fansly] the narrow token’s AI on Fansly (hub client-ai-switch.ts)', () => {
  it('Reply, Fix, Hi and Ping wait for the page’s `drafts`; Coach, Recap and Review for their own switches; OnlyFans keeps the master switch', async () => {
    const draft = (feature: HubAiFeature): AiFeatureStreamBody => fanslyBody(feature === 'improve-draft' ? { draftText: 'my draft' } : feature === 'hi-greeting' ? { conversationRef: B.group, fanRef: B.fan } : {});
    const left = quota();
    for (const feature of ['fast-reply', 'improve-draft', 'hi-greeting', 'ping'] as const) {
      expect([feature, await refusal(await stream(feature, draft(feature)))]).toEqual([feature, { status: 409, error: 'client_feature_disabled', reason: 'flag_off' }]);
    }
    expect(await refusal(await stream('coach-chat', fanslyBody({ chatterQuestion: 'What now?' })))).toEqual({ status: 409, error: 'client_feature_disabled', reason: 'flag_off' });
    expect(quota()).toBe(left);
    hub.control({ op: 'config', patch: fanslyPageFlags({ drafts: true }) });
    for (const feature of ['fast-reply', 'improve-draft', 'hi-greeting', 'ping'] as const) expect([feature, (await stream(feature, draft(feature))).status]).toEqual([feature, 200]);
    expect(await refusal(await stream('chat-review', fanslyBody()))).toEqual({ status: 409, error: 'client_feature_disabled', reason: 'flag_off' });
    hub.control({ op: 'config', patch: fanslyPageFlags({ review: true, coach: true }) });
    expect((await stream('chat-review', fanslyBody())).status).toBe(200);
    expect((await stream('coach-chat', fanslyBody({ chatterQuestion: 'What now?' }))).status).toBe(200);
    // On OnlyFans `drafts` does not exist: a Reply there waits for the master switch alone.
    expect((await stream('fast-reply', streamBody({ clientRequestId: uuid(0xf900) }))).status).toBe(200);
    hub.control({ op: 'config', patch: { master: false } });
    expect(await refusal(await stream('fast-reply', fanslyBody()))).toEqual({ status: 409, error: 'client_feature_disabled', reason: 'disabled' });
    expect(await refusal(await stream('fast-reply', streamBody({ clientRequestId: uuid(0xf901) })))).toEqual({ status: 409, error: 'client_feature_disabled', reason: 'disabled' });
  });

  it('the switch’s table: Help is not the extension’s on Fansly; the voice script and the notes fill have their own switches there and none on OnlyFans', () => {
    const exists = (flag: string, platform: string): boolean => hubFeatureNeedsOn(flag, platform) !== undefined;
    expect([aiFeatureExistsOn('help-me', 'fansly'), aiFeatureExistsOn('help-me', 'onlyfans'), aiFeatureExistsOn('fast-reply', 'fansly')]).toEqual([false, true, true]);
    expect(['fast-reply', 'improve-draft', 'hi-greeting', 'ping', 'voice-script', 'fan-notes-fill', 'coach-chat', 'fan-summary', 'chat-review', 'help-me'].map((feature) => aiFeatureFlag(feature, 'fansly', exists))).toEqual([
      'drafts',
      'drafts',
      'drafts',
      'drafts',
      'voice',
      'notesFill',
      'coach',
      'recap',
      'review',
      null,
    ]);
    expect(['fast-reply', 'voice-script', 'fan-notes-fill', 'coach-chat'].map((feature) => aiFeatureFlag(feature, 'onlyfans', exists))).toEqual([null, null, null, 'coach']);
  });

  it('a body naming another platform than its page’s finds no page (404); Coach and the short Recap on Fansly must name the fan (400)', async () => {
    hub.control({ op: 'config', patch: fanslyPageFlags() });
    expect(await refusal(await stream('fast-reply', fanslyBody({ platform: 'onlyfans' })))).toEqual({ status: 404, error: 'not_found' });
    const { fanRef: _fan, ...noFan } = fanslyBody();
    for (const [feature, over] of [
      ['coach-chat', { chatterQuestion: 'What now?' }],
      ['fan-summary', { summaryMode: 'short' }],
    ] as const) {
      const response = await stream(feature, { ...noFan, clientRequestId: uuid(0xf800 + ++seq), ...over });
      const body = (await response.json()) as { error: string; message: string };
      expect([feature, response.status, body.message]).toEqual([feature, 400, 'fake hub: fanRef is required on fansly for coach-chat and short fan-summary']);
    }
    // A full Recap keeps the old form (the released extension's fan id as the conversation), and a Reply needs no fan.
    expect((await stream('fan-summary', { ...noFan, clientRequestId: uuid(0xf810) })).status).toBe(200);
    expect((await stream('fast-reply', { ...noFan, clientRequestId: uuid(0xf811) })).status).toBe(200);
  });
});

describe('[host:fansly] the pair groupId ↔ fanRef (hub HF-9)', () => {
  beforeEach(() => {
    hub.control({ op: 'config', patch: fanslyPageFlags() });
  });

  it('the page’s capture decides: its fan is `verified` in the frame; another fan’s group is 409 before anything is spent; a group it has not captured is `unverified`', async () => {
    expect((await contextOf(await stream('fast-reply', fanslyBody()))).pair).toBe('verified');
    expect((await contextOf(await stream('fast-reply', fanslyBody({ conversationRef: OLD.group, fanRef: OLD.fan })))).pair).toBe('verified');
    const left = quota();
    expect(await refusal(await stream('fast-reply', fanslyBody({ fanRef: B.fan })))).toEqual({ status: HUB_ERROR_STATUSES.conversation_fan_mismatch, error: 'conversation_fan_mismatch' });
    // Exact strings (HF-8а): the fan one double apart is another fan.
    expect(await refusal(await stream('fast-reply', fanslyBody({ fanRef: WORLD.fansly.twinFan })))).toEqual({ status: 409, error: 'conversation_fan_mismatch' });
    expect(quota()).toBe(left);
    // A stand chat the hub has not captured yet: served, unverified.
    const uncaptured = standIds(createWorld()).groups[5] as string;
    expect((await contextOf(await stream('fast-reply', fanslyBody({ conversationRef: uncaptured, fanRef: B.fan })))).pair).toBe('unverified');
    // No fan named: no pair to check, none in the frame.
    const { fanRef: _fan, ...noFan } = fanslyBody();
    expect('pair' in (await contextOf(await stream('fast-reply', noFan)))).toBe(false);
  });

  it('the capture moves: a thread learns its fan, or keeps a fan the hub does not know', async () => {
    const group = '810000000000000079';
    expect(hub.control({ op: 'thread', pageLabel: FANSLY, conversationRef: group, fanRef: null })).toEqual({ ok: true });
    expect((await contextOf(await stream('fast-reply', fanslyBody({ conversationRef: group, fanRef: B.fan })))).pair).toBe('unverified');
    hub.control({ op: 'thread', pageLabel: FANSLY, conversationRef: group, fanRef: B.fan });
    expect((await contextOf(await stream('fast-reply', fanslyBody({ conversationRef: group, fanRef: B.fan })))).pair).toBe('verified');
    expect(await refusal(await stream('fast-reply', fanslyBody({ conversationRef: group, fanRef: A.fan })))).toEqual({ status: 409, error: 'conversation_fan_mismatch' });
    expect([classifyPair(undefined, A.fan), classifyPair('', A.fan), classifyPair(A.fan, A.fan), classifyPair(A.fan, WORLD.fansly.twinFan)]).toEqual(['unverified', 'unverified', 'verified', 'mismatch']);
  });

  it('the reads by conversation check the same pair: the feed, the recaps and the dossier save refuse another fan’s group', async () => {
    const crossed = { pageLabel: FANSLY, fanRef: B.fan, conversationRef: A.group };
    for (const route of ['clientConversationFeed', 'clientConversationRecaps'] as const) {
      expect([route, await refusal(await hubCall(hub.fetch, hub.origin, route, crossed, { token }))]).toEqual([route, { status: 409, error: 'conversation_fan_mismatch' }]);
    }
    expect(await refusal(await hubCall(hub.fetch, hub.origin, 'clientFanProfileFromGeneration', { ...crossed, generationRef: uuid(0x200) }, { token }))).toEqual({ status: 409, error: 'conversation_fan_mismatch' });
    expect((await hubCall(hub.fetch, hub.origin, 'clientConversationFeed', { pageLabel: FANSLY, fanRef: A.fan, conversationRef: A.group }, { token })).status).toBe(200);
  });

  it('a Fansly generation reads its group’s archive, never the fan’s; the dossier stays the fan’s', async () => {
    hub.control({
      op: 'archiveConversation',
      pageLabel: FANSLY,
      conversationRef: A.group,
      messages: [
        { id: '880000000000000001', sender: 'fan' },
        { id: '880000000000000002', sender: 'model' },
        { id: '880000000000000003', sender: 'fan' },
      ],
    });
    // Something under the fan's own id must not be read as the group's.
    hub.control({ op: 'archiveMessage', pageLabel: FANSLY, fanRef: A.fan, messageId: '880000000000000099' });
    expect(await contextOf(await stream('fast-reply', fanslyBody()))).toMatchObject({ servedHead: { messageRef: '880000000000000003', isFromFan: true }, window: { requested: 100, served: 3 } });
    // The hub's Hi gate counts the group's messages: eleven are a dialogue.
    hub.control({ op: 'archiveConversation', pageLabel: FANSLY, conversationRef: A.group, messages: Array.from({ length: 11 }, (_, n) => ({ id: String(880000000000000100n + BigInt(n)), sender: 'model' as const })) });
    expect(await refusal(await stream('hi-greeting', fanslyBody()))).toEqual({ status: 400, error: 'gate_hi_greeting_limit' });
    // The fan the capture names has a dossier on the page.
    expect((await hubCall(hub.fetch, hub.origin, 'pageFanProfile', { pageLabel: FANSLY, fanRef: A.fan }, { token })).status).toBe(200);
  });
});

// ── the window check (hub HF-8в) over the shared matrix ────────────────────

interface HubCase {
  readonly name: string;
  readonly served: readonly { readonly id: string; readonly dir: 'fan' | 'model' }[];
  readonly stores: Readonly<Record<string, StoreState>> | null;
  readonly request: CoverageCheckAsked;
  readonly answer: CoverageCheckAnswer;
  readonly coverageVerdict: 'fresh' | 'miss' | 'stale' | 'unverified';
}
const MATRIX = JSON.parse(readFileSync(new URL('../../../contracts/test/fixtures/ai-coverage-check-matrix.json', import.meta.url), 'utf8')) as {
  readonly hubCases: readonly HubCase[];
  readonly invalidRequests: readonly { readonly name: string; readonly request: unknown }[];
};

/** The conversation as the case writes it: beside the window, what the hub holds without reading (`held`) or tombstoned. */
function seedCase(on: FakeHub, c: HubCase, conversationRef: string = A.group): void {
  const beside = Object.entries(c.stores ?? {}).map(([id, state]) => ({ id, sender: 'fan' as const, state: state === 'present' ? ('held' as const) : ('deleted' as const) }));
  on.control({ op: 'archiveConversation', pageLabel: FANSLY, conversationRef, messages: [...beside, ...c.served.map((message) => ({ id: message.id, sender: message.dir }))], lookupFails: c.stores === null });
}

describe('[host:fansly] the window check (hub HF-8в) over the matrix the hub and this client share', () => {
  it('the hub’s own rule, ported: every hub case of the matrix is answered exactly', () => {
    expect(MATRIX.hubCases.length).toBeGreaterThan(10);
    for (const c of MATRIX.hubCases) {
      const window = [...c.served].reverse().map((message) => ({ messageRef: message.id, isFromFan: message.dir === 'fan' }));
      const stores = c.stores === null ? null : new Map(Object.entries(c.stores));
      expect([c.name, resolveCoverageCheck({ check: c.request, window, stores })]).toEqual([c.name, c.answer]);
    }
  });

  it('the fake hub answers every hub case as the hub does — through the vendored SDK, its body and its frames — and the client reads the matrix’s verdict', async () => {
    const real = createFakeHub({ streamBodySchema: routeSchemas.aiFeatureStream.body, routeSchemas });
    const realToken = real.issueToken();
    real.control({ op: 'config', patch: fanslyPageFlags({ drafts: true }) });
    for (const c of MATRIX.hubCases) {
      seedCase(real, c);
      const frames: Frame[] = [];
      const handle: { done: Promise<void> } = streamAiFeature({ baseUrl: real.origin, fetch: real.fetch, auth: { mode: 'bearer', token: () => realToken } } as never, {
        feature: 'fast-reply',
        body: fanslyBody({ coverageCheck: c.request as NonNullable<AiFeatureStreamBody['coverageCheck']> }),
        capabilities: ['context-v1', 'coverage-check-v1'],
        onFrame: (frame: unknown) => frames.push(frame as Frame),
      });
      await handle.done;
      const context = frames.find((frame) => frame.type === 'context_v1');
      const answer = context?.['coverageCheck'] as CoverageCheckAnswer | undefined;
      expect([c.name, answer]).toEqual([c.name, c.answer]);
      // Exactly one answer per id, in the body's order.
      expect([c.name, answer?.window.map((item) => item.id), answer?.deleted.map((item) => item.id)]).toEqual([c.name, c.request.window.map((entry) => entry.id), [...c.request.deletedIds]]);
      expect([c.name, coverageCheckVerdict(c.request, narrowCoverageCheck(answer))]).toEqual([c.name, c.coverageVerdict]);
      expect([c.name, context?.['pair']]).toEqual([c.name, 'verified']);
    }
    expect(real.violations()).toEqual([]);
  });

  it('a full check — 60 window ids and 60 deleted — gets 120 answers, each id once, the body’s order kept', async () => {
    hub.control({ op: 'config', patch: fanslyPageFlags({ drafts: true }) });
    const ids = (base: bigint, n: number): string[] => Array.from({ length: n }, (_, i) => String(base + BigInt(i)));
    const served = ids(890000000000000000n, 60);
    const deleted = ids(890000000000001000n, 60);
    hub.control({
      op: 'archiveConversation',
      pageLabel: FANSLY,
      conversationRef: A.group,
      messages: [...deleted.map((id) => ({ id, sender: 'fan' as const, state: 'deleted' as const })), ...served.map((id, i) => ({ id, sender: i % 2 === 0 ? ('fan' as const) : ('model' as const) }))],
    });
    const check = { window: [...served].reverse().map((id, i) => ({ id, dir: (59 - i) % 2 === 0 ? ('fan' as const) : ('model' as const) })), deletedIds: deleted };
    const context = await contextOf(await stream('fast-reply', fanslyBody({ coverageCheck: check }), ['context-v1', 'coverage-check-v1']));
    const answer = context['coverageCheck'] as CoverageCheckAnswer;
    expect(answer.window.map((item) => item.id)).toEqual(check.window.map((entry) => entry.id));
    expect(answer.deleted.map((item) => item.id)).toEqual(deleted);
    expect(new Set(answer.window.map((item) => item.state))).toEqual(new Set(['included']));
    expect(new Set(answer.deleted.map((item) => item.state))).toEqual(new Set(['deleted']));
  });

  it('every invalid request of the matrix is refused 400 before anything runs — by the hub’s own body schema, and by our mirror without it', async () => {
    expect(MATRIX.invalidRequests.length).toBeGreaterThan(5);
    const real = createFakeHub({ streamBodySchema: routeSchemas.aiFeatureStream.body });
    for (const on of [hub, real]) {
      const onToken = on === hub ? token : on.issueToken();
      on.control({ op: 'config', patch: fanslyPageFlags({ drafts: true }) });
      const left = on.config().quotaRequestsToday;
      for (const c of MATRIX.invalidRequests) {
        const response = await on.fetch(`${on.origin}/api/v1/ai/features/fast-reply`, {
          method: 'POST',
          headers: { authorization: `Bearer ${onToken}`, 'content-type': 'application/json', 'x-kernel-ai-capabilities': 'context-v1, coverage-check-v1' },
          body: JSON.stringify({ ...fanslyBody(), coverageCheck: c.request }),
        });
        expect([c.name, response.status, ((await response.json()) as { error: string }).error]).toEqual([c.name, 400, 'bad_request']);
      }
      expect(on.config().quotaRequestsToday).toBe(left);
    }
  });

  it('answered only to a request that advertised coverage-check-v1; a hub before HF-8в refuses the field', async () => {
    hub.control({ op: 'config', patch: fanslyPageFlags({ drafts: true }) });
    const [first] = MATRIX.hubCases;
    if (first === undefined) throw new Error('no hub case');
    seedCase(hub, first);
    // Without the field the frame is the one it always was.
    expect('coverageCheck' in (await contextOf(await stream('fast-reply', fanslyBody(), ['context-v1', 'coverage-check-v1'])))).toBe(false);
    // The field without both header tokens is not a request this client makes: our mirror refuses it.
    const asked = first.request as NonNullable<AiFeatureStreamBody['coverageCheck']>;
    expect((await stream('fast-reply', fanslyBody({ coverageCheck: asked }), ['context-v1'])).status).toBe(400);
    // A hub that does not serve the check has no such key in its strict body.
    hub.control({ op: 'config', patch: { capabilities: PILOT_CAPABILITIES.filter((capability) => capability !== 'coverage-check-v1') } });
    const mark = hub.journal.mark();
    expect(await refusal(await stream('fast-reply', fanslyBody({ coverageCheck: asked }), ['context-v1', 'coverage-check-v1']))).toEqual({ status: 400, error: 'bad_request' });
    expect(hub.read(mark).entries.at(-1)?.issues).toEqual(['coverageCheck: an unknown key on a hub without coverage-check-v1']);
  });
});
