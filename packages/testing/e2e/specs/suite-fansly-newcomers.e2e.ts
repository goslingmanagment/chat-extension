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
// - P10c — the card's greeting (FS-NEW-3, FS-NEW-6, FS-IDN-6): the person's own text, one click — ONE `POST /message`
//   of ours to the group the pass resolved (never the fan's id), the hub's custody «sent», the fan «Уже писали».
// - P10d — the full window/pass/greeting flow (§8.7, §8.15): the three admissions, the history and freshness fences,
//   two real installs on one hub, and the person's own send after an insert. The journal awaits P10b3 (#144).

import { browser, expect } from '@wdio/globals';
import { mkdirSync } from 'node:fs';

import type { NewcomerSeed } from '../../fixture-fansly/src/server-protocol';
import type { WireMessage } from '../../fixture-fansly/src/wire';
import type { FakeHubJournalEntry } from '../../src/fake-hub/types';
import { FAKE_FANSLY_MEDIA_HOST } from '../../src/fake-fansly/data';
import { E2E_EVIDENCE_DIR } from '../../src/stand/paths';
import { WORLD } from '../../src/scenarios/hub';
import { suspendBackground } from '../support/background';
import { assignPersona, pageRpc, readLocalStorage, writeLocalStorage } from '../support/extension';
import { QUIET_PAGE, testBuildPage, useFakeHub } from '../support/fake-hub';
import { setFanslyNeighbor } from '../support/fansly-neighbor';
import { startFanslyShift, type FanslyShift } from '../support/fansly-shift';
import { FANSLY_MAIN, callFansly, fakeFansly, fanslyStandServer, fanslyStandUrl, waitForFanslyStandIdle, waitForFanslyStandReady } from '../support/fansly-stand';
import { useNetworkTrap } from '../support/network-trap';
import { ours, oursExists, oursText, pressOurs, readOurs, waitOursByText, waitOursText } from '../support/ours';
import { dockIs } from '../support/shift';
import { inBrowser, startSecondBrowser } from '../support/second';

const A = WORLD.fansly.chats.a;
const PAGE = WORLD.pages.fansly;
const WINDOW = '.cg-fnw';

/** The status filter is one menu: open it, choose the status. */
async function chooseStatus(status: RegExp): Promise<void> {
  await pressOurs('modal', `${WINDOW} .cg-fnw__tools button.cg-fnw__filter`, /./);
  await pressOurs('modal', `${WINDOW} [role="menuitemradio"]`, status);
}
/** The test build's key for the stand's API (bg/fansly/api-probe.ts): the pass asks there, and nothing without it. */
const STAND_API = 'dev.fanslyApi.origin';
const NEWCOMERS_ROUTES = ['followers.new', 'messaging.groups', 'account.byIds', 'group.detail', 'group.create', 'message.history', 'message.automated'];

async function picture(name: string): Promise<void> {
  mkdirSync(E2E_EVIDENCE_DIR, { recursive: true });
  await browser.saveScreenshot(`${E2E_EVIDENCE_DIR}suite-fansly-newcomers-${name}.png`);
}

describe('[host:fansly] «Новые» on Fansly — the window over the background’s pass (R20 P10a)', () => {
  const { trap } = useNetworkTrap();
  // Each follower's picture comes from Fansly's CDN, as Fansly's own page loads it (X59).
  before(() => trap().expectSiteMedia(FAKE_FANSLY_MEDIA_HOST));
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

  it('[NF-001] [NF-002] [FX-017] the popup’s «Новые» opens Fansly’s own window; a pass that could ask Fansly nothing — its error card, never «nobody new»; Esc closes it', async () => {
    const mark = await hub().mark();
    // The popup's click: `tab.command` is the popup's (and the settings') own request.
    await shift.toPages();
    await browser.url(testBuildPage('popup.html'));
    // No stand API named: the test build's pass asks nothing at all.
    await writeLocalStorage({ [STAND_API]: null });
    expect(await pageRpc('tab.command', { command: { kind: 'surface', surface: 'newcomers' } })).toEqual({ ok: true, payload: { delivered: true } });
    await browser.url(testBuildPage(QUIET_PAGE));
    await shift.toFansly();
    // The failed list is its error card alone (no «Список не загружен» over it since the lighter window).
    await waitOursText('modal', 'ChatGoose · CG-FAN-REQUEST', 'Fansly’s window says the list was not read', { timeout: 20_000, selector: WINDOW });
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
    await waitOursByText('modal', `${WINDOW} button.cg-fnw__run`, 'Пауза', 'the queue runs: «Пауза»', 30_000);
    await pressOurs('modal', `${WINDOW} button.cg-fnw__run`, 'Пауза');
    await waitOursText('modal', /Проверка на паузе/, 'the queue stands', { timeout: 15_000, selector: WINDOW });
    await waitOursByText('modal', `${WINDOW} button.cg-fnw__run`, /^Проверить оставшихся: \d+$/, 'the rest can be checked', 15_000);
    await browser.pause(400);
    await picture('paused');
    // Every request of ours was one of FS-NET-1's `newcomers` routes: no send, no ack, nothing outside the list.
    await fakeFansly().assertOursClean(mark, 'the pass of «Новые»');
    const ours = await fakeFansly().calls('ours', mark);
    const routes = new Set(ours.map((entry) => entry.route));
    expect([...routes].filter((route) => route === null || route === undefined || !NEWCOMERS_ROUTES.includes(route))).toEqual([]);
    expect(routes.has('followers.new') && routes.has('message.automated')).toBe(true);
    // «Проверить оставшихся»: the queue goes on.
    await pressOurs('modal', `${WINDOW} button.cg-fnw__run`, /^Проверить оставшихся/);
    await waitOursByText('modal', `${WINDOW} button.cg-fnw__run`, 'Пауза', 'the queue runs again', 15_000);
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
    await pressOurs('modal', `${WINDOW} button.cg-fnw__run`, 'Пауза', 'the queue runs: «Пауза»', 15_000);
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
    await chooseStatus(/^Нельзя написать/);
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

  it('[NF-019] [NF-028] [FS-NEW-3] [FS-NEW-6] [FS-IDN-6] the card’s own greeting without AI: one click — ONE `POST /message` to the group the pass resolved; custody «sent» and the fan «Уже писали»', async () => {
    // A new follower with no chat yet: the queue's `POST /group` makes it, then reads its empty history — «Не писали».
    const followed = await fakeFansly().command({ op: 'follow', silent: true });
    const fan = followed.follow?.followerId ?? '';
    expect(fan).toMatch(/^\d+$/);
    const ROW = `${WINDOW} .cg-fnw__row[data-cg-fan$=":${fan}"]`;
    const checkOf = async (): Promise<string | null> => readOurs('modal', ROW, (node) => node.getAttribute('data-cg-check'));
    const mark = await fakeFansly().mark();
    const hubMark = await hub().mark();
    await shift.toPages();
    await browser.url(testBuildPage('popup.html'));
    await writeLocalStorage({ [STAND_API]: fakeFansly().apiOrigin });
    expect(await pageRpc('tab.command', { command: { kind: 'surface', surface: 'newcomers' } })).toEqual({ ok: true, payload: { delivered: true } });
    await browser.url(testBuildPage(QUIET_PAGE));
    await shift.toFansly();
    // Closing keeps the previous scenario's «Нельзя написать» filter, which hides this ready fan.
    await chooseStatus(/^Все статусы/);
    await browser.waitUntil(async () => (await checkOf()) === 'ready', { timeout: 120_000, interval: 250, timeoutMsg: 'the new follower was not checked «Не писали»' });
    await ours('modal', ROW).click();
    // The card's chat is the group the pass resolved, never the fan's id (FS-IDN-6).
    await browser.waitUntil(async () => oursExists('modal', `${WINDOW} .cg-fnc__greet textarea`), { timeout: 10_000, timeoutMsg: 'the card has no greeting' });
    const href = await readOurs('modal', `${WINDOW} .cg-fnc__open`, (node) => node.getAttribute('href'));
    const group = /\/messages\/(\d+)$/.exec(href ?? '')?.[1] ?? '';
    expect(group).toMatch(/^\d+$/);
    expect(group).not.toBe(fan);
    expect(await oursText('modal', `${WINDOW} .cg-fnc__greet`)).toMatch(/AI ничего не отправляет автоматически/);
    expect(await ours('modal', `${WINDOW} .cg-fnc__greet textarea`).getAttribute('maxlength')).toBe('5000');
    // Keep the greeted row visible after it leaves «К обработке»; the transient send status is not a receipt.
    await pressOurs('modal', `${WINDOW} [role="tab"]`, /^Все \d+$/);

    await ours('modal', `${WINDOW} .cg-fnc__greet textarea`).click();
    await browser.keys([...'Hi there, welcome!']);
    await pressOurs('modal', `${WINDOW} .cg-fnc__gbar button`, 'Отправить →');
    // A receipt marks the row greeted and removes its greeting field, including the transient «Отправлено».
    // Wait for durable custody, then inspect the final row instead of polling a status that may already be gone.
    // The hub's custody of this fan: one attempt, sent.
    await browser.waitUntil(
      async () => {
        const claim = (await hub().status()).claims.find((entry) => entry.pageLabel === PAGE.pageLabel && entry.fanRef === fan);
        return (claim?.attempts ?? []).length === 1 && claim?.attempts[0]?.state === 'sent';
      },
      { timeout: 30_000, interval: 250, timeoutMsg: 'the hub’s custody of the fan is not «sent»' },
    );
    // «Уже писали»: the card offers no second greeting.
    await browser.waitUntil(async () => (await checkOf()) === 'greeted', { timeout: 10_000, timeoutMsg: 'the greeted fan is not «Уже писали»' });
    await ours('modal', ROW).click();
    await waitOursText('modal', /Уже писали/, 'the card shows the greeted fan', { timeout: 10_000, selector: `${WINDOW} .cg-fnc__verdict` });
    expect(await oursExists('modal', `${WINDOW} .cg-fnc__greet`)).toBe(false);
    await browser.pause(400);
    await picture('greeting-sent');
    // One click, one request of ours (NF-019) to the resolved group (FS-IDN-6); nothing outside FS-NET-1.
    const sends = (await fakeFansly().calls('ours', mark)).filter((entry) => entry.route === 'message.send');
    expect(sends).toHaveLength(1);
    expect(sends[0]).toMatchObject({ method: 'POST', status: 200, detail: { groupId: group } });
    await fakeFansly().assertOursClean(mark, 'the greeting of a «Новые» card');
    expect((await hub().journal(hubMark)).entries.filter((entry) => entry.route === 'aiFeatureStream')).toEqual([]);
    await browser.keys(['Escape']);
    await browser.waitUntil(async () => !(await oursExists('modal', WINDOW)), { timeout: 5_000, timeoutMsg: 'Esc did not close «Новые»' });
  });
});

const CARD = `${WINDOW} .cg-fnc`;
const FIELD = `${CARD} .cg-fnc__greet textarea`;
const BUTTONS = `${CARD} .cg-fnc__gbar button`;
const ROW = (fan: string): string => `${WINDOW} .cg-fnw__row[data-cg-fan$=":${fan}"]`;
const checkOf = (fan: string): Promise<string | null> => readOurs('modal', ROW(fan), (node) => node.getAttribute('data-cg-check'));
const fieldText = (): Promise<string | null> => readOurs('modal', FIELD, (node) => (node as HTMLTextAreaElement).value);
const posts = async (mark: number, caller: 'ours' | 'page' = 'ours') => (await fakeFansly().calls(caller, mark)).filter((entry) => entry.route === 'message.send');

async function closeWindow(): Promise<void> {
  for (let n = 0; n < 3 && await oursExists('modal', WINDOW); n += 1) {
    await browser.keys('Escape');
    await browser.pause(200);
  }
  await browser.waitUntil(async () => !(await oursExists('modal', WINDOW)), { timeout: 5_000, timeoutMsg: '«Новые» did not close' });
}

async function openWindow(shift: FanslyShift): Promise<void> {
  await shift.toPages();
  await browser.url(testBuildPage('popup.html'));
  expect(await pageRpc('tab.command', { command: { kind: 'surface', surface: 'newcomers' } })).toMatchObject({ ok: true, payload: { delivered: true } });
  await browser.url(testBuildPage(QUIET_PAGE));
  await shift.toFansly();
  await browser.waitUntil(async () => oursExists('modal', WINDOW), { timeout: 15_000, timeoutMsg: 'no «Новые» window' });
}

describe('[host:fansly] the full «Новые» matrix (R20 P10d; architecture §8.7, §8.15; FS-NEW-*)', () => {
  const { trap } = useNetworkTrap();
  // Each follower's picture comes from Fansly's CDN, as Fansly's own page loads it (X59).
  before(() => trap().expectSiteMedia(FAKE_FANSLY_MEDIA_HOST));
  const { hub } = useFakeHub();
  let shift: FanslyShift;
  let seq = 0;
  let mark = 0;
  let standMark = 0;
  const fanId = (): string => String(940_000_000_000_010_000n + BigInt(++seq));
  const claim = async (fan: string) => (await hub().status()).claims.find((entry) => entry.pageLabel === PAGE.pageLabel && entry.fanRef === fan);
  const calls = async (since: number, route: FakeHubJournalEntry['route']) => (await hub().journal(since)).entries.filter((entry) => entry.route === route);
  const claims = async (since: number, fan: string) => (await calls(since, 'clientFanClaim')).filter((entry) => (entry.request as { fanRef?: string }).fanRef === fan);
  const bodyOf = (entry: FakeHubJournalEntry) => (entry.request as { body: Record<string, unknown> }).body;

  async function select(fan: string, check: string): Promise<string> {
    await pressOurs('modal', `${WINDOW} [role="tab"]`, /^Все \d+$/);
    await browser.waitUntil(async () => (await checkOf(fan)) === check, { timeout: 90_000, interval: 200, timeoutMsg: `${fan} was not ${check}` });
    await ours('modal', ROW(fan)).click();
    await browser.waitUntil(async () => (await readOurs('modal', CARD, (node) => node.getAttribute('data-cg-card')))?.endsWith(`:${fan}`) === true, { timeout: 10_000, timeoutMsg: `no card of ${fan}` });
    const href = await readOurs('modal', `${CARD} .cg-fnc__open`, (node) => node.getAttribute('href'));
    const group = /\/messages\/(\d+)$/.exec(href ?? '')?.[1] ?? '';
    expect(group).toMatch(/^\d+$/);
    expect(group).not.toBe(fan);
    return group;
  }

  async function seed(followers: readonly NewcomerSeed[]): Promise<readonly WireMessage[]> {
    const result = await fakeFansly().command({ op: 'newcomers', followers });
    await openWindow(shift);
    return result.messages ?? [];
  }

  async function archive(fan: string, group: string, messages: readonly WireMessage[]): Promise<void> {
    await hub().command({ op: 'thread', pageLabel: PAGE.pageLabel, conversationRef: group, fanRef: fan });
    await hub().command({ op: 'archiveConversation', pageLabel: PAGE.pageLabel, conversationRef: group, messages: messages.filter((message) => message.groupId === group).map((message) => ({ id: message.id, sender: message.senderId === fan ? 'fan' : 'model' })) });
  }

  async function generate(): Promise<void> {
    await pressOurs('modal', BUTTONS, 'Сгенерировать');
    await browser.waitUntil(async () => (await fieldText()) === 'Hi and welcome!' && await oursExists('modal', `${CARD} .cg-fnc__ai`), { timeout: 30_000, timeoutMsg: 'no usable single greeting with the AI mark' });
  }

  async function greeted(fan: string): Promise<void> {
    await browser.waitUntil(async () => {
      const state = await claim(fan);
      return state?.greeting === 'confirmed' && state.attempts.length === 1 && state.attempts[0]?.state === 'sent';
    }, { timeout: 35_000, interval: 150, timeoutMsg: `${fan}: the hub did not confirm exactly one greeting` });
    await browser.waitUntil(async () => (await checkOf(fan)) === 'greeted', { timeout: 10_000, timeoutMsg: `${fan}: no «Уже писали» row` });
    expect(await oursExists('modal', FIELD)).toBe(false);
  }

  async function sentText(group: string, text: string): Promise<void> {
    await closeWindow();
    await callFansly('open', group, 'router');
    await browser.waitUntil(async () => (await callFansly('route')).groupId === group && (await browser.$(FANSLY_MAIN.list).getText()).includes(text), { timeout: 15_000, timeoutMsg: 'the server’s conversation does not contain the field’s text' });
    await waitForFanslyStandIdle();
  }

  before(async () => {
    await setFanslyNeighbor(null);
    await fakeFansly().command({ op: 'reset' });
    standMark = await fanslyStandServer.mark();
    shift = await startFanslyShift(hub(), { path: `/messages/${A.group}`, viewport: { width: 1440, height: 900 } });
    await dockIs((d) => d.status === 'ready', 'the P10d shift is ready', 20_000);
  });

  beforeEach(async () => { mark = await fakeFansly().mark(); });
  afterEach(async () => {
    await shift.toFansly();
    await closeWindow();
    await fakeFansly().assertOursClean(mark, 'the full newcomers suite');
    await hub().command({ op: 'config', patch: { aiChunkDelayMs: 0, aiTexts: { 'hi-greeting': 'Hi and welcome!' } } });
    await fakeFansly().command({ op: 'send', echo: 'after', receiptDelayMs: 0, echoDelayMs: 0 });
  });
  after(async () => {
    expect((await fanslyStandServer.journal(standMark)).filter((entry) => entry.origin !== 'asset')).toEqual([]);
  });

  it('[NF-003] [NF-004] [NF-005] [NF-007] [NF-008] [NF-009] [NF-031] [FS-NEW-1] [X59] default 12 hours, profiles and the custom name, statuses and counts; periods 1 and 720 read their own followers; the choice is remembered', async function () {
    this.timeout(180_000);
    const [fresh, closed, written, old] = [fanId(), fanId(), fanId(), fanId()];
    await seed([
      { fanId: fresh, ageHours: 0.5, customName: 'Мой новый фан', messages: [] },
      { fanId: closed, ageHours: 2, dmRulesUnmet: true, messages: [] },
      { fanId: written, ageHours: 11, messages: [{ from: 'creator', text: 'We already spoke' }] },
      { fanId: old, ageHours: 700, messages: [] },
    ]);
    expect(await oursText('modal', `${WINDOW} .cg-fnw__period`)).toBe('12 часов');
    await select(fresh, 'ready');
    await browser.waitUntil(async () => (await checkOf(closed)) === 'dm-closed' && (await checkOf(written)) === 'greeted', { timeout: 30_000 });
    expect(await oursText('modal', `${WINDOW} [role="tablist"]`)).toMatch(/К обработке 2.*Все 3/);
    expect(await oursExists('modal', ROW(old))).toBe(false);
    expect(await oursText('modal', ROW(fresh))).toContain('Мой новый фан');
    expect(await oursText('modal', CARD)).toContain(`About stand_account_${fresh.slice(-6)}`);
    // Fansly's host account carries its id alone; the bound hub page supplies the window's display name.
    expect(await oursText('modal', `${WINDOW} .cg-fnw__page`)).toBe(PAGE.title);
    await waitOursText('modal', / — .* · местное время/, 'the dates of the pass under the toolbar', { selector: `${WINDOW} .cg-fnw__range`, timeout: 30_000 });
    await waitOursText('modal', 'Проверено 3 из 3', 'the pass’s progress', { selector: WINDOW, timeout: 30_000 });
    for (const [period, count, included, excluded] of [['1 час', 1, fresh, closed], ['30 дней', 4, old, '']] as const) {
      await ours('modal', `${WINDOW} .cg-fnw__period`).click();
      await pressOurs('modal', '[role="menuitemradio"]', period);
      await waitOursText('modal', new RegExp(`Все ${count}\\b`), `the ${period} pass`, { selector: `${WINDOW} [role="tablist"]`, timeout: 40_000 });
      await select(included, 'ready');
      if (excluded !== '') expect(await oursExists('modal', ROW(excluded))).toBe(false);
    }
    // X59: the next window opens on the period chosen last — then back to the default for the tests after this one.
    await closeWindow();
    await openWindow(shift);
    await waitOursText('modal', '30 дней', 'the remembered period', { selector: `${WINDOW} .cg-fnw__period`, timeout: 20_000 });
    await ours('modal', `${WINDOW} .cg-fnw__period`).click();
    await pressOurs('modal', '[role="menuitemradio"]', '12 часов');
    await waitOursText('modal', '12 часов', 'the default period again', { selector: `${WINDOW} .cg-fnw__period` });
    expect(await posts(mark)).toEqual([]);
  });

  it('[NF-006] [NF-030] [FS-NEW-1] whole-pass search and filters, then a second page after row 100; looking takes no custody', async () => {
    const followers = Array.from({ length: 105 }, (_, index) => ({ fanId: fanId(), ageHours: index / 1000, customName: index === 104 ? 'За сотой строкой' : `Фан ${index + 1}` }));
    await seed(followers);
    await pressOurs('modal', `${WINDOW} button.cg-fnw__run`, 'Пауза', 'the queue can pause', 40_000);
    await waitOursText('modal', /Проверка на паузе/, 'the queue paused', { selector: WINDOW });
    await waitOursText('modal', /Все 105\b/, 'the paused pass keeps all its followers', { selector: `${WINDOW} [role="tablist"]` });
    const hubMark = await hub().mark();
    await ours('modal', `${WINDOW} .cg-sp__search input`).setValue('За сотой строкой');
    const last = followers[104]?.fanId ?? '';
    await browser.waitUntil(async () => oursExists('modal', ROW(last)), { timeout: 10_000, timeoutMsg: 'search did not find an off-page fan' });
    expect(await oursText('modal', `${WINDOW} [role="tablist"]`)).toMatch(/Все 1\b/);
    await ours('modal', `${WINDOW} .cg-sp__search input`).setValue('no-such-follower');
    await browser.waitUntil(async () => oursExists('modal', `${WINDOW} [data-cg-empty]`), { timeout: 10_000 });
    // WebDriver's elementClear (setValue('')) does not emit input in Firefox. Clear as a person does: Esc
    // dispatches the empty query; a paused queue must still return its rows without being resumed.
    await ours('modal', `${WINDOW} .cg-sp__search input`).click();
    await browser.keys('Escape');
    expect(await ours('modal', `${WINDOW} .cg-sp__search input`).getValue()).toBe('');
    await pressOurs('modal', `${WINDOW} [role="tab"]`, /^Все 105$/);
    expect(await readOurs('modal', `${WINDOW} [data-cg-pass]`, (node) => node.getAttribute('data-cg-pass'))).toBe('paused');
    await chooseStatus(/^В очереди/);
    await browser.waitUntil(async () => oursExists('modal', `${WINDOW} .cg-fnw__row`), { timeout: 10_000 });
    expect((await oursText('modal', `${WINDOW} .cg-fnw__row`))).not.toContain('Уже писали');
    await chooseStatus(/^Все статусы/);
    await ours('modal', ROW(followers[0]?.fanId ?? '')).click();
    await browser.keys('End');
    await browser.waitUntil(async () => oursExists('modal', `${WINDOW} [aria-posinset="100"]`), { timeout: 10_000, timeoutMsg: 'the end of the first 100 rows did not render' });
    // 105 rows of 70 px (ui/hosts/fansly/newcomers ROW_HEIGHTS): the second page is in the list.
    await browser.waitUntil(async () => (await readOurs('modal', `${WINDOW} .cg-fnw__list .cg-vlist__inner`, (node) => node.style.height)) === `${105 * 70}px`, { timeout: 10_000, timeoutMsg: 'the next page was not appended' });
    await browser.keys('End');
    await browser.waitUntil(async () => oursExists('modal', ROW(last)), { timeout: 10_000, timeoutMsg: 'the 105th row is not reachable' });
    expect(await calls(hubMark, 'clientFanClaim')).toEqual([]);
    const followerCalls = (await fakeFansly().calls('ours', mark)).filter((entry) => entry.route === 'followers.new');
    expect(followerCalls).toHaveLength(2);
    expect(await posts(mark)).toEqual([]);
  });

  it('[NF-010] [NF-033] [FS-NEW-1] the conversation preview loads older pages up to 750, in order, with automation labels; no ack or send', async function () {
    this.timeout(180_000);
    const fan = fanId();
    const messages = await seed([{ fanId: fan, messages: [
      ...Array.from({ length: 757 }, (_, n) => ({ from: 'creator' as const, text: `Automatic ${n}`, type: 2 })),
      { from: 'creator', text: 'Stand welcome: thanks for the follow' },
      { from: 'creator', text: 'A mass copy', correlationId: '806000000000000099' },
      { from: 'creator', text: 'A personal greeting' },
    ] }]);
    await select(fan, 'greeted');
    const ids = () => readOurs('modal', `${CARD} .cg-fnc__feed`, (node) => [...node.querySelectorAll('[data-cg-msg]')].map((message) => message.getAttribute('data-cg-msg')));
    await browser.waitUntil(async () => (await ids())?.length === 250, { timeout: 45_000, timeoutMsg: 'the first preview page did not arrive' });
    expect(await oursText('modal', `${CARD} .cg-fnc__feed`)).toMatch(/Авто/);
    for (const count of [500, 750]) {
      await pressOurs('modal', `${CARD} .cg-fnc__older button`, /Более ранние сообщения/);
      await browser.waitUntil(async () => (await ids())?.length === count, { timeout: 45_000, timeoutMsg: `the preview did not reach ${count}` });
    }
    expect(await ids()).toEqual(messages.slice(-750).map((message) => message.id));
    expect(await oursExists('modal', `${CARD} .cg-fnc__older button`)).toBe(false);
    expect(await oursText('modal', `${CARD} .cg-fnc__feed`)).toMatch(/750/);
    expect(await posts(mark)).toEqual([]);
  });

  it('[NF-011] [FS-NEW-1] «Открыть в Fansly ↗» opens the resolved group in a new tab and leaves «Новые» open', async () => {
    const fan = fanId();
    await seed([{ fanId: fan, messages: [] }]);
    const group = await select(fan, 'ready');
    const before = new Set(await browser.getWindowHandles());
    await ours('modal', `${CARD} .cg-fnc__open`).click();
    let opened = '';
    try {
      await browser.waitUntil(async () => {
        opened = (await browser.getWindowHandles()).find((handle) => !before.has(handle)) ?? '';
        return opened !== '';
      }, { timeout: 10_000, timeoutMsg: 'the chat did not open in a new tab' });
      await browser.switchToWindow(opened);
      // A new tab is about:blank until its navigation commits: on a busy runner the first read came that early
      // (CI 39015196894, 39014303064, 38997557324, 38988941619). Wait for the address, as pages-wiring does.
      const expected = fanslyStandUrl(`/messages/${group}`);
      await browser.waitUntil(async () => (await browser.getUrl()) === expected, { timeout: 10_000, timeoutMsg: `the new tab did not reach ${expected}` });
      expect(await browser.getUrl()).toBe(expected);
    } finally {
      if (opened !== '') { await browser.switchToWindow(opened); await browser.closeWindow(); }
      await shift.toFansly();
    }
    expect(await oursExists('modal', WINDOW)).toBe(true);
    expect(await checkOf(fan)).toBe('ready');
    expect(await posts(mark)).toEqual([]);
  });

  it('[FX-003] [FS-NEW-2] an unpaid DM price is visible before generating, claiming or sending; exclusion and restoration preserve its reason', async () => {
    const fan = fanId();
    const hubMark = await hub().mark();
    await seed([{ fanId: fan, dmPriceMills: 1700 }]);
    await select(fan, 'dm-closed');
    await waitOursText('modal', /только платные сообщения — \$1\.70 за сообщение/, 'the unpaid price is visible', { selector: `${CARD} .cg-fnc__verdict` });
    expect(await oursExists('modal', FIELD)).toBe(false);
    await pressOurs('modal', `${CARD} .cg-fnc__check button`, 'Исключить из очереди');
    await browser.waitUntil(async () => (await checkOf(fan)) === 'excluded', { timeout: 10_000 });
    expect(await oursText('modal', `${WINDOW} [role="tablist"]`)).toMatch(/К обработке 0.*Все 1/);
    await pressOurs('modal', `${CARD} .cg-fnc__check button`, 'Вернуть в очередь');
    await browser.waitUntil(async () => (await checkOf(fan)) === 'dm-closed', { timeout: 10_000 });
    expect(await oursText('modal', `${CARD} .cg-fnc__verdict`)).toContain('$1.70');
    expect(await claims(hubMark, fan)).toEqual([]);
    expect(await calls(hubMark, 'aiFeatureStream')).toEqual([]);
    expect(await posts(mark)).toEqual([]);
  });

  it('[NF-025] [NF-030] [FS-NEW-1] a failed second follower page retains the first 100 and says «Результат неполный»; continuing reads the rest', async () => {
    const followers = Array.from({ length: 101 }, (_, n) => ({ fanId: fanId(), ageHours: n / 1000 }));
    await fakeFansly().command({ op: 'api', rules: [
      { route: 'followers.new', caller: 'ours', times: 1, outcome: { kind: 'delay', ms: 0 } },
      { route: 'followers.new', caller: 'ours', times: 4, outcome: { kind: 'status', status: 500 } },
    ] });
    await seed(followers);
    await waitOursText('modal', /Результат неполный/, 'the partial list is named', { selector: WINDOW, timeout: 30_000 });
    expect(await oursText('modal', WINDOW)).not.toMatch(/новых фоловеров нет/);
    await waitOursText('modal', /CG-FAN-REQUEST/, 'the failure’s reason is shown', { selector: `${WINDOW} .cg-fnw__stopped` });
    expect(await oursText('modal', `${WINDOW} [role="tablist"]`)).toMatch(/Все 100\b/);
    const beforeRetry = (await fakeFansly().calls('ours', mark)).filter((entry) => entry.route === 'followers.new');
    expect(beforeRetry.map((entry) => entry.status)).toEqual([200, 500, 500, 500, 500]);
    await pressOurs('modal', `${WINDOW} button.cg-fnw__run`, /^Проверить оставшихся/);
    await waitOursText('modal', /Все 101\b/, 'the retry finished the list', { selector: `${WINDOW} [role="tablist"]`, timeout: 40_000 });
    await pressOurs('modal', `${WINDOW} button.cg-fnw__run`, 'Пауза', 'pause the completed list’s queue', 30_000);
    expect(await oursExists('modal', `${WINDOW} .cg-nc__incomplete`)).toBe(false);
    expect(await posts(mark)).toEqual([]);
  });

  it('[NF-012] [NF-038] [NF-039] [FS-NEW-4] pause, resume and closing the window preserve the checked row and its own draft; no background scan after close', async () => {
    const fan = fanId();
    const next = fanId();
    await fakeFansly().command({ op: 'api', rules: [{ route: 'group.create', caller: 'ours', times: 1, outcome: { kind: 'delay', ms: 4_000 } }] });
    await seed([{ fanId: fan, messages: [{ from: 'fan', text: 'hello' }] }, { fanId: next, ageHours: 0.01 }]);
    await select(fan, 'reply');
    await ours('modal', FIELD).setValue('My draft survives the pause');
    await pressOurs('modal', `${WINDOW} button.cg-fnw__run`, 'Пауза');
    await waitOursText('modal', /Проверка на паузе/, 'the queue stands', { selector: WINDOW });
    expect(await fieldText()).toBe('My draft survives the pause');
    await pressOurs('modal', `${WINDOW} button.cg-fnw__run`, /^Проверить оставшихся/);
    await browser.waitUntil(async () => (await checkOf(next)) === 'ready', { timeout: 30_000 });
    expect(await fieldText()).toBe('My draft survives the pause');
    // Wait on the stored draft, not on a guessed debounce duration.
    await shift.toPages();
    await browser.waitUntil(async () => JSON.stringify((await readLocalStorage(['newcomers.drafts']))['newcomers.drafts']).includes('My draft survives the pause'), { timeout: 10_000 });
    await shift.toFansly();
    await closeWindow();
    await browser.pause(1_000);
    const quiet = await fakeFansly().mark();
    await browser.pause(1_000);
    expect(await fakeFansly().calls('ours', quiet)).toEqual([]);
    await openWindow(shift);
    await select(fan, 'reply');
    await browser.waitUntil(async () => (await fieldText()) === 'My draft survives the pause', { timeout: 10_000 });
    expect(await posts(mark)).toEqual([]);
  });

  it('[NF-013] [NF-014] [NF-023] [NF-028] [NF-034] [FS-NEW-6] [FS-NEW-7] an unchanged AI greeting: the pass’s ids, start proof and avatar, hub-only text, no automatic send; the one human click uses this generation', async () => {
    const fan = fanId();
    const messages = await seed([{ fanId: fan, messages: [{ from: 'fan', text: 'A private page-only line' }, { from: 'creator', text: 'Stand welcome: thanks for the follow' }] }]);
    const group = await select(fan, 'reply');
    await archive(fan, group, messages);
    await hub().command({ op: 'config', patch: { aiChunkDelayMs: 1_500 } });
    await ours('modal', FIELD).setValue('A filled draft is locked during generation');
    const hubMark = await hub().mark();
    await pressOurs('modal', BUTTONS, 'Сгенерировать');
    await waitOursText('modal', /Генерируем/, 'generation in flight', { selector: `${CARD} .cg-fnc__gst` });
    const locked = await readOurs('modal', `${CARD} .cg-fnc__gbar`, (node) => [...node.querySelectorAll('button')].map((button) => ({ text: button.textContent?.trim(), disabled: button.getAttribute('aria-disabled') })));
    expect(locked).toEqual(expect.arrayContaining([{ text: 'Отправить →', disabled: 'true' }, { text: 'Открыть и вставить', disabled: 'true' }]));
    await browser.waitUntil(async () => (await fieldText()) === 'Hi and welcome!' && await oursExists('modal', `${CARD} .cg-fnc__ai`), { timeout: 30_000 });
    const [stream] = await calls(hubMark, 'aiFeatureStream');
    expect(await calls(hubMark, 'aiFeatureStream')).toHaveLength(1);
    expect(stream?.status).toBe(200);
    const body = stream === undefined ? {} : bodyOf(stream);
    expect(body).toMatchObject({ fanRef: fan, conversationRef: group, variantCount: 1, personalMessageCount: 1, startProof: { source: 'pass-empty-page', groupId: group, coveredCount: 2, personalCount: 1, automatedIds: [messages[1]?.id] }, coverageCheck: { window: messages.map((message) => ({ id: message.id, dir: message.senderId === fan ? 'fan' : 'model' })) } });
    expect(body['fanAvatarUrl']).toMatch(/^‹\d+ chars›$/);
    expect(body['liveTextContext']).toBeUndefined();
    expect(body['clientContext']).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('A private page-only line');
    expect(await posts(mark)).toEqual([]);
    expect(await claims(hubMark, fan)).toEqual([]);
    await pressOurs('modal', BUTTONS, 'Отправить →');
    await greeted(fan);
    const dispatch = (await claims(hubMark, fan)).find((entry) => bodyOf(entry)['action'] === 'dispatch');
    expect(dispatch === undefined ? null : bodyOf(dispatch)['group']).toMatchObject({ generationRef: expect.any(String), variant: 0, partCount: 1 });
    expect(await posts(mark)).toHaveLength(1);
    await sentText(group, 'Hi and welcome!');
  });

  it('[NF-012] [NF-019] [FS-NEW-6] editing a stale AI result removes the AI label and sends the field as a manual greeting, without a second generation', async () => {
    const fan = fanId();
    await seed([{ fanId: fan, messages: [{ from: 'fan', text: 'hello' }] }]);
    const group = await select(fan, 'reply');
    await archive(fan, group, []);
    const hubMark = await hub().mark();
    await generate();
    expect(await (await waitOursByText('modal', BUTTONS, 'Отправить →', 'stale AI send')).getAttribute('aria-disabled')).toBe('true');
    const edited = 'Hi and welcome! I wrote this extra line myself.';
    await ours('modal', FIELD).setValue(edited);
    await browser.waitUntil(async () => !(await oursExists('modal', `${CARD} .cg-fnc__ai`)), { timeout: 5_000 });
    await pressOurs('modal', BUTTONS, 'Отправить →');
    await greeted(fan);
    expect(await calls(hubMark, 'aiFeatureStream')).toHaveLength(1);
    const dispatch = (await claims(hubMark, fan)).find((entry) => bodyOf(entry)['action'] === 'dispatch');
    // The fake hub redacts fingerprints in its request journal; sentText below checks the exact edited text.
    expect(dispatch?.status).toBe(200);
    expect(dispatch === undefined ? null : bodyOf(dispatch)['group']).toMatchObject({ kind: 'manual', textFingerprint: '‹64 chars›' });
    expect(await posts(mark)).toHaveLength(1);
    await sentText(group, edited);
  });

  it('[NF-018] [NF-024] [NF-036] [FS-NEW-6] history changed silently after review: «Проверка изменилась — подтвердите черновик», the draft kept, no custody or POST', async () => {
    const fan = fanId();
    await seed([{ fanId: fan, messages: [] }]);
    const group = await select(fan, 'ready');
    await ours('modal', FIELD).setValue('My reviewed greeting');
    await fakeFansly().command({ op: 'message', groupId: group, from: 'fan', text: 'A new message after review', silent: true });
    const hubMark = await hub().mark();
    const beforeSend = await fakeFansly().mark();
    await pressOurs('modal', BUTTONS, 'Отправить →');
    await waitOursText('modal', /CG-FNEW-HISTORY/, 'the changed history refuses', { selector: `${CARD} .cg-fnc__gst`, timeout: 20_000 });
    await waitOursText('modal', 'Проверка изменилась — подтвердите черновик', 'the reviewed draft needs confirmation', { selector: CARD });
    expect(await fieldText()).toBe('My reviewed greeting');
    expect(await claims(hubMark, fan)).toEqual([]);
    expect(await posts(beforeSend)).toEqual([]);
    expect((await fakeFansly().calls('ours', beforeSend)).some((entry) => entry.route === 'message.history')).toBe(true);
  });

  it('[NF-018] [NF-034] [FS-NEW-7] the hub catching up cannot refresh an old AI result: its send stays disabled; a new generation on covered history can send', async () => {
    const fan = fanId();
    const messages = await seed([{ fanId: fan, messages: [{ from: 'fan', text: 'The hub has not captured this yet' }] }]);
    const group = await select(fan, 'reply');
    await hub().command({ op: 'thread', pageLabel: PAGE.pageLabel, conversationRef: group, fanRef: fan });
    await hub().command({ op: 'archiveConversation', pageLabel: PAGE.pageLabel, conversationRef: group, messages: [] });
    const hubMark = await hub().mark();
    await generate();
    const send = () => waitOursByText('modal', BUTTONS, 'Отправить →', 'the send button');
    expect(await (await send()).getAttribute('aria-disabled')).toBe('true');
    await archive(fan, group, messages);
    expect(await shift.rpc('bootstrap.get', { force: true })).toMatchObject({ ok: true });
    expect(await (await send()).getAttribute('aria-disabled')).toBe('true');
    await (await send()).click();
    expect(await claims(hubMark, fan)).toEqual([]);
    expect(await posts(mark)).toEqual([]);
    await generate();
    await browser.waitUntil(async () => (await (await send()).getAttribute('aria-disabled')) !== 'true', { timeout: 15_000 });
    await (await send()).click();
    await greeted(fan);
    expect(await calls(hubMark, 'aiFeatureStream')).toHaveLength(2);
    expect(await posts(mark)).toHaveLength(1);
  });

  it('[NF-015] [FS-NEW-7] more than ten personal messages among the last 30 refuses Hi before the hub, without sending', async () => {
    const fan = fanId();
    await seed([{ fanId: fan, messages: Array.from({ length: 11 }, (_, n) => ({ from: 'fan', text: `Personal message ${n}` })) }]);
    await select(fan, 'reply');
    const hubMark = await hub().mark();
    await pressOurs('modal', BUTTONS, 'Сгенерировать');
    await waitOursText('modal', /CG-GATE-HI/, 'Hi refuses a dialogue', { selector: CARD });
    expect(await calls(hubMark, 'aiFeatureStream')).toEqual([]);
    expect(await fieldText()).toBe('');
    expect(await posts(mark)).toEqual([]);
  });

  it('[NF-017] [FS-NEW-6] an empty, split or overlong AI output never replaces the person’s draft and never sends', async () => {
    const fan = fanId();
    const messages = await seed([{ fanId: fan, messages: [{ from: 'fan', text: 'hello' }] }]);
    const group = await select(fan, 'reply');
    await archive(fan, group, messages);
    const hubMark = await hub().mark();
    for (const text of ['   ', 'Hey [NEXT] there', 'x'.repeat(5001)]) {
      await ours('modal', FIELD).setValue('Keep my own draft');
      await hub().command({ op: 'config', patch: { aiTexts: { 'hi-greeting': text } } });
      await pressOurs('modal', BUTTONS, 'Сгенерировать');
      await waitOursText('modal', /Не отправлено/, 'unusable output refused', { selector: `${CARD} .cg-fnc__gst`, timeout: 30_000 });
      expect(await fieldText()).toBe('Keep my own draft');
      expect(await oursExists('modal', `${CARD} .cg-fnc__ai`)).toBe(false);
    }
    expect(await calls(hubMark, 'aiFeatureStream')).toHaveLength(3);
    expect(await claims(hubMark, fan)).toEqual([]);
    expect(await posts(mark)).toEqual([]);
  });

  it('[NF-016] [NF-026] [FS-NEW-1] persona changes while Hi streams: the old result cannot enter the new context or send', async () => {
    const fan = fanId();
    const messages = await seed([{ fanId: fan, messages: [{ from: 'fan', text: 'hello' }] }]);
    const group = await select(fan, 'reply');
    await archive(fan, group, messages);
    await hub().command({ op: 'config', patch: { aiChunkDelayMs: 6_000 } });
    await pressOurs('modal', BUTTONS, 'Сгенерировать');
    await waitOursText('modal', /Генерируем/, 'generation in flight', { selector: `${CARD} .cg-fnc__gst` });
    try {
      await shift.toPages();
      await browser.url(testBuildPage('options.html'));
      expect(await pageRpc('persona.set', { pageId: PAGE.pageId, key: 'playful', definitionId: 'pdef_playful000000001' })).toMatchObject({ ok: true });
      await shift.toFansly();
      await browser.waitUntil(async () => (await hub().status()).openStreams === 0, { timeout: 30_000 });
      await waitOursText('modal', /CG-CONTEXT-CHANGED/, 'the old persona’s result is refused', { selector: CARD });
      expect(await fieldText()).toBe('');
      expect(await oursExists('modal', `${CARD} .cg-fnc__ai`)).toBe(false);
      await closeWindow();
      await openWindow(shift);
      await select(fan, 'reply');
      expect(await fieldText()).toBe('');
      expect(await oursExists('modal', `${CARD} .cg-fnc__ai`)).toBe(false);
      expect(await posts(mark)).toEqual([]);
    } finally {
      await shift.toPages();
      await browser.url(testBuildPage('options.html'));
      await assignPersona(PAGE.pageLabel);
      await browser.url(testBuildPage(QUIET_PAGE));
      await shift.toFansly();
    }
  });

  it('[NF-022] [NF-023] [FS-NEW-3] an indeterminate send locks every greeting action; closing and reopening cannot repeat its POST', async () => {
    const fan = fanId();
    await seed([{ fanId: fan, messages: [] }]);
    await select(fan, 'ready');
    const text = 'Never send this greeting twice';
    await ours('modal', FIELD).setValue(text);
    await fakeFansly().command({ op: 'api', rules: [{ route: 'message.send', caller: 'ours', times: 1, outcome: { kind: 'refuse', code: 10 } }] });
    await pressOurs('modal', BUTTONS, 'Отправить →');
    await waitOursText('modal', /Неизвестно, ушло ли.*CG-SEND-UNCERTAIN/, 'the card keeps the uncertain outcome', { selector: `${CARD} .cg-fnc__gst`, timeout: 30_000 });
    for (const label of ['Сгенерировать', 'Отправить →', 'Открыть и вставить']) {
      const button = await waitOursByText('modal', BUTTONS, label, 'an action of the uncertain card');
      expect(await button.getAttribute('aria-disabled')).toBe('true');
      await button.click();
    }
    expect(await posts(mark)).toHaveLength(1);
    await closeWindow();
    await openWindow(shift);
    await select(fan, 'ready');
    await browser.waitUntil(async () => (await fieldText()) === text, { timeout: 10_000 });
    // A new human click in a new card still meets the background's unresolved attempt, before another dispatch.
    await pressOurs('modal', BUTTONS, 'Отправить →');
    await waitOursText('modal', /CG-SEND-UNCERTAIN/, 'the unresolved attempt refuses another card', { selector: `${CARD} .cg-fnc__gst` });
    expect(await posts(mark)).toHaveLength(1);
    expect((await claim(fan))?.attempts).toHaveLength(1);
  });

  it('[NF-019] [NF-021] [FS-NEW-3] two real clients click the same fan: one custody, one POST, one greeting for both', async function () {
    this.timeout(180_000);
    const fan = fanId();
    await seed([{ fanId: fan, messages: [] }]);
    await select(fan, 'ready');
    await ours('modal', FIELD).setValue('A greeting from the first client');
    const colleague = await startSecondBrowser();
    try {
      await inBrowser(colleague, async () => {
        const other = await startFanslyShift(hub(), { world: false, path: `/messages/${A.group}`, user: { username: WORLD.otherUser.username, password: 'synthetic-password-2' }, viewport: { width: 1440, height: 900 } });
        await dockIs((d) => d.status === 'ready' && d.login === WORLD.otherUser.username, 'the second chatter’s independent shift', 20_000);
        await openWindow(other);
        await select(fan, 'ready');
        await ours('modal', FIELD).setValue('A greeting from the second client');
      });
      // Hold the actual POST before its effect, so both histories are unchanged while the two installs claim.
      await fakeFansly().command({ op: 'api', rules: [{ route: 'message.send', caller: 'ours', times: 1, outcome: { kind: 'delay', ms: 4_000 } }] });
      const hubMark = await hub().mark();
      const sendMark = await fakeFansly().mark();
      const mine = await waitOursByText('modal', BUTTONS, 'Отправить →', 'my send');
      const theirs = await inBrowser(colleague, () => waitOursByText('modal', BUTTONS, 'Отправить →', 'the colleague’s send'));
      // Elements retain their sessions: no concurrent changes of @wdio/globals.
      await Promise.all([mine.click(), theirs.click()]);
      await browser.waitUntil(async () => (await claim(fan))?.greeting === 'confirmed', { timeout: 40_000 });
      const leaseCalls = (await claims(hubMark, fan)).filter((entry) => bodyOf(entry)['action'] === 'claim');
      expect(leaseCalls.filter((entry) => entry.status === 200)).toHaveLength(1);
      expect(leaseCalls.filter((entry) => entry.status === 409)).toHaveLength(1);
      const tokens = new Map((await hub().status()).tokens.map((token) => [token.id, token.userId]));
      expect(new Set(leaseCalls.map((entry) => tokens.get(entry.token?.id ?? -1))).size).toBe(2);
      expect((await claim(fan))?.attempts).toHaveLength(1);
      expect(await posts(sendMark)).toHaveLength(1);
      const settled = async (): Promise<string> => {
        await browser.waitUntil(async () => (await checkOf(fan)) === 'greeted' || /CG-CLAIM-BUSY/.test(await oursText('modal', CARD)), { timeout: 15_000 });
        return (await checkOf(fan)) === 'greeted' ? 'greeted' : 'busy';
      };
      const outcomes = [await settled(), await inBrowser(colleague, settled)];
      expect([...outcomes].sort()).toEqual(['busy', 'greeted']);
      // A second human click in the losing client cannot send a second greeting.
      const retry = async (): Promise<void> => { if (await oursExists('modal', FIELD)) await pressOurs('modal', BUTTONS, 'Отправить →'); };
      if (outcomes[0] === 'busy') await retry();
      else await inBrowser(colleague, retry);
      await browser.pause(1_000);
      expect(await posts(sendMark)).toHaveLength(1);
      expect(await calls(hubMark, 'aiFeatureStream')).toEqual([]);
    } finally {
      await colleague.deleteSession();
      await shift.toFansly();
    }
  });

  it('[NF-019] [NF-028] [FS-NEW-3] «Открыть и вставить» waits for the person’s Fansly Send, then registerNativeSend confirms the greeting; no extension POST', async () => {
    const fan = fanId();
    await seed([{ fanId: fan, messages: [] }]);
    const group = await select(fan, 'ready');
    const text = 'My own greeting via the Fansly button';
    await ours('modal', FIELD).setValue(text);
    const hubMark = await hub().mark();
    const sendMark = await fakeFansly().mark();
    await pressOurs('modal', BUTTONS, 'Открыть и вставить');
    await browser.waitUntil(async () => !(await oursExists('modal', WINDOW)) && (await callFansly('route')).groupId === group && (await callFansly('composers')).some((composer) => composer.place === 'main' && composer.model === text), { timeout: 25_000, timeoutMsg: 'the resolved chat did not receive the greeting draft' });
    expect(await posts(sendMark)).toEqual([]);
    expect(await posts(sendMark, 'page')).toEqual([]);
    expect(await claims(hubMark, fan)).toEqual([]);
    await browser.$(FANSLY_MAIN.send).click();
    await browser.waitUntil(async () => (await claim(fan))?.greeting === 'confirmed', { timeout: 25_000, timeoutMsg: 'the native greeting was not registered for everyone' });
    const registered = (await claims(hubMark, fan)).filter((entry) => bodyOf(entry)['action'] === 'registerNativeSend');
    expect(registered).toHaveLength(1);
    expect(registered[0]?.status).toBe(200);
    expect(bodyOf(registered[0] as FakeHubJournalEntry)).toMatchObject({ purpose: 'greeting', platformMessageId: expect.stringMatching(/^\d+$/), group: { kind: 'manual', textFingerprint: '‹64 chars›' } });
    expect(await posts(sendMark)).toEqual([]);
    expect(await posts(sendMark, 'page')).toHaveLength(1);
    await openWindow(shift);
    await select(fan, 'greeted');
    expect(await oursExists('modal', FIELD)).toBe(false);
    await sentText(group, text);
  });

  // #144 owns the bounded pass journal and wires it into journal.read. This scenario is ready to unskip on merge;
  // do not claim the existing pages-gallery mock as evidence of the real background's IndexedDB persistence.
  it.skip('[NF-029] [FS-NEW-5] waits for #144 (P10b3): the real pass journal survives a background restart and contains metadata only', async () => {
    const fan = fanId();
    await shift.toPages();
    await browser.url(testBuildPage('options.html'));
    expect(await pageRpc('settings.patchRestricted', { patch: { debug: { enabled: true } }, baseRevision: null })).toMatchObject({ ok: true });
    await browser.url(testBuildPage(QUIET_PAGE));
    await shift.toFansly();
    await seed([{ fanId: fan, messages: [{ from: 'fan', text: 'PRIVATE PASS JOURNAL TEXT' }] }]);
    await select(fan, 'reply');
    await closeWindow();
    await shift.toPages();
    type Journal = { records: readonly { scope: string; fields?: Readonly<Record<string, unknown>> }[]; runs: readonly { runId: string; events: number }[] | null; truncated: boolean };
    const read = () => pageRpc<Journal>('journal.read', { journal: 'newcomers-check', limit: 500 });
    let before: Journal | null = null;
    await browser.waitUntil(async () => {
      const answer = await read();
      if (answer.ok && answer.payload.runs?.some((run) => run.events > 0)) before = answer.payload;
      return before !== null;
    }, { timeout: 15_000 });
    expect(await suspendBackground()).toBe('stopped');
    const after = await read();
    expect(after.ok).toBe(true);
    if (!after.ok) throw new Error(after.error.code);
    expect(after.payload.runs?.map((run) => run.runId)).toEqual((before as unknown as Journal).runs?.map((run) => run.runId));
    expect(after.payload.records.length).toBeGreaterThan(0);
    expect(JSON.stringify(after.payload)).not.toContain('PRIVATE PASS JOURNAL TEXT');
    expect(JSON.stringify(after.payload)).not.toContain(`About stand_account_${fan.slice(-6)}`);
  });

  it('[NF-001] [FS-NEW-1] outside a conversation the popup still opens «Новые»; opening the browser alone starts no pass', async () => {
    await browser.url(fanslyStandUrl('/messages'));
    await waitForFanslyStandReady();
    await waitForFanslyStandIdle();
    const idle = await fakeFansly().mark();
    await browser.pause(1_000);
    expect(await fakeFansly().calls('ours', idle)).toEqual([]);
    const fan = fanId();
    await seed([{ fanId: fan, messages: [] }]);
    await select(fan, 'ready');
    expect((await callFansly('route')).groupId).toBeNull();
    expect(await posts(idle)).toEqual([]);
  });
});
