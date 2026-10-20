// The dock of the open chat, ready (ChatSpace; `--site fansly` for Fansly).

import { scenario } from '../kit';

scenario(
  'dock',
  async (s) => {
    await s.ready();
    await s.shot('dock');
  },
  { sites: ['chatspace', 'fansly'] },
);
