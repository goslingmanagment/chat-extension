// The life of the event page under an open ChatSpace tab (architecture.md §7
// «Фон и выгрузка»): the TEST build in a real Firefox, on the stand, against
// the fake hub. Firefox unloads an event page after 30 s without an event
// delivered to it, and an open port does not hold it — so the e2e checks what
// the browser really does, not what a fake of it does:
// - [BG-003] an open ChatSpace tab keeps the event page alive across idle
//   timeouts, in front and as a background tab, and without a tab the page
//   is unloaded;
// - a suspended page (onSuspend, unload) is woken by the open tab, which
//   registers again; the new instance has the sign-in, the tab's chat, its
//   host contract and the alarms, and the log says what happened;
// - a change of the settings reaches the open tab and the pages;
// - a new instance with another sign-in state is asked again by the tab.
// The privileged side of Firefox is driven through e2e/support/background.ts.

import { DEFAULT_SETTINGS, STORAGE_KEYS, type LogRecord, type SettingsV1 } from '@cg/contracts';
import { PAGE_PORT_NAME } from '@cg/contracts/tab-protocol';
import { browser, expect } from '@wdio/globals';

import { callsTo } from '../../src/fake-hub/journal';
import { PAGE, WORLD } from '../../src/scenarios/hub';
import { backgroundState, setBackgroundIdleTimeout, suspendBackground, waitForBackgroundState } from '../support/background';
import { assignPersona, installTestBuild, pageRpc, readReport, standUrl, waitForReport, writeLocalStorage, type DockReport, type SpikeReport } from '../support/extension';
import { fakeHubOrigin, testBuildPage, useFakeHub } from '../support/fake-hub';
import { useNetworkTrap } from '../support/network-trap';
import { chatPath, foreignCalls, openStand, STAND_IDS, standServer, waitForChatReady } from '../support/stand';

const { a: accountA } = STAND_IDS.accounts;
const { a1 } = STAND_IDS.fans;
const PASSWORD = 'synthetic-password';
/** Short enough for a test, and twice the tab's keepalive period (KEEPALIVE_MS, 10 s): a beat late by seconds on a loaded machine still lands inside it. */
const IDLE_TIMEOUT_MS = 20_000;
const ALARM_NAMES = ['cg.hub.bootstrap', 'cg.results.sweep', 'cg.telemetry.flush', 'cg.telemetry.health'];

interface Diagnostics {
  readonly session: { readonly signedIn: boolean };
  readonly tabs: ReadonlyArray<{ readonly tabSessionId: string; readonly host: { readonly build: string | null } | null; readonly chatKey: string | null }>;
}
const rpcOf = (report: SpikeReport | null): SpikeReport['rpc'] => report?.rpc;

/**
 * The records of the diagnostics export, oldest first. The export is the options page's request alone
 * (§5.4), so the pages tab goes there for it and comes back to the page that asks the background nothing.
 */
async function exportedLogs(): Promise<LogRecord[]> {
  await browser.url(testBuildPage('options.html'));
  const file = await pageRpc<{ body: string }>('diagnostics.export', { format: 'json' });
  await browser.url(testBuildPage('debug-journal.html'));
  if (!file.ok) throw new Error(`diagnostics.export: ${file.error.code}`);
  return (JSON.parse(file.payload.body) as { logs?: { recent?: LogRecord[] } }).logs?.recent ?? [];
}

describe('lifecycle — the event page under an open ChatSpace tab', () => {
  useNetworkTrap();
  const { hub } = useFakeHub();
  let journalStart = 0;
  let standTab = '';
  let pagesTab = '';

  const toStand = async (): Promise<void> => browser.switchToWindow(standTab);
  const toPages = async (): Promise<void> => browser.switchToWindow(pagesTab);
  const dockIs = (predicate: (dock: DockReport, report: SpikeReport) => boolean, message: string, timeout = 15_000): Promise<SpikeReport> =>
    waitForReport((report) => report.appError !== undefined || (report.dock !== undefined && predicate(report.dock, report)), message, timeout).then((report) => {
      if (report.appError !== undefined) throw new Error(`${message}: the tab application failed to start: ${report.appError}`);
      return report;
    });
  const diagnosticsNow = async (): Promise<Diagnostics> => {
    const answer = await pageRpc<Diagnostics>('diagnostics.get');
    if (!answer.ok) throw new Error(`diagnostics.get: ${answer.error.code}`);
    return answer.payload;
  };
  /** true — the ChatSpace tab is a background tab of the browser: another tab is selected. Asked of the browser, not of the event page. */
  const standInBackground = async (): Promise<boolean> =>
    browser.execute(async (origin: string) => {
      const api = (globalThis as unknown as { browser: { tabs: { query(query: { active: boolean }): Promise<Array<{ url?: string }>> } } }).browser;
      return (await api.tabs.query({ active: false })).some((tab) => tab.url?.startsWith(origin) === true);
    }, new URL(standUrl('/')).origin);
  /** The tab as the background knows it once it reported its chat and its host contract. */
  const tabKnown = async (message: string): Promise<Diagnostics['tabs'][number]> => {
    let last: Diagnostics['tabs'] = [];
    try {
      await browser.waitUntil(
        async () => {
          last = (await diagnosticsNow()).tabs;
          const tab = last[0];
          return last.length === 1 && tab !== undefined && tab.host !== null && tab.chatKey !== null;
        },
        { timeout: 10_000, interval: 200 },
      );
    } catch {
      // What the background knew at the last look: a tab without `host` or `chatKey` did not report it.
      const known = last.map((tab) => ({ tabSessionId: tab.tabSessionId, host: tab.host === null ? null : tab.host.build, chatKey: tab.chatKey }));
      throw new Error(`${message}: the background knows ${JSON.stringify(known)}`);
    }
    return last[0] as Diagnostics['tabs'][number];
  };

  before(async () => {
    await standServer.reset();
    journalStart = await standServer.mark();
    await hub().command({ op: 'pageAccount', pageLabel: PAGE, platformAccountId: STAND_IDS.platformAccounts.a });
    await installTestBuild();
    // The hub address goes in from a page that asks the background nothing by itself, before anything reads it.
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
    // The sign-in is the options page's request; the page itself is left at once (it keeps asking for the status).
    await browser.url(testBuildPage('options.html'));
    expect(await pageRpc('session.signIn', { login: WORLD.user.username, password: PASSWORD })).toMatchObject({ ok: true });
    // The page has its persona: the dock of its chats is ready to work.
    await assignPersona(PAGE);
    await browser.url(testBuildPage('debug-journal.html'));
    pagesTab = await browser.getWindowHandle();
    standTab = (await browser.createWindow('tab')).handle;
    await toStand();
    await openStand(chatPath(accountA, a1));
    await waitForChatReady(accountA, a1);
    await dockIs((dock) => dock.status === 'ready' && dock.page === PAGE, 'the dock is signed in and bound');
  });

  after(async () => {
    await setBackgroundIdleTimeout(null);
    expect(foreignCalls((await standServer.journal(journalStart)).entries)).toEqual([]);
  });

  it('[BG-002] a suspended event page is woken by the open tab: it registers again, and the new instance has the sign-in, the tab’s chat, its host contract and the alarms', async () => {
    await toPages();
    const before = await tabKnown('before the suspend');
    await toStand();
    const registrations = rpcOf(await readReport())?.registrations ?? 0;
    expect(registrations).toBeGreaterThanOrEqual(1);

    await toPages();
    // A bootstrap read just now: however slow the run was up to here, the tab's «focus» with the new instance
    // (read again only past a minute, §8.3) finds it fresh.
    expect(await pageRpc('bootstrap.get', { force: true })).toMatchObject({ ok: true });
    const mark = await hub().mark();
    await suspendBackground();
    await toStand();
    const report = await waitForReport((r) => (rpcOf(r)?.registrations ?? 0) > registrations && rpcOf(r)?.state === 'ready', 'the tab registered again with the new instance');
    expect(rpcOf(report)?.registered).toBe(true);
    // The dock still shows who is signed in and the page of the open account: nothing was lost with the old instance.
    await dockIs((dock) => dock.status === 'ready' && dock.login === WORLD.user.username && dock.page === PAGE && dock.contract === 'ok', 'the dock after the restart');

    await toPages();
    expect(await backgroundState()).toBe('running');
    const after = await tabKnown('after the restart');
    expect(after.tabSessionId).not.toBe(before.tabSessionId);
    expect(after.chatKey).toBe(before.chatKey);
    expect(after.host?.build).toBe(before.host?.build);
    expect((await diagnosticsNow()).session.signedIn).toBe(true);
    // Alarms survive the unload, and the new instance arms none twice.
    const alarms = await browser.execute(async () => {
      const api = (globalThis as unknown as { browser: { alarms: { getAll(): Promise<Array<{ name: string; periodInMinutes?: number }>> } } }).browser;
      return (await api.alarms.getAll()).map((alarm) => [alarm.name, (alarm.periodInMinutes ?? 0) > 0] as const);
    });
    expect([...alarms].sort()).toEqual(ALARM_NAMES.map((name) => [name, true]));
    // The restored sign-in read nothing from the hub again: its stored bootstrap and catalog were fresh.
    const entries = (await hub().journal(mark)).entries;
    expect(callsTo(entries, 'clientBootstrap')).toEqual([]);
    expect(callsTo(entries, 'aiPersonaCatalog')).toEqual([]);
  });

  it('[LG-016] [LG-018] the log tells the install from the wake, and has the suspend between them', async () => {
    await toPages();
    const lifecycle = (await exportedLogs()).filter((record) => record.scope === 'bg.lifecycle');
    const words = lifecycle.map((record) => (record.msg === 'background started' ? `started:${String(record.fields?.['reason'])}` : record.msg));
    expect(words[0]).toBe('extension installed');
    expect(words.filter((word) => word.startsWith('started:'))).toEqual(['started:install', 'started:wake']);
    expect(words.indexOf('background suspending')).toBeGreaterThan(words.indexOf('started:install'));
    expect(words.indexOf('background suspending')).toBeLessThan(words.indexOf('started:wake'));
  });

  it('[BG-005] a change of the settings made on a page reaches the open tab (the dock changes its language) and the pages', async () => {
    await toStand();
    const languageBefore = (await dockIs((dock) => dock.status === 'ready', 'the dock')).dock?.language;
    expect(languageBefore).toBe('ru');
    await toPages();
    // What a page hears: the events of its own `cg-page` port.
    await browser.execute((portName: string) => {
      const api = (globalThis as unknown as { browser: { runtime: { connect(info: { name: string }): { onMessage: { addListener(listener: (message: unknown) => void): void } } } } }).browser;
      const heard: unknown[] = [];
      (window as unknown as { cgHeard: unknown[] }).cgHeard = heard;
      api.runtime.connect({ name: portName }).onMessage.addListener((message) => heard.push(message));
    }, PAGE_PORT_NAME);
    const saved = await pageRpc<{ revision: number }>('settings.patch', { patch: { ui: { locale: 'en' } }, baseRevision: null });
    expect(saved).toMatchObject({ ok: true });
    await browser.waitUntil(
      async () =>
        browser.execute(() =>
          (window as unknown as { cgHeard: Array<{ kind?: string; type?: string; payload?: { settings?: { ui?: { locale?: string } } } }> }).cgHeard.some(
            (message) => message.kind === 'evt' && message.type === 'settings.changed' && message.payload?.settings?.ui?.locale === 'en',
          ),
        ),
      { timeout: 5000, timeoutMsg: 'the page did not hear settings.changed' },
    );
    await toStand();
    await dockIs((dock) => dock.language === 'en', 'the dock switched to English');
    // Leave as found.
    await toPages();
    expect(await pageRpc('settings.patch', { patch: { ui: { locale: 'ru' } }, baseRevision: null })).toMatchObject({ ok: true });
    await toStand();
    await dockIs((dock) => dock.language === 'ru', 'the dock is back in Russian');
  });

  it('[BG-003] an open ChatSpace tab keeps the event page alive across idle timeouts, in front and in the background; without a tab the page is unloaded', async function () {
    this.timeout(180_000);
    await toPages();
    await setBackgroundIdleTimeout(IDLE_TIMEOUT_MS);
    // The running page counts with the timer it started: its next instance takes the new timeout.
    await toStand();
    const registrations = rpcOf(await readReport())?.registrations ?? 0;
    await toPages();
    await suspendBackground();
    await toStand();
    await waitForReport((r) => (rpcOf(r)?.registrations ?? 0) > registrations && rpcOf(r)?.state === 'ready', 'the tab registered with the instance that counts the short timeout');
    await toPages();
    const known = await tabKnown('the tab before the wait');

    // More than a timeout with nobody talking to the background but the tab itself — the tab in front.
    await toStand();
    // The tab coming to the front may be a «focus» (a bootstrap read once it is older than a minute, §8.3):
    // it is over before the mark, and the tab does not come to the front again until the journal is read.
    await browser.pause(1500);
    const mark = await hub().mark();
    const states = new Set<string>();
    const inFrontUntil = Date.now() + IDLE_TIMEOUT_MS + 5000;
    while (Date.now() < inFrontUntil) {
      const rpc = rpcOf(await readReport());
      states.add(`${rpc?.state}:${rpc?.registrations}`);
      await browser.pause(500);
    }
    expect([...states]).toEqual([`ready:${registrations + 1}`]);

    // And once more with the tab in the background, where the browser slows its timers down: another tab is
    // selected, and that tab asks the background nothing (the state is read on the browser's privileged side).
    await toPages();
    expect(await standInBackground()).toBe(true);
    const background = new Set<string>();
    const hiddenUntil = Date.now() + IDLE_TIMEOUT_MS + 8000;
    while (Date.now() < hiddenUntil) {
      background.add(await backgroundState());
      await browser.pause(1000);
    }
    expect([...background]).toEqual(['running']);
    // The same instance all along: nothing read the bootstrap or the catalog again…
    const entries = (await hub().journal(mark)).entries;
    expect(callsTo(entries, 'clientBootstrap')).toEqual([]);
    expect(callsTo(entries, 'aiPersonaCatalog')).toEqual([]);
    // …and the tab is the session it was, registered once with this instance.
    const still = await tabKnown('the tab after the wait');
    expect(still.tabSessionId).toBe(known.tabSessionId);
    await toStand();
    expect(rpcOf(await readReport())).toMatchObject({ state: 'ready', registrations: registrations + 1 });

    // The tab leaves ChatSpace: nothing holds the page now, and the same timeout unloads it.
    await browser.url('about:blank');
    await toPages();
    await waitForBackgroundState('stopped', 'no ChatSpace tab is open', IDLE_TIMEOUT_MS + 15_000);

    // And the tab coming back wakes it.
    await setBackgroundIdleTimeout(null);
    await toStand();
    await openStand(chatPath(accountA, a1));
    await waitForChatReady(accountA, a1);
    await dockIs((dock) => dock.status === 'ready' && dock.login === WORLD.user.username && dock.page === PAGE, 'the tab came back and is signed in');
    await toPages();
    expect(await backgroundState()).toBe('running');
  });

  it('a new instance with another sign-in state: the tab asks again when it registers and shows «not signed in»', async () => {
    await toStand();
    await dockIs((dock) => dock.status === 'ready', 'signed in before');
    const registrations = rpcOf(await readReport())?.registrations ?? 0;
    // The sign-in ends where no running instance hears it: the stored record is gone when the next one starts.
    await toPages();
    await browser.execute(async (key: string) => {
      const api = (globalThis as unknown as { browser: { storage: { local: { remove(key: string): Promise<void> } } } }).browser;
      await api.storage.local.remove(key);
    }, STORAGE_KEYS.authToken);
    await suspendBackground();
    await toStand();
    await waitForReport((r) => (rpcOf(r)?.registrations ?? 0) > registrations && rpcOf(r)?.state === 'ready', 'the tab registered again');
    const report = await dockIs((dock) => dock.status === 'not-signed-in', 'the dock learned that nobody is signed in');
    expect(report.dock).toMatchObject({ login: '', page: '', banner: 'CG-AUTH-REQUIRED' });
    await toPages();
    expect(await pageRpc('session.get')).toEqual({ ok: true, payload: { session: null } });
  });
});
