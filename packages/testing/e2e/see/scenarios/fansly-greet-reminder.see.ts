// Fansly: the greeting reminder — a fan followed 11 minutes ago and nobody wrote to them: the follow's `3/2` frame
// reaches the background, the pass's check of that one fan finds the chat empty, and the toast «Ждёт приветствия · …»
// comes; then its «Hi»: «Новые фоловеры» open on the fan's card, and Hi writes the greeting into its field.

import { WORLD } from '../../../src/scenarios/hub';
import { writeLocalStorage } from '../../support/extension';
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
    await s.press(/^Hi$/, 'toast', '.cg-toast__acts button');
    await s.browser.waitUntil(() => s.has('modal', '.cg-nc__greet'), { timeout: 30_000, timeoutMsg: 'the card did not open' });
    const filled = async (): Promise<boolean> => ((await s.h.readOurs('modal', '.cg-nc__field textarea', (node) => (node as HTMLTextAreaElement).value)) ?? '') !== '';
    // Hi starts by the toast's click when the pass has the fan checked already; otherwise it is the card's own button.
    await s.browser.waitUntil(filled, { timeout: 8_000 }).catch(async () => {
      await s.press(/^Сгенерировать/, 'modal', '.cg-nc__gbar button');
      await s.browser.waitUntil(filled, { timeout: 30_000, timeoutMsg: 'the greeting did not land in the field' });
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
