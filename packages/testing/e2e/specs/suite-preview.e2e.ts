// §12 п. 4 on the wired extension, part 3 — a fan's preview on the Spenders
// board and «Открыть и вставить» (architecture.md §6.5, §6.9, §8.5; А7): the
// TEST build on the stand against the fake hub, with the preview send off —
// the pilot's default — and the stand's own fans on the hub's board. What it
// proves end to end, by hand:
// - looking at a fan and generating for them asks the hub only: ChatSpace
//   loads no history of that chat, so OnlyFans keeps it unread;
// - «Открыть и вставить»: the board closes, ChatSpace opens that chat as for
//   a click of the person (its history loads now — their action), and the
//   chosen part is in that chat's field by one write; the dock of that chat
//   goes on with the rest of the result (§6.5);
// - the person presses ChatSpace's own Send: the send is proven by its
//   receipt and its echo, the hub registers it (H-7) with no preview send
//   involved, and no right to send anything appears; the dock and the
//   preview both show the part «Отправлено», and the next part goes the
//   same way — inserted by its own click, sent by ChatSpace's own Send;
// - the target chat holds the person's own draft (Б2): the chat opens,
//   nothing is written over their words, and the question «Заменить /
//   Добавить в конец» stands in that chat's dock — only its answer writes;
// - the chat's field does not come in time: «Чат открывается слишком долго»
//   (CG-NAV-TIMEOUT), and nothing is inserted when it comes later;
// - the person goes to another chat while we wait: «Вставка отменена»
//   (CG-INSERT-CANCELED), and nothing is inserted later either.
// The host adapter's own rules of the deferred insert have their spec
// without the extension (host-adapter.e2e.ts).

import { browser, expect } from '@wdio/globals';

import { callsTo } from '../../src/fake-hub/journal';
import { PAGE } from '../../src/scenarios/hub';
import { bridgeWrites, clearDraft, composerText, historyLoads, pageJournal, pageJournalMark, PANEL, pressSend, queueAdds, sendsOf, serverSince, typeDraft, waitForComposerText } from '../support/chat';
import { useFakeHub } from '../support/fake-hub';
import { useNetworkTrap } from '../support/network-trap';
import { oursByText, oursExists, oursText, pressOurs, waitOursByText, waitOursText } from '../support/ours';
import { dockIs, startShift, type Shift } from '../support/shift';
import { callStand, foreignCalls, STAND_IDS, standServer, waitForChatReady } from '../support/stand';

const ACC = STAND_IDS.accounts.a;
const { a1, a4, a6, a7 } = STAND_IDS.fans;
/** Fans Iris and Juniper of the stand's account a (the dataset names its fans beyond a8 by the same pattern). */
const a9 = '74001009';
const a10 = '74001010';
const reply = (fan: string): readonly [string, string] => [`Hey you, thanks for writing! @${fan}`, `How was your day? @${fan}`];
/** `limits.navInsertTimeoutSec` of this run: how long «Открыть и вставить» waits for the chat's field. */
const NAV_TIMEOUT_SEC = 3;
const HUMAN_DRAFT = 'В поле ввода уже есть ваш текст.';

describe('§12 п. 4 on the wired extension — a preview on the Spenders board and «Открыть и вставить»', () => {
  useNetworkTrap();
  const { hub } = useFakeHub();
  let shift: Shift;
  let journalStart = 0;

  /** The board by its key, the fan's row by a click: the preview of that fan from the hub's archive. */
  const openPreview = async (name: string, unread: 'kept' | 'read-after-send' = 'kept'): Promise<void> => {
    if (!(await oursExists('modal', '[aria-label="Spenders"]'))) await browser.keys([...PANEL, 'm']);
    await waitOursText('modal', name, `the board lists ${name}`, { timeout: 20_000, selector: '[aria-label="Доска Spenders"]' });
    await pressOurs('modal', '[data-cg-key^="fan:"]', new RegExp(`^${name}`));
    await waitOursText('modal', name, `the preview of ${name}`, { selector: '.cg-pv' });
    // A fan nothing was sent to stays unread; once a message went out, ChatSpace itself shows the chat read.
    const says = unread === 'kept' ? 'Чат не открыт, останется непрочитанным' : 'После отправки ChatSpace показывает его прочитанным';
    await waitOursText('modal', says, `the preview says what happens to the unread mark (${unread})`, { selector: '.cg-pv' });
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
    // §6.5: the dock of the opened chat goes on with the same operation — part 1 «вставлено», part 2 one click away.
    const dock = await dockIs((d) => d.target?.endsWith(`:${a4}`) === true && d.result?.parts === 2 && d.result.inserted === 1, 'the dock of the fan’s chat shows the rest of the preview’s result');
    expect(dock.result).toMatchObject({ feature: 'reply', state: 'done', parts: 2, inserted: 1, error: null });
    const shown = await oursText('dock', '.cg-sheet');
    expect(shown).toContain(reply(a4)[0]);
    expect(shown).toContain(reply(a4)[1]);
    expect(shown).toContain('вставлено');
    expect(await oursByText('dock', '[data-cg-part="1"] button', /^Вставить/)).not.toBeNull();
    // A new answer for this chat is the strip's buttons: the board's result has no «Ещё раз» here.
    expect(await oursByText('dock', '.cg-sheet .cg-head button', /^Ещё раз/)).toBeNull();
    // Taking the result over wrote nothing more.
    expect(bridgeWrites(await pageJournal(mark))).toEqual([{ method: 'setText', chatId: a4 }]);
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
    // No second POST, nothing of ours in ChatSpace's queue.
    await browser.pause(500);
    expect(sendsOf(await serverSince(standMark))).toHaveLength(1);
    expect(queueAdds(await pageJournal(mark))).toHaveLength(1);
    // The dock of the chat knows the part is delivered: «Отправлено», and part 2 is the next one to insert.
    await waitOursText('dock', /Отправлено/, 'the dock shows part 1 as sent', { selector: '[data-cg-part="0"]' });
    expect(await oursByText('dock', '[data-cg-part="0"] button', /^Вставить/)).toBeNull();
    expect(await oursByText('dock', '[data-cg-part="1"] button', /^Вставить/)).not.toBeNull();
    // The preview that made the result says the same: part 1 «Отправлено», and part 2 no longer waits «после части 1» with
    // only «Копировать» — it is offered for «Открыть и вставить». Its own «Отправить» is as off as it was.
    await openPreview('Fan Dune', 'read-after-send');
    const preview = await waitOursText('modal', /отправлено 1 из 2/, 'the preview counts the delivered part', { selector: '.cg-pv' });
    expect(preview).toContain('CG-SEND-OFF');
    expect(preview).not.toContain('Отправка после части');
    expect(preview.match(/Отправлено \d/g) ?? []).toHaveLength(1);
    expect(await oursByText('modal', '[data-cg-part="1"] button', /^Открыть и вставить/)).not.toBeNull();
    expect(await oursByText('modal', '[data-cg-part="0"] button', /^Открыть и вставить/)).toBeNull();
    expect(await oursExists('modal', '.cg-pv .cg-btn--primary:not([aria-disabled="true"])')).toBe(false);
    await browser.keys('Escape');
    await browser.keys('Escape');
    await boardClosed();
  });

  it('[TL-004] [NF-019] the next part goes the same honest way: «Вставить» in the dock is one write into that chat, ChatSpace’s own Send sends it, the hub registers part 2 of the same group — nothing is sent by us', async () => {
    const standMark = await standServer.mark();
    const hubMark = await hub().mark();
    const mark = await pageJournalMark();
    await pressOurs('dock', '[data-cg-part="1"] button', /^Вставить/);
    await waitForComposerText(ACC, a4, reply(a4)[1], 'the second part is in the field of the fan’s chat');
    expect(bridgeWrites(await pageJournal(mark))).toEqual([{ method: 'setText', chatId: a4 }]);
    // Inserted is not sent: nothing left the page until the person presses Send.
    await browser.pause(700);
    expect(sendsOf(await serverSince(standMark))).toEqual([]);
    expect(queueAdds(await pageJournal(mark))).toEqual([]);
    await pressSend();
    await browser.waitUntil(async () => sendsOf(await serverSince(standMark), a4).length === 1, { timeout: 10_000, timeoutMsg: 'ChatSpace did not send the second part' });
    expect(sendsOf(await serverSince(standMark), a4)[0]?.detail?.['plain']).toBe(reply(a4)[1]);
    let claims = callsTo((await hub().journal(hubMark)).entries, 'clientFanClaim');
    await browser.waitUntil(
      async () => {
        claims = callsTo((await hub().journal(hubMark)).entries, 'clientFanClaim');
        return claims.length > 0;
      },
      { timeout: 10_000, timeoutMsg: 'the hub was not told of the second proven send' },
    );
    expect(claims.map((call) => (call.request as { body?: { action?: string; partIndex?: number } }).body)).toMatchObject([{ action: 'registerNativeSend', partIndex: 1 }]);
    const custody = (await hub().status()).claims.find((claim) => claim.pageLabel === PAGE && claim.fanRef === a4);
    expect(custody?.attempts.map((attempt) => [attempt.state, attempt.partIndex])).toEqual([
      ['sent', 0],
      ['sent', 1],
    ]);
    await waitOursText('dock', /Отправлено/, 'the dock shows part 2 as sent', { selector: '[data-cg-part="1"]' });
    await browser.pause(500);
    expect(sendsOf(await serverSince(standMark))).toHaveLength(1);
    expect(queueAdds(await pageJournal(mark))).toHaveLength(1);
  });

  it('[TL-004] [NF-021] the preview reflects what the person sent: both parts «Отправлено», no part waits «после части 1», and its own «Отправить» is as off as it was', async () => {
    await openPreview('Fan Dune', 'read-after-send');
    const preview = await waitOursText('modal', /отправлено 2 из 2/, 'the preview counts the delivered parts', { selector: '.cg-pv' });
    expect(preview).not.toContain('Отправка после части');
    expect(preview).not.toContain('черновик · не отправлено');
    expect(preview.match(/Отправлено \d/g) ?? []).toHaveLength(2);
    // No right to send anything appeared: nothing of the result is offered for a send, and nothing is left to open and insert.
    expect(await oursExists('modal', '.cg-pv .cg-btn--primary:not([aria-disabled="true"])')).toBe(false);
    expect(await oursByText('modal', '.cg-pv button', /^Открыть и вставить/)).toBeNull();
  });

  it('[NEW-01] [NEW-05] the target chat holds the person’s own draft (Б2): the chat opens, nothing is written over their words, and the question stands in that chat’s dock', async () => {
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
    // §6.5 п. 4: the question is asked where the person now is — in the dock of the opened chat, about the chosen part.
    const asked = await waitOursText('dock', HUMAN_DRAFT, 'the question about the person’s own text, in the dock of the opened chat', { selector: '[data-cg-part="0"]' });
    expect(asked).toContain(reply(a6)[0]);
    for (const answer of ['Заменить', 'Добавить в конец', 'Отмена']) expect(await oursByText('dock', '[data-cg-part="0"] button', new RegExp(`^${answer}`))).not.toBeNull();
    // Said once, in the dock: no toast repeats it.
    expect(await oursText('toast')).not.toContain('CG-DRAFT-CHANGED');
    // Longer than the insert takes when the field is empty (the test above): nothing came, and nothing will without an answer.
    await browser.pause(1500);
    expect(await composerText(ACC, a6)).toBe('mine in the chat');
    expect(bridgeWrites(await pageJournal(mark))).toEqual([]);
    await browser.pause(NAV_TIMEOUT_SEC * 1000);
    expect(await composerText(ACC, a6)).toBe('mine in the chat');
    expect(bridgeWrites(await pageJournal(mark))).toEqual([]);
    expect((await dockIs(() => true, 'the dock')).result).toMatchObject({ parts: 2, inserted: 0, state: 'done' });
  });

  it('[NEW-05] [UI-020] «Добавить в конец» in that dock keeps the person’s words and adds the part after them — one write, by the person’s own click; the rest of the result is one more click away', async () => {
    const standMark = await standServer.mark();
    const mark = await pageJournalMark();
    await pressOurs('dock', '[data-cg-part="0"] button', /^Добавить в конец/);
    await waitForComposerText(ACC, a6, `mine in the chat\n${reply(a6)[0]}`, 'the part is appended to the person’s words');
    await dockIs((d) => d.result?.inserted === 1, 'the part is marked inserted');
    await waitOursText('dock', HUMAN_DRAFT, 'the question is gone', { gone: true });
    expect(bridgeWrites(await pageJournal(mark)).map((write) => write.chatId)).toEqual([a6]);
    // The second part is the next one, by «Вставить» of the dock; nothing was sent by any of it.
    await waitOursByText('dock', '[data-cg-part="1"] button', /^Вставить/, 'the dock offers the second part');
    expect(sendsOf(await serverSince(standMark))).toEqual([]);
    expect(queueAdds(await pageJournal(mark))).toEqual([]);
    await clearDraft();
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

  it('[TL-004] [NEW-01] the person presses Send the moment the part lands, before the page confirmed the insert: the send is still that part’s, and the hub registers it', async () => {
    await callStand('openChat', ACC, a1);
    await dockIs((d) => d.target?.endsWith(`:${a1}`) === true && d.status === 'ready', 'back in the first chat');
    const hubMark = await hub().mark();
    const standMark = await standServer.mark();
    await openPreview('Fan Juniper');
    await generate(a10);
    // ChatSpace's own Send right after the text lands in the fan's field, before a frame passes — a quick hand, or a
    // busy machine whose frames come late: the field is empty again before the insert is confirmed.
    await callStand('sendAfterNextWrite', ACC, a10);
    await pressOurs('modal', '.cg-pv button', /^Открыть и вставить/);
    await boardClosed();
    await browser.waitUntil(async () => sendsOf(await serverSince(standMark), a10).length === 1, { timeout: 10_000, timeoutMsg: 'ChatSpace did not send the part' });
    expect(sendsOf(await serverSince(standMark), a10).map((entry) => [entry.origin, entry.detail?.['plain']])).toEqual([['native', reply(a10)[0]]]);
    // The part was written, then the person sent it: the hub hears of that send as the part's (§6.6).
    let claims: string[] = [];
    await browser
      .waitUntil(
        async () =>
          (claims = callsTo((await hub().journal(hubMark)).entries, 'clientFanClaim')
            .filter((call) => (call.request as { fanRef?: string }).fanRef === a10)
            .map((call) => `${(call.request as { body: { action: string } }).body.action}:${call.status}`)).length > 0,
        { timeout: 10_000, interval: 50 },
      )
      .catch(() => undefined);
    expect(claims).toEqual(['registerNativeSend:200']);
    const custody = (await hub().status()).claims.find((claim) => claim.pageLabel === PAGE && claim.fanRef === a10);
    expect(custody?.attempts.map((attempt) => [attempt.state, attempt.partIndex])).toEqual([['sent', 0]]);
    // Nothing tells the person the insert failed: it did not. (The toast of the test above may still be up.)
    expect(await oursText('toast')).not.toContain('CG-INSERT-FAILED');
  });
});
