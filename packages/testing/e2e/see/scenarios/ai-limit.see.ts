// The person's own daily AI limit (`ai-limit-v1`, the owner's; Moscow day, all pages): the dock's «ИИ $2.90 / $3.50»
// in amber with the 80 % toast, the popup's line, then Reply until it is spent — the red «ИИ до 00:00», the «исчерпан»
// toast and the CG-AI-LIMIT card counting down to 00:00 МСК.

import { openPopup, waitForPopup } from '../../support/pages';
import { scenario } from '../kit';

const LIMIT = 3_500_000;

scenario(
  'ai-limit',
  async (s) => {
    await s.ready();
    // The background reads the limit when the hub answers; the dock and the toast follow its event.
    await s.wait(1500);
    await s.shot('dock-low');
    await s.toPages();
    await openPopup();
    await waitForPopup((state) => state.view === 'ready', 'the popup of a signed-in person');
    await s.shot('popup-low');
    await s.toChat();
    // One Reply costs $0.70 on the stand: $2.90 → $3.60, past the $3.50 limit.
    await s.press(/^Reply/);
    await s.done();
    // The facade asks the hub again 3 s after a generation: the spend is now past the limit.
    await s.wait(4500);
    await s.shot('dock-out');
    // «Ещё раз»: the hub refuses with the person's own limit, the card counts down to 00:00 МСК.
    await s.press(/^Ещё раз/, 'dock', 'button');
    await s.wait(1500);
    await s.shot('refused');
  },
  {
    sites: ['chatspace', 'fansly'],
    before: async (s) => {
      await s.hub.command({ op: 'config', patch: { personalAiLimit: { dailyLimitMicroUsd: LIMIT, todayMicroUsd: 2_900_000, perCallMicroUsd: 700_000 } } });
    },
  },
);
