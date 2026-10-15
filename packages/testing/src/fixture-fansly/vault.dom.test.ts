// The stand's `/creator/vault` over the fake Fansly (R20 P13a): the page's own upload, as the vault uploader meets it
// on Fansly — albums from the server, an open album loaded by its id, «Upload to Vault» with the page's file input,
// the file taken in the same task, uploaded, added to the open album 1 s later by one `POST /vault/albums/media`, and
// the album loaded again with the file's card. The uploader itself over MAIN in Firefox: suite-fansly-vault.e2e.ts.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { pendingRequests } from '../../fixture-fansly/src/http';
import { startFakeFansly, type FakeFansly } from '../fake-fansly';
import { mountServerStand, until, type MountedStand } from './harness';

const ALBUM = '807000000000000021';
const OTHER_ALBUM = '807000000000000022';

let fake: FakeFansly;
let stand: MountedStand | null = null;
let since = 0;

beforeAll(async () => {
  fake = await startFakeFansly({ pageOrigin: location.origin });
});
afterAll(async () => {
  await fake.close();
});
beforeEach(() => {
  fake.command({ op: 'reset' });
  since = fake.journal.next;
});
afterEach(async () => {
  stand?.unmount();
  stand = null;
  await until(() => pendingRequests() === 0, 'the page’s requests to end');
});

const server = () => ({ apiOrigin: fake.apiOrigin, socketUrl: fake.socketUrl, token: fake.token });
/** The page's calls of the vault and its uploads (its marks of delivery go on beside them). */
const calls = (): string[] =>
  fake.journal
    .calls('page', since)
    .filter((entry) => entry.route?.startsWith('vault.') === true || entry.route === 'media.create')
    .map((entry) => `${entry.method} ${entry.route ?? entry.path}`);
const vault = (): HTMLElement | null => document.querySelector('app-media-vault-route > app-media-vault');
const input = (): HTMLInputElement | null => document.querySelector('app-media-vault-route app-media-upload-input input[type=file]');
const cards = (): string[] => [...document.querySelectorAll('app-media-vault-route .vault-row .image-filename')].map((card) => card.textContent?.trim() ?? '');
const busy = (): boolean => document.querySelector('app-media-upload-input .proccessing-templates, app-media-upload-input app-account-media-create-template') !== null;

function hand(file: File): void {
  const target = input();
  if (target === null) throw new Error('no upload input');
  const transfer = new DataTransfer();
  transfer.items.add(file);
  target.files = transfer.files;
  target.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('the Fansly stand’s vault over the fake Fansly (R20 P13a)', () => {
  it('[host:fansly] the albums, an album opened and loaded by its id, «Upload to Vault» with the page’s own input', async () => {
    stand = await mountServerStand(server(), '/creator/vault');
    await until(() => document.querySelectorAll('.vault-album').length === 2, 'the albums');
    expect([...document.querySelectorAll('.vault-album .semi-bold')].map((title) => title.textContent?.trim())).toEqual(['Stand album', 'Stand album 2']);
    expect(document.querySelector('.vault-header')).toBeNull();
    (document.querySelectorAll<HTMLElement>('.vault-album')[0] as HTMLElement).click();
    expect(document.querySelector('.vault-header .font-size-xl')?.textContent?.trim()).toBe('Stand album');
    expect(input()).toBeNull();
    document.querySelector<HTMLElement>('.close-toggle')?.click();
    expect(input()?.getAttribute('accept')).toContain('image/jpeg');
    await until(() => calls().includes('GET vault.albumMedia'), 'the album’s media');
    expect(fake.journal.calls('page', since).find((entry) => entry.route === 'vault.albumMedia')?.path).toContain(`albumId=${ALBUM}`);
    // Back to the list: no request; another album: its own load.
    document.querySelector<HTMLElement>('[data-menu-item="vault-album-back"]')?.click();
    expect(vault()?.querySelector('.vault-albums-container')).not.toBeNull();
    (document.querySelectorAll<HTMLElement>('.vault-album')[1] as HTMLElement).click();
    await until(() => fake.journal.calls('page', since).some((entry) => entry.route === 'vault.albumMedia' && entry.path?.includes(OTHER_ALBUM) === true), 'the other album’s media');
  });

  it('[host:fansly] a file on `change`: taken in the same task, uploaded, added to the open album 1 s later, the album loaded again with its card', async () => {
    stand = await mountServerStand(server(), '/creator/vault');
    await until(() => document.querySelectorAll('.vault-album').length === 2, 'the albums');
    (document.querySelectorAll<HTMLElement>('.vault-album')[0] as HTMLElement).click();
    document.querySelector<HTMLElement>('.close-toggle')?.click();
    await until(() => pendingRequests() === 0, 'the album loaded');
    const before = calls().length;
    hand(new File(['jpeg'], 'IMG_0001.JPG', { type: 'image/jpeg' }));
    // The page's processing line comes with the `change` itself.
    expect(busy()).toBe(true);
    await until(() => cards().includes('IMG_0001.JPG'), 'the card', 5000);
    expect(busy()).toBe(false);
    expect(calls().slice(before)).toEqual(['POST media.create', 'POST vault.addMedia', 'GET vault.albumMedia']);
    expect(fake.state.world.albums[0]?.mediaIds).toHaveLength(1);
    // A type the page does not accept: nothing taken, nothing asked.
    const after = calls().length;
    hand(new File(['text'], 'notes.txt', { type: 'text/plain' }));
    expect(busy()).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls().length).toBe(after);
    // The newest first.
    hand(new File(['jpeg'], 'IMG_0002.jpeg', { type: 'image/jpeg' }));
    await until(() => cards().length === 2, 'the second card', 5000);
    expect(cards()).toEqual(['IMG_0002.jpeg', 'IMG_0001.JPG']);
  });
});
