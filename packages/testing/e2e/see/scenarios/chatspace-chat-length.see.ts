// The chat's length on ChatSpace (2026-11-11, the owner: «и с хуя ли на чатспейсе его нет? там же все то же самое нужно
// и по идее можно»): Fansly's badge and card in ChatSpace's conversation header, right after «Заметки», from the same
// hub read with the fan as the conversation. The stand's first chat: the hub has seen 428 of its messages since three
// months ago, the fan wrote 214, three chatters the rest but a few (the person's own row «(вы)»), and some have no
// author, with the line on what those are (the hub records OnlyFans authors since 18 October 2026). On OnlyFans the
// hub's numbers are what it has seen, so the card ends with the line that says so. Then a chat the hub holds nothing of:
// no badge. Back to the first: its badge at once. ChatSpace's dark theme, then the light one (the note's picture).

import { $, browser } from '@wdio/globals';

import { STAND_IDS } from '../../../src/stand/dataset';
import { PAGE } from '../../../src/scenarios/hub';
import { SHOWCASE } from '../../../src/showcase';
import { callStand } from '../../support/stand';
import { around, scenario, type Box, type See } from '../kit';

const SLOT = '[data-host="header-slot"][data-header-order="20"]';
const HEADER = '[data-stand-conversation-header]';
const FAN = STAND_IDS.fans.a1;
/** A chat the hub holds no message of. */
const QUIET = STAND_IDS.fans.a2;
/** The person signed in, then two colleagues. */
const [ME, TWO, THREE] = SHOWCASE ? (['kate', 'anna', 'max'] as const) : (['Nikita', 'Grisha', 'Ivan-Ari'] as const);

const box = (node: Element): Box => {
  const { x, y, width, height } = node.getBoundingClientRect();
  return { x, y, width, height };
};
/** A box inside the badge's own root (closed: WebDriver reaches into it). */
async function rectIn(selector: string): Promise<Box | null> {
  const host = $(SLOT);
  if (!(await host.isExisting())) return null;
  const [node] = await host.shadow$$(selector).getElements();
  return node === undefined ? null : ((await browser.execute(box, node as unknown as Element)) as Box);
}

async function shown(): Promise<string | null> {
  const host = $(SLOT);
  if (!(await host.isExisting())) return null;
  const [node] = await host.shadow$$('.cg-cl').getElements();
  return node === undefined ? null : ((await browser.execute((el: Element) => el.getAttribute('data-chat-length'), node as unknown as Element)) as string | null);
}

async function waitBadge(value: string): Promise<void> {
  await browser.waitUntil(async () => (await shown()) === value, { timeout: 30_000, interval: 200, timeoutMsg: `no badge «${value}»: ${String(await shown())}` });
}

/** The header's right part: ChatSpace's own buttons, «Заметки» and the badge (and the card under it). */
async function shoot(s: See, name: string, card = false): Promise<void> {
  const actions = await s.rect('page', `${HEADER} .conversation-header__actions`);
  const boxes = [actions, await s.rect('page', '[data-host="header-slot"][data-header-order="10"]'), await rectIn('.cg-cl'), card ? await rectIn('[data-chat-length-card]') : null];
  await s.shot(name, { clip: around(boxes, [12, 16, 14, 16]) });
}

/** Hover the badge: its card, after the short pause. */
async function hover(): Promise<void> {
  await $(SLOT).shadow$('.cg-cl__mark').moveTo();
  await browser.waitUntil(async () => $(SLOT).shadow$('[data-chat-length-card]').isExisting(), { timeout: 5_000, timeoutMsg: 'no card' });
  await browser.pause(300);
}

/** Away from the badge: the card goes. */
async function away(): Promise<void> {
  await $(HEADER).moveTo({ xOffset: 0, yOffset: 0 });
  await browser.waitUntil(async () => !(await $(SLOT).shadow$('[data-chat-length-card]').isExisting()), { timeout: 5_000, timeoutMsg: 'the card stayed' });
}

scenario(
  'chatspace-chat-length',
  async (s) => {
    await s.ready();
    await callStand('setTheme', 'dark');
    await waitBadge('428');
    await s.wait(400);
    await s.shot('header', { clip: around([await s.rect('page', HEADER)], 8) });
    await shoot(s, 'badge');
    await hover();
    await shoot(s, 'card', true);
    await away();

    // The light theme: the picture of the note.
    await callStand('setTheme', 'light');
    await s.wait(600);
    await shoot(s, 'badge-light');
    await hover();
    await shoot(s, 'card-light', true);
    await away();

    // A chat the hub holds nothing of: no badge, «Заметки» alone.
    await s.openChat(QUIET);
    await s.wait(2_000);
    const quiet = await shown();
    console.log(`cg-see quiet chat badge: ${String(quiet)}`);
    await s.shot('quiet', { clip: around([await s.rect('page', `${HEADER} .conversation-header__actions`), await s.rect('page', '[data-host="header-slot"][data-header-order="10"]')], [12, 16, 14, 16]) });

    // Back: the badge at once, from the answer the tab kept, while its read runs again.
    await s.openChat(FAN);
    await waitBadge('428');
    await callStand('setTheme', 'dark');
    await s.wait(400);
    await shoot(s, 'back-dark');
  },
  {
    sites: ['chatspace'],
    viewport: { width: 1440, height: 1000 },
    before: async ({ hub }) => {
      await hub.command({ op: 'config', patch: { pageFlags: { [PAGE]: { notes: true } } } });
      const DAY = 24 * 60 * 60_000;
      // 214 + 120 + 64 + 22 + 8 = 428.
      await hub.command({
        op: 'chatLength',
        pageLabel: PAGE,
        fanRef: FAN,
        messages: 428,
        firstMessageAt: new Date(Date.now() - 97 * DAY).toISOString(),
        authors: {
          chatters: [
            { name: ME, messages: 120, isMe: true },
            { name: TWO, messages: 64 },
            { name: THREE, messages: 22 },
          ],
          fan: 214,
          unattributed: 8,
        },
        approximate: true,
      });
    },
  },
);
