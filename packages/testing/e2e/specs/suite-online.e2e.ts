// CS-030 on the wired extension (decision X24) — the palette's «Онлайн»: the
// TEST build on the stand against the fake hub, ChatSpace's account open with
// NO chat open, and ChatSpace's own presence poll (the stand models it,
// fixture ui/fans-online.ts) showing three fans online. What it proves, by
// hand — keys and clicks:
// - ⌘K lists in «Онлайн» exactly the fans ChatSpace shows online, in its
//   order; nothing of ours asked who is online;
// - choosing one opens OUR preview of that fan in a window of its own: the
//   hub's archive, «Чат не открыт, останется непрочитанным»; ChatSpace opens
//   no chat, loads no history, and the fan's unread mark stays;
// - J and K walk the list the palette showed, in its order, still with no
//   chat opened;
// - Ping in the window asks the hub only. No chat has been opened since the
//   page loaded, so ChatSpace has not created yet what its sending reads (its
//   composer translator store comes with the first chat's composer): «Отправить»
//   (X8, the owner's switch on here) says to open any chat (CG-SEND-HOST) and
//   sends nothing, and «Открыть и вставить» is offered — the same rows and
//   conditions as in Spenders;
// - Esc closes the window and the focus is back where it was before ⌘K;
// - «Статус» meanwhile says ChatSpace is connected — with a note that sending
//   from the preview starts with any chat, not «проверен частично»; once the
//   person opened a chat and closed it again, the note is the usual one, and
//   «Отправить» in the window is available (nothing is pressed);
// - with a chat of the person's own open, «Отправить» in the window sends the
//   part through ChatSpace's own queue by one click, and the online fan's chat
//   is still not opened.

import { $, browser, expect } from '@wdio/globals';
import { Key } from 'webdriverio';

import { callsTo } from '../../src/fake-hub/journal';
import { bridgeWrites, historyLoads, MOD, pageJournal, pageJournalMark, queueAdds, sendsOf, serverSince } from '../support/chat';
import { useFakeHub } from '../support/fake-hub';
import { useNetworkTrap } from '../support/network-trap';
import { oursBox, oursExists, pressOurs, readOurs, waitOursText } from '../support/ours';
import { readChatSpaceStatus } from '../support/pages';
import { dockIs, startShift, type Shift } from '../support/shift';
import { callStand, foreignCalls, STAND_IDS, standServer, waitForChatReady } from '../support/stand';

const ACC = STAND_IDS.accounts.a;
const { a1, a8 } = STAND_IDS.fans;
/** Fans Kestrel and Linden of the stand's account a (the dataset names its fans beyond a8 by the same pattern). */
const [a11, a12] = ['74001011', '74001012'] as const;
/**
 * Fans ChatSpace shows online: rows near the top of its list (its poll asks only about the rows on screen), each
 * with unread messages, none waiting for an answer on the hub's board — so the palette lists each of them once.
 */
const ONLINE = [a12, a11, a8] as const;
const NAMES: Readonly<Record<string, string>> = { [a8]: 'Fan Heath', [a11]: 'Fan Kestrel', [a12]: 'Fan Linden' };
const WINDOW = { width: 1440, height: 900 } as const;
const ping = (fan: string): RegExp => new RegExp(`Thinking of you today.*@${fan}`);
/** Split is off: one part, signed with its chat (`aiNameFan`). */
const reply = (fan: string): string => `Hey you, thanks for writing! How was your day? @${fan}`;

describe('CS-030 on the wired extension — the palette’s «Онлайн» opens OUR preview in a window of its own (X24)', () => {
  useNetworkTrap();
  const { hub } = useFakeHub();
  let shift: Shift;
  let journalStart = 0;
  /** The «Онлайн» group as the palette showed it: fan ids, in its order. */
  let shown: string[] = [];
  /** What ChatSpace's own list said of each fan's unread messages before the window opened. */
  let unreadBefore: Record<string, number | null> = {};

  /** ChatSpace's own list: the rows with its green dot, top to bottom. */
  const list = (): Promise<{ readonly dots: string[] }> =>
    browser.execute(() => {
      const rows = [...document.querySelectorAll<HTMLElement>('.chats-panel__list [data-chat-id]')];
      return { dots: rows.filter((row) => row.querySelector('.avatar--online') !== null).map((row) => row.dataset['chatId'] ?? '') };
    });
  /** The unread counts ChatSpace keeps for the account's chats (its query cache, what its badges show). */
  const unread = async (): Promise<Record<string, number | null>> => {
    const data = (await callStand('queryData', ['chatList', ACC, 'all'])) as { pages: Array<{ items: Array<{ id: string; unreadMessagesCount: number }> }> } | null;
    return Object.fromEntries((data?.pages.flatMap((page) => page.items) ?? []).map((chat) => [String(chat.id), chat.unreadMessagesCount]));
  };
  /** The names of the palette's «Онлайн» rows, in their order; null — the palette is not on screen. */
  const onlineGroup = (): Promise<string[] | null> =>
    readOurs('modal', '.cg-pal__list', (node) => {
      const names: string[] = [];
      let inside = false;
      for (const element of node.querySelectorAll('.cg-pal__grp, .cg-pal__item')) {
        if (element.classList.contains('cg-pal__grp')) {
          inside = (element.textContent ?? '').trim() === 'Сейчас онлайн, по данным ChatSpace';
          continue;
        }
        if (inside) names.push((element.querySelector('.cg-pal__main b')?.textContent ?? '').trim());
      }
      return names;
    });
  const header = (): Promise<string | null> => readOurs('modal', '.cg-pvw .cg-pv__name', (node) => (node.textContent ?? '').replace(/\s+/g, ' ').trim());
  /** The name in the window's header is this fan's, and the hub was asked for this fan's archive. */
  const showing = async (fan: string, hubMark: number): Promise<void> => {
    await browser.waitUntil(async () => (await header())?.startsWith(NAMES[fan] ?? '?') === true, { timeout: 10_000, timeoutMsg: `the window does not show ${NAMES[fan] ?? fan}: ${String(await header())}` });
    await browser.waitUntil(async () => callsTo((await hub().journal(hubMark)).entries, 'clientConversationFeed').some((call) => (call.request as { fanRef?: string }).fanRef === fan), {
      timeout: 10_000,
      timeoutMsg: `the hub was not asked for the archive of ${fan}`,
    });
  };
  /** Nothing of ChatSpace's chats moved: no chat is open, no history was loaded. */
  const noChatOpened = async (since: number): Promise<void> => {
    expect((await callStand('route')).chatId ?? null).toBeNull();
    expect(historyLoads(await serverSince(since))).toEqual([]);
  };

  before(async () => {
    await standServer.reset();
    await standServer.traffic({ firstSummaryMs: 150 });
    // ChatSpace's own presence answer; its poll asks at once for the rows on screen when the list shows.
    await standServer.presence(ACC, [...ONLINE]);
    journalStart = await standServer.mark();
    await hub().command({ op: 'config', patch: { aiNameFan: true } });
    shift = await startShift(hub(), { chat: null, previewSend: true, viewport: WINDOW });
    await browser.waitUntil(
      async () => {
        const now = await list();
        return ONLINE.every((fan) => now.dots.includes(fan));
      },
      { timeout: 15_000, timeoutMsg: 'ChatSpace did not show the fans online' },
    );
    expect((await list()).dots.sort()).toEqual([...ONLINE].sort());
  });

  after(async () => {
    await standServer.presence(ACC, []);
    const diagnostics = await shift.rpc<{ counters: Record<string, number> }>('diagnostics.get');
    expect(diagnostics.ok ? Object.entries(diagnostics.payload.counters).filter(([name, count]) => name.startsWith('p1.') && count > 0) : null).toEqual([]);
  });

  it('[CS-030] with no chat open, ⌘K lists in «Онлайн» exactly the fans ChatSpace shows online, in the order of its list', async () => {
    // The person's place on the page before the palette: a button of ChatSpace's own list.
    await browser.execute(() => document.querySelector<HTMLElement>('[data-stand-chat-order]')?.focus());
    await browser.keys([MOD, 'k']);
    await browser.waitUntil(async () => ((await onlineGroup()) ?? []).length === ONLINE.length, { timeout: 15_000, timeoutMsg: 'the palette shows no «Онлайн» group of three' });
    const names = (await onlineGroup()) ?? [];
    // ChatSpace's own order: the rows with its dot, top to bottom.
    const order = (await list()).dots;
    expect(names).toEqual(order.map((fan) => NAMES[fan]));
    shown = order;
    // Each of them has unread messages: the mark a chat opened by us would clear.
    unreadBefore = await unread();
    expect(ONLINE.filter((fan) => (unreadBefore[fan] ?? 0) > 0)).toEqual([...ONLINE]);
    expect((await callStand('route')).chatId ?? null).toBeNull();
  });

  it('[CS-030] [RB-022] choosing one opens OUR preview in its own window from the hub’s archive — ChatSpace opens no chat, loads no history, and the chat stays unread', async () => {
    const standMark = await standServer.mark();
    const hubMark = await hub().mark();
    const journalMark = await pageJournalMark();
    const first = shown[0] ?? '';
    await pressOurs('modal', '.cg-pal__item', new RegExp(`^${NAMES[first] ?? '?'}`), 'the first fan of «Онлайн»');
    await browser.waitUntil(() => oursExists('modal', '.cg-pvw'), { timeout: 10_000, timeoutMsg: 'the preview window did not open' });
    const dock = await dockIs((d) => d.overlays.includes('preview') && d.surfaces.includes('preview') && !d.overlays.includes('palette'), 'the preview window is the overlay on screen');
    expect(dock.surfaces).not.toContain('palette');
    expect(dock.visible).toBe(false);
    await showing(first, hubMark);
    await waitOursText('modal', 'Чат не открыт, останется непрочитанным', 'the window says the chat stays unread', { selector: '.cg-pvw' });
    // One column inside the window of the browser, nothing of ours pushing the page sideways.
    const box = await oursBox('modal', '.cg-pvw');
    expect(box).not.toBeNull();
    if (box !== null) expect([box.x >= 0, box.y >= 0, box.x + box.width <= WINDOW.width, box.y + box.height <= WINDOW.height, Math.round(box.width)]).toEqual([true, true, true, true, 420]);
    expect(await browser.execute(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // The archive feed has the focus: J and K are the window's at once.
    expect(await readOurs('modal', '.cg-pvw .cg-feed', (node) => (node.getRootNode() as ShadowRoot).activeElement === node)).toBe(true);
    // ChatSpace: no chat open, no history, nothing written, the unread marks as they were.
    await noChatOpened(standMark);
    expect(sendsOf(await serverSince(standMark))).toEqual([]);
    expect(bridgeWrites(await pageJournal(journalMark))).toEqual([]);
    const after = await unread();
    for (const fan of ONLINE) expect([fan, after[fan]]).toEqual([fan, unreadBefore[fan]]);
    // The hub: only the archive and the card of that fan, nothing for anybody else.
    const fed = callsTo((await hub().journal(hubMark)).entries, 'clientConversationFeed').map((call) => (call.request as { fanRef?: string }).fanRef);
    expect([...new Set(fed)]).toEqual([first]);
  });

  it('[CS-030] [SP-056] J and K walk the list the palette showed, in its order — still no chat opened', async () => {
    const standMark = await standServer.mark();
    const [first, second, third] = shown as [string, string, string];
    let hubMark = await hub().mark();
    await browser.keys(['j']);
    await showing(second, hubMark);
    hubMark = await hub().mark();
    await browser.keys(['j']);
    await showing(third, hubMark);
    // The end of the list: J goes nowhere further.
    await browser.keys(['j']);
    await browser.pause(300);
    expect((await header())?.startsWith(NAMES[third] ?? '?')).toBe(true);
    hubMark = await hub().mark();
    await browser.keys(['k']);
    await showing(second, hubMark);
    await browser.keys(['k']);
    await browser.waitUntil(async () => (await header())?.startsWith(NAMES[first] ?? '?') === true, { timeout: 10_000, timeoutMsg: 'K did not go back to the first fan' });
    await noChatOpened(standMark);
    expect((await dockIs(() => true, 'the dock')).overlays).toEqual(['preview']);
  });

  it('[CS-030] [AI-038] [X8-03] Ping in the window asks the hub only; no chat opened since the page loaded, so «Отправить» says to open any chat and sends nothing — «Открыть и вставить» is offered', async () => {
    const fan = shown[0] ?? '';
    const standMark = await standServer.mark();
    const hubMark = await hub().mark();
    const journalMark = await pageJournalMark();
    await pressOurs('modal', '.cg-pvw .cg-pv button', /^Ping/);
    await waitOursText('modal', ping(fan), 'the Ping of the window’s fan', { timeout: 20_000, selector: '.cg-pvw .cg-pvr' });
    const streams = callsTo((await hub().journal(hubMark)).entries, 'aiFeatureStream');
    expect(streams.map((call) => [(call.request as { feature?: string }).feature, (call.request as { body?: { fanRef?: string } }).body?.fanRef])).toEqual([['ping', fan]]);
    // The part's row, as in Spenders: X8 is not possible here, and the row says why (the host's own capability).
    const row = await readOurs('modal', '.cg-pvw [data-cg-part="0"]', (node) => ({ state: node.getAttribute('data-cg-send-state'), text: (node.textContent ?? '').replace(/\s+/g, ' ') }));
    expect(row?.state).toBe('unavailable');
    expect(row?.text).toContain('CG-SEND-HOST');
    // Not «ChatSpace is not taking sends»: what lifts it is the person's own next step.
    expect(row?.text).toContain('Отправка недоступна: откройте любой чат, и она заработает. Пока вставьте часть в чат вручную.');
    expect(row?.text).not.toContain('ChatSpace сейчас не принимает');
    expect(row?.text).toContain('Открыть и вставить');
    await pressOurs('modal', '.cg-pvw [data-cg-part="0"] .cg-pvs__send', /^Отправить/);
    await browser.pause(500);
    // Nothing was sent, written or opened.
    expect(sendsOf(await serverSince(standMark))).toEqual([]);
    expect(queueAdds(await pageJournal(journalMark))).toEqual([]);
    expect(bridgeWrites(await pageJournal(journalMark))).toEqual([]);
    await noChatOpened(standMark);
  });

  it('[CS-030] Esc closes the window, and the focus is back where it was before ⌘K', async () => {
    await browser.keys(Key.Escape);
    await browser.waitUntil(async () => !(await oursExists('modal', '.cg-pvw')), { timeout: 5000, timeoutMsg: 'Esc did not close the window' });
    const dock = await dockIs((d) => !d.overlays.includes('preview') && !d.surfaces.includes('preview'), 'the window is gone');
    expect(dock.overlays).toEqual([]);
    expect(await browser.execute(() => document.activeElement?.hasAttribute('data-stand-chat-order') ?? false)).toBe(true);
    expect(await browser.execute(() => [...document.querySelectorAll('[data-host="overlay"]')].some((host) => host.hasAttribute('data-dismissible-open')))).toBe(false);
    expect((await callStand('route')).chatId ?? null).toBeNull();
  });

  it('[ST-025] [PU-006] [X8-03] «Статус» says ChatSpace is connected and that sending from the preview starts with any chat; a chat opened and closed — the usual note, and «Отправить» in the window is available', async () => {
    const fan = shown[0] ?? '';
    const waiting = await readChatSpaceStatus(shift, (row) => row.text.includes('заработает'));
    expect(waiting.chatspace.level).toBe('ok');
    expect(waiting.chatspace.text).toContain('подключён');
    expect(waiting.chatspace.text).toContain('Отправка из превью заработает, когда вы откроете любой чат.');
    expect(waiting.chatspace.text).not.toContain('частично');
    expect(waiting.chatspace.text).not.toContain('composerTranslator');
    expect(waiting.popupCodes).not.toContain('CG-HOST-CONTRACT');
    expect(waiting.popupStage).toContain('ChatSpace и хаб на связи');

    // The person opens a chat of their own and closes it: ChatSpace created what its sending reads, and keeps it.
    await callStand('openChat', ACC, a1);
    await waitForChatReady(ACC, a1);
    await callStand('closeActiveChatTab');
    await browser.waitUntil(async () => ((await callStand('route')).chatId ?? null) === null, { timeout: 5000, timeoutMsg: 'the chat did not close' });
    const ready = await readChatSpaceStatus(shift, (row) => !row.text.includes('заработает'));
    expect(ready.chatspace.level).toBe('ok');
    expect(ready.chatspace.text).toContain('проверены в');
    expect(ready.popupStage).toContain('ChatSpace и хаб на связи');

    // The window of the same fan again: its Ping is there, and «Отправить» is available now. Nothing is pressed.
    const standMark = await standServer.mark();
    await browser.execute(() => document.querySelector<HTMLElement>('[data-stand-chat-order]')?.focus());
    await browser.keys([MOD, 'k']);
    await browser.waitUntil(async () => ((await onlineGroup()) ?? []).length === ONLINE.length, { timeout: 15_000, timeoutMsg: 'the palette shows no «Онлайн» group of three' });
    await pressOurs('modal', '.cg-pal__item', new RegExp(`^${NAMES[fan] ?? '?'}`), 'the fan of «Онлайн»');
    await waitOursText('modal', ping(fan), 'the window shows the fan’s Ping', { timeout: 15_000, selector: '.cg-pvw .cg-pvr' });
    let state: string | null = null;
    await browser.waitUntil(async () => (state = await readOurs('modal', '.cg-pvw [data-cg-part="0"]', (node) => node.getAttribute('data-cg-send-state'))) === 'available', {
      timeout: 10_000,
      timeoutMsg: `«Отправить» did not become available: ${String(state)}`,
    });
    expect(await readOurs('modal', '.cg-pvw [data-cg-part="0"]', (node) => node.querySelector('.cg-pvs__code')?.textContent ?? null)).toBeNull();
    expect(sendsOf(await serverSince(standMark))).toEqual([]);
    await noChatOpened(standMark);
    await browser.keys(Key.Escape);
    await browser.waitUntil(async () => !(await oursExists('modal', '.cg-pvw')), { timeout: 5000, timeoutMsg: 'Esc did not close the window' });
  });

  it('[CS-030] [X8] with a chat of the person’s own open, «Отправить» in the window sends the part through ChatSpace’s own queue by one click — the online fan’s chat is still not opened', async () => {
    const fan = shown[0] ?? '';
    // The person opens a chat of their own (none of the online fans): ChatSpace loads what its sending needs.
    await callStand('openChat', ACC, a1);
    await waitForChatReady(ACC, a1);
    await dockIs((d) => d.visible && d.target?.endsWith(`:${a1}`) === true, `the dock of chat ${a1}`);
    const standMark = await standServer.mark();
    const journalMark = await pageJournalMark();
    await $('[data-stand-conversation-header]').click();
    await browser.keys([MOD, 'k']);
    await browser.waitUntil(async () => ((await onlineGroup()) ?? []).length === ONLINE.length, { timeout: 15_000, timeoutMsg: 'the palette shows no «Онлайн» group of three' });
    await pressOurs('modal', '.cg-pal__item', new RegExp(`^${NAMES[fan] ?? '?'}`), 'the fan of «Онлайн»');
    await waitOursText('modal', NAMES[fan] ?? '?', 'the window of the fan', { selector: '.cg-pvw .cg-pv__name' });
    await pressOurs('modal', '.cg-pvw .cg-pv button', /^Reply/);
    await waitOursText('modal', reply(fan), 'the Reply of the window’s fan', { timeout: 20_000, selector: '.cg-pvw .cg-pvr' });
    await pressOurs('modal', '.cg-pvw [data-cg-part="0"] .cg-pvs__send', /^Отправить/);
    await browser.waitUntil(async () => (await readOurs('modal', '.cg-pvw [data-cg-part="0"]', (node) => node.getAttribute('data-cg-send-state'))) === 'sent', {
      timeout: 20_000,
      timeoutMsg: `the part was not confirmed as sent: ${String(await readOurs('modal', '.cg-pvw [data-cg-part="0"]', (node) => node.textContent))}`,
    });
    const sends = sendsOf(await serverSince(standMark));
    expect(sends.map((entry) => [entry.origin, entry.chatId, entry.detail?.['plain']])).toEqual([['native', fan, reply(fan)]]);
    expect(queueAdds(await pageJournal(journalMark))).toHaveLength(1);
    // Nothing written into the open chat's field; the open chat is still the person's own, the fan's history not loaded.
    expect(bridgeWrites(await pageJournal(journalMark))).toEqual([]);
    expect((await callStand('route')).chatId).toBe(a1);
    expect(historyLoads(await serverSince(standMark))).toEqual([]);
    await waitOursText('modal', 'После отправки ChatSpace показывает его прочитанным', 'the window says what the send did to the unread mark', { selector: '.cg-pvw' });
    await browser.keys(Key.Escape);
    await browser.waitUntil(async () => !(await oursExists('modal', '.cg-pvw')), { timeout: 5000, timeoutMsg: 'Esc did not close the window' });
  });

  it('[RB-022] the security gate: nothing of ours reached the stand, the only history loaded is the chat the person opened, every presence request was ChatSpace’s own', async () => {
    const entries = (await standServer.journal(journalStart)).entries;
    expect(foreignCalls(entries)).toEqual([]);
    expect([...new Set(historyLoads(entries).map((entry) => [entry.chatId, entry.origin].join(':')))]).toEqual([`${a1}:native`]);
    const presence = entries.filter((entry) => String(entry.path).endsWith('/fans-online'));
    expect(presence.length).toBeGreaterThan(0);
    expect(presence.every((entry) => entry.origin === 'native')).toBe(true);
    // The one send of the spec is the person's X8 click.
    expect(sendsOf(entries).map((entry) => entry.chatId)).toEqual([shown[0]]);
  });
});
