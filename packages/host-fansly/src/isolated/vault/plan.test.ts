// The person's files as a run takes them (docs/project-unite/architecture.md §7.21; FS-VLT-1; R20 P13b): the old
// extension's plan — a flat folder of the media the vault takes, in natural order, the album's order turned into the
// order of the uploads — over the uploader's card key.

import { FANSLY_TAB_LIMITS } from '@cg/contracts/tab-messages-fansly';
import { describe, expect, it } from 'vitest';

import { planVaultUpload, type VaultPick } from './plan';
import { VAULT_FILES_MAX } from './run';

const pick = (name: string, folder: string | null = 'Set 1', size = 10): VaultPick => ({ name, size, lastModified: 1, webkitRelativePath: folder === null ? '' : `${folder}/${name}` });
const names = (files: readonly VaultPick[]): string[] => files.map((file) => file.name);

describe('[host:fansly] the vault’s plan of a set (R20 P13b)', () => {
  it('[VA-002] a folder: the media the vault takes, sorted naturally; «first on top» uploads the last file first, «last on top» in order', () => {
    const files = [pick('010.jpg'), pick('002.JPG'), pick('001.png'), pick('notes.txt'), pick('clip.MP4', 'Set 1', 5)];
    const first = planVaultUpload(files, 'first-on-top');
    expect(names(first.items)).toEqual(['001.png', '002.JPG', '010.jpg', 'clip.MP4']);
    expect(names(first.sequence)).toEqual(['clip.MP4', '010.jpg', '002.JPG', '001.png']);
    expect([first.folder, first.bytes, first.problems]).toEqual(['Set 1', 35, []]);
    expect(first.warnings).toEqual([{ kind: 'unsupported-ignored', count: 1 }]);
    const last = planVaultUpload(files, 'last-on-top');
    expect(names(last.items)).toEqual(names(first.items));
    expect(names(last.sequence)).toEqual(['001.png', '002.JPG', '010.jpg', 'clip.MP4']);
  });

  it('[VA-002] a subfolder never leaks into the album; a name Fansly may rename is said; files of several folders have no folder name', () => {
    const plan = planVaultUpload([pick('a.jpg'), { ...pick('b.jpg'), webkitRelativePath: 'Set 1/raw/b.jpg' }, pick('фото.jpg'), pick('c.jpg', 'Set 2')], 'first-on-top');
    expect(names(plan.items)).toEqual(['a.jpg', 'c.jpg', 'фото.jpg']);
    expect(plan.warnings).toEqual([
      { kind: 'non-ascii', count: 1 },
      { kind: 'nested-ignored', count: 1 },
    ]);
    expect(plan.folder).toBeNull();
    // Files picked one by one: no folder at all.
    expect(planVaultUpload([pick('a.jpg', null)], 'first-on-top').folder).toBeNull();
  });

  it('[VA-002] what the run cannot take is a problem: nothing the vault takes, two files of one card, more than one run takes', () => {
    expect(planVaultUpload([pick('notes.txt')], 'first-on-top').problems).toEqual([{ kind: 'empty' }]);
    expect(planVaultUpload([], 'first-on-top').problems).toEqual([{ kind: 'empty' }]);
    // The album tells cards apart by the name without its extension, as Fansly rewrites `JPG` → `jpeg`.
    expect(planVaultUpload([pick('cover.jpg'), pick('Cover.MP4'), pick('b.png')], 'first-on-top').problems).toEqual([{ kind: 'duplicate-keys', names: ['cover.jpg', 'Cover.MP4'] }]);
    const many = Array.from({ length: VAULT_FILES_MAX + 1 }, (_, i) => pick(`${String(i).padStart(4, '0')}.jpg`));
    expect(planVaultUpload(many, 'first-on-top').problems).toEqual([{ kind: 'too-many', count: VAULT_FILES_MAX + 1, max: VAULT_FILES_MAX }]);
    expect(VAULT_FILES_MAX).toBe(FANSLY_TAB_LIMITS.vaultFilesPerUpload);
  });
});
