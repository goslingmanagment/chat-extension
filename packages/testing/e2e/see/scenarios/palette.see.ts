// The palette (⌘K), a search in it, and the cheatsheet (?).

import { scenario } from '../kit';

scenario('palette', async (s) => {
  await s.ready();
  await s.leaveField();
  await s.keys(s.MOD, 'k');
  await s.browser.waitUntil(() => s.has('modal', '.cg-pal__item'), { timeout: 10_000, timeoutMsg: 'the palette did not open' });
  await s.shot('palette');
  await s.keys('juni');
  await s.see('modal', 'Fan Juniper');
  await s.shot('palette-search');
  await s.closeAll();
  await s.leaveField();
  await s.keys('?');
  await s.see('modal', 'Клавиши ChatGoose');
  await s.shot('cheatsheet');
});
