// Fansly: «Новые фоловеры» closed while the check runs (2026-11-04, the owner: «закроем окно, он же должен продолжиться
// и прислать alert, что скан закончился»). Eight fresh followers, Fansly slow to answer: the window is closed with a few
// of them checked, the toast says the check goes on, the next one that it is over with «К обработке N из 8», and its
// «Открыть» brings the window back on the same pass, every fan checked.

import { pageRpc, writeLocalStorage } from '../../support/extension';
import { QUIET_PAGE } from '../../support/fake-hub';
import { fakeFansly } from '../../support/fansly-stand';
import { around, scenario } from '../kit';

const FANS = Array.from({ length: 8 }, (_, i) => `93000000000000${String(1100 + i)}`);

scenario(
  'fansly-newcomers-background',
  async (s) => {
    await s.ready();
    await s.toPages();
    await s.browser.url(s.page('popup.html'));
    // The test build's pass asks the stand's API (bg/fansly/api-probe.ts).
    await writeLocalStorage({ 'dev.fanslyApi.origin': fakeFansly().apiOrigin });
    await pageRpc('tab.command', { command: { kind: 'surface', surface: 'newcomers' } });
    await s.browser.url(s.page(QUIET_PAGE));
    await s.toChat();
    const checked = async (): Promise<number> =>
      (await Promise.all(FANS.map((fan) => s.h.readOurs('modal', `.cg-nw__row[data-cg-fan$=":${fan}"]`, (node) => node.getAttribute('data-cg-check'))))).filter((check) => check === 'ready').length;
    await s.browser.waitUntil(async () => (await checked()) >= 2, { timeout: 60_000, timeoutMsg: 'nobody was checked' });
    await s.shot('newcomers-mid-check');
    await s.browser.keys('Escape');
    await s.see('toast', 'Проверяю новых фоловеров в фоне', 10_000);
    await s.shot('newcomers-goes-on');
    await s.shot('newcomers-goes-on-toast', { clip: around([await s.rect('toast', '.cg-toast')], [16, 16, 16, 4]) });
    await s.see('toast', 'Новые фоловеры проверены', 60_000);
    await s.shot('newcomers-done-toast');
    await s.shot('newcomers-done-toast-crop', { clip: around([await s.rect('toast', '.cg-toast')], [16, 16, 16, 4]) });
    // It stays after the pointer passed over it (the review, 2026-11-04: it went a second later).
    await s.h.ours('toast', '.cg-toast').moveTo();
    await s.browser.action('pointer').move({ x: 300, y: 500 }).perform();
    await s.wait(2500);
    await s.see('toast', 'Новые фоловеры проверены', 1000);
    await s.press(/^Открыть$/, 'toast', '.cg-toast__acts button');
    await s.browser.waitUntil(async () => (await checked()) === FANS.length, { timeout: 30_000, timeoutMsg: 'the window did not come back checked' });
    // Opened again, the pass reads the followers since its end (#333): the picture waits for that read.
    await s.browser.waitUntil(async () => !(await s.text('modal')).includes('Загружаем фоловеров'), { timeout: 30_000, timeoutMsg: 'the window kept loading' });
    await s.shot('newcomers-reopened');
  },
  {
    sites: ['fansly'],
    before: async () => {
      await fakeFansly().command({ op: 'newcomers', followers: FANS.map((fanId, i) => ({ fanId, ageHours: 0.2 + i * 0.3 })) });
      // Fansly answers our reads of a chat slowly: the check takes a while.
      await fakeFansly().command({ op: 'api', rules: [{ route: 'message.history', caller: 'ours', outcome: { kind: 'delay', ms: 1500 } }] });
    },
  },
);
