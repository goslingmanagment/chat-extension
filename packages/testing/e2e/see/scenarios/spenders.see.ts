// Spenders: the board, then a fan's preview with a Reply ready to send.

import { scenario } from '../kit';

scenario(
  'spenders',
  async (s) => {
    await s.ready();
    await s.leaveField();
    await s.keys(...s.PANEL, 'm');
    await s.see('modal', 'Fan Alder');
    await s.shot('spenders');
    await s.press(/^Fan Kestrel/, 'modal', '[data-cg-key^="fan:"]');
    await s.see('modal', 'Чат не открыт');
    await s.press(/^Reply/, 'modal', '.cg-pv button');
    await s.see('modal', 'the set is still waiting', 30_000);
    await s.shot('spenders-preview');
  },
  { previewSend: true },
);
