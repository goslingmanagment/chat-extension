// The background wired whole (architecture.md §5.4, §7, §8, §9): the
// composition root on the fake browser against the in-process fake hub
// (test/support/world.ts), asked the way tabs and pages ask it.
// - every request of the frozen protocol has a handler;
// - operations: three per tab and the fourth refused with the list, a
//   background that was unloaded mid-stream, a sign-out mid-stream, another
//   persona;
// - the X8 journal read back, the dossier save, the greeting leases of two
//   installs on one hub, the sound's decisions, a page's command for a tab,
//   «Очистить локальные данные», the update record;
// - what an expired bootstrap blocks and what it leaves;
// - the dev compat mode against a hub without `client/bootstrap`.

import { CONTRACTS_VERSION, DEFAULT_SETTINGS, STORAGE_KEYS, TAB_REQUESTS, TAB_REQUEST_TYPES, parseTabPayload, type IncomingFact, type SendJournalEntry, type TabRequestType } from '@cg/contracts';
import { TAB_REQUEST_FIXTURES, account, chat, journalEntry } from '@cg/contracts/fixtures';
import { GREETING_LEASES_KEY, createSendJournal } from '@cg/core/services';
import { createKeyValueStore, createTabRpcClient } from '@cg/platform';
import { PILOT_CAPABILITIES, callsTo, hubErrorBody } from '@cg/testing/fake-hub';
import { WORLD } from '@cg/testing/hub';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { pageSender } from '../../../packages/platform/src/test-support/fake-browser.ts';
import { UPDATED_KEY } from '../src/composition/background.ts';
import { admitted, bindingOf, opsOf, signInWithPersona, startReply, workingTab } from './support/tabs.ts';
import { CHATSPACE_ORIGIN, PASSWORD, createWorld, settingsFor, sleep, until, type World } from './support/world.ts';

const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const PAGE_ID = WORLD.pages.one.pageId;
const PAGE = WORLD.pages.one.pageLabel;

const worlds: World[] = [];
function world(options?: Parameters<typeof createWorld>[0]): World {
  const made = createWorld(options);
  worlds.push(made);
  return made;
}
beforeEach(() => {
  for (const level of ['debug', 'info', 'warn', 'error'] as const) vi.spyOn(console, level).mockImplementation(() => undefined);
});
afterEach(async () => {
  for (const made of worlds.splice(0)) made.dispose();
  // What a disposed event page still had in flight (a stream cut short) says its last words to the muted console.
  await sleep(30);
  vi.restoreAllMocks();
});

/** A generation takes this long per chunk of sixteen characters: long enough to act while it runs. */
function slowStreams(w: World, aiChunkDelayMs = 250): void {
  w.hub.control({ op: 'config', patch: { aiChunkDelayMs } });
}

describe('the frozen protocol', () => {
  it('[EX-015] every request type has a handler: none answers «no handler», «not implemented» or an answer outside its schema', async () => {
    const w = world();
    w.start();
    const tab = await workingTab(w);
    const unanswered: string[] = [];
    for (const type of TAB_REQUEST_TYPES.filter((name): name is Exclude<TabRequestType, 'tab.register'> => name !== 'tab.register')) {
      const spec: { readonly from: readonly string[]; readonly pages?: readonly string[] } = TAB_REQUESTS[type];
      const payload = TAB_REQUEST_FIXTURES[type].req.valid[0];
      const ask = spec.from.includes('tab')
        ? tab.client.request(type as never, payload as never)
        : w.page((spec.pages?.[0] ?? 'options') as 'options').request(type as never, payload as never);
      const answer = (await ask) as { readonly ok: boolean; readonly error?: { readonly code: string; readonly detail?: string } };
      const detail = answer.error?.detail ?? '';
      if (!answer.ok && (answer.error?.code === 'CG-UNKNOWN' || /not implemented|no handler|handler failed|invalid .* response/.test(detail))) unanswered.push(`${type}: ${answer.error?.code ?? ''} ${detail}`);
    }
    expect(unanswered).toEqual([]);
  });
});

describe('operations (§7)', () => {
  it('[AI-123] three generations run at once in one tab; the fourth is refused with the list of the three, and nothing of it reaches the hub', async () => {
    const w = world();
    w.start();
    await signInWithPersona(w);
    slowStreams(w);
    const tab = await workingTab(w);
    const binding = await bindingOf(tab);
    const fans = ['2002', '2003', '2004', '2005'] as const;
    const running = [];
    for (const fan of fans.slice(0, 3)) running.push(admitted(await startReply(tab, binding, fan)));
    await until(() => callsTo(w.hub.read().entries, 'aiFeatureStream').length === 3, 'three streams are open at the hub');

    const fourth = await startReply(tab, binding, fans[3]);
    expect(fourth).toMatchObject({ ok: true, payload: { ok: false, code: 'CG-OP-TAB-LIMIT' } });
    const listed = fourth.ok && !fourth.payload.ok ? fourth.payload.active : [];
    expect(listed.map((item) => item.opId).sort()).toEqual([...running].sort());
    expect(listed.map((item) => item.chat.platformFanId).sort()).toEqual(fans.slice(0, 3));
    for (const item of listed) expect(item).toMatchObject({ feature: 'reply', surface: 'dock' });

    await until(async () => (await opsOf(tab)).filter((op) => op.state === 'done').length === 3, 'the three ended', 15_000);
    // Three POSTs, not four: a refusal spends nothing on the hub, and nothing waited in a queue to start later.
    expect(callsTo(w.hub.read().entries, 'aiFeatureStream')).toHaveLength(3);
    // The slot is free again.
    expect(await startReply(tab, binding, fans[3])).toMatchObject({ ok: true, payload: { ok: true } });
  });

  it('[BG-004] [RB-003] a background unloaded in the middle of a stream: the operation comes back interrupted, and the new instance asks the hub nothing', async () => {
    const w = world();
    w.start();
    await signInWithPersona(w);
    slowStreams(w, 400);
    const tab = await workingTab(w);
    const opId = admitted(await startReply(tab, await bindingOf(tab)));
    await until(async () => (await opsOf(tab)).some((op) => op.opId === opId && op.state === 'streaming'), 'the stream is running');
    const posts = callsTo(w.hub.read().entries, 'aiFeatureStream').length;
    expect(posts).toBe(1);

    w.fake.suspendBackground();
    await until(() => w.starts() === 2 && tab.client.state() === 'ready', 'the tab registered with the new instance');
    const after = (await opsOf(tab)).find((op) => op.opId === opId);
    expect(after).toMatchObject({ state: 'interrupted', error: { code: 'CG-OP-INTERRUPTED' } });
    expect(after?.result).toBeUndefined();
    expect(after?.text).toBeUndefined();
    await sleep(600);
    // Never POSTed again: not by the restore, not by a timer of the page that is gone.
    expect(callsTo(w.hub.read().entries, 'aiFeatureStream')).toHaveLength(posts);
    expect((await opsOf(tab)).find((op) => op.opId === opId)?.state).toBe('interrupted');
  });

  it('[AI-126] [AU-018] a sign-out in the middle of a stream cancels it: the tab hears why, the results of that person are gone, nothing is delivered after it', async () => {
    const w = world();
    w.start();
    await signInWithPersona(w);
    slowStreams(w, 400);
    const tab = await workingTab(w);
    const binding = await bindingOf(tab);
    const ended: { opId: string; state: string; code: string | null }[] = [];
    const sessions: (string | null)[] = [];
    tab.client.onEvent('op.done', ({ view }) => ended.push({ opId: view.opId, state: view.state, code: view.error?.code ?? null }));
    tab.client.onEvent('session.changed', ({ session, reason }) => sessions.push(session === null ? reason : session.login));
    const opId = admitted(await startReply(tab, binding));
    await until(async () => (await opsOf(tab)).some((op) => op.opId === opId && op.state === 'streaming'), 'the stream is running');

    expect(await w.page().request('session.signOut', {})).toMatchObject({ ok: true, payload: { serverRevoked: true } });
    await until(() => ended.length === 1, 'the tab heard the end of its operation');
    expect(ended).toEqual([{ opId, state: 'canceled', code: 'CG-CONTEXT-CHANGED' }]);
    expect(sessions).toEqual(['sign-out']);
    // Nothing of the previous person is left to list, and the hub's late frames (if any) reach nobody.
    expect(await opsOf(tab)).toEqual([]);
    await sleep(900);
    expect(ended).toHaveLength(1);
    expect(await opsOf(tab)).toEqual([]);
    // A start without a sign-in is refused before anything is admitted.
    expect(await startReply(tab, binding)).toMatchObject({ ok: false, error: { code: 'CG-AUTH-REQUIRED' } });
  });

  it('[TL-012] [AU-018] what waited in the telemetry queue for the previous sign-in is dropped at the sign-out, not sent under the next one', async () => {
    const w = world();
    // The person agreed to technical data: `ai_acceptance` may be queued.
    w.fake.permissions.data_collection.add('technicalAndInteraction');
    w.start();
    await signInWithPersona(w);
    const tab = await workingTab(w);
    const opId = admitted(await startReply(tab, await bindingOf(tab)));
    await until(async () => (await opsOf(tab)).find((op) => op.opId === opId)?.state === 'done', 'a result is there');
    const options = w.page();
    const telemetryOf = async () => {
      const diagnostics = await options.request('diagnostics.get', {});
      return diagnostics.ok ? diagnostics.payload.telemetry : null;
    };
    // The hub does not answer: the event waits in the queue.
    w.net.down = true;
    expect(await tab.client.request('op.reportShown', { opId })).toEqual({ ok: true, payload: { recorded: true } });
    await until(async () => (await telemetryOf())?.queued === 1, 'the event is queued');
    const before = (await telemetryOf())?.dropped ?? 0;
    expect(await options.request('session.signOut', {})).toMatchObject({ ok: true });
    await until(async () => (await telemetryOf())?.queued === 0, 'the queue is empty');
    expect((await telemetryOf())?.dropped).toBe(before + 1);
    // Another person signs in to a hub that answers again: nothing of the previous one is sent.
    w.net.down = false;
    const ingested = callsTo(w.hub.read().entries, 'ingestObservations').length;
    await signInWithPersona(w, { username: WORLD.otherUser.username, password: 'synthetic-password-2' });
    await sleep(1200);
    expect(callsTo(w.hub.read().entries, 'ingestObservations')).toHaveLength(ingested);
  });

  it('[AI-126] another persona of the page cancels its running operations with CG-PERSONA-CHANGED; the hub address is locked while signed in', async () => {
    const w = world();
    w.start();
    await signInWithPersona(w);
    slowStreams(w, 400);
    const tab = await workingTab(w);
    const opId = admitted(await startReply(tab, await bindingOf(tab)));
    await until(async () => (await opsOf(tab)).some((op) => op.opId === opId && op.state === 'streaming'), 'the stream is running');
    w.hub.control({ op: 'persona', key: 'second', definitionId: WORLD.persona.otherDefinitionId, displayName: 'Second' });
    const saved = await w.page().request('persona.set', { pageId: PAGE_ID, key: 'second', definitionId: WORLD.persona.otherDefinitionId });
    expect(saved).toMatchObject({ ok: true });
    await until(async () => (await opsOf(tab)).find((op) => op.opId === opId)?.state === 'canceled', 'the operation was canceled');
    expect((await opsOf(tab)).find((op) => op.opId === opId)?.error?.code).toBe('CG-PERSONA-CHANGED');
    // ST-042: the other way to change what operations are bound to — another hub — is closed while signed in.
    expect(await w.page().request('settings.patchRestricted', { patch: { hub: { baseUrl: 'https://other-hub.example.test' } }, baseRevision: null })).toMatchObject({ ok: false, error: { code: 'CG-HUB-URL' } });
  });

  it('[AI-133] the hub layer’s one retry of a 503 is the operation’s `retry-wait` phase with its time, then the stream', async () => {
    const w = world();
    w.start();
    await signInWithPersona(w);
    const tab = await workingTab(w);
    const phases: { name: string; retryAt: number | undefined }[] = [];
    tab.client.onEvent('op.update', ({ phase }) => phases.push({ name: phase.name, retryAt: phase.retryAt }));
    // The hub's own structured refusal: the hub layer makes its one retry of exactly this (§7 «Повтор»).
    w.hub.control({ op: 'scriptSse', responses: [{ kind: 'http-error', status: 503, body: hubErrorBody('service_unavailable', 503) }] });
    const started = Date.now();
    const opId = admitted(await startReply(tab, await bindingOf(tab)));
    await until(() => phases.some((phase) => phase.name === 'retry-wait'), 'the operation says it waits for the retry');
    const wait = phases.find((phase) => phase.name === 'retry-wait');
    expect(wait?.retryAt).toBeGreaterThanOrEqual(started + 4_000);
    expect(wait?.retryAt).toBeLessThanOrEqual(Date.now() + 5_100);
    await until(async () => (await opsOf(tab)).find((op) => op.opId === opId)?.state === 'done', 'the retry streamed', 15_000);
    // One refusal, one stream: the retry was the hub layer's, the scheduler POSTed nothing of its own.
    expect(callsTo(w.hub.read().entries, 'aiFeatureStream').map((entry) => entry.status)).toEqual([503, 200]);
  });

  it('a hub that offers `context-v1` and `split-all-v1` is answered by the archive: the stream declares only what the vendored SDK carries, and the generation runs', async () => {
    const w = world();
    w.start();
    await signInWithPersona(w);
    // The pilot preset declares every capability, `context-v1` among them.
    expect(PILOT_CAPABILITIES).toContain('context-v1');
    const tab = await workingTab(w);
    const binding = await bindingOf(tab);
    const fresh = { capturedAt: new Date().toISOString(), messages: [{ platformMessageId: '4004', direction: 'fan' as const, sentAt: new Date().toISOString(), text: 'synthetic line' }] };
    const opId = admitted(await startReply(tab, binding, chat.platformFanId, { fresh }));
    await until(async () => (await opsOf(tab)).find((op) => op.opId === opId)?.state !== 'streaming' && (await opsOf(tab)).find((op) => op.opId === opId)?.endedAt !== undefined, 'the generation ended');
    expect((await opsOf(tab)).find((op) => op.opId === opId)).toMatchObject({ state: 'done' });
    const [call] = callsTo(w.hub.read().entries, 'aiFeatureStream');
    expect(call?.status).toBe(200);
    // No `context_v1` frame was asked for, and the page's fresh text did not leave the browser.
    expect(call?.stream?.frames).not.toContain('context_v1');
    expect(JSON.stringify(call?.request)).not.toContain('liveTextContext');
  });
});

describe('a tab that asks about its page before it said which accounts it shows (§5.4)', () => {
  const STATS = { pageId: PAGE_ID, windowDays: 30, timeZone: 'Europe/Moscow' } as const;

  it('[SP-001] [HK-024] a request that outruns the tab’s first presence report waits for the report and is answered by it — not refused as «page not granted»', async () => {
    const w = world();
    w.start();
    await signInWithPersona(w);
    const { client } = w.tabClient(7);
    await until(() => client.state() === 'ready', 'the tab registered');
    // A key of ours pressed while the page loaded runs the instant the controllers are in: the board asks at once.
    let answered = false;
    const asked = client.request('spenders.stats', STATS).then((answer) => {
      answered = true;
      return answer;
    });
    await sleep(200);
    expect(answered).toBe(false);
    expect(callsTo(w.hub.read().entries, 'clientSpenderStats')).toHaveLength(0);
    // The report the tab sends a moment after its registration.
    expect(await client.request('tab.presence', { chat, routeEpoch: 1, visible: true, focused: true, accounts: [account] })).toMatchObject({ ok: true });
    expect(await asked).toMatchObject({ ok: true, payload: { pageLabel: PAGE } });
    expect(callsTo(w.hub.read().entries, 'clientSpenderStats')).toHaveLength(1);
  });

  it('a tab whose accounts are known and none of them is bound to the page is refused at once, and the hub is not asked', async () => {
    const w = world();
    w.start();
    await signInWithPersona(w);
    const { client } = w.tabClient(7);
    await until(() => client.state() === 'ready', 'the tab registered');
    const stranger = { ...account, hostAccountId: '1999', platformAccountId: '3999' };
    expect(await client.request('tab.presence', { chat: null, routeEpoch: 1, visible: true, focused: true, accounts: [stranger] })).toMatchObject({ ok: true });
    const started = Date.now();
    expect(await client.request('spenders.stats', STATS)).toMatchObject({ ok: false, error: { code: 'CG-BINDING-NOT-GRANTED' } });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(callsTo(w.hub.read().entries, 'clientSpenderStats')).toHaveLength(0);
  });
});

describe('X8 attempts and the dossier save', () => {
  it('[X8-07] `send.list` answers from the journal of this install: an attempt the previous instance left half-way holds its fan as uncertain', async () => {
    const w = world();
    // The previous instance journaled an attempt and ChatSpace took it into its queue; then the page was gone.
    const seed = w.fake.context(pageSender(w.fake, 'debug-journal')).api;
    const journal = createSendJournal({ local: createKeyValueStore('local', { api: seed }) });
    await journal.start();
    const attempt: SendJournalEntry = { ...journalEntry, attemptId: uuid(41), createdAt: Date.now() - 4000, updatedAt: Date.now() - 4000 };
    expect(await journal.begin(attempt)).toMatchObject({ ok: true });
    expect(await journal.advance(attempt.attemptId, { state: 'nativeEnqueued', pendingId: uuid(42) })).toMatchObject({ ok: true });
    journal.dispose();

    w.start();
    await signInWithPersona(w);
    const tab = await workingTab(w);
    const listed = await tab.client.request('send.list', { pageId: PAGE_ID, fanRef: attempt.fanRef });
    expect(listed).toMatchObject({ ok: true, payload: { truncated: false, attempts: [{ opId: attempt.opId, partIndex: 0, view: { attemptId: attempt.attemptId, state: 'uncertain' } }] } });
    // Another fan of the page has none; a page the tab is not bound to is not answered at all.
    expect(await tab.client.request('send.list', { pageId: PAGE_ID, fanRef: '2003' })).toEqual({ ok: true, payload: { attempts: [], truncated: false } });
    expect(await tab.client.request('send.list', { pageId: WORLD.pages.vip.pageId, fanRef: attempt.fanRef })).toEqual({ ok: false, error: { code: 'CG-BINDING-NOT-GRANTED' } });
  });

  it('[AI-068] `recap.save` is one link write by the generation: `not-ready` while the hub has not finished it, `saved` after, `rejected` for a generation that cannot be a dossier', async () => {
    const w = world();
    w.start();
    await signInWithPersona(w);
    w.hub.control({ op: 'config', patch: { generationVisibleAfterMs: 400 } });
    const tab = await workingTab(w);
    const binding = await bindingOf(tab);
    const recap = admitted(await startReply(tab, binding, chat.platformFanId, { feature: 'recap', window: 3000 }));
    await until(async () => (await opsOf(tab)).find((op) => op.opId === recap)?.state === 'done', 'the recap ended');
    const generationRef = (await opsOf(tab)).find((op) => op.opId === recap)?.generationRef ?? '';
    const before = callsTo(w.hub.read().entries, 'aiFeatureStream').length;

    const early = await tab.client.request('recap.save', { pageId: PAGE_ID, fanRef: chat.platformFanId, generationRef, opId: recap });
    expect(early).toEqual({ ok: true, payload: { state: 'not-ready', savedAt: null } });
    await sleep(450);
    const late = await tab.client.request('recap.save', { pageId: PAGE_ID, fanRef: chat.platformFanId, generationRef, opId: recap });
    expect(late).toMatchObject({ ok: true, payload: { state: 'saved' } });
    expect(typeof (late.ok ? late.payload.savedAt : null)).toBe('string');
    // A reply is not a full recap: the hub refuses it for good.
    const reply = admitted(await startReply(tab, binding, '2003'));
    await until(async () => (await opsOf(tab)).find((op) => op.opId === reply)?.state === 'done', 'the reply ended');
    await sleep(450);
    const replyRef = (await opsOf(tab)).find((op) => op.opId === reply)?.generationRef ?? '';
    expect(await tab.client.request('recap.save', { pageId: PAGE_ID, fanRef: '2003', generationRef: replyRef })).toEqual({ ok: true, payload: { state: 'rejected', savedAt: null } });
    // Never a new generation.
    expect(callsTo(w.hub.read().entries, 'aiFeatureStream')).toHaveLength(before + 1);
  });
});

describe('a human send of a part that came from a board (§6.6, H-7)', () => {
  it('[NF-019] [TL-004] `op.reportSent` for a «Новые» greeting registers the native send at the hub: the fan is greeted; the dock’s own reply is not registered', async () => {
    const w = world();
    w.start();
    await signInWithPersona(w);
    const tab = await workingTab(w);
    const binding = await bindingOf(tab);
    const FAN = WORLD.newFan;
    // A greeting generated in a «Новые» card (its own token surface), inserted by «Открыть и вставить», sent by the person.
    const token = await tab.client.request('token.issue', { kind: 'generate', surface: 'newcomers' });
    const greeting = await tab.client.request('op.start', {
      feature: 'hi',
      surface: 'newcomers',
      target: { binding, chat: { ...chat, platformFanId: FAN }, fanRef: FAN, conversationRef: FAN },
      cause: { kind: 'click', actionToken: token.ok ? token.payload.actionToken : '' },
      tone: null,
      split: false,
      window: 100,
      variantCount: 1,
    });
    const opId = admitted(greeting);
    await until(async () => (await opsOf(tab)).find((op) => op.opId === opId)?.state === 'done', 'the greeting is ready');
    expect(await tab.client.request('op.reportSent', { opId, part: { variant: 0, index: 0 }, pendingId: 'pending-1', platformMessageId: '4100', edited: false })).toMatchObject({ ok: true });
    await until(() => callsTo(w.hub.read().entries, 'clientFanClaim').length === 1, 'the hub heard of the send');
    const [claim] = callsTo(w.hub.read().entries, 'clientFanClaim');
    expect(claim).toMatchObject({ status: 200, request: { fanRef: FAN, body: { action: 'registerNativeSend', purpose: 'greeting', partIndex: 0, platformMessageId: '4100' } } });
    const status = w.hub.control({ op: 'status' }) as { claims: { fanRef: string; greeting: string }[] };
    expect(status.claims.find((item) => item.fanRef === FAN)?.greeting).toBe('confirmed');

    // A reply of the open chat's dock: telemetry only, nothing for the hub's custody.
    const reply = admitted(await startReply(tab, binding));
    await until(async () => (await opsOf(tab)).find((op) => op.opId === reply)?.state === 'done', 'the reply is ready');
    expect(await tab.client.request('op.reportSent', { opId: reply, part: { index: 0 }, pendingId: 'pending-2', platformMessageId: '4101', edited: true })).toMatchObject({ ok: true });
    await sleep(100);
    expect(callsTo(w.hub.read().entries, 'clientFanClaim')).toHaveLength(1);
  });
});

describe('the greeting leases of «Новые» (H-7)', () => {
  const FAN = WORLD.newFan;
  const claim = (tab: Awaited<ReturnType<typeof workingTab>>, action: 'claim' | 'renew' | 'release', fanRef: string = FAN) => tab.client.request('newcomers.claim', { pageId: PAGE_ID, fanRef, action });

  it('[NF-021] two installs, one fan: the first to press Hi holds the lease, the colleague is refused with CG-CLAIM-BUSY until it is released', async () => {
    const mine = world();
    const theirs = world({ hub: mine.hub });
    mine.start();
    theirs.start();
    await signInWithPersona(mine);
    await signInWithPersona(theirs, { username: WORLD.otherUser.username, password: 'synthetic-password-2' });
    const myTab = await workingTab(mine);
    const theirTab = await workingTab(theirs);

    const [first, second] = await Promise.all([claim(myTab, 'claim'), claim(theirTab, 'claim')]);
    // Exactly one of the two holds it, whichever the hub heard first.
    const winners = [first, second].filter((answer) => answer.ok && answer.payload.lease.state === 'owned');
    const losers = [first, second].filter((answer) => !answer.ok);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0]).toMatchObject({ ok: false, error: { code: 'CG-CLAIM-BUSY' } });
    const [winner, loser] = first.ok ? [myTab, theirTab] : [theirTab, myTab];

    // The loser has no token: a renewal of its own asks the hub nothing and reads «бронь истекла».
    const claimsBefore = callsTo(mine.hub.read().entries, 'clientFanClaim').length;
    expect(await claim(loser, 'renew')).toEqual({ ok: false, error: { code: 'CG-CLAIM-EXPIRED' } });
    expect(callsTo(mine.hub.read().entries, 'clientFanClaim')).toHaveLength(claimsBefore);
    // The winner renews with its token; the loser sees a colleague's lease, never whose.
    expect(await claim(winner, 'renew')).toMatchObject({ ok: true, payload: { lease: { state: 'owned' } } });
    expect(await claim(loser, 'release')).toMatchObject({ ok: true, payload: { lease: { state: 'held', heldBy: 'someone-else', leaseToken: null } } });
    // Released explicitly: the fan is free for the colleague.
    expect(await claim(winner, 'release')).toMatchObject({ ok: true, payload: { lease: { state: 'released' } } });
    expect(await claim(loser, 'claim')).toMatchObject({ ok: true, payload: { lease: { state: 'owned' } } });
  });

  it('[NF-021] [BG-004] one install: a second tab joins the lease with the same token, and the token survives an unload of the event page', async () => {
    const w = world();
    w.start();
    await signInWithPersona(w);
    const first = await workingTab(w, 7);
    const second = await workingTab(w, 8);
    const heard: number[] = [];
    second.client.onEvent('newcomers.changed', ({ pageId }) => heard.push(pageId));

    const taken = await claim(first, 'claim');
    expect(taken).toMatchObject({ ok: true, payload: { lease: { state: 'owned' } } });
    const token = taken.ok ? taken.payload.lease.leaseToken : null;
    // The other tab of this browser is told to read its list again, and gets the same lease when it asks.
    await until(() => heard.length === 1, 'the other tab heard of the lease');
    expect(heard).toEqual([PAGE_ID]);
    expect(await claim(second, 'claim')).toMatchObject({ ok: true, payload: { lease: { state: 'owned', leaseToken: token } } });
    expect(w.fake.areas.session.get(GREETING_LEASES_KEY)).toMatchObject({ v: 1, leases: [{ pageId: PAGE_ID, fanRef: FAN, leaseToken: token }] });

    w.fake.suspendBackground();
    await until(() => w.starts() === 2 && first.client.state() === 'ready', 'the tab registered with the new instance');
    await first.client.request('tab.presence', { chat, routeEpoch: 2, visible: true, focused: true, accounts: [account] });
    expect(await claim(first, 'renew')).toMatchObject({ ok: true, payload: { lease: { state: 'owned', leaseToken: token } } });
  });

  it('[NF-021] a sign-out forgets the lease tokens of the person and removes the preview drafts from disk', async () => {
    const w = world();
    w.start();
    await signInWithPersona(w);
    const tab = await workingTab(w);
    expect(await claim(tab, 'claim')).toMatchObject({ ok: true });
    // A draft a tab left in storage.local; no tab is open to erase it at the sign-out.
    w.fake.areas.local.set(STORAGE_KEYS.newcomersDrafts, { v: 1, drafts: [] });
    expect(await w.page().request('session.signOut', {})).toMatchObject({ ok: true });
    await until(() => !w.fake.areas.local.has(STORAGE_KEYS.newcomersDrafts), 'the drafts key is gone');
    await until(() => (w.fake.areas.session.get(GREETING_LEASES_KEY) as { leases: unknown[] } | undefined)?.leases.length === 0, 'the lease tokens are gone');
    expect(await claim(tab, 'renew')).toMatchObject({ ok: false });
  });
});

describe('sound (§9.8)', () => {
  let nextMessage = 5000;
  const fact = (over: Partial<IncomingFact> = {}): IncomingFact => ({
    host: 'chatspace',
    hostAccountId: account.hostAccountId,
    platformFanId: '2003',
    platformMessageId: String((nextMessage += 1)),
    fromFan: true,
    automatic: false,
    tip: false,
    sentAt: new Date().toISOString(),
    socketEpoch: 1,
    fanSequence: 1,
    source: 'ws-tap',
    ...over,
  });
  const soundOf = async (w: World) => {
    const diagnostics = await w.page().request('diagnostics.get', {});
    return diagnostics.ok ? diagnostics.payload.sound : null;
  };

  it('[SN-001] [SN-002] [SN-008] [SN-010] a fan’s message in a chat that is not in front rings once; our own message, the chat in front and a second report of the same message do not', async () => {
    const w = world();
    w.start();
    // No sign-in: the message sound needs only ChatSpace, the permission and the switch.
    const tab = await workingTab(w);
    const first = fact();
    expect(await tab.client.request('sound.event', { fact: first })).toEqual({ ok: true, payload: { played: true } });
    expect(w.played).toHaveLength(1);
    // The same message reported again (another source, another tab): already decided.
    const other = await workingTab(w, 8, { focused: false });
    expect(await other.client.request('sound.event', { fact: { ...first, source: 'store' } })).toEqual({ ok: true, payload: { played: false, reason: 'duplicate' } });
    // Not from the fan; and the chat the person is looking at.
    expect(await tab.client.request('sound.event', { fact: fact({ fromFan: false }) })).toEqual({ ok: true, payload: { played: false, reason: 'not-fan' } });
    expect(await tab.client.request('sound.event', { fact: fact({ platformFanId: chat.platformFanId }) })).toEqual({ ok: true, payload: { played: false, reason: 'open-chat' } });
    expect(w.played).toHaveLength(1);
    const sound = await soundOf(w);
    expect(sound).toMatchObject({ listeningTabs: 2, outcomes: { played: 1, duplicate: 1, 'not-fan': 1, 'open-chat': 1 } });
    expect(typeof sound?.lastIncomingAt).toBe('string');
  });

  it('[SN-009] [ST-075] a second message within two seconds waits out the pause; a muted account and a switched-off sound stay silent; a page cannot report a fact', async () => {
    const w = world();
    w.start();
    const tab = await workingTab(w);
    expect(await tab.client.request('sound.event', { fact: fact() })).toMatchObject({ ok: true, payload: { played: true } });
    expect(await tab.client.request('sound.event', { fact: fact() })).toEqual({ ok: true, payload: { played: false, reason: 'throttled' } });
    const options = w.page();
    expect(await options.request('settings.patch', { patch: { sound: { mutedAccounts: [`chatspace:${account.hostAccountId}`] } }, baseRevision: null })).toMatchObject({ ok: true });
    expect(await tab.client.request('sound.event', { fact: fact() })).toEqual({ ok: true, payload: { played: false, reason: 'muted' } });
    expect(await options.request('settings.patch', { patch: { sound: { mutedAccounts: [], messages: { on: false, tone: DEFAULT_SETTINGS.sound.messages.tone } } }, baseRevision: null })).toMatchObject({ ok: true });
    expect(await tab.client.request('sound.event', { fact: fact() })).toEqual({ ok: true, payload: { played: false, reason: 'disabled' } });
    expect(w.played).toHaveLength(1);
  });

  it('[SN-001] without the host permission nothing rings: the extension has no business on that site', async () => {
    const w = world();
    w.fake.permissions.origins.clear();
    w.start();
    const tab = await workingTab(w);
    expect(await tab.client.request('sound.event', { fact: fact() })).toEqual({ ok: true, payload: { played: false, reason: 'no-permission' } });
    expect(w.played).toEqual([]);
  });

  it('[ST-131] «Проверить звук» plays the chosen tone at the chosen volume through the same player, whatever the rules say', async () => {
    const w = world();
    w.start();
    expect(await w.page().request('sound.preview', { tone: 'bell', volume: 50 })).toEqual({ ok: true, payload: { played: true } });
    expect(w.played).toHaveLength(1);
    expect(w.played[0]?.level).toBeGreaterThan(0);
    expect(w.played[0]?.notes).toBeGreaterThan(0);
  });

  it('[SN-012] a new subscriber rings once, from the list a tab reads for its open «Новые» window; what was there at the first read does not', async () => {
    const w = world();
    w.start();
    await signInWithPersona(w);
    const tab = await workingTab(w);
    const other = await workingTab(w, 8, { focused: false });
    const heard: number[] = [];
    other.client.onEvent('newcomers.changed', ({ pageId }) => heard.push(pageId));
    const list = () => tab.client.request('newcomers.list', { pageId: PAGE_ID, windowHours: 48, cursor: null });
    // The first read is the baseline: old subscriptions are not news.
    expect(await list()).toMatchObject({ ok: true });
    await sleep(50);
    expect(w.played).toEqual([]);
    w.hub.control({ op: 'audienceEvent', pageLabel: PAGE, fanRef: '2077' });
    expect(await list()).toMatchObject({ ok: true });
    await until(() => w.played.length === 1, 'the new subscriber rang');
    // The other tab is told to read its list; the tab that read it is not asked to read it again.
    await until(() => heard.length >= 1, 'the other tab heard of the new subscriber');
    expect(new Set(heard)).toEqual(new Set([PAGE_ID]));
    // The same list again: nothing new, nothing rings.
    expect(await list()).toMatchObject({ ok: true });
    await sleep(50);
    expect(w.played).toHaveLength(1);
    expect((await soundOf(w))?.outcomes).toMatchObject({ 'subscriber.played': 1 });
  });
});

describe('a click on an extension page that acts in ChatSpace (`tab.command`)', () => {
  it('[PU-017] the popup’s «Spenders»: the tab the person works in comes to the front and gets the command; without a ChatSpace tab nothing is delivered', async () => {
    const w = world();
    w.start();
    const popup = w.page('popup');
    expect(await popup.request('tab.command', { command: { kind: 'surface', surface: 'spenders' } })).toEqual({ ok: true, payload: { delivered: false } });
    expect(w.fake.tabCalls).toEqual([]);

    const behind = await workingTab(w, 7, { focused: false, visible: false });
    const front = await workingTab(w, 8);
    const got: { tab: number; command: unknown }[] = [];
    behind.client.onEvent('tab.command', ({ command }) => got.push({ tab: 7, command }));
    front.client.onEvent('tab.command', ({ command }) => got.push({ tab: 8, command }));
    expect(await popup.request('tab.command', { command: { kind: 'surface', surface: 'spenders' } })).toEqual({ ok: true, payload: { delivered: true } });
    await until(() => got.length === 1, 'the command reached a tab');
    expect(got).toEqual([{ tab: 8, command: { kind: 'surface', surface: 'spenders' } }]);
    expect(w.fake.tabCalls).toEqual(['update 8', 'focus window 1']);
  });

  it('[ST-076] «к вкладке» of an account goes to a tab that has the account; an account no tab shows is not delivered; a tab the browser lost is not either', async () => {
    const w = world();
    w.start();
    const options = w.page('options');
    const tab = await workingTab(w, 7, { focused: false });
    const got: unknown[] = [];
    tab.client.onEvent('tab.command', ({ command }) => got.push(command));
    const mine = { kind: 'account', host: 'chatspace', hostAccountId: account.hostAccountId } as const;
    expect(await options.request('tab.command', { command: mine })).toEqual({ ok: true, payload: { delivered: true } });
    await until(() => got.length === 1, 'the command reached the tab');
    expect(got).toEqual([mine]);
    expect(await options.request('tab.command', { command: { ...mine, hostAccountId: '1999' } })).toEqual({ ok: true, payload: { delivered: false } });
    w.fake.closedTabs.add(7);
    expect(await options.request('tab.command', { command: mine })).toEqual({ ok: true, payload: { delivered: false } });
    expect(got).toHaveLength(1);
    // Only the popup and the options page may ask; a tab cannot make another tab act.
    const answer = (await Promise.race([tab.client.request('tab.command' as never, { command: mine } as never), sleep(200).then(() => 'refused' as const)])) as unknown;
    expect(answer === 'refused' || (answer as { ok: boolean }).ok === false).toBe(true);
  });
});

describe('«Очистить локальные данные» and the update record', () => {
  it('[ST-110] caches and logs go — finished results, the log store, the hub layer’s caches; the sign-in, the settings and a running operation stay', async () => {
    const w = world();
    w.start();
    await signInWithPersona(w);
    const tab = await workingTab(w);
    const binding = await bindingOf(tab);
    const finished = admitted(await startReply(tab, binding));
    await until(async () => (await opsOf(tab)).find((op) => op.opId === finished)?.state === 'done', 'a result is there');
    slowStreams(w, 400);
    const running = admitted(await startReply(tab, binding, '2003'));
    await until(async () => (await opsOf(tab)).find((op) => op.opId === running)?.state === 'streaming', 'another one is running');
    const options = w.page();
    const before = await options.request('diagnostics.get', {});
    const footprint = before.ok ? before.payload.footprint : undefined;
    expect([typeof footprint?.cachesKB, typeof footprint?.logsKB]).toEqual(['number', 'number']);
    expect(before.ok && before.payload.logs.records).toBeGreaterThan(0);

    expect(await options.request('data.clear', { confirmed: true })).toEqual({ ok: true, payload: { cleared: true } });
    const ops = await opsOf(tab);
    expect(ops.map((op) => op.opId)).toEqual([running]);
    expect(await options.request('session.get', {})).toMatchObject({ ok: true, payload: { session: { login: WORLD.user.username } } });
    expect(await options.request('settings.get', {})).toMatchObject({ ok: true, payload: { settings: { personas: { byPageId: { [String(PAGE_ID)]: { key: WORLD.persona.key } } } } } });
    const after = await options.request('diagnostics.get', {});
    // The log starts again with the record of the cleanup itself.
    expect(after.ok && after.payload.logs.records).toBeLessThan(before.ok ? before.payload.logs.records : 0);
    await until(async () => (await opsOf(tab)).find((op) => op.opId === running)?.state === 'done', 'the running one ended as usual', 15_000);
    // Only the options page may ask, and only with the confirmation.
    const refused = (await Promise.race([w.page('popup').request('data.clear' as never, { confirmed: true } as never), sleep(200).then(() => 'refused' as const)])) as unknown;
    expect(refused === 'refused' || (refused as { ok: boolean }).ok === false).toBe(true);
  });

  it('[UP-009] an update is remembered with the version it replaced; the tabs that were open before it are counted until they reload', async () => {
    const w = world();
    w.start();
    w.fake.fireInstalled({ reason: 'update', previousVersion: '0.4.2' });
    const options = w.page();
    await until(async () => {
      const diagnostics = await options.request('diagnostics.get', {});
      return diagnostics.ok && diagnostics.payload.extension.updated !== undefined;
    }, 'the update is known');
    expect(w.fake.areas.local.get(UPDATED_KEY)).toMatchObject({ from: '0.4.2' });
    // A tab that was open before the update got the new scripts late.
    const stale = w.fake.context({ ...pageSender(w.fake, 'x'), url: `${CHATSPACE_ORIGIN}/accounts/1001/chats/2002`, origin: CHATSPACE_ORIGIN, frameId: 0, tab: { id: 21, url: `${CHATSPACE_ORIGIN}/accounts/1001/chats/2002` } });
    const late = createTabRpcClient({ api: stale.api, validate: parseTabPayload, register: { host: 'chatspace', lateInjection: true, contractsVersion: CONTRACTS_VERSION } });
    await until(() => late.state() === 'ready', 'the stale tab registered');
    await workingTab(w, 22);
    const diagnostics = await options.request('diagnostics.get', {});
    expect(diagnostics.ok && diagnostics.payload.extension.updated).toMatchObject({ from: '0.4.2', staleTabs: 1 });
    late.close();

    // The next instance of the event page reads the record back; a fresh install forgets it.
    w.fake.suspendBackground();
    const again = await w.page().request('diagnostics.get', {});
    expect(again.ok && again.payload.extension.updated).toMatchObject({ from: '0.4.2' });
    w.fake.fireInstalled({ reason: 'install' });
    await until(() => !w.fake.areas.local.has(UPDATED_KEY), 'the record is gone');
    const fresh = await w.page().request('diagnostics.get', {});
    expect(fresh.ok && fresh.payload.extension.updated).toBeUndefined();
  });
});

describe('«Промпт» from a ChatSpace tab (`debug.open`)', () => {
  it('[DB-006] [DB-007] opens the prompt page with the snapshot’s token in its address — in debug mode only, for a tab only; the next token loads the same tab again', async () => {
    const w = world();
    w.start();
    await signInWithPersona(w);
    const tab = await workingTab(w);
    const created = (): string[] => w.fake.tabCalls.filter((call) => call.includes('debug-prompt'));
    // Debug mode is off: nothing opens, and the answer says so.
    expect(await tab.client.request('debug.open', { token: 'prompt-token-1' })).toEqual({ ok: true, payload: { opened: false } });
    expect(created()).toEqual([]);

    expect(await w.page().request('settings.patchRestricted', { patch: { debug: { enabled: true } }, baseRevision: null })).toMatchObject({ ok: true });
    expect(await tab.client.request('debug.open', { token: 'prompt-token-1' })).toEqual({ ok: true, payload: { opened: true } });
    expect(created()).toEqual([`create ${w.fake.base}debug-prompt.html?t=prompt-token-1`]);
    // The prompt page is open in tab 52 now: another snapshot is shown in it, not in a second tab.
    w.fake.context(pageSender(w.fake, 'debug-prompt', { url: `${w.fake.base}debug-prompt.html?t=prompt-token-1`, tab: { id: 52 }, frameId: 0 }));
    expect(await tab.client.request('debug.open', { token: 'prompt-token-2' })).toEqual({ ok: true, payload: { opened: true } });
    expect(created().at(-1)).toBe(`update 52 ${w.fake.base}debug-prompt.html?t=prompt-token-2`);
    // Only a tab asks: a page opens its pages by itself, and the protocol refuses the request from one.
    const fromPage = (await Promise.race([w.page('options').request('debug.open' as never, { token: 'prompt-token-3' } as never), sleep(200).then(() => 'refused' as const)])) as unknown;
    expect(fromPage === 'refused' || (fromPage as { ok: boolean }).ok === false).toBe(true);
    expect(created()).toHaveLength(2);
  });
});

describe('today’s error counters (ST-056)', () => {
  it('[ST-056] [LG-013] a sign-in the hub refused is one count of its code, not two: the hub layer’s record of the call and the sign-in event are one failure', async () => {
    const w = world();
    w.start();
    const options = w.page();
    expect(await options.request('session.signIn', { login: WORLD.user.username, password: 'not-the-password' })).toMatchObject({ ok: false, error: { code: 'CG-LOGIN-CREDENTIALS' } });
    expect(await options.request('session.signIn', { login: WORLD.user.username, password: 'still-not-it' })).toMatchObject({ ok: false, error: { code: 'CG-LOGIN-CREDENTIALS' } });
    const diagnostics = await options.request('diagnostics.get', {});
    expect(diagnostics.ok && diagnostics.payload.counters['CG-LOGIN-CREDENTIALS']).toBe(2);
    // The sign-in event is in the log all the same, with the code among its facts.
    const file = await options.request('diagnostics.export', { format: 'json' });
    const records = file.ok ? ((JSON.parse(file.payload.body) as { logs?: { recent?: Array<{ msg: string; code?: string; fields?: Record<string, unknown> }> } }).logs?.recent ?? []) : [];
    const failed = records.filter((record) => record.msg === 'sign-in failed');
    expect(failed).toHaveLength(2);
    expect(failed.every((record) => record.code === undefined && record.fields?.['code'] === 'CG-LOGIN-CREDENTIALS')).toBe(true);
  });
});

describe('an expired bootstrap (§8.3)', () => {
  /** The stored bootstrap of this sign-in, made `ms` older; the next instance of the event page finds it expired. */
  function ageBootstrap(w: World, ms: number): void {
    const stored = w.fake.areas.local.get(STORAGE_KEYS.cacheBootstrap) as { fetchedAt: number };
    w.fake.areas.local.set(STORAGE_KEYS.cacheBootstrap, { ...stored, fetchedAt: stored.fetchedAt - ms });
  }

  it('blocks a new insert, navigation and generation while the hub is silent, and takes no result away; when the hub answers again they go through', async () => {
    const w = world();
    w.start();
    await signInWithPersona(w);
    const tab = await workingTab(w);
    const binding = await bindingOf(tab);
    const result = admitted(await startReply(tab, binding));
    await until(async () => (await opsOf(tab)).find((op) => op.opId === result)?.state === 'done', 'a result is there');
    expect(await tab.client.request('token.issue', { kind: 'insert', surface: 'dock' })).toMatchObject({ ok: true });

    // The hub goes silent, the bootstrap runs out (six minutes), the event page starts again.
    w.net.down = true;
    ageBootstrap(w, 6 * 60_000);
    w.fake.suspendBackground();
    await until(() => w.starts() === 2 && tab.client.state() === 'ready', 'the tab registered with the new instance');
    await tab.client.request('tab.presence', { chat, routeEpoch: 2, visible: true, focused: true, accounts: [account] });

    for (const kind of ['insert', 'navigate'] as const) {
      const refused = await tab.client.request('token.issue', { kind, surface: kind === 'insert' ? 'dock' : 'overlay' });
      expect(refused.ok).toBe(false);
      expect(refused.ok ? null : refused.error.code).toMatch(/^CG-(NETWORK|HUB-UNAVAILABLE|HUB-TIMEOUT)$/);
    }
    // A generation is admitted by its token and refused by the hub layer before anything is asked of the model.
    const blocked = admitted(await startReply(tab, binding, '2003'));
    await until(async () => (await opsOf(tab)).find((op) => op.opId === blocked)?.state === 'failed', 'the generation was refused');
    // The result made before it is still there, readable and copyable.
    expect((await opsOf(tab)).find((op) => op.opId === result)).toMatchObject({ state: 'done', result: { kind: 'parts' } });
    expect(await tab.client.request('op.reportCopy', { opId: result })).toMatchObject({ ok: true });

    // The hub is back: the gate reads the bootstrap again and lets the action through.
    w.net.down = false;
    expect(await tab.client.request('token.issue', { kind: 'insert', surface: 'dock' })).toMatchObject({ ok: true });
    expect(await tab.client.request('token.issue', { kind: 'navigate', surface: 'overlay' })).toMatchObject({ ok: true });
  });

  it('the owner’s switches count at the gate: `insertion` off refuses an insert token with its reason; nobody signed in — navigation needs no hub, an insert does', async () => {
    const w = world();
    w.start();
    const tab = await workingTab(w);
    expect(await tab.client.request('token.issue', { kind: 'navigate', surface: 'overlay' })).toMatchObject({ ok: true });
    expect(await tab.client.request('token.issue', { kind: 'insert', surface: 'dock' })).toEqual({ ok: false, error: { code: 'CG-AUTH-REQUIRED' } });
    await signInWithPersona(w);
    expect(await tab.client.request('token.issue', { kind: 'insert', surface: 'dock' })).toMatchObject({ ok: true });
    w.hub.control({ op: 'config', patch: { flags: { insertion: false, navigation: false } } });
    expect(await w.page().request('bootstrap.get', { force: true })).toMatchObject({ ok: true });
    expect(await tab.client.request('token.issue', { kind: 'insert', surface: 'dock' })).toEqual({ ok: false, error: { code: 'CG-FEATURE-DISABLED', detail: 'flag_off' } });
    expect(await tab.client.request('token.issue', { kind: 'navigate', surface: 'overlay' })).toEqual({ ok: false, error: { code: 'CG-FEATURE-DISABLED', detail: 'flag_off' } });
    // A generation and a send have their own gates: the token itself is not refused here.
    expect(await tab.client.request('token.issue', { kind: 'generate', surface: 'dock' })).toMatchObject({ ok: true });
  });
});

describe('the dev compat mode: a hub without `client/bootstrap` (today’s prod hub)', () => {
  it('with debug on: sign-in, the persona catalog and a generation through the existing stream work; what needs a new hub route is unavailable with `hub_not_ready` and never reaches the hub', async () => {
    const w = world({ settings: settingsFor(undefined, { debug: { enabled: true, renderTrace: false } }) });
    w.hub.control({ op: 'config', patch: { clientBootstrap: false, narrowTokens: false } });
    w.start();
    // The dev map: the hub's pages carry no creator id there; never matched by name.
    w.fake.areas.local.set('dev.compatPageAccounts', { [PAGE]: account.platformAccountId });
    const options = w.page();
    const signedIn = await options.request('session.signIn', { login: WORLD.user.username, password: PASSWORD });
    expect(signedIn).toMatchObject({ ok: true });
    const bootstrap = await options.request('bootstrap.get', {});
    expect(bootstrap).toMatchObject({ ok: true, payload: { capabilities: [], configRevision: 0 } });
    const page = bootstrap.ok ? bootstrap.payload.pages.find((item) => item.pageLabel === PAGE) : undefined;
    expect(page?.features).toMatchObject({
      insertion: { available: true },
      navigation: { available: true },
      spenders: { available: true },
      newcomers: { available: false, reason: 'hub_not_ready' },
      preview: { available: false, reason: 'hub_not_ready' },
      stats: { available: false, reason: 'hub_not_ready' },
      recap: { available: false, reason: 'hub_not_ready' },
      freshText: { available: false, reason: 'hub_not_ready' },
      previewSend: { available: false, reason: 'hub_not_ready' },
    });
    const catalog = await options.request('catalog.get', {});
    expect(catalog.ok && catalog.payload.personas.length).toBeGreaterThan(0);
    const diagnostics = await options.request('diagnostics.get', {});
    expect(diagnostics).toMatchObject({ ok: true, payload: { session: { signedIn: true } } });

    // What needs a route this hub does not have is refused here, with a code, and is never asked of the hub.
    const before = w.hub.read().entries.length;
    const newcomers = await w.page('popup').request('newcomers.list', { pageId: PAGE_ID, windowHours: 48, cursor: null });
    expect(newcomers).toMatchObject({ ok: false, error: { code: 'CG-HUB-CAPABILITY' } });
    expect(newcomers.ok ? '' : newcomers.error.detail).toContain('audience-new-v1');
    const recaps = await options.request('recap.read', { pageId: PAGE_ID, fanRef: chat.platformFanId, personaDefinitionId: WORLD.persona.definitionId });
    expect(recaps).toMatchObject({ ok: false, error: { code: 'CG-HUB-CAPABILITY' } });
    expect(recaps.ok ? '' : recaps.error.detail).toContain('shared-recaps-v1');
    expect(w.hub.read().entries).toHaveLength(before);
    // The subscriber poll does not ask either: «Новые» is not usable on this hub.
    await workingTab(w);
    await sleep(100);
    expect(callsTo(w.hub.read().entries, 'clientAudienceNew')).toEqual([]);
    // Debug off: a release build does not keep the dev mode — the full token is erased and revoked.
    expect(await options.request('settings.patchRestricted', { patch: { debug: { enabled: false } }, baseRevision: null })).toMatchObject({ ok: true });
    await until(async () => {
      const session = await options.request('session.get', {});
      return session.ok && session.payload.session === null;
    }, 'the dev sign-in is gone with debug mode');
  });
});
