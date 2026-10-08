import type { ComposerState } from '@cg/contracts/host';
import { MountPointsSchema } from '@cg/contracts/host';
import { afterEach, describe, expect, it } from 'vitest';

import { createFakePage, type FakePage } from '../testing/fake-page';
import { COMPOSER_SLOT_SELECTOR, createMountManager, findComposerMount, mountClosedHost, OVERLAY_Z, removeStaleHosts, waitForComposerMount, type MountDiagnostic, type MountManager } from './mount';

const ACC = '1001';
const state = (fan: string, over: Partial<ComposerState> = {}): ComposerState => ({
  chat: { host: 'chatspace', hostAccountId: ACC, platformFanId: fan },
  instanceId: `c-${fan}`,
  ready: true,
  hidden: false,
  draft: { revision: 0, provenance: 'empty' },
  ...over,
});
const tick = async (): Promise<void> => {
  for (let i = 0; i < 3; i += 1) await Promise.resolve();
};
/** The time MAIN gets to tell of another composer by itself (RENEWED_SETTLE_MS, short for the tests). */
const SETTLE_MS = 30;
/** MAIN said nothing for its settle time. */
const silence = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS + 15));
  await tick();
};
/** A DOM change reached the mount manager: its observers delivered, its placement ran. */
const settle = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await tick();
};

let manager: MountManager | null = null;
let page: FakePage;
const diagnostics: MountDiagnostic[] = [];

function setup(): MountManager {
  page = createFakePage(document);
  diagnostics.length = 0;
  manager = createMountManager(document, { onDiagnostic: (d) => diagnostics.push(d), firstSearchMs: 50, renewedSettleMs: SETTLE_MS });
  return manager;
}

afterEach(() => {
  manager?.dispose();
  manager = null;
  document.body.replaceChildren();
  for (const host of document.querySelectorAll('[data-cg]')) host.remove();
});

describe('[UI-001] the dock docks in flow above the active composer (§6.3)', () => {
  it('is the first child of the frame root of the ONE visible composer among v-show ones, never inside the slot', async () => {
    const mounts = setup();
    const a = page.addComposer(ACC, '2002', { shown: false });
    const b = page.addComposer(ACC, '2003');
    mounts.update(state('2003'));
    await tick();
    expect(mounts.dock.host.parentElement).toBe(b.root);
    expect(b.root.firstChild).toBe(mounts.dock.host);
    expect(b.slot.childNodes).toHaveLength(0);
    expect(a.root.contains(mounts.dock.host)).toBe(false);
    expect(mounts.dock.host.shadowRoot).toBeNull();
    expect(MountPointsSchema.parse(mounts.points())).toMatchObject({ dock: { kind: 'in-flow', composerInstanceId: 'c-2003', width: 720 } });
  });

  it('follows chat switches: the same host (same closed root) moves to the newly active composer', async () => {
    const mounts = setup();
    const a = page.addComposer(ACC, '2002');
    const b = page.addComposer(ACC, '2003', { shown: false });
    const root = mounts.dock.root;
    const seen: string[] = [];
    mounts.onChange((points) => seen.push(`${points.dock.kind}:${points.dock.composerInstanceId}`));
    mounts.update(state('2002'));
    await tick();
    expect(a.root.firstChild).toBe(mounts.dock.host);
    page.showOnly(ACC, '2003');
    mounts.update(state('2003'));
    await tick();
    expect(b.root.firstChild).toBe(mounts.dock.host);
    expect(mounts.dock.root).toBe(root);
    expect(document.querySelectorAll('[data-cg="dock"]')).toHaveLength(1);
    expect(seen).toEqual(['in-flow:c-2002', 'in-flow:c-2003']);
  });

  it('a draft revision (one per keystroke) does not re-place the dock; a new composer or «Проверить» does', async () => {
    const mounts = setup();
    const a = page.addComposer(ACC, '2002');
    mounts.update(state('2002'));
    await tick();
    expect(a.root.firstChild).toBe(mounts.dock.host);
    let searches = 0;
    const original = document.querySelectorAll.bind(document);
    Object.defineProperty(document, 'querySelectorAll', { configurable: true, value: (selector: string) => ((searches += selector === COMPOSER_SLOT_SELECTOR ? 1 : 0), original(selector)) });
    try {
      for (let revision = 1; revision <= 5; revision += 1) mounts.update(state('2002', { draft: { revision, provenance: 'human-or-unknown' } }));
      await tick();
      expect(searches).toBe(0);
      mounts.refresh();
      await tick();
      expect(searches).toBeGreaterThan(0);
      searches = 0;
      mounts.update(state('2002', { instanceId: 'c-new' }));
      await tick();
      expect(searches).toBeGreaterThan(0);
      expect(mounts.points().dock.composerInstanceId).toBe('c-new');
    } finally {
      Reflect.deleteProperty(document, 'querySelectorAll');
    }
  });

  it('comes back when Vue re-creates the frame root (childList observer, no subtree)', async () => {
    const mounts = setup();
    const a = page.addComposer(ACC, '2002');
    mounts.update(state('2002'));
    await tick();
    const fresh = a.root.cloneNode(false) as HTMLElement;
    fresh.append(a.frame);
    Object.defineProperty(fresh, 'getBoundingClientRect', { value: () => ({ width: 700, height: 100, left: 0, top: 0 }) });
    Object.defineProperty(fresh, 'checkVisibility', { value: () => true });
    a.tab.replaceChild(fresh, a.root);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await tick();
    expect(fresh.firstChild).toBe(mounts.dock.host);
  });

  it('[RB-008] comes back when ChatSpace renders the composer again after a pause — the same chat, new nodes, nothing new from MAIN', async () => {
    const mounts = setup();
    const a = page.addComposer(ACC, '2002');
    mounts.update(state('2002'));
    await tick();
    expect(a.root.firstChild).toBe(mounts.dock.host);
    // ChatSpace takes the composer area down (a re-mount with a pause: a leave transition, a layout swap, an async part) …
    a.tab.remove();
    await settle();
    expect(mounts.points().dock.kind).toBe('none');
    expect(diagnostics).toContainEqual({ event: 'composer-not-found' });
    // … and renders it again a moment later. MAIN reads the composer on store events, not on DOM ones: it says nothing new.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const b = page.addComposer(ACC, '2002');
    await settle();
    expect(b.root.firstChild).toBe(mounts.dock.host);
    expect(mounts.points().dock).toMatchObject({ kind: 'in-flow', composerInstanceId: 'c-2002' });
  });

  it('[RB-008] comes back after a re-mount whose new composer came in before the old one left (two visible for a moment: none)', async () => {
    const mounts = setup();
    const a = page.addComposer(ACC, '2002');
    mounts.update(state('2002'));
    await tick();
    const b = page.addComposer(ACC, '2002');
    await settle();
    expect(mounts.points().dock.kind).toBe('none');
    expect(diagnostics).toContainEqual({ event: 'composer-ambiguous', count: 2 });
    a.tab.remove();
    await settle();
    expect(b.root.firstChild).toBe(mounts.dock.host);
    expect(mounts.points().dock.kind).toBe('in-flow');
  });

  it('[RB-008] over new nodes of the composer MAIN still names — after a pause and in one step — and MAIN silent for its settle time: it says so once, with the dock in place', async () => {
    const mounts = setup();
    const a = page.addComposer(ACC, '2002');
    let renewed = 0;
    let dockThere = true;
    mounts.onRenewed(() => {
      renewed += 1;
      dockThere = page.all.find((composer) => composer.fan === '2002')?.root.firstChild === mounts.dock.host;
    });
    mounts.update(state('2002'));
    await tick();
    await silence();
    expect(renewed).toBe(0);
    // With a pause: the dock waits, then goes over the new nodes — and MAIN gets its time to speak first.
    a.tab.remove();
    await settle();
    await silence();
    expect(renewed).toBe(0);
    const b = page.renderAgain(a);
    await settle();
    expect(b.root.firstChild).toBe(mounts.dock.host);
    expect(renewed).toBe(0);
    await silence();
    expect([renewed, dockThere]).toEqual([1, true]);
    expect(diagnostics.filter((d) => d.event === 'composer-renewed')).toHaveLength(1);
    // Placed again over the same nodes («Проверить», a resize, more silence): nothing new.
    mounts.refresh();
    await tick();
    await silence();
    expect(renewed).toBe(1);
    // In one step: Vue swaps the nodes in one render, the page is never without the composer.
    const c = page.renderAgain(b);
    await settle();
    expect(c.root.firstChild).toBe(mounts.dock.host);
    await silence();
    expect([renewed, dockThere]).toEqual([2, true]);
    // MAIN has looked again and names the new composer: these nodes are its own now.
    mounts.update(state('2002', { instanceId: 'c-2002-renewed' }));
    await tick();
    await silence();
    expect(renewed).toBe(2);
  });

  it('[RB-014] [RB-015] a chat switch is no re-render: ChatSpace shows the other chat’s composer first, MAIN’s report of it comes after — nothing is said, whatever the old nodes became', async () => {
    const mounts = setup();
    const a = page.addComposer(ACC, '2002');
    let renewed = 0;
    mounts.onRenewed(() => (renewed += 1));
    mounts.update(state('2002'));
    await tick();
    // Another chat in a new ChatSpace tab: its composer is rendered and shown, the first one stays in the page, hidden.
    page.show(a, false);
    const b = page.addComposer(ACC, '2003');
    await settle();
    // The dock is over what the page shows, while MAIN still names the first chat's composer…
    expect(b.root.firstChild).toBe(mounts.dock.host);
    expect(mounts.points().dock.composerInstanceId).toBe('c-2002');
    // …and MAIN's own word comes within its settle time.
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS / 3));
    mounts.update(state('2003'));
    await tick();
    await silence();
    expect(renewed).toBe(0);
    // Another chat put into the SAME tab: the old composer's nodes go and new ones come in one render — to the page
    // exactly a re-render in one step. MAIN says «none yet» (the route has not followed), then the new composer.
    const c = page.renderAgain(b);
    await settle();
    expect(c.root.firstChild).toBe(mounts.dock.host);
    mounts.update(null);
    await tick();
    mounts.update(state('2004'));
    await tick();
    await silence();
    expect(c.root.firstChild).toBe(mounts.dock.host);
    expect(renewed).toBe(0);
    expect(diagnostics.filter((d) => d.event === 'composer-renewed')).toEqual([]);
  });

  it('[RB-015] a chat opened and left again before MAIN said anything of it: after the settle time the dock is back over the first chat’s field, and nothing is said', async () => {
    const mounts = setup();
    const a = page.addComposer(ACC, '2002');
    let renewed = 0;
    mounts.onRenewed(() => (renewed += 1));
    mounts.update(state('2002'));
    await tick();
    page.show(a, false);
    const b = page.addComposer(ACC, '2003');
    await settle();
    expect(b.root.firstChild).toBe(mounts.dock.host);
    // Back at once — ChatSpace only shows and hides its composers, no node comes or goes, and to MAIN nothing changed.
    page.show(b, false);
    page.show(a, true);
    await silence();
    expect(a.root.firstChild).toBe(mounts.dock.host);
    expect(mounts.points().dock).toMatchObject({ kind: 'in-flow', composerInstanceId: 'c-2002' });
    expect(renewed).toBe(0);
  });

  it('[RB-008] MAIN silent over other nodes is asked about them once — not again while the dock stays there, and again for the next nodes', async () => {
    const mounts = setup();
    const a = page.addComposer(ACC, '2002');
    let renewed = 0;
    mounts.onRenewed(() => (renewed += 1));
    mounts.update(state('2002'));
    await tick();
    const b = page.renderAgain(a);
    await settle();
    await silence();
    expect(renewed).toBe(1);
    // MAIN, asked, had nothing new to say (it could not tell the composer's chat): no second question for these nodes.
    b.frame.append(document.createElement('span'));
    b.tab.append(document.createElement('div'));
    await settle();
    await silence();
    mounts.refresh();
    await silence();
    expect(renewed).toBe(1);
    page.renderAgain(b);
    await settle();
    await silence();
    expect(renewed).toBe(2);
  });

  it('[RB-008] another composer is MAIN’s own news, never «rendered again»: a blocked fan, a dock that left with the chat', async () => {
    const mounts = setup();
    const a = page.addComposer(ACC, '2002');
    const b = page.addComposer(ACC, '2003', { shown: false });
    let renewed = 0;
    mounts.onRenewed(() => (renewed += 1));
    mounts.update(state('2002'));
    await tick();
    page.show(a, false);
    page.show(b, true);
    mounts.update(state('2003'));
    await tick();
    expect(b.root.firstChild).toBe(mounts.dock.host);
    mounts.update(state('2003', { hidden: true, instanceId: 'b-2003' }));
    await tick();
    mounts.update(state('2003'));
    await tick();
    // The dock left with the chat; the chat's composer comes back later with new nodes and MAIN names it once more.
    mounts.update(null);
    await tick();
    const again = page.renderAgain(b);
    mounts.update(state('2003'));
    await settle();
    await silence();
    expect(again.root.firstChild).toBe(mounts.dock.host);
    expect(renewed).toBe(0);
  });

  it('[RB-008] a composer MAIN reports before the page shows it, the dock having stood nowhere yet: it waits on the composers container', async () => {
    const mounts = setup();
    page.addComposer(ACC, '2003', { shown: false });
    // The first search (firstSearchMs: 50) is over.
    await new Promise((resolve) => setTimeout(resolve, 60));
    mounts.update(state('2002'));
    await tick();
    expect(mounts.points().dock.kind).toBe('none');
    await new Promise((resolve) => setTimeout(resolve, 5));
    const a = page.addComposer(ACC, '2002');
    await settle();
    expect(a.root.firstChild).toBe(mounts.dock.host);
  });

  it('while it waits for its composer the dock watches child lists only (no subtree, no timer); with no composer at all it watches nothing', async () => {
    const mounts = setup();
    const hidden = page.addComposer(ACC, '2003', { shown: false });
    const a = page.addComposer(ACC, '2002');
    mounts.update(state('2002'));
    await tick();
    a.root.remove();
    await settle();
    expect(mounts.points().dock.kind).toBe('none');
    let searches = 0;
    const original = document.querySelectorAll.bind(document);
    Object.defineProperty(document, 'querySelectorAll', { configurable: true, value: (selector: string) => ((searches += selector === COMPOSER_SLOT_SELECTOR ? 1 : 0), original(selector)) });
    try {
      // Changes deeper down (a field of a hidden tab, the strip of a composer) are not ours to look at.
      hidden.prose.append(document.createTextNode('typing'));
      hidden.frame.append(document.createElement('span'));
      await settle();
      expect(searches).toBe(0);
      // The dock left with the chat (no composer): ChatSpace's renders cost no search at all.
      mounts.update(null);
      await tick();
      searches = 0;
      a.tab.append(document.createElement('div'));
      page.composers.append(document.createElement('div'));
      await settle();
      expect(searches).toBe(0);
      expect(mounts.points().dock.kind).toBe('none');
    } finally {
      Reflect.deleteProperty(document, 'querySelectorAll');
    }
  });

  it('no composer (another route) — the dock leaves; two visible composers — none, and the ambiguity is logged', async () => {
    const mounts = setup();
    page.addComposer(ACC, '2002');
    page.addComposer(ACC, '2003');
    mounts.update(state('2002'));
    await tick();
    expect(mounts.points().dock.kind).toBe('none');
    expect(mounts.dock.host.isConnected).toBe(false);
    expect(diagnostics).toContainEqual({ event: 'composer-ambiguous', count: 2 });
    mounts.update(null);
    await tick();
    expect(mounts.points().dock).toEqual({ kind: 'none', composerInstanceId: null, width: null });
  });

  it('[UI-027] a blocked fan: a copy-only row at the end of the composers container (CG-GATE-FAN-BLOCKED)', async () => {
    const mounts = setup();
    page.addComposer(ACC, '2002', { shown: false });
    page.addComposer(ACC, '2003', { shown: false });
    mounts.update(state('2002', { hidden: true, ready: false }));
    await tick();
    expect(page.composers.lastChild).toBe(mounts.dock.host);
    expect(mounts.dock.host.getAttribute('data-cg-mode')).toBe('copy-only');
    expect(mounts.points().dock).toMatchObject({ kind: 'copy-only-row', composerInstanceId: null });
  });

  it('[RB-008] without the frame root (a new build) the dock floats fixed over the composer and the anchor is missing', async () => {
    const mounts = setup();
    page.addComposer(ACC, '2002', { frame: false });
    mounts.update(state('2002'));
    await tick();
    expect(mounts.dock.host.parentElement).toBe(document.documentElement);
    expect(mounts.dock.host.style.position).toBe('fixed');
    expect(mounts.dock.host.style.zIndex).toBe('900');
    expect(mounts.frameAnchor()).toBe('missing');
    expect(mounts.points().dock.kind).toBe('fixed-overlay');
    expect(diagnostics).toContainEqual({ event: 'frame-missing' });
  });
});

describe('overlays and the hotkey dispatcher registry (§6.3, §9.1)', () => {
  it('overlay hosts live in <html> outside #app, closed, fixed, on their z-layers', () => {
    const mounts = setup();
    const panel = mounts.overlay('panel');
    const modal = mounts.overlay('modal');
    const toast = mounts.overlay('toast');
    expect(mounts.overlay('panel')).toBe(panel);
    for (const [host, z] of [
      [panel.host, OVERLAY_Z.panel],
      [modal.host, OVERLAY_Z.modal],
      [toast.host, OVERLAY_Z.toast],
    ] as const) {
      expect(host.parentElement).toBe(document.documentElement);
      expect(host.getAttribute('data-cg')).toBe('overlay');
      expect(host.shadowRoot).toBeNull();
      expect(host.style.position).toBe('fixed');
      expect(host.style.zIndex).toBe(String(z));
      expect(page.app.contains(host)).toBe(false);
    }
    expect([OVERLAY_Z.panel, OVERLAY_Z.modal, OVERLAY_Z.toast]).toEqual([900, 950, 960]);
  });

  it('data-dismissible-open stays while any owner keeps a window of ours open', () => {
    const mounts = setup();
    mounts.setDismissibleOpen('modal', 'spenders', true);
    const modal = mounts.overlay('modal');
    expect(modal.host.hasAttribute('data-dismissible-open')).toBe(true);
    mounts.setDismissibleOpen('modal', 'palette', true);
    mounts.setDismissibleOpen('modal', 'spenders', false);
    expect(modal.host.hasAttribute('data-dismissible-open')).toBe(true);
    mounts.setDismissibleOpen('modal', 'palette', false);
    expect(modal.host.hasAttribute('data-dismissible-open')).toBe(false);
    mounts.setDismissibleOpen('dock', 'result', true);
    expect(mounts.dock.host.hasAttribute('data-dismissible-open')).toBe(true);
  });

  it('the registry tells the dispatcher an event came from our closed root and what is focused there', () => {
    const mounts = setup();
    const modal = mounts.overlay('modal');
    const input = document.createElement('input');
    modal.root.append(input);
    let from: Element | null = null;
    window.addEventListener('keydown', (event) => (from = mounts.registry.hostOf(event)), { capture: true, once: true });
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, composed: true, key: 'j' }));
    expect(from).toBe(modal.host);
    input.focus();
    expect(mounts.registry.focusedInside(document)).toBe(input);
    expect(mounts.registry.hosts()).toEqual(expect.arrayContaining([mounts.dock.host, modal.host]));
    expect(mounts.registry.rootOf(modal.host)).toBe(modal.root);
    const outside = new KeyboardEvent('keydown');
    expect(mounts.registry.hostOf(outside)).toBeNull();
  });
});

describe('legacy helpers (R00 composition root)', () => {
  it('findComposerMount picks the active composer, not the first slot in DOM order', () => {
    page = createFakePage(document);
    page.addComposer(ACC, '2002', { shown: false });
    const b = page.addComposer(ACC, '2003');
    expect(document.querySelector(COMPOSER_SLOT_SELECTOR)?.closest('[data-tab]')?.getAttribute('data-tab')).toBe(`${ACC}:2002`);
    expect(findComposerMount(document)).toBe(b.root);
  });

  it('waitForComposerMount resolves when ChatSpace renders the composer later, null on abort and timeout', async () => {
    page = createFakePage(document);
    const pending = waitForComposerMount(document, { timeoutMs: 1000, signal: new AbortController().signal });
    const a = page.addComposer(ACC, '2002');
    await expect(pending).resolves.toBe(a.root);
    page.show(a, false);
    const life = new AbortController();
    const aborted = waitForComposerMount(document, { timeoutMs: 1000, signal: life.signal });
    life.abort();
    await expect(aborted).resolves.toBeNull();
    await expect(waitForComposerMount(document, { timeoutMs: 5, signal: new AbortController().signal })).resolves.toBeNull();
  });

  it('mountClosedHost and removeStaleHosts', () => {
    const parent = document.createElement('div');
    document.body.append(parent);
    const host = mountClosedHost(parent, 'overlay', 'last');
    expect(parent.lastChild).toBe(host.host);
    expect(host.host.shadowRoot).toBeNull();
    expect(removeStaleHosts(document)).toBe(1);
    expect(parent.childNodes).toHaveLength(0);
  });
});
