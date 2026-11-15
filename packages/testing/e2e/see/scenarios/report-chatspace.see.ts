// report-chatspace: the board «Отчёт» over the ChatSpace stand (hub package R, 2026-11-15; handshake v2). The rail's
// fifth icon with its dot (nothing of it in the dock), the board over an open chat, Esc there — no bar, nothing of ours
// over the composer, the dock or the rail — «show on the site» in ChatSpace's transactions window (the stand's window is
// the documents' shape: ChatSpace live is closed to agents) with the bar there, a row behind «Load more», the window
// closed takes the bar away, a Fansly sale with no Fansly tab here (the board stays and says so), the statement asked
// again, then a second tab of another page: «show on the site» from there brings the first tab forward and frames the
// row there; the second tab, in a chat, shows no bar. `report-facts.json` holds what each step saw.

import { $, browser } from '@wdio/globals';

import { STAND_IDS, chatPath } from '../../support/stand';
import { scenario } from '../kit';
import { FRAME_BAR, REPORT_PULSE, barText, escapeInFrame, findInFrame, forgeHello, inFrame, launcherButton, layerShown, markBox, overlaps, pageSeesFrames, pointFrames, pressInFrame, reportRow, waitFrameLog, writeFacts } from '../report';

const RAIL = '[data-host="rail"]';
const COMPOSER = '.composer-frame';
const VIEWPORT = { width: 1440, height: 900 };

/** The stub's «show on the site» links in their order: the Fansly column first, then the OnlyFans one. */
const links = (): Promise<string[]> => inFrame(async () => browser.$$('.r2 a').map((a) => a.getText()));

async function openBoard(): Promise<void> {
  await browser.waitUntil(async () => (await reportRow(RAIL)).shown, { timeout: 30_000, interval: 300, timeoutMsg: 'no fifth icon «Отчёт» in the rail' });
  await launcherButton(RAIL, 'report').click();
  await browser.waitUntil(layerShown, { timeout: 30_000, interval: 200, timeoutMsg: 'the board did not show' });
}

const barButton = () => $(FRAME_BAR).shadow$('button');

scenario(
  'report-chatspace',
  async (s) => {
    const facts: Record<string, unknown> = {};
    await s.ready();
    await pointFrames(s);
    await s.ready();
    await browser.waitUntil(async () => (await reportRow(RAIL)).shown, { timeout: 30_000, interval: 300, timeoutMsg: 'no fifth icon' });
    facts['rail'] = await reportRow(RAIL);
    const rail = await s.rect('page', RAIL);
    if (rail !== null) await s.shot('rail', { clip: { x: 0, y: Math.max(0, rail.y - 160), width: 420, height: rail.height + 200 } });

    await forgeHello();
    await openBoard();
    facts['port'] = await waitFrameLog(/доска загружена/);
    facts['pageSeesFrames'] = await pageSeesFrames();
    await s.wait(400);
    await s.shot('board');

    // Esc in the open chat: no bar; nothing of ours over the composer, the dock or the rail.
    facts['escape'] = await escapeInFrame();
    await browser.waitUntil(async () => !(await layerShown()), { timeout: 10_000, timeoutMsg: 'Esc did not collapse the board' });
    await s.wait(700);
    facts['chatCollapsed'] = { bar: await barText(), overlaps: await overlaps(COMPOSER, RAIL) };
    await s.shot('chat-collapsed');
    await openBoard();

    // A row of the OnlyFans page on the first page of the transactions window; the bar stands over the window's page.
    const marks = await links();
    facts['links'] = marks;
    await findInFrame(marks[4] ?? '');
    await browser.waitUntil(async () => /Сверка/.test(await barText()) && (await markBox()) !== null, { timeout: 30_000, interval: 300, timeoutMsg: 'the transactions row was not framed' });
    await s.wait(800);
    facts['find1'] = { bar: await barText(), mark: await markBox() };
    await s.shot('find-window');

    // A row behind «Load more».
    await barButton().click();
    await browser.waitUntil(layerShown, { timeout: 10_000 });
    await findInFrame(marks[6] ?? '');
    await browser.waitUntil(async () => /Сверка/.test(await barText()) && (await markBox()) !== null, { timeout: 30_000, interval: 300, timeoutMsg: 'the row behind «Load more» was not framed' });
    await s.wait(800);
    facts['find2'] = { bar: await barText(), rows: await browser.execute(() => document.querySelectorAll('.transactions__table tbody tr').length) };
    await s.shot('find-more');

    // The window closed: the bar goes with it.
    await browser.$('.transactions__close').click();
    await browser.waitUntil(async () => (await barText()) === '', { timeout: 10_000, interval: 300, timeoutMsg: 'the bar stayed after the window closed' });
    await s.wait(600);
    facts['windowClosed'] = { bar: await barText(), overlaps: await overlaps(COMPOSER, RAIL) };
    await s.shot('window-closed');

    // A Fansly sale: no Fansly tab here — the board stays and says so.
    await openBoard();
    await findInFrame(marks[0] ?? '');
    facts['noTab'] = await waitFrameLog(/Откройте вкладку/);
    facts['noTabLayer'] = await layerShown();
    await s.shot('open-tab');

    // The statement of the board's OnlyFans pages read again: the tab asks the hub's poll of them now.
    const before = (await s.hub.journal()).next;
    await pressInFrame('Обновить выписку');
    await s.wait(4000);
    facts['statement'] = (await s.hub.journal(before)).entries.filter((call) => call.route === 'clientOnlyfansPoll').map((call) => call.status);

    // Two tabs of two pages: the second tab, another account's chat, «show on the site» of the first page's sale.
    await escapeInFrame();
    const first = await browser.getWindowHandle();
    await browser.newWindow(new URL(chatPath(STAND_IDS.accounts.b, STAND_IDS.fans.b1), await browser.getUrl()).href, { type: 'tab' });
    await openBoard();
    await waitFrameLog(/доска загружена/);
    await findInFrame(marks[5] ?? '');
    await s.wait(3000);
    const second = await browser.getWindowHandle();
    facts['secondBar'] = await barText();
    facts['secondOverlaps'] = await overlaps(COMPOSER, RAIL);
    await s.shot('second-tab');
    await browser.switchToWindow(first);
    await browser.waitUntil(async () => /Сверка/.test(await barText()) && (await markBox()) !== null, { timeout: 30_000, interval: 300, timeoutMsg: 'the first tab did not frame the row' });
    await s.wait(800);
    facts['firstBar'] = await barText();
    facts['firstVisible'] = await browser.execute(() => document.visibilityState);
    await s.shot('first-tab-framed');
    await browser.switchToWindow(second);
    facts['secondBarAfter'] = await barText();
    writeFacts(s, facts);
  },
  {
    sites: ['chatspace'],
    viewport: VIEWPORT,
    timeout: 240_000,
    before: async ({ hub }) => {
      // The page's own OnlyFans poll on (hub #955), so «Обновить выписку» has a poll to ask for now.
      await hub.command({ op: 'config', patch: { report: { ...REPORT_PULSE }, flags: { ofFeed: true, ofPoll: true } } });
    },
  },
);
