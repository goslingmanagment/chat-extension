// What a Recap is used by, and the tick that leaves it out, seen through: the dock's Recap sheet with nothing built
// (which one, who uses it), Coach without a Recap and its answer «без Recap», «Собрать Recap» from Coach, the next
// answer «с Recap», «Учитывать Recap» unticked and the answer «без Recap — выключен», a Reply «Recap выключен» under
// the bar's unticked «с Recap», the tick again and a Reply «с Recap».

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
    await s.see('panel', 'Учитывать Recap', 40_000);
    await s.shot('coach-uses-recap');
    await s.press(/назад/, 'panel', '.cg-co__recap summary');
    await s.wait(300);
    await s.shot('recap-open');
    await s.press(/назад/, 'panel', '.cg-co__recap summary');

    await s.h.ours('panel', FIELD).click();
    await s.keys('And what if he says no?');
    await s.keys(s.Key.Enter);
    await s.see('panel', 'с Recap ·', 30_000);
    await s.shot('answer-with-recap');

    // Unticked, the next question goes without the Recap, and its answer says why.
    await s.press(/Учитывать Recap/, 'panel', '.cg-co__recap .cg-check');
    await s.h.ours('panel', FIELD).click();
    await s.keys('Should I wait a day before the offer?');
    await s.keys(s.Key.Enter);
    await s.see('panel', 'без Recap — выключен', 30_000);
    await s.shot('answer-recap-off');
    await s.closeAll();

    // The full Recap reaches Reply once the hub holds it as the fan's dossier (its save follows the build); the
    // tick is the bar's «с Recap» too, still unticked.
    await s.wait(6_000);
    await s.press(/^Reply/);
    await s.done();
    await s.see('dock', 'Recap выключен', 10_000);
    await s.shot('reply-recap-off');
    await s.press(/с Recap/, 'dock', '.cg-recap-tick');
    await s.press(/^Reply/);
    await s.done();
    await s.see('dock', 'с Recap ·', 10_000);
    await s.shot('reply-with-recap');
    await s.press(/^Recap/);
    await s.see('modal', 'учитывают Reply, Ping и Coach', 10_000);
    await s.shot('recap-used-by');
  },
  { sites: ['chatspace', 'fansly'] },
);
