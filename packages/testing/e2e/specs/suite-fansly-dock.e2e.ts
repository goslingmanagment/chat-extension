import type { DiagnosticsSnapshot } from '@cg/contracts/tab-messages';
import { testBuildPage } from '../support/fake-hub';
// Our dock on Fansly's stand (R20 P7d; docs/project-unite/architecture.md
// §7.3, §7.8, §7.12; FS-PLC-1…7, FS-DOCK-2, FS-DOCK-3, FS-CTR-2; plan.md §3
// `suite-fansly-dock`): where the dock and our overlays live on a Fansly
// page, in Firefox, next to the FBuddy-like neighbour (X34).
// - Fansly's own start in a sandbox of the page (support/fansly-tap.ts, the
//   `port` consumer — the start the extension makes, without the extension):
//   200 chat switches with the observers' callbacks counted and the host moved
//   once per switch; a field outside the container's chain — a fixed overlay
//   and the anchor `missing` in the contract; a late start.
// - The extension's test build with Fansly switched on for the stand: the
//   dock in flow right before Fansly's composer, our UI in its closed root,
//   the same host through a chat switch, a field and a contact block made
//   anew, the DM rules unmet (copy only), the gallery, the inbox and the
//   mini-chat (no dock), the feed's bottom by Fansly's 350 px, the typing
//   line over the dock, the narrow column of the neighbour's panel, our
//   overlay layers over Fansly's modals and the dock under them (X46);
//   screenshots in both themes in
//   .cache/e2e/ (suite-fansly-dock-*.png).
// Nobody is signed in: the dock shows its first-run state — this spec is
// about its place, not its features (they come with P8*).

import { $, browser, expect } from '@wdio/globals';
import { mkdirSync } from 'node:fs';

import { E2E_EVIDENCE_DIR } from '../../src/stand/paths';
import type { ListView } from '../../fixture-fansly/src/protocol';
import { MOD } from '../support/chat';
import { installTestBuild, pageRpc, readReport, waitForReport, type DockReport, type SpikeReport } from '../support/extension';
import { openWithNeighbor, setFanslyNeighbor } from '../support/fansly-neighbor';
import { switchFanslyOnForTheStand } from '../support/fansly-site';
import { FANSLY_MAIN, callFansly, fakeFansly, fanslyIds, fanslyStandServer, openFanslyStand, waitForFanslyStandIdle } from '../support/fansly-stand';
import { injectFanslyConsumer, injectFanslyMain, installFanslyTapHarness, tap, waitForFanslyTap, waitForTap, type FanslyTapHarness } from '../support/fansly-tap';
import { useNetworkTrap } from '../support/network-trap';
import { oursText } from '../support/ours';
import { setViewport } from '../support/visual';

type Ids = Awaited<ReturnType<typeof fanslyIds>>;

const DOCK = '[data-host="dock"]';

/** Where our dock host stands in the page: read from the page's own DOM (the host is ours, its root is closed). */
interface Place {
  readonly hosts: number;
  readonly connected: boolean;
  readonly parent: string | null;
  readonly next: string | null;
  readonly inRoute: boolean;
  readonly inMiniChat: boolean;
  readonly mode: string | null;
  readonly className: string;
  readonly position: string;
  readonly zIndex: string;
  readonly flex: string;
  readonly width: number;
  readonly containerWidth: number;
  readonly height: number;
  readonly top: number;
  /** The same host element the page saw first (marked in the page's realm). */
  readonly same: boolean;
}

async function place(): Promise<Place> {
  return browser.execute((selector: string) => {
    const hosts = document.querySelectorAll(selector);
    const host = hosts[0] as HTMLElement | undefined;
    const marks = ((window as unknown as { __cgDockMarks?: WeakSet<Element> }).__cgDockMarks ??= new WeakSet<Element>());
    const first = (window as unknown as { __cgDockFirst?: boolean }).__cgDockFirst;
    if (host !== undefined && first === undefined) {
      marks.add(host);
      (window as unknown as { __cgDockFirst?: boolean }).__cgDockFirst = true;
    }
    const style = host === undefined ? null : getComputedStyle(host);
    const rect = host?.getBoundingClientRect();
    const container = document.querySelector('app-messages-conversation-route > app-group-message-container');
    return {
      hosts: hosts.length,
      connected: host?.isConnected === true,
      parent: host?.parentElement?.localName ?? null,
      next: host?.nextElementSibling?.localName ?? null,
      inRoute: host?.closest('app-messages-conversation-route') !== null && host !== undefined,
      inMiniChat: host?.closest('app-messaging-overlay') !== null && host !== undefined,
      mode: host?.getAttribute('data-mode') ?? null,
      className: host?.className ?? '',
      position: style?.position ?? '',
      zIndex: style?.zIndex ?? '',
      flex: style === null ? '' : `${style.flexGrow} ${style.flexShrink} ${style.flexBasis}`,
      width: Math.round(rect?.width ?? 0),
      containerWidth: Math.round(container?.getBoundingClientRect().width ?? 0),
      height: Math.round(rect?.height ?? 0),
      top: Math.round(rect?.top ?? 0),
      same: host !== undefined && marks.has(host),
    };
  }, DOCK);
}

/** Three steps of the palette our dock host wears (its `:host` rule, read from the page): ink 900, page 950, blue 500. */
const hostPalette = (): Promise<{ ink: string; page: string; blue: string }> =>
  browser.execute((selector: string) => {
    const host = document.querySelector(selector);
    const style = host === null ? null : getComputedStyle(host);
    const step = (name: string): string => style?.getPropertyValue(`--color-om-${name}`).trim() ?? '';
    return { ink: step('neutral-900'), page: step('neutral-950'), blue: step('brand-500') };
  }, DOCK);

const forgetMark = (): Promise<void> => browser.execute(() => void Reflect.deleteProperty(window, '__cgDockFirst'));

const list = async (): Promise<ListView> => {
  const view = await callFansly('list');
  if (view === null) throw new Error('no main list');
  return view;
};
const fromBottom = (view: ListView): number => view.scrollHeight - view.clientHeight - view.scrollTop;

/** Scrolls the main list to `px` above its bottom and waits for its scroll event to be handled (ours and the page's). */
async function scrollFromBottom(px: number): Promise<ListView> {
  await browser.execute(
    async (selector: string, away: number) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (element === null) throw new Error('no list');
      const target = Math.max(1, element.scrollHeight - element.clientHeight - away);
      if (Math.abs(element.scrollTop - target) < 1) element.scrollTop = target + 1;
      await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
      const scrolled = new Promise((resolve) => element.addEventListener('scroll', resolve, { once: true }));
      element.scrollTop = target;
      await scrolled;
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
    FANSLY_MAIN.list,
    px,
  );
  return list();
}

/** The dock grows by `px` (as a result that opens would make it), then two frames pass. */
async function growDock(px: number): Promise<void> {
  await browser.execute(
    async (selector: string, by: number) => {
      const host = document.querySelector<HTMLElement>(selector);
      if (host === null) throw new Error('no dock');
      host.style.setProperty('min-height', `${host.getBoundingClientRect().height + by}px`);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    },
    DOCK,
    px,
  );
}
const ungrowDock = (): Promise<void> => browser.execute((selector: string) => void document.querySelector<HTMLElement>(selector)?.style.removeProperty('min-height'), DOCK);

const dockShown = (what: string, predicate: (dock: DockReport) => boolean = () => true): Promise<SpikeReport> =>
  waitForReport((report) => report.dock !== undefined && report.dock.strip && predicate(report.dock), what, 20_000);

/**
 * The dock's box as a person sees it. Until MAIN names the open chat's fan (its observation, P7b) the dock has no chat
 * and draws nothing: the host then stands in for the strip with the strip's own 40 px, so where it stands can be
 * hit-tested all the same. Returns whether it stood in.
 */
async function dockBox(): Promise<boolean> {
  return browser.execute((selector: string) => {
    const host = document.querySelector<HTMLElement>(selector);
    if (host === null || host.getBoundingClientRect().height >= 40) return false;
    host.style.setProperty('min-height', '40px');
    return true;
  }, DOCK);
}

async function shoot(name: string): Promise<void> {
  mkdirSync(E2E_EVIDENCE_DIR, { recursive: true });
  await browser.execute(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await browser.pause(200);
  await browser.saveScreenshot(`${E2E_EVIDENCE_DIR}suite-fansly-dock-${name}.png`);
}

// ── Fansly's own start in the page, without the extension ──

interface DockHarness {
  readonly stats: { readonly moves: number; readonly removals: number };
  readonly points: { readonly dock: { readonly kind: string; readonly composerInstanceId: string | null; readonly width: number | null } };
}
interface AnchorHealth {
  readonly isolated: { readonly anchors: { readonly searches: number; readonly searching: boolean; readonly workCallbacks: number; readonly narrowCallbacks: number } };
}
const harnessDock = (): Promise<DockHarness> => tap<DockHarness>('dock');
const anchorStats = async (): Promise<AnchorHealth['isolated']['anchors']> => (await tap<AnchorHealth>('portHealth')).isolated.anchors;

describe('Fansly’s own start places our dock host: 200 chat switches, a broken chain, a late start (R20 P7d)', () => {
  useNetworkTrap();
  let ids: Ids;
  let harness: FanslyTapHarness | null = null;

  before(async () => {
    await setFanslyNeighbor(null);
    await fakeFansly().command({ op: 'reset' });
    await openFanslyStand('/messages');
    ids = await fanslyIds();
  });

  afterEach(async () => {
    await harness?.remove();
    harness = null;
  });

  for (const mode of ['off', 'after'] as const) {
    it(`200 chat switches next to the neighbour ${mode}: one host, moved once per switch, never into a detached container; the observers’ callbacks a few per switch, none while the fan types and writes`, async () => {
      harness = await installFanslyTapHarness({ main: 'start', consumer: 'port' });
      const groups = ids.groups.slice(0, 4);
      await openWithNeighbor(`/messages/${groups[0] ?? ''}`, { mode });
      await waitForFanslyTap();
      await waitForTap(harnessDock, (dock) => dock.points.dock.kind === 'in-flow', 'the dock placed');
      // Every group visited once: from now on the page has each in its cache and makes the container in the same task.
      for (const group of groups) await callFansly('open', group);
      await waitForFanslyStandIdle();
      const before = { ...(await harnessDock()).stats, ...(await anchorStats()) };
      const SWITCHES = 200;
      for (let index = 0; index < SWITCHES; index += 1) await callFansly('open', groups[(index + 1) % groups.length] ?? '');
      await waitForFanslyStandIdle();
      const after = { ...(await harnessDock()).stats, ...(await anchorStats()) };
      console.log(`suite-fansly-dock 200 switches, neighbour ${mode}: moves ${after.moves - before.moves}, work callbacks ${after.workCallbacks - before.workCallbacks}, narrow ${after.narrowCallbacks - before.narrowCallbacks}, searches ${after.searches - before.searches}`);
      expect(after.moves - before.moves).toBe(SWITCHES);
      expect(after.removals).toBe(before.removals);
      expect(after.workCallbacks - before.workCallbacks).toBeLessThanOrEqual(SWITCHES * 3);
      expect(after.narrowCallbacks - before.narrowCallbacks).toBeLessThanOrEqual(SWITCHES * 2);
      expect(after.searches).toBe(before.searches);
      const now = await place();
      expect(now).toMatchObject({ hosts: 1, connected: true, parent: 'app-group-message-container', next: 'app-group-message-input', inRoute: true });
      // Idle: the fan types and writes, the inbox moves — no observer of ours hears a thing.
      const quiet = await anchorStats();
      const group = groups[(SWITCHES % groups.length)] ?? '';
      await callFansly('fanTyping', group);
      await callFansly('fanMessage', group, 'hello');
      await browser.waitUntil(async () => ((await callFansly('list'))?.typing ?? true) === false, { timeout: 10_000, timeoutMsg: 'the typing line gone with the message' });
      await waitForFanslyStandIdle();
      expect(await anchorStats()).toMatchObject({ workCallbacks: quiet.workCallbacks, narrowCallbacks: quiet.narrowCallbacks });
    });
  }

  it('[RB-008] the container’s anchor gone in a new build, a field still under the route: a fixed overlay over the field in <html>, the anchor `missing` in the contract — and back in flow with the next chat', async () => {
    harness = await installFanslyTapHarness({ main: 'start', consumer: 'port' });
    const [first, second] = ids.groups as [string, string];
    await openWithNeighbor(`/messages/${first}`, { mode: 'off' });
    await waitForFanslyTap();
    await waitForTap(harnessDock, (dock) => dock.points.dock.kind === 'in-flow', 'the dock placed');
    await browser.execute(() => {
      const container = document.querySelector('app-messages-conversation-route > app-group-message-container');
      if (container === null) throw new Error('no container');
      const renamed = document.createElement('app-group-message-container-v2');
      renamed.setAttribute('style', 'display:flex;flex-direction:column;flex:1;min-height:0');
      renamed.append(...container.childNodes);
      container.replaceWith(renamed);
    });
    const dock = await waitForTap(harnessDock, (now) => now.points.dock.kind === 'fixed-overlay', 'the dock as a fixed overlay');
    expect(dock.points.dock.width).toBeGreaterThan(200);
    expect(await place()).toMatchObject({ parent: 'html', mode: 'overlay', position: 'fixed', zIndex: '900' });
    // Over the field, not over the feed: its bottom edge is the field's top.
    const field = await browser.execute(() => document.querySelector('app-group-message-input')?.getBoundingClientRect().top ?? 0);
    const where = await place();
    expect(Math.abs(where.top + where.height - field)).toBeLessThanOrEqual(1);
    const report = await tap<{ extensions: { 'fansly-web': { anchors: Record<string, string> } } }>('report');
    expect(report.extensions['fansly-web'].anchors['container']).toBe('missing');
    await callFansly('open', second);
    await waitForTap(harnessDock, (now) => now.points.dock.kind === 'in-flow', 'back in flow');
    expect(await place()).toMatchObject({ parent: 'app-group-message-container', next: 'app-group-message-input', mode: null, position: 'relative' });
  });

  it('a late start — both worlds injected into a chat already on screen (an install or an update under an open tab): the dock comes right before the composer at once, the search over the document ends', async () => {
    const [first] = ids.groups as [string];
    await openWithNeighbor(`/messages/${first}`, { mode: 'after' });
    await waitForFanslyStandIdle();
    await injectFanslyMain();
    await injectFanslyConsumer('port');
    await waitForFanslyTap();
    await waitForTap(harnessDock, (dock) => dock.points.dock.kind === 'in-flow', 'the dock placed after a late start');
    expect(await place()).toMatchObject({ hosts: 1, parent: 'app-group-message-container', next: 'app-group-message-input' });
    expect(await anchorStats()).toMatchObject({ searching: false });
  });

  it('a group chat is not a dock’s place (FS-DOCK-2): MAIN names the group a group, and the dock leaves', async function () {
    harness = await installFanslyTapHarness({ main: 'start', consumer: 'port' });
    const [first, second] = ids.groups as [string, string];
    await openWithNeighbor(`/messages/${first}`, { mode: 'off' });
    await waitForFanslyTap();
    await waitForTap(harnessDock, (dock) => dock.points.dock.kind === 'in-flow', 'the dock placed');
    // Whether MAIN observes chats is its own word, its answer to the focus. Only an observing MAIN (P7b) names a
    // group's kind; before it the chat is honestly unknown and nothing here can be proven: pending, not passed.
    const answered = await waitForTap(() => tap<{ capabilities: { chatWindow: { state: string; reason?: string } } }>('report'), (r) => r.capabilities.chatWindow.reason !== 'focus', 'MAIN’s answer to the focus');
    if (answered.capabilities.chatWindow.state !== 'on') {
      console.log('suite-fansly-dock: MAIN does not observe chats on this build (before P7b) — the group chat check is pending');
      this.skip();
    }
    await waitForTap(() => tap<{ route: { conversationKind?: string } }>('port'), (view) => view.route.conversationKind === 'direct', 'the first chat direct');
    try {
      // The group gains a second fan; the page reads it anew, and MAIN with it.
      await callFansly('open', second);
      await callFansly('setPartners', first, 2);
      await openWithNeighbor(`/messages/${first}`, { mode: 'off' });
      await waitForFanslyTap();
      await waitForTap(() => tap<{ route: { conversationKind?: string } }>('port'), (view) => view.route.conversationKind === 'group', 'MAIN names the group a group');
      await waitForTap(harnessDock, (dock) => dock.points.dock.kind === 'none', 'no dock in a group chat');
      expect((await place()).connected).toBe(false);
    } finally {
      await callFansly('setPartners', first, 1);
    }
  });
});

// ── The extension ──

describe('our dock on Fansly’s stand, the extension’s test build (R20 P7d)', () => {
  useNetworkTrap();
  let ids: Ids;
  let journalStart = 0;

  before(async () => {
    await setFanslyNeighbor(null);
    await fakeFansly().command({ op: 'reset' });
    journalStart = await fanslyStandServer.mark();
    await installTestBuild();
    await switchFanslyOnForTheStand();
    await openFanslyStand('/messages');
    ids = await fanslyIds();
  });

  after(async () => {
    await setViewport(null);
    // Nothing of the extension asked the Fansly stand for anything.
    const entries = await fanslyStandServer.journal(journalStart);
    expect(entries.filter((entry) => entry.origin !== 'asset')).toEqual([]);
    await setFanslyNeighbor(null);
    await browser.url('about:blank');
  });

  for (const mode of ['off', 'after'] as const) {
    it(`[UI-001] [EX-013] [EX-012] [I18-005] next to the neighbour ${mode}: the dock in flow right before Fansly’s composer, a plain host over the typing line; our UI in its closed root with adopted sheets, nothing of ours in the page’s styles; both themes with the page’s palette`, async () => {
      const [first] = ids.groups as [string];
      await setViewport({ width: 1440, height: 900 });
      await openWithNeighbor(`/messages/${first}`, { mode });
      const report = await dockShown(`our dock on the stand (neighbour ${mode})`);
      expect(report.appError).toBeUndefined();
      const dock = report.dock as DockReport;
      expect([dock.kind, dock.styleMode, dock.strip]).toEqual(['in-flow', 'adopted', true]);
      expect(await place()).toMatchObject({ hosts: 1, parent: 'app-group-message-container', next: 'app-group-message-input', inRoute: true, className: '', mode: null, position: 'relative', zIndex: '3', flex: '0 0 auto' });
      const where = await place();
      expect(Math.abs(where.width - where.containerWidth)).toBeLessThanOrEqual(1);
      // Nothing global: no stylesheet of ours in the document, none adopted by it (FS-PLC-7).
      const global = await browser.execute(() => ({
        styles: [...document.querySelectorAll('style, link[rel="stylesheet"]')].filter((node) => (node.textContent ?? '').includes('.cg-')).length,
        adopted: document.adoptedStyleSheets.filter((sheet) => [...sheet.cssRules].some((rule) => rule.cssText.includes('.cg-'))).length,
      }));
      expect(global).toEqual({ styles: 0, adopted: 0 });
      // The page's theme is the dock's (its «как на сайте»): Fansly's class on <html>, dark by default. The palette on our
      // host (R20 P8d, X57): the family's warm ink and page in either theme, Fansly's blue.
      for (const theme of ['bright', 'dark'] as const) {
        await callFansly('setTheme', theme);
        await waitForReport((now) => now.dock?.scheme === (theme === 'bright' ? 'light' : 'dark'), `the dock in the ${theme} theme`);
        const expected = { ink: '38 36 32', page: '27 26 23', blue: '38 153 247' };
        await browser.waitUntil(async () => JSON.stringify(await hostPalette()) === JSON.stringify(expected), { timeout: 5_000, timeoutMsg: `the ${theme} palette on our host: ${JSON.stringify(expected)}` });
        await shoot(`${mode}-${theme}-1440x900`);
      }
      await callFansly('setTheme', 'bright');
    });
  }

  it('[FS-SET-2] P14b2: MAIN observations reach diagnostics.get through the installed tab and background', async () => {
    const [first] = ids.groups as [string];
    await openWithNeighbor(`/messages/${first}`, { mode: 'after' });
    await dockShown('the dock before reading page diagnostics');
    const tab = await browser.getWindowHandle();
    await browser.newWindow(testBuildPage());
    try {
      let snapshot: DiagnosticsSnapshot | null = null;
      await browser.waitUntil(async () => {
        const answer = await pageRpc<DiagnosticsSnapshot>('diagnostics.get');
        if (answer.ok) snapshot = answer.payload;
        return answer.ok && answer.payload.tabs.some((entry) => entry.site === 'fansly-web' && entry.page?.mainAvailable === true && entry.conversationRef === first);
      }, { timeout: 15_000, timeoutMsg: 'Fansly observations did not reach the background diagnostics' });
      const row = (snapshot as DiagnosticsSnapshot | null)?.tabs.find((entry) => entry.site === 'fansly-web');
      expect(row?.page?.counters['main.frames.seen']).toBeGreaterThanOrEqual(0);
      expect(typeof row?.page?.companion?.wordFilter).toBe('boolean');
      expect(row?.networkSession).toHaveProperty('headerNames');
      expect(row?.networkSession).not.toHaveProperty('headers');
      expect(row?.networkSession).not.toHaveProperty('cookie');
      expect((snapshot as DiagnosticsSnapshot | null)?.siteAccess?.[0]).toMatchObject({ host: 'fansly-web', enabled: true });
    } finally {
      await browser.closeWindow();
      await browser.switchToWindow(tab);
    }
  });

  it('[FS-PLC-2] a chat switch moves the same host into the new container; a field made anew, a contact block made anew — the host stays one, in its place', async () => {
    const [first, second] = ids.groups as [string, string];
    await openWithNeighbor(`/messages/${first}`, { mode: 'after' });
    await dockShown('the dock');
    await forgetMark();
    expect(await place()).toMatchObject({ same: true, next: 'app-group-message-input' });
    await callFansly('open', second);
    await browser.waitUntil(async () => (await callFansly('route')).groupId === second && (await place()).next === 'app-group-message-input', { timeout: 10_000, timeoutMsg: 'the dock in the second chat' });
    expect(await place()).toMatchObject({ hosts: 1, same: true, parent: 'app-group-message-container' });
    await callFansly('recreateField');
    await browser.pause(100);
    expect(await place()).toMatchObject({ hosts: 1, same: true, next: 'app-group-message-input' });
    await callFansly('setPartners', second, 2);
    await browser.pause(100);
    await callFansly('setPartners', second, 1);
    await browser.pause(100);
    expect(await place()).toMatchObject({ hosts: 1, same: true, next: 'app-group-message-input' });
    expect((await readReport())?.dock?.kind).toBe('in-flow');
  });

  it('[UI-027] the DM rules unmet without a change of address: the dock stays in its place, copy only — and back', async () => {
    const [first] = ids.groups as [string];
    await openWithNeighbor(`/messages/${first}`, { mode: 'off' });
    await dockShown('the dock');
    await forgetMark();
    await place();
    await callFansly('setDmRulesUnmet', first, true);
    await waitForReport((report) => report.dock?.kind === 'copy-only-row', 'copy only');
    expect(await place()).toMatchObject({ same: true, mode: 'copy-only', next: 'app-group-message-input' });
    await callFansly('setDmRulesUnmet', first, false);
    await waitForReport((report) => report.dock?.kind === 'in-flow', 'back in flow');
    expect(await place()).toMatchObject({ same: true, mode: null, next: 'app-group-message-input' });
  });

  it('[UI-012] no dock in the gallery, the inbox or the mini-chat; back with the chat', async () => {
    const [first, second] = ids.groups as [string, string];
    await openWithNeighbor(`/messages/${first}?stand-mini=${second}`, { mode: 'after' });
    await dockShown('the dock');
    expect(await place()).toMatchObject({ hosts: 1, inMiniChat: false, inRoute: true });
    await callFansly('setGallery', true);
    await waitForReport((report) => report.dock?.kind === 'none', 'no dock in the gallery');
    expect((await place()).connected).toBe(false);
    await callFansly('setGallery', false);
    await waitForReport((report) => report.dock?.kind === 'in-flow', 'the dock back from the gallery');
    await callFansly('openInbox');
    await waitForReport((report) => report.dock?.kind === 'none', 'no dock on the inbox');
    expect(await place()).toMatchObject({ connected: false, inMiniChat: false });
    await callFansly('open', first);
    await waitForReport((report) => report.dock?.kind === 'in-flow', 'the dock with the chat');
    expect(await place()).toMatchObject({ connected: true, inMiniChat: false });
  });

  it('[UI-016] the feed’s bottom by Fansly’s own 350 px: within it the dock’s growth keeps the feed at its bottom, farther it is left where it is; `scrollTop = 0` is never written', async () => {
    await openWithNeighbor(`/messages/${ids.longHistory}`, { mode: 'off' });
    await dockShown('the dock');
    await browser.waitUntil(async () => (await list()).messages >= 25 && fromBottom(await list()) <= 1, { timeout: 10_000, timeoutMsg: 'the long chat at its bottom' });
    await waitForFanslyStandIdle();
    const since = (await callFansly('journal')).at(-1)?.seq ?? 0;
    // 300 px up: within Fansly's 350 — the dock's growth keeps the feed at its bottom (the page alone would not: 1 px).
    await scrollFromBottom(300);
    await growDock(200);
    await browser.waitUntil(async () => fromBottom(await list()) <= 1, { timeout: 2000, timeoutMsg: 'the feed kept at its bottom from 300 px' });
    await ungrowDock();
    // 450 px up: the person reads the history — the growth leaves the feed where it is.
    const away = await scrollFromBottom(450);
    await growDock(200);
    await browser.pause(300);
    expect((await list()).scrollTop).toBe(away.scrollTop);
    await ungrowDock();
    // No older page was asked for: nothing of ours put the feed at its top.
    const older = (await callFansly('journal', since)).filter((entry) => entry.type === 'api' && /&before=/.test(String(entry['path'])));
    expect(older).toEqual([]);
  });

  it('the typing line stands over the feed’s bottom edge, the dock over the line: neither hides the other', async () => {
    const [first] = ids.groups as [string];
    await openWithNeighbor(`/messages/${first}`, { mode: 'off' });
    await dockShown('the dock');
    const stoodIn = await dockBox();
    // The page's socket verified: the fan's typing reaches it.
    await waitForFanslyStandIdle();
    await callFansly('fanTyping', first);
    await browser.waitUntil(async () => (await callFansly('list'))?.typing === true, { timeout: 10_000, interval: 100, timeoutMsg: 'the typing line' });
    const layout = await browser.execute((selector: string) => {
      const host = document.querySelector<HTMLElement>(selector);
      const line = document.querySelector<HTMLElement>('app-messages-conversation-route .partner-is-typing');
      const inner = line?.firstElementChild?.getBoundingClientRect();
      const dock = host?.getBoundingClientRect();
      if (host === null || line === null || inner === undefined || dock === undefined) return null;
      const at = (x: number, y: number): Element | null => document.elementFromPoint(x, y);
      const lineHit = at(inner.left + Math.min(10, inner.width / 2), inner.top + inner.height / 2);
      return {
        order: line.compareDocumentPosition(host) === Node.DOCUMENT_POSITION_FOLLOWING,
        lineAbove: inner.bottom <= dock.top + 1,
        lineSeen: lineHit !== null && line.contains(lineHit),
        dockSeen: at(dock.left + dock.width / 2, dock.top + Math.min(dock.height / 2, 10)) === host,
        zIndex: [getComputedStyle(line).zIndex, getComputedStyle(host).zIndex],
      };
    }, DOCK);
    expect(layout).toEqual({ order: true, lineAbove: true, lineSeen: true, dockSeen: true, zIndex: ['2', '3'] });
    await shoot('typing-bright-1440x900');
    if (stoodIn) await ungrowDock();
  });

  it('a narrow column — the neighbour’s panel beside the chat: the dock as wide as the column, still right before the field; its height owes nothing to the field FBuddy makes two lines high', async () => {
    const [first] = ids.groups as [string];
    await setViewport({ width: 1280, height: 800 });
    const composerHeight = (): Promise<number> => browser.execute((selector: string) => Math.round(document.querySelector(selector)?.getBoundingClientRect().height ?? 0), FANSLY_MAIN.composer);
    await openWithNeighbor(`/messages/${first}`, { mode: 'off' });
    await dockShown('the dock without the neighbour');
    const alone = { ...(await place()), composer: await composerHeight() };
    await openWithNeighbor(`/messages/${first}`, { mode: 'after' });
    await dockShown('the dock next to the neighbour');
    await browser.waitUntil(async () => (await composerHeight()) > alone.composer, { timeout: 5000, timeoutMsg: 'the neighbour’s two-line field' });
    const beside = { ...(await place()), composer: await composerHeight() };
    expect(beside.height).toBe(alone.height);
    await openWithNeighbor(`/messages/${first}`, { mode: 'after', panel: 'desktop' });
    await dockShown('the dock beside the panel');
    await browser.waitUntil(async () => (await place()).containerWidth < alone.containerWidth, { timeout: 5000, timeoutMsg: 'the column narrowed by the panel' });
    const narrow = await place();
    console.log(`suite-fansly-dock narrow column: ${alone.containerWidth} → ${narrow.containerWidth} px; dock ${alone.height}/${beside.height}/${narrow.height} px high; field ${alone.composer} → ${beside.composer} px`);
    expect(narrow).toMatchObject({ parent: 'app-group-message-container', next: 'app-group-message-input' });
    expect(Math.abs(narrow.width - narrow.containerWidth)).toBeLessThanOrEqual(1);
    // Nothing of ours sticks out of the column.
    const overflow = await browser.execute((selector: string) => {
      const container = document.querySelector(selector)?.parentElement;
      return container === null || container === undefined ? null : container.scrollWidth - container.clientWidth;
    }, DOCK);
    expect(overflow).toBe(0);
    await shoot('narrow-bright-1280x800');
    await setViewport(null);
  });

  it('the palette is ChatSpace’s: on Fansly its key opens no window of ours and asks for no chunk Fansly’s build has not — nothing fails, nothing is said', async () => {
    const [first] = ids.groups as [string];
    await openWithNeighbor(`/messages/${first}`, { mode: 'off' });
    await dockShown('the dock');
    await $(FANSLY_MAIN.field).click();
    await browser.keys([MOD, 'k']);
    // A chunk that does not load fails after its one retry (≈ 0.5 s): wait past it.
    await browser.pause(1500);
    const report = await readReport();
    expect(report?.['surfaceError']).toBeUndefined();
    expect(report?.dock?.overlays ?? []).not.toContain('palette');
    expect(await browser.execute(() => document.querySelector('[data-host="overlay"][data-layer="modal"]') !== null)).toBe(false);
    expect(await oursText('toast')).not.toMatch(/CG-UI-FAILED|Сбой интерфейса/);
  });

  it('[UI-017] [CS-005] our overlay layers: hosts in <html> outside Fansly’s app, fixed, 1900/1950/1960 — over its feed, mini-chat, modals, menus and cards, under its alerts and FBuddy’s layer (X46)', async () => {
    const [first, second] = ids.groups as [string, string];
    await openWithNeighbor(`/messages/${first}?stand-mini=${second}`, { mode: 'after' });
    await dockShown('the dock');
    // The toasts' layer comes with the application; the others with their first window.
    await browser.waitUntil(async () => browser.execute(() => document.querySelector('[data-host="overlay"][data-layer="toast"]') !== null), { timeout: 5000, timeoutMsg: 'the toast layer' });
    const layers = await browser.execute(() => {
      const ours = [...document.querySelectorAll<HTMLElement>('[data-host="overlay"]:not([data-layer="launcher"])')].map((host) => ({
        layer: host.getAttribute('data-layer'),
        parent: host.parentElement === document.documentElement,
        position: getComputedStyle(host).position,
        z: Number(getComputedStyle(host).zIndex),
        clickThrough: getComputedStyle(host).pointerEvents === 'none',
      }));
      const z = (selector: string): number | null => {
        const node = document.querySelector(selector);
        return node === null ? null : Number(getComputedStyle(node).zIndex);
      };
      return { ours, modal: z('.modal-wrapper'), alerts: z('.alert-wrapper'), mini: z('app-messaging-overlay'), neighbour: z('body > [style*="isolation"]') };
    });
    expect(layers.ours.length).toBeGreaterThan(0);
    for (const layer of layers.ours) {
      expect(layer).toMatchObject({ parent: true, position: 'fixed', clickThrough: true });
      expect([1900, 1950, 1960]).toContain(layer.z);
      // Over Fansly's modals (998) and its menus and cards (999–1000), as the old extension's were.
      expect(layer.z).toBeGreaterThan(1000);
      if (layers.modal !== null) expect(layer.z).toBeGreaterThan(layers.modal);
      if (layers.alerts !== null) expect(layer.z).toBeLessThan(layers.alerts);
      if (layers.mini !== null) expect(layer.z).toBeGreaterThan(layers.mini);
      if (layers.neighbour !== null) expect(layer.z).toBeLessThan(layers.neighbour);
    }
    expect(layers.modal).toBe(998);
    // The dock stays the page's: a modal of Fansly's opened over the chat takes the point where the dock stands.
    await browser.execute((selector: string) => {
      const input = document.querySelector<HTMLInputElement>(`${selector} input[type="file"]`);
      if (input === null) throw new Error('no file input');
      const files = new DataTransfer();
      files.items.add(new File(['x'], 'probe.png', { type: 'image/png' }));
      input.files = files.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, FANSLY_MAIN.composer);
    await browser.waitUntil(async () => (await callFansly('modals')).length > 0, { timeout: 5000, timeoutMsg: 'Fansly’s upload modal' });
    const onDock = await browser.execute((selector: string) => {
      const dock = document.querySelector(selector)?.getBoundingClientRect();
      if (dock === undefined) return null;
      const hit = document.elementFromPoint(dock.left + 8, dock.top + dock.height / 2);
      return { ours: hit !== null && hit.closest('[data-host]') !== null, modal: hit !== null && hit.closest('.modal-wrapper') !== null };
    }, DOCK);
    expect(onDock).toEqual({ ours: false, modal: true });
    await browser.action('pointer').move({ x: 700, y: 40 }).down().up().perform();
    await browser.waitUntil(async () => (await callFansly('modals')).length === 0, { timeout: 5000, timeoutMsg: 'Fansly’s modal did not close' });
  });
});
