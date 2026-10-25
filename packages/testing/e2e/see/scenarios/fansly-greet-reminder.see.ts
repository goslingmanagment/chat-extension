// Fansly: the greeting reminder — a fan followed 11 minutes ago and nobody wrote to them: the follow's `3/2` frame
// reaches the background, the check (reads only: no chat is made) finds nobody wrote, and the toast «Ждёт приветствия ·
// …» comes. Then «Hi»: «Новые фоловеры» open on the fan's card. Hi writes the greeting by that click when the window's
// pass has the fan checked within the click's grant: here the window was opened once before (a shift's usual state),
// so it has; on a window opened cold the card's «Сгенерировать» is the person's next click.

import { WORLD } from '../../../src/scenarios/hub';
import { pageRpc, writeLocalStorage } from '../../support/extension';
import { QUIET_PAGE } from '../../support/fake-hub';
import { fakeFansly } from '../../support/fansly-stand';
import { scenario } from '../kit';

const FAN = '930000000000000778';
const GREETING = 'hey you 💛 so glad you followed — what caught your eye first?';

scenario(
  'fansly-greet-reminder',
  async (s) => {
    await s.ready();
    // The test build's checks ask the stand's API (bg/fansly/api-probe.ts).
    await s.toPages();
    await s.browser.url(s.page('popup.html'));
    await writeLocalStorage({ 'dev.fanslyApi.origin': fakeFansly().apiOrigin });
    await s.browser.url(s.page(QUIET_PAGE));
    await s.toChat();
    await fakeFansly().command({ op: 'follow', followerId: FAN, agoMs: 11 * 60_000 });
    await s.see('toast', 'Ждёт приветствия', 30_000);
    await s.shot('fansly-reminder');
    // The window, opened and closed as during a shift (the popup's command): its pass has the fan checked.
    await s.toPages();
    await s.browser.url(s.page('popup.html'));
    await pageRpc('tab.command', { command: { kind: 'surface', surface: 'newcomers' } });
    await s.browser.url(s.page(QUIET_PAGE));
    await s.toChat();
    const row = `.cg-nw__row[data-cg-fan$=":${FAN}"]`;
    await s.browser.waitUntil(async () => (await s.h.readOurs('modal', row, (node) => node.getAttribute('data-cg-check'))) === 'ready', { timeout: 90_000, timeoutMsg: 'the follower was not checked' });
    await s.browser.keys('Escape');
    await s.press(/^Hi$/, 'toast', '.cg-toast__acts button');
    await s.browser.waitUntil(async () => ((await s.h.readOurs('modal', '.cg-nc__field textarea', (node) => (node as HTMLTextAreaElement).value)) ?? '') !== '', {
      timeout: 15_000,
      timeoutMsg: 'Hi did not write the greeting into the card',
    });
    await s.shot('fansly-reminder-hi');
  },
  {
    sites: ['fansly'],
    before: async ({ hub }) => {
      const created = await fakeFansly().command({ op: 'conversation', fanId: FAN });
      if (created.groupId === undefined) throw new Error('no greeting group');
      await hub.command({ op: 'thread', pageLabel: WORLD.pages.fansly.pageLabel, conversationRef: created.groupId, fanRef: FAN });
      await hub.command({ op: 'archiveConversation', pageLabel: WORLD.pages.fansly.pageLabel, conversationRef: created.groupId, messages: [] });
      await hub.command({ op: 'config', patch: { aiTexts: { 'hi-greeting': GREETING } } });
    },
  },
);
