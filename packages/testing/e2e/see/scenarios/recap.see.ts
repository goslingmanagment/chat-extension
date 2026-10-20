// Recap: the sheet over the dock, then the full Recap in its window.

import { scenario } from '../kit';

scenario(
  'recap',
  async (s) => {
    await s.ready();
    await s.press(/^Recap/);
    await s.h.dockIs((d) => d.analysis === 'recap', 'the Recap sheet');
    await s.shot('recap-sheet');
    await s.press(/^Собрать полностью/, 'dock', '.cg-dock button'); // «Build in full»
    await s.see('modal', 'Hubert, 34', 30_000);
    await s.shot('recap-full');
  },
  { sites: ['chatspace', 'fansly'] },
);
