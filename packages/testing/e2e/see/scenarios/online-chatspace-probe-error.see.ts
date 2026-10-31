// «Онлайн» on OnlyFans when ChatSpace fails the page's probe (2026-10-31, hub #952): its `fans-online` answers 503 —
// the window says ChatSpace did not answer and when the tab asks again (10 minutes later, then 20, then 40); the fans
// ChatSpace's own poll had found online still come from the page's memory.

import { PAGE } from '../../../src/scenarios/hub';
import { STAND_IDS } from '../../support/stand';
import { scenario, type See } from '../kit';

/** The window of «Онлайн», opened from the bar, its source said in its line. */
async function openOnline(s: See): Promise<void> {
  await s.leaveField();
  await s.press(/Онлайн/, 'dock', '.cg-strip button');
  await s.see('modal', 'кто онлайн: из ChatSpace', 20_000);
  await s.browser.pause(1_500);
  await s.browser.action('pointer').move({ x: 2, y: 2, origin: 'viewport' }).perform();
  await s.browser.pause(300);
}

scenario(
  'online-chatspace-probe-error',
  async (s) => {
    await s.ready();
    // ChatSpace's own poll found two fans of its list online before its endpoint broke (its store, as its poll leaves it).
    for (const fan of [STAND_IDS.fans.a5, STAND_IDS.fans.a7]) await s.h.callStand('setFanOnline', STAND_IDS.accounts.a, fan, true);
    await openOnline(s);
    await s.see('modal', 'ChatSpace не ответил', 20_000);
    await s.shot('online-chatspace-probe-error');
  },
  {
    previewSend: true,
    before: async ({ hub, stand }) => {
      await hub.command({ op: 'config', patch: { onlineStand: false, pageFlags: { [PAGE]: { onlineProbe: true } } } });
      await stand.failFansOnline(true);
    },
  },
);
