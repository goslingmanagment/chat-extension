// Voice (1.47.0) on either site: a draft in the field, the Voice chip writes its script, «Озвучить» renders a take
// (the fake hub's MP3), «Ещё вариант» a second one, then «Прикрепить» hands the chosen take to the site's field — on
// ChatSpace by a drop on the composer, on Fansly through its own upload window, whose «Upload» the person presses.

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { FANSLY_MAIN } from '../../support/fansly-stand';
import { scenario } from '../kit';

const DRAFT = 'hey you, I missed you today. tell me how your trip went, I want every little detail';

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
  },
  { sites: ['chatspace', 'fansly'], timeout: 240_000 },
);
