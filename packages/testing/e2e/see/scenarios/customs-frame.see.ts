// customs-frame: the launcher's «Кастомы» (its last row, for everyone: no pulse needed) opens Workboard's customs screen
// over the site in the extension's frame, on ChatSpace and Fansly (`--site fansly`): the launcher with the row, the
// screen with the requests it made through the background's allow-list (the fake hub's journal), an order opened, a
// request off the list refused (the stub's), Esc folding the frame away (the drawer first on Hub's screen), the row
// bringing it back. The frame is the fake hub's stub (fake-hub/workboard-customs.ts) over the stand's fan cards, or
// Hub's own screen when CG_SEE_FRAME_ORIGIN and CG_SEE_BOARD_API both point at its demo Workboard (`pnpm
// dev:workboard:demo`, e.g. http://127.0.0.1:5190). `report-facts.json` holds what each step saw.

import { $, browser } from '@wdio/globals';

import { STAND_IDS } from '../../support/stand';
import { STAND_PAGE, scenario, type See } from '../kit';
import { escapeInFrame, frameLog, inFrame, launcherButton, layerShown, pointFrames, writeFacts } from '../report';

const HOSTS = {
  fansly: 'div[data-host="overlay"][data-layer="launcher"]',
  chatspace: '[data-host="rail"]',
} as const;
/** The stand's fan of Fansly the orders are written to: the stub lists every card's, whoever's chat is open. */
const FANSLY_FAN = '7400000000000000101';

const ago = (hours: number): string => new Date(Date.now() - hours * 3_600_000).toISOString();
const day = (days: number): string => new Date(Date.now() + days * 86_400_000 + 3 * 3_600_000).toISOString().slice(0, 10);

/** An order of the fan card as Hub sends it (the fan panel's shape, which the stub lists). */
function order(pageLabel: string, id: number, description: string, priceMills: number, label: string, state: string, deadline: string | null, overdue: number | null = null) {
  return {
    id, pageLabel, granted: true, description, priceMills,
    state: state === 'recorded' ? 'ordered' : 'paid',
    paymentMills: null, paidAt: null, deliveredMessageRef: null, deliveredAt: null,
    createdBy: 'Nikita', createdAt: ago(30), deliveryCandidates: [],
    code: `K-${String(id)}`, stepLabel: label, stepAt: ago(5), orderState: state, deadlineOn: deadline, overdueDays: overdue, leader: null, mayGive: false,
  };
}

function cardOf(pageLabel: string, fanRef: string, name: string, platform: string, customs: readonly ReturnType<typeof order>[]) {
  return {
    pageLabel, fanRef, known: true,
    accounts: [{ platform, fanRef, username: null, displayName: name, gone: false, linkedBy: null }],
    pages: [{ pageLabel, platform, modelName: 'Model One', fanRef, granted: true, alias: null, subscribed: true, subscribedSince: null, subscriptionEndsAt: null, spentMills: 248_000, last30Mills: {}, lastPurchaseAt: null }],
    suggestions: [], facts: [], customs, customPayments: [], serverNow: new Date().toISOString(),
  };
}

/** Writes the stand's orders: two fans of the site's page. */
async function seed(s: See): Promise<void> {
  if (s.site === 'fansly') {
    const page = s.world.pages.fansly.pageLabel;
    await s.hub.command({ op: 'fanCard', pageLabel: page, fanRef: FANSLY_FAN, card: cardOf(page, FANSLY_FAN, 'Fan Fansly', 'fansly', [
      order(page, 23, 'Фото в душе, 8 штук', 45_000, 'Снят', 'shot', day(1)),
      order(page, 21, 'Видео 5 минут в красном белье, с его именем', 120_000, 'У модели', 'at_model', day(-2), 2),
      order(page, 22, 'Фотосет в очках, 10 фото', 60_000, 'Записан', 'recorded', day(4)),
    ]) });
    return;
  }
  const { a1, a2 } = STAND_IDS.fans;
  await s.hub.command({ op: 'fanCard', pageLabel: STAND_PAGE, fanRef: a1, card: cardOf(STAND_PAGE, a1, 'Fan Alder', 'onlyfans', [
    order(STAND_PAGE, 13, 'Фото в душе, 8 штук', 45_000, 'Снят', 'shot', day(1)),
    order(STAND_PAGE, 11, 'Видео 5 минут в красном белье, с его именем', 120_000, 'У модели', 'at_model', day(-2), 2),
  ]) });
  await s.hub.command({ op: 'fanCard', pageLabel: STAND_PAGE, fanRef: a2, card: cardOf(STAND_PAGE, a2, 'Fan Birch', 'onlyfans', [
    order(STAND_PAGE, 12, 'Фотосет в очках, 10 фото', 60_000, 'Записан', 'recorded', day(4)),
  ]) });
}

/** The row «Кастомы» of the launcher: drawn and visible, and how many rows show. */
async function customsRow(host: string): Promise<{ readonly shown: boolean; readonly rows: number; readonly last: boolean }> {
  const button = launcherButton(host, 'customs');
  const shown = (await button.isExisting()) && (await button.getAttribute('hidden')) === null;
  const rows = (await $(host).shadow$$('button[data-launcher]:not([hidden])').getElements()).length;
  const last = shown && (await $(host).shadow$('button[data-launcher]:last-child').getAttribute('data-launcher')) === 'customs';
  return { shown, rows, last };
}

/** The frame's text, its whitespace folded. */
const frameText = (): Promise<string> => inFrame(async () => browser.execute(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 900)));

scenario(
  'customs-frame',
  async (s) => {
    const host = s.site === 'fansly' ? HOSTS.fansly : HOSTS.chatspace;
    const demo = (process.env['CG_SEE_FRAME_ORIGIN'] ?? '') !== '';
    const facts: Record<string, unknown> = { demo };
    await s.ready();
    await seed(s);
    await pointFrames(s);
    await s.ready();
    await browser.waitUntil(async () => (await customsRow(host)).shown, { timeout: 30_000, interval: 300, timeoutMsg: 'no row «Кастомы» in the launcher' });
    facts['launcher'] = await customsRow(host);
    const card = await s.rect('page', host);
    if (card !== null) {
      const clip = s.site === 'fansly'
        ? { x: 0, y: Math.max(0, card.y - 40), width: 360, height: card.height + 56 }
        : { x: 0, y: Math.max(0, card.y - 160), width: 420, height: card.height + 200 };
      await s.shot('launcher', { clip });
    }
    await launcherButton(host, 'customs').moveTo();
    await s.wait(900);
    if (card !== null) await s.shot('launcher-hover', { clip: { x: 0, y: Math.max(0, card.y - 80), width: 420, height: card.height + 120 } });

    const since = (await s.hub.journal()).next;
    await launcherButton(host, 'customs').click();
    await browser.waitUntil(layerShown, { timeout: 30_000, interval: 200, timeoutMsg: 'the customs screen did not show' });
    await browser.waitUntil(async () => (demo ? /Сроки/ : /заказы загружены/).test(await frameText().catch(() => '')), { timeout: 30_000, interval: 400, timeoutMsg: 'the customs screen did not read its orders' });
    await s.wait(demo ? 2500 : 400);
    facts['frameUrl'] = await inFrame(async () => browser.execute(() => location.href));
    facts['frameText'] = await frameText();
    await s.shot('customs');

    // An order: the drawer of Hub's screen, the stub's line.
    const opened = await inFrame(async () => {
      const row = browser.$(demo ? 'button.cf-row' : 'tr[data-code] td');
      if (!(await row.isExisting())) return false;
      await row.click();
      return true;
    });
    await s.wait(demo ? 2500 : 900);
    facts['order'] = { opened, text: demo ? await frameText() : await frameLog() };
    await s.shot('order');

    if (!demo) {
      await inFrame(async () => {
        await browser.$('#refused').click();
      });
      await s.wait(900);
      facts['refused'] = await frameLog();
    } else {
      // The drawer takes the first Esc, the screen the next.
      facts['escapeDrawer'] = await escapeInFrame();
      await s.wait(700);
      facts['afterDrawerEsc'] = { layer: await layerShown(), drawer: await inFrame(async () => browser.execute(() => document.querySelector('[role="dialog"]') !== null)) };
    }
    facts['escape'] = await escapeInFrame();
    await browser.waitUntil(async () => !(await layerShown()), { timeout: 10_000, timeoutMsg: 'Esc did not fold «Кастомы»' }).catch(() => undefined);
    await s.wait(700);
    facts['folded'] = { layer: await layerShown() };
    await s.shot('folded');

    await launcherButton(host, 'customs').click();
    await browser.waitUntil(layerShown, { timeout: 10_000, interval: 200, timeoutMsg: 'the row did not bring «Кастомы» back' });
    await s.wait(900);
    facts['again'] = { layer: await layerShown() };
    facts['throughPort'] = (await s.hub.journal(since)).entries
      .filter((call) => (call.operation ?? '').startsWith('workboard-customs:') || (call.operation ?? '').startsWith('report-board:') || call.path.startsWith('/api/v1/'))
      .map((call) => `${call.method} ${call.path} ${String(call.status)}`);
    await s.shot('again');
    writeFacts(s, facts);
  },
  { sites: ['chatspace', 'fansly'], timeout: 180_000 },
);
