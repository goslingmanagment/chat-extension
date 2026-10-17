// The floating launcher and our windows over Fansly's modals in Firefox (decision X46; ui-design §3.13; FS-DOCK-2,
// FS-PLC-6; plan.md §3 `suite-fansly-launcher`): the extension's test build on the Fansly stand against the fake hub, a
// chatter signed in, the Fansly page's own switches on, the FBuddy-like neighbour beside us with its toasts.
// - «Spenders» and «Новые» stand in the bottom left corner of every page of an admitted tab — a page without a chat
//   too, where the dock is not — and open their windows with one click, as the old extension's «$» and «Новые» did
//   (the popup took two). Before that click no application of ours is loaded on such a page (FS-PERF-3).
// - The corner is nobody's: FBuddy's toasts stand bottom right, and at the launcher's centre the page's topmost
//   element is ours. A modal of Fansly's covers the launcher, as it covers Fansly's own page.
// - Our windows stand over Fansly's modals (UI-017): Spenders opened by the launcher over the upload modal of the
//   composer is what the centre of the screen shows. «Окно по центру» of the notes over a modal: suite-fansly-notes.

import { $, browser, expect } from '@wdio/globals';
import { mkdirSync } from 'node:fs';

import { WORLD } from '../../src/scenarios/hub';
import { E2E_EVIDENCE_DIR } from '../../src/stand/paths';
import { readReport } from '../support/extension';
import { useFakeHub } from '../support/fake-hub';
import { callNeighbor, setFanslyNeighbor } from '../support/fansly-neighbor';
import { startFanslyShift } from '../support/fansly-shift';
import { FANSLY_MAIN, callFansly, fakeFansly } from '../support/fansly-stand';
import { useNetworkTrap } from '../support/network-trap';
import { oursExists } from '../support/ours';

const A = WORLD.fansly.chats.a;
const LAUNCHER = '[data-host="overlay"][data-layer="launcher"]';
const SPENDERS = '[aria-label="Доска Spenders"]';
const NEWCOMERS = '.cg-fnw';

const launcherButton = (target: 'spenders' | 'newcomers') => $(LAUNCHER).shadow$(`button[data-launcher="${target}"]`);

/** The launcher's box and what the page shows at its centre; FBuddy's toast stack (its open root) beside it. */
async function corner(): Promise<{ readonly box: { left: number; bottom: number; width: number; height: number; z: number } | null; readonly ours: boolean; readonly toasts: DOMRect | null }> {
  return browser.execute((selector: string) => {
    const host = document.querySelector<HTMLElement>(selector);
    const rect = host?.getBoundingClientRect();
    const hit = rect === undefined ? null : document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    const stack = document.querySelector('fb-body-shadow-root-ui')?.shadowRoot?.querySelector('section.fb-toasts') ?? null;
    return {
      box: rect === undefined || host === null ? null : { left: rect.left, bottom: window.innerHeight - rect.bottom, width: rect.width, height: rect.height, z: Number(getComputedStyle(host).zIndex) },
      ours: hit !== null && hit === host,
      toasts: stack === null ? null : (JSON.parse(JSON.stringify(stack.getBoundingClientRect())) as DOMRect),
    };
  }, LAUNCHER);
}

/** Fansly's upload modal over the open chat, as a file given to the composer's input opens it (the stand's composer). */
async function openUploadModal(): Promise<void> {
  await browser.execute((selector: string) => {
    const input = document.querySelector<HTMLInputElement>(`${selector} input[type="file"]`);
    if (input === null) throw new Error('no file input');
    const files = new DataTransfer();
    files.items.add(new File(['x'], 'probe.png', { type: 'image/png' }));
    input.files = files.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, FANSLY_MAIN.composer);
  await browser.waitUntil(async () => (await callFansly('modals')).length > 0, { timeout: 5000, timeoutMsg: 'Fansly’s upload modal' });
}

async function picture(name: string): Promise<void> {
  // After the chips' colour transition (120 ms) and a window's entrance (≤ 150 ms, ui-design §2.9).
  await browser.pause(400);
  mkdirSync(E2E_EVIDENCE_DIR, { recursive: true });
  await browser.saveScreenshot(`${E2E_EVIDENCE_DIR}suite-fansly-launcher-${name}.png`);
}

describe('[host:fansly] the floating launcher and our windows over Fansly’s modals (X46)', () => {
  useNetworkTrap();
  const { hub } = useFakeHub();

  before(async () => {
    await setFanslyNeighbor(null);
    await fakeFansly().command({ op: 'reset' });
    await hub().command({ op: 'config', patch: { spendersTotal: 3 } });
    // A page of Fansly without a chat, the neighbour beside us with a toast every 700 ms.
    await startFanslyShift(hub(), { path: '/home', neighbor: { mode: 'after', noisyMs: 700 }, viewport: { width: 1440, height: 900 } });
  });

  it('[SP-001] [NF-001] [FS-DOCK-2] on a page without a chat: «Spenders» and «Новые» in the bottom left corner, nobody’s but ours; no application before the click; one click opens Spenders', async () => {
    await browser.waitUntil(async () => launcherButton('newcomers').isExisting(), { timeout: 20_000, timeoutMsg: 'no launcher on a page without a chat' });
    await browser.waitUntil(async () => ((await callNeighbor('toasts')).length > 0), { timeout: 10_000, timeoutMsg: 'the neighbour showed no toast' });
    const seen = await corner();
    expect(seen.box).not.toBeNull();
    expect(seen.box?.left).toBe(16);
    expect(seen.box?.bottom).toBe(16);
    expect(seen.box?.z).toBeLessThan(998);
    expect(seen.ours).toBe(true);
    // FBuddy's toasts bottom right, ours bottom left: no overlap.
    expect(seen.toasts).not.toBeNull();
    const toasts = seen.toasts as DOMRect;
    expect(toasts.left).toBeGreaterThan((seen.box?.left ?? 0) + (seen.box?.width ?? 0));
    expect(await launcherButton('spenders').getText()).toBe('Spenders');
    expect(await launcherButton('newcomers').getText()).toBe('Новые');
    // The dock has no place here, and nothing of the application came for the buttons.
    expect(await $('[data-host="dock"]').isExisting()).toBe(false);
    expect((await readReport())?.app).toBeUndefined();
    for (const [theme, scheme] of [['dark', 'dark'], ['bright', 'light']] as const) {
      await callFansly('setTheme', theme);
      await browser.waitUntil(async () => (await $(LAUNCHER).getAttribute('data-scheme')) === scheme, { timeout: 5000, timeoutMsg: `the launcher did not follow the ${theme} theme` });
      await picture(`home-${theme}`);
    }

    await launcherButton('spenders').click();
    await browser.waitUntil(async () => oursExists('modal', SPENDERS), { timeout: 20_000, timeoutMsg: 'one click on «Spenders» did not open the board' });
    expect((await readReport())?.app).toBeDefined();
    await browser.keys(['Escape']);
    await browser.waitUntil(async () => !(await oursExists('modal', SPENDERS)), { timeout: 5000, timeoutMsg: 'Esc did not close Spenders' });
  });

  it('[NF-001] one click on «Новые» opens Fansly’s own window, with the application already there', async () => {
    await launcherButton('newcomers').click();
    await browser.waitUntil(async () => oursExists('modal', NEWCOMERS), { timeout: 20_000, timeoutMsg: 'one click on «Новые» did not open the window' });
    await browser.keys(['Escape']);
    await browser.waitUntil(async () => !(await oursExists('modal', NEWCOMERS)), { timeout: 5000, timeoutMsg: 'Esc did not close «Новые»' });
  });

  it('[SP-001] [UI-017] in a chat too, under Fansly’s modal as the page is; our window stays over a modal that opens after it, and its Esc is its own', async () => {
    await callFansly('open', A.group, 'router');
    await browser.waitUntil(async () => $('[data-host="dock"]').isExisting(), { timeout: 20_000, timeoutMsg: 'no dock in the chat' });
    expect((await corner()).ours).toBe(true);
    const centre = (): Promise<{ readonly layer: string | null; readonly modal: boolean }> =>
      browser.execute(() => {
        const hit = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
        return { layer: hit?.closest('[data-host]')?.getAttribute('data-layer') ?? null, modal: hit !== null && hit.closest('.modal-wrapper') !== null };
      });
    const z = (): Promise<{ readonly launcher: number; readonly modal: number; readonly window: number }> =>
      browser.execute((selector: string) => {
        const of = (node: Element | null): number => (node === null ? Number.NaN : Number(getComputedStyle(node).zIndex));
        return { launcher: of(document.querySelector(selector)), modal: of(document.querySelector('.modal-wrapper')), window: of(document.querySelector('[data-host="overlay"][data-layer="modal"]')) };
      }, LAUNCHER);
    const closeFanslyModal = async (): Promise<void> => {
      // A press on its backdrop, away from its dialog — and from the launcher, which stands under that backdrop.
      await browser.action('pointer').move({ x: 700, y: 40 }).down().up().perform();
      await browser.waitUntil(async () => (await callFansly('modals')).length === 0, { timeout: 5000, timeoutMsg: 'Fansly’s modal did not close' });
    };

    // A modal of Fansly's covers the launcher, as it covers Fansly's own field.
    await openUploadModal();
    expect((await corner()).ours).toBe(false);
    expect((await z()).launcher).toBeLessThan((await z()).modal);
    await closeFanslyModal();

    // Spenders by the launcher, then a modal of Fansly's opens: the board stays what the screen shows.
    await launcherButton('spenders').click();
    await browser.waitUntil(async () => oursExists('modal', SPENDERS), { timeout: 20_000, timeoutMsg: 'the launcher did not open Spenders in the chat' });
    await openUploadModal();
    expect(await centre()).toEqual({ layer: 'modal', modal: false });
    const layers = await z();
    expect(layers.window).toBeGreaterThan(layers.modal);
    await picture('spenders-over-fansly-modal');
    // The focus is in our window: its Esc closes it, not yielded to the modal under it.
    await $(`[data-host="overlay"][data-layer="modal"]`).shadow$(".cg-sp__search input").click();
    await browser.keys(['Escape']);
    await browser.keys(['Escape']);
    await browser.waitUntil(async () => !(await oursExists('modal', SPENDERS)), { timeout: 5000, timeoutMsg: 'Esc in our window over Fansly’s modal did not close it' });
    expect(await centre()).toEqual({ layer: null, modal: true });
    await closeFanslyModal();
  });
});
