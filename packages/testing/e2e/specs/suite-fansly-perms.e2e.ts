// R20 P14c: Fansly's rights and its switch on the stand, in Firefox (spec FS-PERM-1…5, FS-IDN-4; docs/project-unite/
// architecture.md §4 «Права», «Открытые вкладки», «Отзыв прав»; UP-009). The voice's paid scenario is after the pilot
// (X40, P12c adds it here).
//
// - «Включить Fansly»: the install asks for nothing and reaches no Fansly page; one click in the popup grants the
//   pages and webRequest at once, nothing beyond the bundle; the background registers MAIN then ISOLATED.
// - The tabs open before it (FS-IDN-4, UP-009): the background's notice in the old document, the popup's count and
//   «Перезагрузить вкладку»; after an update the same, the notice saying the extension was updated.
// - Revocation and «Выключить Fansly» in the middle of work (FS-PERM-5): a greeting send not yet requested is
//   refused with NO POST and the custody hears «not enqueued»; one whose POST left ends by its own rules and is never
//   repeated; nothing new starts while off; the vault's run stops at its checkpoint — the file in flight lands and is
//   recorded, the next is not handed over — and goes on from there once Fansly is on again.
// - FS-PERM-4: the browser's rights, the switch and the hub's page flags are independent of each other.
// The sends go through the test build's probe (bg/fansly/send-probe.ts) over the module's one send service, as in
// suite-fansly-send; the vault through its panel on `/creator/vault`, as in suite-fansly-vault.

import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { SiteAccessState } from '@cg/contracts/site-access';
import { browser, expect } from '@wdio/globals';

import { WORLD } from '../../src/scenarios/hub/world';
import { setOptionalPermissionPrompts } from '../support/background';
import { installTestBuild, pageRpc, readLocalStorage, waitForReport, writeLocalStorage } from '../support/extension';
import { testBuildPage, useFakeHub } from '../support/fake-hub';
import { openWithNeighbor, setFanslyNeighbor } from '../support/fansly-neighbor';
import { startFanslyShift } from '../support/fansly-shift';
import { FANSLY_STAND_PATTERN, registeredScripts } from '../support/fansly-site';
import { callFansly, fakeFansly, fanslyIds, fanslyStandUrl, waitForFanslyStandIdle, waitForFanslyStandReady } from '../support/fansly-stand';
import { useNetworkTrap } from '../support/network-trap';
import { ours, waitOursByText } from '../support/ours';
import { capturePage } from '../support/pages';
import { grantedState, grantOptional, revokeOptional } from '../support/permissions';

const BUNDLE = { origins: [FANSLY_STAND_PATTERN], permissions: ['webRequest'] };
const NOTICE = 'div[data-host="reload-notice"]';

async function waitFor<T>(what: string, probe: () => Promise<T | undefined | null | false>, timeout = 20_000): Promise<T> {
  let found: T | undefined | null | false;
  await browser.waitUntil(
    async () => {
      found = await probe();
      return found !== undefined && found !== null && found !== false;
    },
    { timeout, interval: 150, timeoutMsg: what },
  );
  return found as T;
}

/** «Включить Fansly» as the core holds it (`site.access`, from the popup or the settings page only). */
async function access(change: { readonly enabled?: boolean; readonly reload?: boolean } = {}): Promise<SiteAccessState> {
  const answer = await pageRpc<SiteAccessState>('site.access', { host: 'fansly-web', ...change });
  if (!answer.ok) throw new Error(answer.error.code);
  return answer.payload;
}

const ourScripts = async (): Promise<string[][]> =>
  (await registeredScripts()).filter((script) => script.id.startsWith('fansly')).map((script) => [script.id, script.world ?? '', script.runAt ?? '']);

const hasNotice = (): Promise<boolean> => browser.execute((selector: string) => document.querySelector(selector) !== null, NOTICE);

/** A button of the popup by its words, once it can be pressed. */
async function popupButton(words: string): Promise<{ click(): Promise<unknown> }> {
  const button = browser.$(`button=${words}`);
  await button.waitForDisplayed({ timeout: 10_000, timeoutMsg: `the popup’s «${words}»` });
  await browser.waitUntil(async () => (await button.getAttribute('aria-busy')) !== 'true', { timeout: 10_000, timeoutMsg: `«${words}» stays busy` });
  return { click: () => button.click() };
}

describe('«Включить Fansly» and the tabs that wait for a reload: FS-PERM-1…3, FS-IDN-4 (R20 P14c)', () => {
  useNetworkTrap();
  let standTab = '';
  let popupTab = '';
  const stand = (): Promise<void> => browser.switchToWindow(standTab);
  const popup = (): Promise<void> => browser.switchToWindow(popupTab);

  before(async () => {
    await fakeFansly().command({ op: 'reset' });
    await setFanslyNeighbor(null);
    await installTestBuild();
    // A Fansly tab open before Fansly is switched on: no script of ours runs there.
    await browser.url(fanslyStandUrl('/messages'));
    await waitForFanslyStandReady();
    standTab = await browser.getWindowHandle();
    await browser.newWindow(testBuildPage('popup.html'));
    popupTab = await browser.getWindowHandle();
    // Firefox's question answered «Allow» with nobody to press it; the click's gesture is still required.
    await setOptionalPermissionPrompts(false);
  });

  after(async () => {
    await setOptionalPermissionPrompts(null);
    await setFanslyNeighbor(null);
    // The next block installs the build again: Firefox closes the extension's pages, so stay on the Fansly tab.
    await stand();
  });

  it('[FS-PERM-1] [FS-PERM-2] [FS-PERM-3] the install and an update ask for nothing and reach no Fansly page; «Включить Fansly» — one click, the pages and webRequest at once; MAIN then ISOLATED registered; nothing beyond the bundle', async () => {
    await popup();
    const manifest = await browser.execute(() => (globalThis as unknown as { browser: { runtime: { getManifest(): Record<string, unknown> } } }).browser.runtime.getManifest());
    const list = (key: string): string[] => (Array.isArray(manifest[key]) ? (manifest[key] as string[]) : []);
    // FS-PERM-2: Fansly's addresses and webRequest are optional only; FS-PERM-3: no right the pilot does not need.
    expect(list('optional_host_permissions')).toContain(FANSLY_STAND_PATTERN);
    expect(list('optional_permissions')).toContain('webRequest');
    expect(list('host_permissions')).not.toContain(FANSLY_STAND_PATTERN);
    for (const right of ['tabs', 'cookies', 'proxy', 'webRequest', 'webRequestBlocking', 'webRequestFilterResponse', 'unlimitedStorage']) expect([right, list('permissions').includes(right)]).toEqual([right, false]);

    // FS-PERM-1: a chatter of ChatSpace only — the install, and an update after it, grant and register nothing of Fansly.
    const none = { enabled: false, granted: false, registered: false, waitingReload: 0 };
    expect(await access()).toMatchObject(none);
    expect((await grantedState(fanslyStandUrl('/'))).reaches).toBe(false);
    // Firefox closes the extension's pages when the add-on is replaced: the update is made from the Fansly tab.
    await stand();
    await installTestBuild();
    await browser.newWindow(testBuildPage('popup.html'));
    popupTab = await browser.getWindowHandle();
    expect(await access()).toMatchObject(none);
    const before = await grantedState(fanslyStandUrl('/'));
    expect([before.reaches, before.permissions.includes('webRequest')]).toEqual([false, false]);
    expect(await ourScripts()).toEqual([]);

    // One click: the browser's one request of the whole bundle, inside the click.
    await (await popupButton('Включить Fansly')).click();
    await waitFor('the background did not register Fansly after the click', async () => (await access()).registered);
    const after = await grantedState(fanslyStandUrl('/'));
    expect([after.reaches, after.permissions.includes('webRequest')]).toEqual([true, true]);
    expect(await ourScripts()).toEqual([['fansly-main', 'MAIN', 'document_start'], ['fansly', 'ISOLATED', 'document_start']]);
    expect(await access()).toMatchObject({ enabled: true, granted: true, registered: true });
    await popupButton('Выключить Fansly');
  });

  it('[FS-IDN-4] [UP-009] a tab open before the grant, then before an update: the notice in the old document, the popup counts it and «Перезагрузить вкладку» brings our scripts in', async () => {
    // The tab of the previous test: open before the grant, so the background noticed it.
    await stand();
    await waitFor('no notice in the tab opened before the grant', () => hasNotice());
    for (const theme of ['bright', 'dark'] as const) {
      await callFansly('setTheme', theme);
      await capturePage(`p14c-notice-grant-${theme}`);
    }
    await popup();
    expect((await access()).waitingReload).toBe(1);
    await capturePage('p14c-popup-waiting');
    await (await popupButton('Перезагрузить вкладку')).click();
    // The popup stays open: the tab's handshake takes it off the count.
    await browser.waitUntil(async () => !(await browser.$('button=Перезагрузить вкладку').isExisting()), { timeout: 15_000, timeoutMsg: 'the count did not clear' });
    await stand();
    await waitForFanslyStandReady();
    await waitForReport((report) => report.rpc?.registered === true, 'our scripts in the reloaded tab');
    expect(await hasNotice()).toBe(false);

    // An update: the registration is restored, the old document gets the notice, saying so.
    await installTestBuild();
    await waitFor('no notice after the update', () => hasNotice(), 15_000);
    for (const theme of ['bright', 'dark'] as const) {
      await callFansly('setTheme', theme);
      await capturePage(`p14c-notice-update-${theme}`);
    }
    await callFansly('setTheme', 'bright');
    // Firefox closes the extension's pages when the add-on is replaced.
    await browser.newWindow(testBuildPage('popup.html'));
    popupTab = await browser.getWindowHandle();
    expect(await access()).toMatchObject({ enabled: true, granted: true, registered: true, waitingReload: 1 });
    await (await popupButton('Перезагрузить вкладку')).click();
    await browser.waitUntil(async () => !(await browser.$('button=Перезагрузить вкладку').isExisting()), { timeout: 15_000, timeoutMsg: 'the count did not clear after the update' });
    await stand();
    await waitForFanslyStandReady();
    await waitForReport((report) => report.rpc?.registered === true, 'our scripts after the update');
    expect(await hasNotice()).toBe(false);
    await popup();
    expect((await access()).waitingReload).toBe(0);
  });
});

// ── the middle of work: the greeting send and the vault (FS-PERM-4, FS-PERM-5) ──

/** bg/fansly/api-probe.ts and bg/fansly/send-probe.ts. */
const API = { call: 'dev.fanslyApi.call', result: 'dev.fanslyApi.result' } as const;
const SEND = { request: 'dev.fanslySend.request', live: 'dev.fanslySend.live', go: 'dev.fanslySend.go', views: 'dev.fanslySend.views', held: 'dev.fanslySend.held', result: 'dev.fanslySend.result' } as const;
const JOURNAL = 'fansly.send.journal';
const PAGE = WORLD.pages.fansly;
const TEXT = 'Привет! Рада видеть тебя здесь';
const HISTORY = '5a1d0000-0000-4000-8000-000000000001';
/** The fake Fansly's first album (src/fake-fansly/data.ts). */
const ALBUM = '807000000000000021';

interface View {
  readonly attemptId: string;
  readonly state: string;
  readonly proof?: string;
  readonly code?: string;
  readonly cause?: string;
}

interface PanelReport {
  readonly shown: boolean;
  readonly mode: string;
  readonly uploader: string;
  readonly items: ReadonlyArray<{ readonly name: string; readonly state: string }> | null;
  readonly run: { readonly state: string; readonly done: number; readonly total: number; readonly stop: { readonly kind: string } | null; readonly code: string | null } | null;
  readonly resume: { readonly kind: string; readonly done: number; readonly total: number } | null;
  readonly controls: { readonly start: string; readonly blocked: string | null };
  readonly mounted: boolean;
}

async function waitForPanel(predicate: (panel: PanelReport) => boolean, message: string, timeout = 15_000): Promise<PanelReport> {
  const report = await waitForReport((now) => {
    const panel = now['vault'] as PanelReport | undefined;
    return panel !== undefined && predicate(panel);
  }, message, timeout);
  return report['vault'] as PanelReport;
}

/** The person's files on this machine, as a file picker gives them. */
function setOnDisk(name: string, files: readonly string[]): string[] {
  const folder = join(tmpdir(), `cg-perms-${name}`);
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(folder, { recursive: true });
  return files.map((file, index) => {
    const path = join(folder, file);
    writeFileSync(path, Buffer.alloc(64 + index, index + 1));
    return path;
  });
}

describe('revocation and «Выключить Fansly» in the middle of work: FS-PERM-4, FS-PERM-5 (R20 P14c)', () => {
  useNetworkTrap();
  const { hub } = useFakeHub();
  let standTab = '';
  let pagesTab = '';
  let creator = '';
  let groups: string[] = [];
  let fans: Record<string, string> = {};
  let seq = 0;
  const pages = (): Promise<void> => browser.switchToWindow(pagesTab);
  const stand = (): Promise<void> => browser.switchToWindow(standTab);
  const fanOf = (index: number): { readonly group: string; readonly fan: string } => {
    const group = groups[index] ?? '';
    return { group, fan: fans[group] ?? '' };
  };

  async function read<T>(key: string): Promise<T | undefined> {
    await pages();
    return (await readLocalStorage([key]))[key] as T | undefined;
  }

  async function click(index: number, attempt: string, hold?: 'custody' | 'written'): Promise<string> {
    seq += 1;
    const id = `p14c-${seq}-${Date.now()}`;
    const { group, fan } = fanOf(index);
    await pages();
    await writeLocalStorage({ [SEND.request]: { id, account: creator, pageId: PAGE.pageId, fanRef: fan, groupId: group, text: TEXT, historyRevision: HISTORY, draftRevision: 1, attempts: [attempt], ...(hold === undefined ? {} : { hold }) } });
    return id;
  }

  async function answered(id: string, timeout = 30_000): Promise<View> {
    const result = await waitFor(`the probe did not answer ${id}`, async () => {
      const found = await read<{ id: string; views?: View[]; error?: string }>(SEND.result);
      return found?.id === id ? found : undefined;
    }, timeout);
    if (result.views?.[0] === undefined) throw new Error(`the probe refused ${id}: ${result.error ?? '?'}`);
    return result.views[0];
  }

  async function heldAt(id: string, stage: string): Promise<void> {
    await waitFor(`the attempt ${id} did not stop at ${stage}`, async () => {
      const held = await read<{ id: string; stage: string }>(SEND.held);
      return held?.id === id && held.stage === stage;
    });
  }

  async function go(id: string): Promise<void> {
    await pages();
    await writeLocalStorage({ [SEND.go]: { id, at: Date.now() } });
  }

  const view = async (attemptId: string): Promise<View | undefined> => (await read<Record<string, View>>(SEND.views))?.[attemptId];

  /** Our `POST /message` since `mark`, as the fake Fansly journaled them. */
  const posts = async (mark: number): Promise<number> => (await fakeFansly().calls('ours', mark)).filter((entry) => entry.route === 'message.send').length;

  /** The hub's custody of the fan, by attempt: `[attemptId, state]`. */
  async function custody(index: number): Promise<Array<[string, string]>> {
    const { fan } = fanOf(index);
    const claim = (await hub().status()).claims.find((entry) => entry.pageLabel === PAGE.pageLabel && entry.fanRef === fan);
    return (claim?.attempts ?? []).map((attempt) => [attempt.attemptId, attempt.state]);
  }

  const custodyIs = (index: number, attemptId: string, state: string): Promise<boolean> =>
    waitFor(`the custody of ${attemptId} is not «${state}»`, async () => (await custody(index)).some(([id, at]) => id === attemptId && at === state));

  /** The rights or the switch took effect: the background's own word. */
  async function settled(wanted: Partial<SiteAccessState>): Promise<SiteAccessState> {
    await pages();
    return waitFor(`the site access is not ${JSON.stringify(wanted)}`, async () => {
      const state = await access();
      return Object.entries(wanted).every(([key, value]) => state[key as keyof SiteAccessState] === value) ? state : undefined;
    }, 15_000);
  }

  /** Fansly on again: the old document reloaded (our scripts in it), the page's session captured, a call of ours goes through. */
  async function backOn(): Promise<void> {
    await settled({ enabled: true, granted: true, registered: true });
    await stand();
    await browser.refresh();
    await waitForFanslyStandReady();
    await waitForReport((report) => report.rpc?.registered === true, 'the Fansly tab registered again');
    await waitForFanslyStandIdle();
    await waitFor('no call of ours went through (no captured session?)', async () => {
      seq += 1;
      const id = `p14c-session-${seq}`;
      await pages();
      await writeLocalStorage({ [API.call]: { id, account: creator, purpose: 'registration', route: 'group.detail', path: { group: groups[0] } } });
      const result = await waitFor(`the API probe did not answer ${id}`, async () => {
        const found = await read<{ id: string; ok?: boolean }>(API.result);
        return found?.id === id ? found : undefined;
      });
      return result.ok === true;
    }, 30_000);
  }

  const fanslyFeatures = async (): Promise<unknown> => {
    await pages();
    const bootstrap = await pageRpc<{ pages: Array<{ pageId: number; features?: unknown }> }>('bootstrap.get', { force: true });
    if (!bootstrap.ok) throw new Error(bootstrap.error.code);
    return bootstrap.payload.pages.find((page) => page.pageId === PAGE.pageId)?.features;
  };

  before(async () => {
    await fakeFansly().command({ op: 'reset' });
    const shift = await startFanslyShift(hub(), { path: '/messages', neighbor: { mode: 'off' } });
    standTab = shift.fanslyTab;
    pagesTab = shift.pagesTab;
    // `site.access` answers the popup and the settings page only.
    await pages();
    await browser.url(testBuildPage('popup.html'));
    await writeLocalStorage({ [SEND.live]: {} });
    await stand();
    await waitForReport((report) => report.rpc?.registered === true, 'the Fansly tab registered');
    await waitForFanslyStandIdle();
    const ids = await fanslyIds();
    creator = ids.creator;
    groups = [...ids.groups];
    fans = { ...ids.fans };
    expect(groups.length).toBeGreaterThanOrEqual(6);
    await pages();
    await waitFor('Fansly’s background module did not start', async () => {
      const diagnostic = await pageRpc<{ hostModules: Array<{ host: string; state: string }> }>('diagnostics.get');
      return diagnostic.ok && diagnostic.payload.hostModules.some((entry) => entry.host === 'fansly-web' && entry.state === 'started');
    });
    await backOn();
  });

  beforeEach(async () => {
    await fakeFansly().command({ op: 'send', echo: 'after', receiptDelayMs: 0, echoDelayMs: 0 });
  });

  after(async () => {
    await setFanslyNeighbor(null);
    await browser.url('about:blank');
    await fakeFansly().command({ op: 'reset' });
  });

  it('[FS-PERM-5] [FS-PERM-4] the rights taken back after the intent, before the request: refused with NO POST, the custody hears «not enqueued»; the switch stays on, the hub’s flags as they were, a new grant needs no click', async () => {
    const flags = await fanslyFeatures();
    const mark = await fakeFansly().mark();
    const attempt = randomUUID();
    const id = await click(0, attempt, 'written');
    await heldAt(id, 'written');
    await revokeOptional(BUNDLE);
    // FS-PERM-4: the browser took its rights; «Включить Fansly» is still on, the scripts are off.
    expect(await settled({ granted: false, registered: false })).toMatchObject({ enabled: true });
    expect(await ourScripts()).toEqual([]);
    await go(id);
    expect(await answered(id)).toMatchObject({ attemptId: attempt, state: 'refused', proof: 'not-enqueued', code: 'CG-FAN-OFF' });
    expect(await posts(mark)).toBe(0);
    await custodyIs(0, attempt, 'failed');
    expect((await read<{ entries: View[] }>(JOURNAL))?.entries.find((entry) => entry.attemptId === attempt)).toMatchObject({ state: 'refused', proof: 'not-enqueued' });
    // The hub's page flags are the hub's: the browser's revoke did not touch them.
    expect(await fanslyFeatures()).toEqual(flags);
    // A new grant (here Firefox's own switch) brings Fansly back with no click of ours: the switch was on.
    await grantOptional(BUNDLE);
    await backOn();
    expect(await posts(mark)).toBe(0);
  });

  it('[FS-PERM-5] [FS-PERM-4] «Выключить Fansly» while the custody answers: refused with NO POST, «not enqueued»; a new click starts nothing — the hub never hears of it; the rights stay granted', async () => {
    const mark = await fakeFansly().mark();
    const attempt = randomUUID();
    const id = await click(1, attempt, 'custody');
    await heldAt(id, 'custody');
    await pages();
    await (await popupButton('Выключить Fansly')).click();
    expect(await settled({ enabled: false, registered: false })).toMatchObject({ granted: true });
    // FS-PERM-4: the person's switch is not the browser's: the rights stay.
    const rights = await grantedState(fanslyStandUrl('/'));
    expect([rights.reaches, rights.permissions.includes('webRequest')]).toEqual([true, true]);
    await go(id);
    expect(await answered(id)).toMatchObject({ attemptId: attempt, state: 'refused', proof: 'not-enqueued', code: 'CG-FAN-OFF' });
    await custodyIs(1, attempt, 'failed');

    // Nothing new while off: refused before the hub hears of it.
    const fresh = randomUUID();
    expect(await answered(await click(2, fresh))).toMatchObject({ attemptId: fresh, state: 'refused', proof: 'before-dispatch', code: 'CG-FAN-OFF' });
    expect((await custody(2)).map(([at]) => at)).not.toContain(fresh);
    expect(await posts(mark)).toBe(0);

    await pages();
    await (await popupButton('Включить Fansly')).click();
    await backOn();
    expect(await posts(mark)).toBe(0);
  });

  it('[FS-PERM-5] the rights taken back after the POST left: it ends by its own rules — sent or uncertain — and is never repeated, also once Fansly is back', async () => {
    await fakeFansly().command({ op: 'send', echo: 'after', receiptDelayMs: 4_000, echoDelayMs: 0 });
    const mark = await fakeFansly().mark();
    const attempt = randomUUID();
    const id = await click(3, attempt);
    await waitFor('the request did not start', async () => (await view(attempt))?.state === 'requestStarted');
    await revokeOptional(BUNDLE);
    await settled({ granted: false, registered: false });
    await answered(id);
    // A receipt still waits for its echo from the tab's socket; nothing else ends it.
    const ended = await waitFor('the attempt did not end', async () => {
      const entry = (await read<{ entries: View[] }>(JOURNAL))?.entries.find((row) => row.attemptId === attempt);
      return entry !== undefined && (entry.state === 'sent' || entry.state === 'uncertain') ? entry : undefined;
    }, 30_000);
    expect(await posts(mark)).toBe(1);
    await browser.pause(5_000);
    expect(await posts(mark)).toBe(1);

    await grantOptional(BUNDLE);
    await backOn();
    // The same fan again: greeted, or held by the uncertain attempt — Fansly is asked nothing.
    const again = await answered(await click(3, randomUUID()));
    expect(again).toMatchObject({ state: 'refused', code: ended.state === 'sent' ? 'CG-SEND-PART' : 'CG-SEND-UNCERTAIN' });
    expect(await posts(mark)).toBe(1);
  });

  for (const how of ['off', 'revoke'] as const) {
    it(`[FS-PERM-5] the vault (${how === 'off' ? '«Выключить Fansly»' : 'the rights taken back'}) in the middle of a run: the file in flight lands and is recorded, the next is not handed over; Start while off hands nothing; on again, the run goes on from its checkpoint`, async () => {
      // Restore access before navigating: a failed predecessor may have left the switch off or the rights revoked.
      await pages();
      if (!(await access()).granted) await grantOptional(BUNDLE);
      if (!(await settled({ granted: true })).enabled) await (await popupButton('Включить Fansly')).click();
      await settled({ enabled: true, granted: true, registered: true });
      const names = [`p14c-${how}-1.jpg`, `p14c-${how}-2.jpg`, `p14c-${how}-3.jpg`];
      const paths = setOnDisk(how, names);
      await fakeFansly().command({ op: 'reset' });
      // The first file's addition answers late: Fansly is switched off while it is in flight.
      await fakeFansly().command({ op: 'api', rules: [{ route: 'vault.addMedia', caller: 'page', times: 1, outcome: { kind: 'delay', ms: 5_000 } }] });

      const openPanel = async (checkpoint: boolean): Promise<void> => {
        await waitForPanel((panel) => panel.shown && panel.mounted, 'the vault’s entry');
        await (await waitOursByText('panel', '[data-cg-vault-entry]', /Загрузка/, 'the vault’s entry button')).click();
        await waitForPanel((panel) => panel.mode === 'open', 'the panel');
        await browser.$('app-media-vault-route .vault-album').waitForExist({ timeout: 10_000, timeoutMsg: 'the stand’s albums' });
        await browser.$('app-media-vault-route .vault-album').click();
        await browser.$('app-media-vault-route .vault-header').waitForExist({ timeout: 5000 });
        await browser.$('app-media-vault-route .close-toggle').click();
        await ours('panel', '.cg-vault__card').moveTo();
        await waitForPanel((panel) => panel.uploader === 'ready', 'the form ready');
        // The assertions follow the list from its first item. The default «first on top» uploads it LAST.
        // Pick the same order after a reload, so the checkpoint names the same upload sequence.
        await (await waitOursByText('panel', '.cg-vault__order button', 'последний файл сверху', 'the upload order')).click();
        if (checkpoint) await waitForPanel((panel) => panel.resume?.kind === 'found', 'the album’s checkpoint, read from the background');
        await ours('panel', 'input[data-cg-vault-input="files"]').addValue(paths.join('\n'));
      };
      const addMedia = async (since: number): Promise<number> => (await fakeFansly().calls('page', since)).filter((entry) => entry.route === 'vault.addMedia').length;
      const kept = async (): Promise<[number, unknown, number] | null> => {
        const key = `fansly.vault.${creator}.${ALBUM}`;
        const row = (await read<Record<string, unknown>>(key)) as { confirmed: number; pending: unknown; files: unknown[] } | undefined;
        return row === undefined ? null : [row.confirmed, row.pending, row.files.length];
      };

      await stand();
      await openWithNeighbor('/creator/vault', { mode: 'off' });
      await waitForFanslyStandIdle();
      await openPanel(false);
      await waitForPanel((panel) => panel.controls.blocked === null, 'the set ready');
      const since = await fakeFansly().mark();
      await (await waitOursByText('panel', '[data-cg-vault-start]:not([aria-disabled="true"])', 'Начать', 'the start button')).click();
      await waitForPanel((panel) => panel.run?.done === 0 && panel.items?.[0]?.state === 'uploading', 'the first file in flight', 10_000);

      if (how === 'off') {
        await pages();
        await (await popupButton('Выключить Fansly')).click();
        await settled({ enabled: false, registered: false });
      } else {
        await revokeOptional(BUNDLE);
        await settled({ granted: false, registered: false });
      }
      await stand();
      const stopped = await waitForPanel((panel) => panel.run?.state === 'stopped', 'the run stopped at its checkpoint', 30_000);
      expect(stopped.run).toMatchObject({ done: 1, total: 3, code: 'CG-VAULT-STOPPED' });
      expect(stopped.items?.map((item) => item.state)).toEqual(['verified', 'pending', 'pending']);
      expect(await addMedia(since)).toBe(1);
      expect(await kept()).toEqual([1, null, 3]);

      // Start again while off: refused at the first handoff, nothing reaches the page.
      await stand();
      await (await waitOursByText('panel', '[data-cg-vault-start]:not([aria-disabled="true"])', 'Продолжить', 'the resume button while off')).click();
      await waitForPanel((panel) => panel.run?.state === 'stopped', 'the run stopped again', 15_000);
      await browser.pause(1_000);
      expect(await addMedia(since)).toBe(1);
      expect(await kept()).toEqual([1, null, 3]);

      // On again: the background's notice in this old document; a reload, and the run goes on from its checkpoint.
      if (how === 'off') {
        await pages();
        await (await popupButton('Включить Fansly')).click();
      } else {
        await grantOptional(BUNDLE);
      }
      await settled({ enabled: true, granted: true, registered: true });
      await stand();
      await waitFor('no notice in the old document once Fansly is on again', () => hasNotice(), 15_000);
      await browser.refresh();
      await waitForFanslyStandReady();
      await waitForReport((report) => report.rpc?.registered === true, 'the vault tab registered again');
      await waitForFanslyStandIdle();
      await openPanel(true);
      const resumed = await waitForPanel((panel) => panel.resume?.kind === 'continue' && panel.controls.blocked === null, 'the same files continue');
      expect(resumed.resume).toEqual({ kind: 'continue', done: 1, total: 3 });
      await (await waitOursByText('panel', '[data-cg-vault-start]:not([aria-disabled="true"])', 'Продолжить', 'the resume button')).click();
      await waitForPanel((panel) => panel.run?.state === 'complete', 'the rest uploaded', 60_000);
      expect(await addMedia(since)).toBe(3);
      expect(await kept()).toBeNull();
    });
  }
});
