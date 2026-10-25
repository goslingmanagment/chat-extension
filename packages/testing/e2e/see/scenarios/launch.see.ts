// launch: ChatGoose 3.0's pictures for the landing page and the first post to chatters — the showcase world at 2×.
//
//   pnpm see launch                — on ChatSpace (OnlyFans): Reply, Recap, Coach, Voice, «Память», «Очередь», the popup,
//                                    «Статус», and «Включить Fansly» as a fresh install sees it;
//   pnpm see launch --site fansly  — on Fansly: Reply, Spenders and a fan's preview, «Новые фоловеры», «Ждёт приветствия».
//
// Each picture is cut to what it shows, with enough of the site around it to tell where it is, and saved as
// `launch-<name>.png` in the run's folder. The showcase world: src/showcase.ts (Mia Rose on OnlyFans, Sofia Lane on
// Fansly, Jamie back from a trip in the open chat).

import { readFileSync } from 'node:fs';

import { WORLD } from '../../../src/scenarios/hub';
import { SHOWCASE_AT } from '../../../src/showcase';
import { writeLocalStorage, pageRpc } from '../../support/extension';
import { QUIET_PAGE } from '../../support/fake-hub';
import { fakeFansly } from '../../support/fansly-stand';
import { openOptions, openPopup, waitForOptions, waitForPopup } from '../../support/pages';
import { STAND_IDS } from '../../support/stand';
import { around, scenario, showcaseAiTexts, STAND_PAGE, type Box, type See } from '../kit';
import type { Where } from '../../support/ours';

const MIN = 60_000;
/** A moment of the showcase's chats: `minutes` before its «now» (src/showcase.ts). */
const chatAt = (minutes: number): string => new Date(SHOWCASE_AT - minutes * MIN).toISOString();

/** The version the pictures are of; the test build carries the repository's own (apps/extension/package.json). */
const LAUNCHED = '3.0.0';
const BUILT = (JSON.parse(readFileSync(new URL('../../../../../apps/extension/package.json', import.meta.url), 'utf8')) as { version: string }).version;

const COACH_FIELD = '.cg-co__ask textarea, .cg-co__ask input';
const DRAFT = 'hey you, I missed you today. tell me how your trip went, I want every little detail';
/** Henry bought the bolder set and liked it; our «there's more» is his chat's last, read: what Reply of his preview writes. */
const HENRY_REPLY = 'you liked that one, huh? 😏 [NEXT] I’m shooting the next set this weekend… tell me what you’d love to see 🔥';
/** Who follows Sofia while the run is on (a made-up account the fake Fansly names): the greeting reminder's fan. */
const NEW_FOLLOWER = '930000000000000781';

// ── where things are ─────────────────────────────────────────────────────

/** The window of ours in a layer: the largest element over its layer that does not cover the whole tab (a scrim does). */
async function windowOf(s: See, where: Where): Promise<Box | null> {
  return s.h.readOurs(where, '.cg-root', (root) => {
    let best: { x: number; y: number; width: number; height: number } | null = null;
    for (const node of root.querySelectorAll(':scope > *, :scope > * > *')) {
      const { x, y, width, height } = node.getBoundingClientRect();
      if ((width >= window.innerWidth - 2 && height >= window.innerHeight - 2) || width * height < 400) continue;
      if (best === null || width * height > best.width * best.height) best = { x, y, width, height };
    }
    return best;
  });
}

/** The box of an element of the page itself, or a clear error (a crop must never frame nothing). */
async function pageBox(s: See, selector: string): Promise<Box> {
  const box = await s.rect('page', selector);
  if (box === null) throw new Error(`no ${selector} on the page`);
  return box;
}

/** A box of the tab: [x, y, width, height]. */
const box = (x: number, y: number, width: number, height: number): Box => ({ x, y, width, height });

/** The extension's own page reads as the launched version (the test build's is the repository's). */
async function asLaunched(s: See): Promise<void> {
  await s.browser.execute(
    (built: string, launched: string) => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) if (node.nodeValue?.includes(built) === true) node.nodeValue = node.nodeValue.replaceAll(built, launched);
    },
    BUILT,
    LAUNCHED,
  );
}

/** The nearest line at or above `y` that cuts no message of the stand's chat: midway between two of its messages. */
async function gapAbove(s: See, y: number): Promise<number> {
  const boxes = await s.browser.execute(() => [...document.querySelectorAll('[data-stand-message-list] [data-stand-message-id]')].map((node) => [node.getBoundingClientRect().top, node.getBoundingClientRect().bottom] as const));
  const above = boxes.filter(([, bottom]) => bottom <= y).at(-1);
  const next = boxes.find(([top]) => above !== undefined && top >= above[1]);
  return above === undefined ? y : next === undefined ? above[1] + 8 : (above[1] + next[0]) / 2;
}

/** The pointer off our buttons: no hint over what a picture shows. */
async function restPointer(s: See): Promise<void> {
  await s.browser.action('pointer').move({ x: 2, y: 2 }).perform();
  await s.wait(300);
}

// ── ChatSpace (OnlyFans) ─────────────────────────────────────────────────

const page = (pageLabel: string, granted: boolean, platform: string, modelName: string, alias: string, spentUsd: number, last30Usd: number, fanRef: string = STAND_IDS.fans.a1) => ({
  pageLabel,
  platform,
  modelName,
  fanRef,
  granted,
  alias,
  subscribed: true,
  subscribedSince: chatAt(9 * 24 * 60 + 300),
  subscriptionEndsAt: null,
  spentMills: spentUsd * 1000,
  last30Mills: { message_purchase: last30Usd * 1000 },
  lastPurchaseAt: chatAt(24 * 60 + 50),
});

/** Jamie's card (the open chat): his two pages, an account that looks like his, and what the team knows of him. */
const JAMIE_CARD = {
  pageLabel: STAND_PAGE,
  fanRef: STAND_IDS.fans.a1,
  known: true,
  accounts: [{ platform: 'onlyfans', fanRef: STAND_IDS.fans.a1, username: 'jamiec', displayName: 'Jamie Carter', gone: false, linkedBy: null }],
  pages: [page(STAND_PAGE, true, 'onlyfans', 'Mia Rose', '💵Jamie/Chicago/34', 1248, 49), page(WORLD.pages.fansly.pageLabel, false, 'fansly', 'Sofia Lane', '💵Jamie Carter/Chicago', 1120, 37, WORLD.fansly.chats.a.fan)],
  suggestions: [
    {
      platform: 'onlyfans',
      fanRef: '74009001',
      username: 'jamie.travels',
      displayName: 'Jamie',
      gone: false,
      reason: 'same_alias',
      shared: 'Jamie/Chicago/34',
      sharedOn: WORLD.pages.vip.pageLabel,
      pages: [page(WORLD.pages.vip.pageLabel, true, 'onlyfans', 'Mia Rose', '💵Jamie/Chicago/34', 310, 24, '74009001')],
    },
  ],
  facts: [
    { id: 1, kind: 'about', text: 'Живёт в Чикаго, летает по работе почти каждую неделю', pageLabel: STAND_PAGE, granted: true, conversationRef: STAND_IDS.fans.a1, messageRef: '5100000101', messageAt: chatAt(8 * 24 * 60 + 120), source: 'ai', author: null, createdAt: chatAt(8 * 24 * 60), quote: { text: 'flying to Denver again tomorrow 😩 3 days of meetings', from: 'fan', at: chatAt(8 * 24 * 60 + 120), media: false } },
    { id: 3, kind: 'about', text: 'Отвечает вечером, любит короткие сообщения', pageLabel: WORLD.pages.fansly.pageLabel, granted: false, conversationRef: WORLD.fansly.chats.a.group, messageRef: '5100000103', messageAt: chatAt(5 * 24 * 60), source: 'ai', author: null, createdAt: chatAt(5 * 24 * 60) },
    { id: 4, kind: 'promise', text: 'Вторая часть сета «Morning» — когда вернётся из поездки', pageLabel: STAND_PAGE, granted: true, conversationRef: STAND_IDS.fans.a1, messageRef: '5100000104', messageAt: chatAt(20 * 60), source: 'chatter', author: 'Max', createdAt: chatAt(20 * 60 - 5), quote: { text: 'safe flight, handsome 💋 the second part waits until you’re back 😇', from: 'model', at: chatAt(20 * 60), media: false } },
  ],
  customs: [],
  customPayments: [],
  serverNow: new Date().toISOString(),
};

/** «Ждут» of Mia's page: the fans who wrote last, with the team's aliases; Anna is in Daniel's chat right now. */
const waiting = (fan: keyof typeof STAND_IDS.fans, alias: string | null, username: string, usd: number, minutes: number) => ({
  fanRef: STAND_IDS.fans[fan],
  conversationRef: STAND_IDS.fans[fan],
  alias,
  username,
  displayName: null,
  lifetimeGrossMills: usd * 1000,
  lastFanMessageAt: chatAt(minutes),
  lastModelMessageAt: null,
  unreadCount: 1,
  readState: 'unread',
});

async function chatspace(s: See): Promise<void> {
  const context = await s.browser.getWindowHandle();
  await s.ready();

  // Reply: three parts over the composer, for the fan who just landed.
  await s.press(/^Reply/);
  await s.done();
  await restPointer(s);
  const list = await pageBox(s, 'aside.chats-panel');
  const panel = await pageBox(s, 'section.conversation-panel');
  await s.shot('reply', { file: 'launch-reply-onlyfans', clip: box(list.x, 0, panel.x + panel.width + 8 - list.x, 900) });

  // Recap: Jamie in sections (Coach below reads it).
  await s.press(/^Recap/);
  await s.h.dockIs((d) => d.analysis === 'recap', 'the Recap sheet');
  await s.press(/^Собрать полностью/, 'dock', '.cg-dock button');
  await s.see('modal', 'Jamie, 34', 30_000);
  await restPointer(s);
  const header = await pageBox(s, '[data-stand-conversation-header]');
  const recap = around([await windowOf(s, 'modal')], 28);
  await s.shot('recap', { file: 'launch-recap', clip: { ...recap, y: header.y, height: recap.y + recap.height - header.y } });
  await s.closeAll();

  // Coach, with the Recap just made: a question, and the answer with its drafts. (Its Review turn does not fit the same
  // frame: Coach's window keeps its height and scrolls the dialog; the «Review» chip stays in sight under the answer.)
  await s.press(/^Coach/);
  await s.browser.waitUntil(() => s.has('panel', COACH_FIELD), { timeout: 10_000, timeoutMsg: 'the Coach window did not open' });
  await s.h.ours('panel', COACH_FIELD).click();
  await s.keys('Сейчас хороший момент предложить ему новый сет?');
  await s.keys(s.Key.Enter);
  await s.see('panel', 'Да, но не первым сообщением', 30_000);
  await restPointer(s);
  await s.shot('coach', { file: 'launch-coach', clip: around([await windowOf(s, 'panel')], 28) });
  await s.closeAll();

  // Voice: the draft in the field, its script, two takes, the second chosen; nothing plays.
  await s.type(DRAFT);
  await s.press(/^Voice/);
  await s.see('dock', /Озвучить ·/, 40_000);
  await s.press(/^Озвучить/, 'dock', '.cg-voice__foot button');
  await s.see('dock', /Прикрепить/, 40_000);
  await s.press(/^Ещё вариант/, 'dock', '.cg-voice__foot button');
  await s.see('dock', /Вариант 2/);
  await s.browser.waitUntil(async () => !(await s.has('dock', '.cg-take.is-working')), { timeout: 40_000, timeoutMsg: 'the second take did not get ready' });
  await restPointer(s);
  await s.wait(800);
  const dock = await pageBox(s, '[data-host="dock"]');
  // From the gap above the fan's last three messages.
  const top = await s.browser.execute(() => {
    const messages = [...document.querySelectorAll('[data-stand-message-list] [data-stand-message-id]')].map((node) => node.getBoundingClientRect());
    const third = messages.at(-3);
    const before = messages.at(-4);
    return third === undefined ? 0 : before === undefined ? third.top - 12 : (before.bottom + third.top) / 2;
  });
  const studio = around([dock, await pageBox(s, '[data-stand-composer]')], 10);
  await s.shot('voice', { file: 'launch-voice', clip: { ...studio, y: top, height: studio.y + studio.height - top } });
  await s.press(/^Voice/);
  await s.closeAll();

  // «Память» and «Очередь» of the fan panel, in a window tall enough for the whole card.
  await s.browser.browsingContextSetViewport({ context, viewport: { width: 1440, height: 1340 } });
  await s.wait(400);
  await s.leaveField();
  await s.keys(']');
  await s.see('panel', 'Jamie Carter');
  await s.press(/^Память/, 'panel');
  await s.see('panel', 'Похоже, это тот же человек', 20_000);
  await s.press(/^из чата/, 'panel', '.cg-mem__quote summary');
  await s.see('panel', 'flying to Denver again');
  await restPointer(s);
  const fanPanel = async (): Promise<Box> => {
    const found = await windowOf(s, 'panel');
    if (found === null) throw new Error('no fan panel');
    return found;
  };
  // From the chat's own header: the fan panel over the open chat.
  const chatHeader = await pageBox(s, '[data-stand-conversation-header]');
  const memory = await fanPanel();
  await s.shot('memory', { file: 'launch-memory', clip: box(chatHeader.x, chatHeader.y, memory.x + memory.width - chatHeader.x, memory.y + memory.height - chatHeader.y) });
  await s.press(/^Очередь/, 'panel');
  await s.see('panel', 'в разговоре: Anna', 30_000);
  await restPointer(s);
  const queue = await fanPanel();
  const lastRow = await s.h.readOurs('panel', '.cg-root', (root) => [...root.querySelectorAll('.cg-q__open')].at(-1)?.getBoundingClientRect().bottom ?? null);
  const queueBottom = await gapAbove(s, (lastRow ?? 640) + 160);
  await s.shot('queue', { file: 'launch-queue', clip: box(chatHeader.x, chatHeader.y, queue.x + queue.width - chatHeader.x, queueBottom - chatHeader.y) });
  await s.closeAll();
  await s.browser.browsingContextSetViewport({ context, viewport: { width: 1440, height: 900 } });

  // The popup of a signed-in chatter, in the browser's own popup width.
  await s.toPages();
  await openPopup();
  await waitForPopup((state) => state.view === 'ready', 'the popup of a signed-in person');
  await asLaunched(s);
  // The popup's own box: everything it draws ends where the browser's popup would.
  const popup = await s.browser.execute(() => {
    let right = 0;
    let bottom = 0;
    for (const node of document.body.querySelectorAll('*')) {
      const { width, right: r, bottom: b } = node.getBoundingClientRect();
      if (width > 0 && width < window.innerWidth * 0.6) [right, bottom] = [Math.max(right, r), Math.max(bottom, b)];
    }
    return { x: 0, y: 0, width: right, height: bottom };
  });
  await s.shot('popup', { file: 'launch-popup', clip: around([popup], [0, 0, 14, 0]) });

  // «Статус»: ready for the shift, the first run done on ChatSpace — and its Fansly steps as a fresh install has them.
  await openOptions('status');
  await waitForOptions((state) => state.section === 'status' && !state.loading && Object.keys(state.rows).length > 0, 'the Status section with its rows');
  await s.wait(600);
  await asLaunched(s);
  const fanslySteps = await pageBox(s, '.pg-check__group');
  await s.shot('settings', { file: 'launch-settings', clip: box(0, 0, 1440, fanslySteps.y - 8) });
  // «Включить Fansly» as a fresh install has it: Fansly's card in «Аккаунты», off.
  await openOptions('accounts');
  await waitForOptions((state) => state.section === 'accounts' && !state.loading, 'the Accounts section');
  await s.wait(600);
  await asLaunched(s);
  const card = await pageBox(s, '.pg-sitecard');
  // Just under the card: the sidebar's next item starts a few pixels lower.
  await s.shot('fansly-enable', { file: 'launch-fansly-enable', clip: box(0, 0, 1440, card.y + card.height + 3) });
  await s.toChat();
}

// ── Fansly ───────────────────────────────────────────────────────────────

async function fansly(s: See): Promise<void> {
  await s.ready();

  // Reply on Fansly: the same moment, the same three parts.
  await s.press(/^Reply/);
  await s.done();
  await restPointer(s);
  // The whole inbox: its rows have no clean edge to cut at.
  const conversation = await pageBox(s, 'app-messages-conversation-route');
  await s.shot('reply', { file: 'launch-reply-fansly', clip: box(0, 0, conversation.x + conversation.width, 900) });

  // Spenders with its statistics column and «Кому написать».
  await s.browser.execute(() => (document.activeElement as HTMLElement | null)?.blur());
  await s.keys(...s.PANEL, 'm');
  await s.see('modal', 'Потратил', 20_000);
  await s.press(/Статистика/, 'modal', '.cg-st__rail');
  await s.see('modal', 'Кому написать');
  await restPointer(s);
  await s.shot('spenders', { file: 'launch-spenders', clip: around([await windowOf(s, 'modal')], 22) });

  // A fan's preview under the row: Henry read our last message; Reply is ready to send.
  await s.hub.command({ op: 'config', patch: { aiTexts: { ...showcaseAiTexts('fansly'), 'fast-reply': HENRY_REPLY } } });
  await s.press(/^Henry Clark/, 'modal', '[data-cg-key^="fan:"]');
  await s.see('modal', /прочитано в/, 30_000);
  await s.press(/^Reply/, 'modal', '.cg-pv button');
  await s.see('modal', 'shooting the next set', 30_000);
  await restPointer(s);
  await s.shot('spenders-preview', { file: 'launch-spenders-preview', clip: around([await windowOf(s, 'modal')], 22) });
  await s.closeAll();
  await s.hub.command({ op: 'config', patch: { aiTexts: showcaseAiTexts('fansly') } });

  // The checks of new followers ask the stand's API (bg/fansly/api-probe.ts) — set once, from the extension's page.
  await s.toPages();
  await s.browser.url(s.page('popup.html'));
  await writeLocalStorage({ 'dev.fanslyApi.origin': fakeFansly().apiOrigin });
  await s.browser.url(s.page(QUIET_PAGE));
  await s.toChat();

  // «Ждёт приветствия»: someone followed Sofia eleven minutes ago and nobody wrote — the toast with the fan's picture,
  // over the open chat's header and its last messages.
  await fakeFansly().command({ op: 'follow', followerId: NEW_FOLLOWER, agoMs: 11 * MIN });
  await s.see('toast', 'Ждёт приветствия', 40_000);
  await restPointer(s);
  const toast = await windowOf(s, 'toast');
  const chat = await pageBox(s, 'app-messages-conversation-route');
  if (toast === null) throw new Error('no toast');
  await s.shot('greet-toast', { file: 'launch-greet-toast', clip: box(chat.x, 0, chat.x + chat.width - chat.x, toast.y + toast.height + 120) });
  await s.press(/^Позже$/, 'toast', '.cg-toast__acts button');

  // «Новые фоловеры»: today's followers, the pass's checks, a fan's card with Hi's variants.
  await s.toPages();
  await s.browser.url(s.page('popup.html'));
  await pageRpc('tab.command', { command: { kind: 'surface', surface: 'newcomers' } });
  await s.browser.url(s.page(QUIET_PAGE));
  await s.toChat();
  await s.browser.waitUntil(() => s.has('modal', '.cg-fnw .cg-nw__row'), { timeout: 30_000, timeoutMsg: 'no row of the pass' });
  // The pass checks every follower of the period (whether anyone wrote to them): the picture waits until it is done.
  await s.see('modal', 'Не писали', 60_000);
  await s.browser.waitUntil(async () => !(await s.text('modal')).includes('Уточняем переписку'), { timeout: 120_000, timeoutMsg: 'the pass did not check every follower' });
  await s.h.ours('modal', '.cg-nw__row[data-cg-check="ready"]').click();
  await s.browser.waitUntil(() => s.has('modal', '.cg-nc__greet'), { timeout: 10_000, timeoutMsg: 'the card has no greeting' });
  await s.press(/^Сгенерировать/, 'modal', '.cg-nc__gbar button');
  await s.browser.waitUntil(async () => ((await s.h.readOurs('modal', '.cg-nc__field textarea', (node) => (node as HTMLTextAreaElement).value)) ?? '') !== '', { timeout: 30_000, timeoutMsg: 'the greeting did not land in the field' });
  await restPointer(s);
  await s.wait(600);
  await s.shot('newcomers', { file: 'launch-newcomers', clip: around([await windowOf(s, 'modal')], 22) });
}

scenario('launch', (s) => (s.site === 'fansly' ? fansly(s) : chatspace(s)), {
  sites: ['chatspace', 'fansly'],
  showcase: true,
  timeout: 360_000,
  before: async ({ hub, site }) => {
    if (site === 'fansly') return;
    await hub.command({ op: 'fanCard', pageLabel: STAND_PAGE, fanRef: STAND_IDS.fans.a1, card: JAMIE_CARD });
    await hub.command({
      op: 'queue',
      pageLabel: STAND_PAGE,
      waiting: [
        waiting('a2', '💵Daniel/Boston/41', 'danbrooks', 2150, 35),
        waiting('a5', null, 'liamturner', 10, 12),
        waiting('a6', '💵Noah/Austin', 'noahp', 410, 48),
        waiting('a4', '💵Ethan/Seattle/29', 'ethanw', 240, 70),
        waiting('a3', '💵Marco/Miami/36', 'marco.rossi', 560, 95),
        waiting('a7', null, 'alexkim', 10, 130),
      ],
    });
    // Another chatter wrote to Daniel four minutes ago: «в разговоре: Anna» on his row.
    await hub.command({ op: 'talking', pageLabel: STAND_PAGE, fanRef: STAND_IDS.fans.a2, name: 'Anna', agoMs: 4 * MIN });
    // The page's voice day: some of its characters are spent already.
    await hub.command({ op: 'config', patch: { voiceDay: { spentToday: { [STAND_PAGE]: 1_250 } } } });
  },
});
