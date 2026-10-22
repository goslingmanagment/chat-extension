// Newcomers: the list of new subscribers, then the card with its greeting in the field (the palette row is «Новые»).

import { STAND_IDS } from '../../support/stand';
import { scenario, STAND_PAGE } from '../kit';

scenario(
  'newcomers',
  async (s) => {
    await s.ready();
    await s.leaveField();
    await s.keys(s.MOD, 'k');
    await s.press(/^Новые/, 'modal', '.cg-pal__item');
    await s.see('modal', 'newfan_');
    await s.shot('newcomers');
    await s.h.ours('modal', '.cg-nw__side [data-cg-key]').click();
    await s.browser.waitUntil(() => s.has('modal', '.cg-nc__greet'), { timeout: 10_000, timeoutMsg: 'the card did not open' });
    await s.press(/^Сгенерировать/, 'modal', '.cg-nc__gbar button');
    // The greeting lands in the card's field.
    await s.browser.waitUntil(async () => ((await s.h.readOurs('modal', '.cg-nc__field textarea', (node) => (node as HTMLTextAreaElement).value)) ?? '') !== '', {
      timeout: 30_000,
      timeoutMsg: 'the greeting did not land in the field',
    });
    await s.shot('newcomer-hi');
    // A batch: pick the fans, one click generates for all, each draft is read under its fan and sent from its row.
    await s.press(/^Выбрать \d+/, 'modal', '.cg-nw__tools button');
    await s.press(/^Сгенерировать \d+/, 'modal', '.cg-nw__batch button');
    await s.browser.waitUntil(() => s.has('modal', '.cg-nw__rsend'), { timeout: 30_000, timeoutMsg: 'no draft row with its «Отправить»' });
    await s.see('modal', 'Готово', 30_000);
    await s.shot('newcomers-batch');
  },
  {
    previewSend: true,
    before: async ({ hub, stand }) => {
      const { a5, a6, a7 } = STAND_IDS.fans;
      await stand.traffic({ firstSummaryMs: 150 });
      await hub.command({ op: 'audienceEvent', pageLabel: STAND_PAGE, fanRef: a5 });
      await hub.command({ op: 'audienceEvent', pageLabel: STAND_PAGE, fanRef: a6, kind: 'returning' });
      await hub.command({ op: 'audienceEvent', pageLabel: STAND_PAGE, fanRef: a7 });
      await hub.command({ op: 'desktopGreeting', pageLabel: STAND_PAGE, fanRef: a7 });
    },
  },
);
