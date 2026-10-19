// The overlays in headless Firefox (ui-design §3.4, §3.7…§3.9, §4.19; UI-014,
// UI-017, UI-024, ER-020): toasts, the cheatsheet, Coach and the expanded
// result at 1440 × 900 and 1280 × 800, in both themes and languages and
// zoomed — where each stands, what stays clickable under the layer, and that
// a surface which failed to render keeps a card whose buttons can be pressed.

import { browser, expect } from '@wdio/globals';

import { SMALL, THEMES, LANGUAGES, WINDOW, box, captureWindow, dispatched, health, open, resetWindow, shown, type Size } from '../support/dock-gallery';
import { useNetworkTrap } from '../support/network-trap';

describe('dock gallery: the overlays — toasts, the cheatsheet, Coach, the expanded result', () => {
  useNetworkTrap();

  after(resetWindow);

  const OVERLAYS = ['12a', '12b', '16', '17a', '17b', 'x-coach-answering', 'x-coach-failed', 'x-coach-confirm', 'x-coach-debug', 'x-expanded-recap', 'x-expanded-review'] as const;
  /** What lies under a point of the window: our overlay host, or the page (ChatSpace's own). */
  const under = (x: number, y: number): Promise<string> =>
    browser.execute((left, top) => {
      const element = document.elementFromPoint(left, top);
      return element === null ? 'nothing' : element.getAttribute('data-host') === 'overlay' ? 'overlay' : element.className.toString();
    }, x, y);

  async function expectOverlay(id: (typeof OVERLAYS)[number], view: Size): Promise<void> {
    const result = await health();
    expect(result.failures).toEqual([]);
    expect(result.problems).toEqual([]);
    expect(result.scrollWidth).toBeLessThanOrEqual(result.clientWidth);
    const composer = await browser.execute(() => {
      const own = document.querySelector('.gal-composer')?.getBoundingClientRect();
      return own === undefined ? null : { x: own.left + 40, y: own.top + own.height / 2 };
    });
    if (id === '12a' || id === '12b') {
      // Top right, 12 px under the top bar, 20 px left of ChatSpace's right rail (ui-design §3.9); three at most.
      const toasts = await shown(id, '.cg-toast');
      expect(toasts.length).toBeGreaterThan(0);
      expect(toasts.length).toBeLessThanOrEqual(3);
      const stack = await box(id, '.cg-toasts');
      const first = await box(id, '.cg-toast');
      expect(stack?.top).toBe(56);
      expect(first?.top).toBe(56);
      expect(first?.width).toBe(360);
      expect(view.width - (first?.right ?? 0)).toBe(84);
      expect(stack?.bottom ?? 0).toBeLessThanOrEqual(view.height);
      // A toast never covers the composer, and the page under the layer stays clickable (UI-024).
      if (composer !== null) expect(await under(composer.x, composer.y)).toContain('gal-composer');
    } else if (id === '16') {
      // A dialog in the centre: 96 px from the top, min(720, 100vw − 32) wide, at most 100vh − 140 tall (ui-design §3.8).
      const dialog = await box(id, '[role="dialog"]');
      const width = Math.min(720, view.width - 32);
      expect(dialog?.top).toBe(96);
      expect(dialog?.width).toBeCloseTo(width, 0);
      expect(dialog?.left).toBeCloseTo((view.width - width) / 2, 0);
      expect(dialog?.height ?? 0).toBeLessThanOrEqual(view.height - 140);
      const lefts = await browser.execute(() => [1, 2].map((index) => window.__dock?.box('16', `.cg-cs__body > div:nth-child(${index})`)?.left ?? null));
      expect(new Set(lefts).size).toBe(view.width <= 640 ? 1 : 2);
      // Modal: the scrim takes every press outside the dialog (UI-017).
      expect(await under(10, 10)).toBe('overlay');
      if (composer !== null) expect(await under(composer.x, composer.y)).toBe('overlay');
    } else if (id === 'x-expanded-recap' || id === 'x-expanded-review') {
      const dialog = await box(id, '[role="dialog"]');
      expect(dialog?.top ?? -1).toBeGreaterThanOrEqual(0);
      expect(dialog?.bottom ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(view.height);
      expect(dialog?.left ?? -1).toBeGreaterThanOrEqual(0);
      expect(dialog?.right ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(view.width);
      expect(await shown(id, '.cg-collapse')).toHaveLength(1);
      expect(await under(10, 10)).toBe('overlay');
    } else {
      // Coach (X62, ui-design §4.19): the old extension's window — 720 px over the middle of the container (the gallery's:
      // right of a 64 px rail, under a 44 px bar), 20 px under its top and never nearer the window's edges, at most 84 % of
      // the window high, over a scrim.
      const panel = await box(id, '.cg-coach');
      const container = { left: 64, top: 44, width: view.width - 64, height: view.height - 44 };
      const half = Math.min(360, view.width / 2 - 20);
      const middle = Math.min(Math.max(container.left + container.width / 2, half + 20), view.width - half - 20);
      expect(Math.abs((panel?.width ?? 0) - 2 * half)).toBeLessThanOrEqual(1);
      expect(Math.abs(((panel?.left ?? 0) + (panel?.right ?? 0)) / 2 - middle)).toBeLessThanOrEqual(1);
      expect(Math.abs((panel?.top ?? 0) - (container.top + 20))).toBeLessThanOrEqual(1);
      expect(panel?.bottom ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(Math.min(container.top + container.height - 20, view.height) + 1);
      expect(panel?.height ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(Math.min(0.84 * view.height, 860) + 1);
      // The scrim: the chat beside the window is under our layer — a press there closes Coach, as in the old window.
      expect(await under(Math.max(2, (panel?.left ?? 0) - 10), view.height / 2)).toBe('overlay');
      // The question field and «Спросить» are on screen whatever the turns' length.
      const ask = await box(id, '.cg-co__ask');
      expect(ask?.bottom ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(panel?.bottom ?? view.height);
      // Б2 in a draft part and the debug footer of a turn stay inside the window.
      for (const selector of ['.cg-confirm', '.cg-debug']) {
        const inner = await box(id, selector);
        if (inner === null) continue;
        expect(inner.left).toBeGreaterThanOrEqual(panel?.left ?? 0);
        expect(inner.right).toBeLessThanOrEqual(panel?.right ?? 0);
      }
      if (id === 'x-coach-confirm') expect(await shown(id, '.cg-confirm button')).toHaveLength(3);
      if (id === 'x-coach-debug') expect(await shown(id, '.cg-debug__link')).toHaveLength(1);
    }
  }

  for (const id of OVERLAYS) {
    for (const theme of THEMES) {
      for (const language of LANGUAGES) {
        // States of ui-design §10 without a mockup picture: one light and one dark case.
        if (id.startsWith('x-') && (theme === 'light') !== (language === 'ru')) continue;
        it(`[UI-014] [UI-017] [HK-034] ${id} · ${theme} · ${language} · 1440 × 900 and 1280 × 800`, async () => {
          for (const size of [WINDOW, SMALL]) {
            await open(`state=${id}&theme=${theme}&lang=${language}`, 1, size);
            await captureWindow(`overlay-${id}-${theme}-${language}-${size.width}x${size.height}`);
            await expectOverlay(id, size);
          }
        });
      }
    }
  }

  it('[ER-020] [UI-024] a surface that failed to render keeps a card at the top right whose buttons take a real click; the chat beside it stays the page\'s', async () => {
    const id = 'x-overlay-failed';
    for (const size of [WINDOW, SMALL]) {
      await open(`state=${id}&theme=light&lang=ru`, 1, size);
      await captureWindow(`overlay-${id}-light-ru-${size.width}x${size.height}`);
      expect((await health()).failures).toEqual(['render:CG-UI-FAILED:TypeError']);
      const card = await box(id, '.cg-boundary');
      expect(card?.top).toBe(56);
      expect(card?.width).toBe(360);
      expect(size.width - (card?.right ?? 0)).toBe(16);
      expect(card?.bottom ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(size.height);
      expect(await shown(id, '.cg-boundary .cg-card__code')).toEqual(['ChatGoose · CG-UI-FAILED']);
      // Outside the card the layer lets presses through to the page.
      expect(await under(80, size.height / 2)).not.toBe('overlay');
      // A real pointer press on each button reaches it: the overlay root alone would let it fall through.
      for (const [index, action] of [[1, 'ExportDiagnostics'], [0, 'ReloadSurface']] as const) {
        const target = await browser.execute((state, nth) => window.__dock?.box(state, `.cg-boundary .cg-card__acts > button:nth-of-type(${nth + 1})`) ?? null, id, index);
        if (target === null) throw new Error(`no button ${index} in the card`);
        const x = Math.round(target.left + target.width / 2);
        const y = Math.round(target.top + target.height / 2);
        expect(await under(x, y)).toBe('overlay');
        await browser.action('pointer').move({ x, y }).down().up().perform();
        await browser.waitUntil(async () => (await dispatched(id)).includes(action), { timeout: 5_000, timeoutMsg: `the press on button ${index} dispatched no ${action}` });
      }
      expect(await dispatched(id)).toEqual(['ExportDiagnostics', 'ReloadSurface']);
    }
  });

  for (const zoom of [1.25, 1.5, 2] as const) {
    it(`[CS-014] the overlays at ${zoom * 100} % · light · ru: 1440 × 900 and 1280 × 800 windows`, async () => {
      for (const size of [WINDOW, SMALL]) {
        const view = { width: Math.round(size.width / zoom), height: Math.round(size.height / zoom) };
        for (const id of ['12a', '16', '17a', 'x-expanded-recap'] as const) {
          await open(`state=${id}&theme=light&lang=ru`, zoom, size);
          await captureWindow(`overlay-${id}-light-ru-${size.width}x${size.height}-z${zoom * 100}`);
          await expectOverlay(id, view);
        }
      }
    });
  }
});
