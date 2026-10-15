// A run of the vault uploader (docs/project-unite/architecture.md §7.11; FS-VLT-1; R20 P13a): the person's files one
// at a time into the open album with its checkpoint, over a Fansly-like vault page (testing/fake-vault.ts) that
// answers each file as the test scripts it — confirmed, given up by Fansly, or never seen confirmed. Every checkpoint
// the run writes is checked by the contract's schema (`fansly.vault.checkpoint`).

import { FANSLY_TAB_LIMITS, VaultCheckpointSchema, type VaultCheckpoint } from '@cg/contracts/tab-messages-fansly';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createFakeVaultPage, createFakeVaultPort, type FakeVaultPage, type FakeVaultPort } from '../../testing/fake-vault';
import { VAULT_CHECKPOINT_TTL_MS, VAULT_FILES_MAX, createVaultRun, findVaultCheckpoint, vaultDuplicateKeys, vaultStopCode, type VaultCheckpointStore, type VaultRunSnapshot } from './run';
import { createVaultUploader, vaultTargetOf, type VaultTarget, type VaultTimer, type VaultUploader } from './upload';

const CREATOR = '700000000000000001';
const OTHER_CREATOR = '700000000000000009';
const ALBUM = '700000000000000301';
const OTHER_ALBUM = '700000000000000302';
const target: VaultTarget = { hostAccountId: CREATOR, albumId: ALBUM };
const T0 = 1_790_000_000_000;
const UPLOAD_ID = '00000000-0000-4000-8000-000000000310';
const file = (name: string, size = 1000): File => new File(['x'.repeat(size)], name, { type: 'image/jpeg', lastModified: T0 - 60_000 });
const refs = (files: readonly File[]) => files.map((f) => ({ name: f.name, size: f.size, lastModified: f.lastModified }));

/** The background's checkpoints, as `fansly.vault.*` would keep them; every write checked by the contract. */
function memoryStore() {
  const rows = new Map<string, VaultCheckpoint>();
  const saves: VaultCheckpoint[] = [];
  const clears: string[] = [];
  const loads: VaultTarget[] = [];
  let refusals = 0;
  const key = (t: VaultTarget): string => `${t.hostAccountId}:${t.albumId}`;
  const store: VaultCheckpointStore = {
    load: (t) => {
      loads.push(t);
      return Promise.resolve(rows.get(key(t)) ?? null);
    },
    save(checkpoint) {
      const parsed = VaultCheckpointSchema.safeParse(checkpoint);
      if (!parsed.success) throw new Error(`a checkpoint the contract refuses: ${parsed.error.message}`);
      if (refusals > 0) {
        refusals -= 1;
        return Promise.resolve(false);
      }
      rows.set(key(checkpoint), checkpoint);
      saves.push(checkpoint);
      return Promise.resolve(true);
    },
    clear(t, uploadId) {
      clears.push(uploadId);
      rows.delete(key(t));
      return Promise.resolve(true);
    },
  };
  return {
    store,
    rows,
    saves,
    clears,
    loads,
    row: (): VaultCheckpoint | undefined => rows.get(key(target)),
    refuse: (n = 1): void => {
      refusals = n;
    },
  };
}

function manualTimer(): VaultTimer & { fire(): void } {
  const callbacks = new Map<number, () => void>();
  let next = 0;
  return {
    set(callback) {
      next += 1;
      callbacks.set(next, callback);
      return next;
    },
    clear: (handle) => void callbacks.delete(handle as number),
    fire() {
      for (const callback of [...callbacks.values()]) callback();
    },
  };
}

/** What the page does with each file it takes, by name: confirms it (the default), gives it up, or never confirms it. */
type Fate = 'ok' | 'fail' | 'silent' | 'below';

let page: FakeVaultPage;
let facts: FakeVaultPort;
let timer: ReturnType<typeof manualTimer>;
let uploader: VaultUploader;
let fates: Record<string, Fate>;
/** The album's cards, newest first. */
let album: string[];
/** The checkpoint's pending file at each moment the page took a file. */
let pendingAtHandoff: Array<number | null | undefined>;
let memory: ReturnType<typeof memoryStore>;

/** MAIN's observation numbers: one order for the whole page, as MAIN's. */
let seqNow = 100;
const nextSeq = (): number => (seqNow += 1);

/** The page answers the file it just took, a task later, as its fate says. */
function drive(): void {
  const input = page.host.querySelector<HTMLInputElement>('app-media-upload-input input[type=file]');
  input?.addEventListener('change', () => {
    pendingAtHandoff.push(memory.row()?.pending?.index ?? null);
    const taken = page.taken.at(-1);
    if (taken === undefined) return;
    const fate = fates[taken.name] ?? 'ok';
    setTimeout(() => {
      if (fate === 'fail') return page.failUpload();
      if (fate === 'silent') return;
      page.uploaded();
      facts.added(nextSeq());
      if (fate === 'below') album.push(taken.name);
      else album.unshift(taken.name);
      page.loading();
      page.cards(album);
      facts.loaded(ALBUM, nextSeq());
    }, 0);
  });
}

beforeEach(() => {
  history.replaceState({}, '', '/creator/vault');
  page = createFakeVaultPage();
  page.openAlbum('Set 1');
  page.expandUploader();
  page.cards([]);
  facts = createFakeVaultPort(CREATOR);
  facts.loaded(ALBUM, 1);
  timer = manualTimer();
  uploader = createVaultUploader({ win: window, port: facts.port, timer });
  fates = {};
  album = [];
  pendingAtHandoff = [];
  memory = memoryStore();
  drive();
});
afterEach(() => {
  page.destroy();
  history.replaceState({}, '', '/');
});

const runOf = (files: readonly File[], checkpoint: VaultCheckpoint | null = null, onChange?: (snapshot: VaultRunSnapshot) => void) =>
  createVaultRun({ target, files, checkpoint }, { uploader, store: memory.store, now: () => T0, newId: () => UPLOAD_ID }, onChange);
/** Lets the page's answers and the run's writes run. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};
const names = (): string[] => page.taken.map((taken) => taken.name);
const statuses = (run: { snapshot(): VaultRunSnapshot }): string[] => run.snapshot().items.map((item) => item.status);

describe('[host:fansly] the vault run’s checkpoint (FS-VLT-1)', () => {
  it('[VA-005] [AU-036] per account and album, written before each file is handed over: the files by name, size and time, confirmed from the start, the file in flight; cleared at the end', async () => {
    const files = [file('a.jpg'), file('b.jpg', 2000), file('c.jpg', 3000)];
    const run = runOf(files);
    expect(await run.start()).toBe(true);
    expect(names()).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
    // On disk before the page saw each file: the one being handed over.
    expect(pendingAtHandoff).toEqual([0, 1, 2]);
    expect(memory.saves.map((saved) => [saved.confirmed, saved.pending?.index ?? null])).toEqual([
      [0, 0],
      [1, null],
      [1, 1],
      [2, null],
      [2, 2],
      [3, null],
    ]);
    // The account the page named, the album it loaded, the files — nothing of their content.
    expect(memory.saves[0]).toEqual({ hostAccountId: CREATOR, albumId: ALBUM, uploadId: UPLOAD_ID, files: refs(files), confirmed: 0, pending: { index: 0, passedAt: T0 }, updatedAt: T0 });
    expect(run.snapshot()).toMatchObject({ state: 'complete', confirmed: 3, total: 3, stop: null, code: null, checkpointLeftBehind: false });
    expect(statuses(run)).toEqual(['verified', 'verified', 'verified']);
    expect(memory.clears).toEqual([UPLOAD_ID]);
    expect(memory.row()).toBeUndefined();
  });

  it('[VA-005] continues where a run of the same files stopped; one older than 14 days is cleared and reads as none; one of other files is said as such', async () => {
    const files = [file('a.jpg'), file('b.jpg'), file('c.jpg')];
    const stopped: VaultCheckpoint = { hostAccountId: CREATOR, albumId: ALBUM, uploadId: UPLOAD_ID, files: refs(files), confirmed: 2, pending: null, updatedAt: T0 - 60_000 };
    memory.rows.set(`${CREATOR}:${ALBUM}`, stopped);
    const found = await findVaultCheckpoint(memory.store, target, refs(files), T0);
    expect(found).toEqual({ kind: 'continue', checkpoint: stopped });
    expect(memory.loads).toEqual([target]);
    const run = runOf(files, stopped);
    expect(statuses(run)).toEqual(['verified', 'verified', 'pending']);
    expect(await run.start()).toBe(true);
    // Only what was not confirmed goes to the page; the run keeps its id.
    expect(names()).toEqual(['c.jpg']);
    expect(memory.saves.every((saved) => saved.uploadId === UPLOAD_ID)).toBe(true);
    expect(run.snapshot()).toMatchObject({ state: 'complete', confirmed: 3 });
    // Other files under the same album: said, not merged.
    memory.rows.set(`${CREATOR}:${ALBUM}`, stopped);
    expect(await findVaultCheckpoint(memory.store, target, refs([file('a.jpg'), file('b.jpg', 1)]), T0)).toEqual({ kind: 'other', checkpoint: stopped });
    expect(() => runOf([file('a.jpg')], stopped)).toThrow(/another account, album or files/);
    // 14 days and more: a forgotten run — cleared, none to continue.
    expect(await findVaultCheckpoint(memory.store, target, refs(files), T0 - 60_000 + VAULT_CHECKPOINT_TTL_MS)).toMatchObject({ kind: 'continue' });
    expect(await findVaultCheckpoint(memory.store, target, refs(files), T0 + VAULT_CHECKPOINT_TTL_MS)).toEqual({ kind: 'fresh', expired: true });
    expect(memory.row()).toBeUndefined();
    expect(await findVaultCheckpoint(memory.store, target, refs(files), T0)).toEqual({ kind: 'fresh', expired: false });
    // A row of another account under this key is not this one's.
    memory.rows.set(`${CREATOR}:${ALBUM}`, { ...stopped, hostAccountId: OTHER_CREATOR });
    expect(await findVaultCheckpoint(memory.store, target, refs(files), T0)).toEqual({ kind: 'fresh', expired: false });
  });

  it('[VA-004] a file handed over and not confirmed stays pending on disk; nothing starts until the person answers; «Нет» hands it again only on the next Start, «Есть» counts it', async () => {
    fates = { 'b.jpg': 'silent' };
    const files = [file('a.jpg'), file('b.jpg'), file('c.jpg')];
    const run = runOf(files);
    const started = run.start();
    await settle();
    expect(names()).toEqual(['a.jpg', 'b.jpg']);
    // The page never confirms it; the time limit ends the wait — not known, never «failed».
    timer.fire();
    expect(await started).toBe(true);
    expect(run.snapshot()).toMatchObject({ state: 'stopped', stop: { kind: 'timeout' }, code: 'CG-VAULT-UNCERTAIN', confirmed: 1 });
    expect(statuses(run)).toEqual(['verified', 'uncertain', 'pending']);
    expect(memory.row()).toMatchObject({ confirmed: 1, pending: { index: 1 } });
    // Never handed again on the run's own initiative.
    expect(await run.start()).toBe(false);
    expect(names()).toEqual(['a.jpg', 'b.jpg']);
    // The answer is written first; a write that fails changes nothing.
    memory.refuse();
    expect(await run.resolve('missing')).toBe(false);
    expect(statuses(run)).toEqual(['verified', 'uncertain', 'pending']);
    expect(await run.resolve('missing')).toBe(true);
    expect(memory.row()).toMatchObject({ confirmed: 1, pending: null });
    expect(statuses(run)).toEqual(['verified', 'pending', 'pending']);
    // The page's own upload line settled; the person starts again.
    page.uploaded();
    fates = {};
    expect(await run.start()).toBe(true);
    expect(names()).toEqual(['a.jpg', 'b.jpg', 'b.jpg', 'c.jpg']);
    expect(run.snapshot()).toMatchObject({ state: 'complete', confirmed: 3 });

    // After a reload: the checkpoint's pending file is the person's question before anything else (the album's cards
    // as the page shows them now — none).
    page.taken.splice(0);
    album = [];
    page.cards(album);
    facts.loaded(ALBUM, nextSeq());
    const reloaded: VaultCheckpoint = { hostAccountId: CREATOR, albumId: ALBUM, uploadId: UPLOAD_ID, files: refs(files), confirmed: 1, pending: { index: 1, passedAt: T0 - 1000 }, updatedAt: T0 - 1000 };
    memory.rows.set(`${CREATOR}:${ALBUM}`, reloaded);
    const again = runOf(files, reloaded);
    expect(again.snapshot()).toMatchObject({ code: 'CG-VAULT-UNCERTAIN' });
    expect(statuses(again)).toEqual(['verified', 'uncertain', 'pending']);
    expect(await again.start()).toBe(false);
    expect(await again.resolve('present')).toBe(true);
    expect(memory.row()).toMatchObject({ confirmed: 2, pending: null });
    expect(await again.start()).toBe(true);
    expect(names()).toEqual(['c.jpg']);
    expect(await again.resolve('present')).toBe(false);
  });
});

describe('[host:fansly] the vault run’s stops and progress (FS-VLT-1)', () => {
  it('[VA-006] progress file by file; a file already in the album is not handed over; a pause stops after the file in flight; a stop with a file in flight leaves it not known', async () => {
    album = ['a.jpg'];
    page.cards(album);
    facts.loaded(ALBUM, 2);
    const seen: VaultRunSnapshot[] = [];
    const files = [file('a.jpg'), file('b.jpg'), file('c.jpg'), file('d.jpg')];
    const run = runOf(files, null, (snapshot) => seen.push(snapshot));
    const started = run.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    run.pause();
    expect(await started).toBe(true);
    expect(run.snapshot()).toMatchObject({ state: 'paused', confirmed: 2 });
    expect(statuses(run)).toEqual(['present', 'verified', 'pending', 'pending']);
    expect(names()).toEqual(['b.jpg']);
    // The panel's progress: the file in flight and what is in the album, as they move.
    expect(seen.map((s) => [s.state, s.current, s.confirmed])).toEqual(
      expect.arrayContaining([
        ['running', 1, 1],
        ['pausing', 1, 1],
        ['paused', null, 2],
      ]),
    );
    fates = { 'c.jpg': 'silent' };
    const resumed = run.start();
    await settle();
    run.stop();
    expect(await resumed).toBe(true);
    expect(run.snapshot()).toMatchObject({ state: 'stopped', stop: { kind: 'stopped' }, code: 'CG-VAULT-UNCERTAIN' });
    expect(statuses(run)).toEqual(['present', 'verified', 'uncertain', 'pending']);
    expect(memory.row()).toMatchObject({ confirmed: 2, pending: { index: 2 } });
  });

  it('[VA-006] a stop while the checkpoint is being written hands nothing over; the checkpoint says so again', async () => {
    const run = runOf([file('a.jpg'), file('b.jpg')]);
    const save = memory.store.save.bind(memory.store);
    memory.store.save = (checkpoint) => {
      // The person stops just as the file's checkpoint goes to the background.
      if (checkpoint.pending !== null) run.stop();
      return save(checkpoint);
    };
    expect(await run.start()).toBe(true);
    expect(run.snapshot()).toMatchObject({ state: 'stopped', stop: { kind: 'stopped' }, code: 'CG-VAULT-STOPPED', confirmed: 0 });
    expect(statuses(run)).toEqual(['pending', 'pending']);
    expect(names()).toEqual([]);
    expect(memory.row()).toMatchObject({ confirmed: 0, pending: null });
    // A stop while a confirmation is being written: that file is in, the next one is not begun.
    memory.store.save = (checkpoint) => {
      if (checkpoint.pending === null && checkpoint.confirmed === 1) run.stop();
      return save(checkpoint);
    };
    expect(await run.start()).toBe(true);
    expect(run.snapshot()).toMatchObject({ state: 'stopped', confirmed: 1 });
    expect(names()).toEqual(['a.jpg']);
  });

  it('[VA-006] the page’s stops between files, nothing handed over: the album closed or another, the uploader collapsed or busy, the route left — each with its code; the run goes on from the same file', async () => {
    const files = [file('a.jpg'), file('b.jpg')];
    const cases: Array<[string, string, () => void, () => void]> = [
      ['album-closed', 'CG-VAULT-NO-ALBUM', () => page.closeAlbum(), () => (page.openAlbum('Set 1'), page.expandUploader(), drive(), page.cards([]), facts.loaded(ALBUM, 3))],
      ['album-changed', 'CG-VAULT-STOPPED', () => facts.loaded(OTHER_ALBUM, 5), () => facts.loaded(ALBUM, 6)],
      ['uploader-missing', 'CG-VAULT-NO-ALBUM', () => page.collapseUploader(), () => (page.expandUploader(), drive())],
      ['uploader-busy', 'CG-VAULT-STOPPED', () => page.host.querySelector('.media-wrapper')?.prepend(document.createElement('app-account-media-create-template')), () => page.uploaded()],
      ['route-left', 'CG-VAULT-STOPPED', () => history.replaceState({}, '', '/messages'), () => history.replaceState({}, '', '/creator/vault')],
    ];
    const run = runOf(files);
    for (const [kind, code, cause, undo] of cases) {
      cause();
      expect(await run.start(), kind).toBe(true);
      expect(run.snapshot(), kind).toMatchObject({ state: 'stopped', stop: { kind }, code, confirmed: 0 });
      expect(names(), kind).toEqual([]);
      undo();
    }
    expect(await run.start()).toBe(true);
    expect(run.snapshot()).toMatchObject({ state: 'complete', confirmed: 2 });
  });

  it('[VA-006] Fansly gave the file up: nothing landed, the run stops, and the next Start hands it again', async () => {
    fates = { 'a.jpg': 'fail' };
    const run = runOf([file('a.jpg'), file('b.jpg')]);
    expect(await run.start()).toBe(true);
    expect(run.snapshot()).toMatchObject({ state: 'stopped', stop: { kind: 'uploader-error' }, code: 'CG-VAULT-UPLOAD', confirmed: 0 });
    expect(statuses(run)).toEqual(['failed', 'pending']);
    expect(memory.row()).toMatchObject({ confirmed: 0, pending: null });
    page.uploaded();
    fates = {};
    expect(await run.start()).toBe(true);
    expect(names()).toEqual(['a.jpg', 'a.jpg', 'b.jpg']);
    expect(run.snapshot()).toMatchObject({ state: 'complete', confirmed: 2 });
  });

  it('[VA-006] the run’s own stops: a checkpoint not kept before the handoff (nothing handed) or after it (the file is in the album); the album’s order not the files’ — the file stays confirmed', async () => {
    memory.refuse();
    const run = runOf([file('a.jpg'), file('b.jpg'), file('c.jpg')]);
    expect(await run.start()).toBe(true);
    expect(run.snapshot()).toMatchObject({ state: 'stopped', stop: { kind: 'checkpoint-write-failed', afterUpload: false }, code: 'CG-VAULT-STOPPED' });
    expect(names()).toEqual([]);
    const started = run.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The page confirms `a` while the write of its confirmation fails.
    memory.refuse();
    expect(await started).toBe(true);
    expect(run.snapshot()).toMatchObject({ stop: { kind: 'checkpoint-write-failed', afterUpload: true }, confirmed: 1 });
    expect(statuses(run)).toEqual(['verified', 'pending', 'pending']);
    // The album shows `b` below the newest card: confirmed, and the run stops for the order.
    fates = { 'b.jpg': 'below' };
    expect(await run.start()).toBe(true);
    expect(run.snapshot()).toMatchObject({ state: 'stopped', stop: { kind: 'order-mismatch', expected: 'b.jpg', actual: 'a' }, confirmed: 2 });
    expect(statuses(run)).toEqual(['verified', 'verified', 'pending']);
    expect(names()).toEqual(['a.jpg', 'b.jpg']);
  });

  it('[VA-006] what a run takes: 1–500 files (the contract’s limit); the codes of the stops', () => {
    expect(VAULT_FILES_MAX).toBe(FANSLY_TAB_LIMITS.vaultFilesPerUpload);
    expect(() => runOf([])).toThrow(RangeError);
    expect(() => runOf(Array.from({ length: VAULT_FILES_MAX + 1 }, (_, i) => file(`${i}.jpg`)))).toThrow(RangeError);
    expect(vaultStopCode({ kind: 'album-closed' }, false)).toBe('CG-VAULT-NO-ALBUM');
    expect(vaultStopCode({ kind: 'uploader-missing' }, false)).toBe('CG-VAULT-NO-ALBUM');
    expect(vaultStopCode({ kind: 'uploader-error' }, false)).toBe('CG-VAULT-UPLOAD');
    expect(vaultStopCode({ kind: 'handoff-unavailable' }, false)).toBe('CG-VAULT-UPLOAD');
    expect(vaultStopCode({ kind: 'account-changed' }, false)).toBe('CG-VAULT-STOPPED');
    expect(vaultStopCode({ kind: 'order-mismatch', expected: 'a', actual: null }, false)).toBe('CG-VAULT-STOPPED');
    expect(vaultStopCode({ kind: 'timeout' }, true)).toBe('CG-VAULT-UNCERTAIN');
  });
});

describe('[host:fansly] the vault run belongs to the tab’s creator (AU-036)', () => {
  it('[AU-036] no creator from the page — no run; another creator between files stops it before a handoff, and with a file in flight leaves that file not known', async () => {
    facts.creator(null);
    expect(vaultTargetOf(uploader.view())).toBeNull();
    // The page's creator: another generation of the port — the album is the page's once it loads one.
    facts.creator(CREATOR);
    expect(vaultTargetOf(uploader.view())).toBeNull();
    facts.loaded(ALBUM, 2);
    expect(vaultTargetOf(uploader.view())).toEqual({ ...target, title: 'Set 1' });

    // `a` is confirmed; before the next file the page signs in as another creator.
    let switched = false;
    const run = runOf([file('a.jpg'), file('b.jpg'), file('c.jpg')], null, (snapshot) => {
      if (switched || snapshot.confirmed !== 1) return;
      switched = true;
      facts.creator(OTHER_CREATOR);
    });
    expect(await run.start()).toBe(true);
    expect(run.snapshot()).toMatchObject({ state: 'stopped', stop: { kind: 'account-changed' }, code: 'CG-VAULT-STOPPED', confirmed: 1 });
    expect(names()).toEqual(['a.jpg']);
    // The checkpoint stays the first creator's.
    expect(memory.row()).toMatchObject({ hostAccountId: CREATOR, confirmed: 1, pending: null });

    facts.creator(CREATOR);
    facts.loaded(ALBUM, nextSeq());
    switched = true;
    fates = { 'b.jpg': 'silent' };
    const resumed = run.start();
    await settle();
    facts.creator(OTHER_CREATOR);
    expect(await resumed).toBe(true);
    expect(run.snapshot()).toMatchObject({ stop: { kind: 'account-changed' }, code: 'CG-VAULT-UNCERTAIN' });
    expect(statuses(run)).toEqual(['verified', 'uncertain', 'pending']);
  });
});

describe('[host:fansly] review of P13a: the run’s own guards', () => {
  it('[VA-006] leaving and coming back to the same album while the checkpoint is written hands nothing over; the checkpoint says so again', async () => {
    const run = runOf([file('a.jpg'), file('b.jpg')]);
    const save = memory.store.save.bind(memory.store);
    let moved = false;
    memory.store.save = (checkpoint) => {
      if (!moved && checkpoint.pending !== null) {
        moved = true;
        // The person goes to the chats and back, and opens the same album again.
        facts.navigate('/messages');
        page.closeAlbum();
        facts.navigate('/creator/vault');
        page.openAlbum('Set 1');
        page.expandUploader();
        drive();
        page.cards([]);
        facts.loaded(ALBUM, 7);
      }
      return save(checkpoint);
    };
    expect(await run.start()).toBe(true);
    expect(run.snapshot()).toMatchObject({ state: 'stopped', stop: { kind: 'route-left' }, confirmed: 0 });
    expect(names()).toEqual([]);
    expect(memory.row()).toMatchObject({ confirmed: 0, pending: null });
    // The person starts again on the page as it is now.
    expect(await run.start()).toBe(true);
    expect(run.snapshot()).toMatchObject({ state: 'complete', confirmed: 2 });
  });

  it('[VA-006] two files of one card key — `cover.jpg` and `cover.mp4` — are refused before anything: the album could not tell them apart', () => {
    expect(vaultDuplicateKeys([file('cover.jpg'), file('cover.mp4'), file('b.jpg'), file('B.JPEG')])).toEqual(['cover.jpg', 'cover.mp4', 'b.jpg', 'B.JPEG']);
    expect(vaultDuplicateKeys([file('a.jpg'), file('b.jpg')])).toEqual([]);
    expect(() => runOf([file('cover.jpg'), file('cover.mp4')])).toThrow(/cover\.jpg/);
  });
});
