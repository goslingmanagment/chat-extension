// Fansly: «Рассылка» of Spenders — the bar with the outreach text and the page's own «Copied Bundle» items (Fansly's
// localStorage list, seeded here as «Copy» on a post leaves it), «Подстроить под фана» on: a batch of Fix rewrites the
// text for each of two whales, the first fan's preview shows their whole version, then that row's «Отправить»: one
// `POST /message` with both bundles (the `message.send` line of the run).

import { WORLD } from '../../../src/scenarios/hub';
import { fakeFansly } from '../../support/fansly-stand';
import { SEE_AI_TEXTS, scenario } from '../kit';

const { a, b } = WORLD.fansly.chats;
const BUNDLES = ['700000000000000011', '700000000000000012'];
/** What the hub's Fix of the mass message reads like for one whale (the mockup's: the stand's hub writes no prose). */
const ADAPTED = 'hey Gordon 🐉 had to show you this one first. first time with a dragon and it got SO intense 😳 6 minutes, it is right here with this message. tell me when you get to the end 😈';

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
    await s.press(/^/, 'modal', '.cg-or textarea');
    // Key by key, as a person types: one action of many keys holds them all down to its end, and Firefox drops a letter
    // pressed again while it is still down.
    for (const key of Array.from('ok this one is SPECIAL, first time with a DRAGON. 6 minutes, tell me when you get to the end')) await s.browser.keys(key);
    await s.press(/^/, 'modal', '.cg-bd__head .cg-bt__check');
    await s.press(/^Подстроить под каждого/, 'modal');
    await s.see('modal', /Отправить/, 60_000);
    await s.shot('outreach-ready');
    // The fan's whole version, in their preview under the row.
    await s.press(/^Hub Whale/, 'modal', '[data-cg-key^="fan:"]');
    await s.see('modal', 'had to show you this one first', 20_000);
    await s.shot('outreach-preview');
    await s.press(/^Отправить/, 'modal', '.cg-or__send');
    await s.see('modal', 'Отправлено', 20_000);
    await s.shot('outreach-sent');
    const sends = (await fakeFansly().journal()).entries.filter((entry) => entry.route === 'message.send');
    console.log('see: message.send', JSON.stringify(sends.map((entry) => entry.detail)));
  },
  {
    sites: ['fansly'],
    before: async ({ hub }) => {
      await hub.command({ op: 'config', patch: { aiTexts: { ...SEE_AI_TEXTS, 'improve-draft': ADAPTED } } });
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
