// The wired tab (architecture.md §2, §9.1, §10, §14): the TEST build on the
// ChatSpace-like stand against the fake hub — the real dock over its real
// controllers, the early key dispatcher, the action gate, the lazy surfaces.
// What it proves end to end, in a real Firefox:
// - Reply started by a click on the strip is admitted by the background,
//   streams from the hub and shows its parts (Split → two);
// - «Вставить» of a part puts exactly that part into the composer of the
//   chat the result belongs to — through ChatSpace's own bridge, on the
//   person's click, with a one-time action token of the gate;
// - a key of ours pressed in the native composer is taken by the early
//   dispatcher before ChatSpace's editor and starts its feature (Fix);
// - ⌘K / Ctrl+K opens the palette as a window of ours on the modal layer:
//   its chunk and its controllers come on demand, Esc closes it;
// - theme, language and «Вид ответа» follow the settings at once;
// - not one request of ours reached the stand, nothing left loopback, and
//   the fake hub saw only calls the client may make.
// WebDriver cannot look inside our closed roots: the extension reports what
// its dock shows and where its buttons are (test builds on loopback only),
// and the pointer presses them where a person would.

import { DEFAULT_SETTINGS, STORAGE_KEYS, type SettingsV1 } from '@cg/contracts';
import { browser, expect } from '@wdio/globals';
import { Key } from 'webdriverio';

import { PILOT_CAPABILITIES } from '../../src/fake-hub/config';
import { callsTo } from '../../src/fake-hub/journal';
import { PAGE, WORLD } from '../../src/scenarios/hub';
import { assignPersona, installTestBuild, pageRpc, waitForReport, writeLocalStorage, type DockReport, type SpikeReport } from '../support/extension';
import { fakeHubOrigin, testBuildPage, useFakeHub } from '../support/fake-hub';
import { useNetworkTrap } from '../support/network-trap';
import { callStand, chatPath, foreignCalls, openStand, STAND_IDS, standServer, waitForChatReady } from '../support/stand';

const { a: accountA } = STAND_IDS.accounts;
const { a1, a2 } = STAND_IDS.fans;
const PASSWORD = 'synthetic-password';
/** The host system's scheme: ⌘ on macOS, Ctrl elsewhere; the panel keys add ⇧ there and Alt here. */
const MAC = process.platform === 'darwin';
const MOD = MAC ? Key.Command : Key.Control;
const PANEL = MAC ? [Key.Command, Key.Shift] : [Key.Control, Key.Alt];
/** The fake hub's model answers Reply with Split so (fake-hub/ai.ts). */
const REPLY_PARTS = ['Hey you, thanks for writing!', 'How was your day?'];
const ACTIVE_EDITOR = '[data-stand-composer-slot]:not([style*="display: none"]) .ProseMirror';

describe('tab wiring — the real dock, its controllers and the keys on the stand against the fake hub', () => {
  useNetworkTrap();
  const { hub } = useFakeHub();
  let journalStart = 0;
  /** The fake hub is one for the whole run: its journal is read from here on. */
  let hubStart = 0;
  let standTab = '';
  let pagesTab = '';

  const toStand = async (): Promise<void> => browser.switchToWindow(standTab);
  const toPages = async (): Promise<void> => browser.switchToWindow(pagesTab);
  const dockIs = (predicate: (dock: DockReport, report: SpikeReport) => boolean, message: string, timeout = 15_000): Promise<DockReport> =>
    waitForReport((report) => report.appError !== undefined || (report.dock !== undefined && predicate(report.dock, report)), message, timeout).then((report) => {
      if (report.appError !== undefined || report.dock === undefined) throw new Error(`${message}: the tab application failed to start: ${report.appError ?? 'no dock'}`);
      return report.dock;
    });
  /** A real pointer press where the extension says its element is. */
  const press = async (dock: DockReport, name: string): Promise<void> => {
    const point = dock.hits[name];
    if (point === undefined) throw new Error(`the dock shows no «${name}» to press; it has ${Object.keys(dock.hits).join(', ')}`);
    await browser.action('pointer', { parameters: { pointerType: 'mouse' } }).move({ x: point.x, y: point.y, origin: 'viewport' }).down().up().perform();
  };
  const settingsPatch = async (patch: Record<string, unknown>): Promise<void> => {
    await toPages();
    expect(await pageRpc('settings.patch', { patch, baseRevision: null })).toMatchObject({ ok: true });
    await toStand();
  };
  const composerText = async (chatId: string): Promise<string | null> => (await callStand('composerState', accountA, chatId))?.text ?? null;

  before(async () => {
    await standServer.reset();
    journalStart = await standServer.mark();
    await hub().command({ op: 'pageAccount', pageLabel: PAGE, platformAccountId: STAND_IDS.platformAccounts.a });
    hubStart = await hub().mark();
    // Slow enough to see the stream: the model sends its answer sixteen characters at a time. And a hub as the
    // vendored SDK can talk to today: its stream transport cannot declare `context-v1` yet (docs/hub-layer.md),
    // so a hub that offers it would have every generation refused with CG-HUB-CAPABILITY.
    await hub().command({ op: 'config', patch: { aiChunkDelayMs: 120, capabilities: PILOT_CAPABILITIES.filter((capability) => capability !== 'context-v1') } });
    await installTestBuild();
    await browser.url(testBuildPage('debug-journal.html'));
    // Split on: Reply comes in parts.
    const settings: SettingsV1 = { ...DEFAULT_SETTINGS, hub: { baseUrl: fakeHubOrigin() }, generation: { ...DEFAULT_SETTINGS.generation, split: true } };
    await writeLocalStorage({ [STORAGE_KEYS.settings]: settings });
    await browser.waitUntil(
      async () => {
        const state = await pageRpc<{ settings: SettingsV1 }>('settings.get');
        return state.ok && state.payload.settings.hub.baseUrl === fakeHubOrigin();
      },
      { timeout: 15_000, timeoutMsg: 'the settings owner did not pick the hub address up' },
    );
    await browser.url(testBuildPage('options.html'));
    expect(await pageRpc('session.signIn', { login: WORLD.user.username, password: PASSWORD })).toMatchObject({ ok: true });
    await assignPersona(PAGE);
    await browser.url(testBuildPage('debug-journal.html'));
    pagesTab = await browser.getWindowHandle();
    standTab = (await browser.createWindow('tab')).handle;
    await toStand();
    await openStand(chatPath(accountA, a1));
    await waitForChatReady(accountA, a1);
  });

  after(async () => {
    await hub().command({ op: 'config', patch: { aiChunkDelayMs: 0, capabilities: [...PILOT_CAPABILITIES] } });
    // §12 «Гейт безопасности»: nothing but the page's own client and the harness talked to the stand.
    expect(foreignCalls((await standServer.journal(journalStart)).entries)).toEqual([]);
  });

  it('[UI-002] the dock of the open chat is ready: the strip with its seven actions from the dock’s own view model, Reply on, nothing generated yet', async () => {
    const dock = await dockIs((d) => d.status === 'ready' && d.actions['reply'] === true, 'the dock is ready with Reply on');
    expect(dock).toMatchObject({ kind: 'in-flow', inFlowFirstChild: true, visible: true, mode: 'insert', page: PAGE, banner: null, result: null, refusal: null, strip: true });
    expect(Object.keys(dock.hits).filter((name) => name.startsWith('action:'))).toEqual(expect.arrayContaining(['action:reply', 'action:fix']));
    // Fix has nothing to fix: the composer is empty.
    expect(dock.actions['fix']).toBe(false);
    expect(callsTo((await hub().journal(hubStart)).entries, 'aiFeatureStream')).toEqual([]);
  });

  it('[AI-001] [AI-137] [BG-001] Reply by a click on the strip: the background admits it, the hub’s stream is shown while it runs, then its two parts', async () => {
    const mark = await hub().mark();
    const before = await dockIs((d) => d.status === 'ready' && d.hits['action:reply'] !== undefined, 'the Reply button is on screen');
    await press(before, 'action:reply');
    const running = await dockIs((d) => d.result !== null && d.result.feature === 'reply' && d.result.state === 'streaming' && d.result.streaming, 'the Reply stream is on screen');
    expect(running.result?.parts).toBe(0);
    const done = await dockIs((d) => d.result !== null && d.result.state === 'done', 'the Reply result', 20_000);
    expect(done.result).toMatchObject({ feature: 'reply', state: 'done', streaming: false, parts: 2, inserted: 0, error: null });
    expect(done.refusal).toBeNull();
    // Each part has its own «Вставить».
    expect(Object.keys(done.hits).filter((name) => name.startsWith('insert:')).sort()).toEqual(['insert:0', 'insert:1']);
    for (const part of REPLY_PARTS) expect(done.text).toContain(part);
    // One generation went to the hub, with the narrow token; nothing was written to ChatSpace.
    const calls = callsTo((await hub().journal(mark)).entries, 'aiFeatureStream');
    expect(calls.map((entry) => [entry.status, entry.token?.client])).toEqual([[200, 'chat-extension']]);
    expect(await composerText(a1)).toBe('');
  });

  it('[AI-020] [AI-120] «Вставить» of the first part: exactly that part is in the composer of the result’s chat, and nowhere else', async () => {
    const ready = await dockIs((d) => d.hits['insert:0'] !== undefined, 'the first part can be inserted');
    await press(ready, 'insert:0');
    await browser.waitUntil(async () => (await composerText(a1)) === REPLY_PARTS[0], { timeout: 10_000, timeoutMsg: `the composer of the chat holds «${String(await composerText(a1))}», not the first part` });
    const inserted = await dockIs((d) => d.result?.inserted === 1, 'the part is marked inserted');
    expect(inserted.result).toMatchObject({ parts: 2, inserted: 1, state: 'done' });
    // The human sends: the extension put nothing into ChatSpace's own send queue and asked the stand nothing.
    expect(JSON.stringify(await callStand('pendingMessages'))).not.toContain(REPLY_PARTS[0]);
    expect(foreignCalls((await standServer.journal(journalStart)).entries)).toEqual([]);
  });

  it('[HK-002] [HK-026] a key of ours in the native composer: the early dispatcher takes ⌘I before the editor (no italic) and Fix starts for the draft', async () => {
    const mark = await hub().mark();
    await $(ACTIVE_EDITOR).click();
    await dockIs((d) => d.actions['fix'] === true, 'Fix is on: the composer holds a draft');
    await browser.keys([MOD, 'i']);
    const done = await dockIs((d) => d.result !== null && d.result.feature === 'fix' && d.result.state === 'done', 'the Fix result', 20_000);
    expect(done.result?.error).toBeNull();
    expect(callsTo((await hub().journal(mark)).entries, 'aiFeatureStream').map((entry) => entry.status)).toEqual([200]);
    // TipTap never saw the key: the editor is not in italic.
    expect((await callStand('composerState', accountA, a1))?.marks['italic'] ?? false).toBe(false);
    // The draft is the person's to replace: Fix wrote nothing by itself.
    expect(await composerText(a1)).toBe(REPLY_PARTS[0]);
  });

  it('[HK-036] [EX-009] ⌘K opens the palette: the window’s chunk is loaded on demand and mounted on the modal layer; Esc closes it', async () => {
    await browser.keys([MOD, 'k']);
    const open = await dockIs((d) => d.overlays.includes('palette') && d.surfaces.includes('palette'), 'the palette is open');
    expect(open.views).toContain('palette');
    // While our window is open, ChatSpace's Esc must not close the chat tab: the host says so.
    const hosts = await browser.execute(() => [...document.querySelectorAll('[data-cg="overlay"]')].map((host) => host.hasAttribute('data-dismissible-open')));
    expect(hosts.some(Boolean)).toBe(true);
    // The window's host is a child of <html>, outside the page's application root: it is given the font of the
    // place the dock sits in, so our window is drawn in the same font as our dock.
    const fonts = await browser.execute(() => {
      const dock = document.querySelector('[data-cg="dock"]');
      const modal = document.querySelector<HTMLElement>('[data-cg="overlay"][data-cg-layer="modal"]');
      return { beside: dock?.parentElement ? getComputedStyle(dock.parentElement).fontFamily : null, modal: modal ? getComputedStyle(modal).fontFamily : null, inline: modal?.style.fontFamily ?? '' };
    });
    expect(fonts.inline).not.toBe('');
    expect(fonts.modal).toBe(fonts.beside);
    await browser.keys(Key.Escape);
    const closed = await dockIs((d) => !d.overlays.includes('palette') && !d.surfaces.includes('palette'), 'the palette is closed');
    expect(closed.status).toBe('ready');
    expect((await callStand('route')).chatId).toBe(a1);
    expect(await browser.execute(() => [...document.querySelectorAll('[data-cg="overlay"]')].some((host) => host.hasAttribute('data-dismissible-open')))).toBe(false);
  });

  it('[ST-122] [I18-001] the theme, the language and «Вид ответа» follow the settings at once, without a reload', async () => {
    const before = await dockIs((d) => d.status === 'ready', 'the dock');
    expect(before).toMatchObject({ language: 'ru', resultStyle: 'bare' });
    const other = before.scheme === 'dark' ? 'light' : 'dark';
    await settingsPatch({ ui: { theme: other, locale: 'en', resultStyle: 'sheet' } });
    const changed = await dockIs((d) => d.scheme === other && d.language === 'en' && d.resultStyle === 'sheet', 'the dock took the new theme, language and result style');
    expect(changed.status).toBe('ready');
    await settingsPatch({ ui: { theme: 'host', locale: 'ru', resultStyle: 'bare' } });
    await dockIs((d) => d.scheme === before.scheme && d.language === 'ru' && d.resultStyle === 'bare', 'the dock is back');
  });

  it('[UI-012] another chat has its own dock state: the first chat’s result does not follow, and comes back with its chat', async () => {
    await callStand('openChat', accountA, a2, { newTab: true });
    await waitForChatReady(accountA, a2);
    const other = await dockIs((d) => d.status === 'ready' && d.target !== null && d.target.endsWith(`:${a2}`), 'the dock of the second chat');
    expect(other.result).toBeNull();
    expect(await composerText(a2)).toBe('');
    await callStand('openChat', accountA, a1);
    const back = await dockIs((d) => d.target !== null && d.target.endsWith(`:${a1}`) && d.result !== null, 'the first chat’s result is back');
    expect(back.result?.state).toBe('done');
    expect(await composerText(a1)).toBe(REPLY_PARTS[0]);
  });

  it('[AI-060] [UI-014] the Recap button opens the Recap sheet and generates nothing; Esc hides it', async () => {
    const mark = await hub().mark();
    const dock = await dockIs((d) => d.status === 'ready' && d.hits['action:recap'] !== undefined, 'the Recap button is on screen');
    await press(dock, 'action:recap');
    const open = await dockIs((d) => d.analysis === 'recap', 'the Recap sheet is open');
    expect(open.result).toBeNull();
    // Nothing is saved for this fan: the sheet offers to build one — it did not build it.
    expect(callsTo((await hub().journal(mark)).entries, 'aiFeatureStream')).toEqual([]);
    await browser.keys(Key.Escape);
    await dockIs((d) => d.analysis === null, 'the Recap sheet is hidden');
    expect((await callStand('route')).chatId).toBe(a1);
  });

  it('[AI-080] the Coach button opens the Coach panel on the panel layer and asks nothing; Esc closes it', async () => {
    const mark = await hub().mark();
    const dock = await dockIs((d) => d.hits['action:coach'] !== undefined, 'the Coach button is on screen');
    await press(dock, 'action:coach');
    const open = await dockIs((d) => d.overlays.includes('coach') && d.surfaces.includes('coach'), 'the Coach panel is open');
    expect(open.views).toContain('coach');
    expect(callsTo((await hub().journal(mark)).entries, 'aiFeatureStream')).toEqual([]);
    await browser.keys(Key.Escape);
    await dockIs((d) => !d.overlays.includes('coach') && !d.surfaces.includes('coach'), 'the Coach panel is closed');
  });

  it('[SP-001] [HK-012] the Spenders key opens the board: its controllers and its window come with the first show; Esc closes it and the chat stays', async () => {
    const before = await dockIs((d) => d.status === 'ready', 'the dock');
    expect(before.views).not.toContain('spenders.board');
    await browser.keys([...PANEL, 'm']);
    const open = await dockIs((d) => d.overlays.includes('spenders') && d.surfaces.includes('spenders'), 'the Spenders window is open', 20_000);
    for (const view of ['spenders.board', 'spenders.stats', 'preview', 'newcomers', 'fan-panel']) expect(open.views).toContain(view);
    await browser.keys(Key.Escape);
    const closed = await dockIs((d) => !d.overlays.includes('spenders') && !d.surfaces.includes('spenders'), 'the Spenders window is closed');
    expect(closed.status).toBe('ready');
    expect((await callStand('route')).chatId).toBe(a1);
  });
});
