// Visual snapshots of the stand (architecture.md §12 п. 6): the same page in
// light and dark themes at the reference viewports, saved into .cache/e2e/
// as <name>-<theme>-<width>x<height>.png. The viewport is set exactly through
// BiDi (browsingContext.setViewport), not by resizing the window.

import { mkdirSync } from 'node:fs';

import { browser } from '@wdio/globals';

import { E2E_EVIDENCE_DIR } from '../../src/stand/paths';
import { callStand } from './stand';

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

/** The reference sizes: a common laptop and a smaller one. */
export const SNAPSHOT_VIEWPORTS: readonly Viewport[] = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
];

export type Theme = 'light' | 'dark';

async function nextFrames(): Promise<void> {
  await browser.execute(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

export async function setViewport(viewport: Viewport | null): Promise<void> {
  const context = await browser.getWindowHandle();
  await browser.browsingContextSetViewport({ context, viewport: viewport === null ? null : { width: viewport.width, height: viewport.height } });
}

export interface Snapshot {
  readonly path: string;
  readonly theme: Theme;
  readonly viewport: Viewport;
  /** window.innerWidth/innerHeight when the picture was taken. */
  readonly measured: Viewport;
}

/** The page's layout viewport. */
export async function layoutViewport(): Promise<Viewport> {
  return browser.execute(() => ({ width: window.innerWidth, height: window.innerHeight }));
}

/** Saves one screenshot per theme × viewport. Restores the theme and the viewport after. */
export async function saveStandSnapshots(
  name: string,
  options: { readonly themes?: readonly Theme[]; readonly viewports?: readonly Viewport[] } = {},
): Promise<Snapshot[]> {
  mkdirSync(E2E_EVIDENCE_DIR, { recursive: true });
  const original = await browser.execute(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'));
  const snapshots: Snapshot[] = [];
  try {
    for (const viewport of options.viewports ?? SNAPSHOT_VIEWPORTS) {
      await setViewport(viewport);
      for (const theme of options.themes ?? (['light', 'dark'] as const)) {
        await callStand('setTheme', theme);
        await nextFrames();
        const path = `${E2E_EVIDENCE_DIR}${name}-${theme}-${viewport.width}x${viewport.height}.png`;
        await browser.saveScreenshot(path);
        snapshots.push({ path, theme, viewport, measured: await layoutViewport() });
      }
    }
  } finally {
    await callStand('setTheme', original === 'dark' ? 'dark' : 'light');
    await setViewport(null);
  }
  return snapshots;
}
