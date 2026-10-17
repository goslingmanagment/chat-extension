// R17 on the R02 stand (architecture.md §9.1, §12 п. 4 «хоткеи»): the early
// key dispatcher in headless Firefox — R09's MAIN bridge in the page's realm,
// the dispatcher with its closed shadow roots in a WebDriver BiDi sandbox
// (support/input-harness.ts), registered before any script of the page, the
// way the isolated content script is at document_start.
//
// Negative checks, against the stand's own TipTap, translator and Esc: with
// our keys the native action must NOT happen; with a key that is not ours it
// must still happen. Inside our closed roots: J/K, `]`, `?`, Enter, Esc and
// typing. The last test is the delivery probe behind docs/hotkeys-delivery.md:
// which combinations of both schemes reach a capture listener of the page
// (it writes .cache/e2e/hotkeys-delivery.json). WebDriver's keys are
// synthetic: they prove a combination CAN reach the page and that we cancel
// it there, never that the browser or the OS gives a real one up.
// Test titles carry the parity rows they prove.

import { mkdirSync, writeFileSync } from 'node:fs';

import { EXTRA_KEYS, schemeActions } from '@cg/core/domain/hotkeys';
import { browser, expect } from '@wdio/globals';
import { Key } from 'webdriverio';

import { budgetMs } from '../../src/e2e-timing';
import type { PageJournalEntry } from '../../fixture-chatspace/src/protocol';
import { E2E_EVIDENCE_DIR } from '../../src/stand/paths';
import { input, inputLog, installInputHarness, type InstalledInputHarness, type ReachedKey } from '../support/input-harness';
import { useNetworkTrap } from '../support/network-trap';
import { callStand, chatPath, foreignCalls, openStand, STAND_IDS, standServer, waitForChatReady } from '../support/stand';

const ACC = STAND_IDS.accounts.a;
const { a1, a2 } = STAND_IDS.fans;
/** The host system's scheme: ⌘ on macOS, Ctrl elsewhere — also TipTap's Mod. */
const MAC = process.platform === 'darwin';
/** `Key.Control` is the physical Ctrl everywhere; WebdriverIO's `Key.Ctrl` turns into ⌘ on macOS. */
const MOD = MAC ? Key.Command : Key.Control;
const PANEL = MAC ? [Key.Command, Key.Shift] : [Key.Control, Key.Alt];
/** A lone modifier going down: never taken from anybody. */
const MODIFIER = /:(Meta|Control|Shift|Alt|OS):/;
/** The shown chat tab's slot (v-show sets display: none on the others). */
const ACTIVE_EDITOR = '[data-stand-composer-slot]:not([style*="display: none"]) .ProseMirror';

async function pageMark(): Promise<number> {
  return (await callStand('journal')).at(-1)?.seq ?? 0;
}

async function pageJournal(since: number, type: string): Promise<PageJournalEntry[]> {
  return (await callStand('journal', since)).filter((entry) => entry.type === type);
}

/** Opens a stand path with ChatSpace's own local state cleared and waits for the dispatcher and the dock. */
async function open(path: string): Promise<void> {
  await browser.execute(() => {
    try {
      for (const key of Object.keys(localStorage)) if (key.startsWith('chat-space:')) localStorage.removeItem(key);
    } catch {
      // about:blank before the first stand page
    }
  });
  await openStand(path);
  const ready = await input<{ ready: boolean }>('ready');
  if (!ready.ready) throw new Error('input harness not ready');
  await browser.waitUntil(async () => (await input<{ kind: string }>('dock')).kind === 'in-flow', { timeout: 10_000, timeoutMsg: 'the dock host did not dock above the composer' });
  await input('clear');
}

async function inComposer(): Promise<void> {
  await $(ACTIVE_EDITOR).click();
  expect(await input<string>('focusKind')).toBe('composer');
}

async function focusOurs(target: 'dock-card' | 'dock-field' | 'overlay-card' | 'overlay-field'): Promise<void> {
  const result = await input<{ found: boolean; focus: string }>('focus', target);
  expect([target, result.found, result.focus]).toEqual([target, true, target.endsWith('field') ? 'ours-field' : 'ours']);
}

const composer = async (fan: string): Promise<{ text: string; html: string; marks: Readonly<Record<string, boolean>> } | null> => callStand('composerState', ACC, fan);
const translatorOn = (): Promise<boolean> =>
  browser.execute((account: string) => {
    const key = Object.keys(localStorage).find((name) => name.startsWith('chat-space:composer-translator:accounts:'));
    const stored = key === undefined ? null : (JSON.parse(localStorage.getItem(key) ?? 'null') as Record<string, { enabled?: boolean }> | null);
    return stored?.[account]?.enabled === true;
  }, ACC);

describe('R17 — the early key dispatcher on the stand', () => {
  useNetworkTrap();
  let journalStart = 0;
  let installed: InstalledInputHarness | null = null;

  before(async () => {
    await standServer.reset();
    journalStart = await standServer.mark();
    installed = await installInputHarness();
  });

  after(async () => {
    await installed?.remove();
    // §12 «Гейт безопасности»: keys never made a request of ours to the host.
    expect(foreignCalls((await standServer.journal(journalStart)).entries)).toEqual([]);
  });

  describe('against ChatSpace\'s own keys', () => {
    beforeEach(async () => {
      await open(chatPath(ACC, a1));
    });

    it('[HK-023] [HK-024] the dispatcher listens from document_start — before any listener of the page', async () => {
      const ready = await input<{ ready: boolean; platform: string; readyStateAtStart: string }>('ready');
      expect(ready).toEqual({ ready: true, platform: MAC ? 'mac' : 'win', readyStateAtStart: 'loading' });
      expect(await input('dock')).toMatchObject({ kind: 'in-flow', connected: true });
    });

    it('[HK-002] [HK-003] ⌘E / ⌘I in the message field start Reply and Fix: TipTap toggles neither inline code nor italic', async () => {
      await inComposer();
      await browser.keys([MOD, 'e']);
      await browser.keys(['x']);
      await browser.keys([MOD, 'i']);
      await browser.keys(['y']);
      const state = await composer(a1);
      // Without the dispatcher the same keys give <code>x</code><em>y</em> (stand-fixture.e2e.ts).
      expect(state?.html).toBe('<p>xy</p>');
      expect(state?.marks).toMatchObject({ italic: false, code: false });
      const log = await inputLog();
      expect(log.ran).toEqual(['reply@dock', 'fix@dock']);
      expect(log.stats).toMatchObject({ claimed: 2, isolated: 0, untrusted: 0 });
      // §11: no synchronous handler of ours above 16 ms (the 2 ms budget is a p95 measured in the field by
      // `handlerMs`; the slowest one of a cold page includes the first compile and is not a stable number).
      console.log(`hotkeys: handler max ${log.stats.maxHandlerMs.toFixed(3)} ms (limit < ${budgetMs(16)} ms)`);
      expect(log.stats.maxHandlerMs).toBeLessThan(budgetMs(16));
    });

    it('[HK-004] [HK-005] [HK-006] [HK-008] Hi, Ping, Cancel and Recap are taken too: no strikethrough from ⌘⇧S', async () => {
      await inComposer();
      await browser.keys([MOD, 'g']);
      await browser.keys([MOD, 'p']);
      await browser.keys([MOD, '.']);
      await browser.keys([...PANEL, 's']);
      await browser.keys(['z']);
      const state = await composer(a1);
      expect(state?.html).toBe('<p>z</p>');
      expect(state?.marks).toMatchObject({ strike: false });
      expect((await inputLog()).ran).toEqual(['hi@dock', 'ping@dock', 'cancel@dock', 'recap@dock']);
      // Every one of them ended up cancelled: no find-next, no print dialog, no screenshot tool.
      const keys = (await input<ReachedKey[]>('reached')).filter((key) => (key.meta || key.ctrl) && key.code.startsWith('Key'));
      expect(keys.map((key) => [key.code, key.prevented])).toEqual([['KeyG', true], ['KeyP', true], ['KeyS', true]]);
    });

    it('[HK-026] negative: keys that are not ours are untouched — ⌘B makes bold, Alt+S flips the translator, Enter sends', async () => {
      await inComposer();
      await browser.keys([MOD, 'b']);
      await browser.keys(['b']);
      expect((await composer(a1))?.html).toBe('<p><strong>b</strong></p>');
      expect(await translatorOn()).toBe(false);
      await browser.keys([Key.Alt, 's']);
      expect(await translatorOn()).toBe(true);
      await callStand('setTranslator', ACC, { enabled: false });
      const mark = await standServer.mark();
      await browser.keys(Key.Enter);
      await browser.waitUntil(async () => (await standServer.journal(mark)).entries.some((entry) => entry.kind === 'send'), { timeout: 5000, timeoutMsg: 'ChatSpace\'s own Enter did not send' });
      const log = await inputLog();
      expect([log.ran, log.refused, log.stats.claimed, log.stats.isolated]).toEqual([[], [], 0, 0]);
    });

    it('[HK-029] Esc with nothing of ours open is ChatSpace\'s: the chat tab closes as before', async () => {
      await callStand('openChat', ACC, a2, { newTab: true });
      await waitForChatReady(ACC, a2);
      const page = await pageMark();
      await inComposer();
      await browser.keys(Key.Escape);
      await browser.waitUntil(async () => (await callStand('route')).chatId === a1, { timeout: 5000, timeoutMsg: 'ChatSpace\'s own Esc did not close the chat tab' });
      expect(await pageJournal(page, 'chat-tab-closed')).toHaveLength(1);
      expect((await inputLog()).ran).toEqual([]);
    });

    it('[HK-029] Esc with our window open closes OUR window: the chat tab stays — from the message field and from inside the window', async () => {
      await callStand('openChat', ACC, a2, { newTab: true });
      await waitForChatReady(ACC, a2);
      const page = await pageMark();
      expect(await input('overlay', 'palette', true)).toEqual({ open: ['palette'], dismissible: true });
      // The host of our open window carries ChatSpace's own «something dismissible is open» mark.
      expect(await browser.execute(() => document.querySelectorAll('[data-host="overlay"][data-dismissible-open]').length)).toBe(1);
      await inComposer();
      await browser.keys(Key.Escape);
      expect((await inputLog()).overlays).toEqual([]);
      expect((await callStand('route')).chatId).toBe(a2);

      // The focus is inside our window: its own field takes the first Esc, the window closes on the second.
      await input('overlay', 'spenders', true);
      await focusOurs('overlay-field');
      await browser.keys(['a', 'b']);
      expect(await input('fieldValue', 'overlay-field')).toBe('ab');
      await browser.keys(Key.Escape);
      expect(await input('fieldValue', 'overlay-field')).toBe('');
      expect((await inputLog()).overlays).toEqual(['spenders']);
      await browser.keys(Key.Escape);
      const log = await inputLog();
      expect(log.overlays).toEqual([]);
      expect(log.ran).toEqual(['close@global', 'close@global']);
      expect(log.ui.filter((entry) => entry.includes('Escape'))).toEqual(['overlay-field:Escape:delivered', 'overlay-field:Escape:delivered']);
      // Three Esc presses, and ChatSpace's chat tab is still there.
      expect(await pageJournal(page, 'chat-tab-closed')).toEqual([]);
      expect(await pageJournal(page, 'hotkey-last-resort-skipped')).toEqual([]);
      expect((await callStand('route')).chatId).toBe(a2);
      expect(await browser.execute(() => document.querySelectorAll('[data-dismissible-open]').length)).toBe(0);
    });
  });

  describe('the Windows scheme: Ctrl+Alt+S against OnlyMonster\'s translator', () => {
    it('[HK-008] Ctrl+Alt+S is Recap and the translator does not flip; plain Alt+S is still the translator\'s', async () => {
      await open(`${chatPath(ACC, a1)}?cg-keys=win`);
      expect((await input<{ platform: string }>('ready')).platform).toBe('win');
      await inComposer();
      const page = await pageMark();
      // The translator's capture listener on the composer root takes Alt+S «with any other modifiers».
      await browser.keys([Key.Control, Key.Alt, 's']);
      expect(await translatorOn()).toBe(false);
      expect(await pageJournal(page, 'translator-toggled')).toEqual([]);
      expect((await inputLog()).ran).toEqual(['recap@dock']);
      await browser.keys([Key.Control, Key.Alt, 'o']);
      await browser.keys([Key.Control, Key.Alt, 'h']);
      const log = await inputLog();
      expect(log.ran).toEqual(['recap@dock', 'tone@dock']);
      // ⌘⇧H / Ctrl+Alt+H: Help is removed — the key is ours in a chat and answers «пока убран».
      expect(log.refused).toEqual(['help:help-removed']);
      await browser.keys([Key.Alt, 's']);
      expect(await translatorOn()).toBe(true);
      await callStand('setTranslator', ACC, { enabled: false });
      expect((await composer(a1))?.text).toBe('');
    });
  });

  describe('inside our closed roots', () => {
    beforeEach(async () => {
      await open(chatPath(ACC, a1));
    });

    it('[HK-037] [HK-039] [HK-034] J, K, ] and ? on a card of ours outside the dock are chat navigation, the fan panel and the cheatsheet; on the dock\'s card J, K and ] do nothing (X44); typed into a field they are text', async () => {
      // The dock's card — a part that may have taken the focus by itself: a stray letter opens no other fan's chat.
      await focusOurs('dock-card');
      await browser.keys(['j']);
      await browser.keys(['k']);
      await browser.keys([']']);
      expect((await inputLog()).ran).toEqual([]);
      expect((await inputLog()).ui.filter((entry) => !MODIFIER.test(entry))).toEqual(['dock-card:j:delivered', 'dock-card:k:delivered', 'dock-card:]:delivered']);
      await input('clear');
      // A card of a side panel of ours (the fan panel stands open beside the chat): there they run as before.
      await input('overlay', 'fan-panel', true);
      await focusOurs('overlay-card');
      await browser.keys(['j']);
      await browser.keys(['k']);
      await browser.keys([']']);
      await browser.keys(['?']);
      expect((await inputLog()).ran).toEqual(['chat-next@global', 'chat-previous@global', 'fan-panel@dock', 'cheatsheet@global']);
      await input('overlay', 'cheatsheet', false);
      await input('overlay', 'fan-panel', false);
      await input('clear');
      const claimedBefore = (await inputLog()).stats.claimed;

      // Our own field in the dock, then ChatSpace's message field: letters are letters.
      await focusOurs('dock-field');
      await browser.keys(['j', 'k', ']', '?']);
      expect(await input('fieldValue', 'dock-field')).toBe('jk]?');
      await inComposer();
      await browser.keys(['j', 'k', ']', '?']);
      expect((await composer(a1))?.text).toBe('jk]?');
      const log = await inputLog();
      expect([log.ran, log.stats.claimed - claimedBefore]).toEqual([[], 0]);
      expect(log.ui.filter((entry) => entry.startsWith('dock-field'))).toEqual(['dock-field:j:native', 'dock-field:k:native', 'dock-field:]:native', 'dock-field:?:native']);
    });

    it('[SP-033] under a window of ours J/K and the arrows are that window\'s own rows; a generation key is refused with the reason', async () => {
      await input('overlay', 'spenders', true);
      await focusOurs('overlay-card');
      await browser.keys(['j']);
      await browser.keys(['k']);
      await browser.keys(Key.ArrowDown);
      await browser.keys([MOD, 'e']);
      const log = await inputLog();
      // Letters reach the card natively (typing is nobody's business), the arrow as a hand-over; a lone modifier is nobody's key.
      expect(log.ui.filter((entry) => !MODIFIER.test(entry))).toEqual(['overlay-card:j:native', 'overlay-card:k:native', 'overlay-card:ArrowDown:delivered']);
      expect(log.ran).toEqual([]);
      expect(log.refused).toEqual(['reply:overlay-open']);
      await input('overlay', 'spenders', false);
    });

    it('[HK-030] Enter on our card is the card\'s: ChatSpace sends nothing and no listener of the page sees the key', async () => {
      await inComposer();
      await browser.keys(['d', 'r', 'a', 'f', 't']);
      const mark = await standServer.mark();
      const page = await pageMark();
      const seen = await browser.execute(() => {
        const keys: string[] = [];
        (window as unknown as { __r17Keys: string[] }).__r17Keys = keys;
        document.addEventListener('keydown', (event) => keys.push(event.key), true);
        return keys.length;
      });
      expect(seen).toBe(0);
      await focusOurs('dock-card');
      await browser.keys(Key.Enter);
      await browser.keys([Key.Shift, Key.Enter]);
      await browser.keys(Key.ArrowDown);
      expect((await inputLog()).ui.filter((entry) => !MODIFIER.test(entry))).toEqual(['dock-card:Enter:delivered', 'dock-card:Enter:delivered', 'dock-card:ArrowDown:delivered']);
      // The page's own capture listener on `document` saw none of them (Shift alone is nobody's key).
      expect(await browser.execute(() => (window as unknown as { __r17Keys: string[] }).__r17Keys.filter((key) => key !== 'Shift'))).toEqual([]);
      await browser.pause(300);
      expect((await standServer.journal(mark)).entries.filter((entry) => entry.kind === 'send')).toEqual([]);
      expect(await pageJournal(page, 'composer-submit')).toEqual([]);
      expect((await composer(a1))?.text).toBe('draft');
    });

    it('[HK-020] text of another layout typed into our field arrives as typed, and nothing of ours fires', async () => {
      // WebDriver cannot run a real IME composition (the composing branch itself is proven on trusted events in
      // dispatcher.dom.test.ts); what a browser can show: non-Latin typing inside a closed root is left alone.
      // A real IME is a hand check on winpc and the Mac: docs/hotkeys-delivery.md «Ввод через IME».
      await input('overlay', 'palette', true);
      await focusOurs('overlay-field');
      await browser.keys(['П', 'р', 'и', 'в', 'е', 'т', ' ', 'ё', '?', 'j']);
      expect(await input('fieldValue', 'overlay-field')).toBe('Привет ё?j');
      const log = await inputLog();
      expect([log.ran, log.refused, log.stats.claimed, log.stats.isolated]).toEqual([[], [], 0, 0]);
      await input('overlay', 'palette', false);
    });

    it('a key forged by a script of the page starts nothing and is not even cancelled (§14)', async () => {
      await inComposer();
      for (const init of [
        { key: 'Meta', code: 'MetaLeft', metaKey: true },
        { key: 'e', code: 'KeyE', metaKey: true },
        { key: 'e', code: 'KeyE', ctrlKey: true },
        { key: 'j', code: 'KeyJ' },
        { key: '?', code: 'Slash', shiftKey: true },
      ]) {
        expect(await input('forge', init)).toEqual({ prevented: false });
      }
      // The same from the page's own realm, on the editor itself.
      const fromPage = await browser.execute(() => {
        const editor = document.querySelector('.ProseMirror');
        const event = new KeyboardEvent('keydown', { key: 'p', code: 'KeyP', metaKey: true, ctrlKey: true, bubbles: true, cancelable: true, composed: true });
        editor?.dispatchEvent(event);
        return { found: editor !== null, prevented: event.defaultPrevented, trusted: event.isTrusted };
      });
      expect(fromPage).toEqual({ found: true, prevented: false, trusted: false });
      const log = await inputLog();
      expect([log.ran, log.stats.claimed, log.stats.untrusted]).toEqual([[], 0, 6]);
    });
  });

  describe('before the lazy part and the quick jump', () => {
    it('[HK-024] [HK-025] a key pressed before the lazy part loaded is already ours — TipTap does not toggle — and runs when the part arrives', async () => {
      await open(`${chatPath(ACC, a1)}?cg-lazy=manual`);
      await inComposer();
      await browser.keys([MOD, 'i']);
      await browser.keys(['q']);
      expect((await composer(a1))?.html).toBe('<p>q</p>');
      const early = await inputLog();
      expect([early.ran, early.notices]).toEqual([[], [{ kind: 'queued', command: 'fix' }]]);
      // Nothing of ours can draw yet: the dock host itself says that a key waits.
      expect(await input('dock')).toMatchObject({ keyPending: true });
      await input('connect');
      const log = await inputLog();
      expect(log.ran).toEqual(['fix@dock']);
      expect(log.notices).toEqual([
        { kind: 'queued', command: 'fix' },
        { kind: 'ran', command: 'fix' },
      ]);
      expect(log.stats).toMatchObject({ queued: 1, dropped: 0 });
      expect(await input('dock')).toMatchObject({ keyPending: false });

      // The chat changed before the part arrived: the kept key is dropped, not run in another chat.
      await open(`${chatPath(ACC, a1)}?cg-lazy=manual`);
      await inComposer();
      await browser.keys([MOD, 'e']);
      await callStand('openChat', ACC, a2);
      await waitForChatReady(ACC, a2);
      await input('connect');
      const moved = await inputLog();
      expect(moved.ran).toEqual([]);
      expect(moved.notices).toEqual([
        { kind: 'queued', command: 'reply' },
        { kind: 'dropped', command: 'reply', why: 'route-changed' },
      ]);
    });

    it('[HK-025] the lazy part arrives while the chat still loads: the key waits for the chat\'s first state and then runs as pressed', async () => {
      await open(`${chatPath(ACC, a1)}?cg-lazy=manual&cg-dock=loading`);
      await inComposer();
      await browser.keys([MOD, 'e']);
      await input('connect');
      // Neither run against «чат загружается» nor refused: still waiting, and the host says so.
      const waiting = await inputLog();
      expect([waiting.ran, waiting.refused, waiting.notices]).toEqual([[], [], [{ kind: 'queued', command: 'reply' }]]);
      expect(await input('dock')).toMatchObject({ keyPending: true });
      await input('dockReady');
      const log = await inputLog();
      expect(log.ran).toEqual(['reply@dock']);
      expect(log.notices[log.notices.length - 1]).toEqual({ kind: 'ran', command: 'reply' });
      expect(await input('dock')).toMatchObject({ keyPending: false });
      // TipTap never saw ⌘E: no inline code.
      await browser.keys(['q']);
      expect((await composer(a1))?.html).toBe('<p>q</p>');
    });

    it('[NEW-07] Alt (⌥) held alone for 400 ms opens the quick jump (X45), a digit under it jumps, letting go closes it; in the message field nothing opens; ⌘/Ctrl+1–9 are never ours', async () => {
      await open(chatPath(ACC, a1));
      await focusOurs('dock-card');
      // `perform(true)`: WebdriverIO does not release the held key at the end of the sequence.
      await browser.action('key').down(Key.Alt).pause(700).perform(true);
      expect((await inputLog()).quick).toEqual([true]);
      await browser.action('key').down('3').up('3').up(Key.Alt).perform();
      const log = await inputLog();
      expect(log.quick).toEqual([true, false]);
      expect(log.ran).toEqual(['quick-jump:3@global']);
      await input('clear');
      await browser.action('key').down(Key.Alt).pause(700).up(Key.Alt).perform();
      expect((await inputLog()).quick).toEqual([true, false]);
      await input('clear');
      // A short press never opens it.
      await browser.action('key').down(Key.Alt).pause(100).up(Key.Alt).perform();
      await browser.pause(500);
      expect((await inputLog()).quick).toEqual([]);
      await inComposer();
      await browser.action('key').down(Key.Alt).pause(700).up(Key.Alt).perform();
      expect((await inputLog()).quick).toEqual([]);
      // ⌘/Ctrl+1–9 are the browser's tab keys (X45): in the message field and off it, nothing of ours runs or is refused.
      await browser.keys([MOD, '2']);
      await focusOurs('dock-card');
      await browser.keys([MOD, '2']);
      expect((await inputLog()).ran).toEqual([]);
      expect((await inputLog()).refused).toEqual([]);
    });

    it('[HK-022] [NEW-07] a keyup the system took: the popup lives only until the mouse says Alt is up; with the key really down the mouse changes nothing', async () => {
      await open(chatPath(ACC, a1));
      await focusOurs('dock-card');
      expect(await input('focusState')).toEqual({ focused: true, hidden: false });
      // The keyup goes «to the system»: the page hears Alt go down and nothing after it.
      await input('loseKeyup');
      await browser.action('key').down(Key.Alt).pause(700).up(Key.Alt).perform();
      expect((await inputLog()).quick).toEqual([true]);
      // Nothing tells the page — until the mouse moves: its event carries no modifier.
      await browser.action('pointer', { parameters: { pointerType: 'mouse' } }).move({ x: 320, y: 240 }).move({ x: 340, y: 260 }).perform();
      expect((await inputLog()).quick).toEqual([true, false]);
      expect((await inputLog()).overlays).toEqual([]);
      // The engine was reset with it: a digit now is a digit, not Alt+N.
      await browser.keys(['3']);
      expect((await inputLog()).ran).toEqual([]);
      await input('clear');

      // The key is really held: the mouse moves under it (towards a row) and the popup stays; letting go closes it.
      await browser.action('key').down(Key.Alt).pause(700).perform(true);
      expect((await inputLog()).quick).toEqual([true]);
      await browser.action('pointer', { parameters: { pointerType: 'mouse' } }).move({ x: 360, y: 280 }).move({ x: 380, y: 300 }).perform(true);
      expect((await inputLog()).quick).toEqual([true]);
      await browser.action('key').up(Key.Alt).perform();
      expect((await inputLog()).quick).toEqual([true, false]);
    });

    it('[HK-022] [NEW-07] the focus leaves under a held Alt (another tab comes to the front): the popup closes, and back in the tab the stale modifier opens nothing', async () => {
      await open(chatPath(ACC, a1));
      await focusOurs('dock-card');
      const tab = await browser.getWindowHandle();
      await browser.action('key').down(Key.Alt).pause(700).perform(true);
      expect((await inputLog()).quick).toEqual([true]);
      // Another tab takes the front: this one is hidden and loses the focus; its keyup will never come here.
      await browser.newWindow('about:blank', { type: 'tab' });
      await browser.pause(300);
      await browser.closeWindow();
      await browser.switchToWindow(tab);
      const back = await inputLog();
      expect(back.quick).toEqual([true, false]);
      expect(back.overlays).toEqual([]);
      // Nothing is pressed here: however long, no popup comes back from what was «held» before.
      await browser.pause(900);
      expect((await inputLog()).quick).toEqual([true, false]);
      await browser.releaseActions();
      await browser.pause(600);
      expect((await inputLog()).quick).toEqual([true, false]);
      // A fresh hold works as ever.
      await focusOurs('dock-card');
      await browser.action('key').down(Key.Alt).pause(700).up(Key.Alt).perform();
      expect((await inputLog()).quick).toEqual([true, false, true, false]);
    });
  });

  describe('which combinations reach the page', () => {
    interface Probe {
      readonly id: string;
      readonly scheme: 'mac' | 'win';
      readonly combo: string;
      readonly keys: string[];
      readonly code: string;
      readonly reached: boolean;
      readonly cancelled: boolean;
      readonly ran: string | null;
      /** A new top-level window appeared: the browser acted on it. */
      readonly browserActed: boolean;
    }

    const keycap = (code: string): string =>
      code.startsWith('Key') ? code.slice(3).toLowerCase() : code.startsWith('Digit') ? code.slice(5) : ({ Period: '.', Comma: ',', BracketRight: ']', Slash: '/', Escape: Key.Escape } as Record<string, string>)[code] ?? code;

    const MOD_NAMES: Record<string, string> = { [Key.Command]: 'Meta', [Key.Control]: 'Control', [Key.Shift]: 'Shift', [Key.Alt]: 'Alt', [Key.Escape]: 'Escape' };

    function combos(scheme: 'mac' | 'win'): { id: string; combo: string; keys: string[]; code: string }[] {
      const primary = scheme === 'mac' ? Key.Command : Key.Control;
      const panel = scheme === 'mac' ? [Key.Command, Key.Shift] : [Key.Control, Key.Alt];
      const name = (mods: string[], code: string): string => [...mods.map((mod) => MOD_NAMES[mod] ?? mod), code].join('+');
      const list: { id: string; combo: string; keys: string[]; code: string }[] = schemeActions().map((def) => {
        const mods = def.level === 'text' ? [primary] : panel;
        return { id: def.action, combo: name(mods, def.code), keys: [...mods, keycap(def.code)], code: def.code };
      });
      for (const def of EXTRA_KEYS) {
        const mods = def.mods === 'primary' ? [primary] : def.mods === 'panel' ? panel : def.mods === 'alt' ? [Key.Alt] : def.mods === 'shift' ? [Key.Shift] : [];
        // Every slot of Alt+1–9 is one row of the table: the first and the last digit stand for the nine.
        const codes = def.codes.length > 1 ? [def.codes[0] ?? '', def.codes[def.codes.length - 1] ?? ''] : def.codes;
        for (const code of codes) list.push({ id: def.fallback ? `${def.command}:fallback` : def.command, combo: name(mods, code), keys: [...mods, keycap(code)], code });
      }
      return list;
    }

    it('every combination of both schemes reaches a capture listener of the page and ours end up cancelled (synthetic keys: docs/hotkeys-delivery.md)', async () => {
      const results: Probe[] = [];
      const skipped: string[] = [];
      for (const scheme of ['mac', 'win'] as const) {
        await open(`${chatPath(ACC, a1)}?cg-keys=${scheme}`);
        // The other system's modifier may not exist for this browser build (⌘ off a Mac): then its scheme is not judged here.
        await browser.keys([scheme === 'mac' ? Key.Command : Key.Control]);
        const modifier = (await input<ReachedKey[]>('reached')).at(-1);
        if ((scheme === 'mac' ? modifier?.meta : modifier?.ctrl) !== true) {
          expect(scheme).not.toBe(MAC ? 'mac' : 'win');
          skipped.push(scheme);
          continue;
        }
        // Focus on our own card: outside any field, in an open chat — every row of the table is in its own context.
        for (const item of combos(scheme)) {
          for (const overlay of ['palette', 'cheatsheet', 'spenders', 'newcomers', 'fan-panel', 'quick-jump']) await input('overlay', overlay, false);
          // J, K and ] do nothing on a part of the dock (X44): the plain letters are judged on a card of ours outside it.
          const plain = item.keys.length === 1 && item.id !== 'close';
          // A side panel covers nothing: on its card the plain letters are in the same context as on the dock's before X44.
          if (plain) await input('overlay', 'fan-panel', true);
          await focusOurs(plain ? 'overlay-card' : 'dock-card');
          await input('clear');
          const before = (await browser.getWindowHandles()).length;
          await browser.keys(item.keys);
          const log = await inputLog();
          const key = (await input<ReachedKey[]>('reached')).find((entry) => entry.code === item.code);
          const after = (await browser.getWindowHandles()).length;
          results.push({
            id: item.id,
            scheme,
            combo: item.combo,
            keys: item.keys.map((value) => MOD_NAMES[value] ?? value),
            code: item.code,
            reached: key !== undefined,
            cancelled: key?.prevented === true,
            ran: log.ran[0] ?? (log.refused[0] ?? null),
            browserActed: after !== before,
          });
        }
      }
      mkdirSync(E2E_EVIDENCE_DIR, { recursive: true });
      const userAgent = await browser.execute(() => navigator.userAgent);
      const slowestHandlerMs = (await inputLog()).stats.maxHandlerMs;
      writeFileSync(
        `${E2E_EVIDENCE_DIR}hotkeys-delivery.json`,
        `${JSON.stringify({ at: new Date().toISOString(), host: process.platform, userAgent, synthetic: true, skippedSchemes: skipped, slowestHandlerMs, results }, null, 2)}\n`,
      );

      // Every printed combination reached the page with its physical code and modifiers.
      expect(results.filter((result) => !result.reached).map((result) => `${result.scheme}:${result.combo}`)).toEqual([]);
      // Esc with nothing of ours open is ChatSpace's; everything else in the table is taken and cancelled.
      const untouched = results.filter((result) => !result.cancelled).map((result) => result.id);
      expect([...new Set(untouched)]).toEqual(['close']);
      expect(results.filter((result) => result.id !== 'close' && result.ran === null).map((result) => `${result.scheme}:${result.combo}`)).toEqual([]);
      expect(results.some((result) => result.browserActed)).toBe(false);
      // Every scheme judged, every dispatcher command with a key, the fallbacks included.
      // A row of the nine slots is judged on its first and its last digit.
      expect(results).toHaveLength((2 - skipped.length) * (schemeActions().length + EXTRA_KEYS.reduce((n, def) => n + Math.min(def.codes.length, 2), 0)));
      expect(skipped.length).toBeLessThan(2);
    });
  });
});
