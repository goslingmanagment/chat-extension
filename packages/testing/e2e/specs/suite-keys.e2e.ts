// §12 п. 4 on the wired extension, part 6 — the keys (architecture.md §9.1):
// the TEST build on the stand against the fake hub, real key presses, the
// real windows and panels of ours. The dispatcher's own decisions have their
// spec on its seams (hotkeys.e2e.ts, with stand-in surfaces); here every key
// lands in the real dock, Spenders, fan panel, cheatsheet and palette.
// - in ChatSpace's message field our keys are ours before its editor sees
//   them: ⌘E / ⌘I start Reply and Fix, TipTap toggles neither inline code nor
//   italic; a key that is not ours (⌘B) is untouched;
// - with the focus off the dock J/K walk ChatSpace's chat list through its
//   own router, `]` opens the fan panel, `?` the cheatsheet; on a part of the
//   dock J, K and `]` do nothing (X44); typed into ChatSpace's field the same
//   letters are text;
// - Esc closes OUR windows one by one and the chat tab stays; with nothing of
//   ours open Esc is ChatSpace's own again;
// - under the Spenders window J/K and the arrows move its rows, Space opens
//   the preview, `/` goes to its search; a generation key is refused with its
//   reason; what is typed into its search field — two layouts, `]`, `?` — is
//   text and starts nothing;
// - Enter on a part of ours is «Вставить»: ChatSpace sends nothing;
// - ⌘E → Enter → Enter → Enter → Enter (X44): over the empty field the
//   finished Reply and each send of our part hand the focus to the next part;
//   a person typing in the field keeps it there;
// - Alt (⌥) held alone opens «Быстрый переход» only where the owner's
//   `navigation` is on for the page (X45: its digits are Alt+1–9, ⌘/Ctrl+1–9
//   are Firefox's tabs): with it off the hold opens nothing and says
//   nothing, Alt+1–9 and J are refused aloud, and no chat is opened;
// - a browser on Windows (a second Firefox that says so): Ctrl+Alt+S is
//   Recap and ChatSpace's translator, which listens for Alt+S, does not flip;
// - «Новые» from the keyboard (X55): ⌘⇧U / Ctrl+Alt+U opens the window on
//   the first fan who can be greeted, with that fan's card; J walks and the
//   card follows; Enter on the card's row is Hi; nothing is sent; the same
//   key closes the window.

import { mkdirSync } from 'node:fs';

import { $, browser, expect } from '@wdio/globals';
import { Key } from 'webdriverio';

import { pilotPageFlags } from '../../src/fake-hub/config';
import { E2E_EVIDENCE_DIR } from '../../src/stand/paths';
import { callsTo } from '../../src/fake-hub/journal';
import { clearDraft, composerText, historyLoads, MOD, pageJournal, pageJournalMark, PANEL, sendsOf, serverSince, typeDraft, waitForComposerText } from '../support/chat';
import { pageRpc } from '../support/extension';
import { useFakeHub } from '../support/fake-hub';
import { useNetworkTrap } from '../support/network-trap';
import { ours, oursExists, oursFocus, oursText, readOurs, waitOursText } from '../support/ours';
import { inBrowser, startSecondBrowser } from '../support/second';
import { dockIs, startShift, type Shift } from '../support/shift';
import { callStand, foreignCalls, STAND_IDS, standServer, waitForChatReady } from '../support/stand';

const ACC = STAND_IDS.accounts.a;
const { a1, a2 } = STAND_IDS.fans;
const reply = (fan: string): readonly [string, string] => [`Hey you, thanks for writing! @${fan}`, `How was your day? @${fan}`];

describe('§12 п. 4 on the wired extension — the keys: ours before ChatSpace’s editor, ChatSpace’s own left alone, and our closed roots', () => {
  useNetworkTrap();
  const { hub } = useFakeHub();
  let journalStart = 0;
  let windows: WebdriverIO.Browser | null = null;
  let shift: Shift;

  const route = async (): Promise<string | null> => (await callStand('route')).chatId;
  const overlays = async (): Promise<readonly string[]> => (await dockIs(() => true, 'the dock')).overlays;
  const waitOverlays = async (wanted: readonly string[], message: string): Promise<void> => {
    let last: readonly string[] = [];
    try {
      await browser.waitUntil(
        async () => {
          last = await overlays();
          return JSON.stringify([...last].sort()) === JSON.stringify([...wanted].sort());
        },
        { timeout: 10_000, interval: 100 },
      );
    } catch {
      throw new Error(`${message}: our open windows are ${JSON.stringify(last)}, not ${JSON.stringify(wanted)}`);
    }
  };
  const marks = async (fan: string): Promise<Readonly<Record<string, boolean>>> => (await callStand('composerState', ACC, fan))?.marks ?? {};
  /** The chats of ChatSpace's own list, top to bottom, as the page shows them. */
  const chatList = (): Promise<string[]> => browser.execute(() => [...document.querySelectorAll<HTMLElement>('[data-stand-chat-scope] [data-chat-id], [data-chat-id]')].map((node) => node.dataset['chatId'] ?? '').filter((id, index, all) => id !== '' && all.indexOf(id) === index));
  const pageEvents = async (mark: number, type: string): Promise<number> => (await pageJournal(mark)).filter((entry) => entry.type === type).length;
  /** The focus on a part of ours, as Tab and the arrows put it there. Not a click: a click on a part inserts it (UI-018, X26). */
  const focusPart = async (index: number): Promise<void> => {
    const focused = await readOurs('dock', `[data-cg-part="${index}"]`, (node) => {
      node.focus();
      return true;
    });
    expect(focused).toBe(true);
    expect((await oursFocus('dock'))?.label).toBe(`Часть ${index + 1}`);
  };

  before(async () => {
    await standServer.reset();
    journalStart = await standServer.mark();
    await hub().command({ op: 'config', patch: { aiNameFan: true } });
    shift = await startShift(hub(), { settings: { generation: { split: true } }, viewport: { width: 1440, height: 900 } });
    await dockIs((d) => d.status === 'ready' && d.actions['reply'] === true, 'the dock of the open chat is ready');
  });

  after(async () => {
    await windows?.deleteSession();
    expect(foreignCalls((await standServer.journal(journalStart)).entries)).toEqual([]);
  });

  describe('in ChatSpace’s own message field', () => {
    it('[HK-002] [HK-003] [HK-028] ⌘E and ⌘I over a selection start Reply and Fix: TipTap toggles neither inline code nor italic, and a single-part Fix replaces the draft', async () => {
      // X68 only inserts a single-part Fix automatically; a Split Fix intentionally keeps its parts in the sheet.
      await shift.patch({ generation: { split: false } });
      const hubMark = await hub().mark();
      await typeDraft('some words of mine');
      await browser.keys([MOD, 'a']);
      await browser.keys([MOD, 'e']);
      await dockIs((d) => d.result?.feature === 'reply' && d.result.state === 'done', 'Reply ran by its key', 20_000);
      expect(await marks(a1)).toMatchObject({ code: false, italic: false });
      await browser.keys([MOD, 'i']);
      // X68: Fix by its key, as by its click — the fixed text replaces the draft by itself, plain text in the field.
      await waitForComposerText(ACC, a1, `Here is a smoother version of your draft. @${a1}`, 'Fix ran by its key and replaced the draft', 20_000);
      expect(await marks(a1)).toMatchObject({ code: false, italic: false });
      // Without us the same keys wrap the selection in <code> and <em> (stand-fixture.e2e.ts).
      expect((await callStand('composerState', ACC, a1))?.html).not.toMatch(/<code>|<em>/);
      expect(callsTo((await hub().journal(hubMark)).entries, 'aiFeatureStream').map((call) => (call.request as { feature?: string }).feature)).toEqual(['fast-reply', 'improve-draft']);
      await shift.patch({ generation: { split: true } });
    });

    it('[HK-026] a key that is not ours is ChatSpace’s as before: ⌘B makes the selection bold, and nothing of ours starts', async () => {
      const hubMark = await hub().mark();
      const before = (await dockIs(() => true, 'the dock')).result?.opId;
      await browser.keys([MOD, 'b']);
      expect(await marks(a1)).toMatchObject({ bold: true });
      await browser.keys([MOD, 'b']);
      expect(await marks(a1)).toMatchObject({ bold: false });
      expect((await dockIs(() => true, 'the dock')).result?.opId).toBe(before);
      expect(callsTo((await hub().journal(hubMark)).entries, 'aiFeatureStream')).toEqual([]);
    });
  });

  describe('with the focus inside our closed roots', () => {
    before(async () => {
      // Fix above now replaces the draft (X68). Give this insert/undo scenario its own text to restore.
      await clearDraft();
      await typeDraft('some words of mine');
      // A Reply with its parts in the dock of the first chat: something of ours to stand on.
      await browser.keys([MOD, 'e']);
      await dockIs((d) => d.result?.feature === 'reply' && d.result.state === 'done' && d.result.parts === 2, 'a Reply with two parts', 20_000);
    });

    it('[HK-030] Enter on a part of ours is «Вставить»: the part replaces the person’s words by that key (X45), Ctrl/⌘+Z in the field brings them back, and ChatSpace sends nothing', async () => {
      const standMark = await standServer.mark();
      const page = await pageJournalMark();
      await focusPart(0);
      await browser.keys(Key.Enter);
      // The field held the person's own words: the key is the consent (decision X45), no question.
      await waitForComposerText(ACC, a1, reply(a1)[0], 'the part replaced the person’s words');
      expect(await oursExists('dock', '.cg-confirm')).toBe(false);
      // The insert left the focus in ChatSpace's field (UI-019): the person's own undo there restores their words.
      await browser.keys([MOD, 'z']);
      await waitForComposerText(ACC, a1, 'some words of mine', 'the undo restored the person’s words');
      // A held Enter after the insert, and the undo, reached ChatSpace's editor as no send.
      await browser.pause(400);
      expect(sendsOf(await serverSince(standMark))).toEqual([]);
      expect(await pageEvents(page, 'composer-submit')).toBe(0);
      expect(await pageEvents(page, 'queue-added')).toBe(0);
    });

    it('[HK-037] J and K walk ChatSpace’s chat list through its own router — from the page, never from a part of the dock (X44); typed into ChatSpace’s field they are text', async () => {
      const standMark = await standServer.mark();
      const list = await chatList();
      expect(list.length).toBeGreaterThanOrEqual(3);
      // The open chat is far down ChatSpace's list (not on its first page): «next» from it is the list's first chat.
      expect(list.slice(0, 2)).not.toContain(a1);
      // On a part of the dock — where a finished Reply may have put the focus by itself — J, K and ] do nothing:
      // no other fan's chat is opened (on OnlyFans that marks it read), no panel.
      await focusPart(1);
      await browser.keys(['j', 'k', ']']);
      await browser.pause(400);
      expect(await route()).toBe(a1);
      expect(await overlays()).toEqual([]);
      expect(historyLoads(await serverSince(standMark))).toEqual([]);
      // Off the dock (the chat's header): they are the chat list's keys.
      await $('[data-stand-conversation-header]').click();
      await browser.keys(['j']);
      await browser.waitUntil(async () => (await route()) === list[0], { timeout: 5000, timeoutMsg: `J did not open the first chat of the list (${String(list[0])}); the route is ${String(await route())}` });
      await waitForChatReady(ACC, list[0] ?? '');
      await browser.keys(['j']);
      await browser.waitUntil(async () => (await route()) === list[1], { timeout: 5000, timeoutMsg: 'J did not open the next chat of the list' });
      await waitForChatReady(ACC, list[1] ?? '');
      await browser.keys(['k']);
      await browser.waitUntil(async () => (await route()) === list[0], { timeout: 5000, timeoutMsg: 'K did not go back to the previous chat of the list' });
      await waitForChatReady(ACC, list[0] ?? '');
      // Each chat was opened by ChatSpace itself — its router, its own history request — on the person's key.
      const loads = historyLoads(await serverSince(standMark));
      expect(loads.every((entry) => entry.origin === 'native')).toBe(true);
      expect([...new Set(loads.map((entry) => entry.chatId))].sort()).toEqual([list[0], list[1]].sort());
      // The same letters in ChatSpace's message field are letters.
      await typeDraft('jk');
      expect(await composerText(ACC, list[0] ?? '')).toBe('jk');
      expect(await route()).toBe(list[0]);
    });

    it('[HK-039] [HK-034] `]` opens the fan panel and `?` the cheatsheet; [HK-029] Esc closes them one by one and the chat tab stays; then Esc is ChatSpace’s own', async () => {
      await callStand('openChat', ACC, a1);
      await dockIs((d) => d.target?.endsWith(`:${a1}`) === true && d.result !== null, 'back in the first chat, with its result');
      const page = await pageJournalMark();
      // Off the dock: on a part of it `]` does nothing (X44).
      await $('[data-stand-conversation-header]').click();
      await browser.keys([']']);
      await waitOverlays(['fan-panel'], '`]` opens the fan panel');
      await waitOursText('panel', 'Fan Alder', 'the fan panel of the open chat');
      await browser.keys(['?']);
      await waitOverlays(['fan-panel', 'cheatsheet'], '`?` opens the cheatsheet');
      await waitOursText('modal', 'Клавиши ChatGoose', 'the cheatsheet');
      // ChatSpace is told something dismissible of ours is open: its own Esc must not take the chat tab.
      expect(await browser.execute(() => document.querySelectorAll('[data-host="overlay"][data-dismissible-open]').length)).toBeGreaterThan(0);

      await browser.keys(Key.Escape);
      await waitOverlays(['fan-panel'], 'the first Esc closes the cheatsheet');
      await browser.keys(Key.Escape);
      await waitOverlays([], 'the second Esc closes the fan panel');
      // The third Esc hides our result sheet; the chat is still open.
      await browser.keys(Key.Escape);
      await browser.waitUntil(async () => (await dockIs(() => true, 'the dock')).height === 40, { timeout: 5000, timeoutMsg: 'Esc did not hide the result sheet' });
      expect(await route()).toBe(a1);
      expect(await pageEvents(page, 'chat-tab-closed')).toBe(0);
      expect(await browser.execute(() => document.querySelectorAll('[data-dismissible-open]').length)).toBe(0);

      // Nothing of ours is open now: from ChatSpace's field, Esc is ChatSpace's — it closes the chat tab, as before us.
      await typeDraft('');
      await browser.keys(Key.Escape);
      await browser.waitUntil(async () => (await pageEvents(page, 'chat-tab-closed')) === 1, { timeout: 5000, timeoutMsg: 'ChatSpace’s own Esc did not close the chat tab' });
    });

    it('[SP-033] [HK-027] under the Spenders window J/K and the arrows are its rows, Space is the preview, `/` its search; a generation key is refused with the reason', async () => {
      await callStand('openChat', ACC, a2);
      await waitForChatReady(ACC, a2);
      await dockIs((d) => d.status === 'ready' && d.target?.endsWith(`:${a2}`) === true, 'the dock of the second chat');
      const hubMark = await hub().mark();
      const standMark = await standServer.mark();
      await browser.keys([...PANEL, 'm']);
      await waitOursText('modal', 'Fan Alder', 'the board', { timeout: 20_000 });
      // X65: the @handle moved to a tooltip, so the whole row's text repeats the name. Read its name cell.
      const rowName = async (): Promise<string> => (await readOurs('modal', '.cg-bd__row:focus .cg-bd__name', (node) => node.textContent ?? '')) ?? '';
      await browser.waitUntil(async () => (await rowName()) === 'Fan Alder', { timeout: 5000, timeoutMsg: 'the first row of the board does not have the focus' });
      await browser.keys(['j']);
      expect(await rowName()).toBe('Fan Birch');
      await browser.keys(Key.ArrowDown);
      expect(await rowName()).toBe('Fan Cedar');
      await browser.keys(['k']);
      expect(await rowName()).toBe('Fan Birch');
      await browser.keys(Key.ArrowUp);
      expect(await rowName()).toBe('Fan Alder');
      // None of it moved ChatSpace: the chat is the one that was open.
      expect(await route()).toBe(a2);
      // A generation key under our window is taken and refused with its reason — nothing is generated for the chat behind it.
      await browser.keys([MOD, 'e']);
      const said = await waitOursText('toast', 'CG-GATE-OVERLAY', 'the refusal of a generation key under a window');
      expect(said).toContain('сначала закройте открытое окно');
      expect((await dockIs(() => true, 'the dock')).result).toBeNull();
      // Space opens the preview of the row; `/` goes to the board's search.
      await browser.keys(Key.Space);
      await waitOursText('modal', 'Fan Alder', 'the preview of the row under the focus', { selector: '.cg-pv' });
      await browser.keys(['/']);
      await browser.waitUntil(async () => (await oursFocus('modal'))?.label === 'Имя или @handle', { timeout: 5000, timeoutMsg: '`/` did not move the focus to the search field' });
      expect(callsTo((await hub().journal(hubMark)).entries, 'aiFeatureStream')).toEqual([]);
      expect(historyLoads(await serverSince(standMark))).toEqual([]);
    });

    it('[HK-020] [HK-029] what is typed into our search field — two layouts, `]`, `?`, J, K — is text and starts nothing; Esc empties the field, closes the preview, closes the window', async () => {
      const page = await pageJournalMark();
      const typed = 'jk]?Привет ё';
      await browser.keys(typed.split(''));
      await browser.waitUntil(async () => (await ours('modal', '.cg-sp__search input').getValue()) === typed, { timeout: 5000, timeoutMsg: `the search field holds «${await ours('modal', '.cg-sp__search input').getValue()}», not what was typed` });
      // No chat navigation, no fan panel, no cheatsheet; ChatSpace's own field got nothing.
      expect([...(await overlays())].sort()).toEqual(['preview', 'spenders']);
      expect(await route()).toBe(a2);
      expect(await composerText(ACC, a2)).toBe('');
      await browser.keys(Key.Escape);
      await browser.waitUntil(async () => (await ours('modal', '.cg-sp__search input').getValue()) === '', { timeout: 5000, timeoutMsg: 'the first Esc did not empty the search field' });
      expect([...(await overlays())].sort()).toEqual(['preview', 'spenders']);
      await browser.keys(Key.Escape);
      await waitOverlays(['spenders'], 'the second Esc closes the preview');
      await browser.keys(Key.Escape);
      await waitOverlays([], 'the third Esc closes the board');
      expect(await oursExists('modal', '[aria-label="Spenders"]')).toBe(false);
      // Three Esc presses inside our window, and ChatSpace's chat tab is still there.
      expect(await route()).toBe(a2);
      expect(await pageEvents(page, 'chat-tab-closed')).toBe(0);
    });
  });

  describe('«Новые» from the keyboard (decision X55)', () => {
    it('[NF-001] [NF-002] [X55] ⌘⇧U / Ctrl+Alt+U opens «Новые» on the first fan who can be greeted, with the card; J walks and the card follows; Enter is Hi — nothing is sent; the same key closes the window', async () => {
      await callStand('openChat', ACC, a2);
      await waitForChatReady(ACC, a2);
      const hubMark = await hub().mark();
      const standMark = await standServer.mark();
      const list = '[aria-label="Новые подписчики"]';
      await browser.keys([...PANEL, 'u']);
      await waitOursText('modal', 'newfan_', 'the list of new subscribers', { timeout: 20_000, selector: list });
      /** The @handle of the row with the keyboard's focus. */
      const focusedFan = async (): Promise<string> => /@(newfan_\d+)/.exec((await oursFocus('modal'))?.text ?? '')?.[1] ?? '';
      await browser.waitUntil(async () => (await focusedFan()).startsWith('newfan_'), { timeout: 10_000, timeoutMsg: 'no row of the list has the focus' });
      const first = await focusedFan();
      // The card of that fan is open at once: no empty right column, no hint to pick somebody.
      await waitOursText('modal', `@${first}`, 'the card of the first fan', { selector: '.cg-pv', timeout: 20_000 });
      mkdirSync(E2E_EVIDENCE_DIR, { recursive: true });
      // The window's own fade is over before the picture.
      await browser.pause(400);
      await browser.saveScreenshot(`${E2E_EVIDENCE_DIR}suite-keys-newcomers-open.png`);
      await browser.keys(['j']);
      await browser.waitUntil(async () => (await focusedFan()) !== first, { timeout: 5000, timeoutMsg: 'J did not move to the next row' });
      const second = await focusedFan();
      await waitOursText('modal', `@${second}`, 'the card follows the row once the key is up', { selector: '.cg-pv', timeout: 10_000 });
      // Enter on the card's own row is its greeting: Hi of one variant — a draft, nothing sent.
      await browser.keys(Key.Enter);
      await waitOursText('modal', 'Hi and welcome!', 'the greeting of the second fan', { selector: '.cg-pv', timeout: 20_000 });
      expect(await oursText('modal', '.cg-pv')).toContain('черновик · не отправлено');
      await browser.saveScreenshot(`${E2E_EVIDENCE_DIR}suite-keys-newcomers-hi.png`);
      const greetings = callsTo((await hub().journal(hubMark)).entries, 'aiFeatureStream').filter((call) => (call.request as { feature?: string }).feature === 'hi-greeting');
      expect(greetings).toHaveLength(1);
      expect(sendsOf(await serverSince(standMark))).toEqual([]);
      expect(historyLoads(await serverSince(standMark))).toEqual([]);
      // The same key closes it, wherever the focus is inside the window; the chat behind it is still the one open.
      await browser.keys([...PANEL, 'u']);
      await waitOverlays([], 'the second ⌘⇧U closes «Новые»');
      expect(await route()).toBe(a2);
    });
  });

  describe('⌘E → Enter → Enter → Enter → Enter: the next part takes the focus (decision X44)', () => {
    const { a4 } = STAND_IDS.fans;
    /** The focus is in ChatSpace's message field of the open chat. */
    const inComposer = (): Promise<boolean> => browser.execute(() => (document.activeElement?.closest('.composer-frame') ?? null) !== null);
    const waitPartFocus = async (label: string, message: string): Promise<void> => {
      await browser.waitUntil(async () => (await oursFocus('dock'))?.label === label, { timeout: 10_000, timeoutMsg: `${message}: the focus is on ${JSON.stringify(await oursFocus('dock'))}` });
    };

    before(async () => {
      await callStand('openChat', ACC, a4);
      await waitForChatReady(ACC, a4);
      await dockIs((d) => d.status === 'ready' && d.target?.endsWith(`:${a4}`) === true, 'the dock of a chat with an empty field');
    });

    it('[UI-023] [UI-019] over the empty field the finished Reply hands the focus to part 1; Enter inserts it, Enter in the field sends it, part 2 takes the focus, Enter, Enter — two sends, both ChatSpace’s own', async () => {
      const standMark = await standServer.mark();
      const page = await pageJournalMark();
      await typeDraft('');
      expect(await inComposer()).toBe(true);
      await browser.keys([MOD, 'e']);
      await dockIs((d) => d.result?.feature === 'reply' && d.result.state === 'done' && d.result.parts === 2 && d.target?.endsWith(`:${a4}`) === true, 'a Reply with two parts', 20_000);
      await waitPartFocus('Часть 1', 'the finished Reply did not hand the focus to its first part');
      // The focus alone wrote nothing.
      expect(await composerText(ACC, a4)).toBe('');
      await browser.keys(Key.Enter);
      await waitForComposerText(ACC, a4, reply(a4)[0], 'Enter on the focused part inserts it');
      // UI-019: the insert put the focus into the field — and not yet on the next part.
      await browser.waitUntil(inComposer, { timeout: 5000, timeoutMsg: 'the insert did not put the focus into ChatSpace’s field' });
      expect(await oursFocus('dock')).toBeNull();
      await browser.keys(Key.Enter);
      await waitForComposerText(ACC, a4, '', 'Enter in ChatSpace’s field sends the part');
      await waitPartFocus('Часть 2', 'the send did not hand the focus to the second part');
      await browser.keys(Key.Enter);
      await waitForComposerText(ACC, a4, reply(a4)[1], 'Enter on the second part inserts it');
      await browser.waitUntil(inComposer, { timeout: 5000, timeoutMsg: 'the second insert did not put the focus into ChatSpace’s field' });
      await browser.keys(Key.Enter);
      await waitForComposerText(ACC, a4, '', 'Enter in ChatSpace’s field sends the second part');
      await browser.waitUntil(async () => sendsOf(await serverSince(standMark), a4).length === 2, { timeout: 10_000, timeoutMsg: 'ChatSpace did not send both parts' });
      // Every send was ChatSpace's own, from its field and through its own queue — the person's two Enter presses there.
      expect(sendsOf(await serverSince(standMark), a4).map((entry) => [entry.origin, entry.detail?.['plain']])).toEqual(reply(a4).map((text) => ['native', text]));
      expect(await pageEvents(page, 'queue-added')).toBe(2);
      // Nothing is left to hand the focus to: it stays in the field.
      await browser.pause(400);
      expect(await inComposer()).toBe(true);
    });

    it('[UI-023] a person typing in the field keeps the focus there: the Reply finished over their words takes nothing, nor does the field they empty', async () => {
      const { a5 } = STAND_IDS.fans;
      await callStand('openChat', ACC, a5);
      await waitForChatReady(ACC, a5);
      await dockIs((d) => d.status === 'ready' && d.target?.endsWith(`:${a5}`) === true, 'the dock of another chat');
      await typeDraft('my own line');
      await browser.keys([MOD, 'e']);
      await dockIs((d) => d.result?.feature === 'reply' && d.result.state === 'done' && d.target?.endsWith(`:${a5}`) === true, 'a Reply over the person’s words', 20_000);
      await browser.pause(400);
      expect(await oursFocus('dock')).toBeNull();
      expect(await inComposer()).toBe(true);
      await browser.keys(' x'.split(''));
      await waitForComposerText(ACC, a5, 'my own line x', 'what is typed goes on into the field');
      await clearDraft();
      await waitForComposerText(ACC, a5, '', 'the person empties the field');
      await browser.pause(400);
      expect(await oursFocus('dock')).toBeNull();
      expect(await inComposer()).toBe(true);
    });
  });

  describe('the Alt-hold quick jump under the owner’s `navigation` switch (X45)', () => {
    const popup = (): Promise<boolean> => oursExists('modal', '[data-cg-quickjump]');
    /** The background reads the owner's switches again (as its 5-minute refresh does); the tab hears `bootstrap.changed`. */
    const setNavigation = async (on: boolean): Promise<void> => {
      await hub().command({ op: 'config', patch: pilotPageFlags({ navigation: on }) });
      await shift.toPages();
      try {
        expect(await pageRpc('bootstrap.get', { force: true })).toMatchObject({ ok: true });
      } finally {
        await shift.toStand();
      }
    };
    /** Alt goes down alone, outside any field, and stays down past the 400 ms of the hold. */
    const hold = async (): Promise<void> => {
      await $('[data-stand-conversation-header]').click();
      await browser.action('key').down(Key.Alt).pause(900).perform(true);
    };
    const letGo = (): Promise<void> => browser.action('key').up(Key.Alt).perform();

    after(async () => {
      await browser.releaseActions();
      await hub().command({ op: 'config', patch: pilotPageFlags({ navigation: true }) });
    });

    it('[NEW-07] [HK-037] `navigation` on: the hold opens «Быстрый переход» with the chats of ChatSpace’s list, letting go closes it. `navigation` off for the page: the hold opens nothing and says nothing, Alt+2 and J are refused aloud, no chat is opened; on again — the popup is back', async function () {
      this.timeout(120_000);
      const here = await route();
      await hold();
      await browser.waitUntil(popup, { timeout: 5000, timeoutMsg: 'the quick jump did not open under a held Alt with `navigation` on' });
      expect(await overlays()).toEqual(['quick-jump']);
      const shown = await oursText('modal', '[data-cg-quickjump]');
      expect(shown).toContain('Быстрый переход');
      expect(shown).toMatch(/Fan \w+/);
      await letGo();
      await waitOverlays([], 'letting Alt go closes the quick jump');
      expect(await popup()).toBe(false);

      // The owner leaves `navigation` off for the page — the live case of 2026-10-07.
      await setNavigation(false);
      await dockIs((d) => d.status === 'ready', 'the dock after the owner’s switches were read again', 20_000);
      const standMark = await standServer.mark();
      await hold();
      await browser.pause(600);
      expect(await popup()).toBe(false);
      expect(await overlays()).toEqual([]);
      // A hold is not a command: nothing is said about it.
      expect(await oursText('toast')).not.toContain('CG-FEATURE-DISABLED');
      // A digit under the held modifier is one, and it is refused with the reason — no chat opens.
      await browser.action('key').down('2').up('2').perform(true);
      await waitOursText('toast', 'CG-FEATURE-DISABLED', 'Alt+2 on a page without `navigation` says why it does nothing');
      await letGo();
      expect(await popup()).toBe(false);
      await browser.keys(['j']);
      await browser.pause(500);
      expect(await route()).toBe(here);
      expect(historyLoads(await serverSince(standMark))).toEqual([]);

      // Switched on again: the same hold opens the popup, without a reload of the tab.
      await setNavigation(true);
      await hold();
      await browser.waitUntil(popup, { timeout: 5000, timeoutMsg: 'the quick jump did not come back with `navigation` on again' });
      await letGo();
      await waitOverlays([], 'the quick jump closed');
      expect(await route()).toBe(here);
    });
  });

  describe('the Windows scheme, in a browser that runs on Windows', () => {
    it('[HK-008] [HK-031] Ctrl+Alt+S is Recap, and ChatSpace’s translator — which listens for Alt+S with any modifiers — does not flip; plain Alt+S is still the translator’s', async function () {
      this.timeout(180_000);
      // Firefox is told it runs on Windows: the page and the extension both read `navigator.platform`.
      windows = await startSecondBrowser({ 'general.platform.override': 'Win32' });
      await inBrowser(windows, async () => {
        await startShift(hub(), { world: false, viewport: { width: 1440, height: 900 } });
        await dockIs((d) => d.status === 'ready' && d.actions['reply'] === true, 'the dock in the Windows browser');
        expect(await browser.execute(() => navigator.platform)).toBe('Win32');
        const translatorOn = (): Promise<boolean> =>
          browser.execute((account: string) => {
            const key = Object.keys(localStorage).find((name) => name.startsWith('chat-space:composer-translator:accounts:'));
            const stored = key === undefined ? null : (JSON.parse(localStorage.getItem(key) ?? 'null') as Record<string, { enabled?: boolean }> | null);
            return stored?.[account]?.enabled === true;
          }, ACC);
        const page = await pageJournalMark();
        await typeDraft('');
        // The strip prints the Windows keys.
        expect(await oursText('dock', '.cg-strip')).toContain('Ctrl');
        await browser.keys([Key.Control, Key.Alt, 's']);
        await dockIs((d) => d.analysis === 'recap', 'Ctrl+Alt+S opened Recap');
        expect(await translatorOn()).toBe(false);
        expect(await pageEvents(page, 'translator-toggled')).toBe(0);
        await browser.keys(Key.Escape);
        await dockIs((d) => d.analysis === null, 'the Recap sheet is hidden');
        // Plain Alt+S is not ours: ChatSpace's translator takes it as before.
        await typeDraft('');
        await browser.keys([Key.Alt, 's']);
        await browser.waitUntil(translatorOn, { timeout: 5000, timeoutMsg: 'ChatSpace’s own Alt+S did not flip the translator' });
        expect((await dockIs(() => true, 'the dock')).analysis).toBeNull();
        await callStand('setTranslator', ACC, { enabled: false });
      });
    });
  });
});
