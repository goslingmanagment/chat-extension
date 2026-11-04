// The upload of a set (bulk.ts) over an album as Fansly keeps it: rows the newest first, a member added again moves up
// with its name, the same bytes are the same medium (under the name it got first), and each upload answers with its
// file's name and size and the medium Fansly made of it. The page and the API are stand-ins; what is checked is what
// the run asks, what the album reads after it, and what the run says of each file.

import { describe, expect, it } from 'vitest';

import { createVaultBulkRun, vaultAnswersOf } from './bulk';
import type { VaultFileContent } from './content';
import { VaultAlbumApiError, type VaultAlbumApi, type VaultAlbumRowRef, type VaultCheckpointStore } from './run';
import type { VaultBatchOutcome, VaultTarget, VaultUploadAnswer, VaultUploader, VaultView } from './upload';

const TARGET: VaultTarget = { hostAccountId: '100000000000000001', albumId: '200000000000000001', title: 'SXT-003' };

/**
 * A file's bytes say its content: `photo:W×H`, `video:W×H:seconds`, `raw:…` (bytes nothing reads). Fansly's word of a
 * medium is read from the same bytes.
 */
function contentOf(bytes: string): VaultFileContent | null {
  const photo = /^photo:(\d+)x(\d+)/.exec(bytes);
  if (photo !== null) return { type: 1, width: Number(photo[1]), height: Number(photo[2]), duration: null };
  const video = /^video:(\d+)x(\d+):([\d.]+)/.exec(bytes);
  if (video !== null) return { type: 2, width: Number(video[1]), height: Number(video[2]), duration: Number(video[3]) };
  return null;
}

interface Behaviour {
  /** Files Fansly already had: their medium keeps this name. */
  readonly kept?: Readonly<Record<string, string>>;
  /** Files that never land: no answer, no row. */
  readonly lost?: readonly string[];
  /** The album fails to answer. */
  readonly down?: boolean;
  /** The album reads empty once the set is laid out. */
  readonly blankAfterLayOut?: boolean;
  /** Fansly's rename answers name no name, and the name does not take. */
  readonly renameUnanswered?: boolean;
  /** Someone else's medium lands in the album while the first set is on its way. */
  readonly stranger?: string;
}

interface Card {
  readonly name: string;
  readonly bytes: string;
}

function stand(behaviour: Behaviour = {}, present: readonly Card[] = []) {
  let next = 300000000000000000n;
  const id = (): string => String((next += 1n));
  /** Media by their bytes: the same bytes are the same medium, under the name they got first. */
  const media = new Map<string, { readonly id: string; readonly name: string; readonly bytes: string }>();
  /** Oldest first. */
  let album: Array<{ row: string; mediaId: string; name: string }> = [];
  const mediumOf = (name: string, bytes: string) => {
    const known = media.get(bytes);
    if (known !== undefined) return known;
    const made = { id: id(), name: behaviour.kept?.[name] ?? name, bytes };
    media.set(bytes, made);
    return made;
  };
  const byId = (mediaId: string) => [...media.values()].find((item) => item.id === mediaId);
  const add = (mediaIds: readonly string[]): void => {
    for (const mediaId of mediaIds) {
      const old = album.find((row) => row.mediaId === mediaId);
      album = album.filter((row) => row.mediaId !== mediaId);
      album.push({ row: id(), mediaId, name: old?.name ?? byId(mediaId)?.name ?? '' });
    }
  };
  for (const card of present) add([mediumOf(card.name, card.bytes).id]);
  const asked = { batches: [] as string[][], arranged: [] as string[][], renamed: [] as string[], sleeps: [] as number[] };
  const rows = (): VaultAlbumRowRef[] =>
    [...album].reverse().map((row) => {
      const bytes = byId(row.mediaId)?.bytes ?? '';
      const content = contentOf(bytes);
      return { ...row, content: content === null ? null : { ...content } };
    });
  const api: VaultAlbumApi = {
    album: async () => {
      if (behaviour.down === true) throw new VaultAlbumApiError('CG-FAN-NETWORK');
      if (behaviour.blankAfterLayOut === true && asked.arranged.length > 0) return [];
      return rows();
    },
    arrange: async (_target, mediaIds) => {
      asked.arranged.push([...mediaIds]);
      add(mediaIds);
    },
    rename: async (_target, mediaId, name) => {
      asked.renamed.push(name);
      if (behaviour.renameUnanswered === true) return null;
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
      if (behaviour.stranger !== undefined && asked.batches.length === 1) add([mediumOf(behaviour.stranger, `stranger:${behaviour.stranger}`).id]);
      // They land in any order: the last one first; each upload answers with its medium.
      const landed = [...files].reverse().filter((file) => !(behaviour.lost ?? []).includes(file.name));
      const uploads: VaultUploadAnswer[] = [];
      for (const file of landed) {
        const medium = mediumOf(file.name, await file.text());
        uploads.push({ name: file.name, size: file.size, mediaId: medium.id });
      }
      add(uploads.map((upload) => upload.mediaId));
      return { state: 'settled', path: 'data-transfer', said: landed.length === files.length ? null : 'Upload failed. Retry', uploads };
    },
    stats: () => ({ watching: false, watches: 0, mutations: 0 }),
    dispose: () => undefined,
  };
  const store: VaultCheckpointStore = { load: async () => null, save: async () => true, clear: async () => true };
  return { api, uploader, store, asked, rows };
}

/** A photo by default, of its own size: two files of other names never share their bytes. */
const file = (name: string, bytes = `photo:${String(1000 + name.length)}x800:${name}`): File => new File([bytes], name, { type: name.endsWith('.mov') ? 'video/quicktime' : 'image/jpeg', lastModified: 1 });
/** The upload order of «first on top»: the last file first. */
const set = (...files: File[]): File[] => [...files].reverse();
const named = (...names: string[]): File[] => set(...names.map((name) => file(name)));

async function run(files: readonly File[], s: ReturnType<typeof stand>) {
  const vault = createVaultBulkRun(
    { target: TARGET, files, checkpoint: null },
    {
      uploader: s.uploader,
      store: s.store,
      api: s.api,
      sleep: async (ms) => {
        s.asked.sleeps.push(ms);
      },
      readContent: async (item) => contentOf(await item.text()),
      newId: () => '00000000-0000-4000-8000-000000000001',
    },
  );
  await vault.start();
  return vault.snapshot();
}

const statusOf = (snapshot: Awaited<ReturnType<typeof run>>, name: string) => snapshot.items.find((item) => item.name === name)?.status;

describe('the upload of a set', () => {
  it('hands the set at once; whatever order it landed in, one request lays the album out in the set’s order', async () => {
    const s = stand();
    const snapshot = await run(named('SXT-003_01_pic01.jpg', 'SXT-003_02_clip01.mov', 'SXT-003_03_pic02.jpg'), s);
    expect(s.asked.batches).toHaveLength(1);
    expect(s.asked.arranged).toHaveLength(1);
    expect(s.rows().map((row) => row.name)).toEqual(['SXT-003_01_pic01.jpg', 'SXT-003_02_clip01.mov', 'SXT-003_03_pic02.jpg']);
    expect(snapshot).toMatchObject({ state: 'complete', confirmed: 3, order: { kind: 'ok', checked: 3 }, beside: [] });
  });

  it('a medium Fansly already had keeps its old name: the file is its upload’s medium, renamed to the file', async () => {
    const s = stand({ kept: { 'SXT-003_02_pic02.jpg': 'IMG_0191.jpeg', 'SXT-003_03_pic03.jpg': 'IMG_0192.jpeg' } });
    const snapshot = await run(named('SXT-003_01_pic01.jpg', 'SXT-003_02_pic02.jpg', 'SXT-003_03_pic03.jpg'), s);
    // Two such media in one set: told apart by the uploads' answers, nothing goes twice.
    expect(s.asked.batches).toHaveLength(1);
    expect([...s.asked.renamed].sort()).toEqual(['SXT-003_02_pic02.jpg', 'SXT-003_03_pic03.jpg']);
    expect(s.rows().map((row) => row.name)).toEqual(['SXT-003_01_pic01.jpg', 'SXT-003_02_pic02.jpg', 'SXT-003_03_pic03.jpg']);
    expect(snapshot.state).toBe('complete');
  });

  it('a stranger’s new row is nobody’s: the file with no answer goes again, the row is never renamed', async () => {
    const s = stand({ stranger: 'OTHER_01.jpg', lost: ['SXT-003_02_pic02.jpg'] });
    const snapshot = await run(named('SXT-003_01_pic01.jpg', 'SXT-003_02_pic02.jpg'), s);
    expect(s.asked.renamed).toEqual([]);
    expect(s.asked.batches.filter((batch) => batch.includes('SXT-003_02_pic02.jpg'))).toHaveLength(3);
    expect(statusOf(snapshot, 'SXT-003_02_pic02.jpg')).toBe('failed');
    expect(s.rows().map((row) => row.name)).toContain('OTHER_01.jpg');
  });

  it('a file that never lands goes three times, after a pause each time, then the run stops with Fansly’s words', async () => {
    const s = stand({ lost: ['SXT-003_02_pic02.jpg'] });
    const snapshot = await run(named('SXT-003_01_pic01.jpg', 'SXT-003_02_pic02.jpg', 'SXT-003_03_pic03.jpg'), s);
    expect(s.asked.batches.filter((batch) => batch.includes('SXT-003_02_pic02.jpg'))).toHaveLength(3);
    // 10 s before the second try, 30 s before the third, slept in steps a Pause can cut.
    expect(s.asked.sleeps.reduce((sum, ms) => sum + ms, 0)).toBe(40_000);
    expect(s.rows().map((row) => row.name)).toEqual(['SXT-003_01_pic01.jpg', 'SXT-003_03_pic03.jpg']);
    expect(snapshot.stop).toEqual({ kind: 'uploader-error', said: 'Upload failed. Retry' });
    expect(statusOf(snapshot, 'SXT-003_02_pic02.jpg')).toBe('failed');
  });

  it('a card of the same name and the same content is in the album: not uploaded again, and named as such', async () => {
    const s = stand({}, [{ name: 'SXT-003_02_pic02.jpeg', bytes: 'photo:4032x3024:old' }]);
    // The same picture, its orientation turned: the same content.
    const snapshot = await run(set(file('SXT-003_01_pic01.jpg'), file('SXT-003_02_pic02.jpg', 'photo:3024x4032:old'), file('SXT-003_03_pic03.jpg')), s);
    expect(s.asked.batches).toEqual([['SXT-003_03_pic03.jpg', 'SXT-003_01_pic01.jpg']]);
    expect(statusOf(snapshot, 'SXT-003_02_pic02.jpg')).toBe('present');
    expect(s.rows().map((row) => row.name)).toEqual(['SXT-003_01_pic01.jpg', 'SXT-003_02_pic02.jpeg', 'SXT-003_03_pic03.jpg']);
    expect(snapshot.state).toBe('complete');
  });

  it('a card of the same name with other content: the file goes up beside it, and the run says so', async () => {
    const s = stand({}, [{ name: 'SXT-003_02_pic02.jpeg', bytes: 'photo:1080x1350:retouched-before' }]);
    const snapshot = await run(set(file('SXT-003_01_pic01.jpg'), file('SXT-003_02_pic02.jpg', 'photo:2160x2700:new'), file('SXT-003_03_pic03.jpg')), s);
    expect(s.asked.batches).toEqual([['SXT-003_03_pic03.jpg', 'SXT-003_02_pic02.jpg', 'SXT-003_01_pic01.jpg']]);
    expect(statusOf(snapshot, 'SXT-003_02_pic02.jpg')).toBe('verified');
    expect(snapshot.beside).toEqual(['SXT-003_02_pic02.jpg']);
    // The set on top, the old card of that name below it: nothing of the album is lost.
    expect(s.rows().map((row) => row.name)).toEqual(['SXT-003_01_pic01.jpg', 'SXT-003_02_pic02.jpg', 'SXT-003_03_pic03.jpg', 'SXT-003_02_pic02.jpeg']);
    expect(snapshot.state).toBe('complete');
  });

  it('a video of the same name, size and length within half a second is the same; a longer one is not', async () => {
    const s = stand({}, [
      { name: 'clip01.mp4', bytes: 'video:1080x1920:140.076667' },
      { name: 'clip02.mp4', bytes: 'video:1080x1920:31.2' },
    ]);
    const snapshot = await run(set(file('clip01.mov', 'video:1920x1080:140.1'), file('clip02.mov', 'video:1920x1080:33.9')), s);
    expect(statusOf(snapshot, 'clip01.mov')).toBe('present');
    expect(statusOf(snapshot, 'clip02.mov')).toBe('verified');
    expect(snapshot.beside).toEqual(['clip02.mov']);
  });

  it('a same-named card whose content cannot be told: the file goes up, and Fansly’s answer with that card’s medium says it was there', async () => {
    const s = stand({}, [{ name: 'SXT-003_01_pic01.jpeg', bytes: 'raw:one' }]);
    const snapshot = await run(set(file('SXT-003_01_pic01.jpg', 'raw:one'), file('SXT-003_02_pic02.jpg', 'raw:two')), s);
    expect(s.asked.batches).toEqual([['SXT-003_02_pic02.jpg', 'SXT-003_01_pic01.jpg']]);
    expect(statusOf(snapshot, 'SXT-003_01_pic01.jpg')).toBe('present');
    expect(snapshot.beside).toEqual([]);
    expect(snapshot.state).toBe('complete');
  });

  it('a Live Photo’s photo and video of one name go as two files and stand as two cards', async () => {
    const s = stand();
    const snapshot = await run(set(file('IMG_1.JPG', 'photo:3024x4032:live'), file('IMG_1.MOV', 'video:1920x1080:2.8'), file('IMG_2.JPG')), s);
    expect(s.asked.batches).toHaveLength(1);
    expect(s.rows().map((row) => row.name)).toEqual(['IMG_1.JPG', 'IMG_1.MOV', 'IMG_2.JPG']);
    expect(snapshot).toMatchObject({ state: 'complete', confirmed: 3 });
  });

  it('a rename Fansly’s answer does not confirm is no name taken: the album’s check stops the set', async () => {
    const s = stand({ kept: { 'SXT-003_02_pic02.jpg': 'IMG_0191.jpeg' }, renameUnanswered: true });
    const snapshot = await run(named('SXT-003_01_pic01.jpg', 'SXT-003_02_pic02.jpg'), s);
    expect(snapshot.state).toBe('stopped');
    expect(snapshot.stop).toEqual({ kind: 'order-mismatch', expected: 'SXT-003_02_pic02.jpg', actual: 'IMG_0191.jpeg' });
  });

  it('an album that reads empty after the lay-out is no album checked: the run stops, the set is not complete', async () => {
    const s = stand({ blankAfterLayOut: true });
    const snapshot = await run(named('SXT-003_01_pic01.jpg', 'SXT-003_02_pic02.jpg'), s);
    expect(snapshot.state).toBe('stopped');
    expect(snapshot.stop).toEqual({ kind: 'order-mismatch', expected: 'SXT-003_01_pic01.jpg', actual: null });
  });

  it('an album Fansly does not answer stops the run before anything is handed over', async () => {
    const s = stand({ down: true });
    const snapshot = await run(named('SXT-003_01_pic01.jpg'), s);
    expect(s.asked.batches).toHaveLength(0);
    expect(snapshot.stop).toEqual({ kind: 'album-api', said: 'CG-FAN-NETWORK' });
  });
});

describe('which upload answer is which file’s', () => {
  const answer = (name: string, size: number, mediaId: string): VaultUploadAnswer => ({ name, size, mediaId });

  it('by name and size; a name written otherwise on the way — by its size, when only that file has it', () => {
    const files = [
      { name: 'Фото 01.jpg'.normalize('NFD'), size: 10 },
      { name: 'b.jpg', size: 20 },
      { name: 'c.jpg', size: 30 },
    ];
    const found = vaultAnswersOf(files, [answer('b.jpg', 20, '2'), answer('Фото 01.jpg'.normalize('NFC'), 10, '1'), answer('c (1).jpg', 30, '3')]);
    expect(found.map((item) => item?.mediaId)).toEqual(['1', '2', '3']);
  });

  it('never by size alone when two files share it, and never one answer for two files', () => {
    const files = [
      { name: 'a.jpg', size: 10 },
      { name: 'b.jpg', size: 10 },
    ];
    expect(vaultAnswersOf(files, [answer('x.jpg', 10, '1')]).map((item) => item?.mediaId)).toEqual([undefined, undefined]);
    expect(vaultAnswersOf([{ name: 'a.jpg', size: 10 }, { name: 'a.jpg', size: 10 }], [answer('a.jpg', 10, '1')]).map((item) => item?.mediaId)).toEqual(['1', undefined]);
  });
});
