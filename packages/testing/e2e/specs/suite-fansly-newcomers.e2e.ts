// «Новые» on Fansly in Firefox (R20; docs/project-unite/architecture.md §8.7, §8.15; FS-NEW-*; plan.md §3
// `suite-fansly-newcomers`): the extension's test build on the Fansly stand against the fake hub, a chatter signed in,
// the Fansly page's own switches on (`newcomers` among them).
// - P10a — the window: the popup's «Новые» opens Fansly's own window over the background's pass (Fansly's boards and
//   its `newcomers` chunk, never the hub's list of ChatSpace); a pass that could ask Fansly nothing (a test build
//   without the stand's API) says the list was not read — never that nobody followed (FX-017); Esc closes it;
//   nothing of ours asks the Fansly stand or the hub for the list.
// - P10b1 — the pass on the stand's API: the period's followers, the queue checking them through FS-NET-1's
//   `newcomers` routes alone (no send, no ack), «Пауза» and «Проверить оставшихся».
// - P10b2 — «Нельзя написать» (FS-NEW-2, FX-003): a follower whose DM rules the creator does not meet says why as soon
//   as the queue reads their chat — nothing is generated or sent —; «Исключить из очереди» takes them out of «К
//   обработке», «Вернуть в очередь» under «Все» brings them back.
// The three admissions of a greeting, two clients and the person's own send are the blocks of P10c…P10d.

import { browser, expect } from '@wdio/globals';
import { mkdirSync } from 'node:fs';

import { E2E_EVIDENCE_DIR } from '../../src/stand/paths';
import { WORLD } from '../../src/scenarios/hub';
import { pageRpc, writeLocalStorage } from '../support/extension';
import { QUIET_PAGE, testBuildPage, useFakeHub } from '../support/fake-hub';
import { setFanslyNeighbor } from '../support/fansly-neighbor';
import { startFanslyShift, type FanslyShift } from '../support/fansly-shift';
import { fakeFansly, fanslyStandServer } from '../support/fansly-stand';
import { useNetworkTrap } from '../support/network-trap';
import { ours, oursExists, oursText, pressOurs, readOurs, waitOursByText, waitOursText } from '../support/ours';
import { dockIs } from '../support/shift';

const A = WORLD.fansly.chats.a;
const WINDOW = '.cg-fnw';
/** The test build's key for the stand's API (bg/fansly/api-probe.ts): the pass asks there, and nothing without it. */
const STAND_API = 'dev.fanslyApi.origin';
const NEWCOMERS_ROUTES = ['followers.new', 'messaging.groups', 'account.byIds', 'group.detail', 'group.create', 'message.history', 'message.automated'];

async function picture(name: string): Promise<void> {
  mkdirSync(E2E_EVIDENCE_DIR, { recursive: true });
  await browser.saveScreenshot(`${E2E_EVIDENCE_DIR}suite-fansly-newcomers-${name}.png`);
}

describe('[host:fansly] «Новые» on Fansly — the window over the background’s pass (R20 P10a)', () => {
  useNetworkTrap();
  const { hub } = useFakeHub();
  let shift: FanslyShift;
  let standStart = 0;

  before(async () => {
    await setFanslyNeighbor(null);
    await fakeFansly().command({ op: 'reset' });
    standStart = await fanslyStandServer.mark();
    shift = await startFanslyShift(hub(), { path: `/messages/${A.group}`, viewport: { width: 1440, height: 900 } });
    await dockIs((d) => d.status === 'ready' && d.target?.endsWith(`:${A.fan}`) === true, 'the dock of the first Fansly chat, ready', 20_000);
  });

  after(async () => {
    // Nothing of the extension asked the Fansly stand for anything (the page's own calls go to the fake Fansly).
    expect((await fanslyStandServer.journal(standStart)).filter((entry) => entry.origin !== 'asset')).toEqual([]);
  });

  it('[NF-001] [NF-002] [FX-017] the popup’s «Новые» opens Fansly’s own window; a pass that could ask Fansly nothing — «Список не загружен», never «nobody new»; Esc closes it', async () => {
    const mark = await hub().mark();
    // The popup's click: `tab.command` is the popup's (and the settings') own request.
    await shift.toPages();
    await browser.url(testBuildPage('popup.html'));
    // No stand API named: the test build's pass asks nothing at all.
    await writeLocalStorage({ [STAND_API]: null });
    expect(await pageRpc('tab.command', { command: { kind: 'surface', surface: 'newcomers' } })).toEqual({ ok: true, payload: { delivered: true } });
    await browser.url(testBuildPage(QUIET_PAGE));
    await shift.toFansly();
    await waitOursText('modal', 'Список не загружен', 'Fansly’s window says the list was not read', { timeout: 20_000, selector: WINDOW });
    // After the window's entrance (≤ 150 ms, ui-design §2.9).
    await browser.pause(400);
    await picture('failed');
    const text = await oursText('modal', WINDOW);
    expect(text).toMatch(/ChatGoose · CG-FAN-REQUEST/);
    expect(text).toMatch(/«Fansly через вкладку»/);
    expect(text).not.toMatch(/новых фоловеров нет/i);
    expect(await oursExists('modal', `${WINDOW} [data-cg-list="failed"]`)).toBe(true);
    // Fansly's window, not the hub's list of ChatSpace: nothing of «Новые» is asked of the hub.
    const { entries } = await hub().journal(mark);
    expect(entries.filter((entry) => entry.route === 'clientAudienceNew' || entry.route === 'clientFanClaim')).toEqual([]);

    await browser.keys(['Escape']);
    await browser.waitUntil(async () => !(await oursExists('modal', WINDOW)), { timeout: 5_000, timeoutMsg: 'Esc did not close «Новые»' });
  });

  it('[NF-030] [NF-038] [NF-039] [FS-NEW-4] the pass on the stand: the period’s followers checked by the queue through FS-NET-1 alone; «Пауза» stops it, «Проверить оставшихся» goes on', async () => {
    const mark = await fakeFansly().mark();
    await shift.toPages();
    await browser.url(testBuildPage('popup.html'));
    await writeLocalStorage({ [STAND_API]: fakeFansly().apiOrigin });
    expect(await pageRpc('tab.command', { command: { kind: 'surface', surface: 'newcomers' } })).toEqual({ ok: true, payload: { delivered: true } });
    await browser.url(testBuildPage(QUIET_PAGE));
    await shift.toFansly();
    // The followers of 48 hours, as the pass read them; the queue runs and may stop.
    await browser.waitUntil(async () => oursExists('modal', `${WINDOW} .cg-fnw__row`), { timeout: 30_000, timeoutMsg: 'no row of the pass in the window' });
    expect(await oursText('modal', WINDOW)).not.toMatch(/Список не загружен/);
    await waitOursByText('modal', `${WINDOW} .cg-fnw__meta button`, 'Пауза', 'the queue runs: «Пауза»', 30_000);
    await pressOurs('modal', `${WINDOW} .cg-fnw__meta button`, 'Пауза');
    await waitOursText('modal', /Проверка на паузе/, 'the queue stands', { timeout: 15_000, selector: WINDOW });
    await waitOursByText('modal', `${WINDOW} .cg-fnw__meta button`, /^Проверить оставшихся: \d+$/, 'the rest can be checked', 15_000);
    await browser.pause(400);
    await picture('paused');
    // Every request of ours was one of FS-NET-1's `newcomers` routes: no send, no ack, nothing outside the list.
    await fakeFansly().assertOursClean(mark, 'the pass of «Новые»');
    const ours = await fakeFansly().calls('ours', mark);
    const routes = new Set(ours.map((entry) => entry.route));
    expect([...routes].filter((route) => route === null || route === undefined || !NEWCOMERS_ROUTES.includes(route))).toEqual([]);
    expect(routes.has('followers.new') && routes.has('message.automated')).toBe(true);
    // «Проверить оставшихся»: the queue goes on.
    await pressOurs('modal', `${WINDOW} .cg-fnw__meta button`, /^Проверить оставшихся/);
    await waitOursByText('modal', `${WINDOW} .cg-fnw__meta button`, 'Пауза', 'the queue runs again', 15_000);
    await browser.keys(['Escape']);
    await browser.waitUntil(async () => !(await oursExists('modal', WINDOW)), { timeout: 5_000, timeoutMsg: 'Esc did not close «Новые»' });
  });

  it('[FX-003] [FS-NEW-2] «Нельзя написать» before anything is generated or sent: a follower whose DMs are closed to the creator says why; «Исключить из очереди» takes them out of «К обработке», «Вернуть в очередь» brings them back', async () => {
    // A new follower whose DM rules the creator does not meet: the chat the queue's `POST /group` makes carries them.
    const followed = await fakeFansly().command({ op: 'follow', silent: true, dmRulesUnmet: true });
    const fan = followed.follow?.followerId ?? '';
    expect(fan).toMatch(/^\d+$/);
    const ROW = `${WINDOW} .cg-fnw__row[data-cg-fan$=":${fan}"]`;
    const checkOf = async (): Promise<string | null> => readOurs('modal', ROW, (node) => node.getAttribute('data-cg-check'));
    const todo = async (): Promise<number> => Number(/К обработке (\d+)/.exec(await oursText('modal', `${WINDOW} [role="tablist"]`))?.[1] ?? Number.NaN);
    const mark = await fakeFansly().mark();
    await shift.toPages();
    await browser.url(testBuildPage('popup.html'));
    await writeLocalStorage({ [STAND_API]: fakeFansly().apiOrigin });
    expect(await pageRpc('tab.command', { command: { kind: 'surface', surface: 'newcomers' } })).toEqual({ ok: true, payload: { delivered: true } });
    await browser.url(testBuildPage(QUIET_PAGE));
    await shift.toFansly();
    // The newest follower: the first the queue checks after the fast part.
    await browser.waitUntil(async () => (await checkOf()) === 'dm-closed', { timeout: 120_000, interval: 250, timeoutMsg: 'the follower with closed DMs was not «Нельзя написать»' });
    // The queue stands: the counts hold still.
    await pressOurs('modal', `${WINDOW} .cg-fnw__meta button`, 'Пауза', 'the queue runs: «Пауза»', 15_000);
    await waitOursText('modal', /Проверка на паузе/, 'the queue stands', { timeout: 15_000, selector: WINDOW });
    await ours('modal', ROW).click();
    await waitOursText('modal', /Нельзя написать.*Fansly не даёт написать: модель не проходит правила фана для личных сообщений\..*Исключить из очереди/, 'the card says why', { timeout: 10_000, selector: `${WINDOW} .cg-fnc__verdict` });
    await browser.pause(400);
    await picture('dm-closed');
    const before = await todo();
    expect(before).toBeGreaterThan(0);

    await pressOurs('modal', `${WINDOW} .cg-fnc__check button`, 'Исключить из очереди');
    await browser.waitUntil(async () => !(await oursExists('modal', ROW)) && (await todo()) === before - 1, { timeout: 10_000, timeoutMsg: 'the excluded fan did not leave «К обработке»' });

    await pressOurs('modal', `${WINDOW} [role="tab"]`, /^Все \d+$/);
    await pressOurs('modal', `${WINDOW} .cg-sp__tools button`, /^Нельзя написать/);
    await browser.waitUntil(async () => (await checkOf()) === 'excluded', { timeout: 10_000, timeoutMsg: 'the excluded fan is not under «Все»' });
    await ours('modal', ROW).click();
    await waitOursText('modal', /Исключён · нельзя написать.*Вернуть в очередь/, 'the card of the excluded fan', { timeout: 10_000, selector: `${WINDOW} .cg-fnc__verdict` });
    await browser.pause(400);
    await picture('excluded');
    await pressOurs('modal', `${WINDOW} .cg-fnc__check button`, 'Вернуть в очередь');
    await browser.waitUntil(async () => (await checkOf()) === 'dm-closed' && (await todo()) === before, { timeout: 10_000, timeoutMsg: 'the fan did not come back to «К обработке»' });

    // Nothing was sent and nothing outside the list was asked: FS-NET-1's `newcomers` routes alone.
    await fakeFansly().assertOursClean(mark, '«Нельзя написать» in «Новые»');
    const routes = new Set((await fakeFansly().calls('ours', mark)).map((entry) => entry.route));
    expect([...routes].filter((route) => route === null || route === undefined || !NEWCOMERS_ROUTES.includes(route))).toEqual([]);
    await browser.keys(['Escape']);
    await browser.waitUntil(async () => !(await oursExists('modal', WINDOW)), { timeout: 5_000, timeoutMsg: 'Esc did not close «Новые»' });
  });
});
