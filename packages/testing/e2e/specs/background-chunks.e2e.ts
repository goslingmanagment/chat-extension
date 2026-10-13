// ChatSpace's background chunk in a real Firefox (docs/project-unite/architecture.md §3.3; plan.md F1): the TEST
// build's event page loads `bg/chatspace.js` — the real file of the XPI, the real kit of the core — with
// `import(runtime.getURL(…))` from the classic event page, on the stand, against the fake hub.
// - start: the open ChatSpace tab starts the chunk; the core's diagnostics say `started` and X8's requests answer;
// - an import error: the test build's fault switch makes the next load ask for a file that is not in the build —
//   Firefox's own error. The core goes on (the sign-in, the dock), the site's requests answer CG-RUNTIME-UNREACHABLE,
//   «Статус» warns; after the retry pause the next request loads the same file at a new address (`?attempt=2`);
// - a restart with an open X8 attempt journaled and no ChatSpace tab: the chunk starts with the event page itself,
//   and the attempt holds its fan, uncertain.
// The privileged side of Firefox is driven through e2e/support/background.ts.

import { DEFAULT_SETTINGS, STORAGE_KEYS, type LogRecord, type SendJournalEntry, type SettingsV1 } from '@cg/contracts';
import { browser, expect } from '@wdio/globals';

import { PAGE, WORLD } from '../../src/scenarios/hub';
import { suspendBackground } from '../support/background';
import { assignPersona, installTestBuild, pageRpc, readReport, waitForReport, writeLocalStorage, type DockReport, type SpikeReport } from '../support/extension';
import { fakeHubOrigin, testBuildPage, useFakeHub } from '../support/fake-hub';
import { useNetworkTrap } from '../support/network-trap';
import { openOptions, waitForOptions } from '../support/pages';
import { chatPath, foreignCalls, openStand, STAND_IDS, standServer, waitForChatReady } from '../support/stand';

const { a: accountA } = STAND_IDS.accounts;
const { a1 } = STAND_IDS.fans;
const PASSWORD = 'synthetic-password';
/** The test build's fault switch of the core's loader (composition/background.ts HOST_MODULE_FAULT_KEY). */
const FAULT_KEY = 'dev.hostModuleFault';
/** The loader's pause before a new try in one realm (composition/background/host-modules.ts RETRY_AFTER_MS), and room. */
const RETRY_WAIT_MS = 30_000;

interface Diagnostics {
  readonly session: { readonly signedIn: boolean };
  readonly sends: { readonly open: number; readonly uncertain: number };
  readonly hostModules?: ReadonlyArray<{ readonly host: string; readonly state: string }>;
}

const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

describe('background chunks — ChatSpace’s services in bg/chatspace.js, loaded by the core (R20 F1)', () => {
  useNetworkTrap();
  const { hub } = useFakeHub();
  let journalStart = 0;
  let standTab = '';
  let pagesTab = '';

  const toStand = async (): Promise<void> => browser.switchToWindow(standTab);
  const toPages = async (): Promise<void> => browser.switchToWindow(pagesTab);
  const rpcOf = (report: SpikeReport | null): SpikeReport['rpc'] => report?.rpc;
  const dockIs = (predicate: (dock: DockReport) => boolean, message: string): Promise<SpikeReport> =>
    waitForReport((report) => report.appError !== undefined || (report.dock !== undefined && predicate(report.dock)), message).then((report) => {
      if (report.appError !== undefined) throw new Error(`${message}: the tab application failed to start: ${report.appError}`);
      return report;
    });
  const diagnosticsNow = async (): Promise<Diagnostics> => {
    const answer = await pageRpc<Diagnostics>('diagnostics.get');
    if (!answer.ok) throw new Error(`diagnostics.get: ${answer.error.code}`);
    return answer.payload;
  };
  const chatspaceState = async (): Promise<string | null> => (await diagnosticsNow()).hostModules?.find((module) => module.host === 'chatspace')?.state ?? null;
  const stateBecomes = async (wanted: string, message: string, timeout = 15_000): Promise<void> => {
    let last: string | null = null;
    try {
      await browser.waitUntil(async () => (last = await chatspaceState()) === wanted, { timeout, interval: 300 });
    } catch {
      throw new Error(`${message}: ChatSpace’s background module is «${String(last)}», not «${wanted}»`);
    }
  };
  /** The records of the diagnostics export, oldest first (the export is the options page's request alone). */
  const exportedLogs = async (): Promise<LogRecord[]> => {
    await browser.url(testBuildPage('options.html'));
    const file = await pageRpc<{ body: string }>('diagnostics.export', { format: 'json' });
    await browser.url(testBuildPage('debug-journal.html'));
    if (!file.ok) throw new Error(`diagnostics.export: ${file.error.code}`);
    return (JSON.parse(file.payload.body) as { logs?: { recent?: LogRecord[] } }).logs?.recent ?? [];
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
    await browser.url(testBuildPage('options.html'));
    expect(await pageRpc('session.signIn', { login: WORLD.user.username, password: PASSWORD })).toMatchObject({ ok: true });
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
    expect(foreignCalls((await standServer.journal(journalStart)).entries)).toEqual([]);
  });

  it('[R20-F1] the open ChatSpace tab starts the real chunk: the core says `started`, X8’s requests answer from it', async () => {
    await toPages();
    await stateBecomes('started', 'the chunk with the first tab');
    expect(await pageRpc('send.fuseState')).toEqual({ ok: true, payload: { fuse: null, resetAt: null } });
    const logs = await exportedLogs();
    const started = logs.filter((record) => record.scope === 'bg.hosts' && record.msg === 'site module started');
    expect(started.length).toBeGreaterThanOrEqual(1);
    expect(started[0]?.fields).toMatchObject({ host: 'chatspace', attempt: 1 });
  });

  it('[R20-F1] an import error in the real event page: the core goes on, the site’s requests answer CG-RUNTIME-UNREACHABLE, «Статус» warns; after the pause a new address loads the same file', async function () {
    this.timeout(180_000);
    await toPages();
    await writeLocalStorage({ [FAULT_KEY]: 'chatspace' });
    await toStand();
    const registrations = rpcOf(await readReport())?.registrations ?? 0;
    await toPages();
    expect(await suspendBackground()).toBe('stopped');
    await toStand();
    await waitForReport((report) => (rpcOf(report)?.registrations ?? 0) > registrations && rpcOf(report)?.state === 'ready', 'the tab registered with the new instance');

    await toPages();
    await stateBecomes('failed', 'the chunk whose file is not there');
    expect(await pageRpc('send.fuseState')).toEqual({ ok: false, error: { code: 'CG-RUNTIME-UNREACHABLE', detail: 'chatspace services' } });
    // The core goes on: the sign-in and the dock of the open tab are as they were.
    expect((await diagnosticsNow()).session.signedIn).toBe(true);
    await toStand();
    await dockIs((dock) => dock.status === 'ready' && dock.page === PAGE, 'the dock without the site’s services');
    // «Статус» says the site's services did not start.
    await toPages();
    await openOptions('status');
    await waitForOptions((state) => state.text.includes('фоновые службы сайта не запустились'), '«Статус» warns of the site’s services');
    await browser.url(testBuildPage('debug-journal.html'));

    // The file is back: the next request after the pause loads it at a new address of the same realm.
    await writeLocalStorage({ [FAULT_KEY]: '' });
    await browser.waitUntil(async () => (await pageRpc('send.fuseState')).ok, { timeout: RETRY_WAIT_MS, interval: 2_000, timeoutMsg: 'the chunk did not load again after the pause' });
    expect(await chatspaceState()).toBe('started');
    const records = (await exportedLogs()).filter((record) => record.scope === 'bg.hosts');
    expect(records.find((record) => record.msg === 'site module did not start')?.fields).toMatchObject({ host: 'chatspace', attempt: 1, stage: 'import', error: 'TypeError' });
    // A try in the same realm is a new address: the first one after the failure (or a later one, on a slow machine).
    const again = records.filter((record) => record.msg === 'site module started').at(-1)?.fields;
    expect(again).toMatchObject({ host: 'chatspace' });
    expect(Number(again?.['attempt'])).toBeGreaterThanOrEqual(2);
  });

  it('[R20-F1] [X8-07] a restart with an open X8 attempt and no ChatSpace tab: the chunk starts with the event page, and the attempt holds its fan, uncertain', async () => {
    await toStand();
    await browser.closeWindow();
    await toPages();
    // The previous instance journaled an attempt and ChatSpace took it into its queue; then the page was gone.
    const at = Date.now() - 4_000;
    const attempt: SendJournalEntry = {
      attemptId: uuid(41),
      hubOrigin: fakeHubOrigin(),
      pageId: WORLD.pages.one.pageId,
      platform: 'onlyfans',
      fanRef: a1,
      hostAccountId: accountA,
      purpose: 'preview-reply',
      opId: uuid(42),
      group: { generationRef: uuid(43), variant: 0, partCount: 1 },
      partIndex: 0,
      previewRevision: 1,
      documentEpoch: 'doc1',
      state: 'nativeEnqueued',
      pendingId: uuid(44),
      createdAt: at,
      updatedAt: at,
    };
    await writeLocalStorage({ [STORAGE_KEYS.sendJournal]: { v: 1, entries: [attempt] } });
    expect(await suspendBackground()).toBe('stopped');
    // A page's request wakes it; nothing of ChatSpace is open.
    await stateBecomes('started', 'the chunk with the event page: an X8 journal is pending');
    expect((await diagnosticsNow()).sends).toEqual({ open: 0, uncertain: 1 });
  });
});
