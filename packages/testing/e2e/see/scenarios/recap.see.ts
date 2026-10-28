// Recap (2026-10-28, the owner's «Досье во весь экран»): the bar's button opens the window at once, on the choice of the
// two; the full Recap is built there, its sections coming as they are written; «Сводка», the board, and a tile that
// opens its section in «Досье»; a section by its number; «Коротко» and
// its own build; «Свернуть» folds the window into the cheat sheet over the bar and «Открыть Recap» unfolds it. On Fansly
// the fan writes after the Recap: the window asks for «Обновить», and the new one is built under a ribbon while the old
// one stays readable. `--showcase` gives a full Recap in the hub's format (the fan Jamie); the plain world, the mockup's.

import { WORLD } from '../../../src/scenarios/hub';
import { fakeFansly } from '../../support/fansly-stand';
import { scenario } from '../kit';

scenario(
  'recap',
  async (s) => {
    await s.ready();
    await s.press(/^Recap/);
    await s.see('modal', /Собрать полностью/);
    await s.shot('recap-choice');

    // Written slowly enough to see the sections arrive.
    await s.hub.command({ op: 'config', patch: { aiChunkDelayMs: 60 } });
    await s.press(/^Собрать полностью/, 'modal', '.cg-xdlg button');
    // Three sections came, «Как общается» is being written.
    await s.see('modal', s.showcase ? /Пишет: Как общается/ : /Пишет: What he answers to/, 30_000);
    await s.shot('recap-writing');
    await s.see('modal', /Конец Recap/, 90_000);
    await s.hub.command({ op: 'config', patch: { aiChunkDelayMs: 0 } });
    // «Recap готов» shows for a moment over the new Recap, then the window reads as it stays.
    await browser.pause(3000);
    await s.shot('recap-window');

    // «Сводка», the board view: a tile opens its section in «Досье».
    await s.press(/^Сводка$/, 'modal', '.cg-rx-views button');
    await s.see('modal', s.showcase ? /Что делать сейчас/ : /What he bought/);
    await browser.pause(900);
    await s.shot('recap-board');
    await s.press(s.showcase ? /^Деньги/ : /^What he bought/, 'modal', '.cg-rx-board button');
    await s.see('modal', /Конец Recap/);
    await s.shot('recap-from-board');
    await s.press(/^Досье$/, 'modal', '.cg-rx-views button');

    // A section by its number: «Стадия и траектория» (the plain world's Recap has four).
    await s.keys(s.showcase ? '3' : '2');
    await s.shot('recap-section');

    await s.press(/^Коротко$/, 'modal', '.cg-xdlg button');
    await s.see('modal', /Собрать коротко/);
    await s.shot('recap-short-choice');
    await s.press(/^Собрать коротко/, 'modal', '.cg-xdlg button');
    await s.see('modal', /Конец Recap/, 30_000);
    await s.shot('recap-short');
    await s.press(/^Сводка$/, 'modal', '.cg-rx-views button');
    await browser.pause(900);
    await s.shot('recap-short-board');
    await s.press(/^Досье$/, 'modal', '.cg-rx-views button');
    await s.press(/^Полностью$/, 'modal', '.cg-xdlg button');
    await s.see('modal', /Конец Recap/);

    await s.press(/^Свернуть/, 'modal', '.cg-xdlg button');
    await s.see('dock', /Открыть Recap/);
    await s.shot('recap-crib');
    await s.press(/^Открыть Recap/, 'dock', '.cg-dock button');
    await s.see('modal', /Конец Recap/);

    if (s.site === 'fansly') {
      await fakeFansly().command({ op: 'message', groupId: WORLD.fansly.chats.a.group, text: 'just landed, so tired 😴' });
      await s.see('modal', /После Recap/, 20_000);
      await s.shot('recap-new-after');
      await s.hub.command({ op: 'config', patch: { aiChunkDelayMs: 40 } });
      await s.press(/^Обновить/, 'modal', '.cg-xdlg .cg-rx-fresh button');
      await s.see('modal', /Собираю новый Recap/, 10_000);
      await s.see('modal', s.showcase ? /Пишет: Деньги/ : /Пишет: What to avoid/, 30_000);
      await s.shot('recap-rebuild');
      await s.see('modal', /Готово: Recap обновлён/, 90_000);
      await s.hub.command({ op: 'config', patch: { aiChunkDelayMs: 0 } });
      await s.shot('recap-rebuilt');
    }
  },
  { sites: ['fansly', 'chatspace'], timeout: 300_000 },
);
