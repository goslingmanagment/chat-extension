// «Отправить всем» of «Новые» (the owner, 2026-10-27): a batch of Hi made for the picked fans, then one click sends the
// ready greetings one by one, a second apart, with how far it got and «Остановить отправку»; then what went.

import { STAND_IDS } from '../../support/stand';
import { scenario, STAND_PAGE } from '../kit';

scenario(
  'newcomers-send-all',
  async (s) => {
    await s.ready();
    await s.leaveField();
    await s.keys(s.MOD, 'k');
    await s.press(/^Новые/, 'modal', '.cg-pal__item');
    await s.browser.waitUntil(() => s.has('modal', '.cg-nw__row'), { timeout: 15_000, timeoutMsg: 'no row of «Новые»' });
    await s.press(/^Выбрать \d+/, 'modal', '.cg-nw__tools button');
    await s.press(/^Сгенерировать \d+/, 'modal', '.cg-nw__batch button');
    await s.browser.waitUntil(() => s.has('modal', '.cg-nw__sendall'), { timeout: 40_000, timeoutMsg: 'no «Отправить всем»' });
    await s.shot('send-all-ready');
    await s.press(/^Отправить всем/, 'modal', '.cg-nw__batch button');
    await s.browser.waitUntil(() => s.has('modal', '[data-cg-send="running"]'), { timeout: 5_000, timeoutMsg: 'the run did not start' });
    await s.shot('send-all-running');
    await s.browser.waitUntil(() => s.has('modal', '[data-cg-send="done"]'), { timeout: 60_000, timeoutMsg: 'the run did not end' });
    await s.shot('send-all-done');
  },
  {
    previewSend: true,
    before: async ({ hub, stand }) => {
      const { a5, a6, a7 } = STAND_IDS.fans;
      await stand.traffic({ firstSummaryMs: 150 });
      await hub.command({ op: 'audienceEvent', pageLabel: STAND_PAGE, fanRef: a5 });
      await hub.command({ op: 'audienceEvent', pageLabel: STAND_PAGE, fanRef: a6 });
      await hub.command({ op: 'audienceEvent', pageLabel: STAND_PAGE, fanRef: a7 });
    },
  },
);
