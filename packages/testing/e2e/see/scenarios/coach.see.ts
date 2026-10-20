// Coach: the empty window, then an answer with a draft.

import { scenario } from '../kit';

const FIELD = '.cg-co__ask textarea, .cg-co__ask input';

scenario(
  'coach',
  async (s) => {
    await s.ready();
    await s.press(/^Coach/);
    await s.browser.waitUntil(() => s.has('panel', FIELD), { timeout: 10_000, timeoutMsg: 'the Coach window did not open' });
    await s.shot('coach');
    await s.h.ours('panel', FIELD).click();
    await s.keys('Стоит ли сейчас предлагать ему новый сет?');
    await s.keys(s.Key.Enter);
    await s.see('panel', 'Сегодня можно, но не первым сообщением', 30_000);
    await s.shot('coach-answer');
  },
  { sites: ['chatspace', 'fansly'] },
);
