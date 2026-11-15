// report-fansly: the board «Отчёт» over the Fansly stand (hub package R, 2026-11-15; handshake v2). The stub board of the
// fake hub in the frame (or Hub's demo board with CG_SEE_FRAME_ORIGIN): the corner card's fifth row with its dot; a page
// script imitating the frame (ignored); the board over an open chat; keys that never reach the site; the clipboard; a
// request off the allow-list refused; Esc in the chat — no bar, nothing of ours over the message field, the dock or the
// launcher, the fifth row brings the board back; «show on the site» — Wallet history without a reload, a row on page 1,
// on page 2, a sale the site does not show — with the bar there; the board collapsed on Wallet history keeps the bar,
// back to the chat takes it away; the sightings; a reload. `report-facts.json` holds what each step saw.

import { $, browser } from '@wdio/globals';

import { FANSLY_MAIN } from '../../support/fansly-stand';
import { scenario } from '../kit';
import {
  FRAME_BAR,
  REPORT_PULSE,
  barText,
  escapeInFrame,
  findInFrame,
  forgeHello,
  frameLog,
  inFrame,
  launcherButton,
  layerShown,
  markBox,
  overlaps,
  pageSeesFrames,
  pointFrames,
  pressInFrame,
  reportRow,
  waitBar,
  waitFrameLog,
  writeFacts,
} from '../report';

const LAUNCHER = 'div[data-host="overlay"][data-layer="launcher"]';
const barButton = () => $(FRAME_BAR).shadow$('button');

/** Back to the open chat the way the site's own router goes (no reload). */
async function toChat(path: string): Promise<void> {
  await browser.execute((to: string) => {
    history.pushState(null, '', to);
    dispatchEvent(new PopStateEvent('popstate', { state: null }));
  }, path);
}

scenario(
  'report-fansly',
  async (s) => {
    const facts: Record<string, unknown> = {};
    await s.ready();
    await pointFrames(s);
    await s.ready();
    const chatPath = await browser.execute(() => location.pathname);
    // The beat answers the board right away for the first bound tab; the row comes with it.
    await browser.waitUntil(async () => (await reportRow(LAUNCHER)).shown, { timeout: 30_000, interval: 300, timeoutMsg: 'no fifth row «Отчёт»' });
    facts['launcher'] = await reportRow(LAUNCHER);
    const card = await s.rect('page', LAUNCHER);
    if (card !== null) await s.shot('launcher', { clip: { x: 0, y: Math.max(0, card.y - 40), width: 360, height: card.height + 56 } });

    // A page script posting what a frame would: nothing of it is listened to.
    await forgeHello();
    await browser.execute(() => {
      (window as unknown as { __cgSeeMark?: number }).__cgSeeMark = 1;
    });
    await launcherButton(LAUNCHER, 'report').click();
    await browser.waitUntil(layerShown, { timeout: 30_000, interval: 200, timeoutMsg: 'the board did not show' });
    facts['port'] = await waitFrameLog(/доска загружена/);
    facts['pageSeesFrames'] = await pageSeesFrames();
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

    // Esc in the open chat: the board folds into the launcher's fifth row — no bar, nothing over the field.
    facts['escape'] = await escapeInFrame();
    await browser.waitUntil(async () => !(await layerShown()), { timeout: 10_000, timeoutMsg: 'Esc did not collapse the board' });
    await s.wait(700);
    facts['chatCollapsed'] = { bar: await barText(), overlaps: await overlaps(FANSLY_MAIN.field, LAUNCHER) };
    await s.shot('chat-collapsed');
    await launcherButton(LAUNCHER, 'report').click();
    await browser.waitUntil(layerShown, { timeout: 10_000, timeoutMsg: 'the fifth row did not bring the board back' });

    // «Show on the site»: a row on the first page of Wallet history; the bar stands there.
    await findInFrame('#…5305');
    facts['compare'] = await waitBar(/Сверка/);
    await browser.waitUntil(async () => (await markBox()) !== null, { timeout: 30_000, interval: 300, timeoutMsg: 'no row framed' });
    await s.wait(900);
    facts['path'] = await browser.execute(() => location.pathname);
    facts['noReload'] = await browser.execute(() => (window as unknown as { __cgSeeMark?: number }).__cgSeeMark === 1);
    facts['mark1'] = await markBox();
    await s.shot('find-page1');

    // «К отчёту»: the same frame, the row lit.
    await barButton().click();
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
    await barButton().click();
    await browser.waitUntil(layerShown, { timeout: 10_000 });
    const ghost = await inFrame(async () => (await browser.$$('.r2 a').map((a) => a.getText()))[3] ?? '');
    await findInFrame(ghost);
    facts['notFound'] = await waitBar(/не найдена/, 60_000);
    facts['markAfterNotFound'] = await markBox();
    await s.shot('not-found');

    // The board collapsed while on Wallet history keeps the bar; back to the chat takes it away.
    await barButton().click();
    await browser.waitUntil(layerShown, { timeout: 10_000 });
    await escapeInFrame();
    facts['walletCollapsed'] = await waitBar(/Отчёт смены/);
    await toChat(chatPath);
    await browser.waitUntil(async () => (await barText()) === '', { timeout: 10_000, interval: 300, timeoutMsg: 'the bar stayed after leaving Wallet history' });
    await s.ready();
    await s.wait(700);
    facts['backInChat'] = { bar: await barText(), overlaps: await overlaps(FANSLY_MAIN.field, LAUNCHER) };
    await s.shot('back-in-chat');

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
