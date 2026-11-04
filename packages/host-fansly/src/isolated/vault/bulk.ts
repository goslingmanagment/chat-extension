// The upload of a set into the vault (2026-11-03; docs/project-unite/architecture.md §7.11): the run the panel takes
// when it has the album through Fansly's API. It replaces the file-by-file run (run.ts) — the order of the album no
// longer depends on the order of the uploads, so nothing waits for one file before the next.
//
// - What Fansly does (hub docs/plans/2026-10-23-wall-posts/fansly-publish-contract.md §2, §13, seen live 2026-10-26):
//   an album shows its rows, the newest first; a member added again loses its old row and takes a new one on top, its
//   name kept; one request makes its rows in its order. So the set is laid out by ONE request of all its members in the
//   upload order, whatever order the files landed in, and asking it again is harmless. The same bytes uploaded again
//   give the old medium, under its old name.
// - The page uploads: the files go to its own input in one `change` (its `multiple` input), side by side, as a
//   person's selection; each lands in the open album by the page's own addition (upload.ts `uploadMany`).
// - What landed is what Fansly answered the uploads (2026-11-04, the vault audit): the page's poll of an upload names
//   the file as the page sent it — its name and size — and the medium Fansly made of it (MAIN's `fx.vaultUpload`). A
//   file is its upload's medium, whatever name the album shows for it; a row the set did not upload is nobody's. A
//   file with no answer goes again, after a pause (VAULT_RETRY_PAUSES_MS), up to VAULT_FILE_TRIES; then it counts as
//   failed, with Fansly's words when it showed any.
// - Already in the album, before anything goes: a card of the same name AND the same content — what Fansly says of
//   the member (its type, width×height, a video's duration: Fansly gives no size and no hash) against the file's own
//   bytes (content.ts). A card of the same name and other content, or one that cannot be told: the file goes up; if
//   Fansly answers with that very card's medium, it was there (`present`), else the file's card stands beside it and
//   the summary names the file (`beside`). A Live Photo's photo and video of one name are two files of two kinds.
// - The lay-out adds every medium of the set to the album in the set's order (one the page did not add included), then
//   renames a member that kept another name to its file — Fansly's answer says the name it kept — and reads the album:
//   its first rows must be the set's media, each under its file's name.
// - The checkpoint keeps the album this tab's (one upload per album, the background's `held`) and the set's files for a
//   «continue» after a reload; a continue reads the album again — what is there by name and content is not uploaded
//   again, and a file that goes again anyway gives Fansly's same medium.
// - Stops: the page's reasons (upload.ts `VAULT_HALTS`), Fansly not answering the album (`album-api`), an album whose
//   first rows are not the set after the lay-out (`order-mismatch`: someone uploads beside, a name that did not take), a
//   failed file (`uploader-error`). Every stop says why and the next Start reads the album first.

import type { VaultOrderCheck } from '@cg/contracts/vault-fansly';
import type { VaultCheckpoint } from '@cg/contracts/tab-messages-fansly';

import { readVaultFileContent, sameVaultContent, type VaultFileContent } from './content';
import { isVaultVideo, vaultMediaKey } from './dom';
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
import { vaultGuard, type VaultHalt, type VaultUploadAnswer } from './upload';

/** Files one handoff takes at most; the page uploads them side by side. */
export const VAULT_BATCH_FILES = 100;
/** Bytes one handoff takes at most. */
export const VAULT_BATCH_BYTES = 8 * 1024 ** 3;
/** Times a file goes to the page before it counts as failed. */
export const VAULT_FILE_TRIES = 3;
/** The pause before a file goes again, by the times it went: what kept it out (Fansly, the line) often passes in seconds. */
export const VAULT_RETRY_PAUSES_MS: readonly number[] = [10_000, 30_000];
/** A pause is slept in steps of this, so a Pause or a Stop of the person's is heard at once. */
const REST_STEP_MS = 500;
/** How long the run waits for the page's own reload of the album (after its addition) before it calls it a stop. */
const RELOAD_WAIT_MS = 15_000;
const RELOAD_STEP_MS = 250;
/** A set the page did not take, handed again at most this many times in a row. */
const NOT_TAKEN_MAX = 2;

/** Stops of the page after which the run does not go on by itself: the person moved, or the page did. */
const PAGE_STOPS: ReadonlySet<VaultHalt> = new Set(['route-left', 'album-closed', 'album-changed', 'account-changed', 'uploader-missing', 'lost', 'stopped', 'timeout', 'handoff-indeterminate']);

/**
 * The album's first rows against the set: `ids` — the members in the upload order, so the album top to bottom reads
 * them reversed; `names` — the files' names by member: each row must show its file's name (dom.ts `vaultMediaKey`).
 */
export function vaultLayoutCheck(ids: readonly string[], rows: readonly VaultAlbumRowRef[], names: ReadonlyMap<string, string>): VaultOrderCheck {
  if (ids.length === 0) return { kind: 'ok', checked: 0 };
  if (rows.length === 0) return { kind: 'unseen' };
  const expected = [...ids].reverse();
  for (let index = 0; index < expected.length; index += 1) {
    const due = expected[index] as string;
    const row = rows[index];
    const name = names.get(due) ?? due;
    if (row === undefined || row.mediaId !== due || (names.has(due) && vaultMediaKey(row.name) !== vaultMediaKey(name))) {
      return { kind: 'mismatch', position: index + 1, expected: name, actual: row === undefined ? '' : row.name };
    }
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

const sameName = (a: string, b: string): boolean => a.normalize('NFC').trim() === b.normalize('NFC').trim();

/**
 * Which upload answer is which file's (`files` — the set handed at once): its name and size as the page sent them; then,
 * for a file left, the one answer of its size when no other file of the set has that size (a name written otherwise on
 * the way). One answer is one file's; a file with none — undefined.
 */
export function vaultAnswersOf(files: readonly { readonly name: string; readonly size: number }[], answers: readonly VaultUploadAnswer[]): Array<VaultUploadAnswer | undefined> {
  const used = new Set<VaultUploadAnswer>();
  const found: Array<VaultUploadAnswer | undefined> = files.map((file) => {
    // The newest answer of the file wins: the page polls an upload to its end.
    const answer = answers.filter((item) => !used.has(item) && item.size === file.size && sameName(item.name, file.name)).at(-1);
    if (answer !== undefined) used.add(answer);
    return answer;
  });
  files.forEach((file, index) => {
    if (found[index] !== undefined || files.filter((other) => other.size === file.size).length !== 1) return;
    const sized = answers.filter((item) => !used.has(item) && item.size === file.size);
    const only = sized.length === 1 ? sized[0] : undefined;
    if (only === undefined) return;
    used.add(only);
    found[index] = only;
  });
  return found;
}

export function createVaultBulkRun(init: VaultRunInit, deps: VaultRunDeps, onChange: (snapshot: VaultRunSnapshot) => void = () => undefined): VaultRun {
  const { target, files } = init;
  const { uploader, store, api } = deps;
  if (api === undefined) throw new Error('the upload of a set needs the album through Fansly’s API');
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const readContent = deps.readContent ?? readVaultFileContent;
  if (files.length === 0 || files.length > VAULT_FILES_MAX) throw new RangeError(`a vault run takes 1–${VAULT_FILES_MAX} files`);
  const twins = vaultDuplicateKeys(files, true);
  if (twins.length > 0) throw new RangeError(`files of one card key in a vault run: ${twins.join(', ')}`);
  const refs = files.map((file) => ({ name: file.name, size: file.size, lastModified: file.lastModified }));
  const resumed = init.checkpoint;
  if (resumed !== null && (resumed.hostAccountId !== target.hostAccountId || resumed.albumId !== target.albumId || !sameVaultFiles(resumed.files, refs))) {
    throw new Error('the checkpoint is of another account, album or files');
  }
  const uploadId = resumed?.uploadId ?? (deps.newId ?? (() => crypto.randomUUID()))();
  const keys = files.map((file) => vaultMediaKey(file.name));
  /** A file's kind as Fansly types its medium: 2 a video, 1 a photo. */
  const kinds = files.map((file) => (isVaultVideo(file.name) ? 2 : 1));
  const sizes = files.map((file) => file.size);
  const statuses: VaultItemStatus[] = refs.map(() => 'pending');
  /** The member of each file: the card it was found as, or the medium its upload's answer named. */
  const media: Array<string | null> = refs.map(() => null);
  const tries: number[] = refs.map(() => 0);
  /** The album's cards of each file's name and kind before it went up (their media): what its upload is told against. */
  const namesakes: Array<readonly string[]> = refs.map(() => []);
  /** Files that went up beside a card of their name with other content. */
  const beside = new Set<number>();
  /** What each file's own bytes say of its content, read once and only for a file whose name a card shows. */
  const contents = new Map<number, Promise<VaultFileContent | null>>();
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
    beside: refs.flatMap((file, index) => (beside.has(index) ? [file.name] : [])),
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

  const claimed = (): Set<string> => new Set(media.filter((id): id is string => id !== null));
  const contentOf = (index: number): Promise<VaultFileContent | null> => {
    let read = contents.get(index);
    if (read === undefined) {
      read = readContent(files[index] as File).catch(() => null);
      contents.set(index, read);
    }
    return read;
  };

  /**
   * Before anything goes: a file whose name a card shows, with the same content, is in the album — not uploaded again.
   * The cards of its name and kind are kept: its upload's answer tells whether it was one of them.
   */
  const adopt = async (rows: readonly VaultAlbumRowRef[]): Promise<void> => {
    const taken = claimed();
    for (let index = 0; index < files.length; index += 1) {
      if (media[index] !== null || statuses[index] !== 'pending') continue;
      const kind = kinds[index];
      const named = rows.filter((row) => vaultMediaKey(row.name) === keys[index] && (row.content?.type ?? kind) === kind);
      namesakes[index] = named.map((row) => row.mediaId);
      const free = named.filter((row) => !taken.has(row.mediaId));
      if (free.length === 0) continue;
      const own = await contentOf(index);
      if (stoppedNow()) return;
      const same = free.find((row) => sameVaultContent(own, row.content) === 'same');
      if (same === undefined) continue;
      media[index] = same.mediaId;
      taken.add(same.mediaId);
      statuses[index] = 'present';
    }
  };

  /** The set's files by Fansly's answers to their uploads; a file with none goes again, or counts as failed. */
  const take = (batch: readonly number[], uploads: readonly VaultUploadAnswer[]): void => {
    const answers = vaultAnswersOf(
      batch.map((index) => ({ name: (files[index] as File).name, size: sizes[index] ?? 0 })),
      uploads,
    );
    batch.forEach((index, at) => {
      const answer = answers[at];
      if (answer === undefined) {
        statuses[index] = (tries[index] ?? 0) >= VAULT_FILE_TRIES ? 'failed' : 'pending';
        return;
      }
      // The same bytes as another file of the set: one medium, one card — the content is in the album under that file.
      const twin = media.some((id, other) => other !== index && id === answer.mediaId);
      media[index] = answer.mediaId;
      if (twin || namesakes[index]?.includes(answer.mediaId) === true) {
        statuses[index] = 'present';
        return;
      }
      statuses[index] = 'verified';
      if ((namesakes[index]?.length ?? 0) > 0) beside.add(index);
    });
  };

  /** A pause before a file goes again, slept in steps: a Pause or a Stop ends it at once. */
  const rest = async (ms: number): Promise<void> => {
    for (let left = ms; left > 0 && !stoppedNow() && !pauseAsked(); left -= REST_STEP_MS) await sleep(Math.min(REST_STEP_MS, left));
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

  /**
   * The album laid out in the set's order (every medium of the set, one the page did not add included), a member that
   * kept another name renamed to its file, then read against the set.
   */
  const layOut = async (): Promise<void> => {
    const ids: string[] = [];
    const names = new Map<string, string>();
    media.forEach((id, index) => {
      if (id === null || names.has(id)) return;
      ids.push(id);
      names.set(id, (files[index] as File).name);
    });
    if (ids.length === 0) return;
    await api.arrange(target, ids);
    const rows = [...(await api.album(target))];
    for (let index = 0; index < Math.min(ids.length, rows.length); index += 1) {
      const row = rows[index] as VaultAlbumRowRef;
      const name = names.get(row.mediaId);
      // Only the set's own members: a stranger's card on top is the check's to say, never renamed.
      if (name === undefined || vaultMediaKey(row.name) === vaultMediaKey(name)) continue;
      const kept = await api.rename(target, row.mediaId, name);
      // The answer's word only: one that names no name, or another, leaves the row as it was read.
      if (kept !== null) rows[index] = { ...row, name: kept };
    }
    order = vaultLayoutCheck(ids, rows, names);
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
        const rows = await api.album(target);
        if (stoppedNow()) return true;
        await adopt(rows);
        if (stoppedNow()) return true;
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
          const batch = vaultBatchOf(waiting, tries, sizes);
          // A file that went before and did not land waits a moment first.
          const went = Math.max(0, ...batch.map((index) => tries[index] ?? 0));
          if (went > 0) {
            await rest(VAULT_RETRY_PAUSES_MS[Math.min(went, VAULT_RETRY_PAUSES_MS.length) - 1] ?? 0);
            if (stoppedNow()) return true;
            if (pauseAsked()) continue;
          }
          const page = await pageNow();
          if (stoppedNow()) return true;
          if (page.guard !== null) return halt({ kind: page.guard });
          if (page.missing) return halt({ kind: 'uploader-missing' });
          for (const index of batch) {
            statuses[index] = 'uploading';
            tries[index] = (tries[index] ?? 0) + 1;
          }
          current = batch[0] ?? null;
          startedAt = now();
          emit();
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
          // What landed is Fansly's answer to each upload, whatever the page showed or did not.
          take(batch, outcome.uploads);
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
    // Nothing is uncertain here: Fansly's answers and the album say what landed.
    resolve: () => Promise.resolve(false),
  };
}
