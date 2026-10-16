// R20 P8c, part A: Hi and Ping on Fansly through its policy (docs/project-unite/architecture.md §5.8, §9.2, §11.1;
// spec FS-AI-1, FS-AI-2). A Hi start carries MAIN's proof of the conversation's start (`StartProofV1`), its count of
// personal messages and the fan's avatar (FX-018); the background names `hi-start-proof-v1` for every Fansly Hi to a
// hub that declared it — without a proof too, so the hub refuses `history_unproven`, never by its old count. The
// pre-check refuses Hi only on MORE than ten proven personal messages (never by the window's count, as ChatSpace
// does) and Ping only for a fan the page's own texts show active within five days; a hub without
// `hi-start-proof-v1` makes Hi «хаб пока не умеет». The whole path is the real one — the dock's controller, the
// workspace, the plan and its StartOp schema, the scheduler with its drivers and the request mirror of the hub —
// over the scripted hub of these tests (as ai-start.test.ts, P8b1); the hub's own rules: @cg/testing.

import { describe, expect, it } from 'vitest';

import { CLIENT_HUB_CAPABILITY_NAMES, type Bootstrap, type ChatRef, type FreshnessPort, type FreshnessRequest, type HubStreamRequest, type StartOp } from '@cg/contracts';
import { FanslySnapshotSchema, type FanslySnapshot, type StartProofV1 } from '@cg/contracts/fansly';
import { createFanslyAi, HI_PERSONAL_MAX, PING_ACTIVE_MS, PING_CLOCK_SLACK_MS, hiFieldsOf, hiPingGate } from '@cg/core/application/hosts/fansly/ai';
import { buildStreamRequest, messageWindowFor } from '@cg/core/domain/ops';
import { createFakeCatalog, ctxOf } from '@cg/testing/app-client';
import { FakeHostPort, memory, startSnapshot } from '@cg/testing/host';
import { BOOTSTRAP_PILOT_PAGES, meta, resolveHubErrorReference } from '@cg/testing/hub';

import { settingsWithPersona } from '../../support/ai-background';
import { readyHarness, type Harness } from '../../support/ai-harness';
import { FANSLY as FANSLY_SLICE, featuresOfBoth } from '../../support/features';
import { FANSLY, NOW_MS, WORLD, fanslyAccount, fanslyChat, fanslyTarget, target, uuid, withFanslyPage } from '../../support/world';

const PERSONA = { key: WORLD.persona.key, definitionId: WORLD.persona.definitionId };
const SETTINGS = settingsWithPersona({
  personas: { scope: { hubOrigin: WORLD.hubOrigin, userId: WORLD.user.userId }, byPageId: { [String(WORLD.pages.one.pageId)]: PERSONA, [String(WORLD.pages.fansly.pageId)]: PERSONA } },
});
const BOOTSTRAP = withFanslyPage(BOOTSTRAP_PILOT_PAGES);
/** The fan's avatar as the page loaded it (a CDN address of Fansly, the hub's `fanslyAvatarUrlSchema`). */
const AVATAR = `https://cdn3.fansly.com/${FANSLY.fan}/840000000000000101.jpeg`;
const HOUR = 60 * 60 * 1000;

// ── the chat as the page holds it ───────────────────────────────────────────

interface Held {
  readonly id: string;
  readonly dir: 'fan' | 'model';
  /** null — media only. */
  readonly text: string | null;
  /** When it was sent, ms. */
  readonly at: number;
}
const idOf = (n: number): string => `80000000000000${String(1000 + n)}`;
/**
 * The conversation of the hard case (§5.8, FS-AI-2): the fan's one line, then 40 automatic messages of the model —
 * a welcome, a follow-up, broadcast copies —, all seen by the tab from the start; sent a week ago.
 */
const greeted = (): Held[] => [
  { id: idOf(0), dir: 'fan', text: 'hey', at: NOW_MS - 7 * 24 * HOUR },
  ...Array.from({ length: 40 }, (_, n): Held => ({ id: idOf(n + 1), dir: 'model', text: `Automatic ${n + 1}`, at: NOW_MS - 7 * 24 * HOUR + (n + 1) * 1000 })),
];
/** The tab's proof of that start: every message from the first one; the model's automatic, the fan's personal. */
function proofOf(held: readonly Held[]): StartProofV1 {
  const automated = held.filter((message) => message.dir === 'model').map((message) => message.id);
  return { v: 1, source: 'tab-short-page', groupId: FANSLY.group, startWitnessId: held[0]?.id ?? null, coveredCount: held.length, personalCount: held.length - automated.length, automatedIds: automated };
}

/** MAIN's snapshot of such a chat (host-fansly main/snapshot.ts): the last min(60, window); Hi's evidence only for Hi. */
function snapshotOf(held: readonly Held[], request: FreshnessRequest, hi: { readonly proof?: StartProofV1; readonly avatar?: string } = {}): FanslySnapshot {
  const picked = held.slice(-Math.min(60, request.window));
  const window = picked.map((message) => ({ id: message.id, dir: message.dir }));
  return FanslySnapshotSchema.parse({
    feature: request.feature,
    identity: { creatorId: FANSLY.creator, groupId: request.conversationRef, fanId: FANSLY.fan },
    epochs: { document: 'doc1', socket: 1, route: 1 },
    completeness: 'complete',
    window,
    knownFanMessageIds: window.filter((entry) => entry.dir === 'fan').slice(-10).map((entry) => entry.id),
    deletedIds: [],
    ...(request.feature === 'hi' && hi.proof !== undefined ? { startProof: hi.proof } : {}),
    ...(request.feature === 'hi' && hi.avatar !== undefined ? { fanAvatarUrl: hi.avatar } : {}),
    ...(request.withText
      ? { tail: picked.flatMap((message) => (message.text === null ? [] : [{ platformMessageId: message.id, direction: message.dir, sentAt: new Date(message.at).toISOString(), text: message.text }])) }
      : {}),
    truncated: false,
  });
}

interface FanslyTab {
  readonly h: Harness;
  readonly asked: { readonly chat: ChatRef; readonly request: FreshnessRequest }[];
}

/** The dock on a Fansly chat of `held`, MAIN answering with its snapshot (and `hi`'s evidence for a Hi). */
async function fanslyTab(held: readonly Held[], hi: { readonly proof?: StartProofV1; readonly avatar?: string } = {}, bootstrap: Bootstrap = BOOTSTRAP): Promise<FanslyTab> {
  const asked: FanslyTab['asked'] = [];
  const port: FreshnessPort = {
    snapshot(chat, request) {
      asked.push({ chat, request });
      return Promise.resolve(snapshotOf(held, request, hi));
    },
  };
  const fake = new FakeHostPort({ start: startSnapshot, memory, checkpoint: null, answers: {}, timeline: [] });
  const h = await readyHarness(
    { baseHost: fake, memory, catalog: createFakeCatalog(ctxOf({ now: NOW_MS })), bootstrap, resolve: resolveHubErrorReference, meta: (feature) => meta(feature as Parameters<typeof meta>[0]) },
    { settings: SETTINGS, features: FANSLY_SLICE, served: featuresOfBoth, policy: createFanslyAi({ now: () => NOW_MS }) },
  );
  const window = memory.chatWindows[0];
  if (window === undefined) throw new Error('no chat window in the host world');
  h.host.freshness = port;
  // Fansly's summary has no count by side; 41 loaded and older history unknown — ChatSpace would not offer Hi here.
  h.host.setWindow({ ...window, chat: fanslyChat, loaded: held.length, hasOlder: null }, fanslyChat);
  h.host.openChat(fanslyChat, fanslyAccount, FANSLY.group);
  await h.settle();
  if (h.ai.workspace.situation().ready === null) throw new Error('the Fansly chat is not ready');
  return { h, asked };
}

const HUB_FEATURE = { hi: 'hi-greeting', ping: 'ping', reply: 'fast-reply' } as const;

/** Generate in the dock: the receipt, and the start and the hub request it made, if any. */
async function generate(tab: FanslyTab, feature: keyof typeof HUB_FEATURE): Promise<{ readonly ok: boolean; readonly code: string | null; readonly start: StartOp | null; readonly request: HubStreamRequest | null }> {
  const { h } = tab;
  const starts = h.bg.callsOf('op.start').length;
  const streams = h.bg.hub.streams.length;
  h.script(h.streamOf(HUB_FEATURE[feature], ['Hey you']));
  const receipt = await h.dispatch({ type: 'Generate', targetHandle: h.dock().targetHandle ?? '', feature, options: {} });
  await h.finish();
  const code = receipt.ok ? null : ((receipt as { readonly error?: { readonly code?: string } }).error?.code ?? null);
  return { ok: receipt.ok, code, start: (h.bg.callsOf('op.start')[starts] as StartOp | undefined) ?? null, request: h.bg.hub.streams[streams] ?? null };
}

describe('[host:fansly] R20 P8c: Hi with the proof of the conversation’s start and the fan’s avatar; Ping and the active fan', () => {
  it('[ST-137] [AI-134] Hi reads one page of Fansly: its window is 25 whatever the settings say — the snapshot asked and the hub asked are 25', async () => {
    for (const windows of [SETTINGS.generation.windows, { quick: 5, ping: 5, improve: 5, deep: 5000 }]) expect(messageWindowFor('hi', windows, 3000)).toBe(25);
    const held = greeted();
    const tab = await fanslyTab(held, { proof: proofOf(held) });
    const { request } = await generate(tab, 'hi');
    expect([tab.asked[0]?.request.window, request?.body.messageCount, request?.body.coverageCheck?.window.length]).toEqual([25, 25, 25]);
  });

  it('[FS-AI-2] [AI-030] [AI-032] [FX-018] a start the tab saw from its first message — one personal, 40 automatic: the Hi carries the proof, its count and the fan’s avatar; the background names hi-start-proof-v1 beside the window check; three greetings', async () => {
    const held = greeted();
    const proof = proofOf(held);
    expect(proof).toMatchObject({ coveredCount: 41, personalCount: 1 });
    expect(proof.automatedIds).toHaveLength(40);
    const tab = await fanslyTab(held, { proof, avatar: AVATAR });
    // Not ChatSpace's rule: 41 messages in the window say nothing against a Hi on Fansly.
    expect(tab.h.dock().actions.hi).toMatchObject({ enabled: true, reason: null });
    const { ok, start, request } = await generate(tab, 'hi');
    expect(ok).toBe(true);
    expect(start).toMatchObject({ feature: 'hi', startProof: proof, personalMessageCount: 1, fanAvatarUrl: AVATAR });
    expect(request?.feature).toBe('hi-greeting');
    expect(request?.capabilities).toEqual(expect.arrayContaining(['context-v1', 'coverage-check-v1', 'hi-start-proof-v1']));
    expect(request?.body).toMatchObject({ platform: 'fansly', conversationRef: FANSLY.group, fanRef: FANSLY.fan, variantCount: 3, startProof: proof, personalMessageCount: 1, fanAvatarUrl: AVATAR });
    expect(request === null ? null : 'clientContext' in request.body).toBe(false);
  });

  it('[FS-AI-2] no proof of the start — a chat first opened past one page (§5.8 (а)): the Hi goes without one, never as a zero count, still under hi-start-proof-v1 — the hub refuses history_unproven', async () => {
    const held = greeted();
    const tab = await fanslyTab(held, { avatar: AVATAR });
    const { ok, start, request } = await generate(tab, 'hi');
    expect(ok).toBe(true);
    expect([start?.startProof, start?.personalMessageCount, start?.fanAvatarUrl]).toEqual([undefined, undefined, AVATAR]);
    expect(request?.capabilities).toContain('hi-start-proof-v1');
    expect([request?.body.startProof, request?.body.personalMessageCount, request?.body.fanAvatarUrl]).toEqual([undefined, undefined, AVATAR]);
  });

  it('[AI-031] [FS-AI-2] more than ten personal messages, proven: the client refuses Hi by itself before the token — no start, nothing to the hub; ten — the hub decides', async () => {
    const held = [...Array.from({ length: 11 }, (_, n): Held => ({ id: idOf(n), dir: 'fan', text: `line ${n}`, at: NOW_MS - 3 * 24 * HOUR + n * 1000 }))];
    const eleven: StartProofV1 = { v: 1, source: 'tab-short-page', groupId: FANSLY.group, startWitnessId: idOf(0), coveredCount: 11, personalCount: 11, automatedIds: [] };
    const refused = await fanslyTab(held, { proof: eleven });
    // The view knows no proof: Hi is offered; the click's snapshot proves the dialogue.
    expect(refused.h.dock().actions.hi.enabled).toBe(true);
    expect(await generate(refused, 'hi')).toEqual({ ok: false, code: 'CG-GATE-HI', start: null, request: null });
    expect(refused.asked.map(({ request }) => request.feature)).toEqual(['hi']);

    const ten = await fanslyTab(held.slice(1), { proof: { ...eleven, startWitnessId: idOf(1), coveredCount: 10, personalCount: HI_PERSONAL_MAX } });
    const admitted = await generate(ten, 'hi');
    expect([admitted.ok, admitted.request?.body.startProof?.personalCount]).toEqual([true, 10]);
  });

  it('[ER-038] Hi refusals too_many_personal and history_unproven show the greeting gate’s words on Fansly', async () => {
    for (const reason of ['too_many_personal', 'history_unproven']) {
      const tab = await fanslyTab(greeted());
      tab.h.script({ kind: 'http-error', status: 400, body: { error: 'gate_hi_greeting_limit', reason } });
      expect(await tab.h.generate('hi')).toMatchObject({ ok: true });
      await tab.h.finish();
      expect(tab.h.dock().result).toMatchObject({
        feature: 'hi', state: 'failed',
        error: { code: 'CG-GATE-HI', title: 'Это уже диалог', body: 'Hi — для первого сообщения. Здесь нужен Reply.' },
      });
    }
  });

  it('[FS-AI-2] a hub without hi-start-proof-v1 (before HF-5): Hi is «хаб пока не умеет» — not offered, MAIN and the hub asked nothing; Reply goes', async () => {
    const before: Bootstrap = { ...BOOTSTRAP, capabilities: CLIENT_HUB_CAPABILITY_NAMES.filter((capability) => capability !== 'hi-start-proof-v1' && capability !== 'client-health-perf-v1') };
    const held = greeted();
    const tab = await fanslyTab(held, { proof: proofOf(held), avatar: AVATAR }, before);
    expect(tab.h.dock().actions.hi).toMatchObject({ enabled: false, reason: { code: 'CG-HUB-CAPABILITY', text: { key: 'dock.reason.hubNotReady' } } });
    expect(await generate(tab, 'hi')).toMatchObject({ ok: false, code: 'CG-HUB-CAPABILITY', start: null, request: null });
    expect(tab.asked).toEqual([]);
    const reply = await generate(tab, 'reply');
    expect([reply.ok, reply.request?.capabilities.includes('hi-start-proof-v1'), reply.request?.body.startProof]).toEqual([true, false, undefined]);
  });

  it('[AI-036] [ER-034] [FS-AI-1] Ping for a fan whose text the page holds from the last five days: refused before the token, nothing to the hub; a fan silent for a week — Ping goes, the segment is the hub’s (AI-037)', async () => {
    const quiet = greeted();
    const silent = await fanslyTab(quiet);
    const ping = await generate(silent, 'ping');
    expect([ping.ok, ping.request?.feature, ping.request?.body.messageCount]).toEqual([true, 'ping', SETTINGS.generation.windows.ping]);
    expect(ping.request === null ? null : ['clientContext' in ping.request.body, ping.request.capabilities.includes('hi-start-proof-v1')]).toEqual([false, false]);

    const active = await fanslyTab([...quiet, { id: idOf(60), dir: 'fan', text: 'still here?', at: NOW_MS - 2 * HOUR }]);
    expect(active.h.dock().actions.ping.enabled).toBe(true);
    expect(await generate(active, 'ping')).toEqual({ ok: false, code: 'CG-GATE-PING', start: null, request: null });
  });
});

describe('[host:fansly] R20 P8c: the pre-check and the fields of Hi and Ping (pure)', () => {
  const request = (feature: FreshnessRequest['feature'], withText = true): FreshnessRequest => ({ conversationRef: FANSLY.group, feature, window: feature === 'hi' ? 25 : 60, withText });
  const fanAt = (at: number, text: string | null = 'hello'): Held[] => [...greeted().slice(0, 5), { id: idOf(60), dir: 'fan', text, at }];

  it('[AI-031] Hi: only a proof of more than ten personal messages refuses; no proof, or ten, is the hub’s — whatever the window holds', () => {
    const held = greeted();
    // The same 41 messages, `personal` of them proven personal (the rest automatic).
    const hi = (personal: number): FanslySnapshot => snapshotOf(held, request('hi'), { proof: { ...proofOf(held), personalCount: personal, automatedIds: held.slice(1, 1 + held.length - personal).map((message) => message.id) } });
    expect(hiPingGate('hi', hi(11), NOW_MS)).toBe('hi-gate');
    expect(hiPingGate('hi', hi(10), NOW_MS)).toBeNull();
    expect(hiPingGate('hi', snapshotOf(held, request('hi')), NOW_MS)).toBeNull();
    expect(hiPingGate('hi', null, NOW_MS)).toBeNull();
    expect(hiPingGate('reply', hi(11), NOW_MS)).toBeNull();
  });

  it('[AI-036] Ping: a fan TEXT within five days refuses — the hub’s rule; media only, the model’s text, a blank line, a week ago, the last ten minutes of the window (the clocks differ) or no texts on the page — the hub decides', () => {
    const gate = (held: readonly Held[], withText = true): string | null => hiPingGate('ping', snapshotOf(held, request('ping', withText)), NOW_MS);
    expect(gate(fanAt(NOW_MS - HOUR))).toBe('ping-gate');
    expect(gate(fanAt(NOW_MS - PING_ACTIVE_MS + PING_CLOCK_SLACK_MS + 1000))).toBe('ping-gate');
    expect(gate(fanAt(NOW_MS - PING_ACTIVE_MS + PING_CLOCK_SLACK_MS - 1000))).toBeNull();
    expect(gate(fanAt(NOW_MS - HOUR, null))).toBeNull();
    expect(gate(fanAt(NOW_MS - HOUR, '   '))).toBeNull();
    expect(gate([...greeted().slice(0, 5), { id: idOf(60), dir: 'model', text: 'ping?', at: NOW_MS - HOUR }])).toBeNull();
    expect(gate(fanAt(NOW_MS - 7 * 24 * HOUR))).toBeNull();
    expect(gate(fanAt(NOW_MS - HOUR), false)).toBeNull();
    expect(hiPingGate('ping', null, NOW_MS)).toBeNull();
  });

  it('[FX-018] Hi’s fields come from a Hi snapshot only: the proof with its count, the avatar — each when MAIN has it', () => {
    const held = greeted();
    const proof = proofOf(held);
    expect(hiFieldsOf(snapshotOf(held, request('hi'), { proof, avatar: AVATAR }))).toEqual({ startProof: proof, personalMessageCount: 1, fanAvatarUrl: AVATAR });
    expect(hiFieldsOf(snapshotOf(held, request('hi'), { avatar: AVATAR }))).toEqual({ fanAvatarUrl: AVATAR });
    expect(hiFieldsOf(snapshotOf(held, request('hi')))).toEqual({});
    expect(hiFieldsOf(snapshotOf(held, request('reply')))).toEqual({});
  });

  it('the request: Hi’s lane only where the hub decides Hi by the proof and declared it — OnlyFans and a hub before HF-5 never hear hi-start-proof-v1 and never get the fields', () => {
    const held = greeted();
    const proof = proofOf(held);
    const ctx = { opId: uuid(0x91), persona: PERSONA, bootstrap: BOOTSTRAP, debug: false, freshText: true };
    const fansly: StartOp = { feature: 'hi', surface: 'dock', target: fanslyTarget, cause: { kind: 'click', actionToken: uuid(0x92) }, tone: null, split: false, window: 25, startProof: proof, personalMessageCount: 1, fanAvatarUrl: AVATAR };
    const lane = buildStreamRequest(fansly, ctx);
    if (!lane.ok) throw new Error(lane.issues);
    expect([lane.request.capabilities.includes('hi-start-proof-v1'), lane.request.body.startProof, lane.request.body.fanAvatarUrl]).toEqual([true, proof, AVATAR]);

    const older = buildStreamRequest(fansly, { ...ctx, bootstrap: { ...BOOTSTRAP, capabilities: BOOTSTRAP.capabilities.filter((capability) => capability !== 'hi-start-proof-v1') } });
    if (!older.ok) throw new Error(older.issues);
    expect([older.request.capabilities.includes('hi-start-proof-v1'), older.request.body.startProof, older.request.body.personalMessageCount, older.request.body.fanAvatarUrl]).toEqual([false, undefined, undefined, undefined]);

    const onlyfans = buildStreamRequest({ feature: 'hi', surface: 'dock', target, cause: { kind: 'click', actionToken: uuid(0x93) }, tone: null, split: false, window: 25 }, ctx);
    if (!onlyfans.ok) throw new Error(onlyfans.issues);
    expect(onlyfans.request.capabilities).not.toContain('hi-start-proof-v1');
  });
});
