// Fans the page no longer sees (2026-11-12, hub `fan-account-state-v1`): in Spenders «удалён», «заблокировал», «не виден»
// in place of the @handle, the rows muted, «· N ушли» in the header, «Ушедшие» in «Фильтр» and «Только они»; the cards
// of «заблокировал» and «удалён»; the mark in Fansly's chat header. On Fansly (the default) the hub's seeds give a fan
// deleted with a known start, one deleted before starts were kept, one who blocked the page (the stand's third chat,
// whose account the stand's Fansly no longer returns: its header first), one the hub has not named a cause for, and one
// the hub never asked about whom the stand's Fansly does not know: the extension's own read marks him «не виден» at
// once. On ChatSpace (`--site chatspace`, OnlyFans) the stand's own fans, the third «удалён», the sixth «в блоке». Both
// worlds: `--showcase` names the stand's chats as the showcase does (the note's pictures).

import { $, browser } from '@wdio/globals';

import { standGroupId } from '../../../fixture-fansly/src/data';
import { SHOWCASE_CONVERSATIONS } from '../../../fixture-fansly/src/showcase';
import { WORLD } from '../../../src/scenarios/hub';
import { SHOWCASE } from '../../../src/showcase';
import type { SpenderSeed } from '../../../src/fake-hub/types';
import { callFansly, fakeFansly } from '../../support/fansly-stand';
import { STAND_SPENDERS } from '../../support/world';
import { around, scenario, type Box, type See } from '../kit';

const DAY = 86_400;
const HOUR = 3_600;
const { a, b } = WORLD.fansly.chats;
/** The stand's third chat (fixture-fansly data.ts: groups 13·i+1, fans 29·i+3): its fan blocked the page. */
const C = { group: standGroupId(2), fan: '920000000000000061' } as const;
/** Fans the stand's Fansly does not know (its fans are 92…): their accounts are never returned. */
const GONE = { since: '980000000000000901', unknownSince: '980000000000000902', unchecked: '980000000000000903', local: '980000000000000904' } as const;

/** A stand chat's fan by the showcase's names in that world, else the plain one. */
const named = (index: number, plain: string): Pick<SpenderSeed, 'displayName' | 'username'> => {
  const showcase = SHOWCASE ? SHOWCASE_CONVERSATIONS[index] : undefined;
  return showcase === undefined ? { displayName: plain } : { displayName: showcase.displayName, username: showcase.username };
};

const fanslyFans = (): SpenderSeed[] => [
  { fanRef: a.fan, ...named(0, 'Hub Whale'), lifetimeUsd: 1_200, windowUsd: 300, account: { state: 'seen', sinceAgoSec: null, checkedAgoSec: 2 * HOUR } },
  { fanRef: C.fan, ...named(2, 'Hub Birch'), lifetimeUsd: 980, windowUsd: 40, awaiting: true, fanWroteAgoSec: 2 * HOUR, account: { state: 'blocked', sinceAgoSec: 4 * DAY, checkedAgoSec: 3 * HOUR } },
  { fanRef: GONE.since, displayName: 'Azure', username: 'azure086', lifetimeUsd: 820, windowUsd: null, fanWroteAgoSec: 12 * DAY, account: { state: 'deleted', sinceAgoSec: 9 * DAY, checkedAgoSec: DAY } },
  { fanRef: b.fan, ...named(1, 'Hub Cove'), lifetimeUsd: 700, windowUsd: 120, fanWroteAgoSec: 6 * HOUR },
  { fanRef: GONE.unknownSince, displayName: 'Marten', username: 'marten_k', lifetimeUsd: 640, windowUsd: null, fanWroteAgoSec: 40 * DAY, account: { state: 'deleted', sinceAgoSec: null, checkedAgoSec: 2 * DAY } },
  { fanRef: GONE.unchecked, displayName: 'Rowan', username: 'rowan.j', lifetimeUsd: 410, windowUsd: 25, awaiting: true, fanWroteAgoSec: 5 * HOUR, account: { state: 'unchecked', sinceAgoSec: null, checkedAgoSec: HOUR } },
  { fanRef: GONE.local, displayName: 'Cedar', username: 'cedar_w', lifetimeUsd: 260, windowUsd: null, fanWroteAgoSec: 3 * DAY, account: null },
];

const SLOT = '[data-host="header-slot"][data-header-order="30"]';
const HEADER = '.message-content-header-contact';

const box = (node: Element): Box => {
  const { x, y, width, height } = node.getBoundingClientRect();
  return { x, y, width, height };
};
async function marksRect(selector: string): Promise<Box | null> {
  const host = $(SLOT);
  if (!(await host.isExisting())) return null;
  const [node] = await host.shadow$$(selector).getElements();
  return node === undefined ? null : ((await browser.execute(box, node as unknown as Element)) as Box);
}

/** The pointer off our window: no tooltip of the last press stands in the picture. */
async function still(s: See): Promise<void> {
  await s.browser.action('pointer').move({ x: 2, y: 2, origin: 'viewport' }).perform();
  await s.browser.pause(400);
}

/** The header of the board, cut to its first line: the count «· N ушли». */
async function headShot(s: See, name: string): Promise<void> {
  const head = await s.rect('modal', '.cg-sp__head');
  if (head !== null) await s.shot(name, { clip: around([head], [6, 8, 6, 8]) });
}

/** The board from its title to the last row, without the empty list below (the note's picture). */
async function boardShot(s: See, name: string, file: string): Promise<void> {
  const top = await s.rect('modal', '.cg-sp__top');
  const rows = await s.rect('modal', '.cg-bd__scroll');
  // The rows of the virtual list: the lowest one drawn.
  const drawn: Box[] = [];
  for (const node of Array.from(await s.h.allOurs('modal', '.cg-bd__row[data-cg-key]').getElements())) drawn.push((await browser.execute(box, node as unknown as Element)) as Box);
  const bottom = Math.max(...drawn.map((row) => row.y + row.height));
  if (top === null || rows === null || drawn.length === 0) {
    await s.shot(name);
    return;
  }
  await s.shot(name, { clip: { x: top.x, y: top.y, width: top.width, height: Math.min(rows.y + rows.height, bottom + 12) - top.y }, file });
}

async function openSpenders(s: See, first: string): Promise<void> {
  await s.keys(...s.PANEL, 'm');
  await s.see('modal', first, 20_000);
}

/** Hover a row's mark: its card (the kit's tooltip), then the row and the card cut 1:1. */
async function hoverMark(s: See, state: string, name: string): Promise<void> {
  await (await s.h.ours('modal', `.cg-bd__who [data-cg-gone="${state}"]`)).moveTo();
  await s.browser.waitUntil(async () => (await s.rect('modal', '.cg-tip')) !== null && (await s.text('modal', '.cg-tip')).length > 0, { timeout: 5_000, interval: 150, timeoutMsg: 'no card of the mark' });
  await s.browser.pause(500);
  const row = await s.rect('modal', `.cg-bd__row:has([data-cg-gone="${state}"])`);
  await s.shot(name, { clip: around([row, await s.rect('modal', '.cg-tip')], [8, 12, 8, 12]) });
}

scenario(
  'spenders-gone',
  async (s) => {
    await s.ready();
    if (s.site === 'fansly') {
      // Out of Fansly's field: our key is a command there, not text.
      await s.browser.execute(() => (document.activeElement as HTMLElement | null)?.blur());
      const fans = fanslyFans();
      await s.hub.command({ op: 'spenderFans', fans });
      await s.hub.command({ op: 'config', patch: { spendersTotal: fans.length } });
      // The third chat's fan blocked the page: the page's session no longer gets his account.
      await fakeFansly().command({ op: 'gone', accountIds: [C.fan] });

      // His chat: the header's mark and its card.
      await callFansly('open', C.group);
      await browser.waitUntil(async () => (await $(SLOT).isExisting()) && (await $(SLOT).shadow$('[data-fan-mark="gone"]').isExisting()), { timeout: 20_000, interval: 200, timeoutMsg: 'no mark in the header' });
      const header = await s.rect('page', HEADER);
      await s.shot('header-gone', { clip: around([header, await marksRect('.cg-fm')], [10, 16, 14, 16]) });
      await $(SLOT).shadow$('[data-fan-mark="gone"]').moveTo();
      await browser.waitUntil(async () => $(SLOT).shadow$('[data-fan-marks-card="gone"]').isExisting(), { timeout: 5_000, timeoutMsg: 'no card of the header mark' });
      await browser.pause(300);
      await s.shot('header-gone-card', { clip: around([header, await marksRect('.cg-fm'), await marksRect('[data-fan-marks-card]')], [10, 16, 14, 16]), file: 'spenders-gone-fans-header' });
      await $(HEADER).moveTo({ xOffset: -40, yOffset: 0 });
      await s.browser.execute(() => (document.activeElement as HTMLElement | null)?.blur());

      // Spenders: the hub's three causes and the local «не виден» (the background's read of the shown fans).
      await openSpenders(s, 'Потратил');
      await s.browser.waitUntil(() => s.has('modal', '[data-cg-gone="unchecked"][data-cg-gone-local]'), { timeout: 30_000, interval: 300, timeoutMsg: 'no local «не виден»' });
      await still(s);
      await boardShot(s, 'spenders-gone-fansly', 'spenders-gone-fans');
      await headShot(s, 'head-count');
      await hoverMark(s, 'blocked', 'blocked-card');
      await hoverMark(s, 'deleted', 'deleted-card');
      await still(s);

      // «Фильтр»: the group «Ушедшие»; then «Только они».
      await s.press(/^Фильтр/, 'modal', '.cg-choice');
      await s.browser.waitUntil(() => s.has('modal', '.cg-menu__sec'), { timeout: 5_000, interval: 150, timeoutMsg: 'no group «Ушедшие»' });
      await s.browser.pause(300);
      const menu = await s.rect('modal', '.cg-sp__filters .cg-menu');
      await s.shot('filter-menu', { clip: around([await s.rect('modal', '.cg-sp__filters'), menu], [8, 12, 8, 12]) });
      await s.press(/^Только они/, 'modal', '.cg-menu__item');
      await s.browser.waitUntil(async () => !(await s.has('modal', '[data-cg-fan]:not(:has([data-cg-gone]))')), { timeout: 10_000, interval: 200, timeoutMsg: '«Только они» kept a seen fan' });
      await still(s);
      await s.shot('spenders-gone-only');
      return;
    }

    // ChatSpace (OnlyFans): the stand's fans, the third deleted, the sixth in the page's block list.
    await s.hub.command({
      op: 'spenderFans',
      fans: STAND_SPENDERS.map((seed, index) =>
        index === 2 ? { ...seed, account: { state: 'deleted', sinceAgoSec: 6 * DAY, checkedAgoSec: 5 * HOUR } } : index === 5 ? { ...seed, account: { state: 'blocked', sinceAgoSec: 2 * DAY, checkedAgoSec: 5 * HOUR } } : seed,
      ),
    });
    await s.leaveField();
    await openSpenders(s, 'Потратил');
    await s.browser.waitUntil(() => s.has('modal', '[data-cg-gone="blocked"]'), { timeout: 20_000, interval: 300, timeoutMsg: 'no «в блоке»' });
    await still(s);
    await s.shot('spenders-gone-chatspace');
    await headShot(s, 'head-count-chatspace');
    await hoverMark(s, 'blocked', 'blocked-card-chatspace');
    await hoverMark(s, 'deleted', 'deleted-card-chatspace');
  },
  { sites: ['fansly', 'chatspace'] },
);
