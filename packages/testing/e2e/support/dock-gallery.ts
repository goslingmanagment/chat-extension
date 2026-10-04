// What the dock gallery specs share (specs/dock-gallery-*.e2e.ts): opening a
// gallery page at a window size and zoom, reading what a closed shadow root
// hides through `window.__dock`, and saving pictures into .cache/e2e/. Zoom
// is the browser's: the CSS viewport shrinks and the device pixel ratio grows
// (BiDi browsingContext.setViewport), exactly as Ctrl/⌘+ does — so a composer
// wider than the zoomed window is not a case.
//
// The gallery is split over several spec files on purpose: each file is one
// browser session, so a session lost under load costs one part of the
// gallery, not all of it.

import { mkdirSync, writeFileSync } from 'node:fs';

import { browser, expect } from '@wdio/globals';

import { DOCK_GALLERY_PATH, E2E_EVIDENCE_DIR } from '../../src/stand/paths';
import { standOrigin } from './stand';

export interface Size {
  readonly width: number;
  readonly height: number;
}
/** The mockup's two windows: `final-*-light` and `final-*-1280-light`. */
export const WINDOW: Size = { width: 1440, height: 900 };
export const SMALL: Size = { width: 1280, height: 800 };
export const ZOOMS = [1, 1.25, 1.5, 2] as const;
/** The reference composer widths (ui-design §3.3). */
export const WIDTHS = [853, 693, 489, 360] as const;
/** The column every surface must fit without horizontal scroll (ui-design §6.5). */
export const COLUMN = 320;
export const THEMES = ['light', 'dark'] as const;
export const LANGUAGES = ['ru', 'en'] as const;
/** The page's own side padding around a stage. */
export const PAGE_PADDING = 32;
/** Accent dots the dock states show (ui-design §1 п. 4): the whole list, per state. */
export const ACCENTS = ['18b:archive-lag', '1b:recap-ready', '3c:result-stale', 'x-recap-slots:recap-ready'];

export type Box = { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number; readonly width: number; readonly height: number };

export async function setWindow(size: Size, zoom: number): Promise<void> {
  const context = await browser.getWindowHandle();
  await browser.browsingContextSetViewport({ context, viewport: { width: Math.round(size.width / zoom), height: Math.round(size.height / zoom) }, devicePixelRatio: zoom });
}

/** Gives the window back its own size. A session that died mid-spec has no window: the spec already failed with the real reason. */
export async function resetWindow(): Promise<void> {
  try {
    const context = await browser.getWindowHandle();
    await browser.browsingContextSetViewport({ context, viewport: null, devicePixelRatio: null });
  } catch {
    // Nothing to reset: the session is gone.
  }
}

export async function open(query: string, zoom = 1, size: Size = WINDOW): Promise<void> {
  await setWindow(size, zoom);
  await browser.url(`${standOrigin()}${DOCK_GALLERY_PATH}?${query}`);
  await browser.waitUntil(async () => (await browser.execute(() => document.documentElement.getAttribute('data-gal-ready'))) === '1', {
    timeout: 15_000,
    timeoutMsg: `dock gallery not ready: ${query}`,
  });
  // Menus open and lazy parts land a frame or two after the page says «ready»; then every
  // entry animation runs to its end (spinners and the caret never end and are not waited for).
  await browser.execute(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    await window.__dock?.settle();
  });
}

export interface Health {
  readonly problems: readonly string[];
  readonly failures: readonly string[];
  readonly states: number;
  readonly mode: string;
  readonly accents: readonly string[];
  readonly scrollWidth: number;
  readonly clientWidth: number;
}

export async function health(): Promise<Health> {
  return browser.execute(() => {
    const dock = window.__dock;
    if (dock === undefined) throw new Error('window.__dock is missing');
    return {
      problems: [...dock.check()],
      failures: dock.failures.map((failure) => `${failure.kind}:${failure.code}:${failure.name}`),
      states: dock.states.length,
      mode: dock.styles.mode,
      accents: [...dock.accents()].sort(),
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    };
  });
}

export const shown = (id: string, selector: string): Promise<readonly string[]> => browser.execute((state, query) => [...(window.__dock?.shown(state, query) ?? [])], id, selector);
export const box = (id: string, selector: string): Promise<Box | null> => browser.execute((state, query) => window.__dock?.box(state, query) ?? null, id, selector);
export const measure = (id: string) => browser.execute((state) => window.__dock?.measure(state) ?? null, id);
export const focused = (id: string): Promise<string | null> => browser.execute((state) => window.__dock?.focused(state) ?? null, id);
export const dispatched = (id: string): Promise<readonly string[]> => browser.execute((state) => [...(window.__dock?.dispatched(state) ?? [])], id);

function save(name: string, data: string): void {
  mkdirSync(E2E_EVIDENCE_DIR, { recursive: true });
  writeFileSync(`${E2E_EVIDENCE_DIR}${name}.png`, Buffer.from(data, 'base64'));
}

/** One picture per group of states: a whole page of 50 states at 200 % is taller than a picture may be. */
export async function captureGroups(name: string): Promise<void> {
  const groups = await browser.execute(() => {
    const out: Record<string, { left: number; top: number; right: number; bottom: number }> = {};
    for (const stage of document.querySelectorAll('[data-gal-group]')) {
      const group = stage.getAttribute('data-gal-group') ?? '';
      const own = stage.getBoundingClientRect();
      const left = own.left + window.scrollX;
      const top = own.top + window.scrollY;
      const seen = out[group];
      out[group] =
        seen === undefined
          ? { left, top, right: left + own.width, bottom: top + own.height }
          : { left: Math.min(seen.left, left), top: Math.min(seen.top, top), right: Math.max(seen.right, left + own.width), bottom: Math.max(seen.bottom, top + own.height) };
    }
    return out;
  });
  const context = await browser.getWindowHandle();
  for (const [group, area] of Object.entries(groups)) {
    const x = Math.max(0, Math.floor(area.left) - 8);
    const y = Math.max(0, Math.floor(area.top) - 8);
    const shot = await browser.browsingContextCaptureScreenshot({
      context,
      origin: 'document',
      clip: { type: 'box', x, y, width: Math.ceil(area.right) + 8 - x, height: Math.ceil(area.bottom) + 8 - y },
    });
    save(`${name}-${group}`, shot.data);
  }
}

export async function captureWindow(name: string): Promise<void> {
  const context = await browser.getWindowHandle();
  const shot = await browser.browsingContextCaptureScreenshot({ context, origin: 'viewport' });
  save(name, shot.data);
}

export function expectHealthy(result: Health, width: number): void {
  // Nothing sticks out of the composer, the strip is 34 px, its right block never
  // overlaps the buttons, «черновик · не отправлено» is whole, the sheet is within its limit.
  expect(result.problems).toEqual([]);
  expect(result.failures).toEqual([]);
  expect(result.states).toBeGreaterThan(40);
  expect(result.mode).toBe('adopted');
  // Blue marks a state of our result — a stale answer, a lagging archive, a ready Recap — and nothing else (ui-design §11 п. 5).
  expect(result.accents).toEqual(ACCENTS);
  if (width + PAGE_PADDING <= result.clientWidth) expect(result.scrollWidth).toBeLessThanOrEqual(result.clientWidth);
}

/**
 * Every dock state of one theme: both languages, 100/125/150/200 % zoom, the
 * reference composer widths and the 320 px column. One spec file per theme
 * calls it.
 */
export function describeEveryState(theme: (typeof THEMES)[number]): void {
  for (const language of LANGUAGES) {
    for (const zoom of ZOOMS) {
      const fits = [...WIDTHS, COLUMN].filter((width) => width + PAGE_PADDING <= Math.round(WINDOW.width / zoom));
      for (const width of fits) {
        it(`[UI-002] [UI-018] every state · ${theme} · ${language} · ${zoom * 100} % · ${width} px`, async () => {
          await open(`theme=${theme}&lang=${language}&w=${width}`, zoom);
          // Pictures first: a failed check still leaves the evidence. At 100 % every width;
          // zoomed — the widest composer that fits and the two narrowest.
          if (zoom === 1 || width === fits[0] || width <= 360) await captureGroups(`dock-${theme}-${language}-z${zoom * 100}-w${width}`);
          expectHealthy(await health(), width);
        });
      }
    }
  }
}
