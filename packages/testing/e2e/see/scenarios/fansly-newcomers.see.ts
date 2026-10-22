// Fansly: «Новые фоловеры» — a fresh follower checked by the pass, their card, then «Сгенерировать» with the greeting in
// the field (the same window and card as ChatSpace's «Новые», X60). Opened by the popup's command: Fansly has no palette.

import { WORLD } from '../../../src/scenarios/hub';
import { pageRpc, writeLocalStorage } from '../../support/extension';
import { QUIET_PAGE } from '../../support/fake-hub';
import { fakeFansly } from '../../support/fansly-stand';
import { scenario } from '../kit';

const FAN = '930000000000000777';
const GREETING = 'hey you 💛 so glad you followed — what caught your eye first?';

scenario(
  'fansly-newcomers',
  async (s) => {
    await s.ready();
    // The popup's click: `tab.command` is the popup's own request.
    await s.toPages();
    await s.browser.url(s.page('popup.html'));
    // The test build's pass asks the stand's API (bg/fansly/api-probe.ts).
    await writeLocalStorage({ 'dev.fanslyApi.origin': fakeFansly().apiOrigin });
    await pageRpc('tab.command', { command: { kind: 'surface', surface: 'newcomers' } });
    await s.browser.url(s.page(QUIET_PAGE));
    await s.toChat();
    await s.browser.waitUntil(() => s.has('modal', '.cg-fnw .cg-nw__row'), { timeout: 30_000, timeoutMsg: 'no row of the pass' });
    const row = `.cg-nw__row[data-cg-fan$=":${FAN}"]`;
    await s.browser.waitUntil(async () => (await s.h.readOurs('modal', row, (node) => node.getAttribute('data-cg-check'))) === 'ready', { timeout: 60_000, timeoutMsg: 'the follower was not checked' });
    await s.h.ours('modal', row).click();
    await s.browser.waitUntil(() => s.has('modal', '.cg-nc__greet'), { timeout: 10_000, timeoutMsg: 'the card has no greeting' });
    await s.shot('fansly-newcomers');
    await s.press(/^Сгенерировать/, 'modal', '.cg-nc__gbar button');
    await s.browser.waitUntil(async () => ((await s.h.readOurs('modal', '.cg-nc__field textarea', (node) => (node as HTMLTextAreaElement).value)) ?? '') !== '', {
      timeout: 30_000,
      timeoutMsg: 'the greeting did not land in the field',
    });
    await s.shot('fansly-newcomer-hi');
  },
  {
    sites: ['fansly'],
    before: async ({ hub }) => {
      await fakeFansly().command({ op: 'follow', followerId: FAN, silent: true });
      const created = await fakeFansly().command({ op: 'conversation', fanId: FAN });
      if (created.groupId === undefined) throw new Error('no greeting group');
      await hub.command({ op: 'thread', pageLabel: WORLD.pages.fansly.pageLabel, conversationRef: created.groupId, fanRef: FAN });
      await hub.command({ op: 'archiveConversation', pageLabel: WORLD.pages.fansly.pageLabel, conversationRef: created.groupId, messages: [] });
      await hub.command({ op: 'config', patch: { aiTexts: { 'hi-greeting': GREETING } } });
    },
  },
);
