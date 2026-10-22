// Review as a turn of Coach (1.51.0): Coach's window with its «Review» chip, the Review's card in the thread, then a
// question about it — answered with the Review in Coach's history. At a normal window and a narrow one (Coach is 860 px
// wide, never wider than the window less its margins).

import { SEE_AI_TEXTS, scenario } from '../kit';

const FIELD = '.cg-co__ask textarea, .cg-co__ask input';
/** Window widths: the mockup's, and one where Coach meets the window's margins (a 1040 px window). */
const WIDTHS = [1440, 1040] as const;

/** Coach's answer to the question about the Review's second mistake (the coffee question it left unanswered). */
const ABOUT_THE_MISTAKE =
  'Answer the coffee question first — he asked it and is still waiting, so the set can wait one message. Keep it light and ask him back.\n\n```draft\nhaha you caught me ☕ two cups before noon, always… and you? [NEXT] tell me how you take yours and I’ll tell you what I was doing this morning 😏\n```';

scenario(
  'review',
  async (s) => {
    const context = await s.browser.getWindowHandle();
    await s.ready();
    await s.hub.command({ op: 'config', patch: { aiTexts: { ...SEE_AI_TEXTS, 'coach-chat': ABOUT_THE_MISTAKE } } });
    for (const width of WIDTHS) {
      await s.browser.browsingContextSetViewport({ context, viewport: { width, height: 900 } });
      await s.wait(300);
      if (await s.has('panel', FIELD)) {
        // The window is open from the width before: a clean dialog («Новый диалог» asks first).
        await s.press(/^Новый диалог/, 'panel', '.cg-co__reset');
        await s.press(/^Точно начать заново/, 'panel', '.cg-co__reset');
      } else {
        await s.press(/^Coach/);
        await s.browser.waitUntil(() => s.has('panel', FIELD), { timeout: 10_000, timeoutMsg: 'the Coach window did not open' });
      }
      await s.press(/^Review/, 'panel', '.cg-co__chip');
      await s.see('panel', 'the conversation is alive', 30_000);
      await s.shot(`review-${width}`);

      // A question about it: the Review goes to Coach as history, so the answer is about its mistake.
      await s.h.ours('panel', FIELD).click();
      await s.keys('А как исправить вторую ошибку?');
      await s.keys(s.Key.Enter);
      await s.see('panel', 'Answer the coffee question first', 30_000);
      await s.shot(`review-question-${width}`);
    }
  },
  { sites: ['chatspace', 'fansly'] },
);
