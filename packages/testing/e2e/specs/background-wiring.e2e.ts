// The wired background (architecture.md §7, §8.3, §9.8, §9.9): the TEST
// build in a real Firefox on the stand against the fake hub, asked the way
// people ask it — by clicks on the dock, by fan messages on ChatSpace's own
// socket, by a click on an extension page.
// - three generations run at once in one tab; the fourth is refused with the
//   list of the three, and nothing of it reaches the hub;
// - a fan's message on the stand's socket is decided by the one sound arbiter:
//   it rings for a chat that is not in front, not for a muted account;
// - a click on the popup (`tab.command`) opens our window in the ChatSpace
//   tab and brings the tab to the front; «к вкладке» goes to an account
//   through ChatSpace's own router;
// - an event page unloaded in the middle of a stream: the operation comes
//   back interrupted and the hub is never asked again;
// - a sign-out in the middle of a stream cancels it;
// - a hub that offers `context-v1` is served by the archive, and a hub
//   without `client/bootstrap` (today's prod hub, the dev compat mode)
//   still signs in, binds and generates.
// The hub offers every pilot capability here: the stream declares only what
// the vendored SDK carries (docs/hub-layer.md).

import { DEFAULT_SETTINGS, STORAGE_KEYS, type SettingsV1 } from '@cg/contracts';
import { browser, expect } from '@wdio/globals';

import { callsTo } from '../../src/fake-hub/journal';
import { PAGE, WORLD } from '../../src/scenarios/hub';
import { suspendBackground } from '../support/background';
import { assignPersona, installTestBuild, pageRpc, waitForReport, writeLocalStorage, type DockReport, type SpikeReport } from '../support/extension';
import { fakeHubOrigin, testBuildPage, useFakeHub } from '../support/fake-hub';
import { useNetworkTrap } from '../support/network-trap';
import { prepareSound } from '../support/sound';
import { callStand, chatPath, foreignCalls, openStand, STAND_IDS, standServer, waitForChatReady } from '../support/stand';

const { a: accountA, b: accountB } = STAND_IDS.accounts;
const { a1, a2, a4, a5 } = STAND_IDS.fans;
const PASSWORD = 'synthetic-password';
const DEV_COMPAT_PAGES_KEY = 'dev.compatPageAccounts';

interface OpItem {
  readonly opId: string;
  readonly state: string;
  readonly target: { readonly chat: { readonly platformFanId: string } };
  readonly error?: { readonly code: string };
}
interface SoundFacts {
  readonly listeningTabs: number;
  readonly lastIncomingAt: string | null;
  readonly outcomes: Readonly<Record<string, number>>;
}

describe('background wiring — operations, sound and page commands on the stand against the fake hub', () => {
  useNetworkTrap();
  const { hub } = useFakeHub();
  let journalStart = 0;
  let standTab = '';
  let pagesTab = '';

  const toStand = async (): Promise<void> => browser.switchToWindow(standTab);
  const toPages = async (): Promise<void> => browser.switchToWindow(pagesTab);
  const dockIs = (predicate: (dock: DockReport, report: SpikeReport) => boolean, message: string, timeout = 15_000): Promise<DockReport> =>
    waitForReport((report) => report.appError !== undefined || (report.dock !== undefined && predicate(report.dock, report)), message, timeout).then((report) => {
      if (report.appError !== undefined || report.dock === undefined) throw new Error(`${message}: the tab application failed to start: ${report.appError ?? 'no dock'}`);
      return report.dock;
    });
  const press = async (dock: DockReport, name: string): Promise<void> => {
    const point = dock.hits[name];
    if (point === undefined) throw new Error(`the dock shows no «${name}» to press; it has ${Object.keys(dock.hits).join(', ')}`);
    await browser.action('pointer', { parameters: { pointerType: 'mouse' } }).move({ x: point.x, y: point.y, origin: 'viewport' }).down().up().perform();
  };
  /** The dock of `fan`'s chat, ready, with Reply on screen. */
  const openChat = async (fan: string, newTab = false): Promise<DockReport> => {
    await callStand('openChat', accountA, fan, newTab ? { newTab: true } : {});
    await waitForChatReady(accountA, fan);
    return dockIs((d) => d.status === 'ready' && d.target !== null && d.target.endsWith(`:${fan}`) && d.hits['action:reply'] !== undefined, `the dock of chat ${fan}`);
  };
  /** Presses Reply in the open chat and waits until the background admitted it and the hub streams. */
  const startReply = async (fan: string): Promise<string> => {
    const dock = await dockIs((d) => d.status === 'ready' && d.target !== null && d.target.endsWith(`:${fan}`) && d.hits['action:reply'] !== undefined, `Reply of chat ${fan} is on screen`);
    await press(dock, 'action:reply');
    const running = await dockIs((d) => d.result !== null && d.result.feature === 'reply' && d.result.state === 'streaming', `the Reply of chat ${fan} runs`);
    return running.result?.opId ?? '';
  };
  /** The operations the background knows, read from an extension page. */
  const ops = async (): Promise<readonly OpItem[]> => {
    const listed = await pageRpc<{ ops: OpItem[] }>('op.list', { scope: 'all' });
    if (!listed.ok) throw new Error(`op.list: ${listed.error.code}`);
    return listed.payload.ops;
  };
  const soundNow = async (): Promise<SoundFacts> => {
    const diagnostics = await pageRpc<{ sound: SoundFacts }>('diagnostics.get');
    if (!diagnostics.ok) throw new Error(`diagnostics.get: ${diagnostics.error.code}`);
    return diagnostics.payload.sound;
  };
  /** Successful tones only: an audio error is a failed ring. */
  const rings = (sound: SoundFacts): number => sound.outcomes['played'] ?? 0;
  const signIn = async (): Promise<void> => {
    await browser.url(testBuildPage('options.html'));
    expect(await pageRpc('session.signIn', { login: WORLD.user.username, password: PASSWORD })).toMatchObject({ ok: true });
    await assignPersona(PAGE);
    await browser.url(testBuildPage('debug-journal.html'));
  };

  before(async () => {
    await standServer.reset();
    journalStart = await standServer.mark();
    await hub().command({ op: 'pageAccount', pageLabel: PAGE, platformAccountId: STAND_IDS.platformAccounts.a });
    await installTestBuild();
    await browser.url(testBuildPage('debug-journal.html'));
    const settings: SettingsV1 = { ...DEFAULT_SETTINGS, hub: { baseUrl: fakeHubOrigin() } };
    await writeLocalStorage({ [STORAGE_KEYS.settings]: settings });
    await browser.waitUntil(
      async () => {
        const state = await pageRpc<{ settings: SettingsV1 }>('settings.get');
        return state.ok && state.payload.settings.hub.baseUrl === fakeHubOrigin();
      },
      { timeout: 15_000, timeoutMsg: 'the settings owner did not pick the hub address up' },
    );
    await signIn();
    await prepareSound();
    await browser.url(testBuildPage('debug-journal.html'));
    pagesTab = await browser.getWindowHandle();
    standTab = (await browser.createWindow('tab')).handle;
    await toStand();
    await openStand(chatPath(accountA, a1));
    await waitForChatReady(accountA, a1);
    await dockIs((d) => d.status === 'ready' && d.page === PAGE, 'the dock is signed in and bound');
  });

  after(async () => {
    await hub().command({ op: 'config', patch: { aiChunkDelayMs: 0, clientBootstrap: true, narrowTokens: true } });
    // §12 «Гейт безопасности»: nothing but the page's own client and the harness talked to the stand.
    expect(foreignCalls((await standServer.journal(journalStart)).entries)).toEqual([]);
  });

  it('[AI-123] three generations run at once in one tab; the fourth is refused with the list of the three and never reaches the hub', async function () {
    this.timeout(120_000);
    // Slow enough for a person to start four: each chunk of the model's answer takes four seconds.
    await hub().command({ op: 'config', patch: { aiChunkDelayMs: 4000 } });
    const mark = await hub().mark();
    const running: string[] = [];
    running.push(await startReply(a1));
    for (const fan of [a2, a4]) {
      await openChat(fan, true);
      running.push(await startReply(fan));
    }
    expect(new Set(running).size).toBe(3);

    const fourth = await openChat(a5, true);
    // The three of the other chats are listed in this chat's dock already.
    expect([...fourth.runningElsewhere].sort()).toEqual([...running].sort());
    await press(fourth, 'action:reply');
    const refused = await dockIs((d) => d.refusal !== null, 'the fourth start is refused');
    expect(refused.refusal).toBe('CG-OP-TAB-LIMIT');
    expect(refused.result).toBeNull();
    expect([...refused.refusalRunning].sort()).toEqual([...running].sort());

    await toPages();
    const active = (await ops()).filter((op) => op.state === 'streaming' || op.state === 'requesting' || op.state === 'admitted');
    expect(active.map((op) => op.target.chat.platformFanId).sort()).toEqual([a1, a2, a4].sort());
    // Three POSTs: a refusal spends nothing on the hub, and nothing was queued to start later.
    expect(callsTo((await hub().journal(mark)).entries, 'aiFeatureStream')).toHaveLength(3);
    // The person cancels them: the slots are free again, and the hub's streams end as aborted.
    for (const opId of running) expect(await pageRpc('op.cancel', { opId })).toMatchObject({ ok: true, payload: { state: 'canceled' } });
    await hub().command({ op: 'config', patch: { aiChunkDelayMs: 0 } });
    await toStand();
    const free = await dockIs((d) => d.target !== null && d.target.endsWith(`:${a5}`) && d.runningElsewhere.length === 0, 'nothing runs any more');
    await press(free, 'action:reply');
    const done = await dockIs((d) => d.result !== null && d.result.state === 'done', 'the fourth runs now that a slot is free', 20_000);
    expect(done.result).toMatchObject({ feature: 'reply', error: null });
    await toPages();
    expect(callsTo((await hub().journal(mark)).entries, 'aiFeatureStream')).toHaveLength(4);
    await toStand();
  });

  it('[SN-001] [SN-008] [ST-075] a fan’s message on the stand’s socket is decided by the arbiter: it rings for a chat that is not in front, once, and not for a muted account', async function () {
    this.timeout(90_000);
    await toStand();
    await openChat(a1);
    await toPages();
    // The arbiter rings only for an account this browser has seen: the tab says which accounts its ChatSpace
    // shows with its first presence report, a moment after it registered (`accounts.seen` is the popup's request).
    await browser.url(testBuildPage('popup.html'));
    await browser.waitUntil(
      async () => {
        const seen = await pageRpc<{ accounts: ReadonlyArray<{ account: { hostAccountId: string }; openTabs: number }> }>('accounts.seen');
        return seen.ok && seen.payload.accounts.some((item) => item.account.hostAccountId === accountA && item.openTabs > 0);
      },
      { timeout: 10_000, timeoutMsg: 'the background has not heard which accounts the tab shows' },
    );
    const before = await soundNow();
    expect(before.listeningTabs).toBe(1);

    // A message in a chat the person is not looking at (the stand tab is behind the pages tab now).
    await standServer.fanMessage(accountA, a2);
    let seen = before;
    try {
      await browser.waitUntil(async () => rings((seen = await soundNow())) === rings(before) + 1, { timeout: 10_000 });
    } catch {
      throw new Error(`the message did not ring: the arbiter decided ${JSON.stringify(seen.outcomes)} (before: ${JSON.stringify(before.outcomes)})`);
    }
    const rang = await soundNow();
    expect(rang.lastIncomingAt).not.toBeNull();
    // The tap and ChatSpace's stores both report it; the second report rings nothing.
    await browser.pause(1500);
    expect(rings(await soundNow())).toBe(rings(before) + 1);

    // The model's account is muted in the settings: the next message is silent, and counted as such.
    await browser.pause(2100);
    expect(await pageRpc('settings.patch', { patch: { sound: { mutedAccounts: [`chatspace:${accountA}`] } }, baseRevision: null })).toMatchObject({ ok: true });
    await standServer.fanMessage(accountA, a4);
    await browser.waitUntil(async () => ((await soundNow()).outcomes['muted'] ?? 0) > (rang.outcomes['muted'] ?? 0), { timeout: 10_000, timeoutMsg: 'the muted account was not counted' });
    expect(rings(await soundNow())).toBe(rings(before) + 1);
    expect(await pageRpc('settings.patch', { patch: { sound: { mutedAccounts: [] } }, baseRevision: null })).toMatchObject({ ok: true });

    // The chat in front of the person: no sound for what they already see.
    await toStand();
    const inFront = await browser.execute(() => document.visibilityState === 'visible' && document.hasFocus());
    // The tab says it is in front before the message comes (its presence report is debounced).
    await browser.pause(2500);
    await standServer.fanMessage(accountA, a1);
    await browser.pause(2000);
    await toPages();
    const after = await soundNow();
    if (inFront) {
      expect(after.outcomes['open-chat'] ?? 0).toBeGreaterThan(rang.outcomes['open-chat'] ?? 0);
      expect(rings(after)).toBe(rings(before) + 1);
    } else {
      // A headless window without the focus: the chat is not «in front», the message rings.
      expect(rings(after)).toBe(rings(before) + 2);
    }
    await browser.url(testBuildPage('debug-journal.html'));
    await toStand();
  });

  it('[PU-017] [ST-076] a click on the popup opens Spenders in the ChatSpace tab; «к вкладке» goes to the account through ChatSpace’s own router', async function () {
    this.timeout(90_000);
    await toStand();
    await openChat(a1);
    await toPages();
    await browser.url(testBuildPage('popup.html'));
    expect(await pageRpc('tab.command', { command: { kind: 'surface', surface: 'spenders' } })).toEqual({ ok: true, payload: { delivered: true } });
    await toStand();
    const open = await dockIs((d) => d.overlays.includes('spenders') && d.surfaces.includes('spenders'), 'the Spenders window is open', 20_000);
    expect(open.views).toContain('spenders.board');
    expect((await callStand('route')).chatId).toBe(a1);
    await browser.keys('Escape');
    await dockIs((d) => !d.overlays.includes('spenders'), 'the Spenders window is closed');

    // «к вкладке» of another account. That account is bound to no hub page, so no page's own `navigation` answers
    // for it: the owner's `"*"` row does (docs/protocols/hub.md «Флаги: решает страница») — and in a pilot switched
    // on page by page that row is empty. Our navigation does not walk into an account nobody switched it on for.
    await toPages();
    await browser.url(testBuildPage('options.html'));
    const mark = await standServer.mark();
    const toAccountB = { command: { kind: 'account', host: 'chatspace', hostAccountId: accountB } } as const;
    expect(await pageRpc('tab.command', toAccountB)).toEqual({ ok: true, payload: { delivered: true } });
    await toStand();
    await browser.pause(1500);
    expect((await callStand('route')).accountId).toBe(accountA);
    // The owner switches navigation on for every page (the `"*"` row): now the tab's own router opens the account —
    // a navigation, nothing loaded by us.
    await hub().command({ op: 'config', patch: { flags: { navigation: true } } });
    await toPages();
    expect(await pageRpc('bootstrap.get', { force: true })).toMatchObject({ ok: true });
    await browser.waitUntil(
      async () => {
        // The tab hears the new `"*"` row a moment after the background read it: the click is repeated until it lands.
        await toPages();
        await pageRpc('tab.command', toAccountB);
        await toStand();
        await browser.pause(300);
        return (await callStand('route')).accountId === accountB;
      },
      { timeout: 15_000, interval: 200, timeoutMsg: 'the tab did not go to the account' },
    );
    expect(foreignCalls((await standServer.journal(mark)).entries)).toEqual([]);
    // An account no tab shows: nothing is delivered, nothing moves.
    await toPages();
    expect(await pageRpc('tab.command', { command: { kind: 'account', host: 'chatspace', hostAccountId: '999999' } })).toEqual({ ok: true, payload: { delivered: false } });
    await browser.url(testBuildPage('debug-journal.html'));
    await toStand();
    expect((await callStand('route')).accountId).toBe(accountB);
    await openChat(a1);
  });

  it('[BG-004] [RB-003] the event page unloaded in the middle of a stream: the operation comes back interrupted, and the hub is not asked again', async function () {
    this.timeout(120_000);
    await hub().command({ op: 'config', patch: { aiChunkDelayMs: 4000 } });
    const mark = await hub().mark();
    await toStand();
    await openChat(a2);
    const opId = await startReply(a2);
    expect(callsTo((await hub().journal(mark)).entries, 'aiFeatureStream')).toHaveLength(1);
    const registrations = (await waitForReport((report) => report.rpc?.registered === true, 'the tab is registered')).rpc?.registrations ?? 0;

    await toPages();
    expect(await suspendBackground()).not.toBe('running');
    await toStand();
    // The open tab wakes the page and registers with the new instance, which restored the journal.
    await waitForReport((report) => (report.rpc?.registrations ?? 0) > registrations && report.rpc?.state === 'ready', 'the tab registered with the new instance', 30_000);
    const interrupted = await dockIs((d) => d.result !== null && d.result.opId === opId && d.result.state === 'interrupted', 'the operation is shown as interrupted', 20_000);
    expect(interrupted.result).toMatchObject({ error: 'CG-OP-INTERRUPTED', parts: 0, streaming: false });
    await hub().command({ op: 'config', patch: { aiChunkDelayMs: 0 } });
    await browser.pause(3000);
    await toPages();
    expect((await ops()).find((op) => op.opId === opId)).toMatchObject({ state: 'interrupted', error: { code: 'CG-OP-INTERRUPTED' } });
    // One POST in all: the new instance repeated nothing.
    expect(callsTo((await hub().journal(mark)).entries, 'aiFeatureStream')).toHaveLength(1);
    await toStand();
  });

  it('[AI-126] [AU-018] a sign-out in the middle of a stream cancels it: the tab shows «not signed in», nothing of the person is left, the hub’s stream was cut', async function () {
    this.timeout(120_000);
    await hub().command({ op: 'config', patch: { aiChunkDelayMs: 4000 } });
    const mark = await hub().mark();
    await toStand();
    await openChat(a4);
    const opId = await startReply(a4);
    await toPages();
    expect((await ops()).find((op) => op.opId === opId)?.state).toBe('streaming');
    expect(await pageRpc('session.signOut')).toMatchObject({ ok: true, payload: { serverRevoked: true } });
    expect(await ops()).toEqual([]);
    await toStand();
    const out = await dockIs((d) => d.status === 'not-signed-in', 'the open tab shows «not signed in»');
    expect(out).toMatchObject({ login: '', banner: 'CG-AUTH-REQUIRED' });
    await hub().command({ op: 'config', patch: { aiChunkDelayMs: 0 } });
    await browser.pause(1500);
    const calls = callsTo((await hub().journal(mark)).entries, 'aiFeatureStream');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.stream?.outcome).toBe('aborted');
    expect(calls[0]?.stream?.frames).not.toContain('done');
  });

  it('a hub without client/bootstrap (the dev compat mode, debug on): sign-in, binding by the dev map and a generation through the existing stream work; «Новые» is not asked of a hub that cannot serve it', async function () {
    this.timeout(120_000);
    // A hub before H-2 and H-3, as prod is today.
    await hub().command({ op: 'config', patch: { clientBootstrap: false, narrowTokens: false } });
    await toPages();
    await browser.url(testBuildPage('options.html'));
    expect(await pageRpc('settings.patchRestricted', { patch: { debug: { enabled: true } }, baseRevision: null })).toMatchObject({ ok: true });
    await writeLocalStorage({ [DEV_COMPAT_PAGES_KEY]: { [PAGE]: STAND_IDS.platformAccounts.a } });
    const mark = await hub().mark();
    expect(await pageRpc('session.signIn', { login: WORLD.user.username, password: PASSWORD })).toMatchObject({ ok: true });
    await assignPersona(PAGE);
    const bootstrap = await pageRpc<{ capabilities: readonly string[]; pages: ReadonlyArray<{ pageId: number; pageLabel: string; features: Record<string, { available: boolean; reason?: string }> }> }>('bootstrap.get');
    expect(bootstrap).toMatchObject({ ok: true, payload: { capabilities: [] } });
    const page = bootstrap.ok ? bootstrap.payload.pages.find((item) => item.pageLabel === PAGE) : undefined;
    expect(page?.features).toMatchObject({ insertion: { available: true }, newcomers: { available: false, reason: 'hub_not_ready' }, preview: { available: false, reason: 'hub_not_ready' }, recap: { available: false, reason: 'hub_not_ready' } });
    // What needs a new hub route is refused here with a code and is never asked of the hub.
    await browser.url(testBuildPage('popup.html'));
    expect(await pageRpc('newcomers.list', { pageId: page?.pageId ?? 0, windowHours: 48, cursor: null })).toMatchObject({ ok: false, error: { code: 'CG-HUB-CAPABILITY' } });
    await browser.url(testBuildPage('debug-journal.html'));

    await toStand();
    const dock = await openChat(a5);
    expect(dock).toMatchObject({ page: PAGE, login: WORLD.user.username, banner: null });
    await press(dock, 'action:reply');
    const done = await dockIs((d) => d.result !== null && d.result.state === 'done', 'the Reply result on the compat bootstrap', 20_000);
    expect(done.result).toMatchObject({ feature: 'reply', error: null });
    expect(done.result?.parts ?? 0).toBeGreaterThan(0);

    const entries = (await hub().journal(mark)).entries;
    expect(callsTo(entries, 'clientBootstrap').map((entry) => entry.status)).toContain(404);
    expect(callsTo(entries, 'aiFeatureStream').map((entry) => entry.status)).toEqual([200]);
    expect(callsTo(entries, 'clientAudienceNew')).toEqual([]);

    // Leave as found: signed out, debug off, the hub as deployed.
    await toPages();
    expect(await pageRpc('session.signOut')).toMatchObject({ ok: true });
    await browser.url(testBuildPage('options.html'));
    expect(await pageRpc('settings.patchRestricted', { patch: { debug: { enabled: false } }, baseRevision: null })).toMatchObject({ ok: true });
    await browser.url(testBuildPage('debug-journal.html'));
    await hub().command({ op: 'config', patch: { clientBootstrap: true, narrowTokens: true } });
    await toStand();
  });
});
