// «Рассылки» on the hub, the page's team's (2026-11-01, the owner: «чтобы хранились рассылки у нас на сервере», the
// team sees and continues each other's): Grisha made an outreach on his computer and sent one fan's version; here
// «Рассылки» lists it with his name, a click opens it where he left it — his send stands («Отправлено · grisha»), the
// other version waits for a click. The hub stops answering: the click warns «Хаб не отвечает» and the person may send
// anyway. A new outreach leaves out, by default, a fan «Очереди» wrote to an hour ago («Без тех, кому писали за 3 дня»).

import { WORLD } from '../../../src/scenarios/hub';
import { SEE_AI_TEXTS, scenario, type See } from '../kit';

const GRISHA = { id: 9_001, name: 'grisha' };
const OUTREACH_ID = '22222222-3333-4444-8555-666666666666';

async function shot(s: See, name: string): Promise<void> {
  await s.browser.action('pointer').move({ x: 2, y: 2, origin: 'viewport' }).perform();
  await s.browser.pause(300);
  await s.shot(name);
}

/** Fans of the page's board: Fansly's seeded ones; ChatSpace's stand fans of creator A (Alder, Birch, Cedar). */
const fansOf = (site: string): { readonly whale: string; readonly birch: string; readonly cold: string } =>
  site === 'fansly' ? { whale: WORLD.fansly.chats.a.fan, birch: WORLD.fansly.chats.b.fan, cold: WORLD.fansly.twinFan } : { whale: '74001001', birch: '74001002', cold: '74001003' };

scenario(
  'outreach-team',
  async (s) => {
    const fansly = s.site === 'fansly';
    await s.ready();
    if (fansly) await s.browser.execute(() => (document.activeElement as HTMLElement | null)?.blur());
    else await s.leaveField();
    await s.keys(...s.PANEL, 'm');
    await s.browser.waitUntil(() => s.has('modal', '.cg-sp__outreach'), { timeout: 20_000, interval: 200, timeoutMsg: 'Spenders did not open' });
    await s.press(/^Рассылка/, 'modal', '.cg-sp__outreach');
    await s.browser.waitUntil(() => s.has('modal', '.cg-ow__foot'), { timeout: 20_000, interval: 200, timeoutMsg: 'the outreach did not open' });
    await s.browser.pause(800);

    // «Рассылки»: Grisha's outreach of the page, with his name.
    await s.press(/^Рассылки/, 'modal', '.cg-ow__savedb');
    await s.see('modal', 'Рассылки страницы');
    await s.browser.pause(300);
    await shot(s, 'team-list');

    // His outreach opens where he left it: his send stands, the other version waits.
    await s.press(/gym/, 'modal', '.cg-ow__savedpop .cg-ow__pi:not(.is-on):not(.cg-ow__new) .cg-ow__pib');
    await s.see('modal', /grisha/, 20_000);
    await s.browser.pause(1_500);
    await shot(s, 'team-outreach');

    // The hub stops answering: the click warns, and «Отправить всё равно» is the person's.
    await s.hub.command({ op: 'outreachDown', down: true });
    await s.press(/Отправить/, 'modal', '.cg-ow__rsend');
    await s.see('modal', 'Хаб не отвечает', 20_000);
    await s.browser.pause(600);
    await shot(s, 'hub-down');
    // The hub answers again: the click claims the fan there and the version goes.
    await s.hub.command({ op: 'outreachDown', down: false });
    await s.browser.pause(600);
    await s.press(/Отправить/, 'modal', '.cg-ow__rsend');
    await s.see('modal', /Отправлено 1[0-9:]+ ·|Отправлено [0-9]{1,2}:[0-9]{2}$/, 1_000).catch(() => undefined);
    await s.browser.waitUntil(async () => (await s.text('modal', '.cg-ow__foot')).includes('Отправлено 2 из 2'), { timeout: 30_000, interval: 300, timeoutMsg: 'the second version did not go' });
    await s.browser.pause(800);
    await shot(s, 'sent-here');

    // A new outreach: the fan «Очереди» wrote to an hour ago is left out by default.
    await s.press(/^Рассылки/, 'modal', '.cg-ow__savedb');
    await s.press(/Новая рассылка/, 'modal', '.cg-ow__new .cg-ow__pib');
    await s.browser.pause(800);
    await s.press(/./, 'modal', '.cg-ow__komb');
    await s.see('modal', 'Без тех, кому писали за 3 дня', 20_000);
    await s.browser.pause(400);
    await shot(s, 'touched-condition');
  },
  {
    sites: ['chatspace', 'fansly'],
    previewSend: true,
    before: async ({ hub, site }) => {
      await hub.command({ op: 'config', patch: { aiTexts: { ...SEE_AI_TEXTS } } });
      const fans = fansOf(site);
      const pageLabel = site === 'fansly' ? WORLD.pages.fansly.pageLabel : WORLD.pages.one.pageLabel;
      if (site === 'fansly') {
        await hub.command({
          op: 'spenderFans',
          fans: [
            { fanRef: fans.whale, displayName: 'Hub Whale', lifetimeUsd: 1200, windowUsd: 300 },
            { fanRef: fans.birch, displayName: 'Hub Birch', lifetimeUsd: 650, windowUsd: 40 },
            { fanRef: fans.cold, displayName: 'Hub Cold', lifetimeUsd: 610, windowUsd: 0 },
          ],
        });
        await hub.command({ op: 'config', patch: { spendersTotal: 3 } });
      }
      await hub.command({
        op: 'outreachSeed',
        pageLabel,
        outreach: {
          id: OUTREACH_ID,
          author: GRISHA,
          text: 'new set, the gym one. 8 minutes, all yours',
          agoMin: 50,
          fans: [
            { fanRef: fans.whale, version: 'hey you, the gym set is up 😈 8 minutes and it gets intense', sent: { agoMin: 40, replied: 'omg sending now' } },
            { fanRef: fans.birch, version: 'missed you 🥺 made something at the gym, want to see?' },
          ],
        },
      });
      await hub.command({ op: 'outreachTouches', pageLabel, touches: [{ fanRef: fans.cold, kind: 'queue', agoMin: 60, by: GRISHA }] });
    },
  },
);
