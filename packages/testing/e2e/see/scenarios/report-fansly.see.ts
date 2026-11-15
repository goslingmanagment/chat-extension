// report-fansly: the board «Отчёт» over the Fansly stand (hub package R, 2026-11-15). The stub board of the fake hub in
// the frame (or Hub's demo board with CG_SEE_FRAME_ORIGIN): the corner card's fifth row with its dot, the board over the
// site, the port and a request through it, a request off the allow-list refused, the clipboard, Esc and the bar,
// «show on the site» — Wallet history opened without a reload, a row on page 1, a row on page 2, a sale the site does
// not show — «К отчёту» back to the same frame, the sightings the site's own wallet list gave Hub, and a reload that
// makes the frame again. `report-facts.json` holds what each step saw.

import { $, browser } from '@wdio/globals';

import { scenario } from '../kit';
import { REPORT_PULSE, barText, escapeInFrame, findInFrame, frameLog, inFrame, launcherButton, layerShown, markBox, pointFrames, pressInFrame, reportRow, waitBar, waitFrameLog, writeFacts } from '../report';

const LAUNCHER = 'div[data-host="overlay"][data-layer="launcher"]';

scenario(
  'report-fansly',
  async (s) => {
    const facts: Record<string, unknown> = {};
    await s.ready();
    await pointFrames(s);
    await s.ready();
    // The beat answers the board right away for the first bound tab; the row comes with it.
    await browser.waitUntil(async () => (await reportRow(LAUNCHER)).shown, { timeout: 30_000, interval: 300, timeoutMsg: 'no fifth row «Отчёт»' });
    facts['launcher'] = await reportRow(LAUNCHER);
    const card = await s.rect('page', LAUNCHER);
    if (card !== null) await s.shot('launcher', { clip: { x: 0, y: Math.max(0, card.y - 40), width: 360, height: card.height + 56 } });

    // A mark on the page's window: a reload would take it away.
    await browser.execute(() => {
      (window as unknown as { __cgSeeMark?: number }).__cgSeeMark = 1;
    });
    await launcherButton(LAUNCHER, 'report').click();
    await browser.waitUntil(layerShown, { timeout: 30_000, interval: 200, timeoutMsg: 'the board did not show' });
    facts['port'] = await waitFrameLog(/доска загружена/);
    await s.wait(400);
    await s.shot('board');

    // Keys while the board shows: typing goes to the board, never to the site; a key that lands on the site's page
    // anyway (its focus taken back) stops at our layer.
    await browser.execute(() => {
      const w = window as unknown as { __cgSeeKeys?: number };
      w.__cgSeeKeys = 0;
      document.addEventListener('keydown', () => {
        w.__cgSeeKeys = (w.__cgSeeKeys ?? 0) + 1;
      });
    });
    await inFrame(async () => {
      await browser.$('#comment').click();
      await browser.keys('hello j k');
    });
    const typedInFrame = await inFrame(async () => browser.$('#comment').getValue());
    await browser.execute(() => {
      (document.activeElement as HTMLElement | null)?.blur();
      document.body.focus();
    });
    await browser.keys('jk');
    facts['keys'] = { typedInFrame, siteHeard: await browser.execute(() => (window as unknown as { __cgSeeKeys?: number }).__cgSeeKeys ?? -1), layerStill: await layerShown() };

    await pressInFrame('Скопировать пост');
    facts['copy'] = await waitFrameLog(/copy:/);
    await pressInFrame('Запрос мимо списка');
    facts['refused'] = await waitFrameLog(/мимо списка/);
    await pressInFrame('Сохранить');
    facts['comment'] = await waitFrameLog(/комментарий:/);
    await s.shot('board-requests');

    // Esc in the board collapses it into the bar; «Отчёт» on the bar brings it back.
    facts['escape'] = await escapeInFrame();
    facts['bar'] = await waitBar(/Отчёт смены/);
    facts['layerAfterEsc'] = await layerShown();
    await s.shot('bar');
    await $('div[data-host="overlay"][data-layer="frame-bar"]').shadow$('button').click();
    await browser.waitUntil(layerShown, { timeout: 10_000, timeoutMsg: 'the bar did not bring the board back' });

    // «Show on the site»: a row on the first page of Wallet history.
    await findInFrame('#…5305');
    facts['compare'] = await waitBar(/Сверка/);
    await browser.waitUntil(async () => (await markBox()) !== null, { timeout: 30_000, interval: 300, timeoutMsg: 'no row framed' });
    await s.wait(900);
    facts['path'] = await browser.execute(() => location.pathname);
    facts['noReload'] = await browser.execute(() => (window as unknown as { __cgSeeMark?: number }).__cgSeeMark === 1);
    facts['mark1'] = await markBox();
    await s.shot('find-page1');

    // «К отчёту»: the same frame (its line still says what it heard), the row lit.
    await $('div[data-host="overlay"][data-layer="frame-bar"]').shadow$('button').click();
    await browser.waitUntil(layerShown, { timeout: 10_000 });
    facts['frameKept'] = await frameLog();
    await s.shot('back-to-board');

    // A row on the second page: the finder pages on.
    const page2 = await inFrame(async () => (await browser.$$('.r2 a').map((a) => a.getText()))[2] ?? '');
    await findInFrame(page2);
    await browser.waitUntil(async () => /Сверка/.test(await barText()) && (await markBox()) !== null, { timeout: 40_000, interval: 300, timeoutMsg: 'the row of page 2 was not framed' });
    await s.wait(900);
    facts['page2'] = { mark: page2, range: await browser.execute(() => document.querySelector('.pager-range')?.textContent ?? null) };
    await s.shot('find-page2');

    // A sale the site does not show: said, never a similar row.
    await $('div[data-host="overlay"][data-layer="frame-bar"]').shadow$('button').click();
    await browser.waitUntil(layerShown, { timeout: 10_000 });
    const ghost = await inFrame(async () => (await browser.$$('.r2 a').map((a) => a.getText()))[3] ?? '');
    await findInFrame(ghost);
    facts['notFound'] = await waitBar(/не найдена/, 60_000);
    facts['markAfterNotFound'] = await markBox();
    await s.shot('not-found');

    // The sightings: the wallet list the site itself loaded, told to Hub (the stub keeps them).
    const calls = await s.hub.journal();
    facts['sightings'] = calls.entries.filter((call) => call.operation === 'report-board:sightings').map((call) => ({ status: call.status, request: call.request }));

    // A full reload: the frame is made again, the board comes back from Hub.
    await browser.refresh();
    await browser.waitUntil(async () => (await reportRow(LAUNCHER)).shown, { timeout: 30_000, interval: 300 });
    await launcherButton(LAUNCHER, 'report').click();
    await browser.waitUntil(layerShown, { timeout: 30_000, interval: 200 });
    facts['afterReload'] = await waitFrameLog(/доска загружена/);
    await s.shot('after-reload');
    writeFacts(s, facts);
  },
  {
    sites: ['fansly'],
    timeout: 240_000,
    before: async ({ hub }) => {
      await hub.command({ op: 'config', patch: { report: { ...REPORT_PULSE } } });
    },
  },
);
