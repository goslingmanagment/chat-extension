// «Онлайн»'s badges on Fansly (2026-10-28), on by default: each fan's FBuddy gem in its tier's colour with Fansly's
// blue card «Recent Spender» in its corner, the blue card alone where there is no tier; Fansly's card in the settings
// with its row «Алмазики FBuddy в «Онлайн»» («Включены»: the test build is granted FBuddy's address at install, as a
// release is). The stand's copy of FBuddy answers (never FBuddy).

import { openOptions } from '../../support/pages';
import { scenario, type See } from '../kit';

/** The pointer off our window before a picture: no tooltip of the last press stands in it. */
async function shot(s: See, name: string): Promise<void> {
  await s.browser.action('pointer').move({ x: 2, y: 2, origin: 'viewport' }).perform();
  await s.browser.pause(300);
  await s.shot(name);
}

/** The stand's Fansly fan of index `index` (fixture-fansly data.ts `fanOf`): the stand's Fansly knows his account. */
const standFan = (index: number): string => String(920_000_000_000_000_000n + BigInt(index * 29 + 3));

/**
 * Fans the stand's Fansly knows, so each badge shows: the stand gives two in three the blue card and FBuddy's copy a
 * tier by the id (fake-fansly data.ts) — Gold with the card, the card alone, Platinum with it, Basic, Silver without
 * it, nothing at all, Bronze with it, Basic with the card (the card shows).
 */
const FANS: readonly { readonly index: number; readonly username: string; readonly paid: number }[] = [
  { index: 0, username: 'mike_dallas', paid: 0 },
  { index: 9, username: 'jt_runner', paid: 0 },
  { index: 3, username: 'northstar77', paid: 0 },
  { index: 5, username: 'quietguy', paid: 0 },
  { index: 8, username: 'beardedbob', paid: 0 },
  { index: 2, username: 'velvetfox', paid: 0 },
  { index: 4, username: 'sam_k', paid: 0 },
  { index: 12, username: 'lonewolf_92', paid: 0 },
];

scenario(
  'online-badges',
  async (s) => {
    await s.ready();
    // «Не платили и молчат», as the owner's list showed them: who of them pays elsewhere is what the badges tell.
    await s.hub.command({
      op: 'online',
      pageLabel: s.world.pages.fansly.pageLabel,
      items: FANS.map((fan, at) => ({
        fanRef: standFan(fan.index),
        username: fan.username,
        displayName: fan.username,
        seenAgoMs: (at + 1) * 60_000,
        lifetimeGrossMills: fan.paid,
        reason: 'quiet',
        act: 'template_a',
        messageCount: 3,
        lastFanMessageAt: new Date(Date.now() - (76 + at * 41) * 86_400_000).toISOString(),
      })),
    });
    await s.browser.execute(() => (document.activeElement as HTMLElement | null)?.blur());
    await s.browser.waitUntil(() => s.has('dock', '.cg-act__n'), { timeout: 30_000, interval: 300, timeoutMsg: 'no «Онлайн N» on the bar' });

    // The window: the gems and the cards at once, nothing to switch on.
    await s.press(/Онлайн/, 'dock', '.cg-strip button');
    await s.see('modal', 'К разбору', 20_000);
    await s.browser.waitUntil(() => s.has('modal', '[data-cg-badge="gold"], [data-cg-badge="silver"], [data-cg-badge="platinum"], [data-cg-badge="bronze"]'), { timeout: 30_000, interval: 300, timeoutMsg: 'no gem' });
    await s.browser.waitUntil(() => s.has('modal', '[data-cg-badge="blue"]'), { timeout: 30_000, interval: 300, timeoutMsg: 'no blue card' });
    if (await s.has('modal', '[data-cg-online-fbuddy]')) throw new Error('the foot asks for FBuddy on an install that has it');
    await s.browser.pause(800);
    await shot(s, 'badges-gems');
    // The note's picture: the list alone, the fans with their badges.
    const list = await s.rect('modal', '.cg-nw__side');
    if (list !== null) await s.shot('badges-list', { clip: { ...list, height: Math.min(list.height, 560) }, file: 'online-fbuddy-badges' });

    // The settings: Fansly's card says the gems are on.
    await s.toPages();
    await openOptions('accounts');
    await s.browser.waitUntil(async () => (await s.browser.$('[data-pg-fbuddy="on"]')).isExisting(), { timeout: 20_000, interval: 300, timeoutMsg: 'the FBuddy row does not say «Включены»' });
    const card = await s.rect('page', '.pg-sitecard');
    await s.shot('badges-settings', card === null ? {} : { clip: card });
    await s.toChat();
  },
  { sites: ['fansly'] },
);
