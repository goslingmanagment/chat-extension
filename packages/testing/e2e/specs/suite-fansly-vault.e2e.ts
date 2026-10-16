// The vault on the Fansly stand in Firefox (FS-VLT-*; docs/project-unite/architecture.md §7.11). P13a — the uploader
// in the isolated world: Fansly's own start over the test build's MAIN (support/fansly-tap.ts, consumer `port`) and,
// over its port, the vault's uploader as the panel will run it — files into the album open on the stand's
// `/creator/vault`, the page's own input and upload, each confirmed by MAIN's `fx.vaultAdded` (the page's
// `POST /vault/albums/media` to the fake Fansly), the reload of that album (`fx.vaultLoaded`, its address) and the
// file's card; checkpoints before every handoff; next to the FBuddy-like neighbour `off` and `after` (its hook on
// every XHR of the page). A file the page does not take is not known, never handed again. No extension is installed
// there; nothing of ours asks Fansly anything (the fake's journal by caller).
//
// P13b — the extension's test build on the stand, signed in to the fake hub with the Fansly page's `vault` on: the
// entry only on `/creator/vault` and one click to the panel (VA-001), the set in its order (VA-002), the uploads one
// by one through the page's own form (VA-003), next to the neighbour `off` and `after`, the panel in both Fansly
// themes (screenshots `.cache/e2e/suite-fansly-vault-*.png`); a paused set continues after the background's sleep
// and a reload of the tab from the checkpoint the background keeps (VA-005, FS-PERM-5).

import { browser, expect } from '@wdio/globals';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { WORLD } from '../../src/scenarios/hub/world';
import { fanslyPageFlags } from '../../src/fake-hub/config';
import { E2E_EVIDENCE_DIR } from '../../src/stand/paths';
import { suspendBackground } from '../support/background';
import { installTestBuild, pageRpc, readLocalStorage, readReport, waitForReport } from '../support/extension';
import { QUIET_PAGE, fakeHubOrigin, pointTestBuildAtFakeHub, testBuildPage, useFakeHub } from '../support/fake-hub';
import { openWithNeighbor, setFanslyNeighbor } from '../support/fansly-neighbor';
import { switchFanslyOnForTheStand } from '../support/fansly-site';
import { callFansly, fakeFansly, fanslyIds, fanslyStandServer, waitForFanslyStandIdle, waitForFanslyStandReady } from '../support/fansly-stand';
import { installFanslyTapHarness, tap, waitForFanslyTap, waitForTap, type FanslyTapHarness } from '../support/fansly-tap';
import { useNetworkTrap } from '../support/network-trap';
import { ours, oursExists, waitOursByText } from '../support/ours';
import { SHIFT_PASSWORD } from '../support/shift';

/** The fake Fansly's first album (src/fake-fansly/data.ts). */
const ALBUM = '807000000000000021';
const ALBUM_TITLE = 'Stand album';
const OTHER_ALBUM = '807000000000000022';
const OTHER_ALBUM_TITLE = 'Stand album 2';

interface VaultView {
  readonly route: boolean;
  readonly hostAccountId: string | null;
  readonly albumId: string | null;
  readonly title: string | null;
  readonly loading: boolean;
  readonly uploader: 'ready' | 'busy' | 'missing';
  readonly cards: readonly string[];
}
interface VaultState {
  readonly run: {
    readonly state: string;
    readonly items: ReadonlyArray<{ readonly name: string; readonly status: string }>;
    readonly confirmed: number;
    readonly stop: { readonly kind: string } | null;
    readonly code: string | null;
  } | null;
  readonly checkpoints: ReadonlyArray<readonly [number, number | null]>;
  readonly clears: number;
  readonly stats: { readonly watching: boolean; readonly watches: number; readonly mutations: number };
  readonly album: { readonly albumId: string | null; readonly seq: number } | null;
}

const view = (): Promise<VaultView> => tap<VaultView>('vaultView');
const state = (): Promise<VaultState> => tap<VaultState>('vaultState');
const cards = (): Promise<string[]> =>
  browser.execute(() => [...document.querySelectorAll('app-media-vault-route .vault-row .image-filename')].map((card) => card.textContent?.trim() ?? ''));

/** Opens the stand's first album and «Upload to Vault», as a person does, and waits until the uploader can take a file. */
async function openAlbum(): Promise<VaultView> {
  await browser.$('app-media-vault-route .vault-album').waitForExist({ timeout: 10_000, timeoutMsg: 'the stand’s albums' });
  await browser.$('app-media-vault-route .vault-album').click();
  await browser.$('app-media-vault-route .vault-header').waitForExist({ timeout: 5000 });
  await browser.$('app-media-vault-route .close-toggle').click();
  return waitForTap(view, (v) => v.albumId === ALBUM && v.uploader === 'ready', 'the open album as the uploader reads it');
}

describe('the vault uploader on the Fansly stand: files into the open album, confirmed, with checkpoints (R20 P13a)', () => {
  useNetworkTrap();
  let harness: FanslyTapHarness | null = null;
  // reset preserves the journal, including intentional API calls of earlier spec files.
  let apiJournalStart = 0;

  before(async () => {
    await setFanslyNeighbor(null);
    await fakeFansly().command({ op: 'reset' });
    apiJournalStart = await fakeFansly().mark();
    await browser.setWindowSize(1440, 900);
    harness = await installFanslyTapHarness({ main: 'start', consumer: 'port' });
  });

  after(async () => {
    await harness?.remove();
    // Every request was the page's own: nothing of ours asked the fake Fansly anything.
    expect(await fakeFansly().calls('ours', apiJournalStart)).toEqual([]);
    await setFanslyNeighbor(null);
    await browser.url('about:blank');
    await fakeFansly().command({ op: 'reset' });
  });

  for (const mode of ['off', 'after'] as const) {
    it(`[VA-004] [VA-005] [VA-006] [AU-036] next to the neighbour (${mode}): the account and the album by the page’s own word; two files, each written to the checkpoint before the page sees it and confirmed by the addition, the album’s reload and its card; a file the page does not take is not known and not handed again`, async () => {
      await fakeFansly().command({ op: 'reset' });
      const since = await fakeFansly().mark();
      await openWithNeighbor('/creator/vault', { mode });
      await waitForFanslyTap();
      await waitForFanslyStandIdle();
      const ids = await fanslyIds();

      // AU-036: the account is the creator of the page's own /account/me; the album, the id the page loaded it by.
      const opened = await openAlbum();
      expect(opened).toEqual({ route: true, hostAccountId: ids.creator, albumId: ALBUM, title: ALBUM_TITLE, loading: false, uploader: 'ready', cards: [] });
      expect((await state()).album).toMatchObject({ albumId: ALBUM });
      // FS-VLT-2: nothing watched before a file is in flight.
      expect((await state()).stats).toEqual({ watching: false, watches: 0, mutations: 0 });

      const names = [`p13a-${mode}-1.jpg`, `p13a-${mode}-2.JPG`];
      expect(await tap('vaultStart', names)).toEqual({ started: true, target: { hostAccountId: ids.creator, albumId: ALBUM, title: ALBUM_TITLE } });
      const done = await waitForTap(state, (s) => s.run?.state === 'complete' || s.run?.state === 'stopped', 'the run’s end', 30_000);
      expect(done.run).toMatchObject({ state: 'complete', confirmed: 2, stop: null, code: null });
      expect(done.run?.items.map((item) => item.status)).toEqual(['verified', 'verified']);
      // VA-005: on disk before the page saw each file; at the end, cleared.
      expect(done.checkpoints).toEqual([
        [0, 0],
        [1, null],
        [1, 1],
        [2, null],
      ]);
      expect(done.clears).toBe(1);
      expect(done.stats).toMatchObject({ watching: false, watches: 2 });
      // The page's album shows both, the newest first.
      expect(await cards()).toEqual([names[1], names[0]]);
      // The page's own requests did it: one addition per file to this album, each followed by a reload of it.
      const calls = (await fakeFansly().calls('page', since)).filter((entry) => entry.route === 'vault.addMedia' || entry.route === 'vault.albumMedia').map((entry) => entry.route);
      expect(calls).toEqual(['vault.albumMedia', 'vault.addMedia', 'vault.albumMedia', 'vault.addMedia', 'vault.albumMedia']);

      // VA-004: a type the page does not accept — handed over, nothing of it on the page: not known, never again.
      const before = await fakeFansly().mark();
      expect(await tap('vaultStart', [`p13a-${mode}-notes.txt`], 'text/plain')).toMatchObject({ started: true });
      const unknown = await waitForTap(state, (s) => s.run?.state === 'stopped', 'the run stopped', 10_000);
      expect(unknown.run).toMatchObject({ stop: { kind: 'not-taken' }, code: 'CG-VAULT-UNCERTAIN', confirmed: 0 });
      expect(unknown.run?.items.map((item) => item.status)).toEqual(['uncertain']);
      expect(unknown.checkpoints).toEqual([[0, 0]]);
      expect(await tap('vaultResolve', 'missing')).toBe(true);
      expect((await state()).checkpoints.at(-1)).toEqual([0, null]);
      expect((await fakeFansly().calls('page', before)).filter((entry) => entry.route === 'media.create' || entry.route === 'vault.addMedia')).toEqual([]);
      expect((await state()).stats.watching).toBe(false);

      // Another album: the uploader takes it for the album shown only once that album's own load is in (review P13a).
      // The back bubble is an icon only (no icon font on the stand): its click, as the page's handler takes it.
      await browser.execute(() => document.querySelector<HTMLElement>('app-media-vault-route [data-menu-item="vault-album-back"]')?.click());
      await browser.$('app-media-vault-route .vault-albums > .vault-album:nth-child(2)').click();
      const other = await waitForTap(view, (v) => v.albumId === OTHER_ALBUM, 'the other album bound to its own load');
      expect(other).toMatchObject({ title: OTHER_ALBUM_TITLE, loading: false });
    });
  }
});

// ── P13b: the panel of the extension's test build, its entry on `/creator/vault` and the background's checkpoints ──

interface PanelReport {
  readonly shown: boolean;
  readonly mode: 'closed' | 'open' | 'minimized';
  readonly account: string | null;
  readonly album: { readonly state: string; readonly title: string | null };
  readonly uploader: string;
  readonly items: ReadonlyArray<{ readonly name: string; readonly state: string }> | null;
  readonly run: { readonly state: string; readonly done: number; readonly total: number; readonly stop: { readonly kind: string } | null; readonly code: string | null; readonly report: { readonly uploaded: number; readonly present: number; readonly previous: number } | null } | null;
  readonly question: { readonly name: string } | null;
  readonly resume: { readonly kind: string; readonly done: number; readonly total: number } | null;
  readonly controls: { readonly start: string; readonly blocked: string | null };
  readonly mounted: boolean;
}

const panelOf = async (): Promise<PanelReport | null> => ((await readReport())?.['vault'] as PanelReport | undefined) ?? null;
async function waitForPanel(predicate: (panel: PanelReport) => boolean, message: string, timeout = 15_000): Promise<PanelReport> {
  const report = await waitForReport((now) => {
    const panel = now['vault'] as PanelReport | undefined;
    return panel !== undefined && predicate(panel);
  }, message, timeout);
  return report['vault'] as PanelReport;
}

/** The person's files on this machine, as a file picker gives them: a set of small images (the stand takes any image). */
function setOnDisk(name: string, files: readonly string[]): string[] {
  const folder = join(tmpdir(), `cg-vault-${name}`);
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(folder, { recursive: true });
  return files.map((file, index) => {
    const path = join(folder, file);
    writeFileSync(path, Buffer.alloc(64 + index, index + 1));
    return path;
  });
}

/** Picks `paths` with the panel's own «Выбрать файлы» input (inside our closed root), as the browser's picker would. */
async function pick(paths: readonly string[]): Promise<void> {
  await ours('panel', 'input[data-cg-vault-input="files"]').addValue(paths.join('\n'));
}

async function shootVault(name: string): Promise<string> {
  mkdirSync(E2E_EVIDENCE_DIR, { recursive: true });
  await browser.execute(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await browser.pause(200);
  const path = `${E2E_EVIDENCE_DIR}suite-fansly-vault-${name}.png`;
  await browser.saveScreenshot(path);
  return path;
}

const checkpointKey = (creator: string): string => `fansly.vault.${creator}.${ALBUM}`;

describe('the vault panel on the Fansly stand: one click to it on `/creator/vault`, the set, the uploads one by one, checkpoints in the background (R20 P13b)', () => {
  useNetworkTrap();
  const { hub } = useFakeHub();
  let standTab = '';
  let pagesTab = '';
  let creator = '';
  let journalStart = 0;
  let apiJournalStart = 0;
  const pages = (): Promise<void> => browser.switchToWindow(pagesTab);
  const stand = (): Promise<void> => browser.switchToWindow(standTab);

  before(async () => {
    await setFanslyNeighbor(null);
    await fakeFansly().command({ op: 'reset' });
    apiJournalStart = await fakeFansly().mark();
    journalStart = await fanslyStandServer.mark();
    // The owner switched the vault on for the Fansly page (its own row: `"*"` never reaches it).
    await hub().command({ op: 'config', patch: fanslyPageFlags({ vault: true }) });
    await installTestBuild();
    await pointTestBuildAtFakeHub();
    await browser.waitUntil(
      async () => {
        const state = await pageRpc<{ settings: { hub: { baseUrl: string } } }>('settings.get');
        return state.ok && state.payload.settings.hub.baseUrl === fakeHubOrigin();
      },
      { timeout: 15_000, timeoutMsg: 'the settings owner did not pick the hub address up' },
    );
    // The password is taken only from the settings page (the sender rule of `session.signIn`).
    await browser.url(testBuildPage('options.html'));
    const signedIn = await pageRpc('session.signIn', { login: WORLD.user.username, password: SHIFT_PASSWORD });
    if (!signedIn.ok) throw new Error(`sign-in: ${signedIn.error.code}`);
    await switchFanslyOnForTheStand();
    await browser.url(testBuildPage(QUIET_PAGE));
    pagesTab = await browser.getWindowHandle();
    standTab = (await browser.createWindow('tab')).handle;
    await stand();
    await browser.setWindowSize(1440, 900);
  });

  after(async () => {
    // Nothing of the extension asked the Fansly stand for anything: the page's own requests did every upload.
    expect((await fanslyStandServer.journal(journalStart)).filter((entry) => entry.origin !== 'asset')).toEqual([]);
    expect(await fakeFansly().calls('ours', apiJournalStart)).toEqual([]);
    await setFanslyNeighbor(null);
    await browser.url('about:blank');
    await fakeFansly().command({ op: 'reset' });
  });

  for (const mode of ['off', 'after'] as const) {
    it(`[VA-001] [VA-002] [VA-003] [FS-VLT-1] next to the neighbour (${mode}): the entry only on the vault, one click opens the panel; the set in its order, uploaded one by one through the page’s own form, each confirmed, the album as the person wanted; both Fansly themes`, async () => {
      await fakeFansly().command({ op: 'reset' });
      await stand();
      // A chat is no place of the vault's: no entry, nothing of it loaded.
      await openWithNeighbor('/messages', { mode });
      const [group] = (await fanslyIds()).groups as [string];
      await openWithNeighbor(`/messages/${group}`, { mode });
      await waitForReport((report) => report.rpc?.registered === true, 'the chat tab registered');
      await browser.pause(300);
      expect((await panelOf())?.shown ?? false).toBe(false);
      expect(await oursExists('panel', '[data-cg-vault-entry]')).toBe(false);

      await openWithNeighbor('/creator/vault', { mode });
      await waitForFanslyStandIdle();
      creator = (await fanslyIds()).creator;
      // VA-001: the entry stands closed at the corner; one click and the panel is there.
      await waitForPanel((panel) => panel.shown && panel.mode === 'closed' && panel.mounted, 'the vault’s entry on /creator/vault');
      for (const theme of ['dark', 'bright'] as const) {
        await callFansly('setTheme', theme);
        await browser.pause(100);
        await shootVault(`${mode}-${theme}-entry`);
      }
      await ours('panel', '[data-cg-vault-entry]').click();
      const opened = await waitForPanel((panel) => panel.mode === 'open', 'the panel after one click');
      // AU-036: the creator of the page's own /account/me, named as the hub page bound to it.
      expect(opened).toMatchObject({ account: WORLD.pages.fansly.title, album: { state: 'none' }, controls: { blocked: 'files' } });

      // The person opens an album and «Upload to Vault»; the panel reads the page when the pointer comes back.
      await browser.$('app-media-vault-route .vault-album').click();
      await browser.$('app-media-vault-route .vault-header').waitForExist({ timeout: 5000 });
      await browser.$('app-media-vault-route .close-toggle').click();
      await ours('panel', '.cg-vault__card').moveTo();
      await waitForPanel((panel) => panel.album.state === 'open' && panel.uploader === 'ready', 'the open album and its form in the panel');

      // VA-002: a folder's set in its natural order — the album shows the first file on top.
      const names = [`p13b-${mode}-2.jpg`, `p13b-${mode}-10.jpg`, `p13b-${mode}-1.jpg`];
      await pick(setOnDisk(mode, names));
      const planned = await waitForPanel((panel) => (panel.items?.length ?? 0) === 3 && panel.controls.blocked === null, 'the set in the panel');
      expect(planned.items?.map((item) => item.name)).toEqual([`p13b-${mode}-1.jpg`, `p13b-${mode}-2.jpg`, `p13b-${mode}-10.jpg`]);
      for (const theme of ['bright', 'dark'] as const) {
        await callFansly('setTheme', theme);
        await browser.pause(100);
        await shootVault(`${mode}-${theme}-set`);
      }
      await callFansly('setTheme', 'bright');

      // VA-003: Start — one file at a time through the page's form, each confirmed before the next.
      const since = await fakeFansly().mark();
      await ours('panel', '[data-cg-vault-start]').click();
      const done = await waitForPanel((panel) => panel.run?.state === 'complete' || panel.run?.state === 'stopped', 'the run’s end', 60_000);
      expect(done.run).toMatchObject({ state: 'complete', done: 3, total: 3, stop: null, code: null, report: { uploaded: 3, present: 0, previous: 0 } });
      expect(done.items?.map((item) => item.state)).toEqual(['verified', 'verified', 'verified']);
      expect(await cards()).toEqual([`p13b-${mode}-1.jpg`, `p13b-${mode}-2.jpg`, `p13b-${mode}-10.jpg`]);
      const calls = (await fakeFansly().calls('page', since)).filter((entry) => entry.route === 'vault.addMedia').map((entry) => entry.route);
      expect(calls).toEqual(['vault.addMedia', 'vault.addMedia', 'vault.addMedia']);
      for (const theme of ['dark', 'bright'] as const) {
        await callFansly('setTheme', theme);
        await browser.pause(100);
        await shootVault(`${mode}-${theme}-done`);
      }
      // Its checkpoint is gone from the background.
      await pages();
      expect(await readLocalStorage([checkpointKey(creator)])).toEqual({});
      await stand();
    });
  }

  it('[VA-005] [FS-VLT-1] [FS-PERM-5] a paused set survives the background’s sleep and a reload of the tab: the same files continue from the checkpoint, the done ones are not uploaded again', async () => {
    await fakeFansly().command({ op: 'reset' });
    await stand();
    await openWithNeighbor('/creator/vault', { mode: 'off' });
    await waitForFanslyStandIdle();
    creator = (await fanslyIds()).creator;
    await waitForPanel((panel) => panel.shown && panel.mounted, 'the vault’s entry');
    // The controller's report can precede Preact's render; wait for the actual controls in the closed root.
    await (await waitOursByText('panel', '[data-cg-vault-entry]', /Загрузка/, 'the vault’s entry button')).click();
    await waitForPanel((panel) => panel.mode === 'open', 'the panel');
    await browser.$('app-media-vault-route .vault-album').waitForExist({ timeout: 10_000, timeoutMsg: 'the stand’s albums' });
    await browser.$('app-media-vault-route .vault-album').click();
    await browser.$('app-media-vault-route .vault-header').waitForExist({ timeout: 5000 });
    await browser.$('app-media-vault-route .close-toggle').click();
    await ours('panel', '.cg-vault__card').moveTo();
    await waitForPanel((panel) => panel.uploader === 'ready', 'the form ready');
    const paths = setOnDisk('resume', ['r-1.jpg', 'r-2.jpg', 'r-3.jpg']);
    await pick(paths);
    await waitForPanel((panel) => panel.controls.blocked === null, 'the set ready');
    await (await waitOursByText('panel', '[data-cg-vault-start]:not([aria-disabled="true"])', 'Начать', 'the start button')).click();
    // «Пауза после текущего»: the file in flight goes, then nothing.
    await (await waitOursByText('panel', 'button', 'Пауза после текущего', 'the pause')).click();
    const paused = await waitForPanel((panel) => panel.run?.state === 'paused', 'the run paused', 30_000);
    expect(paused.run?.done).toBe(1);
    await pages();
    const kept = (await readLocalStorage([checkpointKey(creator)]))[checkpointKey(creator)] as { confirmed: number; pending: unknown; files: unknown[] };
    expect([kept.confirmed, kept.pending, kept.files.length]).toEqual([1, null, 3]);

    // The event page sleeps; the tab is reloaded: a new document, a new background.
    expect(await suspendBackground()).toBe('stopped');
    await stand();
    await browser.refresh();
    await waitForFanslyStandReady();
    await waitForPanel((panel) => panel.shown && panel.mounted, 'the vault’s entry after the reload');
    await (await waitOursByText('panel', '[data-cg-vault-entry]', /Загрузка/, 'the vault’s entry button after the reload')).click();
    await waitForPanel((panel) => panel.mode === 'open', 'the panel after the reload');
    await browser.$('app-media-vault-route .vault-album').waitForExist({ timeout: 10_000, timeoutMsg: 'the stand’s albums after the reload' });
    await browser.$('app-media-vault-route .vault-album').click();
    await browser.$('app-media-vault-route .vault-header').waitForExist({ timeout: 5000 });
    await browser.$('app-media-vault-route .close-toggle').click();
    await ours('panel', '.cg-vault__card').moveTo();
    await waitForPanel((panel) => panel.resume?.kind === 'found', 'the checkpoint of the album, read from the new background');
    await pick(paths);
    const resumed = await waitForPanel((panel) => panel.resume?.kind === 'continue' && panel.controls.blocked === null, 'the same files continue');
    expect([resumed.resume, resumed.controls.start]).toEqual([{ kind: 'continue', done: 1, total: 3 }, 'resume']);
    await shootVault('resume-bright');
    const since = await fakeFansly().mark();
    await (await waitOursByText('panel', '[data-cg-vault-start]:not([aria-disabled="true"])', 'Продолжить', 'the resume button')).click();
    const done = await waitForPanel((panel) => panel.run?.state === 'complete', 'the rest uploaded', 60_000);
    expect(done.run?.report).toEqual({ uploaded: 2, present: 0, previous: 1 });
    // Only the two not done went to the page.
    expect((await fakeFansly().calls('page', since)).filter((entry) => entry.route === 'vault.addMedia')).toHaveLength(2);
    expect(await cards()).toEqual(['r-1.jpg', 'r-2.jpg', 'r-3.jpg']);
  });
});
