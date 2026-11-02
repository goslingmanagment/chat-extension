// A fan who is on other pages of the agency too (hub `otherPages`), one mark beside the name: «Онлайн» on both sites,
// «Новые» on ChatSpace (Fansly's «Новые» are a pass over Fansly's own API, no hub answer carries it), and Fansly's chat
// header with its card. Money, a word with no money, several pages in the tooltip, a long name; light and dark.

import { $, browser } from '@wdio/globals';

import { PAGE } from '../../../src/scenarios/hub';
import { callFansly } from '../../support/fansly-stand';
import { STAND_IDS } from '../../support/stand';
import { around, scenario, type Box, type See } from '../kit';

const wrote = (days: number): string => new Date(Date.now() - days * 86_400_000).toISOString();
const ONE = [{ pageLabel: 'mia-vip', grossMills: 1_653_000, lastFanMessageAt: wrote(5), relation: 'subscriber' as const }];
const TALKS = [{ pageLabel: 'ella-moon', grossMills: 0, lastFanMessageAt: wrote(12), relation: 'follower' as const }];
const TWO = [{ pageLabel: 'ella-moon', grossMills: 412_500, lastFanMessageAt: null, relation: null }, { pageLabel: 'mia-vip', grossMills: 87_000, lastFanMessageAt: wrote(40), relation: 'follower' as const }];
const THREE = [{ pageLabel: 'mia-vip', grossMills: 12_480_000, lastFanMessageAt: wrote(2), relation: 'subscriber' as const }, { pageLabel: 'ella-moon', grossMills: 2_310_000, lastFanMessageAt: wrote(30), relation: 'follower' as const }, { pageLabel: 'sofia-lane', grossMills: 0, lastFanMessageAt: wrote(64), relation: null }];
const LONG = [{ pageLabel: 'model-three-fansly', grossMills: 12_480_000, lastFanMessageAt: wrote(9), relation: 'subscriber' as const }, { pageLabel: 'ella-moon', grossMills: 95_000, lastFanMessageAt: null, relation: null }];

const SLOT = '[data-host="header-slot"][data-header-order="30"]';
const HEADER = '.message-content-header-contact';

/** The stand's Fansly fan of index `index` (fixture-fansly data.ts `fanOf`). */
const standFan = (index: number): string => String(920_000_000_000_000_000n + BigInt(index * 29 + 3));

/** The list: a cold follower, a long name beside a long page, several pages, money here too, and a fan with no mark. */
async function seedOnline(s: See): Promise<void> {
  const ids = s.site === 'fansly' ? [0, 9, 3, 5, 8].map(standFan) : [STAND_IDS.fans.a2, STAND_IDS.fans.a5, STAND_IDS.fans.a6, STAND_IDS.fans.a7, STAND_IDS.fans.a3];
  const fans = [
    { username: 'mike_dallas', displayName: 'Mike', otherPages: TALKS, lifetimeGrossMills: 0, reason: 'never_wrote', act: 'template_b' },
    s.showcase
      ? { username: 'chris_w', displayName: 'Chris', otherPages: ONE, lifetimeGrossMills: 0, reason: 'never_wrote', act: 'template_b' }
      : { username: 'the_very_long_handle_of_a_fan_2026', displayName: 'Christopher Alexander Montgomery the Third', otherPages: LONG, lifetimeGrossMills: 0, reason: 'never_wrote', act: 'template_b' },
    { username: 'northstar77', displayName: 'Daniel', otherPages: THREE, lifetimeGrossMills: 0, reason: 'quiet', act: 'template_a', messageCount: 3 },
    { username: 'quietguy', displayName: 'Jack', otherPages: TWO, lifetimeGrossMills: 560_000, reason: 'silent', act: 'ping', messageCount: 10 },
    { username: 'sam_k', displayName: 'Sam', lifetimeGrossMills: 45_000, reason: 'quiet', act: 'template_a', messageCount: 3 },
  ];
  await s.hub.command({
    op: 'online',
    pageLabel: s.site === 'fansly' ? s.world.pages.fansly.pageLabel : PAGE,
    items: fans.map((fan, at) => ({ fanRef: ids[at] ?? '', seenAgoMs: (at + 1) * 60_000, lastFanMessageAt: new Date(Date.now() - (76 + at * 41) * 86_400_000).toISOString(), ...fan })),
  });
}

/** ChatSpace: our setting. Fansly: the page's own theme, which ours follows. */
async function setTheme(s: See, theme: 'light' | 'dark'): Promise<void> {
  if (s.site === 'fansly') await callFansly('setTheme', theme === 'dark' ? 'dark' : 'bright');
  else {
    const patched = await s.rpc('settings.patch', { patch: { ui: { theme } }, baseRevision: null });
    if (!patched.ok) throw new Error(`settings.patch: ${patched.error.code}`);
  }
  await s.browser.pause(400);
}

async function patchText(s: See, textSize: 'normal' | 'large'): Promise<void> {
  const patched = await s.rpc('settings.patch', { patch: { ui: { textSize } }, baseRevision: null });
  if (!patched.ok) throw new Error(`settings.patch: ${patched.error.code}`);
  await s.browser.pause(400);
}

async function pointerAway(s: See): Promise<void> {
  await s.browser.action('pointer').move({ x: 2, y: 2, origin: 'viewport' }).perform();
  await s.browser.pause(300);
}

async function openOnline(s: See): Promise<void> {
  await s.browser.waitUntil(() => s.has('dock', '.cg-act__n'), { timeout: 30_000, interval: 300, timeoutMsg: 'no «Онлайн N» on the bar' });
  await s.press(/Онлайн/, 'dock', '.cg-strip button');
  await s.see('modal', 'К разбору', 20_000);
  // The list says «Все онлайн» too: the marks are in both.
  await s.browser.waitUntil(() => s.has('modal', '[data-cg-other-pages]'), { timeout: 20_000, interval: 300, timeoutMsg: 'no mark in the rows' });
  await s.browser.pause(800);
  await pointerAway(s);
}

async function shootList(s: See, name: string): Promise<void> {
  const list = await s.rect('modal', '.cg-nw__side');
  await s.shot(name, list === null ? {} : { clip: { ...list, height: Math.min(list.height, 640) } });
}

/** The tooltip of the row with three pages. */
async function shootTooltip(s: See, name: string): Promise<void> {
  await s.h.ours('modal', '[data-cg-other-pages="3"]').moveTo();
  await s.browser.pause(900);
  const list = await s.rect('modal', '.cg-nw__side');
  await s.shot(name, list === null ? {} : { clip: { ...list, x: list.x - 48, width: list.width + 168, height: Math.min(list.height, 640) } });
  await pointerAway(s);
}

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

async function shootHeader(s: See, name: string, card: boolean): Promise<void> {
  const boxes = [await s.rect('page', HEADER), await marksRect('.cg-fm'), card ? await marksRect('[data-fan-marks-card]') : null];
  await s.shot(name, { clip: around(boxes, [10, 16, 14, 16]) });
}

scenario(
  'other-pages',
  async (s) => {
    await s.ready();
    await seedOnline(s);
    await setTheme(s, 'light');
    if (s.site === 'fansly') {
      await s.browser.waitUntil(async () => (await $(SLOT).isExisting()) && (await $(SLOT).shadow$('[data-fan-mark="other"]').isExisting()), { timeout: 20_000, interval: 200, timeoutMsg: 'no mark in the header' });
      await shootHeader(s, 'header-several-light', false);
      await $(SLOT).shadow$('[data-fan-mark="other"]').click();
      await s.browser.waitUntil(async () => $(SLOT).shadow$('[data-fan-marks-card="other"]').isExisting(), { timeout: 5_000, timeoutMsg: 'no card' });
      await s.browser.pause(200);
      await shootHeader(s, 'header-several-card-light', true);
      await s.browser.keys('Escape');
      await s.browser.execute(() => (document.activeElement as HTMLElement | null)?.blur());
    } else await s.leaveField();

    await openOnline(s);
    await shootList(s, 'online-rows-light');
    // The note's picture (`--showcase`): the list, a mark's tooltip open.
    if (s.showcase) {
      await s.h.ours('modal', '[data-cg-other-pages="3"]').moveTo();
      await s.browser.pause(900);
      const list = await s.rect('modal', '.cg-nw__side');
      // The bubble stands centred on the mark and reaches past the list's left edge.
      if (list !== null) await s.shot('note', { clip: { ...list, x: list.x - 48, width: list.width + 48, height: Math.min(list.height, 560) }, file: 'other-pages-mark' });
      await pointerAway(s);
    }
    await shootTooltip(s, 'online-tooltip-light');
    await s.shot('online-window-light');
    await setTheme(s, 'dark');
    await shootList(s, 'online-rows-dark');
    // The smaller text size (a choice, «Крупнее» is the default): the narrower list, the mark on its line.
    await patchText(s, 'normal');
    await shootList(s, 'online-rows-normal-dark');
    await patchText(s, 'large');
    await s.browser.keys('Escape');

    if (s.site === 'chatspace') {
      await s.keys(s.MOD, 'k');
      await s.press(/^Новые/, 'modal', '.cg-pal__item');
      await s.see('modal', 'mike_dallas');
      await s.browser.waitUntil(() => s.has('modal', '[data-cg-other-pages]'), { timeout: 20_000, interval: 300, timeoutMsg: 'no mark in «Новые»' });
      await s.browser.pause(500);
      await pointerAway(s);
      await shootList(s, 'newcomers-rows-dark');
      await setTheme(s, 'light');
      await shootList(s, 'newcomers-rows-light');
      await s.shot('newcomers-window-light');
      await s.h.ours('modal', '[data-cg-other-pages="3"]').moveTo();
      await s.browser.pause(900);
      await shootList(s, 'newcomers-tooltip-light');
    } else {
      await s.browser.waitUntil(async () => (await $(SLOT).isExisting()) && (await $(SLOT).shadow$('[data-fan-mark="other"]').isExisting()), { timeout: 20_000, interval: 200, timeoutMsg: 'no mark in the header' });
      await shootHeader(s, 'header-several-dark', false);
      await setTheme(s, 'light');
      // The stand's second chat: no warning, the money alone.
      await callFansly('open', s.world.fansly.chats.b.group);
      await s.browser.waitUntil(async () => (await $(SLOT).isExisting()) && (await $(SLOT).shadow$('[data-fan-mark="other"]').isExisting()), { timeout: 20_000, interval: 200, timeoutMsg: 'no mark in the second chat' });
      await s.browser.pause(300);
      await shootHeader(s, 'header-one-light', false);
    }
  },
  {
    previewSend: true,
    before: async ({ hub }) => {
      const { a2, a5, a6, a7 } = STAND_IDS.fans;
      await hub.command({ op: 'config', patch: { onlineStand: false } });
      await hub.command({ op: 'audienceEvent', pageLabel: PAGE, fanRef: a2, username: 'mike_dallas', displayName: 'Mike', otherPages: TALKS });
      await hub.command({ op: 'audienceEvent', pageLabel: PAGE, fanRef: a5, username: 'the_very_long_handle_of_a_fan_2026', displayName: 'Christopher Alexander Montgomery the Third', otherPages: LONG });
      await hub.command({ op: 'audienceEvent', pageLabel: PAGE, fanRef: a6, username: 'northstar77', displayName: 'Daniel', otherPages: THREE });
      await hub.command({ op: 'audienceEvent', pageLabel: PAGE, fanRef: a7, username: 'sam_k', displayName: 'Sam' });
    },
    sites: ['chatspace', 'fansly'],
  },
);
