// The background wired whole (architecture.md §5.4, §7, §8): the composition
// root on the fake browser against the in-process fake hub
// (test/support/world.ts), asked the way tabs and pages ask it.
// - a sign-out mid-stream: the person's results and queued telemetry are gone;
// - what the diagnostics export keeps of a generation (redaction);
// - a tab is answered only for the pages its accounts are bound to;
// - the X8 journal read back; a hand-sent greeting registered once at the hub,
//   across an outage and a restart; the greeting leases of two installs;
// - a release build against a hub without `client/bootstrap`: the full token is
//   revoked and never stored.

import { STORAGE_KEYS, type SendJournalEntry } from '@cg/contracts';
import { account, chat, journalEntry } from '@cg/contracts/fixtures';
import { NATIVE_SENDS_KEY } from '@cg/core/services';
import { createSendJournal } from '@cg/core/services/custody';
import { createKeyValueStore } from '@cg/platform';
import { callsTo } from '@cg/testing/fake-hub';
import { WORLD } from '@cg/testing/hub';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { pageSender } from '../../../packages/platform/src/test-support/fake-browser.ts';
import { admitted, bindingOf, opsOf, signInWithPersona, startReply, workingTab } from './support/tabs.ts';
import { PASSWORD, createWorld, settingsFor, sleep, until, type World } from './support/world.ts';

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

describe('operations (§7)', () => {
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

  it('[LG-008] what the diagnostics export keeps of a generation: «stream request sent» and «stream answered» under bg.hub — route, attempt, status and timings, each fact a word the redaction keeps; on a page switched off nothing is admitted at all', async () => {
    const w = world();
    w.start();
    await signInWithPersona(w);
    const tab = await workingTab(w);
    const binding = await bindingOf(tab);
    const opId = admitted(await startReply(tab, binding, chat.platformFanId));
    await until(async () => (await opsOf(tab)).find((op) => op.opId === opId)?.endedAt !== undefined, 'the generation ended');
    // The owner's master switch goes off: the next start is refused before any admission — nothing to wait for, nothing sent.
    w.hub.control({ op: 'config', patch: { master: false } });
    expect(await w.page().request('bootstrap.get', { force: true })).toMatchObject({ ok: true });
    const posts = callsTo(w.hub.read().entries, 'aiFeatureStream').length;
    expect(await startReply(tab, binding, chat.platformFanId)).toEqual({ ok: false, error: { code: 'CG-FEATURE-DISABLED' } });
    expect(callsTo(w.hub.read().entries, 'aiFeatureStream')).toHaveLength(posts);

    const file = await w.page().request('diagnostics.export', { format: 'json' });
    if (!file.ok) throw new Error(file.error.code);
    const records = (JSON.parse(file.payload.body) as { logs: { recent: { scope: string; msg: string; level: string; code?: string; fields?: Record<string, unknown> }[] } }).logs.recent;
    const hub = records.filter((record) => record.scope === 'bg.hub');
    const sent = hub.find((record) => record.msg === 'stream request sent');
    const answered = hub.find((record) => record.msg === 'stream answered');
    expect(sent).toMatchObject({ level: 'info', fields: { route: 'aiFeatureStream', feature: 'fast-reply', attempt: 1 } });
    expect(answered).toMatchObject({ level: 'info', fields: { route: 'aiFeatureStream', feature: 'fast-reply', attempt: 1, status: 200 } });
    expect(typeof sent?.fields?.['prepareMs']).toBe('number');
    expect(typeof answered?.fields?.['answerMs']).toBe('number');
    // Nothing of these lines was cut to «[text len=N]»: every value is a number or one machine word.
    for (const record of [sent, answered]) {
      for (const value of Object.values(record?.fields ?? {})) expect(typeof value === 'number' || /^[A-Za-z0-9_.:-]+$/.test(String(value))).toBe(true);
    }
    // The operations journal and the hub journal never carry the conversation: no fan id of the chat, no text.
    expect(JSON.stringify(hub)).not.toContain('synthetic line');
  });
});

describe('a tab that asks about its page before it said which accounts it shows (§5.4)', () => {
  const STATS = { pageId: PAGE_ID, windowDays: 30, timeZone: 'Europe/Moscow' } as const;

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
    // The same fact for this install's tabs: the part is a delivered part of its group in the fan's sends (`send.list`),
    // and every tab was told — the card that made it shows «Отправлено» and offers the next part. No ticket was asked.
    const sends = await tab.client.request('send.list', { pageId: PAGE_ID, fanRef: FAN });
    expect(sends).toMatchObject({ ok: true, payload: { attempts: [{ opId, purpose: 'greeting', partIndex: 0, group: { variant: 0, partCount: 1 }, view: { state: 'sentObserved', platformMessageId: '4100' } }], truncated: false } });
    expect(callsTo(w.hub.read().entries, 'clientFanClaim').map((call) => (call.request as { body: { action: string } }).body.action)).toEqual(['registerNativeSend']);
    // On disk it is a finished record of the send journal — never an open attempt: an open one would hold the fan,
    // read «неизвестно, ушло ли» after an unload, and fail every later write of the journal (every X8 send).
    const journaled = (): { attemptId: string; state: string; documentEpoch: string; fanRef: string; platformMessageId?: string }[] =>
      ((w.fake.areas.local.get(STORAGE_KEYS.sendJournal) as { entries: { attemptId: string; state: string; documentEpoch: string; fanRef: string; platformMessageId?: string }[] } | undefined)?.entries ?? []);
    await until(() => journaled().length === 1, 'the delivered part is in the send journal');
    expect(journaled()).toMatchObject([{ state: 'sentObserved', documentEpoch: 'native-send', fanRef: FAN, platformMessageId: '4100' }]);
    // The tab repeats a report the port never acknowledged: still one record, one registration.
    expect(await tab.client.request('op.reportSent', { opId, part: { variant: 0, index: 0 }, pendingId: 'pending-1', platformMessageId: '4100', edited: false })).toMatchObject({ ok: true });
    const again = await tab.client.request('send.list', { pageId: PAGE_ID, fanRef: FAN });
    expect(again.ok ? again.payload.attempts : null).toHaveLength(1);
    expect(journaled().map((item) => item.state)).toEqual(['sentObserved']);

    // A reply of the open chat's dock: telemetry only, nothing for the hub's custody and nothing in the fan's sends.
    const reply = admitted(await startReply(tab, binding));
    await until(async () => (await opsOf(tab)).find((op) => op.opId === reply)?.state === 'done', 'the reply is ready');
    expect(await tab.client.request('op.reportSent', { opId: reply, part: { index: 0 }, pendingId: 'pending-2', platformMessageId: '4101', edited: true })).toMatchObject({ ok: true });
    await sleep(100);
    expect(callsTo(w.hub.read().entries, 'clientFanClaim')).toHaveLength(1);
    const dockSends = await tab.client.request('send.list', { pageId: PAGE_ID, fanRef: chat.platformFanId });
    expect(dockSends).toMatchObject({ ok: true, payload: { attempts: [] } });
  });
});

describe('a hand-sent greeting whose registration the hub did not hear (§8.5, X5: no second greeting)', () => {
  it('[NF-019] a hub outage and an event-page restart do not lose it: the registration is journaled, and the next instance delivers it with the same attempt id', async () => {
    const w = world();
    w.start();
    await signInWithPersona(w);
    const tab = await workingTab(w);
    const binding = await bindingOf(tab);
    const FAN = WORLD.newFan;
    const token = await tab.client.request('token.issue', { kind: 'generate', surface: 'newcomers' });
    const opId = admitted(
      await tab.client.request('op.start', {
        feature: 'hi',
        surface: 'newcomers',
        target: { binding, chat: { ...chat, platformFanId: FAN }, fanRef: FAN, conversationRef: FAN },
        cause: { kind: 'click', actionToken: token.ok ? token.payload.actionToken : '' },
        tone: null,
        split: false,
        window: 100,
        variantCount: 1,
      }),
    );
    await until(async () => (await opsOf(tab)).find((op) => op.opId === opId)?.state === 'done', 'the greeting is ready');
    const owed = (): Array<{ op: { body: { attemptId: string } } }> => (w.fake.areas.local.get(NATIVE_SENDS_KEY) as { owed?: Array<{ op: { body: { attemptId: string } } }> } | undefined)?.owed ?? [];

    // The network goes down; the person presses ChatSpace's Send, and the tab proves it.
    w.net.down = true;
    const report = { opId, part: { variant: 0, index: 0 }, pendingId: 'pending-1', platformMessageId: '4100', edited: false };
    expect(await tab.client.request('op.reportSent', report)).toMatchObject({ ok: true });
    await until(() => owed().length === 1, 'the registration is journaled');
    const attemptId = owed()[0]?.op.body.attemptId;
    expect(JSON.stringify(w.fake.areas.local.get(NATIVE_SENDS_KEY))).not.toMatch(/welcome|Hi |Hey/);
    expect(callsTo(w.hub.read().entries, 'clientFanClaim')).toHaveLength(0);

    // The event page is unloaded before the hub ever answered; the hub is back when the next one starts.
    w.fake.suspendBackground();
    w.net.down = false;
    await until(() => w.starts() === 2 && tab.client.state() === 'ready', 'the tab registered with the new instance');
    await until(() => callsTo(w.hub.read().entries, 'clientFanClaim').length === 1, 'the next instance told the hub');
    const [claim] = callsTo(w.hub.read().entries, 'clientFanClaim');
    expect(claim).toMatchObject({ status: 200, request: { fanRef: FAN, body: { action: 'registerNativeSend', purpose: 'greeting', attemptId, partIndex: 0, platformMessageId: '4100' } } });
    const status = w.hub.control({ op: 'status' }) as { claims: { fanRef: string; greeting: string }[] };
    expect(status.claims.find((item) => item.fanRef === FAN)?.greeting).toBe('confirmed');
    await until(() => owed().length === 0, 'nothing is owed once the hub answered');

    // The tab says the same send again (its first report was never acknowledged, as far as it knows): no second registration.
    expect(await tab.client.request('op.reportSent', report)).toMatchObject({ ok: true });
    await sleep(100);
    expect(callsTo(w.hub.read().entries, 'clientFanClaim').filter((call) => call.status === 200)).toHaveLength(1);
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
});

describe('a hub without `client/bootstrap` and the narrow token (today’s prod hub) and a RELEASE build', () => {
  // This suite runs the release composition (`__CG_TEST_HOSTS__` is false here). The dev compat mode — a full
  // token kept, a bootstrap synthesized from `me` and the hub's page list — exists only in a test build with
  // debug on: there it is proven by the hub layer's own tests and by the e2e on the test build.
  it('[HB-011] [AU-029] debug mode on changes nothing: the sign-in is refused with CG-HUB-OUTDATED, the full token is revoked and never stored, and the hub’s page list is not asked for', async () => {
    const w = world({ settings: settingsFor(undefined, { debug: { enabled: true, renderTrace: false } }) });
    w.hub.control({ op: 'config', patch: { clientBootstrap: false, narrowTokens: false } });
    w.start();
    // A developer's map left in storage is not read by a release build either.
    w.fake.areas.local.set('dev.compatPageAccounts', { [PAGE]: account.platformAccountId });
    const options = w.page();
    const signedIn = await options.request('session.signIn', { login: WORLD.user.username, password: PASSWORD });
    expect(signedIn).toMatchObject({ ok: false, error: { code: 'CG-HUB-OUTDATED' } });
    expect(await options.request('session.get', {})).toEqual({ ok: true, payload: { session: null } });
    await until(() => callsTo(w.hub.read().entries, 'authRevokeCurrentDeviceToken').length === 1, 'the issued full token was revoked');
    expect(w.fake.areas.local.get(STORAGE_KEYS.authToken)).toBeUndefined();
    const entries = w.hub.read().entries;
    expect(entries.filter((entry) => entry.kind === 'legacy')).toEqual([]);
    expect(callsTo(entries, 'clientBootstrap')).toEqual([]);

    // A hub with the narrow token but without `client/bootstrap` (H-3 before H-2): refused as well, nothing synthesized.
    w.hub.control({ op: 'config', patch: { clientBootstrap: false, narrowTokens: true } });
    expect(await options.request('session.signIn', { login: WORLD.user.username, password: PASSWORD })).toMatchObject({ ok: false, error: { code: 'CG-HUB-OUTDATED' } });
    expect(await options.request('session.get', {})).toEqual({ ok: true, payload: { session: null } });
    expect(w.fake.areas.local.get(STORAGE_KEYS.authToken)).toBeUndefined();
    expect(w.hub.read().entries.filter((entry) => entry.kind === 'legacy')).toEqual([]);
  });
});
