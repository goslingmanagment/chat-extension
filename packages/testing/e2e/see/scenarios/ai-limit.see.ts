// The person's own daily AI limit (`ai-limit-v1`, the owner's; Moscow day, all pages) and the team's shared pool past
// it: the dock's «$2.90 / $3.50» in amber with the 80 % toast that names the pool, the popup's line, then Reply
// past the own limit — «котёл $0.40» with the «свой лимит кончился» toast, «Ещё раз» spends the pool — the red
// «до 00:00», the «кончился» toast and the CG-AI-LIMIT card counting down to 00:00 МСК.

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
    // One Reply costs $0.70 on the stand: $2.90 → $3.60, past the $3.50 limit, $0.10 of the $0.50 pool.
    await s.press(/^Reply/);
    await s.done();
    // The facade asks the hub again 3 s after a generation.
    await s.wait(4500);
    await s.shot('dock-pool');
    await s.toPages();
    await openPopup();
    await waitForPopup((state) => state.view === 'ready', 'the popup of a signed-in person');
    await s.shot('popup-pool');
    await s.toChat();
    // «Ещё раз» still goes through on the pool's $0.40 and spends it: $4.30.
    await s.press(/^Ещё раз/, 'dock', 'button');
    await s.done();
    await s.wait(4500);
    await s.shot('dock-out');
    await s.toPages();
    await openPopup();
    await waitForPopup((state) => state.view === 'ready', 'the popup of a signed-in person');
    await s.shot('popup-out');
    await s.toChat();
    // «Ещё раз»: the hub refuses, the own limit and the pool are spent; the card counts down to 00:00 МСК.
    await s.press(/^Ещё раз/, 'dock', 'button');
    await s.wait(1500);
    await s.shot('refused');
  },
  {
    sites: ['chatspace', 'fansly'],
    before: async (s) => {
      await s.hub.command({
        op: 'config',
        patch: { personalAiLimit: { dailyLimitMicroUsd: LIMIT, todayMicroUsd: 2_900_000, perCallMicroUsd: 700_000, poolMicroUsd: 500_000 } },
      });
    },
  },
);
