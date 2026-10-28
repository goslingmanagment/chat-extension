// The fans' badges beyond «Онлайн» on Fansly (2026-10-28): FBuddy's gem and Fansly's blue card beside a fan's name in
// Spenders' rows and the fan's card, in «Рассылка»'s rows, and in «Новые фоловеры»' rows and card. The stand's Fansly
// gives two in three fans it knows the blue card, the stand's copy of FBuddy a tier by the id (fake-fansly data.ts).

import { pageRpc, writeLocalStorage } from '../../support/extension';
import { QUIET_PAGE } from '../../support/fake-hub';
import { fakeFansly } from '../../support/fansly-stand';
import { scenario, type See } from '../kit';

const GEM = '[data-cg-badge="gold"], [data-cg-badge="silver"], [data-cg-badge="platinum"], [data-cg-badge="bronze"]';

/** The pointer off our window before a picture: no tooltip of the last press stands in it. */
async function shot(s: See, name: string): Promise<void> {
  await s.browser.action('pointer').move({ x: 2, y: 2, origin: 'viewport' }).perform();
  await s.browser.pause(400);
  await s.shot(name);
}

async function gems(s: See, where: string, what: string): Promise<void> {
  await s.browser.waitUntil(() => s.has('modal', `${where} :is(${GEM})`), { timeout: 30_000, interval: 300, timeoutMsg: `no gem in ${what}` });
}

scenario(
  'fan-badges',
  async (s) => {
    await s.ready();
    await s.browser.execute(() => (document.activeElement as HTMLElement | null)?.blur());

    // Spenders: the rows, then a fan's card with the badge beside the name.
    await s.keys(...s.PANEL, 'm');
    await s.see('modal', 'Потратил', 20_000);
    await gems(s, '.cg-bd__who', 'Spenders\' rows');
    await shot(s, 'badges-spenders');
    await s.h.ours('modal', `.cg-bd__who:has(:is(${GEM}))`).click();
    await gems(s, '.cg-pv__name', 'the fan\'s card');
    await shot(s, 'badges-spenders-card');
    await s.closeAll();

    // «Рассылка»: its rows.
    await s.keys(...s.PANEL, 'm');
    await s.browser.waitUntil(() => s.has('modal', '.cg-sp__outreach'), { timeout: 20_000, interval: 200, timeoutMsg: 'Spenders did not open' });
    await s.press(/^Рассылка/, 'modal', '.cg-sp__outreach');
    await s.see('modal', 'Предложение', 20_000);
    await gems(s, '.cg-nw__name', '«Рассылка»\' rows');
    await shot(s, 'badges-outreach');
    await s.closeAll();

    // «Новые фоловеры»: the pass's rows and the chosen follower's card.
    await s.toPages();
    await s.browser.url(s.page('popup.html'));
    await writeLocalStorage({ 'dev.fanslyApi.origin': fakeFansly().apiOrigin });
    await pageRpc('tab.command', { command: { kind: 'surface', surface: 'newcomers' } });
    await s.browser.url(s.page(QUIET_PAGE));
    await s.toChat();
    await s.browser.waitUntil(() => s.has('modal', '.cg-fnw .cg-nw__tab'), { timeout: 30_000, timeoutMsg: '«Новые» did not open' });
    // The stand's followers are all checked by now: «Все» lists them.
    await s.press(/^Все/, 'modal', '.cg-fnw .cg-nw__tab');
    await s.browser.waitUntil(() => s.has('modal', '.cg-fnw .cg-nw__row'), { timeout: 30_000, timeoutMsg: 'no row of the pass' });
    await gems(s, '.cg-fnw .cg-nw__name', '«Новые»\' rows');
    await s.h.ours('modal', `.cg-fnw .cg-nw__row:has(.cg-nw__name :is(${GEM}))`).click();
    await s.browser.pause(1_500);
    await shot(s, 'badges-newcomers');
    // The note's picture: «Новые»' list alone, the followers with their badges.
    const list = await s.rect('modal', '.cg-fnw .cg-nw__side');
    if (list !== null) await s.shot('badges-newcomers-list', { clip: { ...list, height: Math.min(list.height, 620) }, file: 'fan-badges-newcomers' });
  },
  { sites: ['fansly'], timeout: 240_000 },
);
