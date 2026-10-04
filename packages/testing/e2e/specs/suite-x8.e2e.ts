// §12 п. 4 on the wired extension, part 4 — the X8 matrix of §6.7.13 with the
// hub in it (architecture.md §6.7): the TEST build on the stand against the
// fake hub, the owner's `previewSend` switch on and the stand's receipt
// profile approved, the stand's fans on the hub's Spenders board. Every send
// here is one click of a person on «Отправить» of one part in a fan's
// preview; what leaves the browser for the platform is ChatSpace's own POST,
// made by its own client from its own queue.
//
// The rows of the matrix that need no hub — the queue call itself, the page's
// conditions, the socket's freshness, the receipt and the echo — have their
// spec on the adapter alone (x8-send.e2e.ts). Here the whole chain is real:
// the click, the action gate, the preview's controller, the background's
// coordinator and journal, the hub's custody (dispatch → ticket → report),
// the host port, MAIN, ChatSpace's queue. Each test title names its row.

import { browser, expect } from '@wdio/globals';

import { callsTo } from '../../src/fake-hub/journal';
import { PAGE } from '../../src/scenarios/hub';
import { composerText, historyLoads, pageJournal, pageJournalMark, PANEL, queueAdds, sendsOf, serverSince, typeDraft } from '../support/chat';
import { useFakeHub } from '../support/fake-hub';
import { useNetworkTrap } from '../support/network-trap';
import { ours, oursBox, oursExists, oursText, pressOurs, waitOursText } from '../support/ours';
import { dockIs, startShift, type Shift } from '../support/shift';
import { callStand, chatPath, foreignCalls, openStand, STAND_IDS, standServer, waitForChatReady } from '../support/stand';

const ACC = STAND_IDS.accounts.a;
const { a1, a3, a4, a6, a7 } = STAND_IDS.fans;
/** Fans of the stand's account a beyond the named ones (ids follow its pattern): Iris, Juniper, Kestrel, Linden. */
const a9 = '74001009';
const a10 = '74001010';
const a11 = '74001011';
const a12 = '74001012';
const reply = (fan: string): readonly [string, string] => [`Hey you, thanks for writing! @${fan}`, `How was your day? @${fan}`];

describe('§12 п. 4 on the wired extension — X8: a part sent from a preview by one click, through ChatSpace’s own queue, under the hub’s custody', () => {
  useNetworkTrap();
  const { hub } = useFakeHub();
  let shift: Shift;
  let journalStart = 0;
  let firstTab = '';

  const openPreview = async (name: string): Promise<void> => {
    if (!(await oursExists('modal', '[aria-label="Spenders"]'))) await browser.keys([...PANEL, 'm']);
    await waitOursText('modal', name, `the board lists ${name}`, { timeout: 20_000, selector: '[aria-label="Доска Spenders"]' });
    await pressOurs('modal', '[data-cg-key^="fan:"]', new RegExp(`^${name}`));
    await waitOursText('modal', name, `the preview of ${name}`, { selector: '.cg-pv' });
  };
  /** Reply in the preview's own strip; resolves with both parts on screen. */
  const generate = async (fan: string): Promise<void> => {
    await pressOurs('modal', '.cg-pv .cg-pvm button, .cg-pv button', /^Reply/);
    await waitOursText('modal', reply(fan)[1], 'the preview’s result', { timeout: 20_000, selector: '.cg-pvr' });
  };
  const part = (index: number): string => `.cg-pv [data-cg-part="${index}"]`;
  /** The send state of a part as the preview draws it: the part's own word and its row's. */
  const sendState = async (index: number): Promise<string> => {
    if (!(await oursExists('modal', part(index)))) return 'no-part';
    const own = await ours('modal', part(index)).getAttribute('data-cg-send-state');
    const row = (await oursExists('modal', `${part(index)} .cg-pvs`)) ? await ours('modal', `${part(index)} .cg-pvs`).getAttribute('data-cg-send') : null;
    return row === null || row === own ? String(own) : `${String(own)}/${row}`;
  };
  const waitSend = async (index: number, wanted: string | RegExp, message: string, timeout = 15_000): Promise<string> => {
    let last = '';
    try {
      await browser.waitUntil(
        async () => {
          last = await sendState(index);
          return typeof wanted === 'string' ? last === wanted : wanted.test(last);
        },
        { timeout, interval: 100 },
      );
    } catch {
      throw new Error(`${message}: part ${index + 1} is «${last}», not «${String(wanted)}», after ${timeout} ms; the result shows: ${(await oursText('modal', '.cg-pvr')).slice(0, 500)}`);
    }
    return last;
  };
  const pressSendOf = (index: number): Promise<void> => pressOurs('modal', `${part(index)} .cg-pvs__send`, /^Отправить/);
  /** The hub's custody calls for a fan since `mark`: `action:status[:error/reason]`. */
  const custody = async (mark: number, fan: string): Promise<string[]> =>
    callsTo((await hub().journal(mark)).entries, 'clientFanClaim')
      .filter((call) => (call.request as { fanRef?: string }).fanRef === fan)
      .map((call) => `${(call.request as { body: { action: string } }).body.action}:${call.status}${call.error === null ? '' : `:${call.error}/${String(call.reason)}`}`);
  const attemptsOf = async (fan: string): Promise<Array<readonly [string, number]>> =>
    ((await hub().status()).claims.find((claim) => claim.pageLabel === PAGE && claim.fanRef === fan)?.attempts ?? []).map((attempt) => [attempt.state, attempt.partIndex] as const);

  before(async () => {
    await standServer.reset();
    // The stand's socket names its accounts soon after their subscription: an account's freshness is known from then on.
    await standServer.traffic({ firstSummaryMs: 150 });
    journalStart = await standServer.mark();
    await hub().command({ op: 'config', patch: { aiNameFan: true } });
    shift = await startShift(hub(), { previewSend: true, settings: { generation: { split: true } }, viewport: { width: 1440, height: 900 } });
    firstTab = shift.standTab;
    await dockIs((d) => d.status === 'ready' && d.actions['reply'] === true, 'the dock of the open chat is ready');
    // The person has a draft of their own in the open chat: nothing below may touch it.
    await typeDraft('my draft in the open chat');
  });

  after(async () => {
    await browser.switchToWindow(firstTab);
    const entries = await serverSince(journalStart);
    // §6.7.13 «изоляция трафика»: every POST of a message was ChatSpace's own client's, and nothing of ours talked to the stand.
    expect(sendsOf(entries).filter((entry) => entry.origin !== 'native')).toEqual([]);
    expect(foreignCalls(entries)).toEqual([]);
    // What we marked: never «copied», and AI-generated by ChatSpace's own rule (the text is the model's part as it was).
    expect(sendsOf(entries).map((entry) => [entry.detail?.['isCopied'], entry.detail?.['isAiGenerated']])).toEqual(sendsOf(entries).map(() => [false, true]));
    // No chat was opened and no history loaded by any of it: every fan above stays unread until a message of ours is echoed.
    expect(historyLoads(entries).filter((entry) => entry.chatId !== a1)).toEqual([]);
    expect(await composerText(ACC, a1)).toBe('my draft in the open chat');
  });

  it('[X8-05] [SP-054] [X8-01] a cold target: one click — one queue call, one POST by ChatSpace’s client, the hub’s custody from dispatch to sent; no tab opens, no history loads, the open chat’s draft stays', async () => {
    const hubMark = await hub().mark();
    const standMark = await standServer.mark();
    const mark = await pageJournalMark();
    await openPreview('Fan Dune');
    await generate(a4);
    expect([await sendState(0), await sendState(1)]).toEqual(['available', 'available/after']);
    // Nothing has been asked of the hub's custody or of ChatSpace yet: looking and generating send nothing.
    expect(await custody(hubMark, a4)).toEqual([]);
    expect(queueAdds(await pageJournal(mark))).toEqual([]);

    await pressSendOf(0);
    await waitSend(0, 'sent', 'the first part is sent');
    const sends = sendsOf(await serverSince(standMark));
    expect(sends.map((entry) => [entry.origin, entry.chatId, entry.detail?.['plain']])).toEqual([['native', a4, reply(a4)[0]]]);
    expect(sends[0]?.detail).toMatchObject({ isCopied: false, isAiGenerated: true, internalTemplateId: null, replyTime: null, previousMessage: null, platformMetadata: {} });
    expect(queueAdds(await pageJournal(mark))).toHaveLength(1);
    expect(await custody(hubMark, a4)).toEqual(['dispatch:200', 'sent:200']);
    expect(await attemptsOf(a4)).toEqual([['sent', 0]]);
    const shown = await oursText('modal', '.cg-pv');
    expect(shown).toContain('отправлено 1 из 2');
    expect(shown).toContain('После отправки ChatSpace показывает его прочитанным');

    // The next part is its own click.
    expect(await waitSend(1, 'available', 'the second part can be sent now')).toBe('available');
    await pressSendOf(1);
    await waitSend(1, 'sent', 'the second part is sent');
    expect(sendsOf(await serverSince(standMark)).map((entry) => entry.detail?.['plain'])).toEqual([...reply(a4)]);
    expect(await custody(hubMark, a4)).toEqual(['dispatch:200', 'sent:200', 'dispatch:200', 'sent:200']);
    expect(await oursText('modal', '.cg-pvr')).toContain('отправлено 2 из 2');

    // The fan's chat was never opened: no tab, no composer, no history; the person's own draft is where it was.
    expect((await callStand('route')).chatId).toBe(a1);
    expect((await callStand('composers')).map((composer) => composer.chatId)).toEqual([a1]);
    expect(historyLoads(await serverSince(standMark))).toEqual([]);
    expect(await composerText(ACC, a1)).toBe('my draft in the open chat');
  });

  it('[X8-03] twenty clicks on «Отправить» in one burst are one attempt: one dispatch, one queue call, one POST', async () => {
    const hubMark = await hub().mark();
    const standMark = await standServer.mark();
    const mark = await pageJournalMark();
    // The platform takes its time to echo: the attempt is still open while the clicks land.
    await standServer.script(ACC, a6, [{ kind: 'ok', echo: 'after', gapMs: 1500 }]);
    await openPreview('Fan Fern');
    await generate(a6);
    const box = await oursBox('modal', `${part(0)} .cg-pvs__send`);
    expect(box).not.toBeNull();
    const x = Math.round((box?.x ?? 0) + (box?.width ?? 0) / 2);
    const y = Math.round((box?.y ?? 0) + (box?.height ?? 0) / 2);
    let burst = browser.action('pointer', { parameters: { pointerType: 'mouse' } }).move({ x, y, origin: 'viewport' });
    for (let click = 0; click < 20; click += 1) burst = burst.down().up();
    await burst.perform();
    await waitSend(0, /^(accepted|sent)$/, 'the part is on its way');
    expect(await sendState(1)).toBe('available/after');
    await waitSend(0, 'sent', 'the part is sent');
    expect(sendsOf(await serverSince(standMark))).toHaveLength(1);
    expect(queueAdds(await pageJournal(mark))).toHaveLength(1);
    expect(await custody(hubMark, a6)).toEqual(['dispatch:200', 'sent:200']);
    expect(await attemptsOf(a6)).toEqual([['sent', 0]]);
  });

  it('[X8-06] Message Guard is a proven refusal: «Не отправлено» with its topic, the hub’s custody closed as failed, no retry — «Открыть и вставить» is the way', async () => {
    const hubMark = await hub().mark();
    const standMark = await standServer.mark();
    await standServer.script(ACC, a7, [{ kind: 'guard', topics: ['stand-topic'] }]);
    await openPreview('Fan Grove');
    await generate(a7);
    await pressSendOf(0);
    await waitSend(0, 'rejected', 'the part was refused by Message Guard');
    const shown = await oursText('modal', part(0));
    expect(shown).toContain('Не отправлено');
    expect(shown).toContain('CG-SEND-GUARD');
    expect(shown).toContain('stand-topic');
    // No «Отправить ещё раз» for a refusal of the text itself; the person edits it in ChatSpace.
    expect(await oursExists('modal', `${part(0)} .cg-pvs__send`)).toBe(false);
    expect(await oursExists('modal', `${part(0)} .cg-pvs__open`)).toBe(true);
    expect(await custody(hubMark, a7)).toEqual(['dispatch:200', 'failed:200']);
    await browser.pause(700);
    expect(sendsOf(await serverSince(standMark))).toHaveLength(1);
  });

  it('[X8-06] [X8-08] a 5xx is an unknown outcome — never «not sent», never sent again: «Неизвестно, ушло ли», the fan is held, the hub’s custody stays open', async () => {
    const hubMark = await hub().mark();
    const standMark = await standServer.mark();
    await standServer.script(ACC, a9, [{ kind: 'status', status: 503 }]);
    await openPreview('Fan Iris');
    await generate(a9);
    await pressSendOf(0);
    await waitSend(0, 'uncertain', 'the outcome of the part is unknown');
    const shown = await oursText('modal', '.cg-pv');
    expect(shown).toContain('Неизвестно, ушло ли');
    expect(shown).toContain('CG-SEND-UNCERTAIN');
    // The only thing offered is to look: no «Отправить», no «Открыть и вставить», and nothing new is generated for this fan.
    expect(await oursExists('modal', `${part(0)} .cg-pvs__verify`)).toBe(true);
    expect(await oursExists('modal', '.cg-pv .cg-pvs__send')).toBe(false);
    expect(await oursExists('modal', '.cg-pv .cg-pvs__open')).toBe(false);
    expect(shown).toContain('Нельзя, пока неясен исход части 1');
    // One POST, never repeated; the hub holds the attempt — it does not free itself.
    await browser.pause(1500);
    expect(sendsOf(await serverSince(standMark))).toHaveLength(1);
    expect(await custody(hubMark, a9)).toEqual(['dispatch:200']);
    expect(await attemptsOf(a9)).toEqual([['dispatching', 0]]);
    // Closed and opened again, the preview still says so (the journal of this install), and «Статус» counts it.
    await openPreview('Fan Dune');
    await openPreview('Fan Iris');
    await waitSend(0, 'uncertain', 'the unknown outcome is still there after the preview was reopened');
    const diagnostics = await shift.rpc<{ sends: { open: number; uncertain: number } }>('diagnostics.get');
    expect(diagnostics.ok ? diagnostics.payload.sends : null).toEqual({ open: 0, uncertain: 1 });
    expect(sendsOf(await serverSince(standMark))).toHaveLength(1);
  });

  it('[X8-04] a fan’s message after Generate holds the send («Удержано: фан написал новое»); a new Generate the hub cannot prove fresh stays held too — zero queue calls', async () => {
    const hubMark = await hub().mark();
    const standMark = await standServer.mark();
    const mark = await pageJournalMark();
    await openPreview('Fan Juniper');
    await generate(a10);
    expect(await sendState(0)).toBe('available');
    await standServer.fanMessage(ACC, a10, 'a new synthetic line of the fan');
    await waitSend(0, 'held-stale', 'the send is held: the fan wrote after the generation');
    const held = await oursText('modal', part(0));
    expect(held).toContain('Удержано: фан написал новое');
    expect(held).toContain('CG-SEND-STALE');
    expect(await oursExists('modal', `${part(0)} .cg-pvs__send`)).toBe(false);
    // «Ещё раз»: a new answer. The hub's stream carries no `context_v1` with this SDK, so nobody can say the answer
    // saw the fan's new message: the send stays off with its own reason (§6.7.5 — never «fresh» by absence of proof).
    await pressOurs('modal', `${part(0)} .cg-pvs__again`, /^Ещё раз/);
    await waitSend(0, /^unavailable/, 'the new answer is not proven fresh');
    expect(await oursText('modal', part(0))).toContain('CG-SEND-FRESHNESS');
    expect(await oursExists('modal', `${part(0)} .cg-pvs__open`)).toBe(true);
    expect(await custody(hubMark, a10)).toEqual([]);
    expect(queueAdds(await pageJournal(mark))).toEqual([]);
    expect(sendsOf(await serverSince(standMark))).toEqual([]);
  });

  it('[X8-03] the page’s own conditions are told on the button: a blocked fan, and the chat that is open — zero dispatches, nothing of ChatSpace touched', async () => {
    const hubMark = await hub().mark();
    const standMark = await standServer.mark();
    const mark = await pageJournalMark();
    await openPreview('Fan Cedar');
    await generate(a3);
    expect(await waitSend(0, /^unavailable/, 'a blocked fan cannot be sent to')).toMatch(/^unavailable/);
    expect(await oursText('modal', part(0))).toContain('CG-SEND-FAN');
    await openPreview('Fan Alder');
    await generate(a1);
    expect(await waitSend(0, /^unavailable/, 'the open chat is not a preview target')).toMatch(/^unavailable/);
    expect(await oursText('modal', part(0))).toContain('CG-SEND-ACTIVE-CHAT');
    expect([...(await custody(hubMark, a3)), ...(await custody(hubMark, a1))]).toEqual([]);
    expect(queueAdds(await pageJournal(mark))).toEqual([]);
    expect(sendsOf(await serverSince(standMark))).toEqual([]);
    // The stand's fan is still blocked and the person's draft still theirs: nothing was «fixed» to make the send possible.
    expect(await composerText(ACC, a1)).toBe('my draft in the open chat');
  });

  it('[X8-03] [X8-08] two tabs, one fan: while one tab’s part is on its way, the other tab’s click starts nothing and is told why — one dispatch, one POST', async () => {
    const hubMark = await hub().mark();
    const standMark = await standServer.mark();
    await standServer.script(ACC, a11, [{ kind: 'ok', echo: 'after', gapMs: 3000 }]);
    await openPreview('Fan Kestrel');
    await generate(a11);
    const secondTab = (await browser.createWindow('tab')).handle;
    try {
      await browser.switchToWindow(secondTab);
      await openStand(chatPath(ACC, a1));
      await waitForChatReady(ACC, a1);
      await dockIs((d) => d.status === 'ready', 'the dock of the second tab');
      await openPreview('Fan Kestrel');
      // The first tab's answer is shown here too, without the right to send it: this tab took no checkpoint for it.
      await waitOursText('modal', reply(a11)[0], 'the result of the other tab', { selector: '.cg-pvr' });
      await waitSend(0, /^unavailable/, 'a result this tab did not generate cannot be sent from it');
      await pressOurs('modal', '.cg-pvr .cg-again, .cg-pvr button', /^Ещё раз/);
      await waitSend(0, 'available', 'this tab’s own answer can be sent', 20_000);

      await browser.switchToWindow(firstTab);
      await pressSendOf(0);
      await waitSend(0, /^(accepted|sending|queued)$/, 'the first tab’s part is on its way');
      await browser.switchToWindow(secondTab);
      await pressSendOf(0);
      // Its button comes back as it was — the reason would be lost — so the tab says it: the fan is busy with another send.
      await waitOursText('toast', 'CG-SEND-BUSY', 'the second tab says why its click started nothing');
      expect(await sendState(0)).toBe('available');
      await browser.switchToWindow(firstTab);
      await waitSend(0, 'sent', 'the first tab’s part is sent');
      expect(sendsOf(await serverSince(standMark))).toHaveLength(1);
      expect(await custody(hubMark, a11)).toEqual(['dispatch:200', 'sent:200']);
    } finally {
      await browser.switchToWindow(secondTab);
      await browser.closeWindow();
      await browser.switchToWindow(firstTab);
    }
  });

  it('[AI-120] [X8-09] the owner switches the preview send off between the ready button and the click: the hub refuses the dispatch, zero queue calls, and the button says why', async () => {
    const hubMark = await hub().mark();
    const standMark = await standServer.mark();
    const mark = await pageJournalMark();
    await openPreview('Fan Linden');
    await generate(a12);
    expect(await sendState(0)).toBe('available');
    // The switch goes off at the hub; this browser has not read a bootstrap since.
    await hub().command({ op: 'config', patch: { flags: { previewSend: false } } });
    await pressSendOf(0);
    await waitSend(0, /^unavailable/, 'the send was refused: the switch is off');
    expect(await oursText('modal', part(0))).toContain('CG-SEND-OFF');
    // The row keeps this reason: it is not said a second time as a toast.
    expect(await oursText('toast')).not.toContain('CG-SEND-OFF');
    expect(await custody(hubMark, a12)).toEqual(['dispatch:409:client_feature_disabled/flag_off']);
    expect(queueAdds(await pageJournal(mark))).toEqual([]);
    expect(sendsOf(await serverSince(standMark))).toEqual([]);
    // «Открыть и вставить» is still there: the switch takes the send away, not the answer.
    expect(await oursExists('modal', `${part(0)} .cg-pvs__open`)).toBe(true);
  });
});
