import { VaultCheckpointSchema, type VaultCheckpoint } from '@cg/contracts/tab-messages-fansly';

export const CHECKPOINT_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export interface VaultCheckpointStore {
  load(accountId: string, albumId: string): Promise<VaultCheckpoint | null>;
  save(checkpoint: VaultCheckpoint): Promise<void>;
  clear(accountId: string, albumId: string, uploadId: string): Promise<void>;
}
/** Storage is supplied by composition/background; host-fansly never touches browser.* or page storage. */
export interface CheckpointStorage {
  read(key: string): Promise<unknown>;
  write(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}
const keyOf = (account: string, album: string): string => `fansly.vault.v1:${account}:${album}`;
export function createVaultCheckpointStore(storage: CheckpointStorage, now: () => number = Date.now): VaultCheckpointStore {
  const tails = new Map<string, Promise<unknown>>();
  const serial = <T>(key: string, work: () => Promise<T>): Promise<T> => {
    const run = (tails.get(key) ?? Promise.resolve()).then(work, work);
    const tail = run.then(() => undefined, () => undefined);
    tails.set(key, tail);
    void tail.then(() => { if (tails.get(key) === tail) tails.delete(key); });
    return run;
  };
  const read = async (account: string, album: string): Promise<VaultCheckpoint | null> => {
    const result = VaultCheckpointSchema.safeParse(await storage.read(keyOf(account, album)));
    if (!result.success) return null;
    const c = result.data;
    return c.hostAccountId === account && c.albumId === album && c.updatedAt <= now() && now() - c.updatedAt < CHECKPOINT_TTL_MS ? c : null;
  };
  return {
    load: (account, album) => serial(keyOf(account, album), () => read(account, album)),
    save(checkpoint) {
      const c = VaultCheckpointSchema.parse(checkpoint);
      return serial(keyOf(c.hostAccountId, c.albumId), () => storage.write(keyOf(c.hostAccountId, c.albumId), c));
    },
    clear: (account, album, uploadId) => serial(keyOf(account, album), async () => {
      const c = await read(account, album);
      // A delayed completion must not erase a newer run.
      if (c?.uploadId === uploadId) await storage.remove(keyOf(account, album));
    }),
  };
}
