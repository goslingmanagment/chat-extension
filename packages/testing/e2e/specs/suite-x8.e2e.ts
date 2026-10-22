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
// unit tests on the adapter (host-chatspace send-port/receipt). Here the whole chain is real:
// the click, the action gate, the preview's controller, the background's
// coordinator and journal, the hub's custody (dispatch → ticket → report),
// the host port, MAIN, ChatSpace's queue. Each test title names its row.

import { browser, expect } from '@wdio/globals';
import { Key } from 'webdriverio';

import { callsTo } from '../../src/fake-hub/journal';
import { PAGE } from '../../src/scenarios/hub';
import { composerText, historyLoads, pageJournal, pageJournalMark, PANEL, queueAdds, sendsOf, serverSince, typeDraft } from '../support/chat';
import { useFakeHub } from '../support/fake-hub';
import { useNetworkTrap } from '../support/network-trap';
import { ours, oursBox, oursExists, oursText, pressOurs, readOurs, waitOursText } from '../support/ours';
import { dockIs, startShift, type Shift } from '../support/shift';
import { callStand, chatPath, foreignCalls, openStand, STAND_IDS, standServer, waitForChatReady } from '../support/stand';

const ACC = STAND_IDS.accounts.a;
const { a1, a2, a3, a4, a6, a7 } = STAND_IDS.fans;
/** Fans of the stand's account a beyond the named ones (ids follow its pattern): Iris, Juniper, Kestrel, Linden. */
const a9 = '74001009';
const a10 = '74001010';
const a11 = '74001011';
const a12 = '74001012';
/** The media picker's own reads (X53): the vault's folders and media, a fan's media statuses, the picks' release forms. */
const MEDIA_READ = /^\/api\/v0\/(platforms\/onlyfans\/accounts\/\d+\/(vault\/folders|fans\/\d+\/medias\/stats)|accounts\/\d+\/platforms\/onlyfans\/vault\/media\/release-forms)/;
const reply = (fan: string): readonly [string, string] => [`Hey you, thanks for writing! @${fan}`, `How was your day? @${fan}`];

describe('§12 п. 4 on the wired extension — X8: a part sent from a preview by one click, through ChatSpace’s own queue, under the hub’s custody', () => {
  useNetworkTrap();
  const { hub } = useFakeHub();
  let shift: Shift;
  let journalStart = 0;
  let firstTab = '';

  const openPreview = async (name: string): Promise<void> => {
    if (!(await oursExists('modal', '[aria-label="Spenders"]'))) await browser.keys([...PANEL, 'm']);
    // X65: the list above a preview is shorter and virtualized; search also reaches rows below its viewport. No Enter:
    // in the search it opens the top match's chat (the old Fansly board). The list follows the typing by itself: the
    // row is pressed once every row shown is a match, so the press never lands on a list being re-drawn under it.
    await ours('modal', '.cg-sp__search input').setValue(name);
    await browser.waitUntil(
      async () => {
        const rows = (await oursText('modal', '[data-cg-key^="fan:"]')).split(' ¶ ').filter((row) => row !== '');
        return rows.length > 0 && rows.every((row) => row.startsWith(name));
      },
      { timeout: 20_000, interval: 100, timeoutMsg: `the board did not narrow to ${name}` },
    );
    await pressOurs('modal', '[data-cg-key^="fan:"]', new RegExp(`^${name}`));
    await waitOursText('modal', name, `the preview of ${name}`, { selector: '.cg-pv' });
    await ours('modal', '.cg-sp__search input').setValue('');
    await browser.keys(Key.Enter);
  };
  /** Reply in the preview's own strip; resolves with both parts on screen. */
  const generate = async (fan: string): Promise<void> => {
    await pressOurs('modal', '.cg-pv .cg-pvm button, .cg-pv button', /^Reply/);
    await waitOursText('modal', reply(fan)[1], 'the preview’s result', { timeout: 20_000, selector: '.cg-pvr' });
  };
  const part = (index: number): string => `.cg-pv [data-cg-part="${index}"]`;
  /**
   * The send state of a part as the preview draws it: the part's own word and its row's, both from one moment of the
   * page (`readOurs`): the row goes when the part is sent, and a command that reads a row that has just gone waits
   * 15 s for it — as long as `waitSend` itself.
   */
  const sendState = async (index: number): Promise<string> => {
    const drawn = await readOurs('modal', part(index), (node) => [node.getAttribute('data-cg-send-state'), node.querySelector('.cg-pvs')?.getAttribute('data-cg-send') ?? null] as const);
    if (drawn === null) return 'no-part';
    const [own, row] = drawn;
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
  /**
   * The hub's custody calls for a fan since `mark`, once the hub heard of the outcome the page already shows. The
   * page shows an outcome the moment MAIN observed it; the tab's report reaches the hub through the background a
   * moment later. Compared whole: a call too many fails as well as one that never came.
   */
  const expectCustody = async (mark: number, fan: string, expected: readonly string[]): Promise<void> => {
    let heard: string[] = [];
    try {
      await browser.waitUntil(async () => (heard = await custody(mark, fan)).length >= expected.length, { timeout: 10_000, interval: 50 });
    } catch {
      // Compared below: the failure names what the hub did hear.
    }
    expect(heard).toEqual(expected);
  };
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
    // §6.7.13 «изоляция трафика»: every POST of a message was ChatSpace's own client's, and nothing of ours talked to the
    // stand but the media picker's reads of the vault (X53, our own requests by the owner's decision X54) — no chat's.
    expect(sendsOf(entries).filter((entry) => entry.origin !== 'native')).toEqual([]);
    expect(foreignCalls(entries).filter((entry) => !MEDIA_READ.test(entry.path ?? ''))).toEqual([]);
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
    // Parts go in any order (audit 2026-10-20, row 13).
    expect([await sendState(0), await sendState(1)]).toEqual(['available', 'available']);
    // Nothing has been asked of the hub's custody or of ChatSpace yet: looking and generating send nothing.
    expect(await custody(hubMark, a4)).toEqual([]);
    expect(queueAdds(await pageJournal(mark))).toEqual([]);

    await pressSendOf(0);
    await waitSend(0, 'sent', 'the first part is sent');
    const sends = sendsOf(await serverSince(standMark));
    expect(sends.map((entry) => [entry.origin, entry.chatId, entry.detail?.['plain']])).toEqual([['native', a4, reply(a4)[0]]]);
    expect(sends[0]?.detail).toMatchObject({ isCopied: false, isAiGenerated: true, internalTemplateId: null, replyTime: null, previousMessage: null, platformMetadata: {} });
    expect(queueAdds(await pageJournal(mark))).toHaveLength(1);
    await expectCustody(hubMark, a4, ['dispatch:200', 'sent:200']);
    expect(await attemptsOf(a4)).toEqual([['sent', 0]]);
    const shown = await oursText('modal', '.cg-pv');
    expect(shown).toContain('отправлено 1 из 2');
    expect(shown).toContain('После отправки ChatSpace показывает его прочитанным');

    // The next part is its own click.
    expect(await waitSend(1, 'available', 'the second part can be sent now')).toBe('available');
    await pressSendOf(1);
    await waitSend(1, 'sent', 'the second part is sent');
    expect(sendsOf(await serverSince(standMark)).map((entry) => entry.detail?.['plain'])).toEqual([...reply(a4)]);
    await expectCustody(hubMark, a4, ['dispatch:200', 'sent:200', 'dispatch:200', 'sent:200']);
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
    const send = `${part(0)} .cg-pvs__send`;
    // X66: the preview unfolds inside the list. Viewport pointer actions, unlike element.click(), do not scroll its button into view.
    await ours('modal', send).scrollIntoView({ block: 'center' });
    // The burst goes to fixed viewport coordinates: read them once the list has stopped moving (on a loaded runner the
    // scroll and the virtual list settle late, and a burst at the old place clicked nothing — the part stayed «available»).
    let box = await oursBox('modal', send);
    await browser.waitUntil(
      async () => {
        const next = await oursBox('modal', send);
        const still = next !== null && box !== null && next.x === box.x && next.y === box.y;
        box = next;
        return still;
      },
      { timeout: 5000, interval: 150, timeoutMsg: 'the send button did not stop moving' },
    );
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
    await expectCustody(hubMark, a6, ['dispatch:200', 'sent:200']);
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
    await expectCustody(hubMark, a7, ['dispatch:200', 'failed:200']);
    await browser.pause(700);
    expect(sendsOf(await serverSince(standMark))).toHaveLength(1);
  });

  it('[X8-06] [X8-07] [NF-022] a 5xx is an unknown outcome — never «not sent», never sent again by itself: «Не подтвердилось» with «Открыть чат» and «Отправить ещё раз»; the person\'s own click sends again (audit 2026-10-20, row 2)', async () => {
    const hubMark = await hub().mark();
    const standMark = await standServer.mark();
    await standServer.script(ACC, a9, [{ kind: 'status', status: 503 }]);
    await openPreview('Fan Iris');
    await generate(a9);
    await pressSendOf(0);
    await waitSend(0, 'uncertain', 'the outcome of the part is unknown');
    const shown = await oursText('modal', '.cg-pv');
    expect(shown).toContain('Не подтвердилось');
    expect(shown).toContain('CG-SEND-UNCERTAIN');
    expect(await oursExists('modal', `${part(0)} .cg-pvs__verify`)).toBe(true);
    expect(await oursText('modal', `${part(0)} .cg-pvs__send`)).toContain('Отправить ещё раз');
    // Nothing goes again by itself.
    await browser.pause(1500);
    expect(sendsOf(await serverSince(standMark))).toHaveLength(1);
    expect(await custody(hubMark, a9)).toEqual(['dispatch:200']);
    // Closed and opened again, the preview still says so (the journal of this install), and «Статус» counts it.
    await openPreview('Fan Dune');
    await openPreview('Fan Iris');
    await waitSend(0, 'uncertain', 'the unknown outcome is still there after the preview was reopened');
    const diagnostics = await shift.rpc<{ sends: { open: number; uncertain: number } }>('diagnostics.get');
    expect(diagnostics.ok ? diagnostics.payload.sends : null).toEqual({ open: 0, uncertain: 1 });
    // The person looked and sends the part again by their own click: a new attempt, a new POST. Inside the first one's
    // ticket the hub would still call it in flight (custody_held), so the click comes after it.
    await browser.pause(11_000);
    await pressSendOf(0);
    await waitSend(0, 'sent', 'the part sent again is sent');
    expect(sendsOf(await serverSince(standMark))).toHaveLength(2);
  });

  it('[X8-04] a fan’s message after Generate is a warning («Фан написал новое», «Отправить всё равно»); a new Generate warns while the hub says its answer did not see that message, and is offered plainly once it did; «Отправить всё равно» sends by its own click', async () => {
    const hubMark = await hub().mark();
    const standMark = await standServer.mark();
    const mark = await pageJournalMark();
    /** Generations of this test that the hub finished. */
    const generated = async (): Promise<number> => callsTo((await hub().journal(hubMark)).entries, 'aiFeatureStream').filter((call) => call.stream?.outcome === 'done').length;
    await openPreview('Fan Juniper');
    await generate(a10);
    expect(await sendState(0)).toBe('available');
    const fanWrote = await standServer.fanMessage(ACC, a10, 'a new synthetic line of the fan');
    await waitSend(0, 'held-stale', 'the send warns: the fan wrote after the generation');
    const held = await oursText('modal', part(0));
    expect(held).toContain('Фан написал новое');
    expect(held).toContain('CG-SEND-STALE');
    expect(await oursText('modal', `${part(0)} .cg-pvs__send`)).toContain('Отправить всё равно');
    // «Ещё раз»: a new answer. The request names the fan's new message among the ones the tab saw, and the hub's
    // `context_v1` frame (announced through the vendored SDK) answers for it: its archive has not got the message
    // yet — `absent` — so the new answer did not see it either. The send stays held, with the way out (§6.7.5).
    await pressOurs('modal', `${part(0)} .cg-pvs__again`, /^Ещё раз/);
    await browser.waitUntil(async () => (await generated()) === 2, { timeout: 20_000, timeoutMsg: 'the second generation did not finish' });
    await waitSend(0, 'held-stale', 'the new answer did not see the fan’s message either');
    const stillHeld = await oursText('modal', part(0));
    expect(stillHeld).toContain('CG-SEND-STALE');
    expect(stillHeld).toContain('Посмотрите архив');
    const asked = callsTo((await hub().journal(hubMark)).entries, 'aiFeatureStream').at(-1);
    expect((asked?.request as { capabilities?: string[]; body?: { knownFanMessageIds?: string[] } }).capabilities).toContain('context-v1');
    expect((asked?.request as { body?: { knownFanMessageIds?: string[] } }).body?.knownFanMessageIds).toContain(fanWrote);
    expect(asked?.stream?.frames).toContain('context_v1');
    // The hub's archive catches up with the fan's message: the next answer is proven to have seen it, and the
    // send is offered again — by the hub's own word, never by the absence of one.
    await hub().command({ op: 'archiveMessage', pageLabel: PAGE, fanRef: a10, messageId: fanWrote });
    await pressOurs('modal', `${part(0)} .cg-pvs__again`, /^Ещё раз/);
    await browser.waitUntil(async () => (await generated()) === 3, { timeout: 20_000, timeoutMsg: 'the third generation did not finish' });
    await waitSend(0, 'available', 'the answer that saw the fan’s message can be sent');
    expect(await oursExists('modal', `${part(0)} .cg-pvs__send`)).toBe(true);
    // Nothing was sent by any of this: no custody call, nothing put into ChatSpace's queue.
    expect(await custody(hubMark, a10)).toEqual([]);
    expect(queueAdds(await pageJournal(mark))).toEqual([]);
    expect(sendsOf(await serverSince(standMark))).toEqual([]);
    // The fan writes again; the person reads it and sends the second part anyway, by its own click (rows 3, 13).
    await standServer.fanMessage(ACC, a10, 'one more synthetic line of the fan');
    await waitSend(1, 'held-stale', 'the send warns again');
    await pressOurs('modal', `${part(1)} .cg-pvs__send`, /^Отправить всё равно/);
    await waitSend(1, 'sent', 'the part sent anyway is sent');
    await expectCustody(hubMark, a10, ['dispatch:200', 'sent:200']);
    expect(queueAdds(await pageJournal(mark))).toHaveLength(1);
    expect(sendsOf(await serverSince(standMark))).toHaveLength(1);
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

  it('[X8-08] two tabs, one fan: while one tab’s part is on its way, the other tab’s click starts nothing and is told why — one dispatch, one POST', async () => {
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
      // The first tab's answer is shown here too: this tab took no checkpoint for it, so it only warns (audit 2026-10-20, row 4).
      await waitOursText('modal', reply(a11)[0], 'the result of the other tab', { selector: '.cg-pvr' });
      await waitSend(0, 'unverified', 'a result this tab did not generate warns that its freshness cannot be checked here');
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
      await expectCustody(hubMark, a11, ['dispatch:200', 'sent:200']);
    } finally {
      await browser.switchToWindow(secondTab);
      await browser.closeWindow();
      // The second tab is gone and the first one is in front before anything is read again: a tab that is still
      // closing answers as the hidden document it was — the same chat, our windows already taken down.
      await browser.waitUntil(async () => !(await browser.getWindowHandles()).includes(secondTab), { timeout: 10_000, timeoutMsg: 'the second tab did not close' });
      await browser.waitUntil(
        async () => {
          await browser.switchToWindow(firstTab);
          return browser.execute(() => document.visibilityState === 'visible');
        },
        { timeout: 10_000, interval: 100, timeoutMsg: 'the first tab is not in front again' },
      );
    }
  });

  it('[X53] vault media go with a part: the panel reads the vault and what the fan got — no chat —, the picks in order with a price and a free preview; one click is one POST carrying them, and who sent it knows the price and the media', async () => {
    // The suite has sent seven parts within the minute: the hub's own limit (six a minute) is not what is tested here.
    await hub().command({ op: 'config', patch: { limits: { previewSendPerMinute: 60 } } });
    const hubMark = await hub().mark();
    const standMark = await standServer.mark();
    const mark = await pageJournalMark();
    await openPreview('Fan Birch');
    await generate(a2);
    await pressOurs('modal', '.cg-pv [data-cg-strip="media"] button', /Медиа/);
    await waitOursText('modal', 'Stand set & one', 'the vault’s folders in the panel', { timeout: 15_000, selector: '.cg-pvm' });
    await waitOursText('modal', 'куплено', 'what the fan already bought is marked', { selector: '[data-cg-media="660000002"]' });
    expect(await oursText('modal', '[data-cg-media="660000005"]')).toContain('не куплено');
    // A medium the platform has not finished is shown and never picked.
    await ours('modal', '[data-cg-media="660000007"] .cg-pvm__pick').click();
    expect(await oursText('modal', '[data-cg-media="660000007"]')).not.toMatch(/^\d/);
    // The order of the clicks is the message's.
    await ours('modal', '[data-cg-media="660000004"] .cg-pvm__pick').click();
    await ours('modal', '[data-cg-media="660000001"] .cg-pvm__pick').click();
    await ours('modal', '.cg-pvm__price input').setValue('24.99');
    await waitOursText('modal', /^1$/, 'the first pick is the message’s first', { selector: '[data-cg-media="660000004"] .cg-pvm__order' });
    await ours('modal', '[data-cg-media="660000001"] .cg-pvm__free').click();
    // The panel can scroll with the picker open; the send action must remain reachable without closing it.
    await ours('modal', `${part(0)} .cg-pvs__send`).scrollIntoView({ block: 'center' });
    await waitOursText('modal', 'Отправить + 2 медиа за $24.99', 'the part’s button names what goes with it', { selector: `${part(0)} .cg-pvs__send` });
    await pressSendOf(0);
    await waitSend(0, 'sent', 'the part with its media is sent');
    const sends = sendsOf(await serverSince(standMark));
    expect(sends.map((entry) => [entry.origin, entry.chatId, entry.detail?.['plain']])).toEqual([['native', a2, reply(a2)[0]]]);
    expect(sends[0]?.detail?.['platformMetadata']).toEqual({ mediaFiles: [660000004, 660000001], rfTag: ['7700001'], price: 24.99, previews: [660000001] });
    expect(queueAdds(await pageJournal(mark))).toHaveLength(1);
    await expectCustody(hubMark, a2, ['dispatch:200', 'sent:200']);
    // Who sent it: the hub is told the message with its price and media (X48).
    let attributed: unknown[] = [];
    await browser.waitUntil(async () => (attributed = callsTo((await hub().journal(hubMark)).entries, 'clientSendAttributions')).length > 0, { timeout: 10_000, interval: 100 }).catch(() => undefined);
    expect(JSON.stringify(attributed)).toContain('"priced":true');
    expect(JSON.stringify(attributed)).toContain('"withMedia":true');
    // The picks went with it; the next part is text alone.
    expect(await oursExists('modal', '.cg-pvm')).toBe(false);
    expect(await waitSend(1, 'available', 'the second part can be sent')).toBe('available');
    expect(await oursText('modal', `${part(1)} .cg-pvs__send`)).toBe('Отправить');
    // The vault was read, never a chat: no history load, the chat not opened.
    const entries = await serverSince(standMark);
    expect(historyLoads(entries)).toEqual([]);
    expect(entries.filter((entry) => entry.kind === 'http' && /vault|medias/.test(entry.path ?? '')).length).toBeGreaterThan(0);
    expect((await callStand('route')).chatId).toBe(a1);
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
