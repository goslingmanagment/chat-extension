// §12 п. 4 on the wired extension, part 3 — a fan's preview on the Spenders
// board and «Открыть и вставить» (architecture.md §6.5, §6.9, §8.5; А7): the
// TEST build on the stand against the fake hub, with the preview send off —
// the pilot's default — and the stand's own fans on the hub's board. What it
// proves end to end, by hand:
// - looking at a fan and generating for them asks the hub only: ChatSpace
//   loads no history of that chat, so OnlyFans keeps it unread;
// - «Открыть и вставить»: the board closes, ChatSpace opens that chat as for
//   a click of the person (its history loads now — their action), and the
//   chosen part is in that chat's field by one write;
// - the person presses ChatSpace's own Send: the send is proven by its
//   receipt and its echo, the hub registers it (H-7) with no preview send
//   involved, and no right to send anything appears;
// - the target chat holds the person's own draft (Б2): the chat opens,
//   nothing is written over their words, and a toast says why;
// - the chat's field does not come in time: «Чат открывается слишком долго»
//   (CG-NAV-TIMEOUT), and nothing is inserted when it comes later;
// - the person goes to another chat while we wait: «Вставка отменена»
//   (CG-INSERT-CANCELED), and nothing is inserted later either.
// The host adapter's own rules of the deferred insert have their spec
// without the extension (host-adapter.e2e.ts).

import { browser, expect } from '@wdio/globals';

import { callsTo } from '../../src/fake-hub/journal';
import { PAGE } from '../../src/scenarios/hub';
import { bridgeWrites, composerText, historyLoads, pageJournal, pageJournalMark, PANEL, pressSend, queueAdds, sendsOf, serverSince, typeDraft, waitForComposerText } from '../support/chat';
import { useFakeHub } from '../support/fake-hub';
import { useNetworkTrap } from '../support/network-trap';
import { oursByText, oursExists, oursText, pressOurs, waitOursText } from '../support/ours';
import { dockIs, startShift, type Shift } from '../support/shift';
import { callStand, foreignCalls, STAND_IDS, standServer, waitForChatReady } from '../support/stand';

const ACC = STAND_IDS.accounts.a;
const { a1, a4, a6, a7 } = STAND_IDS.fans;
/** Fan Iris of the stand's account a (the dataset names its fans beyond a8 by the same pattern). */
const a9 = '74001009';
const reply = (fan: string): readonly [string, string] => [`Hey you, thanks for writing! @${fan}`, `How was your day? @${fan}`];
/** `limits.navInsertTimeoutSec` of this run: how long «Открыть и вставить» waits for the chat's field. */
const NAV_TIMEOUT_SEC = 3;

describe('§12 п. 4 on the wired extension — a preview on the Spenders board and «Открыть и вставить»', () => {
  useNetworkTrap();
  const { hub } = useFakeHub();
  let shift: Shift;
  let journalStart = 0;

  /** The board by its key, the fan's row by a click: the preview of that fan from the hub's archive. */
  const openPreview = async (name: string): Promise<void> => {
    if (!(await oursExists('modal', '[aria-label="Spenders"]'))) await browser.keys([...PANEL, 'm']);
    await waitOursText('modal', name, `the board lists ${name}`, { timeout: 20_000, selector: '[aria-label="Доска Spenders"]' });
    await pressOurs('modal', '[data-cg-key^="fan:"]', new RegExp(`^${name}`));
    await waitOursText('modal', name, `the preview of ${name}`, { selector: '.cg-pv' });
    await waitOursText('modal', 'Чат не открыт, останется непрочитанным', 'the preview says the chat stays unread', { selector: '.cg-pv' });
  };
  /** Reply in the preview's own strip; resolves with its parts on screen. */
  const generate = async (fan: string): Promise<void> => {
    await pressOurs('modal', '.cg-pv button', /^Reply/);
    await waitOursText('modal', reply(fan)[1], 'the preview’s result', { timeout: 20_000, selector: '.cg-pv' });
  };
  const boardClosed = (): Promise<void> => browser.waitUntil(async () => !(await oursExists('modal', '[aria-label="Spenders"]')), { timeout: 5000, timeoutMsg: 'the board did not close' }).then(() => undefined);
  const toast = (code: string, message: string): Promise<string> => waitOursText('toast', code, message, { timeout: (NAV_TIMEOUT_SEC + 6) * 1000 });

  before(async () => {
    await standServer.reset();
    // The stand's socket names its accounts soon after their subscription: ChatSpace's sends are observed from then on.
    await standServer.traffic({ firstSummaryMs: 150 });
    journalStart = await standServer.mark();
    await hub().command({ op: 'config', patch: { aiNameFan: true, limits: { navInsertTimeoutSec: NAV_TIMEOUT_SEC } } });
    shift = await startShift(hub(), { settings: { generation: { split: true } }, viewport: { width: 1440, height: 900 } });
    await dockIs((d) => d.status === 'ready' && d.actions['reply'] === true, 'the dock of the open chat is ready');
  });

  after(async () => {
    await callStand('setEditorDelayMs', 0);
    const diagnostics = await shift.rpc<{ counters: Record<string, number> }>('diagnostics.get');
    expect(diagnostics.ok ? Object.entries(diagnostics.payload.counters).filter(([name, count]) => name.startsWith('p1.') && count > 0) : null).toEqual([]);
    // §12 «Гейт безопасности»: nothing but the page's own client and the harness talked to the stand.
    expect(foreignCalls((await standServer.journal(journalStart)).entries)).toEqual([]);
  });

  it('[RB-022] [SP-050] [SP-053] looking at a fan and generating for them asks the hub only: ChatSpace loads no history of that chat, the chat stays unread', async () => {
    const standMark = await standServer.mark();
    const hubMark = await hub().mark();
    await openPreview('Fan Dune');
    await generate(a4);
    const preview = await oursText('modal', '.cg-pv');
    expect(preview).toContain('черновик · не отправлено');
    // The preview send is off for this page (the pilot's default): the row says why, and «Открыть и вставить» is the way.
    expect(preview).toContain('CG-SEND-OFF');
    expect(await oursByText('modal', '.cg-pv button', /^Открыть и вставить/)).not.toBeNull();
    // What was read is the hub's: the archive feed and one generation for exactly this fan.
    const calls = (await hub().journal(hubMark)).entries;
    expect(callsTo(calls, 'clientConversationFeed').map((call) => (call.request as { fanRef?: string }).fanRef)).toContain(a4);
    expect(callsTo(calls, 'aiFeatureStream').map((call) => (call.request as { body?: { fanRef?: string } }).body?.fanRef)).toEqual([a4]);
    // Nothing of that chat was asked of ChatSpace: no history (a read on OnlyFans), no send, and the open chat is still the first one.
    const stand = await serverSince(standMark);
    expect(historyLoads(stand)).toEqual([]);
    expect(sendsOf(stand)).toEqual([]);
    expect((await callStand('route')).chatId).toBe(a1);
    expect(await composerText(ACC, a4)).toBeNull();
  });

  it('[SP-035] [NEW-01] [NF-011] «Открыть и вставить»: the board closes, ChatSpace opens the chat as for a click, and the part is in that chat’s field — one write', async () => {
    const standMark = await standServer.mark();
    const mark = await pageJournalMark();
    await pressOurs('modal', '.cg-pv button', /^Открыть и вставить/);
    await boardClosed();
    await waitForChatReady(ACC, a4);
    await waitForComposerText(ACC, a4, reply(a4)[0], 'the first part is in the field of the fan’s chat');
    expect((await callStand('route')).chatId).toBe(a4);
    expect(bridgeWrites(await pageJournal(mark))).toEqual([{ method: 'setText', chatId: a4 }]);
    // The chat was opened by the person's click: its history is ChatSpace's own load, and the only one.
    const loads = historyLoads(await serverSince(standMark));
    expect(loads.map((entry) => [entry.chatId, entry.origin])).toEqual([[a4, 'native']]);
    // Nothing was sent: the text waits for the person in ChatSpace's own field.
    expect(sendsOf(await serverSince(standMark))).toEqual([]);
    expect(queueAdds(await pageJournal(mark))).toEqual([]);
    // The chat that was open gave its tab to the fan's chat; the only field the page has now is the fan's.
    expect((await callStand('composers')).map((composer) => composer.chatId)).toEqual([a4]);
  });

  it('[TL-004] [NF-021] the preview send is off: the person presses ChatSpace’s own Send — the hub registers the proven send (H-7), and no right to send anything appears', async () => {
    const standMark = await standServer.mark();
    const hubMark = await hub().mark();
    const mark = await pageJournalMark();
    await pressSend();
    // The send is ChatSpace's own: one entry of its queue, one POST by its client.
    await browser.waitUntil(async () => sendsOf(await serverSince(standMark), a4).length === 1, { timeout: 10_000, timeoutMsg: 'ChatSpace did not send the message' });
    await waitForComposerText(ACC, a4, '', 'ChatSpace cleared its field after the send');
    expect(queueAdds(await pageJournal(mark))).toHaveLength(1);
    const sent = sendsOf(await serverSince(standMark), a4)[0];
    expect([sent?.origin, sent?.detail?.['plain']]).toEqual(['native', reply(a4)[0]]);
    // Proven by the receipt and the echo with one id, the send is registered with the hub as a preview reply — by `registerNativeSend`, not by a dispatch.
    let claims = callsTo((await hub().journal(hubMark)).entries, 'clientFanClaim');
    await browser.waitUntil(
      async () => {
        claims = callsTo((await hub().journal(hubMark)).entries, 'clientFanClaim');
        return claims.length > 0;
      },
      { timeout: 10_000, timeoutMsg: 'the hub was not told of the proven send' },
    );
    expect(claims.map((call) => [call.status, (call.request as { fanRef?: string; body?: { action?: string; purpose?: string; partIndex?: number } }).fanRef, (call.request as { body?: { action?: string } }).body?.action])).toEqual([[200, a4, 'registerNativeSend']]);
    expect((claims[0]?.request as { body?: { purpose?: string; partIndex?: number; group?: { partCount?: number } } }).body).toMatchObject({ purpose: 'preview-reply', partIndex: 0, group: { partCount: 2 } });
    const custody = (await hub().status()).claims.find((claim) => claim.pageLabel === PAGE && claim.fanRef === a4);
    expect(custody?.attempts.map((attempt) => [attempt.state, attempt.partIndex])).toEqual([['sent', 0]]);
    // No second POST, nothing of ours in ChatSpace's queue, and the preview's «Отправить» is as off as it was.
    await browser.pause(500);
    expect(sendsOf(await serverSince(standMark))).toHaveLength(1);
    expect(queueAdds(await pageJournal(mark))).toHaveLength(1);
    await openPreview('Fan Dune');
    const preview = await oursText('modal', '.cg-pv');
    expect(preview).toContain('CG-SEND-OFF');
    expect(await oursExists('modal', '.cg-pv .cg-btn--primary:not([aria-disabled="true"])')).toBe(false);
  });

  it('[NEW-01] [NEW-05] the target chat holds the person’s own draft (Б2): the chat opens, nothing is written over their words, and the person is told why', async () => {
    // The person left a draft in that fan's chat earlier.
    await browser.keys('Escape');
    await browser.keys('Escape');
    await boardClosed();
    await callStand('openChat', ACC, a6, { newTab: true });
    await waitForChatReady(ACC, a6);
    await typeDraft('mine in the chat');
    await callStand('openChat', ACC, a1);
    await dockIs((d) => d.target?.endsWith(`:${a1}`) === true && d.status === 'ready', 'back in the first chat');

    await openPreview('Fan Fern');
    await generate(a6);
    const mark = await pageJournalMark();
    await pressOurs('modal', '.cg-pv button', /^Открыть и вставить/);
    await boardClosed();
    await browser.waitUntil(async () => (await callStand('route')).chatId === a6, { timeout: 5000, timeoutMsg: 'the fan’s chat did not open' });
    await dockIs((d) => d.target?.endsWith(`:${a6}`) === true && d.status === 'ready', 'the dock of the fan’s chat');
    // The board that could say why has closed: the person is told by a toast, with the words of the Б2 question.
    const said = await toast('CG-DRAFT-CHANGED', 'the toast about the person’s own text');
    expect(said).toContain('В поле ввода уже есть ваш текст.');
    // Longer than the insert takes when the field is empty (the test above): nothing came, and nothing will.
    await browser.pause(1500);
    expect(await composerText(ACC, a6)).toBe('mine in the chat');
    expect(bridgeWrites(await pageJournal(mark))).toEqual([]);
    await browser.pause(NAV_TIMEOUT_SEC * 1000);
    expect(await composerText(ACC, a6)).toBe('mine in the chat');
    expect(bridgeWrites(await pageJournal(mark))).toEqual([]);
  });

  it('[NEW-01] the chat’s field does not come in time: «Чат открывается слишком долго» (CG-NAV-TIMEOUT), and nothing is inserted when it comes later', async () => {
    await callStand('openChat', ACC, a1);
    await dockIs((d) => d.target?.endsWith(`:${a1}`) === true && d.status === 'ready', 'back in the first chat');
    await openPreview('Fan Grove');
    await generate(a7);
    // ChatSpace is slow today: the editor of a chat opened from now on arrives long after our deadline.
    const lateMs = (NAV_TIMEOUT_SEC + 4) * 1000;
    await callStand('setEditorDelayMs', lateMs);
    const mark = await pageJournalMark();
    const clicked = Date.now();
    await pressOurs('modal', '.cg-pv button', /^Открыть и вставить/);
    await boardClosed();
    const said = await toast('CG-NAV-TIMEOUT', 'the toast of the missed deadline');
    expect(said).toContain('Чат открывается слишком долго');
    expect(said).toContain('Текст не вставлен');
    expect(Date.now() - clicked).toBeGreaterThanOrEqual(NAV_TIMEOUT_SEC * 1000);
    expect(bridgeWrites(await pageJournal(mark))).toEqual([]);
    // The editor arrives after all: the click is over, nothing is written behind the person's back.
    await callStand('setEditorDelayMs', 0);
    await waitForChatReady(ACC, a7, lateMs + 5000);
    await browser.pause(700);
    expect(await composerText(ACC, a7)).toBe('');
    expect(bridgeWrites(await pageJournal(mark))).toEqual([]);
  });

  it('[NEW-01] the person goes to another chat while we wait: «Вставка отменена» (CG-INSERT-CANCELED), and nothing is inserted later', async () => {
    await callStand('openChat', ACC, a1);
    await dockIs((d) => d.target?.endsWith(`:${a1}`) === true && d.status === 'ready', 'back in the first chat');
    await openPreview('Fan Iris');
    await generate(a9);
    // The chat's editor takes a second and a half: we are still waiting for it when the person leaves.
    await callStand('setEditorDelayMs', 1500);
    const mark = await pageJournalMark();
    await pressOurs('modal', '.cg-pv button', /^Открыть и вставить/);
    await boardClosed();
    await browser.waitUntil(async () => (await callStand('route')).chatId === a9, { timeout: 5000, timeoutMsg: 'the fan’s chat did not open' });
    await callStand('openChat', ACC, a1);
    const said = await toast('CG-INSERT-CANCELED', 'the toast of the canceled insert');
    expect(said).toContain('Вставка отменена');
    // The editor of the fan's chat is ready by now; neither field got the part.
    await callStand('setEditorDelayMs', 0);
    await browser.pause(2000);
    expect((await composerText(ACC, a9)) ?? '').toBe('');
    expect(await composerText(ACC, a1)).toBe('');
    expect(bridgeWrites(await pageJournal(mark))).toEqual([]);
    // The generation is kept: the preview of that fan still has its result.
    await openPreview('Fan Iris');
    await waitOursText('modal', reply(a9)[0], 'the result is still in the preview', { selector: '.cg-pv' });
  });
});
