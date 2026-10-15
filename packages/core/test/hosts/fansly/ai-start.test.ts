// R20 P8b1: the AI start path on Fansly through the ports of `AiHostPolicy` (docs/project-unite/architecture.md
// §1.6, §5.8, §9.1; spec FS-TAIL-1, FS-TAIL-6, FS-TAIL-7, FS-TAIL-10, FS-IDN-6). The shared controller of the open
// chat asks Fansly's policy for the proof of a start: MAIN's generation snapshot through the host's `freshness` port
// — in place of ChatSpace's visible tail — for the target's group, its window min(60, N) of the start's messageCount.
// The start carries it as its shared `proof`; the background asks the hub about it: the window and the deleted ids
// (`coverageCheck` under `coverage-check-v1`), the fan's known ids, a draft's texts (`liveTextContext` under the
// page's `freshText`), never a messageCount below the window. Recap, Review and Coach are checked without a text.
// No snapshot is no proof: the generation goes on, unverified (FS-TAIL-7).
//
// The whole path is the real one — the dock's controller, the workspace, the plan and its StartOp schema, the
// scheduler with its drivers and the request mirror of the hub — over the scripted hub of these tests; the hub's
// own body schema (the vendored SDK) and handler rules check the same bodies in @cg/testing
// (sdk-alignment-fansly.test.ts). ChatSpace's requests are pinned elsewhere (application-dock.test.ts, F10).

import { describe, expect, it } from 'vitest';

import {
  CLIENT_HUB_CAPABILITY_NAMES,
  type Bootstrap,
  type ChatRef,
  type CoverageProof,
  type FeatureId,
  type FreshnessPort,
  type FreshnessRequest,
  type HubStreamRequest,
  type IncomingFact,
  type StartOp,
  type UserOptions,
} from '@cg/contracts';
import { FanslySnapshotSchema, type FanslySnapshot } from '@cg/contracts/fansly';
import { checkWindowOf, createFanslyAi, startProofOf } from '@cg/core/application/hosts/fansly/ai';
import { buildStreamRequest } from '@cg/core/domain/ops';
import { createFakeCatalog, ctxOf } from '@cg/testing/app-client';
import { FakeHostPort, memory, startSnapshot } from '@cg/testing/host';
import { BOOTSTRAP_PILOT_PAGES, meta, resolveHubErrorReference } from '@cg/testing/hub';

import { TAB, settingsWithPersona } from '../../support/ai-background';
import { readyHarness, type Harness } from '../../support/ai-harness';
import { FANSLY as FANSLY_SLICE, featuresOfBoth } from '../../support/features';
import { FANSLY, NOW_MS, WORLD, fanslyAccount, fanslyChat, fanslyTarget, uuid, withFanslyPage } from '../../support/world';

const PERSONA = { key: WORLD.persona.key, definitionId: WORLD.persona.definitionId };
const SETTINGS = settingsWithPersona({
  personas: { scope: { hubOrigin: WORLD.hubOrigin, userId: WORLD.user.userId }, byPageId: { [String(WORLD.pages.one.pageId)]: PERSONA, [String(WORLD.pages.fansly.pageId)]: PERSONA } },
});
const WINDOWS = SETTINGS.generation.windows;
const BOOTSTRAP = withFanslyPage(BOOTSTRAP_PILOT_PAGES);
const NOW_ISO = new Date(NOW_MS).toISOString();

// ── the chat as the page holds it ───────────────────────────────────────────

/** One message of the open chat as MAIN holds it: a snowflake id (in order), its side, its text (none — media only). */
interface Held {
  readonly id: string;
  readonly dir: 'fan' | 'model';
  readonly text: string | null;
  readonly deleted?: boolean;
}
const idOf = (n: number): string => `80000000000000${String(1000 + n)}`;
/** A chat of `count` messages: fan and model by turns, every fifth one media only. */
function chatOf(count: number): Held[] {
  return Array.from({ length: count }, (_, n) => ({ id: idOf(n), dir: n % 2 === 0 ? 'fan' : 'model', text: n % 5 === 4 ? null : `message ${n}` }));
}
const sentAt = (id: string): string => new Date(NOW_MS - (2_000_000 - Number(id.slice(-4))) * 1000).toISOString();
/** The messages with a text, in the page's live form. */
const textsOf = (held: readonly Held[]): { platformMessageId: string; direction: 'fan' | 'model'; sentAt: string; text: string }[] =>
  held.flatMap((message) => (message.text === null ? [] : [{ platformMessageId: message.id, direction: message.dir, sentAt: sentAt(message.id), text: message.text }]));

/** MAIN's snapshot of such a chat (host-fansly main/snapshot.ts): the last min(60, window) live messages; the deleted in their span. */
function snapshotOf(held: readonly Held[], request: FreshnessRequest, over: Partial<FanslySnapshot> = {}): FanslySnapshot {
  const live = held.filter((message) => message.deleted !== true);
  const picked = live.slice(-Math.min(60, request.window));
  const from = picked.length === Math.min(60, request.window) && picked[0] !== undefined ? held.indexOf(picked[0]) : 0;
  const window = picked.map((message) => ({ id: message.id, dir: message.dir }));
  const snapshot: FanslySnapshot = {
    feature: request.feature,
    identity: { creatorId: FANSLY.creator, groupId: request.conversationRef, fanId: FANSLY.fan },
    epochs: { document: 'doc1', socket: 1, route: 1 },
    completeness: 'complete',
    window,
    knownFanMessageIds: window.filter((entry) => entry.dir === 'fan').slice(-10).map((entry) => entry.id),
    deletedIds: held.slice(from).filter((message) => message.deleted === true).map((message) => message.id),
    ...(request.withText ? { tail: textsOf(picked) } : {}),
    truncated: false,
    ...over,
  };
  return FanslySnapshotSchema.parse(snapshot);
}

/** Fansly's freshness port over a chat the test holds: every request recorded; `answer` replaces MAIN's answer. */
function freshnessOver(held: () => readonly Held[]): FreshnessPort & { readonly asked: { readonly chat: ChatRef; readonly request: FreshnessRequest }[]; answer: ((request: FreshnessRequest) => Promise<FanslySnapshot | null>) | null } {
  const port = {
    asked: [] as { chat: ChatRef; request: FreshnessRequest }[],
    answer: null as ((request: FreshnessRequest) => Promise<FanslySnapshot | null>) | null,
    snapshot(chat: ChatRef, request: FreshnessRequest): Promise<FanslySnapshot | null> {
      port.asked.push({ chat, request });
      return port.answer === null ? Promise.resolve(snapshotOf(held(), request)) : port.answer(request);
    },
  };
  return port;
}

// ── the tab on a Fansly chat ────────────────────────────────────────────────

interface FanslyTab {
  readonly h: Harness;
  readonly port: ReturnType<typeof freshnessOver>;
  readonly held: Held[];
}

async function fanslyTab(options: { readonly bootstrap?: Bootstrap; readonly held?: Held[] } = {}): Promise<FanslyTab> {
  const held = options.held ?? chatOf(80);
  const port = freshnessOver(() => held);
  const policy = createFanslyAi({ now: () => NOW_MS });
  const fake = new FakeHostPort({ start: startSnapshot, memory, checkpoint: null, answers: {}, timeline: [] });
  const h = await readyHarness(
    { baseHost: fake, memory, catalog: createFakeCatalog(ctxOf({ now: NOW_MS })), bootstrap: options.bootstrap ?? BOOTSTRAP, resolve: resolveHubErrorReference, meta: (feature) => meta(feature as Parameters<typeof meta>[0]) },
    { settings: SETTINGS, features: FANSLY_SLICE, served: featuresOfBoth, policy },
  );
  const window = memory.chatWindows[0];
  if (window === undefined) throw new Error('no chat window in the host world');
  h.host.freshness = port;
  h.host.setWindow({ ...window, chat: fanslyChat, loaded: 40, hasOlder: true }, fanslyChat);
  h.host.openChat(fanslyChat, fanslyAccount, FANSLY.group);
  await h.settle();
  if (h.ai.workspace.situation().ready === null) throw new Error('the Fansly chat is not ready');
  return {
    h,
    port,
    held,
  };
}

const HUB_FEATURE: Readonly<Record<FeatureId, string>> = { reply: 'fast-reply', fix: 'improve-draft', hi: 'hi-greeting', ping: 'ping', review: 'chat-review', recap: 'fan-summary', 'recap-short': 'fan-summary', coach: 'coach-chat' };

/** Generates in the open chat with a scripted answer; the start the background was given and the hub request it made. */
async function generate(tab: FanslyTab, feature: FeatureId, options: UserOptions = {}): Promise<{ readonly start: StartOp; readonly request: HubStreamRequest }> {
  const { h } = tab;
  const before = h.bg.hub.streams.length;
  if (feature === 'fix') h.host.type('a draft to fix');
  h.script(h.streamOf(HUB_FEATURE[feature], ['Hey you']));
  // A Recap is built from its picker (the dock opens it); the rest start by Generate.
  const receipt =
    feature === 'recap' || feature === 'recap-short'
      ? await h.dispatch({ type: 'RefreshRecap', length: feature === 'recap' ? 'full' : 'short' })
      : await h.dispatch({ type: 'Generate', targetHandle: h.dock().targetHandle ?? '', feature, options: feature === 'coach' ? { question: 'What now?', ...options } : options });
  expect(receipt, feature).toMatchObject({ ok: true });
  await h.finish();
  const start = h.bg.callsOf('op.start').at(-1) as StartOp;
  const request = h.bg.hub.streams[before];
  if (request === undefined) throw new Error(`${feature}: no request reached the hub`);
  return { start, request };
}

const lastFan = (held: readonly Held[], count: number): string[] =>
  held
    .filter((message) => message.deleted !== true)
    .slice(-60)
    .filter((message) => message.dir === 'fan')
    .slice(-count)
    .map((message) => message.id)
    .reverse();

describe('[host:fansly] R20 P8b1: a start on Fansly carries MAIN’s snapshot as its proof, and the hub is asked about it', () => {
  it('review P2: auto-Recap preserves the Coach snapshot in both hub requests, without page text', async () => {
    const tab = await fanslyTab();
    const { h } = tab;
    h.script(h.streamOf('fan-summary', ['Summary']), h.streamOf('coach-chat', ['Advice']));
    expect(await h.ai.workspace.startFeature({ feature: 'coach', surface: 'coach', cause: 'click', options: { question: 'What now?' }, autoRecap: 'full' })).toMatchObject({ kind: 'started' });
    await h.finish();
    const start = h.bg.callsOf('op.start')[0] as StartOp;
    expect(start.proof?.window).toHaveLength(60);
    expect(h.bg.hub.streams.map(({ feature, body }) => [feature, body.messageCount, body.coverageCheck?.window, body.liveTextContext])).toEqual([
      ['fan-summary', 3000, start.proof?.window, undefined],
      ['coach-chat', WINDOWS.quick, start.proof?.window, undefined],
    ]);
  });

  it.each([100, 5])('review P2: Fix uses the effective generation window %i instead of its 25-message setting', async (window) => {
    const tab = await fanslyTab();
    const { request } = await generate(tab, 'fix', { window });
    expect([request.body.messageCount, tab.port.asked[0]?.request.window, request.body.coverageCheck?.window.length]).toEqual([window, Math.min(60, window), Math.min(60, window)]);
  });

  it('the hub cap is applied before the snapshot, without raising the requested count back to 60', async () => {
    const tab = await fanslyTab({ bootstrap: { ...BOOTSTRAP, limits: { ...BOOTSTRAP.limits, deepMax: 40 } } });
    const { request } = await generate(tab, 'fix', { window: 100 });
    expect([request.body.messageCount, tab.port.asked[0]?.request.window, request.body.coverageCheck?.window.length]).toEqual([40, 40, 40]);
  });

  it('review P2: the first generation after reconnect uses the settings reloaded by the environment', async () => {
    const tab = await fanslyTab();
    const { h } = tab;
    await h.settle();
    h.bg.setConnection('reconnecting');
    // The background changes while disconnected: no settings.changed reaches the tab.
    h.bg.settings = { ...h.bg.settings, revision: h.bg.settings.revision + 1, settings: { ...SETTINGS, generation: { ...SETTINGS.generation, windows: { ...WINDOWS, improve: 60 } } } };
    h.bg.setConnection('ready');
    await h.settle();
    const { request } = await generate(tab, 'fix');
    expect([request.body.messageCount, tab.port.asked[0]?.request.window, request.body.coverageCheck?.window.length]).toEqual([60, 60, 60]);
  });

  it('[AI-142] Reply: the snapshot of the target’s group — the window, the fan’s known ids, the deleted, the tail — and a body without `clientContext`: the group beside the fan, the window check, the known ids, the texts, a count no smaller than the window', async () => {
    const held = chatOf(80);
    const deleted = held[70] as Held;
    held[70] = { ...deleted, deleted: true };
    const tab = await fanslyTab({ held });
    const { start, request } = await generate(tab, 'reply');

    expect(tab.port.asked).toEqual([{ chat: fanslyChat, request: { conversationRef: FANSLY.group, feature: 'reply', window: 60, withText: true } }]);
    // ChatSpace's tail is never read on Fansly: the proof is the snapshot.
    expect(tab.h.host.reads.tail).toBe(0);
    expect(start.fresh).toBeUndefined();
    const live = held.filter((message) => message.deleted !== true).slice(-60);
    expect(start.proof).toEqual({
      kind: 'tab-snapshot',
      conversationRef: FANSLY.group,
      completeness: 'complete',
      takenAt: NOW_ISO,
      window: live.map((message) => ({ id: message.id, dir: message.dir })),
      knownFanMessageIds: lastFan(held, 10),
      deletedIds: [deleted.id],
      tail: textsOf(live),
      truncated: false,
    } satisfies CoverageProof);
    expect(start.target).toMatchObject({ conversationRef: FANSLY.group, fanRef: FANSLY.fan });

    expect(request.feature).toBe('fast-reply');
    expect(request.capabilities).toEqual(expect.arrayContaining(['context-v1', 'coverage-check-v1']));
    expect(request.body).toMatchObject({ platform: 'fansly', conversationRef: FANSLY.group, fanRef: FANSLY.fan, messageCount: WINDOWS.quick });
    expect('clientContext' in request.body).toBe(false);
    expect(request.body.coverageCheck).toEqual({ window: start.proof?.window, deletedIds: [deleted.id] });
    expect(request.body.knownFanMessageIds).toEqual(lastFan(held, 10));
    expect(request.body.liveTextContext).toEqual({
      capturedAt: NOW_ISO,
      items: textsOf(live).map((message) => ({ platformMessageId: message.platformMessageId, direction: message.direction, occurredAt: message.sentAt, text: message.text })),
    });
    expect(request.body.messageCount ?? 0).toBeGreaterThanOrEqual(request.body.coverageCheck?.window.length ?? Infinity);
    // Hi's evidence and the verdict are not this start's (P8c, P8b2).
    expect([request.body.startProof, request.body.personalMessageCount, request.body.fanAvatarUrl, request.capabilities.includes('hi-start-proof-v1')]).toEqual([undefined, undefined, undefined, false]);
  });

  it('[AI-142] every feature: the window is min(60, its messageCount) — Fix 25, Hi 25, the rest 60 —; texts only for Reply, Fix, Hi and Ping (D-14, FS-TAIL-10); every one is checked', async () => {
    const tab = await fanslyTab();
    const seen: Record<string, unknown> = {};
    for (const feature of ['reply', 'fix', 'hi', 'ping', 'review', 'recap', 'recap-short', 'coach'] as const) {
      tab.port.asked.length = 0;
      const { start, request } = await generate(tab, feature);
      const asked = tab.port.asked[0]?.request;
      const draft = ['reply', 'fix', 'hi', 'ping'].includes(feature);
      seen[feature] = {
        asked: asked === undefined ? null : [asked.window, asked.withText],
        proof: [start.proof?.window.length, start.proof?.kind === 'tab-snapshot' ? start.proof.tail !== undefined : null],
        body: [request.body.coverageCheck?.window.length, request.body.liveTextContext !== undefined, request.body.messageCount],
      };
      expect([feature, (request.body.messageCount ?? 0) >= (request.body.coverageCheck?.window.length ?? Infinity)]).toEqual([feature, true]);
      expect([feature, draft || request.body.liveTextContext === undefined]).toEqual([feature, true]);
    }
    expect(seen).toEqual({
      reply: { asked: [60, true], proof: [60, true], body: [60, true, WINDOWS.quick] },
      fix: { asked: [25, true], proof: [25, true], body: [25, true, WINDOWS.improve] },
      hi: { asked: [25, true], proof: [25, true], body: [25, true, 25] },
      ping: { asked: [60, true], proof: [60, true], body: [60, true, WINDOWS.ping] },
      review: { asked: [60, false], proof: [60, false], body: [60, false, WINDOWS.deep] },
      recap: { asked: [60, false], proof: [60, false], body: [60, false, WINDOWS.deep] },
      'recap-short': { asked: [60, false], proof: [60, false], body: [60, false, 300] },
      coach: { asked: [60, false], proof: [60, false], body: [60, false, WINDOWS.quick] },
    });
  });

  it('a page that does not admit fresh text: the snapshot is asked without texts, the window is still checked; a hub without `coverage-check-v1`: no window check, no header token — the known ids still go', async () => {
    const noFresh = withFanslyPage({ ...BOOTSTRAP_PILOT_PAGES, pages: BOOTSTRAP_PILOT_PAGES.pages.map((page) => ({ ...page, features: { ...page.features, freshText: { available: false, reason: 'flag_off' } } })) });
    const quiet = await fanslyTab({ bootstrap: noFresh });
    const reply = await generate(quiet, 'reply');
    expect(quiet.port.asked.map(({ request }) => request.withText)).toEqual([false]);
    expect([reply.start.proof?.kind, reply.start.proof?.window.length]).toEqual(['tab-snapshot', 60]);
    expect(reply.start.proof?.kind === 'tab-snapshot' && reply.start.proof.tail).toBe(undefined);
    expect([reply.request.body.coverageCheck?.window.length, reply.request.body.liveTextContext]).toEqual([60, undefined]);
    expect(reply.request.body.knownFanMessageIds).toBeUndefined();

    const older: Bootstrap = { ...BOOTSTRAP, capabilities: CLIENT_HUB_CAPABILITY_NAMES.filter((capability) => capability !== 'coverage-check-v1' && capability !== 'client-health-perf-v1') };
    const before = await fanslyTab({ bootstrap: older });
    const { start, request } = await generate(before, 'reply');
    expect(start.proof?.window.length).toBe(60);
    expect([request.body.coverageCheck, request.capabilities.includes('coverage-check-v1')]).toEqual([undefined, false]);
    expect(request.body.knownFanMessageIds).toEqual(lastFan(before.held, 10));
    expect(request.body.liveTextContext?.items.length).toBe(48);
  });

  it('[FS-TAIL-7] no snapshot is no proof — MAIN does not answer, it answers null, an older caller has no effective count: the generation goes on, nothing is asked about the window', async () => {
    const tab = await fanslyTab();
    // Two features: the same start twice would be the cached result, not a new request.
    for (const [feature, answer] of [
      ['reply', () => Promise.reject(new Error('the bridge did not answer'))],
      ['ping', () => Promise.resolve(null)],
    ] as const) {
      tab.port.answer = answer;
      const { start, request } = await generate(tab, feature);
      expect([start.proof, start.fresh]).toEqual([undefined, undefined]);
      expect([request.body.coverageCheck, request.body.knownFanMessageIds, request.body.liveTextContext, request.capabilities.includes('coverage-check-v1')]).toEqual([undefined, undefined, undefined, false]);
    }
    tab.port.answer = null;
    tab.port.asked.length = 0;
    const identity = tab.h.host.current().identity;
    if (identity === null) throw new Error('no identity');
    const legacy = createFanslyAi({ now: () => NOW_MS });
    expect(legacy.proof(tab.h.host, { feature: 'hi', surface: 'dock', identity, fresh: null })).toBeNull();
    expect(tab.port.asked).toEqual([]);
  });

  it('[FS-IDN-6] the snapshot is the route’s group of the chat the start was made in: a route that moved or names no group gives no proof, nothing is asked', async () => {
    const tab = await fanslyTab();
    const policy = createFanslyAi({ now: () => NOW_MS });
    const identity = tab.h.host.current().identity;
    if (identity === null) throw new Error('no identity');
    const ask = { feature: 'reply' as const, surface: 'dock' as const, identity, fresh: null, messageCount: 100 };
    expect(await policy.proof(tab.h.host, ask)).toMatchObject({ proof: { conversationRef: FANSLY.group } });
    expect(policy.proof(tab.h.host, { ...ask, identity: { ...identity, routeEpoch: identity.routeEpoch + 1 } })).toBeNull();
    expect(policy.proof(tab.h.host, { ...ask, identity: { ...identity, chat: { ...fanslyChat, platformFanId: '7109' } } })).toBeNull();
    tab.h.host.openChat(fanslyChat, fanslyAccount);
    const moved = tab.h.host.current().identity;
    if (moved === null) throw new Error('no identity');
    expect(policy.proof(tab.h.host, { ...ask, identity: moved })).toBeNull();
    // A host without the port (ChatSpace's): nothing to gather.
    const plain = await fanslyTab();
    delete plain.h.host.freshness;
    expect(policy.proof(plain.h.host, ask)).toBeNull();
    expect(tab.port.asked.length).toBe(1);
  });

  it('a result’s fan message that the window already held is not «новое после генерации»; one the tab never saw is', async () => {
    const tab = await fanslyTab();
    const { start } = await generate(tab, 'reply');
    const view = tab.h.bg.scheduler.list(TAB, 'tab').ops.at(-1);
    if (view === undefined || start.proof === undefined) throw new Error('no operation');
    const seenFan = start.proof.knownFanMessageIds[0] ?? '';
    const fact = (platformMessageId: string): IncomingFact => ({
      host: 'fansly-web',
      hostAccountId: FANSLY.creator,
      platformFanId: FANSLY.fan,
      platformMessageId,
      fromFan: true,
      automatic: false,
      tip: false,
      sentAt: NOW_ISO,
      socketEpoch: 1,
      fanSequence: 1,
      source: 'ws-tap',
    });
    expect(tab.h.bg.scheduler.incoming(fact(seenFan), NOW_MS + 60_000)).toEqual([]);
    expect(tab.h.bg.scheduler.incoming(fact(idOf(500)), NOW_MS + 60_000)).toEqual([view.opId]);
  });
});

describe('[host:fansly] R20 P8b1: the snapshot as the start’s proof, the window and the request (pure)', () => {
  const request = (window: number, withText = true): FreshnessRequest => ({ conversationRef: FANSLY.group, feature: 'reply', window, withText });

  it.each([1, 5, 25, 40, 60, 100, 3000])('the check window of effective messageCount %i (FS-TAIL-1)', (count) => {
    expect(checkWindowOf(count)).toBe(Math.min(60, count));
  });

  it('the fan’s known ids newest first, as the hub body takes them; the tail cut to the page’s limits — the newest texts, each within the limit —; no texts where the start may carry none', () => {
    const held = chatOf(30);
    const snapshot = snapshotOf(held, request(60));
    const proof = startProofOf(snapshot, { maxItems: 3, maxChars: 4 }, NOW_ISO);
    expect(proof.knownFanMessageIds).toEqual([...snapshot.knownFanMessageIds].reverse());
    expect(proof.tail?.map((message) => [message.platformMessageId, message.text])).toEqual(snapshot.tail?.slice(-3).map((message) => [message.platformMessageId, message.text.slice(0, 4)]));
    expect(startProofOf(snapshot, null, NOW_ISO)).not.toHaveProperty('tail');
    expect(startProofOf(snapshotOf(held, request(60), { truncated: true, tail: snapshot.tail?.slice(1) ?? [] }), { maxItems: 60, maxChars: 5000 }, NOW_ISO).truncated).toBe(true);
    expect(startProofOf(snapshotOf(held, request(60), { completeness: 'unknown', gap: 'socket' }), null, NOW_ISO).completeness).toBe('unknown');
  });

  it('more deletions than the hub takes (60): the newest 60 go, and the observation reads unknown — never a quiet loss', () => {
    // Two of every three messages deleted: the 60 live ones span 120 deletions (MAIN's ring holds 120 records).
    const held = chatOf(180).map((message, n) => (n % 3 === 0 ? message : { ...message, deleted: true }));
    const snapshot = snapshotOf(held, request(60));
    expect(snapshot.deletedIds.length).toBeGreaterThan(60);
    const proof = startProofOf(snapshot, null, NOW_ISO);
    expect([proof.deletedIds, proof.completeness]).toEqual([snapshot.deletedIds.slice(-60), 'unknown']);
  });

  it('the background never asks for fewer messages than the window it checks (HF-8г): a count the plan cut below it is raised to it; ChatSpace’s starts have no proof and ask as before', () => {
    const held = chatOf(80);
    const proof = startProofOf(snapshotOf(held, request(60)), null, NOW_ISO);
    const start: StartOp = { feature: 'review', surface: 'dock', target: fanslyTarget, cause: { kind: 'click', actionToken: uuid(0x77) }, tone: null, split: false, window: 3000, proof };
    const ctx = { opId: uuid(0x78), persona: PERSONA, bootstrap: { ...BOOTSTRAP, limits: { ...BOOTSTRAP.limits, deepMax: 40 } }, debug: false, freshText: true };
    const built = buildStreamRequest(start, ctx);
    if (!built.ok) throw new Error(built.issues);
    expect([built.request.body.messageCount, built.request.body.coverageCheck?.window.length]).toEqual([60, 60]);
    const { proof: _proof, ...withoutProof } = start;
    const plain = buildStreamRequest(withoutProof, ctx);
    if (!plain.ok) throw new Error(plain.issues);
    expect([plain.request.body.messageCount, plain.request.body.coverageCheck, plain.request.body.knownFanMessageIds, plain.request.capabilities]).toEqual([40, undefined, undefined, ['context-v1']]);
  });
});
