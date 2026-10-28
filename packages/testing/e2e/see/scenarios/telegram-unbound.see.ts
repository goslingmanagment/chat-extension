// Telegram: another account of the same browser (`?account=2`, bound to no hub page): no dock at all.

import { callTelegram } from '../../support/telegram-stand';
import { lap, scenario } from '../kit';

scenario(
  'telegram-unbound',
  async (s) => {
    // The extension has had its chance: the page is up and its editor too.
    await s.wait(4000);
    lap(`account ${await callTelegram('account')}, chat ${await callTelegram('chat')}`);
    lap(`dock host on the page: ${String(await s.browser.execute(() => document.querySelector('[data-host="dock"]') !== null))}`);
    lap(`the test build's report: ${JSON.stringify((await s.report())?.dock ?? null)}`);
    await s.shot('no-dock');
  },
  { sites: ['telegram'], telegram: { account: 2 } },
);
