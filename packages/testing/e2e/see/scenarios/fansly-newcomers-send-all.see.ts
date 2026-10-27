// Fansly: «Отправить всем» of «Новые фоловеры» (the owner, 2026-10-27) — three fresh followers checked by the pass, a
// batch of Hi for them, then one click sends the greetings one by one, a second apart.

import { WORLD } from '../../../src/scenarios/hub';
import { pageRpc, writeLocalStorage } from '../../support/extension';
import { QUIET_PAGE } from '../../support/fake-hub';
import { fakeFansly } from '../../support/fansly-stand';
import { scenario } from '../kit';

const FANS = ['930000000000000781', '930000000000000782', '930000000000000783'];

scenario(
  'fansly-newcomers-send-all',
  async (s) => {
    await s.ready();
    await s.toPages();
    await s.browser.url(s.page('popup.html'));
    await writeLocalStorage({ 'dev.fanslyApi.origin': fakeFansly().apiOrigin });
    await pageRpc('tab.command', { command: { kind: 'surface', surface: 'newcomers' } });
    await s.browser.url(s.page(QUIET_PAGE));
    await s.toChat();
    await s.browser.waitUntil(() => s.has('modal', '.cg-fnw .cg-nw__row'), { timeout: 30_000, timeoutMsg: 'no row of the pass' });
    for (const fan of FANS) {
      const row = `.cg-nw__row[data-cg-fan$=":${fan}"]`;
      await s.browser.waitUntil(async () => (await s.h.readOurs('modal', row, (node) => node.getAttribute('data-cg-check'))) === 'ready', { timeout: 60_000, timeoutMsg: `${fan} was not checked` });
    }
    await s.press(/^Выбрать \d+/, 'modal', '.cg-nw__tools button');
    await s.press(/^Сгенерировать \d+/, 'modal', '.cg-nw__batch button');
    await s.browser.waitUntil(() => s.has('modal', '.cg-nw__sendall'), { timeout: 40_000, timeoutMsg: 'no «Отправить всем»' });
    await s.shot('fansly-send-all-ready');
    await s.press(/^Отправить всем/, 'modal', '.cg-nw__batch button');
    await s.browser.waitUntil(() => s.has('modal', '[data-cg-send="running"]'), { timeout: 5_000, timeoutMsg: 'the run did not start' });
    await s.shot('fansly-send-all-running');
    await s.browser.waitUntil(() => s.has('modal', '[data-cg-send="done"]'), { timeout: 60_000, timeoutMsg: 'the run did not end' });
    await s.shot('fansly-send-all-done');
  },
  {
    sites: ['fansly'],
    before: async ({ hub }) => {
      for (const fan of FANS) {
        await fakeFansly().command({ op: 'follow', followerId: fan, silent: true });
        const created = await fakeFansly().command({ op: 'conversation', fanId: fan });
        if (created.groupId === undefined) throw new Error('no greeting group');
        await hub.command({ op: 'thread', pageLabel: WORLD.pages.fansly.pageLabel, conversationRef: created.groupId, fanRef: fan });
        await hub.command({ op: 'archiveConversation', pageLabel: WORLD.pages.fansly.pageLabel, conversationRef: created.groupId, messages: [] });
      }
    },
  },
);
