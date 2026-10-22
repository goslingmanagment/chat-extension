// Review as a turn of Coach (1.51.0): Coach's window with its «Review» chip, the Review's card in the thread, then a
// question about it — answered with the Review in Coach's history.

import { SEE_AI_TEXTS, scenario } from '../kit';

const FIELD = '.cg-co__ask textarea, .cg-co__ask input';

/** Coach's answer to the question about the Review's second mistake (the coffee question it left unanswered). */
const ABOUT_THE_MISTAKE =
  'Answer the coffee question first — he asked it and is still waiting, so the set can wait one message. Keep it light and ask him back.\n\n```draft\nhaha you caught me ☕ two cups before noon, always… and you? [NEXT] tell me how you take yours and I’ll tell you what I was doing this morning 😏\n```';

scenario(
  'review',
  async (s) => {
    await s.ready();
    await s.press(/^Coach/);
    await s.browser.waitUntil(() => s.has('panel', FIELD), { timeout: 10_000, timeoutMsg: 'the Coach window did not open' });
    await s.press(/^Review/, 'panel', '.cg-co__chip');
    await s.see('panel', 'the conversation is alive', 30_000);
    await s.shot('review');

    // A question about it: the Review goes to Coach as history, so the answer is about its mistake.
    await s.hub.command({ op: 'config', patch: { aiTexts: { ...SEE_AI_TEXTS, 'coach-chat': ABOUT_THE_MISTAKE } } });
    await s.h.ours('panel', FIELD).click();
    await s.keys('А как исправить вторую ошибку?');
    await s.keys(s.Key.Enter);
    await s.see('panel', 'Answer the coffee question first', 30_000);
    await s.shot('review-question');
  },
  { sites: ['chatspace', 'fansly'] },
);
