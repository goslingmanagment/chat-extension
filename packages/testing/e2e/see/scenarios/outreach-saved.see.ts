// «Рассылки» kept on this computer (2026-11-01, Dmitriy: «локально хранить состояние всех рассылок, чтобы можно было к
// любой вернуться с того же момента»): an outreach is written and one version sent; the page loads again (as Fansly
// does when our «Перейти в чат» finds the chat not open) and the outreach comes back — its chip in the corner, the
// window with the version that went and the ones that wait; «Новая рассылка», then «Рассылки» in the head lists both
// and a click brings the first one back where it was.

import { WORLD } from '../../../src/scenarios/hub';
import { fakeFansly } from '../../support/fansly-stand';
import { SEE_AI_TEXTS, scenario, type See } from '../kit';

const TEXT = 'ok this one is SPECIAL, first time with a DRAGON. 6 minutes, tell me when you get to the end';
const SECOND = 'happy sunday, I have a little surprise for my favourites, want to see?';
const VERSIONS = [
  'had to show you this one first 🐉 first time with a dragon and it got SO intense 😳 6 minutes, tell me when you get to the end 😈',
  'sorry babe, I was filming 🙈 and honestly this is why. first time with a dragon, 6 minutes, you get it before anyone else 😈',
  'still missing you 🥺 so I made you something. first time with a dragon 🐉 6 minutes and it is all yours',
];
const BUNDLES = ['700000000000000011'];

async function typeIn(s: See, text: string): Promise<void> {
  for (const key of Array.from(text)) await s.browser.keys(key);
}

async function shot(s: See, name: string): Promise<void> {
  await s.browser.action('pointer').move({ x: 2, y: 2, origin: 'viewport' }).perform();
  await s.browser.pause(250);
  await s.shot(name);
}

async function openOutreach(s: See): Promise<void> {
  if (s.site === 'fansly') await s.browser.execute(() => (document.activeElement as HTMLElement | null)?.blur());
  await s.keys(...s.PANEL, 'm');
  await s.browser.waitUntil(() => s.has('modal', '.cg-sp__outreach'), { timeout: 20_000, interval: 200, timeoutMsg: 'Spenders did not open' });
  await s.press(/^Рассылка/, 'modal', '.cg-sp__outreach');
  await s.browser.waitUntil(() => s.has('modal', '.cg-ow__foot'), { timeout: 20_000, interval: 200, timeoutMsg: 'the outreach did not open' });
  await s.browser.pause(400);
}

scenario(
  'outreach-saved',
  async (s) => {
    const fansly = s.site === 'fansly';
    await s.ready();
    if (fansly) {
      await fakeFansly().command({ op: 'bundles', ids: BUNDLES });
      await s.browser.execute((ids: string[]) => localStorage.setItem('media_service_copied_media', JSON.stringify({ copiedAccountMediaIds: ids, copiedAccountMediaBundleIds: [] })), BUNDLES);
    } else await s.leaveField();
    await openOutreach(s);
    await s.press(/^/, 'modal', '.cg-ow__text');
    await typeIn(s, TEXT);
    await s.press(/^Написать/, 'modal', '.cg-ow__foot .cg-ow__main');
    await s.see('modal', 'Версия для', 60_000);
    await s.browser.waitUntil(async () => !(await s.has('modal', '.cg-ow__foot [data-cg-batch="running"]')) && (await s.text('modal', '.cg-ow__foot')).includes('Готово'), { timeout: 90_000, interval: 300, timeoutMsg: 'the versions were not written' });
    await s.press(/^Отправить/, 'modal', '.cg-ow__csend');
    await s.see('modal', /Отправлено/, 30_000);
    await s.browser.pause(1_500);
    await shot(s, 'before-reload');

    // The page loads again: whatever the tab held in memory is gone.
    await s.browser.refresh();
    await s.ready();
    if (!fansly) await s.leaveField();
    await s.browser.waitUntil(() => s.has('panel', '.cg-ow-chip'), { timeout: 20_000, interval: 200, timeoutMsg: 'the outreach chip did not come back' });
    await s.browser.pause(400);
    await shot(s, 'after-reload-chip');
    await s.press(/Рассылка/, 'panel', '.cg-ow-chip');
    await s.browser.waitUntil(() => s.has('modal', '.cg-ow__foot'), { timeout: 20_000, interval: 200, timeoutMsg: 'the window did not come back' });
    await s.browser.pause(600);
    await shot(s, 'after-reload-window');

    // «Новая рассылка» from «Рассылки» in the head, a new text; the list holds both.
    await s.press(/^Рассылки/, 'modal', '.cg-ow__savedb');
    await s.press(/Новая рассылка/, 'modal', '.cg-ow__new .cg-ow__pib');
    await s.browser.pause(400);
    await s.press(/^/, 'modal', '.cg-ow__text');
    await s.browser.keys([s.MOD, 'a']);
    await s.browser.keys('Backspace');
    await typeIn(s, SECOND);
    await s.browser.pause(1_200);
    await s.press(/^Рассылки/, 'modal', '.cg-ow__savedb');
    await s.see('modal', 'Рассылки на этом компьютере');
    await s.browser.pause(300);
    await shot(s, 'saved-list');
    await s.press(/DRAGON/, 'modal', '.cg-ow__savedpop .cg-ow__pi:not(.is-on):not(.cg-ow__new) .cg-ow__pib');
    await s.browser.pause(800);
    await shot(s, 'saved-resumed');
  },
  {
    sites: ['chatspace', 'fansly'],
    previewSend: true,
    before: async ({ hub, site }) => {
      await hub.command({ op: 'config', patch: { aiTexts: { ...SEE_AI_TEXTS, 'improve-draft:outreach': VERSIONS.join(' [FAN] ') } } });
      if (site !== 'fansly') return;
      const { a, b } = WORLD.fansly.chats;
      await hub.command({
        op: 'spenderFans',
        fans: [
          { fanRef: a.fan, displayName: 'Hub Whale', lifetimeUsd: 1200, windowUsd: 300 },
          { fanRef: b.fan, displayName: 'Hub Birch', lifetimeUsd: 650, windowUsd: 40, awaiting: true, fanWroteAgoSec: 7_200 },
        ],
      });
      await hub.command({ op: 'config', patch: { spendersTotal: 2 } });
    },
  },
);
