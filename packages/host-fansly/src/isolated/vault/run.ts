// A run of the vault uploader: the person's files, one at a time, into the open album, with a checkpoint
// (docs/project-unite/architecture.md §7.11; FS-VLT-1; VA-004…VA-006, AU-036; R20 P13a). The old extension's runner
// (fansly-chat `src/content/vault/upload-runner.ts`, `checkpoint-store.ts`) over the contract's checkpoint.
//
// - The checkpoint (`VaultCheckpoint`, `fansly.vault.*`): per account and album, the person's files by name, size and
//   time, how many from the start an album card confirmed, and the file handed over and not yet confirmed
//   (`pending`). The files go in their order; a run continues from `confirmed`. The checkpoint is written BEFORE each
//   file is handed to the page — a reload between the handoff and the confirmation is the case it is for — and is
//   not kept: the file is not handed over (`checkpoint-write-failed`).
// - Family law, as for a send (VA-004): a file handed over and not confirmed is `uncertain` and is never handed again
//   on the run's own initiative. The run does not start while one waits; the person looks at the album and answers
//   «Есть» or «Нет» (`resolve`), and the answer is written before anything else.
// - A checkpoint older than 14 days is a forgotten run, not one to continue: it is cleared (VA-005). One of other
//   files is said as such — the person continues with those files or drops it.
// - Who (AU-036): the run belongs to the tab's creator as the page's own `/account/me` named it, never a guess; no
//   creator — no run; another one — the run stops.
// - Stops (VA-006): every reason the page can cause (upload.ts `VAULT_HALTS`), and the run's own — a checkpoint not
//   written, the album's order not the one the files were put in (`order-mismatch`), its own failure. A stop leaves a
//   checkpoint to continue from; a definite failure of Fansly's is tried again only by the person's next Start.

import type { CgFanslyCode } from '@cg/contracts/errors-fansly';
import { FANSLY_TAB_LIMITS, type VaultCheckpoint } from '@cg/contracts/tab-messages-fansly';

import { vaultMediaKey } from './dom';
import { vaultGuard, type VaultHalt, type VaultTarget, type VaultUploader } from './upload';

/** A checkpoint older than this is a forgotten run (the old extension's TTL). */
export const VAULT_CHECKPOINT_TTL_MS = 14 * 24 * 60 * 60 * 1000;
/** Files of one run: the contract's `vaultFilesPerUpload` (tab-messages-fansly FANSLY_TAB_LIMITS) — a storage bound, not a person's limit. */
export const VAULT_FILES_MAX = FANSLY_TAB_LIMITS.vaultFilesPerUpload;

/** Where checkpoints are kept: the background, through `fansly.vault.*` (wired with the panel, P13b). */
export interface VaultCheckpointStore {
  /** `fansly.vault.resume`: the account's checkpoint for the album; null — none. */
  load(target: VaultTarget): Promise<VaultCheckpoint | null>;
  /** `fansly.vault.checkpoint`: false — not kept (`recorded: false`). */
  save(checkpoint: VaultCheckpoint): Promise<boolean>;
  /** `fansly.vault.clear`. */
  clear(target: VaultTarget, uploadId: string): Promise<boolean>;
}

/** The person's file as the checkpoint keeps it: nothing of its content. */
export interface VaultFileRef {
  readonly name: string;
  readonly size: number;
  readonly lastModified: number;
}

const refOf = (file: VaultFileRef): VaultFileRef => ({ name: file.name, size: file.size, lastModified: file.lastModified });
export const sameVaultFiles = (a: readonly VaultFileRef[], b: readonly VaultFileRef[]): boolean =>
  a.length === b.length && a.every((file, i) => file.name === b[i]?.name && file.size === b[i]?.size && file.lastModified === b[i]?.lastModified);

/** The names of the files that share a card key with another one (dom.ts `vaultMediaKey`), in their order; empty — none. */
export function vaultDuplicateKeys(files: readonly { readonly name: string }[]): string[] {
  const counts = new Map<string, number>();
  for (const file of files) counts.set(vaultMediaKey(file.name), (counts.get(vaultMediaKey(file.name)) ?? 0) + 1);
  return files.filter((file) => (counts.get(vaultMediaKey(file.name)) ?? 0) > 1).map((file) => file.name);
}

/** What stands for an album when a run is about to begin. */
export type VaultResume =
  /** Nothing to continue (none, or a forgotten one that was cleared). */
  | { readonly kind: 'fresh'; readonly expired: boolean }
  /** A run of these very files stopped here: it continues; a pending file waits for the person's answer. */
  | { readonly kind: 'continue'; readonly checkpoint: VaultCheckpoint }
  /** A run of other files stopped here: continue with those files, or drop it (`store.clear`). */
  | { readonly kind: 'other'; readonly checkpoint: VaultCheckpoint };

/** Reads the checkpoint of `target` for `files` (VA-005): an expired one is cleared and reads as none. */
export async function findVaultCheckpoint(store: VaultCheckpointStore, target: VaultTarget, files: readonly VaultFileRef[], now: number): Promise<VaultResume> {
  const checkpoint = await store.load(target);
  // A row of another account or album is not this one's (the store's key says otherwise only by a fault).
  if (checkpoint === null || checkpoint.hostAccountId !== target.hostAccountId || checkpoint.albumId !== target.albumId) return { kind: 'fresh', expired: false };
  if (now - checkpoint.updatedAt > VAULT_CHECKPOINT_TTL_MS) {
    await store.clear(target, checkpoint.uploadId).catch(() => false);
    return { kind: 'fresh', expired: true };
  }
  return sameVaultFiles(checkpoint.files, files) ? { kind: 'continue', checkpoint } : { kind: 'other', checkpoint };
}

export type VaultItemStatus =
  | 'pending'
  /** In the album before this run's handoff: not handed over. */
  | 'present'
  | 'uploading'
  | 'verified'
  /** Fansly gave it up: nothing landed; the next Start tries it again. */
  | 'failed'
  /** Handed over, never confirmed: the person answers. */
  | 'uncertain';

export type VaultRunState = 'idle' | 'running' | 'pausing' | 'paused' | 'stopped' | 'complete';

export type VaultStop =
  /** `said` — Fansly's own words of an `uploader-error` (dom.ts `failure`). */
  | { readonly kind: VaultHalt; readonly said?: string }
  /** The album's first card after a confirmed file is another one: the order the files were put in no longer holds. */
  | { readonly kind: 'order-mismatch'; readonly expected: string; readonly actual: string | null }
  /** `afterUpload`: the file IS in the album; only the checkpoint does not say so yet. */
  | { readonly kind: 'checkpoint-write-failed'; readonly afterUpload: boolean }
  | { readonly kind: 'internal-error' };

export interface VaultRunSnapshot {
  readonly state: VaultRunState;
  readonly items: ReadonlyArray<{ readonly name: string; readonly size: number; readonly status: VaultItemStatus }>;
  /** The file in flight: its index. */
  readonly current: number | null;
  /** When the file in flight was handed over (`now()`); null — none in flight. */
  readonly startedAt: number | null;
  /** Files in the album, from the start (the checkpoint's `confirmed`). */
  readonly confirmed: number;
  readonly total: number;
  readonly stop: VaultStop | null;
  /** The code the panel says a stop with (CG-VAULT-*); null — none. */
  readonly code: CgFanslyCode | null;
  /** The last clear of the checkpoint failed: a stale «continue» may be offered on the next visit. */
  readonly checkpointLeftBehind: boolean;
}

export interface VaultRunInit {
  readonly target: VaultTarget;
  readonly files: readonly File[];
  /** `continue` of findVaultCheckpoint; null — a new run. */
  readonly checkpoint: VaultCheckpoint | null;
}

export interface VaultRunDeps {
  readonly uploader: VaultUploader;
  readonly store: VaultCheckpointStore;
  readonly now?: () => number;
  readonly newId?: () => string;
}

export interface VaultRun {
  snapshot(): VaultRunSnapshot;
  /** Runs until every file is in the album, the person pauses, or a stop; never rejects. False — not started: a file waits for an answer, or it runs. */
  start(): Promise<boolean>;
  /** Stops after the file in flight. */
  pause(): void;
  /** Stops now: a file in flight becomes `uncertain`. */
  stop(): void;
  /** The person's answer for the uncertain file (VA-004), written first; false — not written, nothing changed. */
  resolve(answer: 'present' | 'missing'): Promise<boolean>;
}

const NO_ALBUM: ReadonlySet<string> = new Set(['album-closed', 'uploader-missing']);
const REFUSED: ReadonlySet<string> = new Set(['uploader-error', 'handoff-unavailable']);

/** The code of a stop: «no album», «Fansly did not take it», «not known whether it loaded», or «stopped». */
export function vaultStopCode(stop: VaultStop, uncertain: boolean): CgFanslyCode {
  if (uncertain) return 'CG-VAULT-UNCERTAIN';
  if (NO_ALBUM.has(stop.kind)) return 'CG-VAULT-NO-ALBUM';
  return REFUSED.has(stop.kind) ? 'CG-VAULT-UPLOAD' : 'CG-VAULT-STOPPED';
}

export function createVaultRun(init: VaultRunInit, deps: VaultRunDeps, onChange: (snapshot: VaultRunSnapshot) => void = () => undefined): VaultRun {
  const { target, files } = init;
  const { uploader, store } = deps;
  const now = deps.now ?? (() => Date.now());
  if (files.length === 0 || files.length > VAULT_FILES_MAX) throw new RangeError(`a vault run takes 1–${VAULT_FILES_MAX} files`);
  // The album tells its cards apart by the key alone: two files of one key, and the second would read as «in the
  // album» and never go (the old plan builder refused them too).
  const twins = vaultDuplicateKeys(files);
  if (twins.length > 0) throw new RangeError(`files of one card key in a vault run: ${twins.join(', ')}`);
  const refs = files.map(refOf);
  const resumed = init.checkpoint;
  if (resumed !== null && (resumed.hostAccountId !== target.hostAccountId || resumed.albumId !== target.albumId || !sameVaultFiles(resumed.files, refs))) {
    throw new Error('the checkpoint is of another account, album or files');
  }
  const uploadId = resumed?.uploadId ?? (deps.newId ?? (() => crypto.randomUUID()))();
  const statuses: VaultItemStatus[] = refs.map((_, i) => (resumed !== null && i < resumed.confirmed ? 'verified' : 'pending'));
  let confirmed = resumed?.confirmed ?? 0;
  /** The file handed over and not confirmed, as the checkpoint says it. */
  let pending: { readonly index: number; readonly passedAt: number } | null = resumed?.pending ?? null;
  if (pending !== null) statuses[pending.index] = 'uncertain';
  let state: VaultRunState = 'idle';
  let current: number | null = null;
  let startedAt: number | null = null;
  let stopped: VaultStop | null = null;
  let leftBehind = false;
  let abort: AbortController | null = null;

  const uncertain = (): boolean => statuses.includes('uncertain');
  /** `stop()` comes from outside, between the run's awaits: a method read, so the compiler does not narrow it away. */
  const stoppedNow = (): boolean => state === 'stopped';
  const snapshot = (): VaultRunSnapshot => ({
    state,
    items: refs.map((file, i) => ({ name: file.name, size: file.size, status: statuses[i] as VaultItemStatus })),
    current,
    startedAt: current === null ? null : startedAt,
    confirmed,
    total: refs.length,
    stop: stopped,
    code: stopped === null ? (uncertain() ? 'CG-VAULT-UNCERTAIN' : null) : vaultStopCode(stopped, uncertain()),
    checkpointLeftBehind: leftBehind,
  });
  const emit = (): void => onChange(snapshot());
  const checkpoint = (): VaultCheckpoint => ({ hostAccountId: target.hostAccountId, albumId: target.albumId, uploadId, files: refs, confirmed, pending, updatedAt: now() });
  const persist = (): Promise<boolean> => store.save(checkpoint()).catch(() => false);
  const halt = (stop: VaultStop): false => {
    state = 'stopped';
    stopped = stop;
    current = null;
    abort = null;
    emit();
    return false;
  };

  /** One file — the next after the confirmed ones. True — on to the next; false — the run stopped. */
  const step = async (index: number): Promise<boolean> => {
    const file = files[index] as File;
    const key = vaultMediaKey(file.name);
    const view = uploader.view();
    const blocked = vaultGuard(view, target);
    if (blocked !== null) return halt({ kind: blocked });
    if (view.settled.includes(key)) {
      // In the album already, before any handoff of ours: not handed over again. Only a card Fansly is done with
      // counts (the old extension's `findReadyCard`): a card «Upload Failed» or still «Processing» is no upload that
      // landed, and the file goes again.
      statuses[index] = 'present';
      confirmed = index + 1;
      if (!(await persist())) return halt({ kind: 'checkpoint-write-failed', afterUpload: false });
      emit();
      return !stoppedNow();
    }
    if (view.uploader !== 'ready') return halt({ kind: view.uploader === 'busy' ? 'uploader-busy' : 'uploader-missing' });
    // The page as the run saw it now: the handoff after the write takes nothing if it moved meanwhile (P7c's
    // discipline — an answer is taken only in the generation it was asked in).
    const ticket = uploader.ticket();

    // On disk before the page sees the file: a reload in between is exactly what it is for.
    pending = { index, passedAt: now() };
    if (!(await persist())) {
      pending = null;
      return halt({ kind: 'checkpoint-write-failed', afterUpload: false });
    }
    // Stopped during the write: nothing was handed over, and the checkpoint says so again.
    if (stoppedNow()) {
      pending = null;
      await persist();
      return false;
    }
    statuses[index] = 'uploading';
    current = index;
    startedAt = now();
    abort = new AbortController();
    emit();
    // The step looks at the page again before it hands anything over: what changed during the write is a refusal.
    const outcome = await uploader.upload(file, target, { signal: abort.signal, ticket });
    switch (outcome.state) {
      case 'refused':
        statuses[index] = 'pending';
        pending = null;
        await persist();
        return halt({ kind: outcome.halt });
      case 'failed':
        statuses[index] = 'failed';
        pending = null;
        await persist();
        return halt(outcome.said === null ? { kind: 'uploader-error' } : { kind: 'uploader-error', said: outcome.said });
      case 'unknown':
        // `pending` stays on disk: the person answers for this file.
        statuses[index] = 'uncertain';
        return halt({ kind: outcome.halt });
      case 'done': {
        statuses[index] = 'verified';
        confirmed = index + 1;
        pending = null;
        current = null;
        abort = null;
        if (!(await persist())) return halt({ kind: 'checkpoint-write-failed', afterUpload: true });
        // In the album; the run stops because the order the files were put in no longer holds there.
        if (outcome.top !== key) return halt({ kind: 'order-mismatch', expected: file.name, actual: outcome.top });
        emit();
        return true;
      }
    }
  };

  const pauseAsked = (): boolean => state === 'pausing';

  return {
    snapshot,
    async start() {
      if (state === 'running' || state === 'pausing' || uncertain()) return false;
      if (state === 'complete') return true;
      state = 'running';
      stopped = null;
      // A definite failure of Fansly's is tried again only by this explicit Start.
      for (let i = 0; i < statuses.length; i += 1) if (statuses[i] === 'failed') statuses[i] = 'pending';
      emit();
      try {
        for (let index = confirmed; index < files.length; index += 1) {
          // Stopped during the last file's final write: the next one is not begun.
          if (stoppedNow()) return true;
          if (pauseAsked()) {
            state = 'paused';
            emit();
            return true;
          }
          if (!(await step(index))) return true;
        }
      } catch {
        // Whatever threw, the run lands where it can go on: a file handed over is a question for the person.
        if (current !== null && statuses[current] === 'uploading') statuses[current] = 'uncertain';
        halt({ kind: 'internal-error' });
        return true;
      }
      state = 'complete';
      current = null;
      if (!(await store.clear(target, uploadId).catch(() => false))) leftBehind = true;
      emit();
      return true;
    },
    pause() {
      if (state !== 'running') return;
      state = 'pausing';
      emit();
    },
    stop() {
      if (state === 'running' || state === 'pausing') {
        if (abort !== null) abort.abort();
        else halt({ kind: 'stopped' });
      }
    },
    async resolve(answer) {
      const index = pending?.index ?? statuses.indexOf('uncertain');
      if (index < 0 || statuses[index] !== 'uncertain' || state === 'running' || state === 'pausing') return false;
      const before = { confirmed, pending };
      if (answer === 'present') confirmed = index + 1;
      pending = null;
      if (!(await persist())) {
        ({ confirmed, pending } = before);
        return false;
      }
      statuses[index] = answer === 'present' ? 'verified' : 'pending';
      emit();
      return true;
    },
  };
}
