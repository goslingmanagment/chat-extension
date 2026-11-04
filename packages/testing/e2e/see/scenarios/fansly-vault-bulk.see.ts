// Without the model's proxy the panel does not start (the stand's tab is in no container, its profile gave Firefox's
// router no grant): it says what to do. Then the stand stands for a model's container with its proxy, and the upload of
// a set: six files go to the page at once, two of them come back under the names Fansly kept for media it
// already had (IMG_*). The run knows each file by its upload's answer, renames those two, lays the album out by one
// request. Then a second set into the same album (2026-11-04): five files are there already — the photos by their name
// and picture, the videos by Fansly's answer with their old medium —, one photo of the same name is another picture and
// goes up beside its old card, one is new. The summary names them; the album, opened again, reads the set.
import { browser } from '@wdio/globals';

import { STAND_VAULT_ROUTE_KEY } from '../../support/constants';
import { writeLocalStorage } from '../../support/extension';
import { fakeFansly, openFanslyStand } from '../../support/fansly-stand';
import { ours } from '../../support/ours';
import { around, scenario } from '../kit';

/** A file of the set: a photo is a real JPEG of its size and colour (the page measures it, our panel reads it); a video — synthetic bytes. */
interface Spec {
  readonly name: string;
  readonly width?: number;
  readonly height?: number;
  readonly color?: string;
}

const FIRST: readonly Spec[] = [
  { name: 'SET_01.jpg', width: 120, height: 160, color: '#d8a48f' },
  { name: 'SET_02.jpg', width: 160, height: 120, color: '#8fb3d8' },
  { name: 'SET_03.mov' },
  { name: 'SET_04.jpg', width: 120, height: 150, color: '#b8d88f' },
  { name: 'SET_05.jpg', width: 150, height: 120, color: '#d88fc4' },
  { name: 'SET_06.mov' },
];
/** The same set again: SET_04 another picture of the same name, SET_07 new. */
const SECOND: readonly Spec[] = [...FIRST.map((spec) => (spec.name === 'SET_04.jpg' ? { name: 'SET_04.jpg', width: 240, height: 300, color: '#4f7a2a' } : spec)), { name: 'SET_07.jpg', width: 140, height: 140, color: '#d8c98f' }];

async function pick(specs: readonly Spec[]): Promise<void> {
  const input = await ours('panel', '[data-cg-vault-input="files"]');
  await browser.execute(
    async (node: HTMLInputElement, files: Spec[]) => {
      const list = new DataTransfer();
      for (const spec of files) {
        let bytes: Blob;
        if (spec.width !== undefined && spec.height !== undefined) {
          const canvas = new OffscreenCanvas(spec.width, spec.height);
          const context = canvas.getContext('2d');
          if (context !== null) {
            context.fillStyle = spec.color ?? '#999';
            context.fillRect(0, 0, spec.width, spec.height);
          }
          bytes = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
        } else bytes = new Blob([`synthetic ${spec.name}`]);
        list.items.add(new File([bytes], spec.name, { type: spec.name.endsWith('.mov') ? 'video/quicktime' : 'image/jpeg', lastModified: 1_762_200_000_000 }));
      }
      node.files = list.files;
      node.dispatchEvent(new Event('change', { bubbles: true }));
    },
    input as unknown as HTMLInputElement,
    [...specs],
  );
}

scenario('fansly-vault-bulk', async (s) => {
  await s.ready();
  await fakeFansly().command({ op: 'vault-filenames', filenames: { 'SET_02.jpg': 'IMG_1002.jpeg', 'SET_05.jpg': 'IMG_1005.jpeg' } });
  await openFanslyStand('/creator/vault');
  await browser.$('.vault-album').waitForExist({ timeout: 15_000 });
  await browser.$('.vault-album').click();
  await browser.$('app-media-vault .close-toggle').waitForExist();
  await browser.$('app-media-vault .close-toggle').click();
  await s.press(/Загрузка$/, 'panel');
  /** What the page uploaded since `since` (the stand's journal of its `create`s): the files that went up. */
  const uploads = async (since: number): Promise<string> =>
    `${(await fakeFansly().calls('page', since)).filter((entry) => entry.route === 'media.uploadCreate').length} upload(s)`;
  const first = await fakeFansly().mark();
  await pick(FIRST);
  await s.see('panel', 'только через прокси модели', 15_000);
  const refused = await s.rect('panel', '.cg-vault__card');
  await s.shot('vault-proxy-refused', refused === null ? {} : { clip: around([refused]) });
  // The stand's tab as a model's container with its proxy; back on the panel, it reads the route again.
  await s.toPages();
  await writeLocalStorage({ [STAND_VAULT_ROUTE_KEY]: 'ok' });
  await s.toChat();
  await (await ours('panel', '.cg-vault__card')).moveTo();
  await s.see('panel', 'Начать', 15_000);
  await s.press(/Начать$/, 'panel');
  await s.see('panel', 'Готово: все файлы в альбоме.', 60_000);
  const box = await s.rect('panel', '.cg-vault__card');
  await s.shot('vault-bulk-complete', box === null ? {} : { clip: around([box]) });
  console.log(`the first set: ${await uploads(first)}`);

  // The same set again, one photo another picture, one more file.
  const second = await fakeFansly().mark();
  await pick(SECOND);
  await s.press(/Начать$/, 'panel');
  await s.see('panel', 'залиты рядом с ней', 90_000);
  // The summary at the panel's foot, scrolled into its view.
  await browser.execute((node: HTMLElement) => node.scrollIntoView({ block: 'end' }), (await ours('panel', '.cg-vault__status')) as unknown as HTMLElement);
  const again = await s.rect('panel', '.cg-vault__card');
  await s.shot('vault-bulk-again', again === null ? {} : { clip: around([again]) });
  // The photos the album has by name and picture never go; the videos the stand cannot read go and come back as theirs.
  console.log(`the second set: ${await uploads(second)}`);

  // The page shows the album as it loaded it: open it again to see the order Fansly holds.
  await s.press(/Свернуть$/, 'panel').catch(() => undefined);
  await browser.execute(() => (document.querySelector('[data-menu-item="vault-album-back"]') as HTMLElement | null)?.click());
  await browser.$('.vault-album').waitForExist();
  await browser.execute(() => (document.querySelector('.vault-album') as HTMLElement | null)?.click());
  await browser.$('.vault-row .image-filename').waitForExist({ timeout: 15_000 });
  const cards = await browser.execute(() => [...document.querySelectorAll('.vault-row .image-filename')].map((node) => node.textContent?.trim() ?? ''));
  console.log(`vault cards top to bottom: ${cards.join(', ')}`);
  await s.shot('vault-bulk-album');
}, { sites: ['fansly'] });
