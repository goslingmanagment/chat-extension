// Fansly: Hi in a short chat opened by a cold load — the page read the chat's history before its socket was confirmed
// (`t:1` 4 s late), so the tab holds no proof of the start; the background reads the history to its start itself.
// Its first read fails (Fansly 503): the hub refuses in honest words; the second Hi gives the greetings.

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
    await s.shot('hi-read-failed');
    await s.press(/^Hi/);
    await s.done();
    await s.shot('hi-cold-load');
  },
  {
    sites: ['fansly'],
    fanslyGroup: SHORT_CHAT,
    before: async () => {
      await fakeFansly().command({ op: 'socket', verifyDelayMs: 4000 });
      await fakeFansly().command({ op: 'api', rules: [{ route: 'message.history', caller: 'ours', times: 1, outcome: { kind: 'status', status: 503 } }] });
    },
  },
);
