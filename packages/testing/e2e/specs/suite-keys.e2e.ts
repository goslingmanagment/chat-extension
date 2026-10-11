// §12 п. 4 on the wired extension, part 6 — the keys (architecture.md §9.1):
// the TEST build on the stand against the fake hub, real key presses, the
// real windows and panels of ours. The dispatcher's own decisions have their
// spec on its seams (hotkeys.e2e.ts, with stand-in surfaces); here every key
// lands in the real dock, Spenders, fan panel, cheatsheet and palette.
// - in ChatSpace's message field our keys are ours before its editor sees
//   them: ⌘E / ⌘I start Reply and Fix, TipTap toggles neither inline code nor
//   italic; a key that is not ours (⌘B) is untouched;
// - with the focus on a part of ours J/K walk ChatSpace's chat list through
//   its own router, `]` opens the fan panel, `?` the cheatsheet; typed into
//   ChatSpace's field the same letters are text;
// - Esc closes OUR windows one by one and the chat tab stays; with nothing of
//   ours open Esc is ChatSpace's own again;
// - under the Spenders window J/K and the arrows move its rows, Space opens
//   the preview, `/` goes to its search; a generation key is refused with its
//   reason; what is typed into its search field — two layouts, `]`, `?` — is
//   text and starts nothing;
// - Enter on a part of ours is «Вставить»: ChatSpace sends nothing;
// - ⌘/Ctrl held alone opens «Быстрый переход» only where the owner's
//   `navigation` is on for the page: with it off the hold opens nothing and
//   says nothing, ⌘1–9 and J are refused aloud, and no chat is opened;
// - a browser on Windows (a second Firefox that says so): Ctrl+Alt+S is
//   Recap and ChatSpace's translator, which listens for Alt+S, does not flip.

import { $, browser, expect } from '@wdio/globals';
import { Key } from 'webdriverio';

import { pilotPageFlags } from '../../src/fake-hub/config';
import { callsTo } from '../../src/fake-hub/journal';
import { composerText, historyLoads, MOD, pageJournal, pageJournalMark, PANEL, sendsOf, serverSince, typeDraft, waitForComposerText } from '../support/chat';
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
    it('[HK-002] [HK-003] [HK-028] ⌘E and ⌘I over a selection start Reply and Fix: TipTap toggles neither inline code nor italic, and the draft is the person’s as it was', async () => {
      const hubMark = await hub().mark();
      await typeDraft('some words of mine');
      await browser.keys([MOD, 'a']);
      await browser.keys([MOD, 'e']);
      await dockIs((d) => d.result?.feature === 'reply' && d.result.state === 'done', 'Reply ran by its key', 20_000);
      expect(await marks(a1)).toMatchObject({ code: false, italic: false });
      await browser.keys([MOD, 'i']);
      await dockIs((d) => d.result?.feature === 'fix' && d.result.state === 'done', 'Fix ran by its key', 20_000);
      expect(await marks(a1)).toMatchObject({ code: false, italic: false });
      // Without us the same keys wrap the selection in <code> and <em> (stand-fixture.e2e.ts).
      expect((await callStand('composerState', ACC, a1))?.html).toBe('<p>some words of mine</p>');
      expect(callsTo((await hub().journal(hubMark)).entries, 'aiFeatureStream').map((call) => (call.request as { feature?: string }).feature)).toEqual(['fast-reply', 'improve-draft']);
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
      // A Reply with its parts in the dock of the first chat: something of ours to stand on.
      await browser.keys([MOD, 'e']);
      await dockIs((d) => d.result?.feature === 'reply' && d.result.state === 'done' && d.result.parts === 2, 'a Reply with two parts', 20_000);
    });

    it('[HK-030] Enter on a part of ours is «Вставить»: the part goes into ChatSpace’s field only by the person’s own answer, and ChatSpace sends nothing', async () => {
      const standMark = await standServer.mark();
      const page = await pageJournalMark();
      const asked = 'В поле ввода уже есть ваш текст.';
      await focusPart(0);
      await browser.keys(Key.Enter);
      // The field holds the person's own words: Enter asked first (Б2), with the focus on «Отмена» (X18) — Enter again changes nothing.
      await waitOursText('dock', asked, 'the question about the person’s own text');
      expect((await oursFocus('dock'))?.text).toMatch(/^Отмена/);
      await browser.keys(Key.Enter);
      await waitOursText('dock', asked, 'the question is gone after Enter on «Отмена»', { gone: true });
      expect(await composerText(ACC, a1)).toBe('some words of mine');
      // The focus is back on «Вставить» of that part: Enter asks again, Shift+Tab goes to «Добавить в конец», Enter there adds the part.
      expect((await oursFocus('dock'))?.text).toMatch(/^Вставить/);
      await browser.keys(Key.Enter);
      await waitOursText('dock', asked, 'the question, asked again');
      expect((await oursFocus('dock'))?.text).toMatch(/^Отмена/);
      await browser.keys([Key.Shift, Key.Tab]);
      expect((await oursFocus('dock'))?.text).toBe('Добавить в конец');
      await browser.keys(Key.Enter);
      await waitForComposerText(ACC, a1, `some words of mine\n${reply(a1)[0]}`, 'the part is added to the person’s words');
      // Four Enter presses inside our root, and not one reached ChatSpace's editor as a send.
      await browser.pause(400);
      expect(sendsOf(await serverSince(standMark))).toEqual([]);
      expect(await pageEvents(page, 'composer-submit')).toBe(0);
      expect(await pageEvents(page, 'queue-added')).toBe(0);
    });

    it('[HK-037] J and K with the focus on a part of ours walk ChatSpace’s chat list through its own router; typed into ChatSpace’s field they are text', async () => {
      const standMark = await standServer.mark();
      const list = await chatList();
      expect(list.length).toBeGreaterThanOrEqual(3);
      // The open chat is far down ChatSpace's list (not on its first page): «next» from it is the list's first chat.
      expect(list.slice(0, 2)).not.toContain(a1);
      await focusPart(1);
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
      await focusPart(1);
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
      const rowName = async (): Promise<string> => (await oursFocus('modal'))?.text.split('@')[0] ?? '';
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

  describe('the ⌘-hold quick jump under the owner’s `navigation` switch', () => {
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
    /** ⌘/Ctrl goes down alone, outside any field, and stays down past the 400 ms of the hold. */
    const hold = async (): Promise<void> => {
      await $('[data-stand-conversation-header]').click();
      await browser.action('key').down(MOD).pause(900).perform(true);
    };
    const letGo = (): Promise<void> => browser.action('key').up(MOD).perform();

    after(async () => {
      await browser.releaseActions();
      await hub().command({ op: 'config', patch: pilotPageFlags({ navigation: true }) });
    });

    it('[NEW-07] [HK-037] `navigation` on: the hold opens «Быстрый переход» with the chats of ChatSpace’s list, letting go closes it. `navigation` off for the page: the hold opens nothing and says nothing, ⌘2 and J are refused aloud, no chat is opened; on again — the popup is back', async function () {
      this.timeout(120_000);
      const here = await route();
      await hold();
      await browser.waitUntil(popup, { timeout: 5000, timeoutMsg: 'the quick jump did not open under a held ⌘/Ctrl with `navigation` on' });
      expect(await overlays()).toEqual(['quick-jump']);
      const shown = await oursText('modal', '[data-cg-quickjump]');
      expect(shown).toContain('Быстрый переход');
      expect(shown).toMatch(/Fan \w+/);
      await letGo();
      await waitOverlays([], 'letting ⌘/Ctrl go closes the quick jump');
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
      await waitOursText('toast', 'CG-FEATURE-DISABLED', '⌘2 on a page without `navigation` says why it does nothing');
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
