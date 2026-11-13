// Fansly: the filters above the chats (2026-11-13), on the stand's copy of Fansly's chips. The set of the owner's
// screenshot first — All 22, Subscribers 1, three tiers («my boyfriend» 1), VIPs, Followers 10, five spend steps
// ($250-500 2), «💩 Бомж», «⏳ Кастом» 2, «🟡 Потенциал» 8 — with FBuddy's stand-in beside it: Fansly's own chips
// («Как в Fansly»), then «Две полки» (every popover: «ещё N», «⋯», the picker, the question before unpinning; a tier and
// a list picked), «много всего» (6 tiers, 12 own lists, 7 steps with a gap and an open one, 4 other [FB] lists, Staff,
// 99+), the 400 px column and Fansly's chips without FBuddy; then «Четыре группы» (both menus, the question, a
// remembered tier and list, «много всего», 400 px) and the settings row. Invented fans only.

import { $, browser } from '@wdio/globals';

import { readReport } from '../../support/extension';
import { setFanslyNeighbor } from '../../support/fansly-neighbor';
import { callFansly, fakeFansly, fanslyStandUrl, waitForFanslyStandReady } from '../../support/fansly-stand';
import { openOptions, waitForOptions } from '../../support/pages';
import { around, scenario, type See } from '../kit';

const LIST = '.messages-list-wrapper';
const STRIP = '[data-host="inbox-slot"][data-inbox-order="5"]';

interface FiltersReport {
  readonly strip: string | null;
  readonly mode: 'shelves' | 'groups' | null;
  readonly refused: string | null;
  readonly tiers: number;
  readonly lists: number;
  readonly steps: number;
  readonly active: string | null;
  readonly fallback: boolean;
  readonly mounted: boolean;
}

async function filtersReport(): Promise<FiltersReport | null> {
  const report = (await readReport()) as unknown as { filters?: FiltersReport } | null;
  return report?.filters ?? null;
}

async function waitFilters(test: (report: FiltersReport) => boolean, what: string, timeout = 15_000): Promise<FiltersReport> {
  let last: FiltersReport | null = null;
  await browser
    .waitUntil(
      async () => {
        last = await filtersReport();
        return last !== null && test(last);
      },
      { timeout, interval: 100 },
    )
    .catch(() => {
      throw new Error(`${what}; last: ${JSON.stringify(last)}`);
    });
  return last as unknown as FiltersReport;
}

const TIERS = [
  { name: '⋆˙⟡ my friend ⋆˙⟡', color: '#4781b4' },
  { name: '₊˚♡˚₊ my bff ₊˚♡˚₊', color: '#46a7f9' },
  { name: '꒰ა . ა꒱ my boyfriend ꒰ა . ა꒱', color: '#5736dc' },
];
const MORE_TIERS = [...TIERS, { name: '✧ my husband ✧', color: '#e0a13a' }, { name: '♛ VIP lounge ♛', color: '#d94f8a' }, { name: '☾ inner circle ☽', color: '#3cb38a' }];
const STEPS = ['[FB] $0-$50 Spenders', '[FB] $50-$100 Spenders', '[FB] $100-$250 Spenders', '[FB] $250-$500 Spenders', '[FB] $500-$1000 Spenders'];
const OWN = ['💩 Бомж', '⏳ Кастом', '🟡 Потенциал'];

/** The owner's screenshot: lists in pin order — five steps, then the agency's three. */
const SHOT_LISTS = [...STEPS, ...OWN].map((label) => ({ label, itemCount: 12 }));
const [S0, S50, S100, S250, S500, BOMZH, CUSTOM, POTENTIAL] = [0, 1, 2, 3, 4, 5, 6, 7];

/**
 * Fans by their place in the inbox: All 22, Followers 10, «Потенциал» 8 (one of them also in $250-500: «Списки» counts
 * that chat once, 10), «Кастом» 2, $250-500 2, «my boyfriend» 1; the rest of the lists have fans with nothing unread.
 */
const SHOT_FANS = [
  { at: 2, unread: 6 },
  { at: 3, follower: true, unread: 3, lists: [POTENTIAL] },
  { at: 4, tier: 2, unread: 1 },
  { at: 5, follower: true, unread: 2, lists: [CUSTOM] },
  { at: 6, follower: true, unread: 2, lists: [POTENTIAL] },
  { at: 7, unread: 2, lists: [S250, POTENTIAL] },
  { at: 8, follower: true, unread: 1, lists: [POTENTIAL] },
  { at: 9, unread: 3 },
  { at: 10, follower: true, unread: 2 },
  { at: 11, lists: [S0, BOMZH] },
  { at: 12, lists: [S50] },
  { at: 13, lists: [S100, BOMZH], tier: 0 },
  { at: 14, lists: [S500], tier: 1, vip: true },
  { at: 15, lists: [CUSTOM] },
];

/** «Много всего»: six tiers, twelve own lists, seven steps (a gap at $100-250, an open one), four other [FB] lists, Staff, 99+. */
const MANY_OWN = ['💩 Бомж', '⏳ Кастом', '🟡 Потенциал', '🔥 Писали на этой неделе', '🐳 Киты', '💤 Спящие', '🎁 Ждёт подарок', '🚫 Не писать', '🆕 Новенькие', '🧊 Холодные', 'Вернуть в подписку', '📸 Хотят кастом фото и видео'];
const MANY_FB = ['[FB] Top 1% Spenders', '[FB] Auto-Renew OFF', '[FB] New Followers', '[FB] Recently Messaged'];
const MANY_STEPS = ['[FB] $0-$50 Spenders', '[FB] $50-$100 Spenders', '[FB] $250-$500 Spenders', '[FB] $500-$1000 Spenders', '[FB] $1000-$2500 Spenders', '[FB] $2500-$5000 Spenders', '[FB] $5000+ Spenders'];
const MANY_LISTS = [...MANY_STEPS.slice(0, 4), ...MANY_OWN.slice(0, 3), MANY_FB[0], ...MANY_OWN.slice(3, 6), MANY_FB[1], ...MANY_OWN.slice(6, 9), MANY_FB[2], ...MANY_OWN.slice(9), MANY_FB[3], ...MANY_STEPS.slice(4)].map((label) => ({ label: label as string, itemCount: 7 }));
const listAt = (label: string): number => MANY_LISTS.findIndex((list) => list.label === label);
const MANY_FANS = [
  { at: 2, unread: 120, follower: true, lists: [listAt('🟡 Потенциал'), listAt('[FB] $500-$1000 Spenders')] },
  { at: 3, unread: 4, tier: 3, lists: [listAt('🔥 Писали на этой неделе')] },
  { at: 4, unread: 2, tier: 5, lists: [listAt('🧊 Холодные')] },
  { at: 5, unread: 3, staff: true },
  { at: 6, unread: 1, lists: [listAt('📸 Хотят кастом фото и видео'), listAt('[FB] $5000+ Spenders')] },
  { at: 7, unread: 2, vip: true, tier: 1, lists: [listAt('[FB] Top 1% Spenders')] },
  // Unread in a chat beyond the list's first page: Fansly's All counts it, its lists cannot (the chat is not loaded).
  { at: 60, unread: 3, old: true, lists: [listAt('🟡 Потенциал')] },
];

async function setStrip(s: See, strip: 'shelves' | 'groups' | 'native'): Promise<void> {
  // The background's Fansly module may still be on its way right after the start: asked again for a few seconds.
  for (let tries = 0; ; tries += 1) {
    try {
      const written = await s.rpc('fansly.settings.write', { patch: { hosts: { 'fansly-web': { filterStrip: strip } } } });
      if (!written.ok) throw new Error(`the strip was not written: ${written.error.code}`);
      return;
    } catch (error) {
      if (tries >= 20 || !String(error).includes('no answer')) throw error;
      await browser.pause(500);
    }
  }
}

/** Fansly's theme the world loads in: dark, then the light pass (the owner's theme). */
let theme: 'dark' | 'bright' = 'dark';

/** The world's chips and fans, then the list of chats loaded anew (no chat open: nothing is read by opening it). */
async function world(command: Record<string, unknown>): Promise<void> {
  await fakeFansly().command({ op: 'filters', clearUnread: true, ...command } as never);
  await browser.url(fanslyStandUrl('/messages'));
  await waitForFanslyStandReady();
  await callFansly('setTheme', theme);
}

async function shootColumn(s: See, name: string, height = 420): Promise<void> {
  const list = await s.rect('page', LIST);
  await s.shot(name, list === null ? {} : { clip: around([{ ...list, height: Math.min(list.height, height) }]) });
}

/** A control of ours in the strip (or the search row's refresh), pressed as a person presses it. */
async function press(selector: string, where = STRIP): Promise<void> {
  const node = $(where).shadow$(selector);
  await node.waitForExist({ timeout: 5_000 });
  await node.click();
  await browser.pause(250);
}

async function hover(selector: string, where = STRIP): Promise<void> {
  const node = $(where).shadow$(selector);
  await node.waitForExist({ timeout: 5_000 });
  await node.moveTo();
  await browser.pause(600);
}

async function away(): Promise<void> {
  await browser.action('pointer', { parameters: { pointerType: 'mouse' } }).move({ x: 1400, y: 880, origin: 'viewport' }).perform();
  await browser.pause(150);
}

scenario(
  'fansly-filters',
  async (s) => {
    await s.ready();
    // The settings page answers the scenario's writes of the setting (`s.rpc` asks from it).
    await s.toPages();
    await openOptions('appearance');
    await waitForOptions((state) => state.section === 'appearance' && !state.loading, 'the appearance section');
    await s.toChat();
    await callFansly('setTheme', 'dark');
    const context = await browser.getWindowHandle();
    await setFanslyNeighbor({ mode: 'after' });

    // ── «Как в Fansly»: Fansly's own chips of the owner's set, beside FBuddy ──
    await setStrip(s, 'native');
    await world({ tiers: TIERS, lists: SHOT_LISTS, fans: SHOT_FANS });
    await waitFilters((report) => report.strip === 'native' && report.refused === null && report.lists === 3 && report.steps === 5, 'Fansly’s chips did not read');
    await browser.pause(500);
    await shootColumn(s, 'native');

    // ── «Две полки» ──
    await setStrip(s, 'shelves');
    await waitFilters((report) => report.mode === 'shelves' && report.mounted, 'no «Две полки»');
    await browser.pause(400);
    await shootColumn(s, 'shelves');
    // Fansly's sort menu opens down over the strip: it stands above ours, its items take the clicks.
    await $('.message-search .transparent-dropdown .dropdown-title').click();
    await browser.pause(250);
    await shootColumn(s, 'shelves-under-sort-menu');
    await $('.message-search .transparent-dropdown .dropdown-title').click();
    await browser.pause(150);
    await hover('[data-cg-filter="tier:2"]');
    await shootColumn(s, 'shelves-hover');
    await away();
    await press('[data-cgf-key="more"]');
    await shootColumn(s, 'shelves-menu');
    await press('[data-cgf-focus="a:pick"]');
    await shootColumn(s, 'shelves-unpin-pick');
    await press('[data-cgf-focus="p:list:6"]');
    await shootColumn(s, 'shelves-unpin-confirm');
    await browser.keys('Escape');
    await browser.pause(200);
    await press('[data-cg-filter="tier:2"]');
    await waitFilters((report) => report.active === 'tier:2', 'the tier did not turn on');
    await shootColumn(s, 'shelves-selected-tier');
    await press('[data-cg-filter="list:7"]');
    await waitFilters((report) => report.active === 'list:7', 'the list did not turn on');
    await shootColumn(s, 'shelves-selected-list');

    // «Много всего», then the 400 px column.
    await world({ tiers: MORE_TIERS, lists: MANY_LISTS, fans: MANY_FANS });
    await waitFilters((report) => report.mode === 'shelves' && report.tiers === 6 && report.lists === 16 && report.steps === 7, 'no «много всего»');
    await browser.pause(500);
    await shootColumn(s, 'shelves-many', 520);
    // A tier drawn as its star alone: its name on hover.
    await hover('[data-cg-filter="tier:0"]');
    await shootColumn(s, 'shelves-many-star-tip', 520);
    await away();
    const overflow = await $(STRIP).shadow$$('[aria-haspopup="menu"]:not(.cgf-more)').getElements();
    if (overflow.length > 0) {
      await (overflow[overflow.length - 1] as WebdriverIO.Element).click();
      await browser.pause(250);
      await shootColumn(s, 'shelves-many-more', 640);
      await browser.keys('Escape');
    }
    await browser.browsingContextSetViewport({ context, viewport: { width: 1000, height: 900 } });
    await browser.pause(600);
    await shootColumn(s, 'shelves-many-400', 520);
    await world({ tiers: TIERS, lists: SHOT_LISTS, fans: SHOT_FANS });
    await waitFilters((report) => report.mode === 'shelves' && report.lists === 3, 'no owner’s set at 400 px');
    await browser.pause(500);
    await shootColumn(s, 'shelves-400');
    await press('[data-cgf-key="more"]');
    await press('[data-cgf-focus="a:pick"]');
    await press('[data-cgf-focus="p:list:6"]');
    await shootColumn(s, 'shelves-400-confirm', 520);
    await browser.keys('Escape');
    await browser.browsingContextSetViewport({ context, viewport: { width: 1440, height: 900 } });

    // ── «Четыре группы» ──
    await setStrip(s, 'groups');
    await world({ tiers: TIERS, lists: SHOT_LISTS, fans: SHOT_FANS });
    await waitFilters((report) => report.mode === 'groups' && report.mounted && report.lists === 3, 'no «Четыре группы»');
    await waitFilters((report) => !report.fallback, 'the numbers of «Четыре группы» stayed dots', 8_000).catch(() => null);
    await browser.pause(500);
    await shootColumn(s, 'groups');
    // «Списки»: each list with its number, and the union without repeats.
    await hover('[data-fk="c-lists"]');
    await shootColumn(s, 'groups-lists-tip');
    await away();
    await press('[data-fk="c-subs"]');
    await shootColumn(s, 'groups-subs-menu', 520);
    await press('[data-cg-filter="tier:2"]');
    await waitFilters((report) => report.active === 'tier:2', 'the tier did not turn on');
    await away();
    await shootColumn(s, 'groups-selected-tier');
    await press('[data-fk="c-lists"]');
    await shootColumn(s, 'groups-lists-menu', 560);
    await hover('[data-fk="m-list:6"]');
    await press('[data-fk="t-list:6"]');
    await shootColumn(s, 'groups-unpin-confirm', 600);
    await browser.keys('Escape');
    await browser.pause(200);
    await press('[data-fk="m-list:7"]');
    await waitFilters((report) => report.active === 'list:7', 'the list did not turn on');
    await away();
    await shootColumn(s, 'groups-selected-list');
    await press('[data-fk="c-lists"]');
    await press('[data-fk="m-list:3"]');
    await away();
    await shootColumn(s, 'groups-selected-step');

    await world({ tiers: MORE_TIERS, lists: MANY_LISTS, fans: MANY_FANS });
    await waitFilters((report) => report.mode === 'groups' && report.lists === 16, 'no «много всего» in groups');
    await browser.pause(500);
    await shootColumn(s, 'groups-many');
    await press('[data-fk="c-lists"]');
    await shootColumn(s, 'groups-many-lists', 700);
    await browser.keys('Escape');
    await browser.browsingContextSetViewport({ context, viewport: { width: 1000, height: 900 } });
    await world({ tiers: TIERS, lists: SHOT_LISTS, fans: SHOT_FANS });
    await waitFilters((report) => report.mode === 'groups' && report.lists === 3, 'no owner’s set in groups at 400 px');
    await browser.pause(500);
    await shootColumn(s, 'groups-400');
    await press('[data-fk="c-lists"]');
    await shootColumn(s, 'groups-400-lists', 600);
    await browser.keys('Escape');
    await browser.browsingContextSetViewport({ context, viewport: { width: 1440, height: 900 } });

    // ── Fansly's light theme (the owner's): a hover, the picked filter, the tooltips and the popovers of both strips ──
    theme = 'bright';
    await setStrip(s, 'shelves');
    await world({ tiers: TIERS, lists: SHOT_LISTS, fans: SHOT_FANS });
    await waitFilters((report) => report.mode === 'shelves' && report.mounted && report.lists === 3, 'no «Две полки» in the light theme');
    await browser.pause(500);
    await shootColumn(s, 'light-shelves');
    await hover('[data-cg-filter="tier:0"]');
    await shootColumn(s, 'light-shelves-hover');
    await away();
    await hover('[data-cgf-key="more"]');
    await shootColumn(s, 'light-shelves-more-tip');
    await away();
    await press('[data-cgf-key="more"]');
    await shootColumn(s, 'light-shelves-menu');
    await press('[data-cgf-focus="a:pick"]');
    await shootColumn(s, 'light-shelves-unpin-pick');
    await press('[data-cgf-focus="p:list:6"]');
    await shootColumn(s, 'light-shelves-unpin-confirm');
    await browser.keys('Escape');
    await browser.pause(200);
    await press('[data-cg-filter="list:2"]');
    await waitFilters((report) => report.active === 'list:2', 'the step did not turn on in the light theme');
    await hover('[data-cg-filter="list:3"]');
    await shootColumn(s, 'light-shelves-selected-and-hover');
    await away();
    await setStrip(s, 'groups');
    await world({ tiers: TIERS, lists: SHOT_LISTS, fans: SHOT_FANS });
    await waitFilters((report) => report.mode === 'groups' && report.mounted && report.lists === 3, 'no «Четыре группы» in the light theme');
    await waitFilters((report) => !report.fallback, 'the numbers of «Четыре группы» stayed dots', 8_000).catch(() => null);
    await browser.pause(500);
    await shootColumn(s, 'light-groups');
    await hover('[data-fk="c-lists"]');
    await shootColumn(s, 'light-groups-lists-tip');
    await away();
    await press('[data-fk="c-subs"]');
    await shootColumn(s, 'light-groups-subs-menu', 520);
    await press('[data-cg-filter="tier:2"]');
    await waitFilters((report) => report.active === 'tier:2', 'the tier did not turn on in the light theme');
    await hover('[data-cg-filter="followers"]');
    await shootColumn(s, 'light-groups-selected-and-hover');
    await away();
    await press('[data-fk="c-lists"]');
    await shootColumn(s, 'light-groups-lists-menu', 560);
    await hover('[data-fk="m-list:6"]');
    await press('[data-fk="t-list:6"]');
    await shootColumn(s, 'light-groups-unpin-confirm', 600);
    await browser.keys('Escape');
    await browser.pause(200);
    theme = 'dark';

    // ── Fansly's chips without FBuddy, and the settings row ──
    await setStrip(s, 'native');
    await setFanslyNeighbor(null);
    await world({ tiers: TIERS, lists: SHOT_LISTS, fans: SHOT_FANS });
    await waitFilters((report) => report.strip === 'native' && report.lists === 3, 'Fansly’s chips without FBuddy did not read');
    await browser.pause(400);
    await shootColumn(s, 'native-bare', 520);
    await s.toPages();
    await openOptions('appearance');
    await waitForOptions((state) => state.section === 'appearance' && !state.loading, 'the appearance section');
    await browser.execute(() => document.querySelector('[data-pg-fansly-filter-strip]')?.scrollIntoView({ block: 'center' }));
    await browser.pause(300);
    const row = await s.rect('page', '[data-pg-fansly-filter-strip]');
    await s.shot('options-filter-strip', row === null ? {} : { clip: around([{ x: row.x - 500, y: row.y - 150, width: 1000, height: row.height + 270 }]) });
    await s.toChat();
    await setStrip(s, 'shelves');
  },
  { sites: ['fansly'] },
);
