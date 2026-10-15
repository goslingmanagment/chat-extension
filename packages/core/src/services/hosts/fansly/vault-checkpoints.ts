// The vault's checkpoints as the background keeps them (docs/project-unite/architecture.md §3.3, §7.11, §7.21;
// FS-VLT-1, VA-005, FS-PERM-5; R20 P13b): the answers of `fansly.vault.{resume,checkpoint,clear}` for Fansly's
// background chunk (`bg/fansly`), over storage.local. The tab's uploader writes one before it hands each file to the
// page (host-fansly isolated/vault/run.ts); a reload of the tab and an unload of the event page keep it — it is on
// disk, read again by the next panel on that album.
//
// - One key per account and album (`fansly.vault.<account>.<album>`): a run writes only its own album, and two
//   albums never rewrite each other. A row is read by the contract's schema: anything else reads as none and goes.
// - One upload per album at a time: a write of another upload's id over a row that is not forgotten is refused
//   (`recorded: false` — the tab hands nothing over). A run continues its own row (the same id); a new one starts only
//   once the album has none — the person's «Сбросить прошлый запуск» clears exactly that upload's row
//   (`fansly.vault.clear` names its id). So a second tab on the same album stops before its first file instead of
//   overwriting a checkpoint the first one still answers for.
// - The 14 days of a forgotten run are the tab's rule (run.ts `findVaultCheckpoint`, VA-005): `resume` gives the row
//   as it is, and the tab clears an old one. What nobody comes back for goes with «Очистить локальные данные» and with
//   the module's first start in a background (`sweep`).
// - Writes of one key run one after another: a slow write never lands after a later one.
// - Names of the person's files are in the row (the run checks the same files by them); the log hears ids and counts.

import { VaultCheckpointSchema, type VaultCheckpoint } from '@cg/contracts/tab-messages-fansly';

import type { KeyValuePort, ServiceLog } from '../../storage/ports';

export const VAULT_CHECKPOINT_PREFIX = 'fansly.vault.';
/** A checkpoint older than this is a forgotten run (host-fansly run.ts `VAULT_CHECKPOINT_TTL_MS`; a test holds them equal). */
export const VAULT_CHECKPOINT_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export const vaultCheckpointKey = (hostAccountId: string, albumId: string): string => `${VAULT_CHECKPOINT_PREFIX}${hostAccountId}.${albumId}`;

export interface AlbumRef {
  readonly hostAccountId: string;
  readonly albumId: string;
}

export interface VaultCheckpointsDeps {
  readonly local: KeyValuePort;
  readonly now: () => number;
  readonly log?: ServiceLog;
}

export interface VaultCheckpoints {
  /** `fansly.vault.resume`: the album's row; null — none, or one the contract does not read. */
  resume(ref: AlbumRef): Promise<{ readonly checkpoint: VaultCheckpoint | null }>;
  /** `fansly.vault.checkpoint`: false — not kept (another upload holds the album, the write failed). */
  checkpoint(checkpoint: VaultCheckpoint): Promise<{ readonly recorded: boolean }>;
  /** `fansly.vault.clear`: the row of exactly this upload goes; another upload's stays (false). */
  clear(ref: AlbumRef & { readonly uploadId: string }): Promise<{ readonly recorded: boolean }>;
  /** Forgotten rows (and rows the contract does not read) go; answers how many. */
  sweep(): Promise<number>;
}

export function createVaultCheckpoints(deps: VaultCheckpointsDeps): VaultCheckpoints {
  const { local, now } = deps;
  const log = deps.log ?? (() => undefined);
  const tails = new Map<string, Promise<unknown>>();
  /** One write of a key after another. */
  const serial = <T>(key: string, work: () => Promise<T>): Promise<T> => {
    const run = (tails.get(key) ?? Promise.resolve()).then(work, work);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    tails.set(key, tail);
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    return run;
  };

  /** The row under `key`: the contract's, of that account and album; null — none; `bad` — something else is there. */
  const read = async (key: string, ref: AlbumRef): Promise<VaultCheckpoint | null | 'bad'> => {
    const got = await local.get([key]);
    if (!got.ok) throw new Error(got.code);
    const raw = got.value[key];
    if (raw === undefined) return null;
    const parsed = VaultCheckpointSchema.safeParse(raw);
    return parsed.success && parsed.data.hostAccountId === ref.hostAccountId && parsed.data.albumId === ref.albumId ? parsed.data : 'bad';
  };
  const forgotten = (row: VaultCheckpoint): boolean => now() - row.updatedAt > VAULT_CHECKPOINT_TTL_MS;

  return {
    async resume(ref) {
      const key = vaultCheckpointKey(ref.hostAccountId, ref.albumId);
      const row = await serial(key, () => read(key, ref));
      if (row === 'bad') {
        // Not a checkpoint this build can read: it would only ever block the album.
        await serial(key, () => local.remove([key]));
        log({ level: 'warn', scope: 'bg.fansly.vault', msg: 'an unreadable checkpoint dropped' });
        return { checkpoint: null };
      }
      return { checkpoint: row };
    },

    checkpoint(checkpoint) {
      const key = vaultCheckpointKey(checkpoint.hostAccountId, checkpoint.albumId);
      return serial(key, async () => {
        const row = await read(key, checkpoint).catch(() => 'failed' as const);
        if (row === 'failed') return { recorded: false };
        if (row !== null && row !== 'bad' && row.uploadId !== checkpoint.uploadId && !forgotten(row)) {
          log({ level: 'warn', scope: 'bg.fansly.vault', msg: 'checkpoint refused: another upload holds the album', fields: { confirmed: row.confirmed, files: row.files.length } });
          return { recorded: false };
        }
        const written = await local.set({ [key]: checkpoint });
        if (!written.ok) log({ level: 'warn', scope: 'bg.fansly.vault', msg: 'checkpoint not written', code: written.code });
        return { recorded: written.ok };
      });
    },

    clear(ref) {
      const key = vaultCheckpointKey(ref.hostAccountId, ref.albumId);
      return serial(key, async () => {
        const row = await read(key, ref).catch(() => 'failed' as const);
        if (row === 'failed') return { recorded: false };
        if (row === null) return { recorded: true };
        if (row !== 'bad' && row.uploadId !== ref.uploadId) return { recorded: false };
        const removed = await local.remove([key]);
        return { recorded: removed.ok };
      });
    },

    async sweep() {
      const keys = await local.keys();
      if (!keys.ok) return 0;
      let dropped = 0;
      for (const key of keys.value) {
        if (!key.startsWith(VAULT_CHECKPOINT_PREFIX)) continue;
        const gone = await serial(key, async () => {
          const got = await local.get([key]);
          if (!got.ok) return false;
          const parsed = VaultCheckpointSchema.safeParse(got.value[key]);
          if (parsed.success && key === vaultCheckpointKey(parsed.data.hostAccountId, parsed.data.albumId) && !forgotten(parsed.data)) return false;
          return (await local.remove([key])).ok;
        });
        if (gone) dropped += 1;
      }
      if (dropped > 0) log({ level: 'info', scope: 'bg.fansly.vault', msg: 'forgotten checkpoints dropped', fields: { dropped } });
      return dropped;
    },
  };
}
