// «Фан удалил» on Fansly (2026-11-03, the owner: «показывать удаленные сообщения фана», a mark in the chat header): the
// open fan deleted three messages the hub kept (one twelve minutes ago, nine seconds after sending it, so it is fresh;
// a photo without text yesterday; a text two days ago). The header with the fresh mark, its card on hover, the calm mark
// once the card was seen; then the fan writes and deletes one more while the chat is open: the mark lights up again, and
// the pinned card tags it «новое». Fansly's dark theme, then the light one.

import { $, browser } from '@wdio/globals';

import { callFansly, fakeFansly } from '../../support/fansly-stand';
import { around, scenario, type Box, type See } from '../kit';

const SLOT = '[data-host="header-slot"][data-header-order="40"]';
const HEADER = '.message-content-header-contact';

const box = (node: Element): Box => {
  const { x, y, width, height } = node.getBoundingClientRect();
  return { x, y, width, height };
};
/** A box inside the mark's own root (closed: WebDriver reaches into it). */
async function rectIn(selector: string): Promise<Box | null> {
  const host = $(SLOT);
  if (!(await host.isExisting())) return null;
  const [node] = await host.shadow$$(selector).getElements();
  return node === undefined ? null : ((await browser.execute(box, node as unknown as Element)) as Box);
}

async function shoot(s: See, name: string, card: boolean): Promise<void> {
  const header = await s.rect('page', HEADER);
  const boxes = [header, await rectIn('.cg-dm'), card ? await rectIn('[data-deleted-card]') : null];
  await s.shot(name, { clip: around(boxes, [10, 16, 14, 16]) });
}

async function attr(name: string): Promise<string | null> {
  const host = $(SLOT);
  if (!(await host.isExisting())) return null;
  const [node] = await host.shadow$$('.cg-dm').getElements();
  return node === undefined ? null : ((await browser.execute((el: Element, key: string) => el.getAttribute(key), node as unknown as Element, name)) as string | null);
}

async function waitMark(total: number, fresh: boolean): Promise<void> {
  await browser.waitUntil(async () => (await attr('data-deleted-messages')) === String(total) && (await attr('data-fresh')) === String(fresh), {
    timeout: 30_000,
    interval: 200,
    timeoutMsg: `no mark of ${String(total)} (fresh ${String(fresh)}): ${String(await attr('data-deleted-messages'))} ${String(await attr('data-fresh'))}`,
  });
}

scenario(
  'fansly-deleted',
  async (s) => {
    await s.ready();
    await callFansly('setTheme', 'dark');
    const { group, fan } = s.world.fansly.chats.a;
    const pageLabel = s.world.pages.fansly.pageLabel;
    const now = Date.now();
    const at = (msAgo: number): string => new Date(now - msAgo).toISOString();
    const MIN = 60_000;
    const seed = (messageId: string, text: string | null, sentAgo: number, after: number, attachments = 0): Promise<unknown> =>
      s.hub.command({ op: 'deletedMessage', pageLabel, fanRef: fan, messageId, groupId: group, text, sentAt: at(sentAgo), deletedAt: at(sentAgo - after), attachments });
    await seed('910000000000000001', 'nvm im broke till friday lol', 2 * 24 * 60 * MIN, 2 * 60 * MIN);
    await seed('910000000000000002', '', 22 * 60 * MIN, 3 * MIN, 1);
    await seed('910000000000000003', 'wait how much is a custom vid? like 5 min, just for me', 12 * MIN, 9_000);
    // The chat opens again, so the mark reads the hub's answer at once.
    await callFansly('open', s.world.fansly.chats.b.group);
    await s.wait(800);
    await callFansly('open', group);

    await waitMark(3, true);
    await s.wait(400);
    await shoot(s, 'mark-fresh', false);
    const mark = await rectIn('.cg-dm');
    if (mark !== null) await s.shot('mark-1to1', { clip: around([mark], 24) });

    // Hover: the card, after its short pause.
    await $(SLOT).shadow$('.cg-dm__mark').moveTo();
    await browser.waitUntil(async () => $(SLOT).shadow$('[data-deleted-card]').isExisting(), { timeout: 5_000, timeoutMsg: 'no card' });
    await s.wait(300);
    await shoot(s, 'card', true);

    // Away: the card goes, what it showed is seen.
    await $(HEADER).moveTo({ xOffset: -40, yOffset: 0 });
    await waitMark(3, false);
    await shoot(s, 'mark-seen', false);

    // While the chat is open the fan writes and deletes one more: the hub keeps it from its own socket, the page hears it go.
    const sent = (await fakeFansly().command({ op: 'message', groupId: group, text: 'ok forget i asked 🙈', from: 'fan', createdAt: Math.floor(Date.now() / 1000) })) as { readonly message: { readonly id: string } };
    await s.wait(4_000);
    await s.hub.command({ op: 'deletedMessage', pageLabel, fanRef: fan, messageId: sent.message.id, groupId: group, text: 'ok forget i asked 🙈', sentAt: new Date(Date.now() - 4_000).toISOString(), deletedAt: new Date().toISOString() });
    await fakeFansly().command({ op: 'delete', messageId: sent.message.id });
    await waitMark(4, true);
    await s.wait(400);
    await shoot(s, 'mark-live', false);

    // A click pins the card: the new one on top, tagged.
    await $(SLOT).shadow$('.cg-dm__mark').click();
    await browser.waitUntil(async () => $(SLOT).shadow$('[data-deleted-card]').isExisting(), { timeout: 5_000, timeoutMsg: 'no pinned card' });
    await s.wait(300);
    await shoot(s, 'card-live', true);

    // The light theme, the same card.
    await callFansly('setTheme', 'bright');
    await s.wait(600);
    await shoot(s, 'card-light', true);
  },
  { sites: ['fansly'] },
);
