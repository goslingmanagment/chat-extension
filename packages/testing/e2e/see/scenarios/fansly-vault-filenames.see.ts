// The upload service returns IMG_* instead of the selected File names. The real extension renames the three album
// cards through the page's native modal and finishes the ordered pack without a manual rename or reload.
import { browser } from '@wdio/globals';

import { STAND_VAULT_ROUTE_KEY } from '../../support/constants';
import { writeLocalStorage } from '../../support/extension';
import { fakeFansly, openFanslyStand } from '../../support/fansly-stand';
import { ours } from '../../support/ours';
import { around, scenario } from '../kit';

scenario('fansly-vault-filenames', async (s) => {
  await s.ready();
  // The stand's tab as a model's container with its proxy: the panel starts only then.
  await s.toPages();
  await writeLocalStorage({ [STAND_VAULT_ROUTE_KEY]: 'ok' });
  await s.toChat();
  await fakeFansly().command({ op: 'vault-filenames', filenames: { 'SET_01.jpg': 'IMG_1001.jpeg', 'SET_02.jpg': 'IMG_1002.jpeg', 'SET_03.jpg': 'IMG_1003.jpeg' } });
  await openFanslyStand('/creator/vault');
  await browser.$('.vault-album').waitForExist({ timeout: 15_000 });
  await browser.$('.vault-album').click();
  await browser.$('app-media-vault .close-toggle').waitForExist();
  await browser.$('app-media-vault .close-toggle').click();
  await s.press(/Загрузка$/, 'panel');
  const input = await ours('panel', '[data-cg-vault-input="files"]');
  await browser.execute((node: HTMLInputElement) => {
    const files = new DataTransfer();
    for (const name of ['SET_01.jpg', 'SET_02.jpg', 'SET_03.jpg']) files.items.add(new File([`synthetic ${name}`], name, { type: 'image/jpeg' }));
    node.files = files.files;
    node.dispatchEvent(new Event('change', { bubbles: true }));
  }, input as unknown as HTMLInputElement);
  await s.press(/Начать$/, 'panel');
  await s.see('panel', 'Готово: все файлы в альбоме.', 30_000);
  const box = await s.rect('panel', '.cg-vault__card');
  await s.shot('vault-filenames-complete', box === null ? {} : { clip: around([box]) });
}, { sites: ['fansly'] });
