// Coach and its Recap: none, the «Recap ▾» menu with the auto choice, the auto line, a full Recap built from the menu.

import { scenario } from '../kit';

const FIELD = '.cg-co__ask textarea, .cg-co__ask input';

scenario(
  'coach-recap',
  async (s) => {
    await s.ready();
    await s.press(/^Coach/);
    await s.browser.waitUntil(() => s.has('panel', FIELD), { timeout: 10_000, timeoutMsg: 'the Coach window did not open' });
    await s.see('panel', 'нет');
    await s.shot('coach-no-recap');
    await s.press(/^Recap/, 'panel', '.cg-co__menu');
    await s.wait(300);
    await s.shot('recap-menu');
    await s.press(/^Полный/, 'panel', '.cg-menu__item');
    await s.see('panel', 'Перед первым ответом');
    await s.shot('auto-full');
    await s.press(/^Recap/, 'panel', '.cg-co__menu');
    await s.press(/^Собрать полностью/, 'panel', '.cg-menu__item');
    await s.see('panel', 'полный ·', 40_000);
    await s.shot('recap-built');
    await s.press(/Recap/, 'panel', '.cg-co__recap summary');
    await s.wait(300);
    await s.shot('recap-open');
  },
  { sites: ['chatspace', 'fansly'] },
);
