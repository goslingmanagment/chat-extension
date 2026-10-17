// Fansly wired for release, on its stand (R20 P7i; docs/project-unite/
// architecture.md §1.3–§1.5, §4, §7.9; FS-HK-1; plan.md §3 `suite-fansly-host`):
// the extension's test build with Fansly switched on as a person does it, a
// chatter signed in, the Fansly page's persona chosen and its own switches on,
// real key presses in Firefox next to the FBuddy-like neighbour (`after`).
// - before the application is loaded (Fansly's inbox, where our dock has no
//   place) a key of ours is already ours — Fansly never hears it — and runs
//   once the application is in; Reply there is Fansly's (HK-024, HK-026);
// - in Fansly's message field our keys run before Fansly's and the
//   neighbour's listeners hear them; `?` typed there is text, a key that is
//   not ours is Fansly's; Enter in the field is Fansly's own — it sends;
//   Enter on a part of ours inserts it into the field, and Fansly sends
//   nothing (HK-028, HK-026, UI-023); a Reply finished over the empty field
//   and the send of our part hand the focus to the next part (X44);
// - ⌘⇧L / Ctrl+Alt+L is our Split, a switch with its toast; on a Mac it is
//   also FBuddy's translate on the field — ours wins (X37); FBuddy's Ctrl+Shift+L
//   elsewhere stays its own (HK-011);
// - Esc closes ours one by one, then it is Fansly's; while Fansly's modal is
//   open (`body.modal-opened`) or the focus is in FBuddy's window (its notes
//   in its panel) our keys yield: what is typed there is theirs, a key of
//   ours runs nothing and says why (HK-029);
// - a ChatSpace tab beside the Fansly one: two tabs of two sites registered
//   with their own hosts, a key in one runs there only, each cheatsheet lists
//   its own site's rows.
// Nothing of ours asks the Fansly stand for anything; the fake hub refuses
// nothing our client sent.

import { $, browser, expect } from '@wdio/globals';
import { Key } from 'webdriverio';

import { callsTo } from '../../src/fake-hub/journal';
import { NEIGHBOR_TAGS, NOTES_FIELD_CLASS } from '../../src/fake-fansly/neighbor/dom';
import { inChrome } from '../support/background';
import { MAC, MOD, PANEL } from '../support/chat';
import { readReport, waitForReport } from '../support/extension';
import { useFakeHub } from '../support/fake-hub';
import { openWithNeighbor, setFanslyNeighbor, waitForNeighborComposer } from '../support/fansly-neighbor';
import { openChatSpaceBeside, startFanslyShift, type FanslyShift } from '../support/fansly-shift';
import { FANSLY_MAIN, callFansly, fakeFansly, fanslyIds, fanslyStandServer } from '../support/fansly-stand';
import { focusTab } from '../support/focus';
import { useNetworkTrap } from '../support/network-trap';
import { oursFocus, readOurs, waitOursText } from '../support/ours';
import { dockIs } from '../support/shift';
import { standServer } from '../support/stand';
import { standWorld } from '../support/world';

type Ids = Awaited<ReturnType<typeof fanslyIds>>;

/** Firefox's own pref for `navigator.platform` (the page and our isolated world read it; our keys pick their scheme by it). */
const PLATFORM_PREF = 'general.platform.override';

/**
 * What a listener of the page on `window` heard — registered after ours, as every listener of Fansly and of the
 * neighbour is (ours stand from document_start): the keys, a letter in lower case, no lone modifier.
 */
async function listenAsThePage(): Promise<void> {
  await browser.execute(() => {
    const own = window as unknown as { __cgHeard?: string[] };
    if (own.__cgHeard !== undefined) return;
    const heard: string[] = [];
    own.__cgHeard = heard;
    window.addEventListener(
      'keydown',
      (event) => {
        if (!['Shift', 'Control', 'Alt', 'Meta', 'OS'].includes(event.key)) heard.push(event.key.length === 1 ? event.key.toLowerCase() : event.key);
      },
      true,
    );
  });
}
const heard = (): Promise<string[]> => browser.execute(() => [...((window as unknown as { __cgHeard?: string[] }).__cgHeard ?? [])]);
const forget = (): Promise<void> => browser.execute(() => void (window as unknown as { __cgHeard?: string[] }).__cgHeard?.splice(0));

const fieldValue = (): Promise<string> => browser.execute((selector: string) => document.querySelector<HTMLTextAreaElement>(selector)?.value ?? '', FANSLY_MAIN.field);
const pageMark = async (): Promise<number> => (await callFansly('journal')).at(-1)?.seq ?? 0;
const sendsSince = async (mark: number): Promise<number> => (await callFansly('journal', mark)).filter((entry) => entry.type === 'composer-send').length;
const overlays = async (): Promise<readonly string[]> => (await readReport())?.dock?.overlays ?? [];
async function waitOverlays(wanted: readonly string[], message: string): Promise<void> {
  await waitForReport((report) => JSON.stringify([...(report.dock?.overlays ?? [])].sort()) === JSON.stringify([...wanted].sort()), message, 10_000);
}

/** The person clicks into Fansly's message field of the open chat and empties it. */
async function intoField(): Promise<void> {
  await $(FANSLY_MAIN.field).click();
  await browser.keys([MOD, 'a']);
  await browser.keys(Key.Backspace);
  await browser.waitUntil(async () => (await fieldValue()) === '', { timeout: 5000, timeoutMsg: 'Fansly’s field did not empty' });
}

/** Our dock of the open Fansly chat, signed in and ready to generate. */
const dockReady = (message: string) => dockIs((d) => d.status === 'ready' && d.actions['reply'] === true, message, 20_000);

describe('Fansly wired for release: its keys, our dock next to the neighbour, and a ChatSpace tab beside it (R20 P7i)', () => {
  useNetworkTrap();
  const { hub } = useFakeHub();
  let shift: FanslyShift;
  let ids: Ids;
  let journalStart = 0;
  let chat = '';

  before(async () => {
    await setFanslyNeighbor(null);
    await fakeFansly().command({ op: 'reset' });
    await standServer.reset();
    journalStart = await fanslyStandServer.mark();
    // The hub's ChatSpace page bound to the ChatSpace stand's account too, for the tab beside (before the sign-in reads it).
    await standWorld(hub());
    shift = await startFanslyShift(hub(), { path: '/messages', neighbor: { mode: 'after' }, settings: { generation: { split: true } }, viewport: { width: 1440, height: 900 } });
    ids = await fanslyIds();
    chat = `/messages/${ids.groups[0] ?? ''}`;
  });

  after(async () => {
    await inChrome((driver) => driver.executeScript('Services.prefs.clearUserPref(arguments[0]); return true;', [PLATFORM_PREF])).catch(() => undefined);
    // Nothing of the extension asked the Fansly stand for anything (the page's own calls go to the fake Fansly).
    expect((await fanslyStandServer.journal(journalStart)).filter((entry) => entry.origin !== 'asset')).toEqual([]);
    await setFanslyNeighbor(null);
  });

  it('[HK-024] [HK-026] before our application is loaded — Fansly’s inbox, where the dock has no place — `?` is already ours: Fansly never hears it, the cheatsheet opens once the application is in; Esc closes it; Split is Fansly’s there', async () => {
    await shift.toFansly();
    await openWithNeighbor('/messages', { mode: 'after' });
    await waitForReport((report) => report.rpc?.registered === true, 'the Fansly tab registered with the background as Fansly’s');
    await focusTab();
    await listenAsThePage();
    // Nothing of ours needed the application here: none is loaded.
    expect((await readReport())?.app).toBeUndefined();
    // Split outside a chat is not ours: Fansly hears it (a key that does nothing in Firefox on either system).
    await browser.keys([...PANEL, 'l']);
    await browser.keys(['?']);
    const report = await waitForReport((now) => now.dock?.overlays.includes('cheatsheet') === true, 'the kept `?` ran once the application loaded', 20_000);
    expect(report.app).toBeDefined();
    await waitOursText('modal', 'Клавиши ChatGoose', 'our cheatsheet on Fansly');
    // Fansly heard Split's key and never the `?` we kept for ourselves.
    expect(await heard()).toEqual(['l']);
    await browser.keys(Key.Escape);
    await waitOverlays([], 'Esc closes our cheatsheet');
    expect(await heard()).toEqual(['l']);
    // Nothing of ours is open: Esc is Fansly's.
    await browser.keys(Key.Escape);
    await browser.waitUntil(async () => (await heard()).includes('Escape'), { timeout: 5000, timeoutMsg: 'Esc with nothing of ours open did not reach Fansly' });
  });

  it('[HK-028] [HK-026] in Fansly’s message field our keys are ours before Fansly and the neighbour hear them — Reply starts, Help says it is gone; `?` typed there is text, a key that is not ours is Fansly’s', async () => {
    await openWithNeighbor(chat, { mode: 'after' });
    await waitForNeighborComposer();
    await dockReady('our dock of the open Fansly chat, signed in');
    await focusTab();
    await listenAsThePage();
    await intoField();
    await forget();
    await browser.keys([MOD, 'e']);
    await dockIs((d) => d.result?.feature === 'reply' && d.result.state === 'done' && d.result.parts >= 2, 'a Reply in parts of the Fansly chat', 30_000);
    // The field is the person's as it was; neither Fansly nor the neighbour saw the letter.
    expect(await fieldValue()).toBe('');
    expect(await heard()).toEqual([]);
    // X44: the Reply finished over the empty field hands the focus to its first part (the person's Enter would insert
    // it); the person goes back into the field — a click, no key — for what follows.
    await browser.waitUntil(async () => (await oursFocus('dock'))?.label === 'Часть 1', { timeout: 5000, timeoutMsg: `the finished Reply did not hand the focus to its first part: ${JSON.stringify(await oursFocus('dock'))}` });
    await $(FANSLY_MAIN.field).click();
    expect(await browser.execute((selector: string) => document.activeElement === document.querySelector(selector), FANSLY_MAIN.field)).toBe(true);
    // A key of ours that has nothing to run is still ours in a chat: Help, removed, says so.
    await browser.keys([...PANEL, 'h']);
    await waitOursText('toast', 'Help пока убран', 'Help’s key says it is gone');
    expect(await heard()).toEqual([]);
    // Typed into the field, `?`, J and ] are text; ⌘/Ctrl+Z is Fansly's own key.
    await browser.keys(['?', 'j', ']']);
    await browser.waitUntil(async () => (await fieldValue()) === '?j]', { timeout: 5000, timeoutMsg: `the field holds «${await fieldValue()}», not what was typed` });
    expect(await overlays()).toEqual([]);
    await browser.keys([MOD, 'z']);
    expect(await heard()).toEqual(['?', 'j', ']', 'z']);
    await intoField();
  });

  it('[HK-004] [HK-005] Hi (⌘/Ctrl+G) and Ping (⌘/Ctrl+P) in Fansly’s field are ours: each runs in our dock, neither Fansly nor Firefox hears it — no find bar, no print window', async () => {
    await intoField();
    await forget();
    const windows = (await browser.getWindowHandles()).length;
    const settled = (feature: string) => (d: { readonly result: { readonly feature: string; readonly state: string } | null }): boolean =>
      d.result?.feature === feature && ['done', 'failed', 'canceled', 'interrupted'].includes(d.result.state);
    await browser.keys([MOD, 'g']);
    await dockIs(settled('hi'), 'Hi ran in our dock', 30_000);
    await browser.keys([MOD, 'p']);
    await dockIs(settled('ping'), 'Ping ran in our dock', 30_000);
    expect(await heard()).toEqual([]);
    expect(await fieldValue()).toBe('');
    expect((await browser.getWindowHandles()).length).toBe(windows);
    // The Reply of this chat for what follows.
    await browser.keys([MOD, 'e']);
    await dockIs((d) => d.result?.feature === 'reply' && d.result.state === 'done' && d.result.parts >= 2, 'a Reply in parts again', 30_000);
    await intoField();
  });

  it('[UI-023] Enter on a part of ours is «Вставить»: the part goes into Fansly’s field and Fansly sends nothing; Enter in Fansly’s field is Fansly’s own — it sends; then the next part takes the focus (X44)', async () => {
    const mark = await pageMark();
    const focused = await readOurs('dock', '[data-cg-part="0"]', (node) => {
      node.focus();
      return true;
    });
    expect(focused).toBe(true);
    expect((await oursFocus('dock'))?.label).toBe('Часть 1');
    await browser.keys(Key.Enter);
    await dockIs((d) => (d.result?.inserted ?? 0) === 1, 'the first part inserted');
    await browser.waitUntil(async () => (await fieldValue()).length > 0, { timeout: 5000, timeoutMsg: 'the part did not reach Fansly’s field' });
    const inserted = await fieldValue();
    // Enter inside our root sent nothing: the page's model has the text, no send was made.
    await browser.pause(400);
    expect(await sendsSince(mark)).toBe(0);
    // The insert put the focus into Fansly's field: Enter there is Fansly's — the person sends.
    expect(await browser.execute((selector: string) => document.activeElement === document.querySelector(selector), FANSLY_MAIN.field)).toBe(true);
    await browser.keys(Key.Enter);
    await browser.waitUntil(async () => (await sendsSince(mark)) === 1, { timeout: 5000, timeoutMsg: 'Enter in Fansly’s field did not send' });
    expect(inserted.trim().length).toBeGreaterThan(0);
    // X44: the part is sent and the field is empty — the next part takes the focus, so the person's next Enter inserts
    // it (⌘E → Enter → Enter → Enter → Enter, as in the old extension). The focus alone writes nothing.
    await browser.waitUntil(async () => (await oursFocus('dock'))?.label === 'Часть 2', { timeout: 5000, timeoutMsg: `the send did not hand the focus to the next part: ${JSON.stringify(await oursFocus('dock'))}` });
    expect(await fieldValue()).toBe('');
    await browser.pause(400);
    expect(await sendsSince(mark)).toBe(1);
  });

  it(`[HK-011] ${MAC ? '⌘⇧L' : 'Ctrl+Alt+L'} in Fansly’s field is our Split — a switch with its toast, the draft untouched${MAC ? '' : '; FBuddy’s own Ctrl+Shift+L is not ours and still translates'}`, async () => {
    await intoField();
    await browser.keys('hello'.split(''));
    await listenAsThePage();
    await forget();
    await browser.keys([...PANEL, 'l']);
    await waitOursText('toast', /Split/, 'Split’s toast');
    await browser.pause(800);
    expect(await fieldValue()).toBe('hello');
    expect(await heard()).toEqual([]);
    if (!MAC) {
      // Not ours: the neighbour's translate on the field has it, and writes its translation a moment later.
      await browser.keys([Key.Control, Key.Shift, 'l']);
      await browser.waitUntil(async () => (await fieldValue()) === '[EN] hello', { timeout: 5000, timeoutMsg: `FBuddy did not translate: «${await fieldValue()}»` });
    }
    await intoField();
  });

  it('[HK-011] on a Mac ⌘⇧L is also FBuddy’s translate on the field: ours wins — the decision of X37 —, Split switches and FBuddy translates nothing', async function (this: Mocha.Context) {
    // The browser says it runs on a Mac (our keys and the neighbour both read `navigator.platform`); a new document reads it.
    await inChrome((driver) => driver.executeScript('Services.prefs.setStringPref(arguments[0], "MacIntel"); return true;', [PLATFORM_PREF]));
    try {
      await openWithNeighbor(chat, { mode: 'after' });
      await waitForNeighborComposer();
      expect(await browser.execute(() => navigator.platform)).toBe('MacIntel');
      await dockReady('our dock, a Mac’s scheme');
      await focusTab();
      await intoField();
      await browser.keys('hello'.split(''));
      // ⌘ must reach the page as ⌘ in this build of Firefox: otherwise a Mac's scheme cannot be judged here.
      await browser.execute(() => {
        const own = window as unknown as { __cgMeta?: boolean | null };
        own.__cgMeta = null;
        window.addEventListener('keydown', (event) => void (own.__cgMeta = event.metaKey), { capture: true, once: true });
      });
      await browser.keys([Key.Command]);
      if ((await browser.execute(() => (window as unknown as { __cgMeta?: boolean | null }).__cgMeta)) !== true) this.skip();
      await listenAsThePage();
      await forget();
      await browser.keys([Key.Command, Key.Shift, 'l']);
      await waitOursText('toast', /Split/, 'Split’s toast on a Mac');
      await browser.pause(800);
      expect(await fieldValue()).toBe('hello');
      expect(await heard()).toEqual([]);
    } finally {
      await inChrome((driver) => driver.executeScript('Services.prefs.clearUserPref(arguments[0]); return true;', [PLATFORM_PREF]));
    }
  });

  it('[HK-029] Esc closes ours one by one, then it is Fansly’s; under Fansly’s modal and in FBuddy’s window our keys yield — what is typed there is theirs, a key of ours runs nothing and says why', async () => {
    await openWithNeighbor(chat, { mode: 'after', panel: 'desktop' });
    await waitForNeighborComposer();
    await dockReady('our dock next to the neighbour’s panel');
    await focusTab();
    await listenAsThePage();
    // A result in the dock: its sheet is ours too.
    await intoField();
    await browser.keys([MOD, 'e']);
    await dockIs((d) => d.result?.state === 'done' && d.height > 60, 'a Reply in the dock', 30_000);
    // Out of every field — Fansly's and ours: the feed has the click.
    await $(FANSLY_MAIN.list).click();
    await forget();
    await browser.keys(['?']);
    await waitOverlays(['cheatsheet'], '`?` opens our cheatsheet');
    await browser.keys(Key.Escape);
    await waitOverlays([], 'the first Esc closes the cheatsheet');
    const tall = (await dockIs(() => true, 'the dock')).height;
    await $(FANSLY_MAIN.list).click();
    await browser.keys(Key.Escape);
    await browser.waitUntil(async () => (await dockIs(() => true, 'the dock')).height < tall, { timeout: 5000, timeoutMsg: 'the second Esc did not hide our result' });
    // Neither Esc reached Fansly: both were ours.
    expect(await heard()).toEqual([]);
    await $(FANSLY_MAIN.list).click();
    await browser.keys(Key.Escape);
    await browser.waitUntil(async () => (await heard()).includes('Escape'), { timeout: 5000, timeoutMsg: 'with nothing of ours open, Esc did not reach Fansly' });

    // Fansly's modal over the chat (its composer's upload modal): `body.modal-opened` while it stands.
    await browser.execute((selector: string) => {
      const input = document.querySelector<HTMLInputElement>(`${selector} input[type="file"]`);
      if (input === null) throw new Error('no file input');
      const files = new DataTransfer();
      files.items.add(new File(['x'], 'probe.png', { type: 'image/png' }));
      input.files = files.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, FANSLY_MAIN.composer);
    await browser.waitUntil(async () => (await callFansly('modals')).length > 0 && (await browser.execute(() => document.body.classList.contains('modal-opened'))), { timeout: 5000, timeoutMsg: 'Fansly’s upload modal' });
    await forget();
    const hubMark = await hub().mark();
    await browser.keys(['?', ']']);
    await browser.keys(Key.Escape);
    await browser.keys([MOD, 'e']);
    await waitOursText('toast', 'сначала закройте открытое окно', 'a key of ours under Fansly’s modal says why it runs nothing');
    // `?`, `]` and Esc were Fansly's — nothing of ours opened —, Reply's key was ours and ran nothing.
    expect(await heard()).toEqual(['?', ']', 'Escape']);
    expect(await overlays()).toEqual([]);
    expect(callsTo((await hub().journal(hubMark)).entries, 'aiFeatureStream')).toEqual([]);
    // Its close icon, as Fansly's own click handler takes it (the stand draws the icon without its font: no box to point at).
    await browser.execute(() => document.querySelector<HTMLElement>('app-account-media-upload .fa-xmark')?.click());
    await browser.waitUntil(async () => !(await browser.execute(() => document.body.classList.contains('modal-opened'))), { timeout: 5000, timeoutMsg: 'Fansly’s modal did not close' });
    // The modal gone, our keys are ours again.
    await $(FANSLY_MAIN.list).click();
    await browser.keys(['?']);
    await waitOverlays(['cheatsheet'], 'with Fansly’s modal gone, `?` opens ours');
    await browser.keys(Key.Escape);
    await waitOverlays([], 'and Esc closes it');

    // FBuddy's window: its fan panel beside the chat, the focus in its notes.
    const notes = $(NEIGHBOR_TAGS.panelDesktop).shadow$(`textarea.${NOTES_FIELD_CLASS}`);
    // The cursor into FBuddy's notes (put there by the page's own `focus()`: what our keys judge is only where the focus is).
    await browser.execute((field: HTMLElement) => field.focus(), (await notes.getElement()) as unknown as HTMLElement);
    // The focus is in FBuddy's own root: the document names its host.
    const where = (): Promise<{ active: string | null; inner: string | null; panels: number }> =>
      browser.execute((tag: string) => ({
        active: document.activeElement?.localName ?? null,
        inner: document.activeElement?.shadowRoot?.activeElement?.localName ?? null,
        panels: document.querySelectorAll(tag).length,
      }), NEIGHBOR_TAGS.panelDesktop);
    expect(await where()).toEqual({ active: NEIGHBOR_TAGS.panelDesktop, inner: 'textarea', panels: 1 });
    await forget();
    await browser.keys(['?', 'j', ']']);
    await browser.waitUntil(async () => (await notes.getValue()) === '?j]', { timeout: 5000, timeoutMsg: `FBuddy’s notes hold «${await notes.getValue()}», not what was typed (the page heard ${JSON.stringify(await heard())}, the focus ${JSON.stringify(await where())}, ours ${JSON.stringify(await overlays())})` });
    await browser.keys(Key.Escape);
    await browser.keys([MOD, 'e']);
    // What was typed there and its Esc were FBuddy's; Reply's key was ours (nobody heard it) and ran nothing.
    expect(await heard()).toEqual(['?', 'j', ']', 'Escape']);
    expect(await overlays()).toEqual([]);
    expect(await notes.getValue()).toBe('?j]');
    expect(callsTo((await hub().journal(hubMark)).entries, 'aiFeatureStream')).toEqual([]);
    await intoField();
  });

  it('Fansly and ChatSpace in one browser: two tabs of two sites, each registered with its own host; a key runs in its own tab only; each cheatsheet lists its own site’s rows', async () => {
    await openWithNeighbor(chat, { mode: 'after' });
    const fanslyResult = (await dockReady('the Fansly tab’s dock')).result?.opId ?? null;
    const chatspace = await openChatSpaceBeside(shift);
    await dockIs((d) => d.status === 'ready' && d.actions['reply'] === true, 'the ChatSpace tab’s dock', 20_000);
    const tabs = await shift.rpc<{ tabs: ReadonlyArray<{ site: string }> }>('diagnostics.get');
    expect(tabs.ok && [...tabs.payload.tabs.map((tab) => tab.site)].sort()).toEqual(['chatspace', 'fansly-web']);
    await browser.switchToWindow(chatspace);
    await focusTab();
    await browser.keys([MOD, 'e']);
    await dockIs((d) => d.result?.feature === 'reply' && d.result.state === 'done', 'ChatSpace’s Reply', 30_000);
    // Out of ChatSpace's field: the focus on a part of ours.
    expect(await readOurs('dock', '[data-cg-part="0"]', (node) => (node.focus(), true))).toBe(true);
    await browser.keys(['?']);
    const chatspaceSheet = await waitOursText('modal', 'Клавиши ChatGoose', 'ChatSpace’s cheatsheet');
    expect(chatspaceSheet).toContain('Палитра команд');
    await browser.keys(Key.Escape);
    await shift.toFansly();
    // The Fansly tab heard nothing of it: its result is the one it had.
    expect((await dockIs(() => true, 'the Fansly tab’s dock')).result?.opId ?? null).toBe(fanslyResult);
    await $(FANSLY_MAIN.list).click();
    await browser.keys(['?']);
    const fanslySheet = await waitOursText('modal', 'Клавиши ChatGoose', 'Fansly’s cheatsheet');
    // Fansly has no palette of ours yet (P17): its cheatsheet does not list one; Split and Spenders are there.
    expect(fanslySheet).not.toContain('Палитра команд');
    expect(fanslySheet).toContain('Split');
    expect(fanslySheet).toContain('Spenders');
    await browser.keys(Key.Escape);
  });
});
