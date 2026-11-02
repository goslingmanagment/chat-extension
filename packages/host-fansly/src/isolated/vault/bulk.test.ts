// The upload of a set (bulk.ts) over an album as Fansly keeps it: rows the newest first, a member added again moves up
// with its name, the same bytes are the same medium. The page and the API are stand-ins; what is checked is what the
// run asks and what the album reads after it.

import { describe, expect, it } from 'vitest';

import { createVaultBulkRun } from './bulk';
import { VaultAlbumApiError, type VaultAlbumApi, type VaultAlbumRowRef, type VaultCheckpointStore } from './run';
import type { VaultBatchOutcome, VaultTarget, VaultUploader, VaultView } from './upload';

const TARGET: VaultTarget = { hostAccountId: '100000000000000001', albumId: '200000000000000001', title: 'SXT-003' };

interface Behaviour {
  /** Files Fansly already had: their medium keeps this name. */
  readonly kept?: Readonly<Record<string, string>>;
  /** Files that never land. */
  readonly lost?: readonly string[];
  /** The album fails to answer. */
  readonly down?: boolean;
}

function stand(behaviour: Behaviour = {}, present: readonly string[] = []) {
  let next = 300000000000000000n;
  const id = (): string => String((next += 1n));
  const media = new Map<string, { readonly id: string; readonly name: string }>();
  /** Oldest first. */
  let album: Array<{ row: string; mediaId: string; name: string }> = [];
  const add = (mediaIds: readonly string[]): void => {
    for (const mediaId of mediaIds) {
      const old = album.find((row) => row.mediaId === mediaId);
      album = album.filter((row) => row.mediaId !== mediaId);
      album.push({ row: id(), mediaId, name: old?.name ?? [...media.values()].find((item) => item.id === mediaId)?.name ?? '' });
    }
  };
  const mediumOf = (name: string): string => {
    const known = media.get(name);
    if (known !== undefined) return known.id;
    const made = { id: id(), name: behaviour.kept?.[name] ?? name };
    media.set(name, made);
    return made.id;
  };
  for (const name of present) add([mediumOf(name)]);
  const asked = { batches: [] as string[][], arranged: [] as string[][], renamed: [] as string[] };
  const rows = (): VaultAlbumRowRef[] => [...album].reverse().map((row) => ({ ...row }));
  const api: VaultAlbumApi = {
    album: async () => {
      if (behaviour.down === true) throw new VaultAlbumApiError('CG-FAN-NETWORK');
      return rows();
    },
    arrange: async (_target, mediaIds) => {
      asked.arranged.push([...mediaIds]);
      add(mediaIds);
    },
    rename: async (_target, mediaId, name) => {
      asked.renamed.push(name);
      const row = album.find((item) => item.mediaId === mediaId);
      if (row !== undefined) row.name = name;
      return name;
    },
  };
  const view = (): VaultView => ({ route: true, hostAccountId: TARGET.hostAccountId, albumId: TARGET.albumId, title: TARGET.title ?? null, loading: false, uploader: 'ready', cards: [], names: [], settled: [] });
  const uploader: VaultUploader = {
    view,
    ticket: () => '1:1',
    upload: async () => ({ state: 'refused', halt: 'uploader-busy' }),
    uploadMany: async (files): Promise<VaultBatchOutcome> => {
      asked.batches.push(files.map((file) => file.name));
      // They land in any order: the last one first.
      const landed = [...files].reverse().filter((file) => !(behaviour.lost ?? []).includes(file.name));
      add(landed.map((file) => mediumOf(file.name)));
      return { state: 'settled', path: 'data-transfer', said: landed.length === files.length ? null : 'Upload failed. Retry' };
    },
    stats: () => ({ watching: false, watches: 0, mutations: 0 }),
    dispose: () => undefined,
  };
  const store: VaultCheckpointStore = { load: async () => null, save: async () => true, clear: async () => true };
  return { api, uploader, store, asked, rows };
}

const file = (name: string): File => new File(['x'.repeat(name.length)], name, { type: name.endsWith('.mov') ? 'video/quicktime' : 'image/jpeg', lastModified: 1 });
/** The upload order of «first on top»: the last file first. */
const set = (...names: string[]): File[] => names.map(file).reverse();
const sleep = async (): Promise<void> => undefined;

async function run(files: readonly File[], s: ReturnType<typeof stand>) {
  const vault = createVaultBulkRun({ target: TARGET, files, checkpoint: null }, { uploader: s.uploader, store: s.store, api: s.api, sleep, newId: () => '00000000-0000-4000-8000-000000000001' });
  await vault.start();
  return vault.snapshot();
}

describe('the upload of a set', () => {
  it('hands the set at once; whatever order it landed in, one request lays the album out in the set’s order', async () => {
    const s = stand();
    const snapshot = await run(set('SXT-003_01_pic01.jpg', 'SXT-003_02_clip01.mov', 'SXT-003_03_pic02.jpg'), s);
    expect(s.asked.batches).toHaveLength(1);
    expect(s.asked.arranged).toHaveLength(1);
    expect(s.rows().map((row) => row.name)).toEqual(['SXT-003_01_pic01.jpg', 'SXT-003_02_clip01.mov', 'SXT-003_03_pic02.jpg']);
    expect(snapshot).toMatchObject({ state: 'complete', confirmed: 3, order: { kind: 'ok', checked: 3 } });
  });

  it('a medium Fansly already had keeps its old name: the one new row of the set that names no file is the file, renamed', async () => {
    const s = stand({ kept: { 'SXT-003_02_pic02.jpg': 'IMG_0191.jpeg' } });
    const snapshot = await run(set('SXT-003_01_pic01.jpg', 'SXT-003_02_pic02.jpg', 'SXT-003_03_pic03.jpg'), s);
    expect(s.asked.renamed).toEqual(['SXT-003_02_pic02.jpg']);
    expect(s.rows().map((row) => row.name)).toEqual(['SXT-003_01_pic01.jpg', 'SXT-003_02_pic02.jpg', 'SXT-003_03_pic03.jpg']);
    expect(snapshot.state).toBe('complete');
  });

  it('two such rows cannot be told apart: those files go again one at a time — the same bytes move their row up — and are renamed', async () => {
    const s = stand({ kept: { 'SXT-003_01_pic01.jpg': 'IMG_0001.jpeg', 'SXT-003_03_pic03.jpg': 'IMG_0003.jpeg' } });
    const snapshot = await run(set('SXT-003_01_pic01.jpg', 'SXT-003_02_pic02.jpg', 'SXT-003_03_pic03.jpg'), s);
    expect(s.asked.batches).toEqual([['SXT-003_03_pic03.jpg', 'SXT-003_02_pic02.jpg', 'SXT-003_01_pic01.jpg'], ['SXT-003_03_pic03.jpg'], ['SXT-003_01_pic01.jpg']]);
    expect([...s.asked.renamed].sort()).toEqual(['SXT-003_01_pic01.jpg', 'SXT-003_03_pic03.jpg']);
    expect(s.rows().map((row) => row.name)).toEqual(['SXT-003_01_pic01.jpg', 'SXT-003_02_pic02.jpg', 'SXT-003_03_pic03.jpg']);
    expect(snapshot.state).toBe('complete');
  });

  it('a file that never lands goes three times, then the run stops with Fansly’s words; the rest stand in the set’s order', async () => {
    const s = stand({ lost: ['SXT-003_02_pic02.jpg'] });
    const snapshot = await run(set('SXT-003_01_pic01.jpg', 'SXT-003_02_pic02.jpg', 'SXT-003_03_pic03.jpg'), s);
    expect(s.asked.batches.filter((batch) => batch.includes('SXT-003_02_pic02.jpg'))).toHaveLength(3);
    expect(s.rows().map((row) => row.name)).toEqual(['SXT-003_01_pic01.jpg', 'SXT-003_03_pic03.jpg']);
    expect(snapshot.stop).toEqual({ kind: 'uploader-error', said: 'Upload failed. Retry' });
    expect(snapshot.items.find((item) => item.name === 'SXT-003_02_pic02.jpg')?.status).toBe('failed');
  });

  it('a file the album already names is not uploaded again, and takes its place in the order', async () => {
    const s = stand({}, ['SXT-003_02_pic02.jpg']);
    const snapshot = await run(set('SXT-003_01_pic01.jpg', 'SXT-003_02_pic02.jpg', 'SXT-003_03_pic03.jpg'), s);
    expect(s.asked.batches).toEqual([['SXT-003_03_pic03.jpg', 'SXT-003_01_pic01.jpg']]);
    expect(s.rows().map((row) => row.name)).toEqual(['SXT-003_01_pic01.jpg', 'SXT-003_02_pic02.jpg', 'SXT-003_03_pic03.jpg']);
    expect(snapshot.items.find((item) => item.name === 'SXT-003_02_pic02.jpg')?.status).toBe('present');
  });

  it('an album Fansly does not answer stops the run before anything is handed over', async () => {
    const s = stand({ down: true });
    const snapshot = await run(set('SXT-003_01_pic01.jpg'), s);
    expect(s.asked.batches).toHaveLength(0);
    expect(snapshot.stop).toEqual({ kind: 'album-api', said: 'CG-FAN-NETWORK' });
  });
});
