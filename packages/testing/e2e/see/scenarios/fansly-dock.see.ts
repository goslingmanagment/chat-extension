// Fansly: the dock in a chat of the Fansly stand, then a Reply result.

import { scenario } from '../kit';

scenario(
  'fansly-dock',
  async (s) => {
    await s.ready();
    await s.shot('fansly-dock');
    await s.press(/^Reply/);
    await s.done();
    await s.shot('fansly-reply');
  },
  { sites: ['fansly'] },
);
