// Voice (1.47.0) on either site: a draft in the field, the Voice chip writes its script, «Озвучить» renders a take
// (the fake hub's MP3), «Ещё вариант» a second one, then «Прикрепить» hands the chosen take to the site's field — on
// ChatSpace by a drop on the composer, on Fansly through its own upload window, whose «Upload» the person presses.
//
// 1.49.0: the page's day above the buttons. The page spent 3 600 of its 5 000 characters before the shift, so the
// studio opens with «осталось 1 400 символов на сегодня» and counts down with each take. Then the day runs short
// (another chatter spent it; the hub's cap of one script is 500 by then): the studio, opened again, warns that the
// script is longer than what is left — at the dock's own width and on a narrow composer. Then nothing is left:
// «Ещё вариант» stays pressable, the hub refuses it and charges nothing, and the studio says when the day renews.

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { FANSLY_MAIN } from '../../support/fansly-stand';
import { WORLD } from '../../../src/scenarios/hub';
import { scenario } from '../kit';

const DRAFT = 'hey you, I missed you today. tell me how your trip went, I want every little detail';
/** The hub page of each site's stand account, and what it spent today before the shift (of the default 5 000). */
const PAGES = { chatspace: WORLD.pages.one.pageLabel, fansly: WORLD.pages.fansly.pageLabel } as const;
const SPENT_BEFORE = 3_600;
/** What is left of the day for the warning: less than the script. */
const SHORT_LEFT = 30;
/** A window whose composer gives the dock less than 720 px on either site (dock-widths.see.ts). */
const NARROW = { width: 960, height: 900 } as const;
const WIDE = { width: 1440, height: 900 } as const;

scenario(
  'voice',
  async (s) => {
    await s.ready();
    if (s.site === 'fansly') {
      await (await s.h.$(FANSLY_MAIN.field)).click();
      await s.keys(DRAFT);
    } else await s.type(DRAFT);
    await s.press(/^Voice/);
    await s.see('dock', /Озвучить ·/, 40_000);
    await s.shot('script');
    await s.press(/^Озвучить/, 'dock', '.cg-voice__foot button');
    await s.see('dock', /Прикрепить/, 40_000);
    await s.wait(800);
    await s.shot('take-ready');
    await s.press(/^Ещё вариант/, 'dock', '.cg-voice__foot button');
    await s.see('dock', /Вариант 2/);
    await s.shot('second-take');
    await s.browser.waitUntil(async () => (await s.text('dock', '.cg-voice__takes')).includes('выбран') || !(await s.has('dock', '.cg-take.is-working')), {
      timeout: 40_000,
      timeoutMsg: 'the second take did not get ready',
    });
    await s.wait(800);
    await s.shot('two-takes');
    // ▶ of the first take: Web Audio plays it in our root, the waveform and the clock follow; ‖ keeps its place.
    await (await s.h.ours('dock', '.cg-take__play')).click();
    await s.wait(1200);
    await (await s.h.ours('dock', '.cg-take__play')).click();
    await s.shot('paused');
    // «Скачать MP3» of the chosen take: a Blob saved from our closed root.
    const downloads = join(s.out, 'downloads');
    const saved = (): string[] => (existsSync(downloads) ? readdirSync(downloads).filter((name) => name.endsWith('.mp3')) : []);
    await (await s.h.ours('dock', '.cg-take.is-selected .cg-take__dl')).click();
    await s.browser.waitUntil(() => saved().length > 0, { timeout: 15_000, timeoutMsg: 'the MP3 was not saved' });
    console.log(`cg-see downloads: ${saved().join(', ')}`);
    await s.press(/^Прикрепить/, 'dock', '.cg-voice__foot button');
    if (s.site === 'fansly') {
      // The site's own upload window: the person presses «Upload».
      const upload = await s.h.$('.btn.solid-blue.large');
      await upload.waitForDisplayed({ timeout: 10_000 });
      await s.shot('fansly-upload-window');
      await upload.click();
    }
    await s.see('dock', /в поле/, 40_000);
    await s.wait(600);
    await s.shot('attached');
    // The draft's text is still in the field: «Убрать текст» takes it out, «Вернуть текст» puts it back.
    await s.press(/^Убрать текст/, 'dock', '.cg-voice__leftover button');
    await s.see('dock', /Текст черновика убран/);
    await s.wait(400);
    await s.shot('text-cleared');

    // The day runs short: what is left is less than the script, and the hub's cap of one script is 500 now.
    const left = Number((await s.text('dock', '.cg-voice__day')).replace(/\D/g, ''));
    await s.hub.command({ op: 'config', patch: { voiceDay: { scriptMaxChars: 500, spentToday: { [PAGES[s.site]]: SPENT_BEFORE + left - SHORT_LEFT } } } });
    // The background keeps the hub's word for 15 s; the studio reads it again when it opens.
    await s.wait(15_500);
    await s.press(/^Voice/);
    await s.press(/^Voice/);
    await s.see('dock', /скрипт длиннее/, 20_000);
    const context = await s.browser.getWindowHandle();
    const dockWidth = async (): Promise<number> => (await s.h.readOurs('dock', '.cg-strip', (strip) => Math.round(strip.getBoundingClientRect().width))) ?? 0;
    /** The pointer off our buttons (no hint over the footer), then the picture, named by the dock's width. */
    const shootAt = async (name: string): Promise<void> => {
      await s.browser.action('pointer').move({ x: 5, y: 5 }).perform();
      await s.wait(600);
      await s.shot(`${name}-${String(await dockWidth())}px`);
    };
    await shootAt('over-limit');
    await s.browser.browsingContextSetViewport({ context, viewport: NARROW });
    await shootAt('over-limit');
    // Nothing left: «Ещё вариант» stays pressable; the hub refuses it, nothing is spent, the studio says when the day renews.
    await s.hub.command({ op: 'config', patch: { voiceDay: { spentToday: { [PAGES[s.site]]: 5_000 } } } });
    await s.press(/^Ещё вариант/, 'dock', '.cg-voice__foot button');
    await s.see('dock', /исчерпан/, 20_000);
    await shootAt('exhausted');
    await s.browser.browsingContextSetViewport({ context, viewport: WIDE });
    await shootAt('exhausted');
  },
  {
    sites: ['chatspace', 'fansly'],
    timeout: 300_000,
    before: async (s) => {
      await s.hub.command({ op: 'config', patch: { voiceDay: { spentToday: { [PAGES[s.site]]: SPENT_BEFORE } } } });
    },
  },
);
