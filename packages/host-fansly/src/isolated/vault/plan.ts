// The person's files as a run will take them (docs/project-unite/architecture.md §7.11, §7.21; FS-VLT-1; VA-002;
// R20 P13b): the old extension's plan (fansly-chat `src/shared/vault-upload.ts` `buildVaultUploadPlan`) over the
// uploader's own card key (dom.ts `vaultMediaKey`). Pure: no DOM is read, nothing is kept.
//
// - A set is a flat folder: files of a subfolder never go (a stray `raw/` must not leak into the album), only the
//   media the vault takes, sorted naturally by name (001, 002, …, 010 — not 001, 010, 002), so a numbered export lands
//   in its numeric order.
// - The album lists the newest upload first: «first on top» uploads the LAST file first (`sequence` is the list
//   reversed), «last on top» uploads in the list's order. `items` stay in the album's order top to bottom — what the
//   person sees in the panel and later on the page.
// - Two files of one card key (`cover.jpg`, `cover.mp4`) cannot be told apart in the album; more files than the
//   checkpoint holds (`vaultFilesPerUpload`, 10 000 — no real upload); none the vault takes — each is a problem, and
//   the run is not offered. A name of
//   other than printable ASCII may come back renamed by Fansly, so its card may never be found: a warning.

import type { VaultAlbumOrder, VaultPlanProblem, VaultPlanWarning } from '@cg/contracts/vault-fansly';

import { vaultMediaKey } from './dom';
import { VAULT_FILES_MAX } from './run';

/** What the vault takes (the old extension's list, seen live 2026-09-09); anything else is left out and counted. */
export const VAULT_MEDIA_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'mov', 'm4v', 'webm'] as const;
const MEDIA = new RegExp(`\\.(${VAULT_MEDIA_EXTENSIONS.join('|')})$`, 'i');

/** A file as the page's input gives it: `webkitRelativePath` is `folder/name` for a folder, '' for files picked one by one. */
export interface VaultPick {
  readonly name: string;
  readonly size: number;
  readonly lastModified: number;
  readonly webkitRelativePath?: string;
}

export interface VaultPlan<F extends VaultPick> {
  /** The album's order top to bottom, as the person wants to see it. */
  readonly items: readonly F[];
  /** The order of the uploads that gives it. */
  readonly sequence: readonly F[];
  readonly order: VaultAlbumOrder;
  /** The one folder the files came from; null — files, or several folders. */
  readonly folder: string | null;
  readonly bytes: number;
  readonly problems: readonly VaultPlanProblem[];
  readonly warnings: readonly VaultPlanWarning[];
}

export const isVaultMedia = (name: string): boolean => MEDIA.test(name);

const natural = (a: string, b: string): number => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });
const segments = (path: string | undefined): string[] => (path ?? '').split('/').filter((part) => part !== '');
const printable = (name: string): boolean => /^[\x20-\x7e]+$/.test(name);

/** The set of `files` for an album read in `order`. */
export function planVaultUpload<F extends VaultPick>(files: readonly F[], order: VaultAlbumOrder): VaultPlan<F> {
  let nested = 0;
  let unsupported = 0;
  let nonAscii = 0;
  const folders = new Set<string>();
  const taken: F[] = [];
  for (const file of files) {
    const path = segments(file.webkitRelativePath);
    const [folder] = path;
    if (folder !== undefined && path.length >= 2) folders.add(folder);
    if (path.length > 2) {
      nested += 1;
      continue;
    }
    if (!isVaultMedia(file.name)) {
      unsupported += 1;
      continue;
    }
    if (!printable(file.name)) nonAscii += 1;
    taken.push(file);
  }
  taken.sort((a, b) => natural(a.name, b.name));

  const problems: VaultPlanProblem[] = [];
  if (taken.length === 0) problems.push({ kind: 'empty' });
  const byKey = new Map<string, string[]>();
  for (const file of taken) {
    const key = vaultMediaKey(file.name);
    byKey.set(key, [...(byKey.get(key) ?? []), file.name]);
  }
  const twins = [...byKey.values()].filter((names) => names.length > 1).flat();
  if (twins.length > 0) problems.push({ kind: 'duplicate-keys', names: twins });
  if (taken.length > VAULT_FILES_MAX) problems.push({ kind: 'too-many', count: taken.length, max: VAULT_FILES_MAX });

  const warnings: VaultPlanWarning[] = [];
  if (nonAscii > 0) warnings.push({ kind: 'non-ascii', count: nonAscii });
  if (nested > 0) warnings.push({ kind: 'nested-ignored', count: nested });
  if (unsupported > 0) warnings.push({ kind: 'unsupported-ignored', count: unsupported });

  return {
    items: taken,
    sequence: order === 'first-on-top' ? [...taken].reverse() : [...taken],
    order,
    folder: folders.size === 1 ? ([...folders][0] ?? null) : null,
    bytes: taken.reduce((sum, file) => sum + file.size, 0),
    problems,
    warnings,
  };
}
