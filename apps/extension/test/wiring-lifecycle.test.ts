// The lifecycle of the wiring (architecture.md §7 «Фон и выгрузка», §5.4,
// §14): the background composition root and the tab's runtime together, on
// the fake browser and the in-process fake hub (test/support/world.ts).
// - every request waits for the start steps (the readiness barrier);
// - a background that was unloaded restores what it kept: operations become
//   `interrupted`, an open send `uncertain`, the telemetry queue's state;
// - alarms are armed while a ChatSpace tab is registered;
// - `settings.changed` reaches tabs and pages;
// - an update from 0.2.2 or older sets a stored «Как в системе» to Russian,
//   once (ST-135);
// - a tab registers again with a restarted background and says where it is;
// - an open tab keeps the event page from idling (BG-003);
// - the start record says why the page started (LG-016, LG-018).

import { DEFAULT_SETTINGS, STORAGE_KEYS, type LogRecord, type OpView, type SendJournalEntry, type SettingsState } from '@cg/contracts';
import { account, journalEntry, opView } from '@cg/contracts/fixtures';
import { OPS_STORE_KEY, createResultsStore, createSendJournal } from '@cg/core/services';
import { ChatExtensionHub } from '@cg/hub';
import { createKeyValueStore } from '@cg/platform';
import { callsTo } from '@cg/testing/fake-hub';
import { WORLD } from '@cg/testing/hub';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { pageSender } from '../../../packages/platform/src/test-support/fake-browser.ts';
import { LIFECYCLE_EVENT_WAIT_MS, STARTS_KEY, earlierStartsOf, startReasonOf } from '../src/composition/background/lifecycle.ts';
import { opsStoreOver } from '../src/composition/background/ops-store.ts';
import { PASSWORD, createWorld, settingsFor, sleep, until, type World } from './support/world.ts';

const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const ALARM_NAMES = ['cg.hub.bootstrap', 'cg.results.sweep', 'cg.telemetry.flush', 'cg.telemetry.health'];

let world: World;
beforeEach(() => {
  // The event page's console port: the records are read from the export, not from the test output.
  for (const level of ['debug', 'info', 'warn', 'error'] as const) vi.spyOn(console, level).mockImplementation(() => undefined);
});
afterEach(() => {
  world.dispose();
  vi.restoreAllMocks();
});

/** The records of the diagnostics export (what a person sends to the owner), oldest first. */
async function exportedLogs(w: World): Promise<LogRecord[]> {
  const file = await w.page().request('diagnostics.export', { format: 'json' });
  if (!file.ok) throw new Error(`diagnostics.export: ${file.error.code}`);
  const bundle = JSON.parse(file.payload.body) as { logs?: { recent?: LogRecord[] } };
  return bundle.logs?.recent ?? [];
}
const startRecords = (records: readonly LogRecord[]): Array<Record<string, unknown>> => records.filter((record) => record.msg === 'background started').map((record) => record.fields ?? {});

async function signIn(w: World): Promise<void> {
  const answer = await w.page().request('session.signIn', { login: WORLD.user.username, password: PASSWORD });
  expect(answer).toMatchObject({ ok: true, payload: { session: { login: WORLD.user.username } } });
}

describe('the readiness barrier', () => {
  it('[BG-004] a request that arrives while the event page is still starting is answered from the restored state, not before it', async () => {
    world = createWorld({ settings: settingsFor(undefined, { ui: { ...DEFAULT_SETTINGS.ui, locale: 'en' } }) });
    // Every storage call of the start takes a while: the page is far from ready when the requests come.
    world.fake.latency = () => 15;
    const page = world.page();
    const [session, settings, diagnostics] = await Promise.all([page.request('session.get', {}), page.request('settings.get', {}), page.request('diagnostics.get', {})]);
    expect(world.starts()).toBe(1);
    // `session.get` reads the hub layer, which exists only after the settings step: an early answer is an error.
    expect(session).toEqual({ ok: true, payload: { session: null } });
    expect(settings).toMatchObject({ ok: true, payload: { settings: { ui: { locale: 'en' }, hub: { baseUrl: WORLD.hubOrigin } } } });
    expect(diagnostics).toMatchObject({ ok: true, payload: { session: { signedIn: false }, tabs: [] } });
    // Nothing talked to the hub: nobody is signed in, and a status surface asks for the hub's health only for a sign-in.
    expect(world.hub.read().entries).toEqual([]);
  });
});

describe('a background that was unloaded', () => {
  it('[BG-004] [BG-006] restores what it kept: a running operation is interrupted, an open send is uncertain, the telemetry counters stay', async () => {
    world = createWorld();
    // What the previous instance of the event page left in storage, written with its own stores.
    const seed = world.fake.context(pageSender(world.fake, 'debug-journal')).api;
    const session = createKeyValueStore('session', { api: seed });
    const local = createKeyValueStore('local', { api: seed });
    const now = Date.now();
    const running: OpView = { ...opView, opId: uuid(31), state: 'streaming', phase: { name: 'streaming', since: now - 2000 }, startedAt: now - 5000, firstChunkAt: now - 3000 };
    delete (running as { endedAt?: number }).endedAt;
    delete (running as { result?: unknown }).result;
    const done: OpView = { ...opView, opId: uuid(32), startedAt: now - 60_000, firstChunkAt: now - 59_000, endedAt: now - 56_000, phase: { name: 'settled', since: now - 56_000 } };
    const meta = (requestKey: string) => ({ startedBy: 'tab-before', requestKey, tag: { hubOrigin: WORLD.hubOrigin, userId: WORLD.user.userId, signInEpoch: 1, pageId: 11, personaKey: 'default', personaDefinitionId: WORLD.persona.definitionId }, fanLabel: null, knownIds: [], checkpoint: null, split: false });
    await opsStoreOver(createResultsStore({ session }), session).set(OPS_STORE_KEY, { v: 1, ops: [{ view: running, meta: meta('rk-1') }, { view: done, meta: meta('rk-2') }] });
    const journal = createSendJournal({ local });
    await journal.start();
    const attempt: SendJournalEntry = { ...journalEntry, attemptId: uuid(41), opId: done.opId, createdAt: now - 4000, updatedAt: now - 4000 };
    expect(await journal.begin(attempt)).toMatchObject({ ok: true });
    // ChatSpace took it into its queue, and then the event page was gone: nobody heard how it ended.
    expect(await journal.advance(attempt.attemptId, { state: 'nativeEnqueued', pendingId: uuid(42) })).toMatchObject({ ok: true });
    journal.dispose();
    await local.set({ [STORAGE_KEYS.telemetryQueue]: { v: 1, entries: [], dropped: { overflow: 3, rejected: 0, exhausted: 2, 'stale-binding': 0, consent: 0, unsupported: 0, invalid: 0 }, paused: null } });

    const page = world.page();
    const ops = await page.request('op.list', { scope: 'all' });
    expect(world.starts()).toBe(1);
    expect(ops.ok && ops.payload.ops.map((op) => [op.opId, op.state, op.error?.code ?? null]).sort()).toEqual([
      [uuid(31), 'interrupted', 'CG-OP-INTERRUPTED'],
      [uuid(32), 'done', null],
    ]);
    // The half-way send is not sent again and not forgotten: it holds its fan as `uncertain`.
    expect(await page.request('send.status', { attemptId: attempt.attemptId })).toMatchObject({ ok: true, payload: { view: { attemptId: attempt.attemptId, state: 'uncertain' } } });
    const diagnostics = await page.request('diagnostics.get', {});
    expect(diagnostics).toMatchObject({ ok: true, payload: { ops: { active: 0 }, sends: { uncertain: 1 }, telemetry: { queued: 0, dropped: 5 } } });
    // No POST to the hub for the interrupted operation — and without a sign-in nothing else either.
    expect(world.hub.read().entries).toEqual([]);
  });

  it('[BG-002] the open tab registers again with the new instance and says where it is: the same sign-in, the tab, its chat and its accounts', async () => {
    world = createWorld();
    world.start();
    await signIn(world);
    world.tabRuntime();
    const page = world.page();
    const tabsOf = async () => {
      const diagnostics = await page.request('diagnostics.get', {});
      return diagnostics.ok ? diagnostics.payload.tabs : [];
    };
    const seenOpen = async () => {
      const seen = await page.request('accounts.seen', {});
      return seen.ok ? seen.payload.accounts.map((item) => [item.account.hostAccountId, item.openTabs]) : [];
    };
    await until(async () => (await tabsOf())[0]?.chatKey === 'chatspace:1001:2002', 'the tab reported its chat');
    const before = (await tabsOf())[0]?.tabSessionId;
    expect(await seenOpen()).toEqual([[account.hostAccountId, 1]]);

    world.fake.suspendBackground();
    await until(() => world.starts() === 2, 'the tab woke the event page');
    await until(async () => (await tabsOf())[0]?.chatKey === 'chatspace:1001:2002', 'the tab reported its chat to the new instance');
    const after = await tabsOf();
    expect(after).toHaveLength(1);
    expect(after[0]?.tabSessionId).not.toBe(before);
    // The accounts go with the report after a reconnect, although they did not change.
    expect(await seenOpen()).toEqual([[account.hostAccountId, 1]]);
    expect(await page.request('session.get', {})).toMatchObject({ ok: true, payload: { session: { login: WORLD.user.username } } });
    // The restored sign-in read nothing again: the stored bootstrap and catalog were fresh, and the tab's focus is not a reason.
    const entries = world.hub.read().entries;
    expect(callsTo(entries, 'clientBootstrap')).toHaveLength(1);
    expect(callsTo(entries, 'aiPersonaCatalog')).toHaveLength(1);
  });

  it('[AU-034] a tab with two accounts loaded and no chat open says which one its route is on: «Аккаунты» counts it apart', async () => {
    world = createWorld();
    world.start();
    await signIn(world);
    // ChatSpace on /accounts/1002/chats: it loaded both of the person's accounts, the route is on the second one.
    const second = { ...account, hostAccountId: '1002', platformAccountId: '3004', username: 'second', displayName: 'Second' };
    world.tabRuntime({ accounts: [account, second], route: { chat: null, account: second } });
    const page = world.page();
    const counts = async () => {
      const seen = await page.request('accounts.seen', {});
      return seen.ok ? seen.payload.accounts.map((item) => [item.account.hostAccountId, item.openTabs, item.routeTabs]).sort() : [];
    };
    await until(async () => (await counts()).length === 2, 'the tab reported its accounts');
    expect(await counts()).toEqual([
      [account.hostAccountId, 1, 0],
      ['1002', 1, 1],
    ]);
  });
});

describe('alarms', () => {
  it('are armed when a ChatSpace tab registers — not for a page — and found again by the next instance', async () => {
    world = createWorld();
    world.start();
    const page = world.page();
    expect(await page.request('session.get', {})).toMatchObject({ ok: true });
    expect([...world.fake.alarms.keys()]).toEqual([]);
    world.tabRuntime();
    await until(() => world.fake.alarms.size === ALARM_NAMES.length, 'the alarms are armed');
    expect([...world.fake.alarms.keys()].sort()).toEqual(ALARM_NAMES);
    for (const alarm of world.fake.alarms.values()) expect(alarm.periodInMinutes).toBeGreaterThan(0);
    const due = new Map([...world.fake.alarms].map(([name, alarm]) => [name, alarm.scheduledTime]));
    world.fake.suspendBackground();
    await until(() => world.starts() === 2, 'the tab woke the event page');
    await sleep(50);
    // The next instance keeps the schedule it found: an alarm is not pushed back by every restart.
    expect(new Map([...world.fake.alarms].map(([name, alarm]) => [name, alarm.scheduledTime]))).toEqual(due);
  });
});

describe('alarms with no ChatSpace tab left', () => {
  it('[BG-003] the first alarm that finds no tab and nothing queued clears every alarm — nothing wakes the event page again; the next tab arms them anew', async () => {
    world = createWorld();
    world.start();
    const tab = world.tabClient();
    await until(() => world.fake.alarms.size === ALARM_NAMES.length, 'the alarms are armed');
    // While the tab is there an alarm keeps the schedule.
    world.fake.fireAlarm('cg.results.sweep');
    await sleep(100);
    expect([...world.fake.alarms.keys()].sort()).toEqual(ALARM_NAMES);

    tab.client.close();
    await sleep(50);
    world.fake.fireAlarm('cg.results.sweep');
    // The handler waits two seconds for a tab that is only re-registering after a wake.
    await sleep(500);
    expect(world.fake.alarms.size).toBe(ALARM_NAMES.length);
    await until(() => world.fake.alarms.size === 0, 'every alarm is cleared', 6000);

    // A tab opened later arms them again (the flag was reset, not left «armed»).
    world.tabClient(8);
    await until(() => world.fake.alarms.size === ALARM_NAMES.length, 'the alarms are armed again');
    expect([...world.fake.alarms.keys()].sort()).toEqual(ALARM_NAMES);
  });

  it('[BG-003] a tab that registers within the two seconds keeps the alarms: a wake by an alarm is not «no tab»', async () => {
    world = createWorld();
    world.start();
    const tab = world.tabClient();
    await until(() => world.fake.alarms.size === ALARM_NAMES.length, 'the alarms are armed');
    const due = new Map([...world.fake.alarms].map(([name, alarm]) => [name, alarm.scheduledTime]));
    tab.client.close();
    await sleep(50);
    world.fake.fireAlarm('cg.hub.bootstrap');
    await sleep(300);
    world.tabClient(8);
    await sleep(2500);
    // Kept, not cleared and armed anew: the schedule did not move.
    expect(new Map([...world.fake.alarms].map(([name, alarm]) => [name, alarm.scheduledTime]))).toEqual(due);
  });
});

describe('[LG-003] the redactor knows the live token', () => {
  /** A record a tab writes whose machine field names `value`. */
  const recordWith = (seq: number, value: string): LogRecord => ({ ts: new Date().toISOString(), seq, level: 'warn', scope: 'tab.test', msg: 'probe', fields: { reason: value } });
  const probes = (records: readonly LogRecord[]): unknown[] => records.filter((record) => record.msg === 'probe').map((record) => record.fields?.['reason']);

  it('[LG-003] from the sign-in on, and again after the event page restarted: the stored record is read through the tap, so a token tail in a record of a tab is masked', async () => {
    world = createWorld();
    world.start();
    await signIn(world);
    const stored = world.fake.areas.local.get(STORAGE_KEYS.authToken) as { token: string };
    // The tail is what a support screen would show (DB-027): no token SHAPE matches it — only the exact value does.
    const tail = stored.token.slice(-8);
    expect(tail).toHaveLength(8);
    const tab = world.tabClient();
    await until(() => tab.client.state() === 'ready', 'the tab registered');
    expect(await tab.client.request('log.write', { records: [recordWith(1, `tail-${tail}`)] })).toMatchObject({ ok: true, payload: { accepted: 1 } });
    expect(probes(await exportedLogs(world))).toEqual(['tail-[redacted]']);

    // The next event page learns the token at its start, from the stored sign-in — before anybody signs in again.
    world.fake.suspendBackground();
    await until(() => world.starts() === 2 && tab.client.state() === 'ready', 'the tab registered with the new instance');
    expect(await tab.client.request('log.write', { records: [recordWith(2, `again-${tail}`), recordWith(3, `whole-${stored.token}`)] })).toMatchObject({ ok: true, payload: { accepted: 2 } });
    const after = probes(await exportedLogs(world));
    expect(after).toContain('again-[redacted]');
    expect(after).toContain('whole-[redacted]');
    expect(JSON.stringify(await exportedLogs(world))).not.toContain(tail);
  });
});

describe('[LG-010] «Ошибки за сегодня» is the calendar day’s, not the add-on’s run', () => {
  const DAY = 86_400_000;
  /** A record of a page with a CG code: the path a tab's and a page's errors take to the day's counters. */
  const coded = (seq: number, code: LogRecord['code'], at = Date.now()): LogRecord => ({ ts: new Date(at).toISOString(), seq, level: 'error', scope: 'pg.test', msg: 'probe', code });
  type Counted = ReadonlyArray<{ readonly code: string; readonly count: number }>;
  /** The counters of the diagnostics export — what the owner reads. */
  const counters = async (w: World): Promise<{ day: string; today: Counted; previousDay: string | null; previous: Counted; sinceStart: Counted }> => {
    const file = await w.page().request('diagnostics.export', { format: 'json' });
    if (!file.ok) throw new Error(`diagnostics.export: ${file.error.code}`);
    return (JSON.parse(file.payload.body) as { counters: { day: string; today: Counted; previousDay: string | null; previous: Counted; sinceStart: Counted } }).counters;
  };
  type Kept = { readonly today?: Record<string, number> } | undefined;
  /** The day's counters are on disk as `today` (they are written two seconds after a change), and the event page is gone. */
  const unload = async (w: World, today: Record<string, number>): Promise<void> => {
    await until(() => JSON.stringify((w.fake.areas.local.get('log.counters') as Kept)?.today) === JSON.stringify(today), `the day’s counters ${JSON.stringify(today)} were saved`, 6000);
    const background = w.fake.background();
    if (background === null) throw new Error('no background');
    // As Firefox unloads an idle page: `runtime.onSuspend`, whose promises it waits for, then the page is gone.
    await Promise.all(background.events.onSuspend.emit().filter((answer): answer is Promise<void> => answer instanceof Promise));
    w.fake.unloadBackground();
  };
  const dayKey = (ms: number): string => {
    const date = new Date(ms);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };

  it('a restart of the browser, an update or a reinstall of the add-on — all of them empty storage.session — keeps the day’s counts; «since the start» begins anew; only codes and counts are on disk', async () => {
    world = createWorld();
    world.start();
    expect(await world.page().request('log.write', { records: [coded(1, 'CG-NETWORK'), coded(2, 'CG-NETWORK'), coded(3, 'CG-HUB-TIMEOUT')] })).toMatchObject({ ok: true, payload: { accepted: 3 } });
    const before = await counters(world);
    const counted = [
      { code: 'CG-NETWORK', count: 2 },
      { code: 'CG-HUB-TIMEOUT', count: 1 },
    ];
    expect([before.today, before.sinceStart]).toEqual([counted, counted]);

    // The chatter restarts Firefox in the middle of the shift (or the add-on is updated under them).
    await unload(world, { 'CG-NETWORK': 2, 'CG-HUB-TIMEOUT': 1 });
    world.fake.areas.session.clear();
    const after = await counters(world);
    expect(world.starts()).toBe(2);
    expect(after.day).toBe(before.day);
    expect(after.today).toEqual(counted);
    expect(after.sinceStart).toEqual([]);

    // The new instance goes on counting into the same day.
    expect(await world.page().request('log.write', { records: [coded(4, 'CG-NETWORK')] })).toMatchObject({ ok: true, payload: { accepted: 1 } });
    const later = await counters(world);
    expect(later.today).toEqual([
      { code: 'CG-NETWORK', count: 3 },
      { code: 'CG-HUB-TIMEOUT', count: 1 },
    ]);
    expect(later.sinceStart).toEqual([{ code: 'CG-NETWORK', count: 1 }]);

    // What is on disk: the day, codes and counts — nothing of the records themselves, nothing in storage.session.
    await unload(world, { 'CG-NETWORK': 3, 'CG-HUB-TIMEOUT': 1 });
    expect(world.fake.areas.local.get('log.counters')).toEqual({ v: 1, day: before.day, today: { 'CG-NETWORK': 3, 'CG-HUB-TIMEOUT': 1 }, previousDay: null, previous: {} });
    expect(world.fake.areas.session.has('log.counters')).toBe(false);
  });

  it('the counters reach the disk by themselves two seconds after a change: a browser that is closed without a word loses at most those', async () => {
    world = createWorld();
    world.start();
    expect(await world.page().request('log.write', { records: [coded(1, 'CG-HUB-UNAVAILABLE')] })).toMatchObject({ ok: true });
    expect(world.fake.areas.local.has('log.counters')).toBe(false);
    // Never in `runtime.onSuspend`: a storage write there comes back to the page as `storage.onChanged`, and an event
    // that reaches a page being suspended cancels its unload (Firefox) — the event page would never go.
    const writes: string[] = [];
    world.fake.background()?.events.storageChanged.addListener((changes, area) => void writes.push(...Object.keys(changes).map((key) => `${area}:${key}`)));
    await Promise.all((world.fake.background()?.events.onSuspend.emit() ?? []).filter((answer): answer is Promise<void> => answer instanceof Promise));
    await sleep(20);
    expect(writes).toEqual([]);
    await until(() => world.fake.areas.local.has('log.counters'), 'the day’s counters were saved', 5000);
    await sleep(5);
    expect(writes).toEqual(['local:log.counters']);
    // The browser is gone at once: no onSuspend, nothing of storage.session left.
    world.fake.unloadBackground();
    world.fake.areas.session.clear();
    expect((await counters(world)).today).toEqual([{ code: 'CG-HUB-UNAVAILABLE', count: 1 }]);
  });

  it('a kept day that is over is «the day before»; older days are dropped; a value that is not ours is ignored and replaced', async () => {
    const now = Date.now();
    world = createWorld();
    world.fake.areas.local.set('log.counters', { v: 1, day: dayKey(now - DAY), today: { 'CG-NETWORK': 4, 'not a code': 9, 'CG-TIMEOUT': 'text' }, previousDay: dayKey(now - 3 * DAY), previous: { 'CG-HUB-TIMEOUT': 7 } });
    world.start();
    const first = await counters(world);
    expect(first).toMatchObject({ day: dayKey(now), today: [], previousDay: dayKey(now - DAY), previous: [{ code: 'CG-NETWORK', count: 4 }] });
    world.fake.unloadBackground();

    world.fake.areas.local.set('log.counters', 'a text that was never ours');
    expect(await world.page().request('log.write', { records: [coded(1, 'CG-NETWORK')] })).toMatchObject({ ok: true });
    expect((await counters(world)).today).toEqual([{ code: 'CG-NETWORK', count: 1 }]);
    await unload(world, { 'CG-NETWORK': 1 });
    expect(world.fake.areas.local.get('log.counters')).toEqual({ v: 1, day: dayKey(now), today: { 'CG-NETWORK': 1 }, previousDay: null, previous: {} });
  });

  it('[ST-110] «Очистить локальные данные» empties the day — in memory and on disk; a sign-out leaves it, as it leaves the log', async () => {
    world = createWorld();
    world.start();
    await signIn(world);
    const page = world.page();
    expect(await page.request('log.write', { records: [coded(1, 'CG-NETWORK'), coded(2, 'CG-NETWORK')] })).toMatchObject({ ok: true });
    const sized = await page.request('diagnostics.get', {});
    expect(sized.ok && typeof sized.payload.footprint?.logsKB).toBe('number');

    expect(await page.request('session.signOut', {})).toMatchObject({ ok: true });
    expect((await counters(world)).today).toContainEqual({ code: 'CG-NETWORK', count: 2 });

    expect(await page.request('data.clear', { confirmed: true })).toEqual({ ok: true, payload: { cleared: true } });
    const cleared = await counters(world);
    expect([cleared.today, cleared.previous, cleared.previousDay]).toEqual([[], [], null]);
    expect(world.fake.areas.local.get('log.counters')).toMatchObject({ today: {}, previous: {}, previousDay: null });
    // Not written back by the instance that goes on, and still empty after a restart.
    await unload(world, {});
    world.fake.areas.session.clear();
    expect((await counters(world)).today).toEqual([]);
  });
});

describe('an extension page left open without a ChatSpace tab', () => {
  it('[BG-003] does not restart the event page after its idle unload: the page’s event port is parked — its next request wakes the background, and the events are heard again', async () => {
    world = createWorld();
    world.start();
    const page = world.page();
    const revisions: number[] = [];
    page.onEvent('settings.changed', (state) => revisions.push(state.revision));
    expect(await page.request('settings.get', {})).toMatchObject({ ok: true });
    // The port lives (a connection that died young would be a background that cannot start, and is retried).
    await sleep(1_100);
    world.fake.suspendBackground();
    await sleep(400);
    // Nobody woke the event page: with the old reconnect it started again 5 ms after the unload — and again
    // after every idle timeout, for as long as the page stayed open.
    expect(world.starts()).toBe(1);

    // The person does something on the page: one start, and the page hears what it changed.
    const saved = await page.request('settings.patch', { patch: { ui: { hints: false } }, baseRevision: null });
    expect(saved).toMatchObject({ ok: true });
    expect(world.starts()).toBe(2);
    await until(() => revisions.length > 0, 'the page heard `settings.changed` of the new instance');
  });
});

describe('settings', () => {
  it('[BG-005] a change made on a page reaches every tab and every page', async () => {
    world = createWorld();
    world.start();
    const options = world.page('options');
    const popup = world.page('popup');
    const tab = world.tabClient();
    const heard: Array<[string, SettingsState['settings']['ui']['locale'], number]> = [];
    tab.client.onEvent('settings.changed', (state) => heard.push(['tab', state.settings.ui.locale, state.revision]));
    popup.onEvent('settings.changed', (state) => heard.push(['popup', state.settings.ui.locale, state.revision]));
    await until(() => tab.client.state() === 'ready', 'the tab registered');
    await sleep(20);
    const saved = await options.request('settings.patch', { patch: { ui: { locale: 'en' } }, baseRevision: null });
    expect(saved).toMatchObject({ ok: true, payload: { settings: { ui: { locale: 'en' } } } });
    await until(() => heard.length === 2, 'both heard the change');
    const revision = saved.ok ? saved.payload.revision : -1;
    expect(heard.sort()).toEqual([['popup', 'en', revision], ['tab', 'en', revision]]);
  });

  it('a tab’s patch cannot set the persona of a page it is not bound to; its own page it can', async () => {
    world = createWorld();
    world.start();
    await signIn(world);
    const tab = world.tabClient();
    await until(() => tab.client.state() === 'ready', 'the tab registered');
    const persona = { key: WORLD.persona.key, definitionId: WORLD.persona.definitionId };
    // The tab shows no account yet: its request waits for its report (background/tab-accounts.ts), and with none
    // coming no page is «its own».
    expect(await tab.client.request('settings.patch', { patch: { personas: { byPageId: { [String(WORLD.pages.one.pageId)]: persona } } }, baseRevision: null })).toEqual({ ok: false, error: { code: 'CG-BINDING-NOT-GRANTED', detail: 'personas' } });
    expect(await tab.client.request('tab.presence', { chat: null, routeEpoch: 1, visible: true, focused: false, accounts: [account] })).toEqual({ ok: true, payload: { recorded: true } });
    expect(await tab.client.request('settings.patch', { patch: { personas: { byPageId: { [String(WORLD.pages.vip.pageId)]: persona } } }, baseRevision: null })).toEqual({ ok: false, error: { code: 'CG-BINDING-NOT-GRANTED', detail: 'personas' } });
    const own = await tab.client.request('settings.patch', { patch: { personas: { byPageId: { [String(WORLD.pages.one.pageId)]: persona } } }, baseRevision: null });
    expect(own).toMatchObject({ ok: true, payload: { settings: { personas: { byPageId: { [String(WORLD.pages.one.pageId)]: persona } } } } });
    // The rest of a tab's patch is as open as before.
    expect(await tab.client.request('settings.patch', { patch: { ui: { locale: 'ru' } }, baseRevision: null })).toMatchObject({ ok: true });
  });

  it('[ST-135] the update from 0.2.2 or older, as it comes right after the start: «Как в системе» stored by the old default is Russian before the first page asks, on disk and in the log', async () => {
    const system = settingsFor(undefined, { ui: { ...DEFAULT_SETTINGS.ui, locale: 'system' } });
    world = createWorld({ settings: system });
    world.start();
    world.fake.fireInstalled({ reason: 'update', previousVersion: '0.2.1' });
    expect(await world.page().request('settings.get', {})).toMatchObject({ ok: true, payload: { settings: { ui: { locale: 'ru' } } } });
    // The language alone changed.
    expect(world.fake.areas.local.get(STORAGE_KEYS.settings)).toEqual({ ...system, ui: { ...system.ui, locale: 'ru' } });
    const logged = (await exportedLogs(world)).filter((record) => record.scope === 'bg.settings' && record.msg === 'language set to Russian after the update');
    expect(logged.map((record) => [record.level, record.fields?.['previousVersion']])).toEqual([['info', '0.2.1']]);
  });

  it('[ST-135] [BG-005] open pages switch at once (a confirmed change with its revision); a choice made after it survives the next update', async () => {
    const system = settingsFor(undefined, { ui: { ...DEFAULT_SETTINGS.ui, locale: 'system' } });
    world = createWorld({ settings: system });
    world.start();
    const options = world.page('options');
    const popup = world.page('popup');
    const heard: Array<[SettingsState['settings']['ui']['locale'], number]> = [];
    popup.onEvent('settings.changed', (state) => heard.push([state.settings.ui.locale, state.revision]));
    const before = await popup.request('settings.get', {});
    expect(before).toMatchObject({ ok: true, payload: { settings: { ui: { locale: 'system' } } } });
    const revision = before.ok ? before.payload.revision : -1;
    world.fake.fireInstalled({ reason: 'update', previousVersion: '0.2.0' });
    await until(() => heard.length === 1, 'the open popup heard the change');
    expect(heard).toEqual([['ru', revision + 1]]);

    // The person chooses «Как в системе» on purpose; the next update comes from a build after 0.2.2.
    expect(await options.request('settings.patch', { patch: { ui: { locale: 'system' } }, baseRevision: null })).toMatchObject({ ok: true, payload: { settings: { ui: { locale: 'system' } } } });
    world.fake.fireInstalled({ reason: 'update', previousVersion: '0.2.3' });
    await sleep(30);
    expect(await options.request('settings.get', {})).toMatchObject({ ok: true, payload: { settings: { ui: { locale: 'system' } }, revision: revision + 2 } });
    expect(heard.map(([locale]) => locale)).toEqual(['ru', 'system']);
  });

  it('[ST-135] a later update, a version that is not one, a temporary install, a fresh install and a chosen English leave the language as stored', async () => {
    for (const [locale, details] of [
      ['system', { reason: 'update', previousVersion: '0.2.3' }],
      ['system', { reason: 'update', previousVersion: '0.3.0' }],
      ['system', { reason: 'update', previousVersion: '0.2.1-beta' }],
      ['system', { reason: 'update' }],
      // `pnpm dev` and the e2e reload the build as a temporary install: a developer's reload, not a chatter's update.
      ['system', { reason: 'update', previousVersion: '0.2.0', temporary: true }],
      ['system', { reason: 'install' }],
      ['en', { reason: 'update', previousVersion: '0.2.0' }],
    ] as const) {
      const stored = settingsFor(undefined, { ui: { ...DEFAULT_SETTINGS.ui, locale } });
      const w = createWorld({ settings: stored });
      world = w;
      w.start();
      w.fake.fireInstalled(details);
      expect(await w.page().request('settings.get', {})).toMatchObject({ ok: true, payload: { settings: { ui: { locale } }, revision: 0 } });
      await sleep(30);
      expect([details, w.fake.areas.local.get(STORAGE_KEYS.settings)]).toEqual([details, stored]);
      w.dispose();
    }
  });

  it('[ST-135] a rewrite that cannot be saved stops nothing: the language stays, the background answers and writes as before, the log has the code and no text', async () => {
    const system = settingsFor(undefined, { ui: { ...DEFAULT_SETTINGS.ui, locale: 'system' } });
    world = createWorld({ settings: system });
    world.start();
    const options = world.page();
    expect(await options.request('settings.get', {})).toMatchObject({ ok: true });
    // The update's own record is written first, then the settings: both writes fail.
    world.fake.failNext('local', 'set');
    world.fake.failNext('local', 'set');
    world.fake.fireInstalled({ reason: 'update', previousVersion: '0.2.0' });
    const failure = async (): Promise<LogRecord | undefined> => (await exportedLogs(world)).find((record) => record.msg === 'language not set to Russian after the update');
    await until(async () => (await failure()) !== undefined, 'the failure is logged');
    expect(await failure()).toMatchObject({ level: 'warn', scope: 'bg.settings', code: 'CG-STORAGE-WRITE' });
    expect(world.fake.areas.local.get(STORAGE_KEYS.settings)).toEqual(system);
    expect(await options.request('settings.get', {})).toMatchObject({ ok: true, payload: { settings: { ui: { locale: 'system' } }, readOnly: false } });
    expect(await options.request('session.get', {})).toMatchObject({ ok: true });
    expect(await options.request('settings.patch', { patch: { ui: { locale: 'en' } }, baseRevision: null })).toMatchObject({ ok: true, payload: { settings: { ui: { locale: 'en' } } } });
  });

  it('[ST-006] [ST-007] «Настройки» from a ChatSpace tab: the background opens the settings tab at the section and its code', async () => {
    world = createWorld();
    world.start();
    const tab = world.tabClient();
    await until(() => tab.client.state() === 'ready', 'the tab registered');
    const base = world.fake.base;
    expect(await tab.client.request('settings.open', { route: { section: 'account', code: 'CG-AUTH-REQUIRED' } })).toEqual({ ok: true, payload: { opened: true } });
    expect(await tab.client.request('settings.open', { route: { section: 'hotkeys' } })).toEqual({ ok: true, payload: { opened: true } });
    expect(world.fake.tabCalls.filter((call) => call.startsWith('create '))).toEqual([`create ${base}options.html#account:CG-AUTH-REQUIRED`, `create ${base}options.html#hotkeys`]);
  });
});

describe('[BG-003] the keepalive', () => {
  it('a registered tab repeats its presence report: the event page keeps hearing from it, and a focused tab’s beat is not a «focus»', async () => {
    world = createWorld();
    world.start();
    await signIn(world);
    const page = world.page();
    const background = world.fake.background();
    let fromTab = 0;
    world.fake.background()?.events.onConnect.addListener((port) => port.onMessage.addListener(() => void (fromTab += 1)));
    const focus = vi.spyOn(ChatExtensionHub.prototype, 'notifyFocus');
    world.tabRuntime({ keepaliveMs: 40 });
    await until(() => fromTab >= 6, 'the tab keeps sending');
    expect(world.fake.background()).toBe(background);
    expect(world.starts()).toBe(1);
    const diagnostics = await page.request('diagnostics.get', {});
    expect(diagnostics.ok && diagnostics.payload.tabs).toHaveLength(1);
    // One registration, then only presence reports. The tab was focused all along: that is one «focus»
    // (its first report), and no beat made the hub layer read the bootstrap again.
    expect(focus).toHaveBeenCalledTimes(1);
    expect(callsTo(world.hub.read().entries, 'clientBootstrap')).toHaveLength(1);
  });

  it('a tab gaining the focus is a «focus»: the bootstrap is read again once it is older than a minute, and the beats that follow read nothing', async () => {
    world = createWorld();
    world.start();
    await signIn(world);
    const stored = world.fake.areas.local.get(STORAGE_KEYS.cacheBootstrap) as { fetchedAt: number };
    const tab = world.tabRuntime({ keepaliveMs: 40, focused: false });
    await until(() => world.fake.alarms.size > 0, 'the tab registered');
    await sleep(120);
    expect(callsTo(world.hub.read().entries, 'clientBootstrap')).toHaveLength(1);
    // The same sign-in, a bootstrap read two minutes ago: a restarted page reads it from storage…
    world.fake.areas.local.set(STORAGE_KEYS.cacheBootstrap, { ...stored, fetchedAt: stored.fetchedAt - 120_000 });
    world.fake.suspendBackground();
    await until(() => world.starts() === 2, 'the tab woke the event page');
    await sleep(120);
    expect(callsTo(world.hub.read().entries, 'clientBootstrap')).toHaveLength(1);
    // …and the tab coming to the front reads it again, once.
    tab.focus(true);
    await until(() => callsTo(world.hub.read().entries, 'clientBootstrap').length === 2, 'the focus read the bootstrap');
    await sleep(200);
    expect(callsTo(world.hub.read().entries, 'clientBootstrap')).toHaveLength(2);
  });
});

describe('[RB-010] a port lost under a living extension', () => {
  it('the tab keeps asking the background on its keepalive beat and when the person comes back to it: once the background answers, the same tab is registered again — no reload of the tab', async () => {
    world = createWorld();
    world.start();
    await signIn(world);
    const page = world.page();
    const tabsNow = async (): Promise<readonly { readonly tabSessionId: string }[]> => {
      const diagnostics = await page.request('diagnostics.get', {});
      return diagnostics.ok ? diagnostics.payload.tabs : [];
    };
    const tab = world.tabRuntime({ keepaliveMs: 40 });
    await until(async () => (await tabsNow()).length === 1, 'the tab registered');
    const [first] = await tabsNow();
    // The event page breaks: it starts when asked, and answers nothing (a start that fails before `tab.register`).
    let brokenStarts = 0;
    world.fake.onWake(() => void (brokenStarts += 1));
    world.fake.unloadBackground();
    // The quick attempts (100/200/400 ms) pass; the beats go on asking.
    await sleep(1000);
    expect(brokenStarts).toBe(1);
    expect(tab.life.signal.aborted).toBe(false);
    // One try at a time, however many beats: a page that takes the connection and never answers `tab.register`
    // (its start hangs) leaves the try waiting — and the beats that follow open no second port next to it.
    const openPorts = (): number => [...tab.context.ports].filter((port) => port.connected).length;
    world.fake.onWake((context) => {
      brokenStarts += 1;
      context.api.runtime.onConnect.addListener(() => undefined);
    });
    world.fake.unloadBackground();
    await until(() => brokenStarts === 2, 'a beat woke the hanging page');
    await sleep(400);
    expect(openPorts()).toBe(1);
    expect(brokenStarts).toBe(2);
    expect(tab.life.signal.aborted).toBe(false);
    // The broken page goes away and a working one is there (the browser restarted the background, the storage came back):
    // nothing tells the tab — its next beat finds it.
    world.fake.unloadBackground();
    world.start();
    await until(async () => (await tabsNow()).length === 1, 'the tab registered with the working background by itself');
    const [again] = await tabsNow();
    expect(again?.tabSessionId).not.toBe(first?.tabSessionId);
    expect(tab.life.signal.aborted).toBe(false);
    // The person looking at the tab again asks at once, without waiting for a beat: a lost port is tried on `focus` too.
    world.fake.onWake(() => void (brokenStarts += 1));
    world.fake.unloadBackground();
    await sleep(1000);
    expect(brokenStarts).toBe(3);
    world.fake.unloadBackground();
    world.start();
    tab.focus(true);
    await until(async () => (await tabsNow()).length === 1, 'the tab registered again when the person came back to it');
  });
});

describe('[LG-016] [LG-018] the start record says why the event page started', () => {
  it('[LG-016] the reason: an install, an update, a browser start, a reload, a wake', () => {
    expect(startReasonOf({ earlierStarts: 0, installed: 'install', browserStarted: false })).toBe('install');
    expect(startReasonOf({ earlierStarts: 0, installed: 'update', browserStarted: false })).toBe('update');
    expect(startReasonOf({ earlierStarts: 0, installed: 'browser_update', browserStarted: true })).toBe('browser-start');
    expect(startReasonOf({ earlierStarts: 0, installed: null, browserStarted: true })).toBe('browser-start');
    // Loaded anew with no event to say why: reloaded or enabled again.
    expect(startReasonOf({ earlierStarts: 0, installed: null, browserStarted: false })).toBe('reload');
    expect(startReasonOf({ earlierStarts: 0, installed: 'other', browserStarted: false })).toBe('reload');
    expect(startReasonOf({ earlierStarts: 3, installed: null, browserStarted: false })).toBe('wake');
    // The counter could not be read: nothing says «first start», so it is a wake.
    expect(startReasonOf({ earlierStarts: null, installed: null, browserStarted: false })).toBe('wake');
    expect(earlierStartsOf({ ok: true, value: undefined })).toBe(0);
    expect(earlierStartsOf({ ok: true, value: 4 })).toBe(4);
    expect(earlierStartsOf({ ok: true, value: 'x' })).toBeNull();
    expect(earlierStartsOf({ ok: false })).toBeNull();
  });

  it('[LG-016] [LG-018] an update, then idle unloads: «update» with the previous version once, «wake» after it, and the suspend is logged', async () => {
    world = createWorld();
    world.start();
    world.fake.fireInstalled({ reason: 'update', previousVersion: '0.9.0' });
    const page = world.page();
    expect(await page.request('session.get', {})).toMatchObject({ ok: true });
    world.fake.suspendBackground();
    expect(await page.request('session.get', {})).toMatchObject({ ok: true });
    world.fake.suspendBackground();
    expect(await page.request('session.get', {})).toMatchObject({ ok: true });
    expect(world.starts()).toBe(3);
    expect(world.fake.areas.session.get(STARTS_KEY)).toBe(3);

    const records = await exportedLogs(world);
    expect(startRecords(records).map((fields) => [fields['reason'], fields['previousVersion'] ?? null])).toEqual([
      ['update', '0.9.0'],
      ['wake', null],
      ['wake', null],
    ]);
    const lifecycle = records.filter((record) => record.scope === 'bg.lifecycle').map((record) => record.msg);
    expect(lifecycle).toEqual(['extension updated', 'background started', 'background suspending', 'background started', 'background suspending', 'background started']);
    const ready = records.filter((record) => record.msg === 'start steps').map((record) => record.fields?.['starts']);
    expect(ready).toEqual([1, 2, 3]);
  });

  it('[LG-018] the suspend record is handed to Firefox: runtime.onSuspend gets the write of the log, and the page goes only once it is done', async () => {
    world = createWorld();
    world.start();
    expect(await world.page().request('session.get', {})).toMatchObject({ ok: true });
    const background = world.fake.background();
    if (background === null) throw new Error('no background');
    // What Firefox's runtime.onSuspend gets back from each listener of the page: it waits for a promise (≤ 5 s).
    const answers = background.events.onSuspend.emit();
    const waited = answers.filter((answer): answer is Promise<void> => answer instanceof Promise);
    expect(waited).toHaveLength(1);
    await Promise.all(waited);
    // Only now does Firefox unload the page: whatever was still on its way is gone with it.
    world.fake.unloadBackground();
    const lifecycle = (await exportedLogs(world)).filter((record) => record.scope === 'bg.lifecycle').map((record) => record.msg);
    expect(lifecycle).toEqual(['background started', 'background suspending', 'background started']);
  });

  it('[ST-012] [UP-008] a real install opens the settings once — the first run starts on the sign-in screen with the checklist; a temporary install, an update and a browser start open nothing, and none of them talks to the hub', async () => {
    for (const [fire, opened] of [
      [(w: World) => w.fake.fireInstalled({ reason: 'install', temporary: false }), ['openOptionsPage']],
      // `pnpm dev` and the e2e install the build temporarily: a developer's reload is not a first run.
      [(w: World) => w.fake.fireInstalled({ reason: 'install', temporary: true }), []],
      [(w: World) => w.fake.fireInstalled({ reason: 'update', previousVersion: '0.9.0', temporary: false }), []],
      [(w: World) => w.fake.fireInstalled({ reason: 'browser_update', temporary: false }), []],
      [(w: World) => w.fake.fireStartup(), []],
    ] as const) {
      const w = createWorld();
      world = w;
      w.start();
      fire(w);
      expect(await w.page().request('session.get', {})).toMatchObject({ ok: true });
      await sleep(20);
      expect(w.fake.tabCalls).toEqual(opened);
      expect(w.hub.read().entries).toEqual([]);
      w.dispose();
    }
  });

  it('[LG-016] an install, a browser start and a reload are told apart; nothing talks to the hub on any of them (UP-008)', async () => {
    for (const [fire, reason] of [
      [(w: World) => w.fake.fireInstalled({ reason: 'install', temporary: true }), 'install'],
      [(w: World) => w.fake.fireStartup(), 'browser-start'],
      [() => undefined, 'reload'],
    ] as const) {
      const w = createWorld();
      world = w;
      const began = Date.now();
      w.start();
      fire(w);
      expect(await w.page().request('session.get', {})).toMatchObject({ ok: true });
      // Only a start with no event waits for one, and only for a moment.
      if (reason === 'reload') expect(Date.now() - began).toBeGreaterThanOrEqual(LIFECYCLE_EVENT_WAIT_MS - 20);
      expect({ reason, logged: startRecords(await exportedLogs(w)).map((fields) => fields['reason']) }).toEqual({ reason, logged: [reason] });
      expect(w.hub.read().entries).toEqual([]);
      w.dispose();
    }
  });
});
