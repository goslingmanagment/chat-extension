// report-demo: Hub's own board in the frame (hub package R, 2026-11-15) instead of the fake hub's stub — run with
// CG_SEE_FRAME_ORIGIN pointing at Hub's demo Workboard (`pnpm dev:workboard:demo`, e.g. http://127.0.0.1:5391), on
// either site (`--site fansly`). What is checked is the extension's side against the real screen: the handshake v2 (the
// board takes the port and asks through it), the requests the board made (the fake hub's journal: they reach the stand's
// hub through the background's allow-list), what the board shows, Esc, and nothing of ours over the message field after.
// The board's data are the fake hub's (the stub's shape), not Hub's: a board that cannot read them says so.

import { browser } from '@wdio/globals';

import { FANSLY_MAIN } from '../../support/fansly-stand';
import { scenario, type See } from '../kit';
import { REPORT_PULSE, barText, escapeInFrame, inFrame, launcherButton, layerShown, overlaps, pointFrames, reportRow, writeFacts } from '../report';

const HOSTS = {
  fansly: { launcher: 'div[data-host="overlay"][data-layer="launcher"]', composer: FANSLY_MAIN.field },
  chatspace: { launcher: '[data-host="rail"]', composer: '.composer-frame' },
} as const;

scenario(
  'report-demo',
  async (s: See) => {
    if ((process.env['CG_SEE_FRAME_ORIGIN'] ?? '') === '') throw new Error('report-demo needs CG_SEE_FRAME_ORIGIN (Hub demo Workboard)');
    const site = s.site === 'fansly' ? HOSTS.fansly : HOSTS.chatspace;
    const facts: Record<string, unknown> = { origin: process.env['CG_SEE_FRAME_ORIGIN'] };
    await s.ready();
    await pointFrames(s);
    await s.ready();
    await browser.waitUntil(async () => (await reportRow(site.launcher)).shown, { timeout: 30_000, interval: 300, timeoutMsg: 'no fifth row' });
    const since = (await s.hub.journal()).next;
    await launcherButton(site.launcher, 'report').click();
    await browser.waitUntil(layerShown, { timeout: 30_000, interval: 200, timeoutMsg: 'the board did not show' });
    await s.wait(6000);
    facts['frameUrl'] = await inFrame(async () => browser.execute(() => location.href));
    facts['frameText'] = (await inFrame(async () => browser.execute(() => document.body.innerText.slice(0, 600)))).replace(/\s+/g, ' ');
    facts['throughPort'] = (await s.hub.journal(since)).entries.filter((call) => (call.operation ?? '').startsWith('report-board:') || call.path.startsWith('/api/v1/')).map((call) => `${call.method} ${call.path} ${String(call.status)}`);
    await s.shot('board');
    // «Show on the site» from Hub's board: its demo sale is of «Mia-2», a page with no tab on the stand, so the board
    // stays and gets the line «Откройте вкладку Mia-2, строка найдётся сама».
    const link = await inFrame(async () => {
      const anchor = browser.$('//*[normalize-space()="#…5305"]');
      if (!(await anchor.isExisting())) return false;
      await anchor.click();
      return true;
    });
    await s.wait(2500);
    facts['find'] = { clicked: link, layer: await layerShown(), bar: await barText(), board: (await inFrame(async () => browser.execute(() => document.body.innerText))).match(/Откройте вкладку[^\n]*|Строка на сайте[^\n]*/)?.[0] ?? null };
    await s.shot('find');
    facts['escape'] = await escapeInFrame();
    await browser.waitUntil(async () => !(await layerShown()), { timeout: 10_000, timeoutMsg: 'Esc did not collapse the board' }).catch(() => undefined);
    await s.wait(700);
    facts['collapsed'] = { layer: await layerShown(), bar: await barText(), overlaps: await overlaps(site.composer, site.launcher) };
    await s.shot('collapsed');
    writeFacts(s, facts);
  },
  {
    sites: ['chatspace', 'fansly'],
    timeout: 180_000,
    before: async ({ hub }) => {
      await hub.command({ op: 'config', patch: { report: { ...REPORT_PULSE } } });
    },
  },
);
