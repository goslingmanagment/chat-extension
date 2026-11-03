// The upload of a set into the vault (2026-11-03; docs/project-unite/architecture.md §7.11): the run the panel takes
// when it has the album through Fansly's API. It replaces the file-by-file run (run.ts) — the order of the album no
// longer depends on the order of the uploads, so nothing waits for one file before the next.
//
// - What Fansly does (hub docs/plans/2026-10-23-wall-posts/fansly-publish-contract.md §13, seen live 2026-10-26): an
//   album shows its rows, the newest first; a member added again loses its old row and takes a new one on top, its name
//   kept; one request makes its rows in its order. So the set is laid out by ONE request of all its members in the
//   upload order, whatever order the files landed in, and asking it again is harmless.
// - The page uploads: the files go to its own input in one `change` (its `multiple` input), side by side, as a
//   person's selection; each lands in the open album by the page's own addition (upload.ts `uploadMany`).
// - The album's rows say what landed — never the page's cards: a file is in the album when a row names it (its name
//   without the extension, dom.ts `vaultMediaKey`). A medium Fansly already had keeps its old name (`IMG_0191.jpeg`);
//   its row is the one new row of the set that names no file of it — then the file is that row, renamed to the file.
//   Two such rows and two such files cannot be told apart: those files go again one at a time (the same bytes give the
//   same medium, its row moves up — the one new row).
// - Nothing is uncertain: a file not in the album goes again (the same bytes give the same medium, the same member
//   keeps one row), up to FILE_TRIES; then it counts as failed, with Fansly's words when it showed any.
// - The checkpoint keeps the album this tab's (one upload per album, the background's `held`) and the set's files for a
//   «continue» after a reload; a continue reads the album again — what landed is not uploaded again.
// - Stops: the page's reasons (upload.ts `VAULT_HALTS`), Fansly not answering the album (`album-api`), an album whose
//   first rows are not the set after the lay-out (`order-mismatch`: someone uploads beside), a failed file
//   (`uploader-error`). Every stop leaves the album laid out as far as the files are in it only on a pause; a stop says
//   why and the next Start reads the album first.

import type { VaultOrderCheck } from '@cg/contracts/vault-fansly';
import type { VaultCheckpoint } from '@cg/contracts/tab-messages-fansly';

import { vaultMediaKey } from './dom';
import {
  VAULT_FILES_MAX,
  VaultAlbumApiError,
  sameVaultFiles,
  vaultDuplicateKeys,
  vaultStopCode,
  type VaultAlbumRowRef,
  type VaultItemStatus,
  type VaultRun,
  type VaultRunDeps,
  type VaultRunInit,
  type VaultRunSnapshot,
  type VaultRunState,
  type VaultStop,
} from './run';
import { vaultGuard, type VaultHalt } from './upload';

/** Files one handoff takes at most; the page uploads them side by side. */
export const VAULT_BATCH_FILES = 100;
/** Bytes one handoff takes at most. */
export const VAULT_BATCH_BYTES = 8 * 1024 ** 3;
/** Times a file goes to the page before it counts as failed. */
export const VAULT_FILE_TRIES = 3;
/** Reads of the album after a set while files of it are missing: the page's last addition may still be on its way. */
const LANDING_READS = 3;
const LANDING_GAP_MS = 2_000;
/** How long the run waits for the page's own reload of the album (after its addition) before it calls it a stop. */
const RELOAD_WAIT_MS = 15_000;
const RELOAD_STEP_MS = 250;
/** A set the page did not take, handed again at most this many times in a row. */
const NOT_TAKEN_MAX = 2;

/** Stops of the page after which the run does not go on by itself: the person moved, or the page did. */
const PAGE_STOPS: ReadonlySet<VaultHalt> = new Set(['route-left', 'album-closed', 'album-changed', 'account-changed', 'uploader-missing', 'lost', 'stopped', 'timeout', 'handoff-indeterminate']);

/**
 * The album's first rows against the set: `ids` — the members in the upload order, so the album top to bottom reads
 * them reversed; `names` — the files' names by member.
 */
export function vaultLayoutCheck(ids: readonly string[], rows: readonly VaultAlbumRowRef[], names: ReadonlyMap<string, string>): VaultOrderCheck {
  if (ids.length === 0) return { kind: 'ok', checked: 0 };
  if (rows.length === 0) return { kind: 'unseen' };
  const expected = [...ids].reverse();
  for (let index = 0; index < expected.length; index += 1) {
    const due = expected[index] as string;
    const row = rows[index];
    if (row === undefined || row.mediaId !== due) return { kind: 'mismatch', position: index + 1, expected: names.get(due) ?? due, actual: row === undefined ? '' : row.name };
  }
  return { kind: 'ok', checked: expected.length };
}

/** The next files to hand over: those never tried go together (up to the caps); a file tried before goes alone. */
export function vaultBatchOf(waiting: readonly number[], tries: readonly number[], sizes: readonly number[]): number[] {
  const fresh = waiting.filter((index) => (tries[index] ?? 0) === 0);
  if (fresh.length === 0) return waiting.slice(0, 1);
  const batch: number[] = [];
  let bytes = 0;
  for (const index of fresh) {
    const size = sizes[index] ?? 0;
    if (batch.length > 0 && (batch.length >= VAULT_BATCH_FILES || bytes + size > VAULT_BATCH_BYTES)) break;
    batch.push(index);
    bytes += size;
  }
  return batch;
}

export function createVaultBulkRun(init: VaultRunInit, deps: VaultRunDeps, onChange: (snapshot: VaultRunSnapshot) => void = () => undefined): VaultRun {
  const { target, files } = init;
  const { uploader, store, api } = deps;
  if (api === undefined) throw new Error('the upload of a set needs the album through Fansly’s API');
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  if (files.length === 0 || files.length > VAULT_FILES_MAX) throw new RangeError(`a vault run takes 1–${VAULT_FILES_MAX} files`);
  const twins = vaultDuplicateKeys(files);
  if (twins.length > 0) throw new RangeError(`files of one card key in a vault run: ${twins.join(', ')}`);
  const refs = files.map((file) => ({ name: file.name, size: file.size, lastModified: file.lastModified }));
  const resumed = init.checkpoint;
  if (resumed !== null && (resumed.hostAccountId !== target.hostAccountId || resumed.albumId !== target.albumId || !sameVaultFiles(resumed.files, refs))) {
    throw new Error('the checkpoint is of another account, album or files');
  }
  const uploadId = resumed?.uploadId ?? (deps.newId ?? (() => crypto.randomUUID()))();
  const keys = files.map((file) => vaultMediaKey(file.name));
  const fileKeys = new Set(keys);
  const sizes = files.map((file) => file.size);
  const statuses: VaultItemStatus[] = refs.map(() => 'pending');
  /** The member of each file, once a row of the album names it. */
  const media: Array<string | null> = refs.map(() => null);
  const tries: number[] = refs.map(() => 0);
  /** The checkpoint's count from the start, kept as the row on disk has it (`vaultCheckpointFollows`). */
  const confirmedOnDisk = resumed?.confirmed ?? 0;
  let state: VaultRunState = 'idle';
  let current: number | null = null;
  let startedAt: number | null = null;
  let stopped: VaultStop | null = null;
  let leftBehind = false;
  let order: VaultOrderCheck | null = null;
  let said: string | null = null;
  let abort: AbortController | null = null;

  const stoppedNow = (): boolean => state === 'stopped';
  const laidOut = (): VaultOrderCheck | null => order;
  const pauseAsked = (): boolean => state === 'pausing';
  const placed = (): number => statuses.filter((status) => status === 'present' || status === 'verified').length;
  const snapshot = (): VaultRunSnapshot => ({
    state,
    items: refs.map((file, i) => ({ name: file.name, size: file.size, status: statuses[i] as VaultItemStatus })),
    current,
    startedAt: current === null ? null : startedAt,
    confirmed: placed(),
    total: refs.length,
    stop: stopped,
    code: stopped === null ? null : vaultStopCode(stopped, false),
    checkpointLeftBehind: leftBehind,
    order,
  });
  const emit = (): void => onChange(snapshot());
  const checkpoint = (): VaultCheckpoint => ({ hostAccountId: target.hostAccountId, albumId: target.albumId, uploadId, files: refs, confirmed: confirmedOnDisk, pending: null, updatedAt: now() });
  const halt = (stop: VaultStop): true => {
    state = 'stopped';
    stopped = stop;
    current = null;
    emit();
    return true;
  };

  /** Rows by the name they show, the newest first: the first row of a name wins. */
  const byName = (rows: readonly VaultAlbumRowRef[]): Map<string, VaultAlbumRowRef> => {
    const named = new Map<string, VaultAlbumRowRef>();
    for (const row of rows) {
      const key = vaultMediaKey(row.name);
      if (key !== '' && !named.has(key)) named.set(key, row);
    }
    return named;
  };
  const claimed = (): Set<string> => new Set(media.filter((id): id is string => id !== null));

  /** Files a row names already, before anything goes: in the album, not uploaded again. */
  const adopt = (rows: readonly VaultAlbumRowRef[]): void => {
    const named = byName(rows);
    const taken = claimed();
    keys.forEach((key, index) => {
      if (media[index] !== null) return;
      const row = named.get(key);
      if (row === undefined || taken.has(row.mediaId)) return;
      media[index] = row.mediaId;
      taken.add(row.mediaId);
      statuses[index] = 'present';
    });
  };

  /** The album's rows after a set; read again a moment later while a file of it is missing and no stray row explains it. */
  const landed = async (batch: readonly number[], before: ReadonlySet<string>): Promise<readonly VaultAlbumRowRef[]> => {
    let rows = await api.album(target);
    for (let read = 1; read < LANDING_READS; read += 1) {
      const named = byName(rows);
      const missing = batch.filter((index) => !named.has(keys[index] as string)).length;
      const strays = rows.filter((row) => !before.has(row.row) && !fileKeys.has(vaultMediaKey(row.name))).length;
      if (missing <= strays) return rows;
      await sleep(LANDING_GAP_MS);
      rows = await api.album(target);
    }
    return rows;
  };

  /** The set's files by the album's rows: by name, then the one stray row for the one file left; renamed to the file. */
  const take = async (batch: readonly number[], rows: readonly VaultAlbumRowRef[], before: ReadonlySet<string>): Promise<void> => {
    const named = byName(rows);
    const taken = claimed();
    const left: number[] = [];
    for (const index of batch) {
      const row = named.get(keys[index] as string);
      if (row !== undefined && !taken.has(row.mediaId)) {
        media[index] = row.mediaId;
        taken.add(row.mediaId);
        statuses[index] = 'verified';
      } else left.push(index);
    }
    // A medium Fansly already had keeps its own name: the new row of this set that names no file of it.
    const strays = rows.filter((row) => !before.has(row.row) && !taken.has(row.mediaId) && !fileKeys.has(vaultMediaKey(row.name)));
    const only = left.length === 1 ? left[0] : undefined;
    const stray = strays.length === 1 ? strays[0] : undefined;
    if (only !== undefined && stray !== undefined) {
      await api.rename(target, stray.mediaId, (files[only] as File).name);
      media[only] = stray.mediaId;
      statuses[only] = 'verified';
      left.length = 0;
    }
    for (const index of left) statuses[index] = (tries[index] ?? 0) >= VAULT_FILE_TRIES ? 'failed' : 'pending';
  };

  /** The page as it is once its own reload of the album (after an addition) is over; null guard — it can take files. */
  const pageNow = async (): Promise<{ readonly guard: VaultHalt | null; readonly missing: boolean }> => {
    for (let waited = 0; ; waited += RELOAD_STEP_MS) {
      const view = uploader.view();
      const guard = vaultGuard(view, target);
      if (guard !== 'album-loading' || waited >= RELOAD_WAIT_MS) return { guard, missing: view.uploader === 'missing' };
      await sleep(RELOAD_STEP_MS);
    }
  };

  /** The name of the file the lay-out puts on top: the last one of the set the album holds. */
  const topName = (): string => {
    for (let index = media.length - 1; index >= 0; index -= 1) if (media[index] !== null) return (files[index] as File).name;
    return '';
  };

  /** The album laid out in the set's order (the members the album has of it), then read against the set. */
  const layOut = async (): Promise<void> => {
    const ids = media.filter((id): id is string => id !== null);
    if (ids.length === 0) return;
    await api.arrange(target, ids);
    const names = new Map<string, string>();
    media.forEach((id, index) => {
      if (id !== null) names.set(id, (files[index] as File).name);
    });
    order = vaultLayoutCheck(ids, await api.album(target), names);
  };

  return {
    snapshot,
    async start() {
      if (state === 'running' || state === 'pausing') return false;
      if (state === 'complete') return true;
      state = 'running';
      stopped = null;
      order = null;
      said = null;
      // A file that failed is tried again only by this explicit Start.
      statuses.forEach((status, index) => {
        if (status === 'failed') {
          statuses[index] = 'pending';
          tries[index] = 0;
        }
      });
      emit();
      abort = new AbortController();
      try {
        const blocked = vaultGuard(uploader.view(), target);
        if (blocked !== null) return halt({ kind: blocked });
        if (!(await store.save(checkpoint()).catch(() => false))) return halt({ kind: 'checkpoint-write-failed', afterUpload: false });
        if (stoppedNow()) return true;
        let rows = await api.album(target);
        if (stoppedNow()) return true;
        adopt(rows);
        emit();
        let notTaken = 0;
        for (;;) {
          if (stoppedNow()) return true;
          const waiting = statuses.flatMap((status, index) => (status === 'pending' ? [index] : []));
          if (waiting.length === 0) break;
          if (pauseAsked()) {
            await layOut();
            if (stoppedNow()) return true;
            state = 'paused';
            current = null;
            emit();
            return true;
          }
          const page = await pageNow();
          if (stoppedNow()) return true;
          if (page.guard !== null) return halt({ kind: page.guard });
          if (page.missing) return halt({ kind: 'uploader-missing' });
          const batch = vaultBatchOf(waiting, tries, sizes);
          for (const index of batch) {
            statuses[index] = 'uploading';
            tries[index] = (tries[index] ?? 0) + 1;
          }
          current = batch[0] ?? null;
          startedAt = now();
          emit();
          const before = new Set(rows.map((row) => row.row));
          const outcome = await uploader.uploadMany(
            batch.map((index) => files[index] as File),
            target,
            { signal: abort.signal, ticket: uploader.ticket() },
          );
          if (outcome.state === 'refused') {
            for (const index of batch) {
              statuses[index] = 'pending';
              tries[index] = Math.max(0, (tries[index] ?? 1) - 1);
            }
            return halt({ kind: outcome.halt });
          }
          if (outcome.state === 'settled' && outcome.said !== null) said = outcome.said;
          // What landed is the album's word, whatever the page showed or did not.
          rows = await landed(batch, before);
          await take(batch, rows, before);
          current = null;
          startedAt = null;
          if (outcome.state === 'unknown' && outcome.halt === 'not-taken') {
            // The page took none of it: those files were not tried.
            for (const index of batch) if (statuses[index] === 'pending') tries[index] = Math.max(0, (tries[index] ?? 1) - 1);
            notTaken += 1;
            if (notTaken > NOT_TAKEN_MAX) return halt({ kind: 'not-taken' });
          } else notTaken = 0;
          emit();
          if (stoppedNow()) return true;
          if (outcome.state === 'unknown' && PAGE_STOPS.has(outcome.halt)) return halt({ kind: outcome.halt });
        }
        await layOut();
        if (stoppedNow()) return true;
        current = null;
        if (statuses.includes('failed')) return halt(said === null ? { kind: 'uploader-error' } : { kind: 'uploader-error', said });
        // Read through a call: `order` is set by `layOut`, which the compiler does not follow.
        const laid = laidOut();
        if (laid !== null && laid.kind === 'mismatch') return halt({ kind: 'order-mismatch', expected: laid.expected, actual: laid.actual === '' ? null : laid.actual });
        // An album that shows no card after the lay-out is no album checked: the set is not complete, its checkpoint stays.
        if (laid !== null && laid.kind === 'unseen') return halt({ kind: 'order-mismatch', expected: topName(), actual: null });
        state = 'complete';
        if (!(await store.clear(target, uploadId).catch(() => false))) leftBehind = true;
        emit();
        return true;
      } catch (error) {
        statuses.forEach((status, index) => {
          if (status === 'uploading') statuses[index] = 'pending';
        });
        return halt(error instanceof VaultAlbumApiError ? { kind: 'album-api', said: error.code } : { kind: 'internal-error' });
      } finally {
        abort = null;
      }
    },
    pause() {
      if (state !== 'running') return;
      state = 'pausing';
      emit();
    },
    stop() {
      if (state !== 'running' && state !== 'pausing') return;
      if (abort !== null && current !== null) abort.abort();
      else halt({ kind: 'stopped' });
    },
    // Nothing is uncertain here: the album says what landed.
    resolve: () => Promise.resolve(false),
  };
}
