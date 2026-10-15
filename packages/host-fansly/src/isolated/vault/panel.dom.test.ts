// The vault panel's controller (docs/project-unite/architecture.md §7.21; FS-VLT-1, FS-VLT-2; R20 P13b) over the
// uploader and the run of P13a, on a Fansly-like vault page (testing/fake-vault.ts) that confirms each file as the
// test scripts it, with the background's checkpoints in memory — every write checked by the contract's schema. What
// the person sees is the model (`VaultPanelVM`); the browser test of the panel itself is `suite-fansly-vault`.

import { VaultCheckpointSchema, vaultCheckpointFollows, type VaultCheckpoint } from '@cg/contracts/tab-messages-fansly';
import { VAULT_STOP_KINDS, type VaultPanelVM } from '@cg/contracts/vault-fansly';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createFakeVaultPage, createFakeVaultPort, type FakeVaultPage, type FakeVaultPort } from '../../testing/fake-vault';
import { createVaultPanel, type VaultPanel, type VaultPanelStore } from './panel';
import { VAULT_CHECKPOINT_TTL_MS } from './run';
import { VAULT_HALTS, createVaultUploader, type VaultTarget, type VaultUploader } from './upload';

const CREATOR = '700000000000000001';
const ALBUM = '700000000000000301';
const OTHER_ALBUM = '700000000000000302';
const target: VaultTarget = { hostAccountId: CREATOR, albumId: ALBUM };
const T0 = 1_790_000_000_000;
const ID = '00000000-0000-4000-8000-000000000410';
const OLD_ID = '00000000-0000-4000-8000-000000000411';
const file = (name: string, folder = 'Set 1', size = 1000): File => {
  const made = new File(['x'.repeat(size)], name, { type: 'image/jpeg', lastModified: T0 - 60_000 });
  Object.defineProperty(made, 'webkitRelativePath', { value: `${folder}/${name}` });
  return made;
};
const refs = (files: readonly File[]) => files.map((f) => ({ name: f.name, size: f.size, lastModified: f.lastModified }));

/** The background's checkpoints as `fansly.vault.*` keeps them: a write of the same upload kept only when it follows the row. */
function memoryStore() {
  const rows = new Map<string, VaultCheckpoint>();
  const loads: string[] = [];
  const clears: string[] = [];
  let failLoads = 0;
  let refusals = 0;
  /** Another tab holds the album (the background's lease). */
  let held = false;
  /** Reads wait for `release` (a slow background). */
  let gate: Promise<void> | null = null;
  let release = (): void => undefined;
  const key = (t: VaultTarget): string => `${t.hostAccountId}:${t.albumId}`;
  const look = async (t: VaultTarget): Promise<{ checkpoint: VaultCheckpoint | null; held: boolean }> => {
    loads.push(key(t));
    if (gate !== null) await gate;
    if (failLoads > 0) {
      failLoads -= 1;
      throw new Error('CG-RUNTIME-UNREACHABLE');
    }
    return { checkpoint: rows.get(key(t)) ?? null, held };
  };
  const store: VaultPanelStore = {
    look,
    load: async (t) => (await look(t)).checkpoint,
    save(checkpoint) {
      const parsed = VaultCheckpointSchema.safeParse(checkpoint);
      if (!parsed.success) throw new Error(`a checkpoint the contract refuses: ${parsed.error.message}`);
      const row = rows.get(key(checkpoint));
      if (held || (row !== undefined && row.uploadId === checkpoint.uploadId && !vaultCheckpointFollows(row, checkpoint))) return Promise.resolve(false);
      if (refusals > 0) {
        refusals -= 1;
        return Promise.resolve(false);
      }
      rows.set(key(checkpoint), checkpoint);
      return Promise.resolve(true);
    },
    clear(t, uploadId) {
      clears.push(uploadId);
      if (held) return Promise.resolve(false);
      if (rows.get(key(t))?.uploadId === uploadId) rows.delete(key(t));
      return Promise.resolve(true);
    },
  };
  return {
    store,
    rows,
    loads,
    clears,
    row: (): VaultCheckpoint | undefined => rows.get(key(target)),
    failLoad: (): void => {
      failLoads = 1;
    },
    refuse: (): void => {
      refusals = 1;
    },
    hold: (value: boolean): void => {
      held = value;
    },
    holdReads(): void {
      gate = new Promise<void>((resolve) => {
        release = () => {
          gate = null;
          resolve();
        };
      });
    },
    releaseReads: (): void => release(),
  };
}

type Fate = 'ok' | 'silent';
let page: FakeVaultPage;
let facts: FakeVaultPort;
let uploader: VaultUploader;
let memory: ReturnType<typeof memoryStore>;
let panel: VaultPanel;
let fates: Record<string, Fate>;
let album: string[];
let seqNow = 100;
const pageListeners = new Set<() => void>();

/** The page answers the file it took, a task later: confirmed, or never. */
function drive(): void {
  const input = page.host.querySelector<HTMLInputElement>('app-media-upload-input input[type=file]');
  input?.addEventListener('change', () => {
    const taken = page.taken.at(-1);
    if (taken === undefined || fates[taken.name] === 'silent') return;
    setTimeout(() => {
      page.uploaded();
      facts.added((seqNow += 1));
      album.unshift(taken.name);
      page.loading();
      page.cards(album);
      facts.loaded(ALBUM, (seqNow += 1));
    }, 0);
  });
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};
const view = (): VaultPanelVM => panel.view();
const states = (): string[] => view().selection?.items.map((item) => item.state) ?? [];
/** The person moved back to the panel: the page is read again. */
const touch = (): void => panel.dispatch({ type: 'refresh' });

beforeEach(() => {
  history.replaceState({}, '', '/creator/vault');
  page = createFakeVaultPage();
  page.openAlbum('Set 1');
  page.expandUploader();
  page.cards([]);
  facts = createFakeVaultPort(CREATOR);
  facts.loaded(ALBUM, 1);
  uploader = createVaultUploader({ win: window, port: facts.port });
  memory = memoryStore();
  fates = {};
  album = [];
  drive();
  panel = createVaultPanel({
    uploader,
    store: memory.store,
    account: () => ({ username: 'stand_creator', displayName: 'Stand' }),
    onPage(listener) {
      pageListeners.add(listener);
      return () => pageListeners.delete(listener);
    },
    now: () => T0,
    newId: () => ID,
  });
  panel.setShown(true);
});
afterEach(() => {
  panel.dispose();
  page.destroy();
  pageListeners.clear();
  history.replaceState({}, '', '/');
});

describe('[host:fansly] the vault panel’s controller (R20 P13b)', () => {
  it('the stop kinds the panel says are the run’s and the page’s, all of them', () => {
    expect([...VAULT_STOP_KINDS]).toEqual([...VAULT_HALTS, 'order-mismatch', 'checkpoint-write-failed', 'internal-error']);
  });

  it('[VA-001] [AU-036] the entry stands closed; opened, the panel names the creator, the album and the form, and reads the album’s checkpoint once', async () => {
    expect(view()).toMatchObject({ shown: true, mode: 'closed', selection: null, run: null });
    expect(memory.loads).toEqual([]);
    panel.dispatch({ type: 'open' });
    await settle();
    expect(view()).toMatchObject({ mode: 'open', account: '@stand_creator', album: { state: 'open', title: 'Set 1' }, uploader: 'ready', resume: null, controls: { blocked: 'files', start: 'start' } });
    expect(memory.loads).toEqual([`${CREATOR}:${ALBUM}`]);
    // «Upload to Vault» collapsed, the album closed: said at the person's next look, nothing read again.
    page.collapseUploader();
    touch();
    expect(view().uploader).toBe('missing');
    page.closeAlbum();
    touch();
    expect(view().album).toEqual({ state: 'none', title: null });
    expect(memory.loads).toHaveLength(1);
    panel.setShown(false);
    expect(view().shown).toBe(false);
  });

  it('[VA-002] [VA-003] a folder: the set in natural order, the order of the album chosen; Start hands the files one by one — the last first for «first on top» — and the album reads as the person wanted', async () => {
    panel.dispatch({ type: 'open' });
    await settle();
    panel.dispatch({ type: 'pick', files: [file('2.jpg'), file('10.jpg'), file('1.jpg'), file('notes.txt')] });
    expect(view().selection).toMatchObject({ folder: 'Set 1', items: [{ name: '1.jpg' }, { name: '2.jpg' }, { name: '10.jpg' }], warnings: [{ kind: 'unsupported-ignored', count: 1 }], problems: [] });
    expect(view().controls).toMatchObject({ blocked: null, start: 'start', pick: true });
    panel.dispatch({ type: 'start' });
    await settle();
    expect(view().run).toMatchObject({ state: 'complete', done: 3, total: 3, stop: null, code: null, album: 'Set 1', report: { uploaded: 3, present: 0, previous: 0 } });
    expect(page.taken.map((taken) => taken.name)).toEqual(['10.jpg', '2.jpg', '1.jpg']);
    expect(album).toEqual(['1.jpg', '2.jpg', '10.jpg']);
    expect(states()).toEqual(['verified', 'verified', 'verified']);
    // Done: its checkpoint is gone, and the same set is not offered again.
    expect(memory.row()).toBeUndefined();
    expect(view().controls).toMatchObject({ blocked: 'done', reset: false });
    // «last on top»: the same set in its own order of uploads.
    panel.dispatch({ type: 'order', order: 'last-on-top' });
    // What the finished run left is read again first.
    expect(view()).toMatchObject({ order: 'last-on-top', run: null, controls: { blocked: 'checking' } });
    await settle();
    expect(view().controls.blocked).toBeNull();
  });

  it('[VA-003] a problem of the set, a page that cannot take a file: Start is not offered and says why; the facts are read again when the person comes back', async () => {
    panel.dispatch({ type: 'open' });
    await settle();
    panel.dispatch({ type: 'pick', files: [file('cover.jpg'), file('cover.mp4')] });
    expect(view().controls.blocked).toBe('problems');
    panel.dispatch({ type: 'pick', files: [file('a.jpg')] });
    expect(view().controls.blocked).toBeNull();
    page.collapseUploader();
    touch();
    expect(view().controls.blocked).toBe('uploader');
    panel.dispatch({ type: 'start' });
    await settle();
    expect(page.taken).toEqual([]);
    page.expandUploader();
    drive();
    touch();
    expect(view().controls.blocked).toBeNull();
    // Another creator on the page (AU-036): no target, nothing starts.
    facts.creator(null);
    for (const listener of pageListeners) listener();
    expect(view()).toMatchObject({ account: null, controls: { blocked: 'account' } });
  });

  it('[VA-004] [VA-005] a reload in the middle: the same files continue from the checkpoint, the uncertain file asks first — «Есть» counts it, written before anything else', async () => {
    const files = [file('a.jpg'), file('b.jpg'), file('c.jpg')];
    // first on top: the uploads go c, b, a. A run stopped after c with b in flight and never confirmed.
    memory.rows.set(`${CREATOR}:${ALBUM}`, { hostAccountId: CREATOR, albumId: ALBUM, uploadId: OLD_ID, files: refs([...files].reverse()), confirmed: 1, pending: { index: 1, passedAt: T0 - 1000 }, updatedAt: T0 - 1000 });
    album = ['c.jpg', 'b.jpg'];
    page.cards(album);
    facts.loaded(ALBUM, (seqNow += 1));
    panel.dispatch({ type: 'open' });
    await settle();
    expect(view().resume).toEqual({ kind: 'found', done: 1, total: 3 });
    panel.dispatch({ type: 'pick', files });
    expect(view()).toMatchObject({ resume: { kind: 'continue', done: 1, total: 3 }, question: { name: 'b.jpg' }, controls: { start: 'resume', blocked: 'answer', reset: true } });
    expect(states()).toEqual(['pending', 'uncertain', 'previous']);
    // Nothing is handed over while the question stands.
    panel.dispatch({ type: 'start' });
    await settle();
    expect(page.taken).toEqual([]);
    // An answer that is not written changes nothing.
    memory.refuse();
    panel.dispatch({ type: 'answer', answer: 'present' });
    await settle();
    expect(view()).toMatchObject({ question: { name: 'b.jpg' }, note: 'save-failed' });
    panel.dispatch({ type: 'answer', answer: 'present' });
    await settle();
    expect(view()).toMatchObject({ question: null, note: null, controls: { blocked: null, start: 'resume' } });
    expect(memory.row()).toMatchObject({ uploadId: OLD_ID, confirmed: 2, pending: null });
    panel.dispatch({ type: 'start' });
    await settle();
    // Only the file never handed over goes; the run keeps the checkpoint's id.
    expect(page.taken.map((taken) => taken.name)).toEqual(['a.jpg']);
    expect(view().run).toMatchObject({ state: 'complete', done: 3, report: { uploaded: 1, present: 0, previous: 2 } });
    expect(memory.clears).toEqual([OLD_ID]);
  });

  it('[VA-005] a checkpoint of other files: Start waits; «Сбросить прошлый запуск» asks once more and clears exactly that run; a forgotten one is not offered', async () => {
    memory.rows.set(`${CREATOR}:${ALBUM}`, { hostAccountId: CREATOR, albumId: ALBUM, uploadId: OLD_ID, files: refs([file('x.jpg')]), confirmed: 0, pending: null, updatedAt: T0 - 1000 });
    panel.dispatch({ type: 'open' });
    await settle();
    panel.dispatch({ type: 'pick', files: [file('a.jpg')] });
    expect(view()).toMatchObject({ resume: { kind: 'other', done: 0, total: 1 }, controls: { blocked: 'other', reset: true } });
    panel.dispatch({ type: 'reset' });
    expect(view().resetArmed).toBe(true);
    panel.dispatch({ type: 'reset-cancel' });
    expect([view().resetArmed, memory.clears]).toEqual([false, []]);
    panel.dispatch({ type: 'reset' });
    panel.dispatch({ type: 'reset' });
    await settle();
    expect(memory.clears).toEqual([OLD_ID]);
    expect(view()).toMatchObject({ resume: null, controls: { blocked: null } });
    // 14 days and more: forgotten — not offered; the Start clears it and runs.
    memory.rows.set(`${CREATOR}:${OTHER_ALBUM}`, { hostAccountId: CREATOR, albumId: OTHER_ALBUM, uploadId: OLD_ID, files: refs([file('x.jpg')]), confirmed: 0, pending: null, updatedAt: T0 - VAULT_CHECKPOINT_TTL_MS - 1 });
    page.openAlbum('Set 2');
    page.expandUploader();
    drive();
    page.cards([]);
    facts.loaded(OTHER_ALBUM, (seqNow += 1));
    for (const listener of pageListeners) listener();
    await settle();
    expect(view()).toMatchObject({ album: { state: 'open', title: 'Set 2' }, resume: null });
  });

  it('[VA-005] a checkpoint that could not be read: nothing starts over it, the person is told; the next read clears the note', async () => {
    memory.failLoad();
    panel.dispatch({ type: 'open' });
    await settle();
    expect([view().note, view().controls.blocked]).toEqual(['read-failed', 'files']);
    // Picking files reads the album's checkpoint again: this time it comes, and the note goes.
    panel.dispatch({ type: 'pick', files: [file('a.jpg')] });
    expect(view().controls.blocked).toBe('checking');
    await settle();
    expect([view().note, view().controls.blocked]).toEqual([null, null]);
    // Start reads it once more (a forgotten one is cleared there): a read that fails starts nothing.
    memory.failLoad();
    panel.dispatch({ type: 'start' });
    await settle();
    expect([page.taken.length, view().note, view().run]).toEqual([0, 'read-failed', null]);
    panel.dispatch({ type: 'start' });
    await settle();
    expect(view()).toMatchObject({ note: null, run: { state: 'complete' } });
  });

  it('[VA-006] a run in flight cannot be closed or re-picked; a pause stops after the file and offers «Продолжить»', async () => {
    fates = { 'b.jpg': 'silent' };
    panel.dispatch({ type: 'open' });
    await settle();
    panel.dispatch({ type: 'pick', files: [file('a.jpg'), file('b.jpg'), file('c.jpg')] });
    panel.dispatch({ type: 'start' });
    await settle();
    // c, then b — never confirmed by the page.
    expect(page.taken.map((taken) => taken.name)).toEqual(['c.jpg', 'b.jpg']);
    expect(view()).toMatchObject({ run: { state: 'running', current: 'b.jpg', done: 1 }, controls: { close: false, pick: false, pause: true, blocked: 'running' } });
    panel.dispatch({ type: 'close' });
    panel.dispatch({ type: 'minimize' });
    panel.dispatch({ type: 'pick', files: [file('z.jpg')] });
    expect(view()).toMatchObject({ mode: 'open', selection: { items: [{ name: 'a.jpg' }, { name: 'b.jpg' }, { name: 'c.jpg' }] } });
    expect(panel.running()).toBe(true);
    panel.dispatch({ type: 'pause' });
    expect(view().run?.state).toBe('pausing');
    // The person leaves the vault: the file in flight is not known, the checkpoint keeps it (FS-PERM-5).
    facts.navigate('/messages');
    await settle();
    expect(view()).toMatchObject({ run: { state: 'stopped', stop: { kind: 'route-left' }, code: 'CG-VAULT-UNCERTAIN' }, question: { name: 'b.jpg' }, controls: { close: true, start: 'resume' } });
    expect(memory.row()).toMatchObject({ confirmed: 1, pending: { index: 1 } });
  });

  it('[VA-005] other files after a stopped run: its checkpoint is read again and said — Start waits for those files or a reset', async () => {
    fates = { 'b.jpg': 'silent' };
    panel.dispatch({ type: 'open' });
    await settle();
    panel.dispatch({ type: 'pick', files: [file('a.jpg'), file('b.jpg')] });
    panel.dispatch({ type: 'start' });
    await settle();
    // b in flight, never confirmed: the person stops by going away and back.
    page.collapseUploader();
    page.expandUploader();
    drive();
    touch();
    await settle();
    expect(memory.row()).toMatchObject({ confirmed: 0, pending: { index: 0 } });
    panel.dispatch({ type: 'pick', files: [file('z.jpg')] });
    // Still in flight: the set is kept.
    expect(view().selection?.items.map((item) => item.name)).toEqual(['a.jpg', 'b.jpg']);
    facts.navigate('/creator/vault');
    facts.loaded(ALBUM, (seqNow += 1));
    for (const listener of pageListeners) listener();
    await settle();
    expect(view().run).toMatchObject({ state: 'stopped', code: 'CG-VAULT-UNCERTAIN' });
    panel.dispatch({ type: 'pick', files: [file('z.jpg')] });
    await settle();
    expect(view()).toMatchObject({ run: null, resume: { kind: 'other', done: 0, total: 2 }, controls: { blocked: 'other', reset: true } });
  });

  it('[VA-003] the owner switching the vault off cancels a Start still waiting for its checkpoint: nothing is handed over (review of P13b)', async () => {
    panel.dispatch({ type: 'open' });
    await settle();
    panel.dispatch({ type: 'pick', files: [file('a.jpg'), file('b.jpg')] });
    await settle();
    memory.holdReads();
    panel.dispatch({ type: 'start' });
    await settle();
    expect(view().controls.blocked).toBe('checking');
    panel.setShown(false);
    memory.releaseReads();
    await settle();
    expect([page.taken.length, view().run, view().shown]).toEqual([0, null, false]);
    // Hidden, a Start does nothing at all; shown again, it runs.
    panel.dispatch({ type: 'start' });
    await settle();
    expect(page.taken).toEqual([]);
    panel.setShown(true);
    panel.dispatch({ type: 'start' });
    await settle();
    expect(view().run).toMatchObject({ state: 'complete', done: 2 });
  });

  it('[VA-006] switched off while a file is in flight: that file is seen to its end, the next one is never handed over (review of P13b)', async () => {
    fates = { 'b.jpg': 'silent' };
    panel.dispatch({ type: 'open' });
    await settle();
    panel.dispatch({ type: 'pick', files: [file('a.jpg'), file('b.jpg'), file('c.jpg')] });
    panel.dispatch({ type: 'start' });
    await settle();
    expect(page.taken.map((taken) => taken.name)).toEqual(['c.jpg', 'b.jpg']);
    panel.setShown(false);
    expect(view().run?.state).toBe('pausing');
    // b is confirmed after all: the run pauses there, a is not handed over.
    page.uploaded();
    facts.added((seqNow += 1));
    album.unshift('b.jpg');
    page.loading();
    page.cards(album);
    facts.loaded(ALBUM, (seqNow += 1));
    await settle();
    expect(view().run).toMatchObject({ state: 'paused', done: 2 });
    expect(page.taken.map((taken) => taken.name)).toEqual(['c.jpg', 'b.jpg']);
  });

  it('[VA-005] another tab holds the album: the panel says so and hands nothing over; when that tab lets go, Start comes back (review of P13b)', async () => {
    memory.hold(true);
    panel.dispatch({ type: 'open' });
    await settle();
    panel.dispatch({ type: 'pick', files: [file('a.jpg')] });
    await settle();
    expect(view()).toMatchObject({ note: 'held', controls: { blocked: 'held', reset: false } });
    panel.dispatch({ type: 'start' });
    await settle();
    expect(page.taken).toEqual([]);
    memory.hold(false);
    touch();
    await settle();
    expect(view()).toMatchObject({ note: null, controls: { blocked: null } });
  });

  it('[VA-004] [VA-005] another tab took the run further: this copy’s write is refused before its file, the row is read again — its file in flight asks its question here (review of P13b)', async () => {
    const files = [file('a.jpg'), file('b.jpg'), file('c.jpg')];
    const paused = { hostAccountId: CREATOR, albumId: ALBUM, uploadId: OLD_ID, files: refs([...files].reverse()), confirmed: 1, pending: null, updatedAt: T0 - 1000 };
    memory.rows.set(`${CREATOR}:${ALBUM}`, paused);
    album = ['c.jpg'];
    page.cards(album);
    facts.loaded(ALBUM, (seqNow += 1));
    panel.dispatch({ type: 'open' });
    await settle();
    panel.dispatch({ type: 'pick', files });
    expect(view()).toMatchObject({ resume: { kind: 'continue', done: 1, total: 3 }, controls: { blocked: null, start: 'resume' } });
    // Meanwhile another tab continued the same run: b is in flight there.
    memory.rows.set(`${CREATOR}:${ALBUM}`, { ...paused, pending: { index: 1, passedAt: T0 } });
    panel.dispatch({ type: 'start' });
    await settle();
    expect(page.taken).toEqual([]);
    expect(view()).toMatchObject({ note: 'moved', question: { name: 'b.jpg' }, controls: { blocked: 'answer' } });
  });
});
