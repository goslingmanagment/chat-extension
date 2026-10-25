// The greeting reminder: a fan subscribed 12 minutes ago and nobody greeted them — the toast «Ждёт приветствия · …»,
// then its «Hi»: «Новые» opens on the fan's card, Hi writes the greeting, and the fan's chat opens with it in
// ChatSpace's own field (2026-10-25). The list is read once (the palette row «Новые») so the reminder hears it at once
// instead of the background's next minute.

import { EDITOR } from '../../support/chat';
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
    await s.browser.waitUntil(async () => (await s.browser.$(EDITOR).getText()).trim() !== '', { timeout: 30_000, timeoutMsg: 'the greeting did not land in the chat' });
    await s.shot('reminder-chat');
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
