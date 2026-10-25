// What a Recap is used by, and the ticks that leave it out, seen through: the dock's Recap sheet with nothing built
// (which one, who uses it), Coach without a Recap and its answer «без Recap», «Собрать Recap ▾» from Coach and its menu
// (the full or the short one), the line while the full one is built, «Обновить Recap ▾» with each one's age, the next
// answer «с Recap», «Учитывать Recap» unticked and the answer «без Recap — выключен», a Reply whose head still shows
// «с Recap» ticked (each feature has its own), the head's tick pressed and the Reply made again without it, and the
// Recap saying who reads it in this chat now.

import { scenario } from '../kit';

const FIELD = '.cg-co__ask textarea, .cg-co__ask input';

scenario(
  'coach-recap',
  async (s) => {
    await s.ready();
    await s.press(/^Recap/);
    await s.see('dock', 'учитывают Reply, Fix, Ping и Coach');
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

    // «Собрать Recap ▾» asks which one: the full or the short, what each reads and who uses it.
    await s.press(/^Собрать Recap/, 'panel', '.cg-co__recap-btn');
    await s.see('panel', 'Нужен только Coach');
    await s.shot('coach-recap-menu');
    // The stand's build is near instant: slowed down for the picture of the line while it runs.
    await s.hub.command({ op: 'config', patch: { aiChunkDelayMs: 300 } });
    await s.press(/^Полный/, 'panel', '.cg-co__recap .cg-menu__item');
    await s.see('panel', 'Собираю полный Recap');
    await s.shot('coach-recap-building');
    await s.hub.command({ op: 'config', patch: { aiChunkDelayMs: 0 } });
    await s.see('panel', 'Учитывать Recap', 40_000);
    await s.shot('coach-uses-recap');
    await s.press(/назад/, 'panel', '.cg-co__recap summary');
    await s.wait(300);
    await s.shot('recap-open');
    await s.press(/назад/, 'panel', '.cg-co__recap summary');
    // With one saved, «Обновить Recap ▾» says how old each is.
    await s.press(/^Обновить Recap/, 'panel', '.cg-co__recap-btn');
    await s.see('panel', 'ещё не собран');
    await s.shot('coach-recap-menu-refresh');
    await s.keys(s.Key.Escape);

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
    await s.see('panel', 'без Recap: выключен', 30_000);
    await s.shot('answer-recap-off');
    await s.closeAll();

    // The full Recap reaches Reply once the hub holds it as the fan's dossier (its save follows the build). Coach's tick
    // is Coach's own: Reply still reads the Recap, and its head says so with its tick ticked.
    await s.wait(6_000);
    await s.press(/^Reply/);
    await s.done();
    const pressed = async (): Promise<string | null> => (await s.h.readOurs('dock', '.cg-head__recap .cg-check', (tick) => tick.getAttribute('aria-pressed'))) ?? null;
    await s.browser.waitUntil(async () => (await pressed()) === 'true', { timeout: 10_000, timeoutMsg: 'the head never showed «с Recap» ticked' });
    await s.see('dock', 'с Recap ·', 15_000);
    await s.shot('reply-with-recap');
    // Unticked in the head, the answer is made again without the Recap.
    await s.press(/с Recap/, 'dock', '.cg-head__recap .cg-check');
    await s.done();
    await s.browser.waitUntil(async () => (await pressed()) === 'false', { timeout: 15_000, timeoutMsg: 'the head never showed «с Recap» unticked' });
    await s.shot('reply-recap-off');
    // Reply and Coach unticked in this chat: Fix and Ping still read the Recap, and the Recap says so.
    await s.press(/^Recap/);
    await s.see('modal', 'учитывают только Fix и Ping', 10_000);
    await s.shot('recap-used-by');
  },
  { sites: ['chatspace', 'fansly'] },
);
