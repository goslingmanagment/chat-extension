// The upload of a set: six files go to the page at once, two of them come back under the names Fansly kept for media it
// already had (IMG_*). The run finds them by the album's rows, renames them, lays the album out by one request, and the
// album, opened again, reads SET_01 → SET_06.
import { browser } from '@wdio/globals';

import { fakeFansly, openFanslyStand } from '../../support/fansly-stand';
import { ours } from '../../support/ours';
import { around, scenario } from '../kit';

const NAMES = ['SET_01.jpg', 'SET_02.jpg', 'SET_03.mov', 'SET_04.jpg', 'SET_05.jpg', 'SET_06.mov'];

scenario('fansly-vault-bulk', async (s) => {
  await s.ready();
  await fakeFansly().command({ op: 'vault-filenames', filenames: { 'SET_02.jpg': 'IMG_1002.jpeg', 'SET_05.jpg': 'IMG_1005.jpeg' } });
  await openFanslyStand('/creator/vault');
  await browser.$('.vault-album').waitForExist({ timeout: 15_000 });
  await browser.$('.vault-album').click();
  await browser.$('app-media-vault .close-toggle').waitForExist();
  await browser.$('app-media-vault .close-toggle').click();
  await s.press(/Загрузка$/, 'panel');
  const input = await ours('panel', '[data-cg-vault-input="files"]');
  await browser.execute(
    (node: HTMLInputElement, names: string[]) => {
      const files = new DataTransfer();
      for (const name of names) files.items.add(new File([`synthetic ${name}`], name, { type: name.endsWith('.mov') ? 'video/quicktime' : 'image/jpeg' }));
      node.files = files.files;
      node.dispatchEvent(new Event('change', { bubbles: true }));
    },
    input as unknown as HTMLInputElement,
    NAMES,
  );
  await s.press(/Начать$/, 'panel');
  await s.see('panel', 'Готово: все файлы в альбоме.', 60_000);
  const box = await s.rect('panel', '.cg-vault__card');
  await s.shot('vault-bulk-complete', box === null ? {} : { clip: around([box]) });
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
