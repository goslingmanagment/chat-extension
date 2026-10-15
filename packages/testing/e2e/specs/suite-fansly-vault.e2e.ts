// The vault on the Fansly stand in Firefox (FS-VLT-*; docs/project-unite/architecture.md §7.11). P13a — the uploader
// in the isolated world: Fansly's own start over the test build's MAIN (support/fansly-tap.ts, consumer `port`) and,
// over its port, the vault's uploader as the panel will run it — files into the album open on the stand's
// `/creator/vault`, the page's own input and upload, each confirmed by MAIN's `fx.vaultAdded` (the page's
// `POST /vault/albums/media` to the fake Fansly), the reload of that album (`fx.vaultLoaded`, its address) and the
// file's card; checkpoints before every handoff; next to the FBuddy-like neighbour `off` and `after` (its hook on
// every XHR of the page). A file the page does not take is not known, never handed again. The panel and its entry on
// `/creator/vault` are P13b's, which completes this suite. No extension is installed; nothing of ours asks Fansly
// anything (the fake's journal by caller).

import { browser, expect } from '@wdio/globals';

import { openWithNeighbor, setFanslyNeighbor } from '../support/fansly-neighbor';
import { fakeFansly, fanslyIds, waitForFanslyStandIdle } from '../support/fansly-stand';
import { installFanslyTapHarness, tap, waitForFanslyTap, waitForTap, type FanslyTapHarness } from '../support/fansly-tap';
import { useNetworkTrap } from '../support/network-trap';

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

  before(async () => {
    await setFanslyNeighbor(null);
    await fakeFansly().command({ op: 'reset' });
    await browser.setWindowSize(1440, 900);
    harness = await installFanslyTapHarness({ main: 'start', consumer: 'port' });
  });

  after(async () => {
    await harness?.remove();
    // Every request was the page's own: nothing of ours asked the fake Fansly anything.
    expect(await fakeFansly().calls('ours', 0)).toEqual([]);
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
