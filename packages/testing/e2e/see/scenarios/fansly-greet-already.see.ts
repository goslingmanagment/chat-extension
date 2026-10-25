// Fansly: the greeting reminder's «Hi» on a fan somebody greeted meanwhile (the owner, 2026-10-25: «если один нажал на
// hi и там месага уже есть — чтобы генерация стопнулась и показало ошибку "кто-то уже попривествовал его" и чат
// открылся»). A fan followed 11 minutes ago and nobody wrote: the toast comes. The window was opened once (a shift's
// usual state), so its pass has the fan checked — then a colleague writes to them from another browser. «Hi»: the card's
// Hi reads the chat again while it generates, finds the colleague's message, stops; the window goes, the fan's chat
// opens, and the toast says «Кто-то уже поприветствовал …».

import { WORLD } from '../../../src/scenarios/hub';
import { pageRpc, writeLocalStorage } from '../../support/extension';
import { QUIET_PAGE } from '../../support/fake-hub';
import { fakeFansly } from '../../support/fansly-stand';
import { scenario } from '../kit';

const FAN = '930000000000000779';
const GREETING = 'hey you 💛 so glad you followed — what caught your eye first?';
let group = '';

scenario(
  'fansly-greet-already',
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
    // The window, opened and closed as during a shift (the popup's command): its pass has the fan checked.
    await s.toPages();
    await s.browser.url(s.page('popup.html'));
    await pageRpc('tab.command', { command: { kind: 'surface', surface: 'newcomers' } });
    await s.browser.url(s.page(QUIET_PAGE));
    await s.toChat();
    const row = `.cg-nw__row[data-cg-fan$=":${FAN}"]`;
    await s.browser.waitUntil(async () => (await s.h.readOurs('modal', row, (node) => node.getAttribute('data-cg-check'))) === 'ready', { timeout: 90_000, timeoutMsg: 'the follower was not checked' });
    await s.browser.keys('Escape');
    // A colleague greets the fan from their own browser: this one hears nothing of it.
    await fakeFansly().command({ op: 'message', groupId: group, from: 'creator', text: 'Привет, красавчик 😘 рада, что ты здесь!', silent: true });
    await s.shot('fansly-greet-due');
    await s.press(/^Hi$/, 'toast', '.cg-toast__acts button');
    await s.see('toast', 'Кто-то уже поприветствовал', 20_000);
    await s.shot('fansly-greet-already');
  },
  {
    sites: ['fansly'],
    before: async ({ hub }) => {
      const created = await fakeFansly().command({ op: 'conversation', fanId: FAN });
      if (created.groupId === undefined) throw new Error('no greeting group');
      group = created.groupId;
      await hub.command({ op: 'thread', pageLabel: WORLD.pages.fansly.pageLabel, conversationRef: created.groupId, fanRef: FAN });
      await hub.command({ op: 'archiveConversation', pageLabel: WORLD.pages.fansly.pageLabel, conversationRef: created.groupId, messages: [] });
      await hub.command({ op: 'config', patch: { aiTexts: { 'hi-greeting': GREETING } } });
    },
  },
);
