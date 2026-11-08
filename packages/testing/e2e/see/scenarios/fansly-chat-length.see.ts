// The chat's length on Fansly (2026-11-08, the owner: «хочу еще видеть сколько было месаг с челом, аккуратный такой
// баджик», then «покомпактнее бы… чтобы при наведении чето всплывало»): the header after «Регистрация» says how many
// messages the open chat ever had, and its card on hover says since when and how often. Chat a: the hub holds it from
// its first message (428 messages, the first three months ago), and the fan deleted three, so the row looks like the
// owner's screenshot. Chat b: the hub has not proven its start, so only the age, from the chat's own id. Then a long one
// (38 888 messages over a year and three months). Fansly's dark theme, then the light one (the note's picture).

import { $, browser } from '@wdio/globals';

import { callFansly } from '../../support/fansly-stand';
import { around, scenario, type Box, type See } from '../kit';

const SLOT = '[data-host="header-slot"][data-header-order="25"]';
const HEADER = '.message-content-header-contact';

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

async function shoot(s: See, name: string, card = false): Promise<void> {
  const header = await s.rect('page', HEADER);
  const boxes = [header, await rectIn('.cg-cl'), card ? await rectIn('[data-chat-length-card]') : null];
  await s.shot(name, { clip: around(boxes, [10, 16, 14, 16]) });
}

/** Hover the badge: its card, after the short pause. */
async function hover(): Promise<void> {
  await $(SLOT).shadow$('.cg-cl__mark').moveTo();
  await browser.waitUntil(async () => $(SLOT).shadow$('[data-chat-length-card]').isExisting(), { timeout: 5_000, timeoutMsg: 'no card' });
  await browser.pause(300);
}

/** Away from the badge: the card goes. */
async function away(): Promise<void> {
  await $(HEADER).moveTo({ xOffset: -40, yOffset: 0 });
  await browser.waitUntil(async () => !(await $(SLOT).shadow$('[data-chat-length-card]').isExisting()), { timeout: 5_000, timeoutMsg: 'the card stayed' });
}

scenario(
  'fansly-chat-length',
  async (s) => {
    await s.ready();
    await callFansly('setTheme', 'dark');
    const { a, b } = s.world.fansly.chats;
    const pageLabel = s.world.pages.fansly.pageLabel;
    const now = Date.now();
    const DAY = 24 * 60 * 60_000;
    const at = (msAgo: number): string => new Date(now - msAgo).toISOString();
    await s.hub.command({ op: 'chatLength', pageLabel, fanRef: a.fan, groupId: a.group, messages: 428, firstMessageAt: at(97 * DAY) });
    await s.hub.command({ op: 'chatLength', pageLabel, fanRef: b.fan, groupId: b.group, messages: null, firstMessageAt: null });
    for (const [id, text, ago] of [
      ['910000000000000001', 'nvm im broke till friday lol', 2 * DAY],
      ['910000000000000002', 'wait how much is a custom vid?', DAY],
      ['910000000000000003', 'ok forget i asked', 3 * 60 * 60_000],
    ] as const) {
      await s.hub.command({ op: 'deletedMessage', pageLabel, fanRef: a.fan, messageId: id, groupId: a.group, text, sentAt: at(ago), deletedAt: at(ago - 60_000) });
    }
    // The chat opens again, so the header reads the hub's answer at once.
    await callFansly('open', b.group);
    await s.wait(800);
    await callFansly('open', a.group);

    await waitBadge('428');
    await s.wait(400);
    await shoot(s, 'header');
    const pill = await rectIn('.cg-cl');
    if (pill !== null) await s.shot('badge-1to1', { clip: around([pill], 24) });
    await hover();
    await shoot(s, 'card', true);
    await away();

    // The light theme most chatters work in: the picture of the note.
    await callFansly('setTheme', 'bright');
    await s.wait(600);
    await shoot(s, 'header-light');
    await hover();
    await shoot(s, 'card-light', true);
    await away();

    // Chat b: the hub cannot say how many, only the age the chat's id carries.
    await callFansly('open', b.group);
    await waitBadge('unknown');
    await s.wait(400);
    await hover();
    await shoot(s, 'card-no-count', true);
    await away();

    // A long chat: thousands, over a year.
    await s.hub.command({ op: 'chatLength', pageLabel, fanRef: a.fan, groupId: a.group, messages: 38_888, firstMessageAt: at(460 * DAY) });
    await callFansly('open', a.group);
    await waitBadge('38888');
    await s.wait(400);
    await hover();
    await shoot(s, 'card-long', true);
    await away();

    await callFansly('setTheme', 'dark');
    await s.wait(600);
    await shoot(s, 'header-long-dark');
  },
  { sites: ['fansly'] },
);
