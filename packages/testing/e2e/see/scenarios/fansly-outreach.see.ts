// Fansly: «Рассылка» of Spenders — the bar with the common text and the page's own «Copied Bundle» items (Fansly's
// localStorage list, seeded here as «Copy» on a post leaves it), a batch of personal lines for two whales, then one
// row's «Отправить»: one `POST /message` with both bundles (`fansly-journal.json` of the run).

import { WORLD } from '../../../src/scenarios/hub';
import { fakeFansly } from '../../support/fansly-stand';
import { scenario } from '../kit';

const { a, b } = WORLD.fansly.chats;
const BUNDLES = ['700000000000000011', '700000000000000012'];

scenario(
  'fansly-outreach',
  async (s) => {
    await s.ready();
    await s.browser.execute((ids: string[]) => localStorage.setItem('media_service_copied_media', JSON.stringify({ copiedAccountMediaIds: [], copiedAccountMediaBundleIds: ids })), BUNDLES);
    // Out of Fansly's field: our key is a command there, not text.
    await s.browser.execute(() => (document.activeElement as HTMLElement | null)?.blur());
    await s.keys(...s.PANEL, 'm');
    await s.see('modal', 'Hub Whale', 20_000);
    await s.press(/^Рассылка/, 'modal', '.cg-or__toggle');
    await s.see('modal', 'Copied Bundle');
    await s.press(/^/, 'modal', '.cg-or__text textarea');
    await s.browser.keys(Array.from('new video is up, the dragon one, just for you'));
    await s.press(/^/, 'modal', '.cg-bd__head .cg-bt__check');
    await s.press(/^Написать приветствие/, 'modal');
    await s.see('modal', /Отправить/, 60_000);
    await s.shot('outreach-ready');
    await s.press(/^Отправить/, 'modal', '.cg-or__send');
    await s.see('modal', 'Отправлено', 20_000);
    await s.shot('outreach-sent');
    const sends = (await fakeFansly().journal()).entries.filter((entry) => entry.route === 'message.send');
    console.log('see: message.send', JSON.stringify(sends.map((entry) => entry.detail)));
  },
  {
    sites: ['fansly'],
    before: async ({ hub }) => {
      await hub.command({
        op: 'spenderFans',
        fans: [
          { fanRef: a.fan, displayName: 'Hub Whale', lifetimeUsd: 1200, windowUsd: 300 },
          { fanRef: b.fan, displayName: 'Hub Birch', lifetimeUsd: 450, windowUsd: 0 },
        ],
      });
      await hub.command({ op: 'config', patch: { spendersTotal: 2 } });
    },
  },
);
