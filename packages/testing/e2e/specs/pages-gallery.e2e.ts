// The extension pages in headless Firefox (architecture.md §10.2 «Приёмка
// UI», §12 п. 6; ui-design §3.10, §4.23, §4.24, §11): the popup, the options
// page and the debug pages, mounted with the shipped entry functions of
// ui/pages over the real controller and the scripted background, as the
// mockup draws them (final-20a/20b, final-21a/21b) and in the states it
// does not draw. Each case checks that nothing sticks out sideways, that no
// surface failed, and saves a picture into .cache/e2e/ to compare by eye
// with the binding mockup. A few things only a real browser can prove are
// checked here too: the mouse wheel over a number, the hash routes, the
// save state after a real click.

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
const POPUP: Size = { width: 360, height: 600 };
const THEMES = ['light', 'dark'] as const;
const SECTIONS = ['status', 'account', 'personas', 'accounts', 'generation', 'hotkeys', 'appearance', 'diagnostics'] as const;

async function open(query: string, size: Size, zoom = 1, hash = ''): Promise<void> {
  const context = await browser.getWindowHandle();
  await browser.browsingContextSetViewport({ context, viewport: { width: Math.round(size.width / zoom), height: Math.round(size.height / zoom) }, devicePixelRatio: zoom });
  // A fresh document each time: a hash-only change would keep the page and its state.
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
      scheme: document.documentElement.getAttribute('data-cg-scheme'),
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

describe('extension pages: the popup, the settings, the debug pages (ui-design §4.23, §4.24, §10)', () => {
  useNetworkTrap();

  after(async () => {
    const context = await browser.getWindowHandle();
    await browser.browsingContextSetViewport({ context, viewport: null, devicePixelRatio: null });
  });

  for (const theme of THEMES) {
    it(`[PU-005] popup, a working shift (final-20a) · ${theme}`, async () => {
      await open(`page=popup&state=working&theme=${theme}`, POPUP);
      await capture(`pages-popup-20a-${theme}`);
      expectHealthy(await probe(), theme);
      // 360 px wide (ui-design §3.10), the browser gives the frame.
      expect(await browser.execute(() => document.querySelector('.pg-popup')?.getBoundingClientRect().width)).toBe(360);
      expect(await text('.pg-pills')).toBe('ChatSpace: подключёнХаб: на связи');
      expect(await count('.pg-popup__btns .cg-btn')).toBe(4);
    });

    it(`[PU-006] popup, problems (final-20b) · ${theme}`, async () => {
      await open(`page=popup&state=troubled&theme=${theme}`, POPUP);
      await capture(`pages-popup-20b-${theme}`);
      expectHealthy(await probe(), theme);
      expect(await count('.pg-pill .cg-dot--danger')).toBe(1);
      expect(await count('.pg-popup__err')).toBe(2);
    });

    it(`[ST-020] settings, «Статус» (final-21a) · ${theme}`, async () => {
      await open(`page=options&state=working&theme=${theme}`, DESKTOP, 1, '#status');
      await capture(`pages-options-21a-${theme}`, 'viewport');
      expectHealthy(await probe(), theme);
      // The shell of ui-design §3.10: a 248 px section column, the content no wider than 760 px.
      const shell = await browser.execute(() => ({
        nav: document.querySelector('.pg-nav')?.getBoundingClientRect().width ?? 0,
        title: document.querySelector('.pg-h1')?.getBoundingClientRect().left ?? 0,
        rows: Math.max(...[...document.querySelectorAll('.pg-row')].map((row) => row.getBoundingClientRect().width)),
      }));
      expect(shell.nav).toBe(248);
      expect(shell.title).toBe(248 + 40);
      expect(shell.rows).toBeLessThanOrEqual(760);
    });

    it(`[ST-122] settings, «Вид и звук» (final-21b) · ${theme}`, async () => {
      await open(`page=options&state=working&theme=${theme}`, DESKTOP, 1, '#appearance');
      await capture(`pages-options-21b-${theme}`, 'viewport');
      await capture(`pages-options-21b-${theme}-full`);
      expectHealthy(await probe(), theme);
      expect(await count('[role="radiogroup"] [role="radio"]')).toBe(2);
    });
  }

  it('[PU-001] [PU-002] popup: the background does not answer; nobody is signed in', async () => {
    await open('page=popup&state=unreachable&theme=light', POPUP);
    await capture('pages-popup-unreachable-light');
    // Nothing answered, the settings included: the popup follows the system scheme.
    expectHealthy(await probe(), await browser.execute(() => (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')));
    expect(await count('[data-cg-code="CG-RUNTIME-UNREACHABLE"]')).toBe(1);
    expect(await count('.cg-spin')).toBe(0);
    await open('page=popup&state=signed-out&theme=light', POPUP);
    await capture('pages-popup-signed-out-light');
    expectHealthy(await probe(), 'light');
    expect(await count('[data-cg-code="CG-AUTH-REQUIRED"]')).toBe(1);
  });

  for (const section of SECTIONS) {
    it(`[ST-002] settings, ${section}: both languages, the laptop window`, async () => {
      for (const lang of ['ru', 'en'] as const) {
        await open(`page=options&state=debug&theme=light&lang=${lang}`, LAPTOP, 1, `#${section}`);
        await capture(`pages-options-${section}-${lang}`);
        expectHealthy(await probe(), 'light');
        expect(await browser.execute(() => document.querySelector('.pg-page')?.getAttribute('data-pg-section'))).toBe(section);
        // ST-120: the scheme's reference in the four groups of the cheatsheet, then the rows outside it.
        if (section === 'hotkeys') {
          expect(await browser.execute(() => [...document.querySelectorAll('tbody[data-pg-hotkeys]')].map((group) => group.getAttribute('data-pg-hotkeys')))).toEqual(['ai', 'before', 'result', 'windows', 'outside']);
        }
      }
    });
  }

  it('[ST-001] settings at 820 px, 320 px and 200 % zoom: one column, the sections in a list, nothing sticks out', async () => {
    for (const section of SECTIONS) {
      await open('page=options&state=first-run&theme=light', NARROW, 1, `#${section}`);
      if (section === 'status' || section === 'appearance') await capture(`pages-options-${section}-w820`);
      expectHealthy(await probe(), 'light');
      expect(await browser.execute(() => getComputedStyle(document.querySelector('.pg-nav') as Element).display)).toBe('none');
      expect(await browser.execute(() => getComputedStyle(document.querySelector('.pg-select') as Element).display)).toBe('block');
      await open('page=options&state=first-run&theme=dark', PHONE, 1, `#${section}`);
      if (section === 'status' || section === 'appearance' || section === 'accounts') await capture(`pages-options-${section}-w320`);
      expectHealthy(await probe(), 'dark');
      await open('page=options&state=working&theme=light', DESKTOP, 2, `#${section}`);
      if (section === 'status' || section === 'appearance') await capture(`pages-options-${section}-z200`);
      expectHealthy(await probe(), 'light');
    }
  });

  it('[ST-011] [ST-012] [ST-016] the sign-in screen, the first-run checklist, the read-only barrier', async () => {
    for (const theme of THEMES) {
      await open(`page=options&state=signed-out&theme=${theme}`, LAPTOP);
      await capture(`pages-options-sign-in-${theme}`);
      expectHealthy(await probe(), theme);
      expect(await count('.pg-nav')).toBe(0);
      expect(await count('form input[type="password"]')).toBe(1);
      // ST-012: the first run starts here — the checklist stands under the form, the sign-in still to do.
      expect(await count('.pg-check__item')).toBe(8);
      expect(await count('.pg-check__item.is-done[data-pg-step="sign-in"]')).toBe(0);
    }
    await open('page=options&state=signed-out&theme=light', PHONE);
    await capture('pages-options-sign-in-w320');
    expectHealthy(await probe(), 'light');
    expect(await count('.pg-check__item')).toBe(8);
    await open('page=options&state=first-run&theme=light', LAPTOP);
    await capture('pages-options-first-run-light');
    expectHealthy(await probe(), 'light');
    expect(await count('.pg-check__item')).toBe(8);
    await open('page=options&state=read-only&theme=light', LAPTOP, 1, '#appearance');
    await capture('pages-options-read-only-light');
    expectHealthy(await probe(), 'light');
    expect(await count('[data-cg-code="CG-STORAGE-VERSION"]')).toBe(1);
  });

  it('[ST-003] [ST-008] [ST-009] hash routes in a real window: a link, the plate, the highlight, Back', async () => {
    await open('page=options&state=working&theme=light', LAPTOP, 1, '#status:CG-QUOTA-DAILY');
    expect(await count('[data-pg-plate="CG-QUOTA-DAILY"]')).toBe(1);
    expect(await browser.execute(() => document.querySelector('[data-pg-anchor="quota"]')?.classList.contains('is-target'))).toBe(true);
    await capture('pages-options-deep-link-light', 'viewport');
    // A click on a section moves this tab's hash; garbage in the hash is «Статус».
    await browser.$('a[href="#generation"]').click();
    await browser.waitUntil(async () => (await text('main h1')) === 'Генерация');
    expect(await browser.execute(() => location.hash)).toBe('#generation');
    await browser.execute(() => {
      location.hash = '#no-such-section';
    });
    await browser.waitUntil(async () => (await text('main h1')) === 'Статус');
    await browser.execute(() => {
      location.hash = '#account:CG-HUB-URL';
    });
    await browser.waitUntil(async () => (await text('main h1')) === 'Аккаунт ChatGoose');
    await browser.waitUntil(() => browser.execute(() => document.querySelector('[data-pg-anchor="hub-address"]')?.classList.contains('is-target') === true));
    expectHealthy(await probe(), 'light');
  });

  it('[ST-013] [ST-014] [ST-094] a real click saves at once; the wheel over a number changes nothing; out of range says «сохранено как N»', async () => {
    await open('page=options&state=working&theme=light', LAPTOP, 1, '#generation');
    const input = browser.$('input[aria-label="Reply и Coach"]');
    expect(await input.getValue()).toBe('100');
    // The wheel over the field scrolls the page and never changes the number.
    await browser.action('wheel').scroll({ origin: input, deltaX: 0, deltaY: 240, duration: 50 }).perform();
    await browser.action('wheel').scroll({ origin: input, deltaX: 0, deltaY: -240, duration: 50 }).perform();
    expect(await input.getValue()).toBe('100');
    expect(await browser.execute(() => window.__pages?.requests('settings.patch').length)).toBe(0);

    await input.click();
    await browser.keys(['Meta', 'a']);
    await browser.keys(['Control', 'a']);
    await input.setValue('900');
    await browser.keys('Tab');
    await browser.waitUntil(async () => (await count('.pg-chip')) === 1);
    expect(await text('.pg-chip')).toBe('сохранено как 200');
    expect(await input.getValue()).toBe('200');
    await browser.waitUntil(async () => (await count('[data-pg-save="saved"]')) === 1, { timeoutMsg: '«Сохранено ✓» did not show after the debounced write' });
    await capture('pages-options-generation-saved-light', 'viewport');
    expect(await browser.execute(() => (window.__pages?.settings() as { settings: { generation: { windows: { quick: number } } } }).settings.generation.windows.quick)).toBe(200);

    // A switch goes at once.
    const before = await browser.execute(() => window.__pages?.requests('settings.patch').length ?? 0);
    await browser.$('[role="checkbox"][aria-label="Split по умолчанию"]').click();
    await browser.waitUntil(async () => (await browser.execute(() => window.__pages?.requests('settings.patch').length ?? 0)) === before + 1);
    expectHealthy(await probe(), 'light');
  });

  it('[ST-122] the page follows the system scheme when the theme says so', async () => {
    await open('page=options&state=working&theme=system', LAPTOP, 1, '#appearance');
    const system = await browser.execute(() => (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
    expect((await probe()).scheme).toBe(system);
    expect(await text('.pg-opt .pg-sub')).toContain(system === 'dark' ? 'тёмная' : 'светлая');
    // «Тёмная» switches the page without a reload.
    await browser.$('button=Тёмная').click();
    await browser.waitUntil(async () => (await probe()).scheme === 'dark');
    await capture('pages-options-switched-dark', 'viewport');
  });

  it('[DB-007] [DB-008] [NF-029] the debug pages: a prompt, no prompt, the journals', async () => {
    for (const theme of THEMES) {
      await open(`page=debug-prompt&state=debug&theme=${theme}&token=prompt-token-1`, LAPTOP);
      await capture(`pages-debug-prompt-${theme}`);
      expectHealthy(await probe(), theme);
      expect(await count('pre')).toBe(3);
      // The token of the snapshot is in the address only, never in the page.
      expect(await browser.execute(() => document.body.outerHTML.includes('prompt-token-1'))).toBe(false);
    }
    await open('page=debug-prompt&state=debug&theme=light&token=gone', LAPTOP);
    await capture('pages-debug-prompt-expired-light');
    expect(await count('[data-pg-prompt="expired"]')).toBe(1);
    await open('page=debug-prompt&state=working&theme=light&token=prompt-token-1', LAPTOP);
    expect(await count('[data-pg-prompt="debug-off"]')).toBe(1);

    await open('page=debug-journal&state=debug&theme=light', LAPTOP, 1, '#operations');
    await capture('pages-debug-journal-light');
    expectHealthy(await probe(), 'light');
    expect(await count('.pg-journal tbody tr')).toBe(2);
    // NF-029: the filters and the auto-refresh switch stand over the records.
    expect(await count('[data-pg-journal="filters"] button[aria-haspopup="menu"]')).toBe(2);
    expect(await count('[data-pg-journal="filters"] [role="checkbox"][aria-checked="true"]')).toBe(1);
    await open('page=debug-journal&state=debug&theme=dark', PHONE, 1, '#operations');
    await capture('pages-debug-journal-w320-dark');
    expectHealthy(await probe(), 'dark');
  });
});
