// «Новые»: the list of new subscribers, then a card with its greeting.

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
    await s.browser.waitUntil(() => s.has('modal', '.cg-pv'), { timeout: 10_000, timeoutMsg: 'the card did not open' });
    await s.press(/^Hi/, 'modal', '.cg-pv button');
    await s.see('modal', 'so glad you’re here', 30_000);
    await s.shot('newcomer-hi');
  },
  {
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
