// The greeting reminder: a fan subscribed 12 minutes ago and nobody greeted them — the toast «Ждёт приветствия · …»,
// then its «Hi»: «Новые» opens on the fan's card and Hi writes the greeting into its field. The list is read once
// (the palette row «Новые») so the reminder hears it at once instead of the background's next minute.

import { STAND_IDS } from '../../support/stand';
import { scenario, STAND_PAGE } from '../kit';

scenario(
  'greet-reminder',
  async (s) => {
    await s.ready();
    await s.leaveField();
    await s.keys(s.MOD, 'k');
    await s.press(/^Новые/, 'modal', '.cg-pal__item');
    await s.see('toast', 'Ждёт приветствия', 15_000);
    await s.closeAll();
    await s.shot('reminder');
    await s.press(/^Hi$/, 'toast', '.cg-toast__acts button');
    await s.browser.waitUntil(() => s.has('modal', '.cg-nc__greet'), { timeout: 10_000, timeoutMsg: 'the card did not open' });
    await s.browser.waitUntil(async () => ((await s.h.readOurs('modal', '.cg-nc__field textarea', (node) => (node as HTMLTextAreaElement).value)) ?? '') !== '', {
      timeout: 30_000,
      timeoutMsg: 'the greeting did not land in the field',
    });
    await s.shot('reminder-hi');
  },
  {
    previewSend: true,
    before: async ({ hub, stand }) => {
      const { a5, a6 } = STAND_IDS.fans;
      await stand.traffic({ firstSummaryMs: 150 });
      await hub.command({ op: 'audienceEvent', pageLabel: STAND_PAGE, fanRef: a5, agoMs: 12 * 60_000 });
      // Two minutes old: not due yet.
      await hub.command({ op: 'audienceEvent', pageLabel: STAND_PAGE, fanRef: a6, agoMs: 2 * 60_000 });
    },
  },
);
