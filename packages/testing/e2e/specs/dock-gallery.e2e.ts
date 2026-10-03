// The dock and the overlays in headless Firefox (architecture.md §10.2
// «Приёмка UI», ui-design §11): every state of the binding mockup (1…10, 12,
// 16…19) and of ui-design §10 over synthetic view models, in both themes and
// languages, at 100/125/150/200 % zoom and at the composer widths 853, 693,
// 489 and 360 px, plus the 360–900 px sweep in 1 px steps. Zoom is the
// browser's: the CSS viewport shrinks and the device pixel ratio grows (BiDi
// browsingContext.setViewport), exactly as Ctrl/⌘+ does — so a composer wider
// than the zoomed window is not a case. Container queries, real fonts and
// real layout exist only here: each case checks what unit tests cannot (no
// overflow out of the composer, no overlap in the strip, the 34 px strip, the
// height limit, what hides on which width) and saves pictures into
// .cache/e2e/ to compare by eye with `final-<state>-*.png` of the mockup.

import { mkdirSync, writeFileSync } from 'node:fs';

import { browser, expect } from '@wdio/globals';

import { DOCK_GALLERY_PATH, E2E_EVIDENCE_DIR } from '../../src/stand/paths';
import { useNetworkTrap } from '../support/network-trap';
import { standOrigin } from '../support/stand';

interface Size {
  readonly width: number;
  readonly height: number;
}
/** The mockup's two windows: `final-*-light` and `final-*-1280-light`. */
const WINDOW: Size = { width: 1440, height: 900 };
const SMALL: Size = { width: 1280, height: 800 };
const ZOOMS = [1, 1.25, 1.5, 2] as const;
/** The reference composer widths (ui-design §3.3). */
const WIDTHS = [853, 693, 489, 360] as const;
const THEMES = ['light', 'dark'] as const;
const LANGUAGES = ['ru', 'en'] as const;
/** The page's own side padding around a stage. */
const PAGE_PADDING = 32;
/** Accent dots the dock states show (ui-design §1 п. 4): the whole list, per state. */
const ACCENTS = ['18b:archive-lag', '1b:recap-ready', '3c:result-stale', 'x-recap-slots:recap-ready'];

type Box = { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number; readonly width: number; readonly height: number };

async function setWindow(size: Size, zoom: number): Promise<void> {
  const context = await browser.getWindowHandle();
  await browser.browsingContextSetViewport({ context, viewport: { width: Math.round(size.width / zoom), height: Math.round(size.height / zoom) }, devicePixelRatio: zoom });
}

async function open(query: string, zoom = 1, size: Size = WINDOW): Promise<void> {
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

interface Health {
  readonly problems: readonly string[];
  readonly failures: readonly string[];
  readonly states: number;
  readonly mode: string;
  readonly accents: readonly string[];
  readonly scrollWidth: number;
  readonly clientWidth: number;
}

async function health(): Promise<Health> {
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

const shown = (id: string, selector: string): Promise<readonly string[]> => browser.execute((state, query) => [...(window.__dock?.shown(state, query) ?? [])], id, selector);
const box = (id: string, selector: string): Promise<Box | null> => browser.execute((state, query) => window.__dock?.box(state, query) ?? null, id, selector);
const measure = (id: string) => browser.execute((state) => window.__dock?.measure(state) ?? null, id);

function save(name: string, data: string): void {
  mkdirSync(E2E_EVIDENCE_DIR, { recursive: true });
  writeFileSync(`${E2E_EVIDENCE_DIR}${name}.png`, Buffer.from(data, 'base64'));
}

/** One picture per group of states: a whole page of 50 states at 200 % is taller than a picture may be. */
async function captureGroups(name: string): Promise<void> {
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

async function captureWindow(name: string): Promise<void> {
  const context = await browser.getWindowHandle();
  const shot = await browser.browsingContextCaptureScreenshot({ context, origin: 'viewport' });
  save(name, shot.data);
}

function expectHealthy(result: Health, width: number): void {
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

describe('dock gallery: every dock state in both themes and languages, 100–200 % zoom, composer 853/693/489/360 px', () => {
  useNetworkTrap();

  after(async () => {
    const context = await browser.getWindowHandle();
    await browser.browsingContextSetViewport({ context, viewport: null, devicePixelRatio: null });
  });

  for (const theme of THEMES) {
    for (const language of LANGUAGES) {
      for (const zoom of ZOOMS) {
        const fits = WIDTHS.filter((width) => width + PAGE_PADDING <= Math.round(WINDOW.width / zoom));
        for (const width of fits) {
          it(`[UI-002] [UI-018] every state · ${theme} · ${language} · ${zoom * 100} % · ${width} px`, async () => {
            await open(`theme=${theme}&lang=${language}&w=${width}`, zoom);
            // Pictures first: a failed check still leaves the evidence. At 100 % every width;
            // zoomed — the widest composer that fits and the narrowest.
            if (zoom === 1 || width === fits[0] || width === 360) await captureGroups(`dock-${theme}-${language}-z${zoom * 100}-w${width}`);
            expectHealthy(await health(), width);
          });
        }
      }
    }
  }
});

describe('dock gallery: what hides on which width (ui-design §3.3)', () => {
  useNetworkTrap();

  const SEVEN = ['Reply', 'Fix', 'Hi', 'Ping', 'Review', 'Recap', 'Coach'];
  const withKeys = (labels: readonly string[]): string[] => labels.map((label) => `${label}+key`);

  it('[UI-002] [UI-006] [UI-009] 853 px: seven buttons with their keys, Тон, Split, the persona and ⌘K; a crowded strip drops the persona', async () => {
    await open('theme=light&lang=ru&w=853');
    expect((await measure('1a'))?.buttons).toEqual([...withKeys(SEVEN), 'Тон', 'Split']);
    expect(await shown('1a', '.cg-persona')).toEqual(['Лора · VIP']);
    expect(await shown('1a', '.cg-hint')).toHaveLength(1);
    // «AI: 12» is on the strip: the persona gives way, the quota stays.
    expect(await shown('1b', '.cg-persona')).toEqual([]);
    expect(await shown('1b', '.cg-quota .cg-short')).toEqual(['AI: 12']);
    expect(await shown('1b', '.cg-quota .cg-long')).toEqual([]);
    // Hi: three variants side by side; the whole meta line in the head.
    const columns = await browser.execute(() => [1, 2, 3].map((index) => window.__dock?.box('4', `.cg-hi__col:nth-child(${index})`)?.left ?? null));
    expect(new Set(columns).size).toBe(3);
    expect((await shown('3a', '.cg-head__meta')).length).toBeGreaterThan(0);
    expect(await shown('3a', '.cg-head__draft')).toEqual(['черновик · не отправлено']);
    expect(await shown('3a', '.cg-keys')).toHaveLength(1);
    expect((await shown('2a', '.cg-stage')).length).toBeGreaterThan(1);
  });

  it('[UI-002] [UI-006] 693 px: seven buttons with their keys; no persona, no ⌘K; Hi still in three columns', async () => {
    await open('theme=light&lang=ru&w=693');
    expect((await measure('1a'))?.buttons).toEqual([...withKeys(SEVEN), 'Тон', 'Split']);
    expect(await shown('1a', '.cg-persona')).toEqual([]);
    expect(await shown('1a', '.cg-hint')).toEqual([]);
    const columns = await browser.execute(() => [1, 2, 3].map((index) => window.__dock?.box('4', `.cg-hi__col:nth-child(${index})`)?.left ?? null));
    expect(new Set(columns).size).toBe(3);
  });

  it('[UI-003] [UI-006] 489 px: Reply · Fix · Hi · Ping · Ещё without keys; Review, Recap and Coach live in «Ещё»; Hi in a column; the head keeps «черновик · не отправлено» and drops the meta; one stage', async () => {
    await open('theme=light&lang=ru&w=489');
    expect((await measure('1a'))?.buttons).toEqual(['Reply', 'Fix', 'Hi', 'Ping', 'Ещё', 'Тон', 'Split']);
    // 1d is the same strip with «Ещё» pressed: the three live in its menu, with their keys.
    expect(await shown('1d', '.cg-menu [role="menuitem"]')).toEqual(['Review⌘⇧B', 'Recap⌘⇧S', 'Coach⌘⇧C']);
    const columns = await browser.execute(() => [1, 2, 3].map((index) => window.__dock?.box('4', `.cg-hi__col:nth-child(${index})`)?.left ?? null));
    expect(new Set(columns).size).toBe(1);
    expect(await shown('3a', '.cg-head__meta')).toEqual([]);
    expect(await shown('3a', '.cg-head__draft')).toEqual(['черновик · не отправлено']);
    expect(await shown('3a', '.cg-hide .cg-ico')).toEqual([]);
    expect((await box('3a', '.cg-hide'))?.width ?? 0).toBeGreaterThan(26);
    expect(await shown('2a', '.cg-stage')).toHaveLength(1);
  });

  it('[UI-018] 360 px: «Вставить» under the text, × for «Скрыть», no keys footer, no quota; «черновик · не отправлено» stays whole', async () => {
    await open('theme=light&lang=ru&w=360');
    expect((await measure('1a'))?.buttons).toEqual(['Reply', 'Fix', 'Hi', 'Ping', 'Ещё', 'Тон', 'Split']);
    expect(await shown('1b', '.cg-quota')).toEqual([]);
    expect(await shown('3a', '.cg-keys')).toEqual([]);
    expect(await shown('3a', '.cg-hide .cg-ico')).toHaveLength(1);
    expect((await box('3a', '.cg-hide'))?.width).toBe(26);
    expect((await measure('3a'))?.draftVisible).toBe(true);
    const text = await box('3a', '.cg-part.is-next .cg-part__t');
    const insert = await box('3a', '.cg-part.is-next .cg-ins');
    expect(insert?.top).toBeGreaterThanOrEqual((text?.bottom ?? Number.POSITIVE_INFINITY) - 1);
  });

  it('[UI-005] the «Тон» menu and «Ещё» open above the strip and inside the dock at every reference width', async () => {
    // One menu at a time holds focus, so each is pictured on a page of its own.
    for (const width of WIDTHS) {
      await open(`state=1c&theme=light&lang=ru&w=${width}`);
      await captureWindow(`dock-menu-tone-light-ru-w${width}`);
      expect(await shown('1c', '.cg-menu [role^="menuitem"]')).toHaveLength(5);
      expect((await health()).problems).toEqual([]);
      const menu = await box('1c', '.cg-menu');
      const strip = await box('1c', '.cg-strip');
      expect(menu?.bottom ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(strip?.top ?? 0);
      if (width > 600) continue;
      await open(`state=1d&theme=dark&lang=en&w=${width}`);
      await captureWindow(`dock-menu-more-dark-en-w${width}`);
      expect(await shown('1d', '.cg-menu [role^="menuitem"]')).toEqual(['Review⌘⇧B', 'Recap⌘⇧S', 'Coach⌘⇧C']);
      expect((await health()).problems).toEqual([]);
    }
  });

  for (const language of LANGUAGES) {
    it(`[UI-004] 900 → 360 px in 1 px steps · ${language}: no overflow, no overlap, the strip stays 34 px, and what a narrower composer hid never comes back`, async () => {
      await open(`theme=light&lang=${language}&w=900`);
      const problems: string[] = [];
      // In chunks: one script call may not run for half a minute.
      for (let from = 900; from > 360; from -= 60) {
        const to = Math.max(360, from - 59);
        problems.push(
          ...(await browser.execute(
            async (start, end, last) => {
              const dock = window.__dock;
              if (dock === undefined) throw new Error('window.__dock is missing');
              const frame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));
              // Counts that may only fall as the composer narrows (ui-design §3.3 «правила идут в одну сторону»).
              const ONE_WAY: readonly (readonly [string, string])[] = [
                ['1a', '.cg-strip__acts kbd'],
                ['1a', '.cg-slot--two'],
                ['1a', '.cg-persona'],
                ['1a', '.cg-hint'],
                ['1b', '.cg-quota'],
                ['1b', '.cg-long'],
                ['3a', '.cg-head__meta'],
                ['3a', '.cg-keys'],
                ['2a', '.cg-stage'],
              ];
              const before = last ?? {};
              const out: string[] = [];
              for (let px = start; px >= end; px -= 1) {
                dock.setWidth(px);
                // One frame: the geometry reaches the surfaces and they render; reading boxes lays them out.
                await frame();
                out.push(...dock.check());
                for (const [state, selector] of ONE_WAY) {
                  const key = `${state} ${selector}`;
                  const count = dock.shown(state, selector).length;
                  if (before[key] !== undefined && count > before[key]) out.push(`${key} came back at ${px} px: ${before[key]} → ${count}`);
                  before[key] = count;
                }
                if (out.length > 12) break;
              }
              (window as unknown as { __sweep?: Record<string, number> }).__sweep = before;
              return out;
            },
            from,
            to,
            await browser.execute(() => (window as unknown as { __sweep?: Record<string, number> }).__sweep ?? null),
          )),
        );
        if (problems.length > 0) break;
      }
      expect(problems).toEqual([]);
      // The sweep ended on the narrowest reference width.
      expect((await measure('1a'))?.strip).toBe(34);
    });
  }

  it('[UI-003] «Ещё» stays inside the dock while the composer narrows under the open menu (600 → 360 px), and goes away with its button on a wide one', async () => {
    await open('state=1d&theme=light&lang=ru&w=600');
    expect(await shown('1d', '.cg-menu [role="menuitem"]')).toHaveLength(3);
    const problems = await browser.execute(async () => {
      const dock = window.__dock;
      if (dock === undefined) throw new Error('window.__dock is missing');
      const frame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));
      const out: string[] = [];
      for (let px = 600; px >= 360; px -= 1) {
        dock.setWidth(px);
        await frame();
        await frame();
        out.push(...dock.check());
        if (dock.shown('1d', '.cg-menu [role="menuitem"]').length !== 3) out.push(`the menu closed at ${px} px`);
        if (out.length > 12) break;
      }
      return out;
    });
    expect(problems).toEqual([]);
    await browser.execute(async () => {
      window.__dock?.setWidth(700);
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    expect(await shown('1d', '.cg-menu')).toEqual([]);
    expect((await measure('1d'))?.buttons).toHaveLength(9);
  });
});

describe('dock gallery: both «Вид ответа» and the height limit (ui-design §3.2, §11 п. 3–4)', () => {
  useNetworkTrap();

  for (const state of ['3a', '4'] as const) {
    for (const theme of THEMES) {
      it(`«без подложки» and «на подложке» on ${state} · ${theme}: the sheet meets the strip, or stands 2 px above it`, async () => {
        for (const style of ['bare', 'sheet'] as const) {
          await open(`state=${state}&theme=${theme}&lang=ru&w=853&style=${style}`);
          await captureWindow(`dock-view-${state}-${style}-${theme}`);
          const sheet = await box(state, '.cg-sheet');
          const strip = await box(state, '.cg-strip');
          expect(strip?.height).toBe(34);
          expect((strip?.top ?? 0) - (sheet?.bottom ?? 0)).toBeCloseTo(style === 'sheet' ? 2 : 0, 1);
          const result = await health();
          expect(result.problems).toEqual([]);
          expect(result.failures).toEqual([]);
        }
      });
    }
  }

  it('the collapsed dock is exactly 34 px tall and nothing else', async () => {
    await open('state=1a&theme=light&lang=ru&w=853');
    expect((await box('1a', '.cg-dock'))?.height).toBe(34);
    expect((await measure('1a'))?.sheet).toBe(0);
  });

  it('the sheet is never above min(360, 45 % of the window, feed − 160 − gap): 360 at 1440 × 900; 314 / 312 at 1280 × 800, where the feed keeps exactly 160 px', async () => {
    // Hi in a 489 px composer is taller than any limit: the sheet stands at the limit and its body scrolls.
    const cases = [
      { query: 'vh=900&feed=574&style=bare', cap: 360, gap: 0, feed: 574 },
      { query: 'vh=900&feed=574&style=sheet', cap: 360, gap: 2, feed: 574 },
      { query: 'vh=800&feed=474&style=bare', cap: 314, gap: 0, feed: 474 },
      { query: 'vh=800&feed=474&style=sheet', cap: 312, gap: 2, feed: 474 },
      // A window so low that 160 px for the feed would squeeze the sheet under 112 px: 112 wins.
      { query: 'vh=500&feed=240&style=bare', cap: 112, gap: 0, feed: 240 },
    ];
    for (const item of cases) {
      await open(`state=4&theme=light&lang=ru&w=489&${item.query}`, 1, item.feed === 474 ? SMALL : WINDOW);
      const measured = await measure('4');
      expect(measured?.cap).toBe(item.cap);
      expect(measured?.sheet).toBe(item.cap);
      expect(measured?.strip).toBe(34);
      if (item.cap > 112) expect(item.feed - item.cap - item.gap).toBeGreaterThanOrEqual(160);
      // The head stays; only the body scrolls.
      const body = await browser.execute(() => {
        const own = window.__dock?.box('4', '.cg-body');
        const head = window.__dock?.box('4', '.cg-head');
        return own === null || own === undefined || head === null || head === undefined ? null : { body: own.height, head: head.height };
      });
      expect(body?.head).toBeGreaterThanOrEqual(34);
      expect((body?.body ?? 0) + (body?.head ?? 0)).toBeLessThanOrEqual(item.cap);
    }
  });

  it('[UI-030] the debug cost line and the stage profiler stand under the result only in debug mode', async () => {
    await open('state=10&theme=light&lang=ru&w=853');
    await captureWindow('dock-debug-10-light-ru');
    expect(await shown('10', '.cg-debug')).toHaveLength(1);
    await open('state=3a&theme=light&lang=ru&w=853');
    expect(await shown('3a', '.cg-debug')).toEqual([]);
  });
});

describe('dock gallery: the overlays — toasts, the cheatsheet, Coach, the expanded result', () => {
  useNetworkTrap();

  after(async () => {
    const context = await browser.getWindowHandle();
    await browser.browsingContextSetViewport({ context, viewport: null, devicePixelRatio: null });
  });

  const OVERLAYS = ['12a', '12b', '16', '17a', '17b', 'x-coach-answering', 'x-coach-failed', 'x-expanded-recap', 'x-expanded-review'] as const;
  /** What lies under a point of the window: our overlay host, or the page (ChatSpace's own). */
  const under = (x: number, y: number): Promise<string> =>
    browser.execute((left, top) => {
      const element = document.elementFromPoint(left, top);
      return element === null ? 'nothing' : element.getAttribute('data-cg') === 'overlay' ? 'overlay' : element.className.toString();
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
      // Coach: a 320 px panel at the right edge under the top bar, the whole height (ui-design §3.7).
      const panel = await box(id, '.cg-side');
      expect(panel?.width).toBe(Math.min(320, view.width));
      expect(panel?.top).toBe(44);
      expect(panel?.right).toBe(view.width);
      expect(panel?.bottom).toBe(view.height);
      // Not modal: the chat beside the panel stays the page's own (UI-024).
      expect(await under(80, view.height / 2)).not.toBe('overlay');
      // The question field and «Спросить» are on screen whatever the turns' length.
      const ask = await box(id, '.cg-co__ask');
      expect(ask?.bottom ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(view.height);
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
