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
//   (`fansly.vault.clear` names its id).
// - And one tab at a time (review of P13b): two tabs may hold copies of the same paused run — the same id — and each
//   would hand its next file over. The tab whose write the album's row took holds the album while it is open (its tab
//   session is registered): another tab's write, reset or answer is refused `held`, and its read says so. In memory, a
//   background's life: after the event page's sleep every tab registers anew, the old sessions are gone, and the next
//   writer holds it. What guards the copies then is the row itself: a write of the same upload is kept only when it
//   follows the row on disk (`vaultCheckpointFollows`) — never back, never a file over one in flight; a copy that fell
//   behind is refused, and its tab reads the row again.
// - Every check and its write are one step of the key's queue: nothing lands between a reading and what it decides.
// - The 14 days of a forgotten run are the tab's rule (run.ts `findVaultCheckpoint`, VA-005): `resume` gives the row
//   as it is, and the tab clears an old one. What nobody comes back for goes with «Очистить локальные данные» and with
//   the module's first start in a background (`sweep`).
// - Writes of one key run one after another: a slow write never lands after a later one.
// - Names of the person's files are in the row (the run checks the same files by them); the log hears ids and counts.

import { VaultCheckpointSchema, vaultCheckpointFollows, type VaultCheckpoint } from '@cg/contracts/tab-messages-fansly';

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
  /** Whether the tab session that holds an album is still registered; absent — a holder holds for the background's life. */
  readonly alive?: (holder: string) => boolean;
}

/** `held` — another open tab holds the album: nothing was read for writing, nothing written. */
export type VaultAck = { readonly recorded: boolean; readonly held?: true };

export interface VaultCheckpoints {
  /** `fansly.vault.resume`: the album's row; null — none, or one the contract does not read. `held` — another tab holds it. */
  resume(ref: AlbumRef, holder?: string): Promise<{ readonly checkpoint: VaultCheckpoint | null; readonly held?: true }>;
  /** `fansly.vault.checkpoint`: false — not kept (another upload or tab holds the album, a write that does not follow the row, the store failed). */
  checkpoint(checkpoint: VaultCheckpoint, holder?: string): Promise<VaultAck>;
  /** `fansly.vault.clear`: the row of exactly this upload goes; another upload's stays (false); another tab's — `held`. */
  clear(ref: AlbumRef & { readonly uploadId: string }, holder?: string): Promise<VaultAck>;
  /** Forgotten rows (and rows the contract does not read) go; answers how many. */
  sweep(): Promise<number>;
}

const HELD = { recorded: false, held: true } as const;

export function createVaultCheckpoints(deps: VaultCheckpointsDeps): VaultCheckpoints {
  const { local, now } = deps;
  const log = deps.log ?? (() => undefined);
  const alive = deps.alive ?? (() => true);
  const tails = new Map<string, Promise<unknown>>();
  /** The tab session whose write each album's row took last. */
  const holders = new Map<string, string>();
  /** Another tab than `holder` holds the album of `key`, and it is still open. */
  const heldFrom = (key: string, holder: string | undefined): boolean => {
    const owner = holders.get(key);
    if (owner === undefined || owner === holder) return false;
    if (alive(owner)) return true;
    holders.delete(key);
    return false;
  };
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
    resume(ref, holder) {
      const key = vaultCheckpointKey(ref.hostAccountId, ref.albumId);
      // The reading and the removal of a row it cannot read are one step: a write that comes meanwhile waits for both.
      return serial(key, async () => {
        const row = await read(key, ref);
        const held = heldFrom(key, holder) ? ({ held: true } as const) : {};
        if (row !== 'bad') return { checkpoint: row, ...held };
        // Not a checkpoint this build can read: it would only ever block the album.
        await local.remove([key]);
        log({ level: 'warn', scope: 'bg.fansly.vault', msg: 'an unreadable checkpoint dropped' });
        return { checkpoint: null, ...held };
      });
    },

    checkpoint(checkpoint, holder) {
      const key = vaultCheckpointKey(checkpoint.hostAccountId, checkpoint.albumId);
      return serial(key, async (): Promise<VaultAck> => {
        if (heldFrom(key, holder)) {
          log({ level: 'warn', scope: 'bg.fansly.vault', msg: 'checkpoint refused: another tab holds the album' });
          return HELD;
        }
        const row = await read(key, checkpoint).catch(() => 'failed' as const);
        if (row === 'failed') return { recorded: false };
        if (row !== null && row !== 'bad' && !forgotten(row)) {
          if (row.uploadId !== checkpoint.uploadId) {
            log({ level: 'warn', scope: 'bg.fansly.vault', msg: 'checkpoint refused: another upload holds the album', fields: { confirmed: row.confirmed, files: row.files.length } });
            return { recorded: false };
          }
          if (!vaultCheckpointFollows(row, checkpoint)) {
            log({ level: 'warn', scope: 'bg.fansly.vault', msg: 'checkpoint refused: it does not follow the album’s row', fields: { confirmed: row.confirmed, next: checkpoint.confirmed, pending: row.pending !== null } });
            return { recorded: false };
          }
        }
        const written = await local.set({ [key]: checkpoint });
        if (!written.ok) log({ level: 'warn', scope: 'bg.fansly.vault', msg: 'checkpoint not written', code: written.code });
        else if (holder !== undefined) holders.set(key, holder);
        return { recorded: written.ok };
      });
    },

    clear(ref, holder) {
      const key = vaultCheckpointKey(ref.hostAccountId, ref.albumId);
      return serial(key, async (): Promise<VaultAck> => {
        if (heldFrom(key, holder)) return HELD;
        const row = await read(key, ref).catch(() => 'failed' as const);
        if (row === 'failed') return { recorded: false };
        if (row === null) {
          holders.delete(key);
          return { recorded: true };
        }
        if (row !== 'bad' && row.uploadId !== ref.uploadId) return { recorded: false };
        const removed = await local.remove([key]);
        if (removed.ok) holders.delete(key);
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
