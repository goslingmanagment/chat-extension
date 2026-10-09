// Spenders, «Новые», the fan panel and the palette in headless Firefox
// (architecture.md §10.2 «Приёмка UI», §11; ui-design §0.2, §11): every drawn
// state of the binding mockup (11 a–j, 13 a–d, 14 a–c, 15 a–b, the quick
// jump) in both themes and both languages at 1440×900 and 1280×800. Each case
// checks that nothing sticks out, nothing failed, nothing was dispatched by
// merely opening, and saves a picture into .cache/e2e/ to compare by eye with
// the mockup. One state of each surface is then drawn at the browser's zoom
// of 125, 150 and 200 % (the 1440×900 window in CSS pixels), where Spenders
// and «Новые» fold into one column. Then the two measurements of §11 on a
// board of a thousand fans: opening it from data already in memory, and a
// search.

import { mkdirSync, writeFileSync } from 'node:fs';

import { browser, expect } from '@wdio/globals';

import { BOARDS_GALLERY_PATH, E2E_EVIDENCE_DIR } from '../../src/stand/paths';
import { useNetworkTrap } from '../support/network-trap';
import { standOrigin } from '../support/stand';

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
] as const;
/**
 * The 1440×900 window at the browser's zoom (architecture.md §10.2, ui-design
 * §11: 100 / 125 / 150 / 200 %): zooming a page shrinks its viewport in CSS
 * pixels, which is what our layout answers to.
 */
const ZOOMED = [
  { zoom: 125, width: 1152, height: 720 },
  { zoom: 150, width: 960, height: 600 },
  { zoom: 200, width: 720, height: 450 },
] as const;
/** One state of each surface at every zoom: the preview with «Отправить», a greeting in work, the fan panel, the palette, the palette's preview window. */
const ZOOM_STATES = ['11a', '11i', '13b', '14a', '15a', 'online-b'] as const;
/** With a preview open the statistics column gives way at this width and below; Spenders is one column from the second one down. */
const SPENDERS_NO_STATS_PX = 1120;
const SPENDERS_ONE_COLUMN_PX = 860;
/** «Новые» is one column at this width and below. */
const NEWCOMERS_ONE_COLUMN_PX = 900;
const THEMES = ['light', 'dark'] as const;
const LANGUAGES = ['ru', 'en'] as const;

/** State → what must be on the screen for it (a selector inside our root). */
const STATES: Readonly<Record<string, string>> = {
  '11a': '.cg-pvp',
  '11b': '.cg-pvp',
  '11c': '.cg-pvp',
  '11d': '.cg-pvp',
  '11e': '.cg-pvp',
  '11f': '.cg-pvp',
  '11g': '.cg-pvp',
  '11h': '.cg-pvp',
  '11i': '.cg-stx',
  '11j': '.cg-pvp',
  '13a': '.cg-nc',
  '13b': '.cg-nc',
  '13c': '.cg-nc',
  '13d': '.cg-nc',
  '14a': '.cg-fp',
  '14b': '.cg-fp',
  '14c': '.cg-fp',
  '15a': '.cg-pal',
  '15b': '.cg-pal',
  'quick-jump': '.cg-qj',
  'online-a': '.cg-pvw .cg-pv',
  'online-b': '.cg-pvw .cg-pvp',
  'online-c': '.cg-pvw .cg-pvp',
};

/** Budgets of architecture.md §11. */
const BOARD_OPEN_P95_MS = 150;
const SEARCH_MS = 50;
const MAX_DOM_ROWS = 150;

interface Probe {
  readonly failures: readonly string[];
  readonly dispatched: readonly string[];
  readonly overflow: readonly string[];
  readonly squeezed: readonly string[];
  readonly rows: number;
  readonly marker: number;
  readonly mode: string;
  readonly scheme: string | null;
  readonly scrollWidth: number;
  readonly clientWidth: number;
}

async function open(query: string, viewport: { readonly width: number; readonly height: number }): Promise<void> {
  const context = await browser.getWindowHandle();
  await browser.browsingContextSetViewport({ context, viewport: { width: viewport.width, height: viewport.height }, devicePixelRatio: 1 });
  await browser.url(`${standOrigin()}${BOARDS_GALLERY_PATH}?${query}`);
  await browser.waitUntil(async () => (await browser.execute(() => document.documentElement.getAttribute('data-boards-ready'))) === '1', {
    timeout: 15_000,
    timeoutMsg: `boards gallery not ready: ${query}`,
  });
}

async function probe(marker: string): Promise<Probe> {
  return browser.execute((selector) => {
    const boards = window.__boards;
    if (boards === undefined) throw new Error('window.__boards is missing');
    return {
      failures: boards.failures.map((failure) => `${failure.kind}:${failure.code}:${failure.name}`),
      dispatched: [...boards.dispatched()],
      overflow: [...boards.overflow()],
      squeezed: [...boards.squeezed()],
      rows: boards.listNodes(),
      marker: boards.count(selector),
      mode: boards.styles.mode,
      scheme: boards.scheme(),
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    };
  }, marker);
}

async function capture(name: string): Promise<void> {
  mkdirSync(E2E_EVIDENCE_DIR, { recursive: true });
  const context = await browser.getWindowHandle();
  const shot = await browser.browsingContextCaptureScreenshot({ context, origin: 'viewport' });
  writeFileSync(`${E2E_EVIDENCE_DIR}${name}.png`, Buffer.from(shot.data, 'base64'));
}

/** What is wrong with the case, in words; empty when it is healthy. */
function problems(result: Probe, theme: string): string[] {
  const found: string[] = [];
  if (result.marker === 0) found.push('the state did not render');
  if (result.failures.length > 0) found.push(`failures: ${result.failures.join(', ')}`);
  if (result.overflow.length > 0) found.push(`sticks out: ${result.overflow.join(', ')}`);
  if (result.squeezed.length > 0) found.push(`squeezed: ${result.squeezed.join(', ')}`);
  if (result.scrollWidth > result.clientWidth) found.push(`page scrolls sideways: ${result.scrollWidth} > ${result.clientWidth}`);
  if (result.rows > MAX_DOM_ROWS) found.push(`${result.rows} list rows in the DOM`);
  if (result.mode !== 'adopted') found.push(`styles are ${result.mode}`);
  if (result.scheme !== theme) found.push(`scheme is ${String(result.scheme)}`);
  // Opening a window inserts nothing, sends nothing and starts no generation (X8; UI-029).
  if (result.dispatched.length > 0) found.push(`dispatched by itself: ${result.dispatched.join(', ')}`);
  return found;
}

const percentile = (samples: readonly number[], share: number): number => {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * share) - 1)] ?? Number.POSITIVE_INFINITY;
};

describe('boards gallery: Spenders, «Новые», the fan panel and the palette as the mockup draws them', () => {
  useNetworkTrap();

  after(async () => {
    const context = await browser.getWindowHandle();
    await browser.browsingContextSetViewport({ context, viewport: null, devicePixelRatio: null });
  });

  for (const viewport of VIEWPORTS) {
    for (const [state, marker] of Object.entries(STATES)) {
      it(`${state} · ${viewport.width}×${viewport.height} · light/dark · ru/en`, async () => {
        const found: string[] = [];
        for (const theme of THEMES) {
          for (const language of LANGUAGES) {
            await open(`state=${state}&theme=${theme}&lang=${language}`, viewport);
            // The picture first: a failed check still leaves the evidence.
            await capture(`boards-${state}-${theme}-${language}-${viewport.width}x${viewport.height}`);
            for (const problem of problems(await probe(marker), theme)) found.push(`${theme}/${language}: ${problem}`);
          }
        }
        expect(found).toEqual([]);
      });
    }
  }

  for (const viewport of ZOOMED) {
    for (const state of ZOOM_STATES) {
      it(`${state} · zoom ${viewport.zoom} % (${viewport.width}×${viewport.height}) · light/dark · ru/en`, async () => {
        const found: string[] = [];
        for (const theme of THEMES) {
          for (const language of LANGUAGES) {
            await open(`state=${state}&theme=${theme}&lang=${language}`, viewport);
            await capture(`boards-${state}-${theme}-${language}-zoom${viewport.zoom}`);
            for (const problem of problems(await probe(STATES[state] ?? ''), theme)) found.push(`${theme}/${language}: ${problem}`);
          }
        }
        expect(found).toEqual([]);
      });
    }
  }

  it('a narrow window: the list keeps its width — the statistics give way to a preview, then Spenders and «Новые» become one column', async () => {
    for (const viewport of ZOOMED) {
      await open('state=11a&theme=light&lang=ru', viewport);
      const spenders = await browser.execute(() => ({ list: window.__boards?.box('.cg-bd') ?? null, preview: window.__boards?.box('.cg-pv') ?? null, stats: window.__boards?.box('.cg-st') ?? null, frame: window.__boards?.box('.cg-sp__cols') ?? null }));
      if (spenders.list === null || spenders.preview === null || spenders.stats === null || spenders.frame === null) throw new Error(`Spenders did not render at ${viewport.width}`);
      // The list never gets narrower than its columns need.
      expect(spenders.list.width).toBeGreaterThanOrEqual(380);
      if (viewport.width <= SPENDERS_ONE_COLUMN_PX) {
        // One column as wide as the window's body, top to bottom: the list, the preview, the statistics.
        for (const box of [spenders.list, spenders.preview, spenders.stats]) {
          expect(Math.round(box.left)).toBe(Math.round(spenders.frame.left));
          expect(Math.round(box.width)).toBe(Math.round(spenders.frame.width));
        }
        expect(spenders.list.height).toBeGreaterThanOrEqual(220);
        expect(spenders.preview.top).toBeGreaterThanOrEqual(spenders.list.top + spenders.list.height - 1);
        expect(spenders.stats.top).toBeGreaterThanOrEqual(spenders.preview.top + spenders.preview.height - 1);
        // The preview starts inside the window: opening it is seen.
        expect(spenders.preview.top).toBeLessThan(spenders.frame.top + spenders.frame.height);
      } else {
        expect(spenders.list.left).toBeLessThan(spenders.preview.left);
        expect(Math.round(spenders.list.top)).toBe(Math.round(spenders.preview.top));
        if (viewport.width <= SPENDERS_NO_STATS_PX) {
          // The list and the preview side by side; the statistics column is not drawn while the preview is open.
          expect(spenders.stats.display).toBe('none');
          expect(Math.round(spenders.preview.left + spenders.preview.width)).toBe(Math.round(spenders.frame.left + spenders.frame.width));
        } else {
          expect(spenders.preview.left).toBeLessThan(spenders.stats.left);
        }
      }
      // Without a preview the statistics column is back.
      await open('state=board-list&theme=light&lang=ru', viewport);
      const plain = await browser.execute(() => ({ list: window.__boards?.box('.cg-bd') ?? null, stats: window.__boards?.box('.cg-st') ?? null, squeezed: [...(window.__boards?.squeezed() ?? [])], overflow: [...(window.__boards?.overflow() ?? [])] }));
      expect(plain.stats?.display).not.toBe('none');
      expect(plain.stats?.width).toBeGreaterThanOrEqual(240);
      expect(plain.list?.width).toBeGreaterThanOrEqual(380);
      expect(plain.squeezed).toEqual([]);
      expect(plain.overflow).toEqual([]);

      await open('state=13b&theme=light&lang=ru', viewport);
      const fresh = await browser.execute(() => ({ list: window.__boards?.box('.cg-nc') ?? null, rows: window.__boards?.box('.cg-nc__list') ?? null, card: window.__boards?.box('.cg-pv') ?? null, frame: window.__boards?.box('.cg-nc__cols') ?? null }));
      if (fresh.list === null || fresh.rows === null || fresh.card === null || fresh.frame === null) throw new Error(`«Новые» did not render at ${viewport.width}`);
      // The rows are there at every width: three of 52 px under the column header.
      expect(fresh.rows.height).toBeGreaterThanOrEqual(28 + 3 * 52);
      if (viewport.width <= NEWCOMERS_ONE_COLUMN_PX) {
        expect(Math.round(fresh.card.left)).toBe(Math.round(fresh.list.left));
        expect(Math.round(fresh.card.width)).toBe(Math.round(fresh.frame.width));
        expect(fresh.card.top).toBeGreaterThanOrEqual(fresh.list.top + fresh.list.height - 1);
      } else {
        expect(fresh.list.left).toBeLessThan(fresh.card.left);
        expect(Math.round(fresh.list.top)).toBe(Math.round(fresh.card.top));
      }
    }
  });

  it('[SP-002] the list is the widest column; the statistics are a compact one of 240–272 px', async () => {
    for (const viewport of VIEWPORTS) {
      await open('state=11a&theme=light&lang=ru', viewport);
      const boxes = await browser.execute(() => ({ list: window.__boards?.box('.cg-bd') ?? null, preview: window.__boards?.box('.cg-pv') ?? null, stats: window.__boards?.box('.cg-st') ?? null }));
      expect(boxes.list).not.toBeNull();
      expect(boxes.stats?.width).toBeGreaterThanOrEqual(240);
      expect(boxes.stats?.width).toBeLessThanOrEqual(272);
      expect(boxes.list?.width).toBeGreaterThan(boxes.preview?.width ?? Number.POSITIVE_INFINITY);
      expect(boxes.list?.width).toBeGreaterThan(boxes.stats?.width ?? Number.POSITIVE_INFINITY);
      // Left to right: the list, the preview, the statistics.
      expect(boxes.list?.left).toBeLessThan(boxes.preview?.left ?? 0);
      expect(boxes.preview?.left).toBeLessThan(boxes.stats?.left ?? 0);
    }
  });

  it('[SP-012] a list column of 620 px or less prints the short column headers («Всего»)', async () => {
    const header = async (): Promise<{ width: number; long: string; short: string }> =>
      browser.execute(() => ({
        width: window.__boards?.box('.cg-bd')?.width ?? 0,
        long: window.__boards?.box('.cg-bd__colhead .cg-lbl-long')?.display ?? '',
        short: window.__boards?.box('.cg-bd__colhead .cg-lbl-short')?.display ?? '',
      }));
    await open('state=11a&theme=light&lang=ru', VIEWPORTS[1]);
    const narrow = await header();
    expect(narrow.width).toBeLessThanOrEqual(620);
    expect(narrow.long).toBe('none');
    expect(narrow.short).not.toBe('none');
    await open('state=board-list&theme=light&lang=ru', VIEWPORTS[0]);
    const wide = await header();
    expect(wide.width).toBeGreaterThan(620);
    expect(wide.long).not.toBe('none');
    expect(wide.short).toBe('none');
  });

  it('our text is the host’s: its font and the way it smooths it (ui-design §2.3)', async () => {
    await open('state=11a&theme=dark&lang=ru', VIEWPORTS[0]);
    const styles = await browser.execute(() => ({
      page: getComputedStyle(document.documentElement).getPropertyValue('-moz-osx-font-smoothing'),
      ours: window.__boards?.style('.cg-sp__title', '-moz-osx-font-smoothing') ?? null,
      pageFont: getComputedStyle(document.documentElement).fontFamily,
      ourFont: window.__boards?.style('.cg-sp__title', 'font-family') ?? null,
    }));
    expect(styles.page).toBe('grayscale');
    expect(styles.ours).toBe(styles.page);
    expect(styles.ourFont).toBe(styles.pageFont);
  });

  it('[SP-015] [SP-017] «ждёт ответа» is the age in bold ink, with no blue dot; a deleted fan is a muted name and the word', async () => {
    await open('state=board-list&theme=light&lang=ru', VIEWPORTS[0]);
    const marks = await browser.execute(() => ({
      waitWeight: Number(window.__boards?.style('.cg-bd__age.is-wait', 'font-weight') ?? '0'),
      plainWeight: Number(window.__boards?.style('.cg-bd__age:not(.is-wait)', 'font-weight') ?? '0'),
      dots: window.__boards?.count('.cg-bd__row .cg-dot') ?? -1,
      deletedName: window.__boards?.style('.cg-bd__row.is-deleted .cg-bd__name', 'color') ?? null,
      deletedDecoration: window.__boards?.style('.cg-bd__row.is-deleted .cg-bd__name', 'text-decoration-line') ?? null,
      muted: window.__boards?.style('.cg-bd__row.is-deleted .cg-bd__handle', 'color') ?? null,
      word: window.__boards?.text('.cg-bd__row.is-deleted .cg-bd__tag') ?? null,
    }));
    expect(marks.waitWeight).toBeGreaterThanOrEqual(500);
    expect(marks.plainWeight).toBe(400);
    expect(marks.dots).toBe(0);
    expect(marks.deletedName).toBe(marks.muted);
    expect(marks.deletedDecoration).toBe('none');
    expect(marks.word).toBe('удалён');
  });

  it('[CS-031] the fan panel is 320 px wide at the right edge of the container', async () => {
    await open('state=14a&theme=light&lang=ru', VIEWPORTS[0]);
    const box = await browser.execute(() => window.__boards?.box('.cg-side') ?? null);
    expect(box?.width).toBe(320);
  });

  it(`[SP-021] a board of 1000 fans keeps at most ${MAX_DOM_ROWS} rows in the DOM, in both themes`, async () => {
    for (const theme of THEMES) {
      await open(`state=board-list&rows=1000&theme=${theme}&lang=ru`, VIEWPORTS[0]);
      await capture(`boards-1000-${theme}-ru-1440x900`);
      const result = await browser.execute(() => ({ nodes: window.__boards?.listNodes() ?? -1, fans: window.__boards?.rows() ?? -1, footer: window.__boards?.text('.cg-sp__foot span') ?? '', overflow: [...(window.__boards?.overflow() ?? [])], failures: window.__boards?.failures.length ?? -1 }));
      expect(result.fans).toBeGreaterThan(0);
      expect(result.nodes).toBeLessThanOrEqual(MAX_DOM_ROWS);
      expect(result.footer).toMatch(/1[\s,.]?000/);
      expect(result.overflow).toEqual([]);
      expect(result.failures).toBe(0);
    }
  });

  it(`[SP-002] the board of 1000 fans opens from data in memory within ${BOARD_OPEN_P95_MS} ms at p95`, async () => {
    await open('state=board-list&rows=1000&theme=light&lang=ru', VIEWPORTS[0]);
    const samples = await browser.execute(async () => [...((await window.__boards?.reopen(20)) ?? [])]);
    expect(samples).toHaveLength(20);
    const p95 = percentile(samples, 0.95);
    writeFileSync(`${E2E_EVIDENCE_DIR}boards-open-ms.json`, JSON.stringify({ samples, p95, budget: BOARD_OPEN_P95_MS }));
    expect(p95).toBeLessThanOrEqual(BOARD_OPEN_P95_MS);
    // The board is back and alive after the last opening.
    expect(await browser.execute(() => window.__boards?.rows() ?? 0)).toBeGreaterThan(0);
  });

  it(`[SP-019] a search over 1000 fans answers within ${SEARCH_MS} ms`, async () => {
    await open('state=board-list&rows=1000&theme=light&lang=ru', VIEWPORTS[0]);
    const queries = ['tobias', 'a', 'moretti', 'zz-nobody', '', 'os', 'e', 'rossi99', '', 'kowal', 'i', 'nils', '@', 'tanaka', 'st', 'o', 'gruber', 'pavel p', 'jansen', ''];
    const runs: { query: string; totalMs: number; buildMs: number; shown: number }[] = [];
    for (const query of queries) {
      const result = await browser.execute(async (text) => window.__boards?.search(text) ?? null, query);
      if (result === null) throw new Error('window.__boards is missing');
      runs.push({ query, ...result });
    }
    const p95 = percentile(runs.map((run) => run.totalMs), 0.95);
    writeFileSync(`${E2E_EVIDENCE_DIR}boards-search-ms.json`, JSON.stringify({ runs, p95, budget: SEARCH_MS }));
    // p95 of twenty searches: one scheduler hiccup of a busy machine is not the board's time.
    expect(p95).toBeLessThanOrEqual(SEARCH_MS);
    // What the dataset costs to filter is far below the budget on any machine.
    expect(Math.max(...runs.map((run) => run.buildMs))).toBeLessThanOrEqual(SEARCH_MS / 2);
    // The answers are real: a narrow query finds some, an impossible one none, an empty one everybody.
    expect(runs[0]?.shown).toBeGreaterThan(0);
    expect(runs[0]?.shown).toBeLessThan(1000);
    expect(runs[3]?.shown).toBe(0);
    expect(runs[4]?.shown).toBe(1000);
    expect(await browser.execute(() => window.__boards?.listNodes() ?? -1)).toBeLessThanOrEqual(MAX_DOM_ROWS);
  });
});
