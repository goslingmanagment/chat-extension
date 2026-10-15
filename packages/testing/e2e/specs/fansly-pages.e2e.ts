// Fansly on the settings page in headless Firefox (R20 P14b1; FS-SET-1; ui-design §4.24, X32): the pages gallery of the
// stand with Fansly's part of the background scripted (`&fansly=on|off`, packages/testing/src/pages/fansly.ts) — its
// card in «Аккаунты» and on the sign-in screen, its tones in «Звук», its Recap depth in «Генерация», its steps of the
// first run — over the shipped entry functions, the real controllers and Fansly's real surface. Each case checks that
// nothing sticks out sideways and no surface failed, and saves a picture into .cache/e2e/ (fansly-pages-*.png) to
// compare by eye with ui-design §4.24.

import { mkdirSync, writeFileSync } from 'node:fs';

import { browser, expect } from '@wdio/globals';

import { E2E_EVIDENCE_DIR, PAGES_GALLERY_PATH } from '../../src/stand/paths';
import { useNetworkTrap } from '../support/network-trap';
import { standOrigin } from '../support/stand';

interface Probe {
  readonly failures: readonly { kind: string; code: string; name: string }[];
  readonly overflow: readonly string[];
  readonly scrollWidth: number;
  readonly clientWidth: number;
  readonly scheme: string | null;
}

interface Size {
  readonly width: number;
  readonly height: number;
}

const DESKTOP: Size = { width: 1440, height: 900 };
const LAPTOP: Size = { width: 1280, height: 800 };
const NARROW: Size = { width: 820, height: 900 };
const PHONE: Size = { width: 320, height: 800 };
const THEMES = ['light', 'dark'] as const;

async function open(query: string, size: Size, hash = ''): Promise<void> {
  const context = await browser.getWindowHandle();
  await browser.browsingContextSetViewport({ context, viewport: { width: size.width, height: size.height }, devicePixelRatio: 1 });
  await browser.url('about:blank');
  await browser.url(`${standOrigin()}${PAGES_GALLERY_PATH}?${query}${hash}`);
  await browser.waitUntil(async () => (await browser.execute(() => document.documentElement.getAttribute('data-pg-ready'))) === '1', {
    timeout: 15_000,
    timeoutMsg: `the pages gallery is not ready: ${query}${hash}`,
  });
}

async function probe(): Promise<Probe> {
  return browser.execute(() => {
    const pages = window.__pages;
    if (pages === undefined) throw new Error('window.__pages is missing');
    return {
      failures: pages.failures.map((failure) => ({ kind: failure.kind, code: failure.code, name: failure.name })),
      overflow: [...pages.overflow()],
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      scheme: document.documentElement.getAttribute('data-scheme'),
    };
  });
}

async function capture(name: string, origin: 'document' | 'viewport' = 'document'): Promise<void> {
  mkdirSync(E2E_EVIDENCE_DIR, { recursive: true });
  const context = await browser.getWindowHandle();
  const shot = await browser.browsingContextCaptureScreenshot({ context, origin });
  writeFileSync(`${E2E_EVIDENCE_DIR}${name}.png`, Buffer.from(shot.data, 'base64'));
}

function expectHealthy(result: Probe, theme: string): void {
  expect(result.failures).toEqual([]);
  expect(result.overflow).toEqual([]);
  expect(result.scrollWidth).toBeLessThanOrEqual(result.clientWidth);
  expect(result.scheme).toBe(theme);
}

const text = (selector: string): Promise<string> => browser.execute((query) => (document.querySelector(query)?.textContent ?? '').replace(/\s+/g, ' ').trim(), selector);
const count = (selector: string): Promise<number> => browser.execute((query) => document.querySelectorAll(query).length, selector);

describe('Fansly on the settings page (R20 P14b1, FS-SET-1)', () => {
  useNetworkTrap();

  after(async () => {
    const context = await browser.getWindowHandle();
    await browser.browsingContextSetViewport({ context, viewport: null, devicePixelRatio: null });
  });

  for (const theme of THEMES) {
    it(`[ST-067] [ST-077] «Аккаунты»: Fansly’s card above the groups, its models in them · ${theme}`, async () => {
      await open(`page=options&state=working&fansly=on&theme=${theme}`, DESKTOP, '#accounts');
      await capture(`fansly-pages-accounts-${theme}`, 'viewport');
      await capture(`fansly-pages-accounts-${theme}-full`);
      expectHealthy(await probe(), theme);
      expect(await text('.pg-sitecard h2')).toBe('Fansly');
      expect(await text('[data-pg-unattributed]')).toContain('Вкладки Fansly без атрибуции: 1');
      expect(await count('[data-pg-account^="fansly-web:"]')).toBe(2);
      expect(await text('[data-pg-account="fansly-web:700000000000000001"] .pg-acc__head b')).toBe('Fansly 7000…0001');
    });
  }

  it('«Вид и звук»: the tones on Fansly under the two sounds', async () => {
    await open('page=options&state=working&fansly=on&theme=light', DESKTOP, '#appearance');
    await capture('fansly-pages-appearance-light');
    expectHealthy(await probe(), 'light');
    expect(await count('[data-pg-fansly-tone] .pg-pick')).toBe(2);
  });

  it('[ST-093] «Генерация»: the Recap depth on Fansly, when the hub takes up to 5000', async () => {
    await open('page=options&state=working&fansly=on&deep=5000&theme=light', DESKTOP, '#generation');
    await capture('fansly-pages-generation-light');
    expectHealthy(await probe(), 'light');
    expect(await count('[data-pg-anchor="fansly-deep"] .pg-step')).toBe(1);
  });

  for (const theme of THEMES) {
    it(`[ST-012] the first run: «На Fansly», three steps under the eight; «Включить Fansly» in the card · ${theme}`, async () => {
      await open(`page=options&state=first-run&fansly=off&theme=${theme}`, LAPTOP, '#status');
      await capture(`fansly-pages-first-run-${theme}`);
      expectHealthy(await probe(), theme);
      expect(await count('.pg-check__group [data-pg-step]')).toBe(3);
    });
  }

  it('the sign-in screen: «Включить Fansly» before the first sign-in, under the checklist', async () => {
    await open('page=options&state=signed-out&fansly=off&theme=light', LAPTOP);
    await capture('fansly-pages-signin-light');
    expectHealthy(await probe(), 'light');
    expect(await text('.pg-sitecard .pg-site-access button')).toBe('Включить Fansly');
  });

  it('820 px and 320 px: Fansly’s card and rows fit, nothing sticks out', async () => {
    await open('page=options&state=working&fansly=on&theme=light', NARROW, '#accounts');
    await capture('fansly-pages-accounts-820');
    expectHealthy(await probe(), 'light');
    await open('page=options&state=working&fansly=on&theme=dark', PHONE, '#accounts');
    await capture('fansly-pages-accounts-320');
    expectHealthy(await probe(), 'dark');
    await open('page=options&state=working&fansly=on&theme=light', PHONE, '#appearance');
    expectHealthy(await probe(), 'light');
  });
});
