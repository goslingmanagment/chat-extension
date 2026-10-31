// «Онлайн» on OnlyFans fed by ChatSpace itself (2026-10-31, hub #952): OnlyFansAPI's feed is gone — the hub keeps no
// presence of its own — and the tab tells it whom ChatSpace's own poll found online (the green dots of its list) and,
// with the page's `onlineProbe` on, the page's probe of its spenders (one `fans-online` read); the bar's «Онлайн N» and
// the window list them. `online-chatspace-probe-error`: ChatSpace fails the probe, and the window says when it asks again.

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
  'online-chatspace',
  async (s) => {
    await s.ready();
    // The bar's count: the hub's list, fed by the tab's reports.
    await s.browser.waitUntil(() => s.has('dock', '.cg-act__n'), { timeout: 30_000, interval: 300, timeoutMsg: 'no «Онлайн N» on the bar' });
    await openOnline(s);
    await s.shot('online-chatspace');
  },
  {
    previewSend: true,
    before: async ({ hub, stand }) => {
      // OnlyFansAPI's feed is gone: the hub knows only what the tabs report; the owner's switch of the page's probe is on.
      await hub.command({ op: 'config', patch: { onlineStand: false, pageFlags: { [PAGE]: { onlineProbe: true } } } });
      // Who ChatSpace's presence endpoint answers as online: three fans of account a.
      await stand.presence(STAND_IDS.accounts.a, [STAND_IDS.fans.a2, STAND_IDS.fans.a5, STAND_IDS.fans.a7]);
    },
  },
);
