// What a Recap is used by, seen through: the dock's Recap sheet with nothing built (which one, who uses it), Coach
// without a Recap and its answer «без Recap», «Собрать Recap» from Coach, the next answer «с Recap», a Reply «с Recap».

import { scenario } from '../kit';

const FIELD = '.cg-co__ask textarea, .cg-co__ask input';

scenario(
  'coach-recap',
  async (s) => {
    await s.ready();
    await s.press(/^Recap/);
    await s.see('dock', 'учитывают Reply, Ping и Coach');
    await s.shot('recap-picker');
    await s.closeAll();

    await s.press(/^Coach/);
    await s.browser.waitUntil(() => s.has('panel', FIELD), { timeout: 10_000, timeoutMsg: 'the Coach window did not open' });
    await s.see('panel', 'Recap нет');
    await s.shot('coach-no-recap');
    await s.h.ours('panel', FIELD).click();
    await s.keys('Is now a good time to offer him the new set?');
    await s.keys(s.Key.Enter);
    await s.see('panel', 'без Recap', 30_000);
    await s.shot('answer-without-recap');

    await s.press(/^Собрать Recap/, 'panel', '.cg-co__recap-btn');
    await s.see('panel', 'Coach учитывает Recap', 40_000);
    await s.shot('coach-uses-recap');
    await s.press(/учитывает/, 'panel', '.cg-co__recap summary');
    await s.wait(300);
    await s.shot('recap-open');
    await s.press(/учитывает/, 'panel', '.cg-co__recap summary');

    await s.h.ours('panel', FIELD).click();
    await s.keys('And what if he says no?');
    await s.keys(s.Key.Enter);
    await s.see('panel', 'с Recap ·', 30_000);
    await s.shot('answer-with-recap');
    await s.closeAll();

    // The full Recap reaches Reply once the hub holds it as the fan's dossier (its save follows the build).
    await s.wait(6_000);
    await s.press(/^Reply/);
    await s.done();
    await s.see('dock', 'с Recap', 10_000);
    await s.shot('reply-with-recap');
    await s.press(/^Recap/);
    await s.see('modal', 'учитывают Reply, Ping и Coach', 10_000);
    await s.shot('recap-used-by');
  },
  { sites: ['chatspace', 'fansly'] },
);
