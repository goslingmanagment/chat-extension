// The vault's checkpoints in the background (R20 P13b; FS-VLT-1, VA-005): `fansly.vault.*` over storage.local — one
// row per account and album, one upload per album, exactly that upload's row cleared; every answer checked by the
// contract's schema; a row on disk outlives the event page (a new background over the same storage reads it).

import { FANSLY_TAB_REQUESTS, type VaultCheckpoint } from '@cg/contracts/tab-messages-fansly';
import { describe, expect, it } from 'vitest';

import { createMemoryKv, manualClock } from '../../test-support/memory-kv';
import { VAULT_CHECKPOINT_TTL_MS, createVaultCheckpoints, vaultCheckpointKey } from './vault-checkpoints';

const CREATOR = '700000000000000001';
const ALBUM = '700000000000000301';
const OTHER_ALBUM = '700000000000000302';
const ID = '00000000-0000-4000-8000-000000000510';
const OTHER_ID = '00000000-0000-4000-8000-000000000511';
const T0 = 1_790_000_000_000;
const ref = { hostAccountId: CREATOR, albumId: ALBUM };
const row = (over: Partial<VaultCheckpoint> = {}): VaultCheckpoint => ({
  hostAccountId: CREATOR,
  albumId: ALBUM,
  uploadId: ID,
  files: [
    { name: 'b.jpg', size: 10, lastModified: T0 - 1000 },
    { name: 'a.jpg', size: 20, lastModified: T0 - 1000 },
  ],
  confirmed: 0,
  pending: { index: 0, passedAt: T0 },
  updatedAt: T0,
  ...over,
});
/** Each answer as the RPC checks it on the way out. */
const answer = <T>(type: 'fansly.vault.resume' | 'fansly.vault.checkpoint' | 'fansly.vault.clear', value: T): T => FANSLY_TAB_REQUESTS[type].res.parse(value) as T;

function world() {
  const kv = createMemoryKv();
  const clock = manualClock(T0);
  const logs: string[] = [];
  const start = () => createVaultCheckpoints({ local: kv.open(), now: () => clock.now(), log: (entry) => logs.push(entry.msg) });
  return { kv, clock, logs, start };
}

describe('[host:fansly] the vault’s checkpoints in the background (R20 P13b)', () => {
  it('[VA-005] [FS-VLT-1] a row per account and album: written before each file, read by the next panel, the same after the event page went to sleep', async () => {
    const w = world();
    const first = w.start();
    expect(answer('fansly.vault.resume', await first.resume(ref))).toEqual({ checkpoint: null });
    expect(answer('fansly.vault.checkpoint', await first.checkpoint(row()))).toEqual({ recorded: true });
    expect(await first.checkpoint(row({ confirmed: 1, pending: null }))).toEqual({ recorded: true });
    expect(w.kv.read(vaultCheckpointKey(CREATOR, ALBUM))).toEqual(row({ confirmed: 1, pending: null }));
    // Another album of the same account is a row of its own.
    expect(answer('fansly.vault.resume', await first.resume({ ...ref, albumId: OTHER_ALBUM }))).toEqual({ checkpoint: null });
    // The event page unloads; a new background over the same storage.local answers the next panel.
    const second = w.start();
    expect(answer('fansly.vault.resume', await second.resume(ref))).toEqual({ checkpoint: row({ confirmed: 1, pending: null }) });
  });

  it('[VA-005] one upload per album: another upload’s write is refused while the album’s row is alive; the person’s reset clears exactly that upload', async () => {
    const w = world();
    const store = w.start();
    expect(await store.checkpoint(row())).toEqual({ recorded: true });
    expect(await store.checkpoint(row({ uploadId: OTHER_ID }))).toEqual({ recorded: false });
    expect(w.logs).toContain('checkpoint refused: another upload holds the album');
    // A clear of another upload leaves the row.
    expect(answer('fansly.vault.clear', await store.clear({ ...ref, uploadId: OTHER_ID }))).toEqual({ recorded: false });
    expect((await store.resume(ref)).checkpoint?.uploadId).toBe(ID);
    expect(answer('fansly.vault.clear', await store.clear({ ...ref, uploadId: ID }))).toEqual({ recorded: true });
    expect((await store.resume(ref)).checkpoint).toBeNull();
    // Nothing there: a clear has nothing to do and says so as done.
    expect(await store.clear({ ...ref, uploadId: ID })).toEqual({ recorded: true });
    // Now the album is free for the other upload.
    expect(await store.checkpoint(row({ uploadId: OTHER_ID }))).toEqual({ recorded: true });
    // A forgotten row (older than 14 days) does not hold the album.
    w.clock.advance(VAULT_CHECKPOINT_TTL_MS + 1);
    expect(await store.checkpoint(row({ uploadId: ID, updatedAt: w.clock.now() }))).toEqual({ recorded: true });
  });

  it('writes of one album land in their order, however long each takes; a failed write is «not kept», and the tab hands nothing over', async () => {
    const w = world();
    const store = w.start();
    const writes = [store.checkpoint(row({ confirmed: 0 })), store.checkpoint(row({ confirmed: 1, pending: null })), store.checkpoint(row({ confirmed: 1, pending: { index: 1, passedAt: T0 } }))];
    expect(await Promise.all(writes)).toEqual([{ recorded: true }, { recorded: true }, { recorded: true }]);
    expect(w.kv.read<VaultCheckpoint>(vaultCheckpointKey(CREATOR, ALBUM))?.pending).toEqual({ index: 1, passedAt: T0 });
    w.kv.failNext('set');
    expect(await store.checkpoint(row({ confirmed: 2, pending: null }))).toEqual({ recorded: false });
    w.kv.failNext('get');
    expect(await store.checkpoint(row({ confirmed: 2, pending: null }))).toEqual({ recorded: false });
    expect(w.kv.read<VaultCheckpoint>(vaultCheckpointKey(CREATOR, ALBUM))?.confirmed).toBe(1);
    // A read that fails is the tab's to say: nothing starts over a checkpoint it could not read.
    w.kv.failNext('get');
    await expect(store.resume(ref)).rejects.toThrow();
  });

  it('a row the contract does not read, or filed under another album, is none — and goes; «Очистить» and the first start drop the forgotten ones, never a live one', async () => {
    const w = world();
    w.kv.data.set(vaultCheckpointKey(CREATOR, ALBUM), { version: 1, done: ['a.jpg'] });
    w.kv.data.set(vaultCheckpointKey(CREATOR, OTHER_ALBUM), row());
    const store = w.start();
    expect(await store.resume(ref)).toEqual({ checkpoint: null });
    expect(w.kv.data.has(vaultCheckpointKey(CREATOR, ALBUM))).toBe(false);
    expect(await store.resume({ ...ref, albumId: OTHER_ALBUM })).toEqual({ checkpoint: null });
    // The sweep: an old one, one under the wrong key, and a live one.
    w.kv.data.set(vaultCheckpointKey(CREATOR, ALBUM), row({ updatedAt: T0 - VAULT_CHECKPOINT_TTL_MS - 1 }));
    w.kv.data.set(vaultCheckpointKey(CREATOR, OTHER_ALBUM), row());
    w.kv.data.set(vaultCheckpointKey(CREATOR, '700000000000000303'), row({ albumId: '700000000000000303' }));
    w.kv.data.set('send.native', { kept: true });
    expect(await store.sweep()).toBe(2);
    expect([...w.kv.data.keys()].sort()).toEqual([vaultCheckpointKey(CREATOR, '700000000000000303'), 'send.native'].sort());
  });
});

describe('[host:fansly] one upload per album across tabs (review of P13b)', () => {
  const TAB_A = 'tab-a';
  const TAB_B = 'tab-b';
  function tabs() {
    const kv = createMemoryKv();
    const open = new Set([TAB_A, TAB_B]);
    const store = createVaultCheckpoints({ local: kv.open(), now: () => T0, alive: (holder) => open.has(holder) });
    return { kv, open, store };
  }

  it('[VA-004] [VA-005] the tab that wrote the album’s checkpoint holds it while it is open: another tab’s write, reset or answer is refused as held, and its read says so', async () => {
    const w = tabs();
    // A paused run both tabs know: one file confirmed, none in flight.
    expect(await w.store.checkpoint(row({ confirmed: 1, pending: null }), TAB_A)).toEqual({ recorded: true });
    // Tab A continues: its next file is on disk before the page sees it.
    expect(await w.store.checkpoint(row({ confirmed: 1, pending: { index: 1, passedAt: T0 } }), TAB_A)).toEqual({ recorded: true });
    // Tab B continues its own copy of the paused run: the same file — refused before anything is handed over.
    expect(await w.store.checkpoint(row({ confirmed: 1, pending: { index: 1, passedAt: T0 } }), TAB_B)).toEqual({ recorded: false, held: true });
    expect(await w.store.checkpoint(row({ confirmed: 1, pending: null }), TAB_B)).toEqual({ recorded: false, held: true });
    expect(await w.store.clear({ ...ref, uploadId: ID }, TAB_B)).toEqual({ recorded: false, held: true });
    expect(await w.store.resume(ref, TAB_B)).toEqual({ checkpoint: row({ confirmed: 1, pending: { index: 1, passedAt: T0 } }), held: true });
    expect(await w.store.resume(ref, TAB_A)).toEqual({ checkpoint: row({ confirmed: 1, pending: { index: 1, passedAt: T0 } }) });
    // Tab A goes (closed, reloaded): the album is free — but only for a step that follows the row as it is.
    w.open.delete(TAB_A);
    expect(await w.store.checkpoint(row({ confirmed: 1, pending: { index: 1, passedAt: T0 } }), TAB_B)).toEqual({ recorded: false });
    expect(await w.store.checkpoint(row({ confirmed: 2, pending: null }), TAB_B)).toEqual({ recorded: true });
    // Now tab B holds it.
    expect(await w.store.resume(ref, TAB_B)).toEqual({ checkpoint: row({ confirmed: 2, pending: null }) });
    w.open.add(TAB_A);
    expect(await w.store.resume(ref, TAB_A)).toEqual({ checkpoint: row({ confirmed: 2, pending: null }), held: true });
  });

  it('[VA-005] a write that does not follow the row on disk is refused: never back, never a second file over one in flight; the run’s own steps always pass', async () => {
    const w = tabs();
    const files = Array.from({ length: 6 }, (_, i) => ({ name: `${String(i)}.jpg`, size: 10, lastModified: T0 - 1000 }));
    const step = async (confirmed: number, pending: number | null): Promise<boolean> =>
      (await w.store.checkpoint(row({ files, confirmed, pending: pending === null ? null : { index: pending, passedAt: T0 } }), TAB_A)).recorded;
    // A fresh run: a file already in the album, then one handed over, confirmed, the next handed over, answered «Нет».
    expect([await step(1, null), await step(1, 1), await step(2, null), await step(2, 2), await step(2, null)]).toEqual([true, true, true, true, true]);
    // Back, two files ahead: refused.
    expect([await step(1, null), await step(4, null)]).toEqual([false, false]);
    // A file handed over; another one — or the same one again — over it: refused.
    expect(await step(2, 2)).toBe(true);
    expect([await step(2, 3), await step(2, 2), await step(1, 1)]).toEqual([false, false, false]);
    // A confirmation whose write was lost, then the next file: the run's own path after a failed write.
    expect(await step(3, 3)).toBe(true);
    expect(w.kv.read<VaultCheckpoint>(vaultCheckpointKey(CREATOR, ALBUM))).toMatchObject({ confirmed: 3, pending: { index: 3 } });
  });

  it('an unreadable row goes in the same step as its reading: a checkpoint written meanwhile is never removed', async () => {
    const w = world();
    w.kv.data.set(vaultCheckpointKey(CREATOR, ALBUM), { version: 1, done: ['a.jpg'] });
    const store = w.start();
    const [read, written] = await Promise.all([store.resume(ref), store.checkpoint(row())]);
    expect(read).toEqual({ checkpoint: null });
    expect(written).toEqual({ recorded: true });
    expect(w.kv.read(vaultCheckpointKey(CREATOR, ALBUM))).toEqual(row());
  });
});
