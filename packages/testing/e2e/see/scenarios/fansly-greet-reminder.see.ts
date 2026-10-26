// Fansly: the greeting reminder — a fan followed 11 minutes ago and nobody wrote to them: the follow's `3/2` frame
// reaches the background, the check (reads only: no chat is made) finds nobody wrote, and the toast «Ждёт приветствия ·
// …» comes. Then «Hi» (2026-10-26): the fan's chat opens at once (no window), the dock's Hi writes the greeting there,
// and it stands in Fansly's own field — for the person's own send.

import { WORLD } from '../../../src/scenarios/hub';
import { writeLocalStorage } from '../../support/extension';
import { QUIET_PAGE } from '../../support/fake-hub';
import { FANSLY_MAIN, fakeFansly } from '../../support/fansly-stand';
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
    await s.press(/^Hi$/, 'toast', '.cg-toast__acts button');
    await s.browser.waitUntil(async () => ((await s.browser.$(FANSLY_MAIN.field).getValue().catch(() => '')) as string).trim() !== '', { timeout: 90_000, timeoutMsg: 'the greeting did not land in the chat' });
    await s.shot('fansly-reminder-chat');
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
