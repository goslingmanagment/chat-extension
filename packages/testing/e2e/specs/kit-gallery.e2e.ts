// The ui/kit gallery in headless Firefox (architecture.md §10.2 «Приёмка UI»,
// ui-design §11): every kit component in all states, both themes, both
// languages, at 100/125/150/200 % zoom and in a 320 px column. Zoom is the
// browser's: the CSS viewport shrinks and the device pixel ratio grows
// (BiDi browsingContext.setViewport), exactly as Ctrl/⌘+ does. Each case
// checks no horizontal overflow, the list's DOM cap and the shared sheets,
// and saves a full-page picture into .cache/e2e/ to compare by eye with the
// binding mockup.

import { mkdirSync, writeFileSync } from 'node:fs';

import { browser, expect } from '@wdio/globals';

import { E2E_EVIDENCE_DIR, KIT_GALLERY_PATH } from '../../src/stand/paths';
import { useNetworkTrap } from '../support/network-trap';
import { standOrigin } from '../support/stand';

const WINDOW = { width: 1440, height: 900 } as const;
const ZOOMS = [1, 1.25, 1.5, 2] as const;
const THEMES = ['light', 'dark'] as const;
const LANGUAGES = ['ru', 'en'] as const;

interface Probe {
  readonly failures: readonly { kind: string; code: string; name: string }[];
  readonly rows: number;
  readonly overflow: readonly string[];
  readonly mode: string;
  readonly sheets: number;
  readonly scrollWidth: number;
  readonly clientWidth: number;
  readonly scheme: string | null;
}

async function open(query: string, zoom: number, width: number = WINDOW.width): Promise<void> {
  const context = await browser.getWindowHandle();
  await browser.browsingContextSetViewport({ context, viewport: { width: Math.round(width / zoom), height: Math.round(WINDOW.height / zoom) }, devicePixelRatio: zoom });
  await browser.url(`${standOrigin()}${KIT_GALLERY_PATH}?${query}`);
  await browser.waitUntil(async () => (await browser.execute(() => document.documentElement.getAttribute('data-gal-ready'))) === '1', {
    timeout: 15_000,
    timeoutMsg: `gallery not ready: ${query}`,
  });
}

async function probe(): Promise<Probe> {
  return browser.execute(() => {
    const gallery = window.__gallery;
    if (gallery === undefined) throw new Error('window.__gallery is missing');
    const host = document.querySelector('[data-cg="gallery"]');
    return {
      failures: gallery.failures.map((failure) => ({ kind: failure.kind, code: failure.code, name: failure.name })),
      rows: gallery.listRows(),
      overflow: [...gallery.overflow()],
      mode: gallery.styles.mode,
      sheets: gallery.styles.sheets,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      scheme: host?.getAttribute('data-cg-scheme') ?? null,
    };
  });
}

async function capture(name: string): Promise<void> {
  mkdirSync(E2E_EVIDENCE_DIR, { recursive: true });
  const context = await browser.getWindowHandle();
  const shot = await browser.browsingContextCaptureScreenshot({ context, origin: 'document' });
  writeFileSync(`${E2E_EVIDENCE_DIR}${name}.png`, Buffer.from(shot.data, 'base64'));
}

function expectHealthy(result: Probe, theme: string): void {
  expect(result.overflow).toEqual([]);
  expect(result.scrollWidth).toBeLessThanOrEqual(result.clientWidth);
  // The 1000-row list keeps at most 150 rows in the DOM (architecture.md §10.1).
  expect(result.rows).toBeGreaterThan(0);
  expect(result.rows).toBeLessThanOrEqual(150);
  // Constructable sheets, shared: tokens, base, components, the gallery's own frames.
  expect(result.mode).toBe('adopted');
  expect(result.sheets).toBe(4);
  expect(result.scheme).toBe(theme);
  // The one deliberate render failure of the «Сбой интерфейса» specimen, reported by class name only.
  expect(result.failures).toEqual([{ kind: 'render', code: 'CG-UI-FAILED', name: 'TypeError' }]);
}

describe('ui/kit gallery: every component, both themes and languages, 100–200 % zoom, a 320 px column', () => {
  useNetworkTrap();

  after(async () => {
    const context = await browser.getWindowHandle();
    await browser.browsingContextSetViewport({ context, viewport: null, devicePixelRatio: null });
  });

  for (const theme of THEMES) {
    for (const language of LANGUAGES) {
      for (const zoom of ZOOMS) {
        it(`${theme} · ${language} · ${zoom * 100} %`, async () => {
          await open(`theme=${theme}&lang=${language}`, zoom);
          // The picture first: a failed check still leaves the evidence.
          await capture(`kit-gallery-${theme}-${language}-z${zoom * 100}`);
          expectHealthy(await probe(), theme);
        });
      }
      it(`${theme} · ${language} · 320 px column`, async () => {
        await open(`theme=${theme}&lang=${language}&col=320`, 1);
        await capture(`kit-gallery-${theme}-${language}-col320`);
        expectHealthy(await probe(), theme);
      });
    }
  }
});
