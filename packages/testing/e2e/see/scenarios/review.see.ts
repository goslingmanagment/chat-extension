// Review of the open chat, in its window.

import { scenario } from '../kit';

scenario(
  'review',
  async (s) => {
    await s.ready();
    await s.press(/^Review/);
    await s.see('modal', 'разговор живой', 30_000);
    await s.shot('review');
  },
  { sites: ['chatspace', 'fansly'] },
);
