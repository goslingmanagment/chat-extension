// Fansly: the open fan's warning marks in the chat header, after «Регистрация» (hub `clientFanMarks`): «💩 Бомж» (the
// agency's list on this and another model's page) and «⛔ Блоклист» (two posts of FANSLY BLOCKLIST). The header with
// both, the list's «где» on hover, then the posts pinned by a click. The fake hub marks the stand's first fan only.

import { $, browser } from '@wdio/globals';

import { around, scenario, type Box, type See } from '../kit';

const SLOT = '[data-host="header-slot"][data-header-order="30"]';
const HEADER = '.message-content-header-contact';

const box = (node: Element): Box => {
  const { x, y, width, height } = node.getBoundingClientRect();
  return { x, y, width, height };
};
/** A box of the marks' own root (closed: WebDriver reaches into it). */
async function marksRect(selector: string): Promise<Box | null> {
  const host = $(SLOT);
  if (!(await host.isExisting())) return null;
  const [node] = await host.shadow$$(selector).getElements();
  return node === undefined ? null : ((await browser.execute(box, node as unknown as Element)) as Box);
}

async function shoot(s: See, name: string, card: boolean): Promise<void> {
  const header = await s.rect('page', HEADER);
  const boxes = [header, await marksRect('.cg-fm'), card ? await marksRect('[data-fan-marks-card]') : null];
  await s.shot(name, { clip: around(boxes, [10, 16, 14, 16]) });
}

scenario(
  'fansly-marks',
  async (s) => {
    await s.ready();
    await browser.waitUntil(async () => (await $(SLOT).isExisting()) && (await $(SLOT).shadow$('[data-fan-mark="blocklist"]').isExisting()), {
      timeout: 20_000,
      interval: 200,
      timeoutMsg: 'no marks in the header',
    });
    await shoot(s, 'marks', false);
    // Hover: the list's «где», after its short pause.
    await $(SLOT).shadow$('[data-fan-mark="lists"]').moveTo();
    await browser.waitUntil(async () => $(SLOT).shadow$('[data-fan-marks-card="lists"]').isExisting(), { timeout: 5_000, timeoutMsg: 'no lists card' });
    await shoot(s, 'marks-lists', true);
    // A click pins the posts.
    await $(SLOT).shadow$('[data-fan-mark="blocklist"]').click();
    await browser.waitUntil(async () => $(SLOT).shadow$('[data-fan-marks-card="blocklist"]').isExisting(), { timeout: 5_000, timeoutMsg: 'no blocklist card' });
    await shoot(s, 'marks-blocklist', true);
  },
  { sites: ['fansly'] },
);
