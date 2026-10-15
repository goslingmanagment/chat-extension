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
