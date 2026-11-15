// The launcher at the bottom of ChatSpace's account rail (2026-11-15, the owner: «боковые эти кнопочки слева снизу на
// чатспейс … чтобы не было разницы между фансли и чатспейсом»; ui-design §3.13): Fansly's corner buttons — «Онлайн»,
// «Очереди», Spenders, «Новые» — as a narrow card of icons right above ChatSpace's version. The stand's account list
// without an open chat (no composer: the application is not loaded), the rail in the dark theme, a button under the
// pointer, the light theme, a short window (the tiles and the «+» keep their place), then a click on Spenders: the
// first click loads the application and the board opens. `rail.json` in the run's folder says where the card stood.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { $, browser } from '@wdio/globals';

import { STAND_IDS, callStand, chatPath, openStand } from '../../support/stand';
import { around, scenario, type Box, type See } from '../kit';

const RAIL = 'nav.account-sidebar';
const SLOT = '[data-host="rail"]';
const VIEWPORT = { width: 1440, height: 900 };
/** A window short enough that the rail's tiles and «+» no longer fit above the card. */
const SHORT = 300;

/** Where the rail's parts stand: the card (its host), the «+», the version, the last tile. */
async function geometry(): Promise<Record<string, Box | string | null>> {
  return browser.execute(() => {
    const box = (node: Element | null): { x: number; y: number; width: number; height: number } | null => {
      if (node === null) return null;
      const { x, y, width, height } = node.getBoundingClientRect();
      return { x, y, width, height };
    };
    const rail = document.querySelector('nav.account-sidebar');
    const host = document.querySelector('[data-host="rail"]');
    const tiles = rail === null ? [] : [...rail.querySelectorAll('.account-tab')];
    return {
      rail: box(rail),
      card: box(host),
      plus: box(rail?.querySelector('.account-sidebar__add') ?? null),
      lastTile: box(tiles.at(-1) ?? null),
      version: box(rail?.lastElementChild ?? null),
      hostBeforeVersion: String(host !== null && host.nextElementSibling === rail?.lastElementChild),
      scheme: host?.getAttribute('data-scheme') ?? null,
    };
  });
}

/** The card is in the rail and drawn: its four buttons in its closed root. */
async function waitCard(): Promise<void> {
  await browser.waitUntil(async () => (await $(SLOT).isExisting()) && (await $(SLOT).shadow$$('button[data-launcher]').getElements()).length === 4, {
    timeout: 20_000,
    interval: 200,
    timeoutMsg: 'no launcher in the rail',
  });
}

/** The whole rail beside the chats list, and its bottom close: the card between the «+» above and the version under it. */
async function shootRail(s: See, name: string): Promise<void> {
  const rail = await s.rect('page', RAIL);
  const card = await s.rect('page', SLOT);
  if (rail === null || card === null) throw new Error('no rail or card to photograph');
  await s.shot(`${name}-rail`, { clip: { x: 0, y: 0, width: 400, height: rail.height } });
  await s.shot(`${name}-corner`, { clip: around([card, { x: 0, y: card.y, width: 380, height: rail.height - card.y }], [180, 0, 0, 0]) });
}

const away = (): Promise<void> => browser.action('pointer').move({ x: 700, y: 400, origin: 'viewport' }).perform();

scenario(
  'chatspace-launcher',
  async (s) => {
    await s.ready();
    // The account's list of chats, no chat open: no composer, so the application is not loaded until a click asks.
    await openStand(chatPath(STAND_IDS.accounts.a));
    await callStand('setTheme', 'dark');
    await waitCard();
    await s.wait(600);
    const measures: Record<string, unknown> = { dark: await geometry() };
    await shootRail(s, 'dark');

    // A button under the pointer: terracotta's chip, as the rows on Fansly.
    await $(SLOT).shadow$('[data-launcher="spenders"]').moveTo();
    await s.wait(400);
    const card = await s.rect('page', SLOT);
    if (card !== null) await s.shot('dark-hover', { clip: around([card], [48, 120, 40, 12]) });
    await away();

    await callStand('setTheme', 'light');
    await s.wait(600);
    measures['light'] = await geometry();
    await shootRail(s, 'light');

    // A short window: the rail's middle gives up its height — the tiles scroll, the «+» stays at the scroller's bottom —
    // and the card stays whole above the version. The stand's tab is sized by its viewport (support/shift.ts).
    const tab = await browser.getWindowHandle();
    await browser.browsingContextSetViewport({ context: tab, viewport: { width: VIEWPORT.width, height: SHORT } });
    await s.wait(600);
    measures['short'] = await geometry();
    await s.shot('light-short', { clip: { x: 0, y: 0, width: 400, height: SHORT } });
    await browser.browsingContextSetViewport({ context: tab, viewport: VIEWPORT });
    await callStand('setTheme', 'dark');
    await s.wait(600);

    // The first click: the application loads for it, and Spenders opens.
    await $(SLOT).shadow$('[data-launcher="spenders"]').click();
    await s.see('modal', 'Потратил', 30_000);
    await away();
    await s.wait(800);
    measures['afterClick'] = await geometry();
    await s.shot('spenders-from-rail');
    writeFileSync(join(s.out, 'rail.json'), `${JSON.stringify(measures, null, 2)}\n`);
  },
  { sites: ['chatspace'], viewport: VIEWPORT },
);
