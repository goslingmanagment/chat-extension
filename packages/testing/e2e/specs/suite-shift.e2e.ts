// §12 п. 4 on the wired extension, part 9 — the network's own account of a
// whole shift («сетевой журнал BiDi: ни одного запроса нашего кода, кроме
// поддельного хаба», and the safety gate of §12: «единственные нативные
// вызовы — следствия навигации, ввода и клика X8 человека»).
//
// One person works a shift by hand on the stand: a Reply inserted and sent
// with ChatSpace's own Send, typing, Recap, Review, a question to Coach, the
// next chat by a key, a part sent from a Spenders preview (X8), «Открыть и
// вставить» with a Send after it, a greeting from «Новые». Then three
// journals are read whole:
// - WebDriver BiDi's network log: every request made from the ChatSpace tab
//   went to the stand's own page or API — its own; none to the hub (only the
//   background talks to it), none anywhere else;
// - the stand server's journal, where every call is labelled by who made
//   it: nothing «foreign»; each history of a chat was loaded for a chat the
//   person opened; each typing signal is for a chat the person typed in;
//   each message POST is one of the person's sends — ChatSpace's Send or one
//   X8 click — in the order they were made; everything else is ChatSpace's
//   own reading;
// - the fake hub's journal: only the client's routes, under the narrow token.
// Nothing left loopback (the egress sink, checked after every test).

import { $, browser, expect } from '@wdio/globals';

import { callsTo } from '../../src/fake-hub/journal';
import { PAGE } from '../../src/scenarios/hub';
import { MOD, PANEL, pressSend, typeDraft, waitForComposerText } from '../support/chat';
import { useFakeHub } from '../support/fake-hub';
import { useNetworkTrap } from '../support/network-trap';
import { oursExists, oursFocus, oursText, pressOurs, readOurs, waitOursText } from '../support/ours';
import { dockIs, startShift, type Shift } from '../support/shift';
import { callStand, standApiOrigin, standOrigin, STAND_IDS, standServer, waitForChatReady } from '../support/stand';

const ACC = STAND_IDS.accounts.a;
const { a1, a4, a5, a6 } = STAND_IDS.fans;
/** Split is off: one part, signed with its chat (`aiNameFan`). */
const reply = (fan: string): string => `Hey you, thanks for writing! How was your day? @${fan}`;
const greeting = (fan: string): string => `Hi and welcome! @${fan}`;

describe('§12 п. 4 on the wired extension — a whole shift, and the network’s own account of it', () => {
  const { trap } = useNetworkTrap();
  const { hub } = useFakeHub();
  let shift: Shift;
  let journalStart = 0;
  let hubStart = 0;
  /** What the person did, as they did it: the ledger the journals are read against. */
  const opened: string[] = [];
  const typedIn: string[] = [];
  const sent: Array<{ readonly chat: string; readonly text: string; readonly by: 'send-button' | 'x8-click' }> = [];

  const part = (index: number): string => `.cg-pv [data-cg-part="${index}"]`;
  const sentInPreview = (): Promise<void> =>
    browser.waitUntil(async () => (await readOurs('modal', part(0), (node) => node.getAttribute('data-cg-send-state'))) === 'sent', { timeout: 20_000, timeoutMsg: 'the part was not confirmed as sent' }).then(() => undefined);
  const openPreview = async (name: string): Promise<void> => {
    if (!(await oursExists('modal', '[aria-label="Spenders"]'))) await browser.keys([...PANEL, 'm']);
    await waitOursText('modal', name, `the board lists ${name}`, { timeout: 20_000, selector: '[aria-label="Доска Spenders"]' });
    await pressOurs('modal', '[data-cg-key^="fan:"]', new RegExp(`^${name}`));
    await waitOursText('modal', name, `the preview of ${name}`, { selector: '.cg-pv' });
  };
  const closeWindows = async (): Promise<void> => {
    for (let press = 0; press < 3 && (await dockIs(() => true, 'the dock')).overlays.length > 0; press += 1) {
      await browser.keys('Escape');
      await browser.pause(150);
    }
    expect((await dockIs(() => true, 'the dock')).overlays).toEqual([]);
  };

  before(async () => {
    await standServer.reset();
    await standServer.traffic({ firstSummaryMs: 150 });
    journalStart = await standServer.mark();
    await hub().command({ op: 'config', patch: { aiNameFan: true } });
    await hub().command({ op: 'audienceEvent', pageLabel: PAGE, fanRef: a5 });
    hubStart = await hub().mark();
    shift = await startShift(hub(), { previewSend: true, viewport: { width: 1440, height: 900 } });
    opened.push(a1);
    await dockIs((d) => d.status === 'ready' && d.actions['reply'] === true, 'the dock of the open chat is ready');
  });

  it('the open chat: Reply, «Вставить», ChatSpace’s own Send; then the person types a line of their own', async () => {
    await pressOurs('dock', '.cg-strip button', /^Reply/);
    await dockIs((d) => d.result?.state === 'done', 'the Reply result', 20_000);
    await pressOurs('dock', '[data-cg-part="0"] button', /^Вставить/);
    await waitForComposerText(ACC, a1, reply(a1), 'the part is in the field');
    await pressSend();
    sent.push({ chat: a1, text: reply(a1), by: 'send-button' });
    await waitForComposerText(ACC, a1, '', 'ChatSpace sent it and cleared its field');
    await typeDraft('a line of my own');
    typedIn.push(a1);
    await waitForComposerText(ACC, a1, 'a line of my own', 'the person’s own line');
  });

  it('[AI-050] analysis asks the hub only: a short Recap, a Review and a question to Coach, each with the open chat\'s tail (X52)', async () => {
    const mark = await hub().mark();
    await pressOurs('dock', '.cg-strip button', /^Recap/);
    await dockIs((d) => d.analysis === 'recap', 'the Recap sheet');
    await pressOurs('dock', '.cg-dock button', /^Собрать коротко/);
    await waitOursText('dock', 'Synthetic short recap.', 'the short Recap', { timeout: 20_000 });
    await browser.keys('Escape');
    await dockIs((d) => d.analysis === null, 'the Recap sheet is hidden');
    await pressOurs('dock', '.cg-strip button', /^Review/);
    // X55: the Review opens in its «Развернуть ↗» window; Esc folds it into the sheet, the next Esc hides the sheet.
    await waitOursText('modal', 'Synthetic review of the chat.', 'the Review in its window', { timeout: 20_000, selector: '.cg-xdlg' });
    await browser.keys('Escape');
    await browser.waitUntil(async () => !(await oursExists('modal', '.cg-xdlg')), { timeout: 5000, timeoutMsg: 'Esc did not fold the Review window' });
    await browser.keys('Escape');
    await dockIs((d) => d.analysis === null, 'the Review sheet is hidden');
    await pressOurs('dock', '.cg-strip button', /^Coach/);
    await browser.waitUntil(async () => (await oursFocus('panel'))?.label === 'Вопрос Coach', { timeout: 10_000, timeoutMsg: 'the Coach field did not take the focus' });
    await browser.keys('What do I say next?'.split(''));
    await browser.keys('Enter');
    await waitOursText('panel', 'Ask about their weekend before you offer anything.', 'the Coach answer', { timeout: 20_000 });
    await closeWindows();
    const asked = callsTo((await hub().journal(mark)).entries, 'aiFeatureStream').map((call) => call.request as { feature?: string; body?: Record<string, unknown> });
    expect(asked.map((request) => [request.feature, request.body !== undefined && 'liveTextContext' in request.body])).toEqual([['fan-summary', true], ['chat-review', true], ['coach-chat', true]]);
    // The person's line in ChatSpace's field was not touched by any of it.
    expect((await callStand('composerState', ACC, a1))?.text).toBe('a line of my own');
  });

  it('a part sent from a Spenders preview by one click (X8)', async () => {
    await openPreview('Fan Dune');
    await pressOurs('modal', '.cg-pv button', /^Reply/);
    await waitOursText('modal', reply(a4), 'the preview’s result', { timeout: 20_000, selector: '.cg-pvr' });
    await pressOurs('modal', `${part(0)} .cg-pvs__send`, /^Отправить/);
    sent.push({ chat: a4, text: reply(a4), by: 'x8-click' });
    await sentInPreview();
  });

  it('«Открыть и вставить» from another preview, then ChatSpace’s own Send in the opened chat', async () => {
    await openPreview('Fan Fern');
    await pressOurs('modal', '.cg-pv button', /^Reply/);
    await waitOursText('modal', reply(a6), 'the preview’s result', { timeout: 20_000, selector: '.cg-pvr' });
    await pressOurs('modal', `${part(0)} .cg-pvs__open`, /^Открыть и вставить/);
    opened.push(a6);
    await waitForChatReady(ACC, a6);
    await waitForComposerText(ACC, a6, reply(a6), 'the part is in the field of the opened chat');
    await pressSend();
    sent.push({ chat: a6, text: reply(a6), by: 'send-button' });
    await waitForComposerText(ACC, a6, '', 'ChatSpace sent it and cleared its field');
  });

  it('a greeting from «Новые»: Hi takes the lease, one click sends it', async () => {
    await browser.keys([MOD, 'k']);
    await pressOurs('modal', '.cg-pal__item', /^Новые(?:\s*(?:⌘⇧U|Ctrl\+Alt\+U))?$/, 'the «Новые» row of the palette (its key since X55)', 20_000);
    const username = `newfan_${a5}`;
    await pressOurs('modal', '[aria-label="Новые подписчики"] [data-cg-key]', new RegExp(`@${username}\\b`), 'the row of the stand’s new subscriber', 20_000);
    await pressOurs('modal', '.cg-pv button', /^Hi/);
    await waitOursText('modal', greeting(a5), 'the greeting draft', { timeout: 20_000, selector: '.cg-pv' });
    await pressOurs('modal', `${part(0)} .cg-pvs__send`, /^Отправить/);
    sent.push({ chat: a5, text: greeting(a5), by: 'x8-click' });
    await sentInPreview();
    await closeWindows();
  });

  it('the next chat by a key: ChatSpace’s own router opens it', async () => {
    const before = (await callStand('route')).chatId;
    // The focus leaves ChatSpace's message field (a click on the chat's header): J is a key now, not a letter.
    await $('[data-stand-conversation-header]').click();
    await browser.keys(['j']);
    await browser.waitUntil(async () => (await callStand('route')).chatId !== before, { timeout: 5000, timeoutMsg: 'J did not open another chat' });
    const next = (await callStand('route')).chatId ?? '';
    opened.push(next);
    await waitForChatReady(ACC, next);
    await dockIs((d) => d.target?.endsWith(`:${next}`) === true && d.status === 'ready', 'the dock of the next chat');
  });

  it('[RB-022] [AI-120] the account: BiDi saw the ChatSpace tab talk only to ChatSpace; the stand saw only the person’s own navigation, typing and sends; the hub saw only its client', async () => {
    // Late requests of the last actions arrive.
    await browser.pause(1500);
    await trap().settle();

    // 1. BiDi: what the ChatSpace tab itself requested — page scripts and our content scripts alike.
    const allowedHosts = new Set([new URL(standOrigin()).host, new URL(standApiOrigin()).host]);
    const fromTab = trap()
      .requests()
      .filter((request) => request.context === shift.standTab && /^https?:|^wss?:/.test(request.url));
    expect(fromTab.length).toBeGreaterThan(40);
    expect(fromTab.filter((request) => !allowedHosts.has(new URL(request.url).host)).map((request) => request.url)).toEqual([]);
    // Not one request to the hub from the tab: the hub is the background's alone.
    expect(fromTab.filter((request) => new URL(request.url).host === new URL(hub().origin).host)).toEqual([]);

    // 2. The stand's journal: who made each call.
    const entries = (await standServer.journal(journalStart)).entries;
    expect(entries.filter((entry) => entry.origin === 'foreign')).toEqual([]);
    expect(entries.filter((entry) => entry.kind === 'ws-silent')).toEqual([]);
    const native = entries.filter((entry) => entry.origin === 'native');
    // Histories: only of chats the person opened (a chat's history is a read on OnlyFans).
    const loaded = [...new Set(native.filter((entry) => entry.kind === 'history-load').map((entry) => entry.chatId ?? ''))];
    expect(loaded.sort()).toEqual([...new Set(opened)].sort());
    // Typing signals: only for chats the person typed in or was given a text to send in.
    const typing = [...new Set(native.filter((entry) => entry.kind === 'http' && entry.method === 'POST' && (entry.path ?? '').endsWith('/typing')).map((entry) => entry.chatId ?? ''))];
    expect(typing.filter((chat) => !typedIn.includes(chat) && !sent.some((message) => message.chat === chat && message.by === 'send-button'))).toEqual([]);
    // Messages: exactly the person's sends, in their order, each by ChatSpace's own client.
    const messages = entries.filter((entry) => entry.kind === 'send');
    expect(messages.map((entry) => [entry.origin, entry.chatId, entry.detail?.['plain']])).toEqual(sent.map((message) => ['native', message.chat, message.text]));
    // The AI mark is ChatSpace's own rule: ours on the queue's direct sends, never on what the composer sent.
    expect(messages.map((entry) => entry.detail?.['isAiGenerated'])).toEqual(sent.map((message) => message.by === 'x8-click'));
    // Every other native call is reading — ChatSpace's presence poll asks by POST — or the stand's own session token:
    // nothing else was written.
    const writes = native.filter(
      (entry) =>
        entry.kind === 'http' &&
        !['GET', 'OPTIONS'].includes(entry.method ?? '') &&
        !(entry.path ?? '').endsWith('/typing') &&
        !(entry.path ?? '').endsWith('/messages') &&
        !(entry.path ?? '').endsWith('/platforms/onlyfans/fans-online'),
    );
    expect(writes.map((entry) => `${String(entry.method)} ${String(entry.path)}`).filter((call) => call !== 'POST /__stand/auth/token')).toEqual([]);

    // 3. The hub: only routes of the client, each under the narrow token of this sign-in.
    const calls = (await hub().journal(hubStart)).entries;
    expect(calls.filter((call) => call.kind !== 'route').map((call) => `${call.kind} ${call.method} ${call.path}`)).toEqual([]);
    expect(calls.filter((call) => call.route !== 'authIssueDeviceTokenWithPassword' && call.route !== 'health' && call.token?.client !== 'chat-extension').map((call) => String(call.route))).toEqual([]);
    const custody = callsTo(calls, 'clientFanClaim').map((call) => `${String((call.request as { fanRef?: string }).fanRef)}:${(call.request as { body: { action: string } }).body.action}:${call.status}`);
    expect(custody).toEqual([`${a4}:dispatch:200`, `${a4}:sent:200`, `${a6}:registerNativeSend:200`, `${a5}:claim:200`, `${a5}:dispatch:200`, `${a5}:sent:200`]);
    // The dock's text of the open chat is not checked here; what the person's panel showed last is one line.
    expect(await oursText('toast')).not.toContain('CG-UI-FAILED');
  });
});
