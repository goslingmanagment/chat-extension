// @vitest-environment happy-dom
//
// Two tabs, one album (review of P13b; docs/project-unite/architecture.md §7.21; FS-VLT-1, VA-004, VA-005): each tab
// with its own Fansly-like vault page, its own port and the real uploader and panel, over ONE background store of
// checkpoints (core services/hosts/fansly/vault-checkpoints.ts, the store `bg/fansly` answers with), each tab its own
// session. Both tabs know the same paused run; the one that goes on holds the album — the other one hands nothing
// over, says so, and after that tab went it is refused for a step that does not follow the row: no file twice.

import type { VaultCheckpoint } from '@cg/contracts/tab-messages-fansly';
import { createVaultCheckpoints } from '@cg/core/services/hosts/fansly/vault-checkpoints';
import { createVaultPanel, createVaultUploader, type VaultPanel, type VaultPanelStore } from '@cg/host-fansly/isolated/vault';
import { Window as HappyWindow } from 'happy-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { createMemoryKv } from '../../../packages/core/src/services/test-support/memory-kv.ts';
import { createFakeVaultPage, createFakeVaultPort, type FakeVaultPage, type FakeVaultPort } from '../../../packages/host-fansly/src/testing/fake-vault.ts';

const CREATOR = '700000000000000001';
const ALBUM = '700000000000000301';
const UPLOAD = '00000000-0000-4000-8000-000000000710';
const T0 = 1_790_000_000_000;
const NAMES = ['a.jpg', 'b.jpg', 'c.jpg'] as const;

interface Tab {
  readonly id: string;
  readonly win: Window & typeof globalThis;
  readonly page: FakeVaultPage;
  readonly facts: FakeVaultPort;
  readonly panel: VaultPanel;
  readonly files: File[];
  /** Files the page never confirms. */
  readonly silent: Set<string>;
}

let seq = 100;
const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  history.replaceState({}, '', '/');
});

const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('[host:fansly] one album, two tabs: no file is handed over twice (review of P13b)', () => {
  it('[VA-004] [VA-005] both tabs know a paused run; the tab that goes on holds the album, the other one hands nothing over and says so; after that tab went, its copy is refused for a step behind the row and asks about the file in flight', async () => {
    const kv = createMemoryKv();
    const open = new Set<string>(['tab-a', 'tab-b']);
    const background = createVaultCheckpoints({ local: kv.open(), now: () => T0, alive: (session) => open.has(session) });
    const storeOf = (session: string): VaultPanelStore => {
      const ref = (target: { hostAccountId: string; albumId: string }) => ({ hostAccountId: target.hostAccountId, albumId: target.albumId });
      return {
        async look(target) {
          const answer = await background.resume(ref(target), session);
          return { checkpoint: answer.checkpoint, held: answer.held === true };
        },
        load: async (target) => (await background.resume(ref(target), session)).checkpoint,
        save: async (checkpoint) => (await background.checkpoint(checkpoint, session)).recorded,
        clear: async (target, uploadId) => (await background.clear({ ...ref(target), uploadId }, session)).recorded,
      };
    };

    // The paused run: c (uploaded first for «first file on top») is in the album, nothing in flight.
    const paused: VaultCheckpoint = {
      hostAccountId: CREATOR,
      albumId: ALBUM,
      uploadId: UPLOAD,
      files: [...NAMES].reverse().map((name, i) => ({ name, size: 10 + i, lastModified: T0 - 1000 })),
      confirmed: 1,
      pending: null,
      updatedAt: T0 - 1000,
    };
    kv.data.set(`fansly.vault.${CREATOR}.${ALBUM}`, paused);

    const tabOf = (id: string, win: Window & typeof globalThis): Tab => {
      const page = createFakeVaultPage(win.document);
      page.openAlbum('Set 1');
      page.expandUploader();
      page.cards(['c.jpg']);
      const facts = createFakeVaultPort(CREATOR);
      facts.loaded(ALBUM, (seq += 1));
      const uploader = createVaultUploader({ win, port: facts.port });
      const listeners = new Set<() => void>();
      const panel = createVaultPanel({
        uploader,
        store: storeOf(id),
        account: () => ({ username: 'creator', displayName: null }),
        onPage(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        now: () => T0,
      });
      const silent = new Set<string>();
      const album = ['c.jpg'];
      // The page answers a file it took a task later: confirmed, unless it is one it never confirms.
      page.host.querySelector('app-media-upload-input input[type=file]')?.addEventListener('change', () => {
        const taken = page.taken.at(-1);
        if (taken === undefined || silent.has(taken.name)) return;
        win.setTimeout(() => {
          page.uploaded();
          facts.added((seq += 1));
          album.unshift(taken.name);
          page.loading();
          page.cards(album);
          facts.loaded(ALBUM, (seq += 1));
        }, 0);
      });
      // The tab's own File: a page takes files of its own window.
      const files = [...NAMES].map((name) => new win.File(['x'.repeat(10 + [...NAMES].reverse().indexOf(name))], name, { type: 'image/jpeg', lastModified: T0 - 1000 }));
      cleanups.push(() => {
        panel.dispose();
        page.destroy();
      });
      panel.setShown(true);
      panel.dispatch({ type: 'open' });
      return { id, win, page, facts, panel, files, silent };
    };

    history.replaceState({}, '', '/creator/vault');
    const a = tabOf('tab-a', window);
    const second = new HappyWindow({ url: 'http://localhost/creator/vault' });
    cleanups.push(() => second.happyDOM.close());
    const b = tabOf('tab-b', second as unknown as Window & typeof globalThis);
    await settle();

    // Both pick the same files: both continue the same paused run (the same upload).
    for (const tab of [a, b]) tab.panel.dispatch({ type: 'pick', files: tab.files });
    await settle();
    for (const tab of [a, b]) expect(tab.panel.view()).toMatchObject({ resume: { kind: 'continue', done: 1, total: 3 }, controls: { blocked: null, start: 'resume' } });

    // Tab A goes on: b is on disk before its page sees it, and its page never confirms it.
    a.silent.add('b.jpg');
    a.panel.dispatch({ type: 'start' });
    await settle();
    expect(a.page.taken.map((file) => file.name)).toEqual(['b.jpg']);

    // Tab B goes on with its own copy: refused before anything is handed over — the album is tab A's.
    b.panel.dispatch({ type: 'start' });
    await settle();
    expect(b.page.taken).toEqual([]);
    expect(b.panel.view()).toMatchObject({ note: 'held', controls: { blocked: 'held' } });

    // Tab A is closed with b still in flight: the album is free — but not for a copy that is a step behind the row.
    open.delete('tab-a');
    a.panel.dispose();
    b.panel.dispatch({ type: 'refresh' });
    await settle();
    b.panel.dispatch({ type: 'start' });
    await settle();
    expect(b.page.taken).toEqual([]);
    // Its file in flight comes back to tab B as a question; nothing is handed over before the person answers.
    expect(b.panel.view()).toMatchObject({ question: { name: 'b.jpg' }, controls: { blocked: 'answer' } });
    expect(kv.read<VaultCheckpoint>(`fansly.vault.${CREATOR}.${ALBUM}`)).toMatchObject({ confirmed: 1, pending: { index: 1 } });
  });
});
