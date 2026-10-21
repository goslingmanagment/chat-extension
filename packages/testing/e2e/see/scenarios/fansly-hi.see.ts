// Fansly: Hi in a short chat opened by a cold load — the page read the chat's history before its socket was confirmed
// (`t:1` 4 s late), so the tab holds no proof of the start. Hi has no message limit (2026-10-21): it runs at once, and
// nothing reads the history for a proof.

import { fakeFansly } from '../../support/fansly-stand';
import { scenario } from '../kit';

/** The stand's fifth chat (Stand Fan 5): eight messages, all personal. */
const SHORT_CHAT = '810000000000000053';

scenario(
  'fansly-hi',
  async (s) => {
    await s.ready();
    await s.press(/^Hi/);
    await s.done();
    await s.shot('hi-cold-load');
  },
  {
    sites: ['fansly'],
    fanslyGroup: SHORT_CHAT,
    before: async () => {
      await fakeFansly().command({ op: 'socket', verifyDelayMs: 4000 });
    },
  },
);
