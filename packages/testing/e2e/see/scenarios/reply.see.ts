// Reply in the open chat: the dock, then its result.

import { scenario } from '../kit';

scenario(
  'reply',
  async (s) => {
    await s.ready();
    await s.shot('dock');
    await s.press(/^Reply/);
    await s.done();
    await s.shot('reply');
  },
  { sites: ['chatspace', 'fansly'] },
);
