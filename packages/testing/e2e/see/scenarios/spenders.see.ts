// Spenders: the board, then a fan's preview with a Reply ready to send. On Fansly (`--site fansly`): the board with
// its statistics column, then the statistics in full («Развернуть»).

import { scenario } from '../kit';

scenario(
  'spenders',
  async (s) => {
    await s.ready();
    if (s.site === 'fansly') {
      // Out of Fansly's field: our key is a command there, not text.
      await s.browser.execute(() => (document.activeElement as HTMLElement | null)?.blur());
      await s.keys(...s.PANEL, 'm');
      await s.see('modal', 'Полки', 20_000);
      await s.shot('spenders-fansly');
      await s.press(/^Развернуть/, 'modal');
      await s.see('modal', 'Свернуть к списку');
      await s.shot('spenders-fansly-stats');
      return;
    }
    await s.leaveField();
    await s.keys(...s.PANEL, 'm');
    await s.see('modal', 'Fan Alder');
    await s.shot('spenders');
    await s.press(/^Fan Kestrel/, 'modal', '[data-cg-key^="fan:"]');
    await s.see('modal', 'Чат не открыт'); // «the chat is not opened»: the preview leaves it unread
    await s.press(/^Reply/, 'modal', '.cg-pv button');
    await s.see('modal', 'the set is still waiting', 30_000);
    await s.shot('spenders-preview');
  },
  { sites: ['chatspace', 'fansly'], previewSend: true },
);
