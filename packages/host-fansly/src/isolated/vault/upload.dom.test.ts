// One file into the vault album (docs/project-unite/architecture.md §7.11; FS-VLT-1, FS-VLT-2; R20 P13a): the
// uploader over a Fansly-like vault page (testing/fake-vault.ts) and the port's vault facts as MAIN says them. The
// page in Firefox, with MAIN and the fake Fansly's requests, is suite-fansly-vault.e2e.ts.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createFakeVaultPage, createFakeVaultPort, type FakeVaultPage, type FakeVaultPort } from '../../testing/fake-vault';
import { isVaultPath, readVaultPage, vaultMediaKey } from './dom';
import { HandoffIndeterminateError, handFile } from './handoff';
import { createVaultUploader, vaultGuard, vaultTargetOf, type VaultTimer, type VaultUploader } from './upload';

const CREATOR = '700000000000000001';
const OTHER_CREATOR = '700000000000000009';
const ALBUM = '700000000000000301';
const OTHER_ALBUM = '700000000000000302';
const target = { hostAccountId: CREATOR, albumId: ALBUM } as const;
const file = (name: string, type = 'image/jpeg'): File => new File(['bytes'], name, { type });

/** Timers the test fires by hand: the only one is a file's time limit. */
function manualTimer(): VaultTimer & { readonly armed: () => number; fire(): void } {
  const callbacks = new Map<number, () => void>();
  let next = 0;
  return {
    set(callback) {
      next += 1;
      callbacks.set(next, callback);
      return next;
    },
    clear(handle) {
      callbacks.delete(handle as number);
    },
    armed: () => callbacks.size,
    fire() {
      for (const callback of [...callbacks.values()]) callback();
    },
  };
}

let page: FakeVaultPage;
let facts: FakeVaultPort;
let timer: ReturnType<typeof manualTimer>;
let uploader: VaultUploader;

beforeEach(() => {
  history.replaceState({}, '', '/creator/vault');
  page = createFakeVaultPage();
  page.openAlbum('Set 1');
  page.expandUploader();
  facts = createFakeVaultPort(CREATOR);
  facts.loaded(ALBUM, 1);
  timer = manualTimer();
  uploader = createVaultUploader({ win: window, port: facts.port, timer });
});
afterEach(() => {
  page.destroy();
  history.replaceState({}, '', '/');
});

/** Lets the promise of a step settle. */
const settled = <T>(promise: Promise<T>): Promise<{ done: boolean; value?: T }> =>
  Promise.race([promise.then((value) => ({ done: true, value })), new Promise<{ done: boolean }>((resolve) => setTimeout(() => resolve({ done: false }), 0))]);

/** The page finishes its upload, adds the media to the album and loads it again with the card. */
function confirm(seq: number, cards: readonly string[]): void {
  page.uploaded();
  facts.added(seq);
  page.cards(cards);
  facts.loaded(ALBUM, seq + 1);
}

describe('[host:fansly] the vault page as the uploader reads it (§7.11)', () => {
  it('[VA-006] [AU-036] the open album by the id the page loaded it with, its title, the uploader, the cards — the route’s view, never the chat’s «From Vault» modal; the account is the page’s own creator', () => {
    page.cards(['IMG_2.jpeg', 'IMG_1.jpeg']);
    page.modal();
    expect(uploader.view()).toEqual({ route: true, hostAccountId: CREATOR, albumId: ALBUM, title: 'Set 1', uploader: 'ready', cards: ['img_2', 'img_1'] });
    expect(vaultTargetOf(uploader.view())).toEqual(target);
    // Fansly rewrites the extension on its cards: the key drops it, the name is NFC and lower-case.
    expect([vaultMediaKey('IMG_1.JPG'), vaultMediaKey(' Café.MOV '), vaultMediaKey('notes.txt')]).toEqual(['img_1', 'café', 'notes.txt']);
    expect([isVaultPath('/creator/vault'), isVaultPath('/creator/vault/'), isVaultPath('/creator/vaults'), isVaultPath('/messages')]).toEqual([true, true, false, false]);
    // Back to the list of albums: no album, whatever the page loaded last.
    page.closeAlbum();
    expect(uploader.view()).toMatchObject({ albumId: null, title: null, uploader: 'missing', cards: [] });
    expect(vaultTargetOf(uploader.view())).toBeNull();
    // A type album («Posts») has no id: no run belongs to it.
    page.openAlbum('Posts');
    page.expandUploader();
    facts.loaded(null, 2);
    expect(uploader.view()).toMatchObject({ albumId: null, title: 'Posts', uploader: 'ready' });
    // No creator from the page yet: no account, never a guess (AU-036).
    facts.loaded(ALBUM, 3);
    facts.creator(null);
    expect(uploader.view().hostAccountId).toBeNull();
    expect(vaultTargetOf(uploader.view())).toBeNull();
    // Off the vault page nothing is read as its album.
    page.destroy();
    expect(readVaultPage(document)).toEqual({ host: null, albumOpen: false, title: null, input: null, busy: false, failed: false, cards: [] });
  });

  it('[VA-006] [AU-036] refuses before anything is handed over: not the vault page, no album, another album or account, the uploader collapsed or busy', async () => {
    const refused = async (setup: () => void, halt: string): Promise<void> => {
      setup();
      expect(await uploader.upload(file('a.jpg'), target), halt).toEqual({ state: 'refused', halt });
    };
    await refused(() => facts.loaded(OTHER_ALBUM, 2), 'album-changed');
    facts.loaded(ALBUM, 3);
    await refused(() => facts.creator(OTHER_CREATOR), 'account-changed');
    facts.creator(CREATOR);
    await refused(() => page.collapseUploader(), 'uploader-missing');
    page.expandUploader();
    await refused(() => page.closeAlbum(), 'album-closed');
    page.openAlbum('Set 1');
    page.expandUploader();
    await refused(() => history.replaceState({}, '', '/creator/vaults'), 'route-left');
    history.replaceState({}, '', '/creator/vault');
    // A file of the page's own in progress: never a second one beside it.
    page.host.querySelector('.media-wrapper')?.prepend(document.createElement('app-account-media-create-template'));
    await refused(() => undefined, 'uploader-busy');
    expect(page.changes).toBe(0);
    expect(vaultGuard(uploader.view(), target)).toBeNull();
  });
});

describe('[host:fansly] one file into the open album (§7.11, FS-VLT-1)', () => {
  it('[VA-006] the page’s own input, one file, one `change`; done after the addition, the reload of THIS album and the file’s card — not before', async () => {
    const step = uploader.upload(file('IMG_7.JPG'), target);
    expect(page.taken.map((taken) => taken.name)).toEqual(['IMG_7.JPG']);
    expect(page.changes).toBe(1);
    // The card alone is not a confirmation: it may be another file’s of the same name before any addition.
    page.cards(['IMG_7.jpeg']);
    expect((await settled(step)).done).toBe(false);
    // The addition alone neither: the album was not loaded again since.
    page.uploaded();
    facts.added(10);
    expect((await settled(step)).done).toBe(false);
    // A load of the album that began before the addition says nothing of it.
    facts.loaded(ALBUM, 9);
    expect((await settled(step)).done).toBe(false);
    // The reload after the addition, and the card in the album: done.
    page.cards(['IMG_7.jpeg', 'IMG_6.jpeg']);
    facts.loaded(ALBUM, 11);
    expect(await step).toEqual({ state: 'done', path: 'data-transfer', top: 'img_7' });
    expect(page.taken).toHaveLength(1);
  });

  it('[VA-006] the card that comes after the reload is seen by the album’s observer: done as it lands', async () => {
    const step = uploader.upload(file('b.mp4', 'video/mp4'), target);
    page.uploaded();
    facts.added(20);
    facts.loaded(ALBUM, 21);
    expect((await settled(step)).done).toBe(false);
    page.cards(['b.mp4']);
    expect(await step).toEqual({ state: 'done', path: 'data-transfer', top: 'b' });
  });

  it('[VA-006] FS-VLT-2: the album, the facts, the route and the account are watched only while a file is in flight', async () => {
    expect(uploader.stats()).toEqual({ watching: false, watches: 0, mutations: 0 });
    expect(facts.listeners()).toBe(0);
    // Idle: the page changes and nothing of ours wakes.
    page.cards(['x.jpg']);
    await settled(Promise.resolve());
    expect(uploader.stats().mutations).toBe(0);
    const step = uploader.upload(file('c.jpg'), target);
    expect(uploader.stats()).toMatchObject({ watching: true, watches: 1 });
    expect(facts.listeners()).toBe(2);
    expect(timer.armed()).toBe(1);
    // In flight: the album's changes are looked at.
    page.uploaded();
    await settled(Promise.resolve());
    expect(uploader.stats().mutations).toBeGreaterThan(0);
    confirm(30, ['c.jpg', 'x.jpg']);
    expect(await step).toMatchObject({ state: 'done' });
    const after = uploader.stats();
    expect(after).toMatchObject({ watching: false, watches: 1 });
    expect(facts.listeners()).toBe(0);
    expect(timer.armed()).toBe(0);
    // Idle again: the album's changes are nobody's business.
    page.cards(['y.jpg', 'c.jpg']);
    await settled(Promise.resolve());
    expect(uploader.stats().mutations).toBe(after.mutations);
    // One file at a time.
    const first = uploader.upload(file('d.jpg'), target);
    expect(await uploader.upload(file('e.jpg'), target)).toEqual({ state: 'refused', halt: 'uploader-busy' });
    confirm(40, ['d.jpg']);
    expect(await first).toMatchObject({ state: 'done' });
  });

  it('[VA-004] what was handed over and not seen confirmed is not known — another album, the route left, another creator, the time limit, a stop — and is never handed again', async () => {
    const cases: Array<[string, (stop: AbortController) => void]> = [
      ['album-changed', () => facts.loaded(OTHER_ALBUM, 50)],
      ['route-left', () => facts.navigate('/messages')],
      ['account-changed', () => facts.creator(OTHER_CREATOR)],
      ['timeout', () => timer.fire()],
      ['stopped', (stop) => stop.abort()],
    ];
    for (const [halt, cause] of cases) {
      history.replaceState({}, '', '/creator/vault');
      facts.creator(CREATOR);
      facts.loaded(ALBUM, 49);
      page.uploaded();
      const stop = new AbortController();
      const before = page.taken.length;
      const step = uploader.upload(file(`${halt}.jpg`), target, stop.signal);
      // The page added it — to which album, and whether it stays, the uploader cannot say.
      facts.added(48);
      cause(stop);
      expect(await step, halt).toEqual({ state: 'unknown', halt, path: 'data-transfer' });
      expect(page.taken.length - before, halt).toBe(1);
      expect(uploader.stats().watching).toBe(false);
    }
    expect(facts.listeners()).toBe(0);
  });

  it('[VA-004] the page that shows no sign of the file did not take it — not known, not «nothing happened»; Fansly’s own failure is a failure: nothing landed', async () => {
    page.ignore = true;
    expect(await uploader.upload(file('notes.txt', 'text/plain'), target)).toEqual({ state: 'unknown', halt: 'not-taken', path: 'data-transfer' });
    page.ignore = false;
    const step = uploader.upload(file('f.jpg'), target);
    page.failUpload();
    expect(await step).toEqual({ state: 'failed', path: 'data-transfer' });
  });

  it('[VA-004] a dispatch that threw may have reached the page: not known', async () => {
    const input = page.host.querySelector<HTMLInputElement>('app-media-upload-input input[type=file]');
    if (input === null) throw new Error('no input');
    const original = input.dispatchEvent.bind(input);
    input.dispatchEvent = (event: Event): boolean => {
      original(event);
      throw new Error('dispatch failed');
    };
    expect(await uploader.upload(file('g.jpg'), target)).toEqual({ state: 'unknown', halt: 'handoff-indeterminate', path: null });
    expect(facts.listeners()).toBe(0);
  });
});

describe('[host:fansly] a file into the page’s own input (§7.10, §7.11)', () => {
  it('[VA-004] the isolated world’s DataTransfer first; refused by the input — the page’s own copy on the one input it names, or nothing; a gone input takes nothing', () => {
    const input = page.host.querySelector<HTMLInputElement>('app-media-upload-input input[type=file]');
    if (input === null) throw new Error('no input');
    const selector = 'app-media-vault-route > app-media-vault app-media-upload-input input[type=file]';
    expect(handFile(window, input, file('h.jpg'), selector)).toBe('data-transfer');
    expect(page.taken.map((taken) => taken.name)).toEqual(['h.jpg']);
    // Xray refuses the isolated world's FileList on the page's input (`refuse` times); the page's own one it takes.
    let refuse = Infinity;
    let files: FileList | null = null;
    Object.defineProperty(input, 'files', {
      configurable: true,
      get: () => files,
      set(value: FileList) {
        if (refuse > 0) {
          refuse -= 1;
          throw new Error('Permission denied');
        }
        files = value;
      },
    });
    // No page world to copy into (not Firefox): nothing was handed over.
    expect(handFile(window, input, file('i.jpg'), selector)).toBe('unavailable');
    expect(page.changes).toBe(1);
    const pageWorld = window as Window & { wrappedJSObject?: unknown };
    const global = globalThis as { cloneInto?: unknown };
    const copies: unknown[] = [];
    pageWorld.wrappedJSObject = window;
    global.cloneInto = <T>(value: T): T => (copies.push(value), value);
    try {
      // A selector that names no input, or two: the page's path declines rather than guess.
      const extra = document.body.appendChild(Object.assign(document.createElement('input'), { type: 'text' }));
      expect(handFile(window, input, file('j.jpg'), 'app-media-upload-input input.nowhere')).toBe('unavailable');
      expect(handFile(window, input, file('j.jpg'), 'input')).toBe('unavailable');
      extra.remove();
      // The page's own DataTransfer with a copy made for the page, its own `change`: the page takes it.
      refuse = 1;
      expect(handFile(window, input, file('k.jpg'), selector)).toBe('clone-into');
      expect(page.taken.map((taken) => taken.name)).toEqual(['h.jpg', 'k.jpg']);
      // The file, and the event's init: both made for the page.
      expect(copies).toHaveLength(2);
    } finally {
      delete pageWorld.wrappedJSObject;
      delete global.cloneInto;
    }
    const gone = document.createElement('input');
    gone.type = 'file';
    expect(handFile(window, gone, file('l.jpg'), selector)).toBe('unavailable');
    expect(new HandoffIndeterminateError()).toBeInstanceOf(Error);
  });
});
