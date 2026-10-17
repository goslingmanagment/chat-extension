// §12 п. 4 on the wired extension, part 5 — «Новые»: бронь двумя экземплярами
// — побеждает один (architecture.md §8.5, §6.7.7; hub H-7). Two real Firefox
// instances, each with its own install of the TEST build, its own background
// and its own sign-in to the same fake hub: the suite's browser is one
// chatter, a second browser started by this spec is a colleague on the same
// page. Everything is done by hand in both — the palette, the row, Hi, the
// send button.
// - the window and a card ask the hub only: no lease, no chat of ChatSpace;
// - Hi takes the lease: «бронь: вы» here, «бронь: другой чаттер» for the
//   colleague, whose Hi is off — nothing of theirs is generated or claimed;
// - both press Hi for the same free fan at the same moment: the hub gives
//   the lease to one, the other is told the fan is taken, one greeting is
//   generated;
// - «Снять бронь» hands the fan over: the colleague can greet now;
// - a greeting sent from the card (X8, one click) is confirmed for everyone:
//   «поздоровались» in both browsers, no second greeting from either.

import { browser, expect } from '@wdio/globals';

import { callsTo } from '../../src/fake-hub/journal';
import { PAGE, WORLD } from '../../src/scenarios/hub';
import { historyLoads, MOD, sendsOf, serverSince } from '../support/chat';
import { useFakeHub } from '../support/fake-hub';
import { useNetworkTrap } from '../support/network-trap';
import { ours, oursExists, oursText, pressOurs, waitOursByText, waitOursText } from '../support/ours';
import { inBrowser, startSecondBrowser } from '../support/second';
import { dockIs, startShift } from '../support/shift';
import { foreignCalls, STAND_IDS, standServer } from '../support/stand';

const ACC = STAND_IDS.accounts.a;
const { a2, a5 } = STAND_IDS.fans;
/** The hub's own new subscribers of the page (synthetic fans the stand does not have). */
const [fanA, fanB, fanC] = ['2010', '2011', '2012'] as const;
const LIST = '[aria-label="Новые подписчики"]';
const CARD = '.cg-pv';

describe('§12 п. 4 on the wired extension — «Новые»: the greeting lease of two installs, and a greeting confirmed for everyone', () => {
  useNetworkTrap();
  const { hub } = useFakeHub();
  let journalStart = 0;
  let hubStart = 0;
  let colleague: WebdriverIO.Browser | null = null;

  /** Runs in the colleague's browser. */
  const there = <T>(run: () => Promise<T>): Promise<T> => {
    if (colleague === null) throw new Error('the second browser is not started');
    return inBrowser(colleague, run);
  };
  /** «Новые» from the palette (⌘K → the row), as a person opens it. */
  const openNewcomers = async (): Promise<void> => {
    // Open already: closed first (Esc closes the card, then the window), so the list is read from the hub anew.
    for (let press = 0; press < 3 && (await oursExists('modal', '[aria-label="Новые"]')); press += 1) {
      await browser.keys('Escape');
      await browser.pause(150);
    }
    expect(await oursExists('modal', '[aria-label="Новые"]')).toBe(false);
    await browser.keys([MOD, 'k']);
    await pressOurs('modal', '.cg-pal__item', /^Новые(?:\s*(?:⌘⇧U|Ctrl\+Alt\+U))?$/, 'the «Новые» row of the palette (its key since X49)', 20_000);
    await waitOursText('modal', 'newfan_', 'the list of new subscribers', { timeout: 20_000, selector: LIST });
    // The palette is a launcher: it went away with the row it ran.
    expect(await oursExists('modal', '[aria-label="Палитра команд"]')).toBe(false);
  };
  const row = (username: string) => waitOursByText('modal', `${LIST} [data-cg-key]`, new RegExp(`@${username}\\b`), `the row of ${username}`);
  const rowText = async (username: string): Promise<string> => (await (await row(username)).getText()).replace(/\s+/g, ' ');
  const openCard = async (username: string): Promise<void> => {
    await (await row(username)).click();
    await waitOursText('modal', `@${username}`, `the card of ${username}`, { selector: CARD });
  };
  /** Custody and lease calls for a fan since `mark`, with who asked: `user:action:status`. */
  const claims = async (mark: number, fan: string): Promise<string[]> => {
    const tokens = new Map((await hub().status()).tokens.map((token) => [token.id, token.userId]));
    return callsTo((await hub().journal(mark)).entries, 'clientFanClaim')
      .filter((call) => (call.request as { fanRef?: string }).fanRef === fan)
      .map((call) => `${String(tokens.get(call.token?.id ?? -1))}:${(call.request as { body: { action: string } }).body.action}:${call.status}`);
  };
  const greetingsFor = async (mark: number, fan: string): Promise<number> =>
    callsTo((await hub().journal(mark)).entries, 'aiFeatureStream').filter((call) => (call.request as { feature?: string; body?: { fanRef?: string } }).feature === 'hi-greeting' && (call.request as { body?: { fanRef?: string } }).body?.fanRef === fan).length;
  const leaseOf = async (fan: string): Promise<string | undefined> => (await hub().status()).claims.find((claim) => claim.pageLabel === PAGE && claim.fanRef === fan)?.lease;

  before(async function () {
    this.timeout(180_000);
    await standServer.reset();
    await standServer.traffic({ firstSummaryMs: 150 });
    journalStart = await standServer.mark();
    await hub().command({ op: 'config', patch: { aiNameFan: true } });
    // A fan of the stand subscribed just now: a greeting for them can really be sent.
    await hub().command({ op: 'audienceEvent', pageLabel: PAGE, fanRef: a5 });
    hubStart = await hub().mark();
    await startShift(hub(), { previewSend: true, viewport: { width: 1440, height: 900 } });
    await dockIs((d) => d.status === 'ready', 'the dock of the first browser');
    colleague = await startSecondBrowser();
    await there(async () => {
      await startShift(hub(), { world: false, user: { username: WORLD.otherUser.username, password: 'synthetic-password-2' }, viewport: { width: 1440, height: 900 }, chat: [ACC, a2] });
      await dockIs((d) => d.status === 'ready' && d.login === WORLD.otherUser.username, 'the dock of the colleague’s browser');
    });
  });

  after(async () => {
    await colleague?.deleteSession();
    const entries = await serverSince(journalStart);
    expect(foreignCalls(entries)).toEqual([]);
    expect(sendsOf(entries).filter((entry) => entry.origin !== 'native')).toEqual([]);
  });

  it('[NF-001] [NF-005] the window lists the page’s new subscribers from the hub; opening it and a card takes no lease and loads no chat', async () => {
    const standMark = await standServer.mark();
    await openNewcomers();
    const list = await oursText('modal', LIST);
    for (const username of ['newfan_0', 'newfan_1', 'newfan_2', `newfan_${a5}`]) expect(list).toContain(`@${username}`);
    expect(await rowText('newfan_0')).toContain('не поздоровались');
    await openCard('newfan_0');
    const card = await oursText('modal', CARD);
    expect(card).toContain('Чат не открыт, останется непрочитанным');
    expect(card).toContain('AI ничего не отправляет сам');
    // Reading is the hub's audience and archive; no lease is taken by looking, and ChatSpace is asked nothing.
    const calls = (await hub().journal(hubStart)).entries;
    expect(callsTo(calls, 'clientAudienceNew').length).toBeGreaterThan(0);
    expect(await claims(hubStart, fanA)).toEqual([]);
    expect(await leaseOf(fanA)).toBe('none');
    expect(historyLoads(await serverSince(standMark))).toEqual([]);
  });

  it('[NF-021] [NF-014] Hi takes the lease and writes a greeting draft: «бронь: вы», with the time left and «Снять бронь»', async () => {
    const mark = await hub().mark();
    await pressOurs('modal', `${CARD} button`, /^Hi/);
    await waitOursText('modal', 'Бронь за вами', 'the card says the fan is ours', { selector: CARD, timeout: 20_000 });
    await waitOursText('modal', 'Hi and welcome!', 'the greeting draft', { selector: CARD, timeout: 20_000 });
    expect(await rowText('newfan_0')).toContain('бронь: вы');
    for (const button of [/^Продлить бронь/, /^Снять бронь/]) expect(await waitOursByText('modal', `${CARD} button`, button, 'the lease’s own buttons')).not.toBeNull();
    expect(await claims(mark, fanA)).toEqual([`${WORLD.user.userId}:claim:200`]);
    expect(await leaseOf(fanA)).toBe('active');
    expect(await greetingsFor(mark, fanA)).toBe(1);
    // A draft, not a send.
    expect(await oursText('modal', CARD)).toContain('черновик · не отправлено');
    expect(sendsOf(await serverSince(journalStart))).toEqual([]);
  });

  it('[NF-021] the colleague’s browser: the fan is «бронь: другой чаттер», their Hi is off, and nothing of theirs is claimed or generated', async () => {
    const mark = await hub().mark();
    await there(async () => {
      await openNewcomers();
      expect(await rowText('newfan_0')).toContain('бронь: другой чаттер');
      // A free fan next to it is free for them too.
      expect(await rowText('newfan_1')).toContain('не поздоровались');
      await openCard('newfan_0');
      const hi = await waitOursByText('modal', `${CARD} button`, /^Hi/, 'the Hi button of the card');
      expect(await hi.getAttribute('aria-disabled')).toBe('true');
      const card = await oursText('modal', CARD);
      expect(card).toContain('CG-CLAIM-BUSY');
      // Pressing it anyway starts nothing.
      await hi.click().catch(() => undefined);
      await browser.pause(700);
    });
    expect(await claims(mark, fanA)).toEqual([]);
    expect(await greetingsFor(mark, fanA)).toBe(0);
    expect(await leaseOf(fanA)).toBe('active');
  });

  it('[NF-021] [X8-08] both press Hi for the same free fan at the same moment: the hub gives the lease to one — one greeting, and the other is told the fan is taken', async function () {
    this.timeout(180_000);
    const mark = await hub().mark();
    await openCard('newfan_1');
    const mine = await waitOursByText('modal', `${CARD} button`, /^Hi/, 'my Hi button');
    const theirs = await there(async () => {
      await openCard('newfan_1');
      return waitOursByText('modal', `${CARD} button`, /^Hi/, 'the colleague’s Hi button');
    });
    // Two browsers, two WebDriver sessions: the clicks travel at the same time.
    await Promise.all([mine.click(), theirs.click()]);

    await browser.waitUntil(async () => (await claims(mark, fanB)).filter((claim) => claim.endsWith(':claim:200')).length >= 1 && (await claims(mark, fanB)).length >= 2, { timeout: 20_000, timeoutMsg: 'both installs asked the hub for the lease' });
    const asked = await claims(mark, fanB);
    const won = asked.filter((claim) => claim.endsWith(':claim:200'));
    expect(won).toHaveLength(1);
    expect(asked.filter((claim) => /:claim:409$/.test(claim))).toHaveLength(1);
    expect(new Set(asked.map((claim) => claim.split(':')[0])).size).toBe(2);
    const winner = Number(won[0]?.split(':')[0]);
    const iWon = winner === WORLD.user.userId;

    const seen = async (): Promise<{ readonly mine: boolean; readonly busy: boolean; readonly row: string }> => {
      const card = await oursText('modal', CARD);
      return { mine: card.includes('Бронь за вами'), busy: card.includes('CG-CLAIM-BUSY'), row: await rowText('newfan_1') };
    };
    const settle = (who: 'winner' | 'loser') => async (): Promise<Awaited<ReturnType<typeof seen>>> => {
      let last = await seen();
      await browser.waitUntil(
        async () => {
          last = await seen();
          return who === 'winner' ? last.mine : last.busy;
        },
        { timeout: 20_000, timeoutMsg: `the ${who}’s card did not say so` },
      );
      return last;
    };
    const here = await (iWon ? settle('winner') : settle('loser'))();
    const over = await there(iWon ? settle('loser') : settle('winner'));
    const [winnerSaw, loserSaw] = iWon ? [here, over] : [over, here];
    expect(winnerSaw).toMatchObject({ mine: true, busy: false });
    expect(winnerSaw.row).toContain('бронь: вы');
    expect(loserSaw).toMatchObject({ mine: false, busy: true });
    expect(loserSaw.row).toContain('бронь: другой чаттер');
    // One greeting was generated — the winner's; the loser's click cost nothing at the model.
    await browser.waitUntil(async () => (await hub().status()).openStreams === 0, { timeout: 20_000, timeoutMsg: 'a generation is still running' });
    expect(await greetingsFor(mark, fanB)).toBe(1);
    expect(await leaseOf(fanB)).toBe('active');
  });

  it('[NF-021] «Снять бронь» hands the fan over: the colleague greets now, and the fan is «бронь: другой чаттер» here', async function () {
    this.timeout(180_000);
    const mark = await hub().mark();
    await openCard('newfan_0');
    await pressOurs('modal', `${CARD} button`, /^Снять бронь/);
    await browser.waitUntil(async () => (await leaseOf(fanA)) !== 'active', { timeout: 10_000, timeoutMsg: 'the lease was not released at the hub' });
    expect(await claims(mark, fanA)).toEqual([`${WORLD.user.userId}:release:200`]);
    await there(async () => {
      await openNewcomers();
      expect(await rowText('newfan_0')).toContain('не поздоровались');
      await openCard('newfan_0');
      await pressOurs('modal', `${CARD} button`, /^Hi/);
      await waitOursText('modal', 'Бронь за вами', 'the colleague holds the fan now', { selector: CARD, timeout: 20_000 });
    });
    expect((await claims(mark, fanA)).at(-1)).toBe(`${WORLD.otherUser.userId}:claim:200`);
    await openNewcomers();
    expect(await rowText('newfan_0')).toContain('бронь: другой чаттер');
    void fanC;
  });

  it('[NF-019] [NF-021] [X8-08] a greeting sent from the card by one click is confirmed for everyone: «поздоровались» in both browsers, and no second greeting from either', async function () {
    this.timeout(180_000);
    const mark = await hub().mark();
    const standMark = await standServer.mark();
    const username = `newfan_${a5}`;
    await openCard(username);
    await pressOurs('modal', `${CARD} button`, /^Hi/);
    await waitOursText('modal', 'Бронь за вами', 'the fan is ours', { selector: CARD, timeout: 20_000 });
    await waitOursText('modal', `Hi and welcome! @${a5}`, 'the greeting draft', { selector: CARD, timeout: 20_000 });
    await pressOurs('modal', `${CARD} .cg-pvs__send`, /^Отправить/);
    await browser.waitUntil(async () => (await ours('modal', `${CARD} [data-cg-part="0"]`).getAttribute('data-cg-send-state')) === 'sent', { timeout: 20_000, timeoutMsg: 'the greeting was not confirmed as sent' });
    // One POST by ChatSpace's own client, to exactly this fan; the hub's custody went dispatch → sent, and the greeting is confirmed.
    const sends = sendsOf(await serverSince(standMark));
    expect(sends.map((entry) => [entry.origin, entry.chatId, entry.detail?.['plain']])).toEqual([['native', a5, `Hi and welcome! @${a5}`]]);
    // The card says «sent» the moment MAIN saw the receipt and the echo; the hub hears it from the background a moment later.
    let custody: string[] = [];
    await browser
      .waitUntil(async () => (custody = (await claims(mark, a5)).map((claim) => claim.split(':').slice(1).join(':'))).length >= 3, { timeout: 10_000, interval: 50 })
      .catch(() => undefined);
    expect(custody).toEqual(['claim:200', 'dispatch:200', 'sent:200']);
    const state = (await hub().status()).claims.find((claim) => claim.pageLabel === PAGE && claim.fanRef === a5);
    expect(state?.greeting).toBe('confirmed');
    // The fan leaves «Поздороваться» and stands greeted under «Все».
    await waitOursText('modal', `@${username}`, 'the greeted fan left the list of those to greet', { selector: LIST, gone: true, timeout: 20_000 });
    await pressOurs('modal', '.cg-tabs [role="tab"]', /^Все/);
    const greeted = await rowText(username);
    expect(greeted).toContain('поздоровались');
    expect(greeted).not.toContain('не поздоровались');
    // A second greeting is not offered here…
    await openCard(username);
    expect(await (await waitOursByText('modal', `${CARD} button`, /^Hi/, 'the Hi button')).getAttribute('aria-disabled')).toBe('true');
    // …nor in the colleague's browser: the fan is greeted for everyone.
    await there(async () => {
      await openNewcomers();
      await pressOurs('modal', '.cg-tabs [role="tab"]', /^Все/);
      const theirs = await rowText(username);
      expect(theirs).toContain('поздоровались');
      expect(theirs).not.toContain('не поздоровались');
      await openCard(username);
      expect(await (await waitOursByText('modal', `${CARD} button`, /^Hi/, 'the colleague’s Hi button')).getAttribute('aria-disabled')).toBe('true');
    });
    expect(sendsOf(await serverSince(standMark))).toHaveLength(1);
    expect(await greetingsFor(mark, a5)).toBe(1);
  });
});
