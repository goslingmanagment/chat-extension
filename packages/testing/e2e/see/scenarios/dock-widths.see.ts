// The dock's bar on narrower composers (the narrow rules of ui/src/dock/styles.ts): a picture per window width, named
// by the bar's own width, then Reply's hint on the narrowest that still has the persona. Fansly's composer is 600–940
// px wide, ChatSpace's ~540–1020 px.

import { scenario } from '../kit';

/** Window widths, the widest first; the bar is some 500 px (Fansly) or 420 px (ChatSpace) narrower. */
const WINDOWS = { fansly: [1130, 1040, 960, 880], chatspace: [1300, 1040, 960, 900] } as const;
const HEIGHT = 900;

scenario(
  'dock-widths',
  async (s) => {
    const context = await s.browser.getWindowHandle();
    await s.ready();
    for (const width of WINDOWS[s.site]) {
      await s.browser.browsingContextSetViewport({ context, viewport: { width, height: HEIGHT } });
      await s.wait(300);
      const bar = await s.h.readOurs('dock', '.cg-strip', (strip) => Math.round(strip.getBoundingClientRect().width));
      await s.shot(`bar-${bar ?? 0}px`);
    }
    // Reply's hint names the persona («Ответ от имени «Default»…»), at the composer where the bar is tightest with it.
    await s.browser.browsingContextSetViewport({ context, viewport: { width: WINDOWS[s.site][1], height: HEIGHT } });
    await s.wait(300);
    for (const button of await s.h.allOurs('dock', 'button')) {
      if (!/^Reply/.test((await button.getText()).trim())) continue;
      await button.moveTo();
      break;
    }
    await s.wait(900);
    await s.shot('reply-hint');
  },
  { sites: ['fansly', 'chatspace'], viewport: { width: WINDOWS.fansly[0], height: HEIGHT } },
);
