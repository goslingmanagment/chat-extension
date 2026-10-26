// The dock's bar on narrower composers (the narrow rules of ui/src/dock/styles.ts): a picture per window width, named
// by the bar's own width (and «scrolls» where its row runs past it), then Reply's hint at the second width, then
// «Размер текста: Обычный» — the bar is the same at either text size (2026-10-22: px rules, the old 13 px buttons).
// Fansly's composer is 600–940 px wide, ChatSpace's ~540–1020 px.

import { scenario } from '../kit';

/** Window widths, the widest first; on Fansly the bars are ~670, ~630, ~612 (a 1512 px Mac's chat), ~570, ~520, ~480 and ~460 px. */
const WINDOWS = { fansly: [1130, 1065, 1035, 960, 880, 812, 782], chatspace: [1300, 1040, 960, 900] } as const;
/** «Обычный»: the mockup's window and Fansly's 1728 px one (a ~620 px composer). */
const NORMAL_WINDOWS = [1440, 1040] as const;
const HEIGHT = 900;

scenario(
  'dock-widths',
  async (s) => {
    const context = await s.browser.getWindowHandle();
    const shootAt = async (width: number, name: string): Promise<void> => {
      await s.browser.browsingContextSetViewport({ context, viewport: { width, height: HEIGHT } });
      await s.wait(300);
      const bar = await s.h.readOurs('dock', '.cg-strip', (strip) => [Math.round(strip.getBoundingClientRect().width), strip.scrollWidth - strip.clientWidth] as const);
      await s.shot(`${name}-${bar?.[0] ?? 0}px${(bar?.[1] ?? 0) > 0 ? `-scrolls-${String(bar?.[1])}` : ''}`);
    };
    await s.ready();
    for (const width of WINDOWS[s.site]) await shootAt(width, 'bar');
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
    await s.browser.action('pointer').move({ x: 5, y: 5 }).perform();

    await s.toPages();
    const patched = await s.rpc('settings.patch', { patch: { ui: { textSize: 'normal' } }, baseRevision: null });
    if (!patched.ok) throw new Error(`settings.patch: ${patched.error.code}`);
    await s.toChat();
    await s.ready();
    for (const width of NORMAL_WINDOWS) await shootAt(width, 'normal');
  },
  { sites: ['fansly', 'chatspace'], viewport: { width: WINDOWS.fansly[0], height: HEIGHT } },
);
