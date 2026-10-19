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

import { budgetMs } from '../../src/e2e-timing';
import { BOARDS_GALLERY_PATH, E2E_EVIDENCE_DIR } from '../../src/stand/paths';
import { summarize } from '../support/extension';
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
/** The statistics column gives way at this width and below, the list keeps its 380 px (X66: the preview unfolds in the list). */
const SPENDERS_NO_STATS_PX = 680;
/** «Новые» is one column at this width and below (ui/newcomers frame.css.ts, as on Fansly). */
const NEWCOMERS_ONE_COLUMN_PX = 760;
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
  '13a': '.cg-nw__side',
  '13b': '.cg-nw__side',
  '13c': '.cg-nw__side',
  '13d': '.cg-nw__side',
  '14a': '.cg-fp',
  '14b': '.cg-fp',
  '14c': '.cg-fp',
  '14d': '.cg-fp',
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

  it('[X55] «Размер текста: Крупнее»: Spenders with a preview and its statistics, «Новые» with a card, the fan panel, the palette — a step larger, nothing sticks out', async () => {
    const found: string[] = [];
    for (const state of ['11a', '11i', '13a', '14a', '15a'] as const) {
      for (const theme of THEMES) {
        await open(`state=${state}&theme=${theme}&lang=ru&text=large`, VIEWPORTS[0]);
        await capture(`boards-large-${state}-${theme}-ru-1440x900`);
        for (const problem of problems(await probe(STATES[state] ?? ''), theme)) found.push(`${state} ${theme}: ${problem}`);
      }
    }
    expect(found).toEqual([]);
  });

  it('[X66] a narrow window: the list keeps its width, the preview unfolds under its fan\'s row and both are in view; the statistics give way only at the narrowest; «Новые» becomes one column', async () => {
    for (const viewport of ZOOMED) {
      await open('state=11a&theme=light&lang=ru', viewport);
      const spenders = await browser.execute(() => ({
        list: window.__boards?.box('.cg-bd') ?? null,
        preview: window.__boards?.box('.cg-pv') ?? null,
        row: window.__boards?.box('.cg-bd__row[aria-expanded="true"]') ?? null,
        stats: window.__boards?.box('.cg-st') ?? null,
      }));
      if (spenders.list === null || spenders.preview === null || spenders.row === null || spenders.stats === null) throw new Error(`Spenders did not render at ${viewport.width}`);
      // The list never gets narrower than its columns need.
      expect(spenders.list.width).toBeGreaterThanOrEqual(380);
      // The preview: right under the fan's row, inside the list, the row and the whole preview in view together.
      expect(Math.abs(spenders.preview.top - (spenders.row.top + spenders.row.height))).toBeLessThanOrEqual(1);
      expect(spenders.preview.left).toBeGreaterThanOrEqual(spenders.list.left);
      expect(spenders.preview.left + spenders.preview.width).toBeLessThanOrEqual(spenders.list.left + spenders.list.width + 1);
      expect(spenders.preview.height).toBeGreaterThanOrEqual(150);
      expect(spenders.row.top).toBeGreaterThanOrEqual(spenders.list.top);
      expect(spenders.preview.top + spenders.preview.height).toBeLessThanOrEqual(spenders.list.top + spenders.list.height + 1);
      if (viewport.width <= SPENDERS_NO_STATS_PX) expect(spenders.stats.display).toBe('none');
      else {
        expect(spenders.stats.left).toBeGreaterThan(spenders.list.left);
        expect(Math.round(spenders.stats.top)).toBe(Math.round(spenders.list.top));
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
      const fresh = await browser.execute(() => ({ list: window.__boards?.box('.cg-nw__side') ?? null, rows: window.__boards?.box('.cg-nw__list') ?? null, card: window.__boards?.box('.cg-pv') ?? null, frame: window.__boards?.box('.cg-nw__main') ?? null }));
      if (fresh.list === null || fresh.rows === null || fresh.card === null || fresh.frame === null) throw new Error(`«Новые» did not render at ${viewport.width}`);
      // The rows are there at every width: three of 70 px.
      expect(fresh.rows.height).toBeGreaterThanOrEqual(3 * 70);
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

  it('[SP-002] [X66] the list is the widest; the statistics a compact column of 240–272 px beside it; the preview unfolds inside the list, under its fan\'s row', async () => {
    for (const viewport of VIEWPORTS) {
      await open('state=11a&theme=light&lang=ru', viewport);
      const boxes = await browser.execute(() => ({
        list: window.__boards?.box('.cg-bd') ?? null,
        preview: window.__boards?.box('.cg-pv') ?? null,
        row: window.__boards?.box('.cg-bd__row[aria-expanded="true"]') ?? null,
        stats: window.__boards?.box('.cg-st') ?? null,
      }));
      expect(boxes.list).not.toBeNull();
      expect(boxes.stats?.width).toBeGreaterThanOrEqual(240);
      expect(boxes.stats?.width).toBeLessThanOrEqual(272);
      expect(boxes.list?.width).toBeGreaterThan(boxes.stats?.width ?? Number.POSITIVE_INFINITY);
      // Left to right: the list, the statistics; the preview is in the list, right under the row it unfolds from.
      expect(boxes.list?.left).toBeLessThan(boxes.stats?.left ?? 0);
      expect(Math.abs((boxes.preview?.top ?? 0) - ((boxes.row?.top ?? 0) + (boxes.row?.height ?? 0)))).toBeLessThanOrEqual(1);
      expect((boxes.preview?.left ?? 0) + (boxes.preview?.width ?? 0)).toBeLessThanOrEqual((boxes.list?.left ?? 0) + (boxes.list?.width ?? 0) + 1);
      expect(boxes.stats?.left).toBeGreaterThanOrEqual((boxes.preview?.left ?? 0) + (boxes.preview?.width ?? 0) - 1);
    }
  });

  it('[X65] [X66] a short preview keeps its result and send buttons reachable by scrolling, without the composer overlapping the feed', async () => {
    for (const viewport of [VIEWPORTS[0], { width: 720, height: 450 }]) {
      await open('state=11a&theme=dark&lang=ru', viewport);
      const host = browser.$('[data-host="overlay"]');
      const send = host.shadow$('.cg-pv [data-cg-part="0"] .cg-pvs__send');
      await send.scrollIntoView({ block: 'center' });
      const boxes = await browser.execute(() => ({
        panel: window.__boards?.box('.cg-pv') ?? null,
        send: window.__boards?.box('.cg-pv [data-cg-part="0"] .cg-pvs__send') ?? null,
        middle: window.__boards?.box('.cg-pv__mid') ?? null,
        tools: window.__boards?.box('.cg-pv__tools') ?? null,
      }));
      if (boxes.panel === null || boxes.send === null || boxes.middle === null || boxes.tools === null) throw new Error('the preview did not render');
      expect(boxes.send.top).toBeGreaterThanOrEqual(boxes.panel.top);
      expect(boxes.send.top + boxes.send.height).toBeLessThanOrEqual(boxes.panel.top + boxes.panel.height);
      expect(boxes.tools.top).toBeGreaterThanOrEqual(boxes.middle.top + boxes.middle.height - 1);
      expect(await send.getText()).toContain('Отправить');
      await capture(`boards-send-reachable-${viewport.width}x${viewport.height}`);
    }
  });

  it('our text is the family’s on every site: the system UI face, smoothed, whatever the page’s own (ui-design §2.3; X60)', async () => {
    await open('state=11a&theme=dark&lang=ru', VIEWPORTS[0]);
    const styles = await browser.execute(() => ({
      // X67: the window's title is the old extension's serif, as Coach's (X63); its text is the family's.
      ours: window.__boards?.style('.cg-sp__sub', '-moz-osx-font-smoothing') ?? null,
      pageFont: getComputedStyle(document.documentElement).fontFamily,
      ourFont: window.__boards?.style('.cg-sp__sub', 'font-family') ?? null,
    }));
    expect(styles.ours).toBe('grayscale');
    expect(styles.ourFont).toContain('system-ui');
    expect(styles.ourFont).not.toBe(styles.pageFont);
  });

  it('[SP-015] [SP-017] [X67] a fan who waits has the chip «ждёт N» by the name, with no blue dot; a deleted fan is a muted name and the word', async () => {
    await open('state=board-list&theme=light&lang=ru', VIEWPORTS[0]);
    const marks = await browser.execute(() => ({
      wait: window.__boards?.text('.cg-bd__row .cg-bd__wait') ?? null,
      dots: window.__boards?.count('.cg-bd__row .cg-dot') ?? -1,
      deletedName: window.__boards?.style('.cg-bd__row.is-deleted .cg-bd__name', 'color') ?? null,
      deletedWeight: Number(window.__boards?.style('.cg-bd__row.is-deleted .cg-bd__name', 'font-weight') ?? '0'),
      deletedDecoration: window.__boards?.style('.cg-bd__row.is-deleted .cg-bd__name', 'text-decoration-line') ?? null,
      muted: window.__boards?.style('.cg-bd__row .cg-bd__handle', 'color') ?? null,
      word: window.__boards?.text('.cg-bd__row.is-deleted .cg-bd__tag') ?? null,
    }));
    expect(marks.wait).toMatch(/^ждёт /);
    expect(marks.dots).toBe(0);
    expect(marks.deletedName).toBe(marks.muted);
    expect(marks.deletedWeight).toBe(400);
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
      // X65: the whole list says no footer; its count is the pressed chip's «Все 1000».
      const result = await browser.execute(() => ({ nodes: window.__boards?.listNodes() ?? -1, fans: window.__boards?.rows() ?? -1, footer: window.__boards?.text('.cg-sp__filters .cg-flt[aria-pressed="true"] .cg-flt__n') ?? '', overflow: [...(window.__boards?.overflow() ?? [])], failures: window.__boards?.failures.length ?? -1 }));
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
    writeFileSync(`${E2E_EVIDENCE_DIR}boards-open-ms.json`, JSON.stringify({ samples, p95, budget: BOARD_OPEN_P95_MS, limit: budgetMs(BOARD_OPEN_P95_MS) }));
    const { median, max } = summarize(samples);
    console.log(`boards-gallery SP-002: open ms median/max ${median.toFixed(2)}/${max.toFixed(2)}, p95 ${p95.toFixed(2)} (limit ≤ ${budgetMs(BOARD_OPEN_P95_MS)})`);
    expect(p95).toBeLessThanOrEqual(budgetMs(BOARD_OPEN_P95_MS));
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
    writeFileSync(`${E2E_EVIDENCE_DIR}boards-search-ms.json`, JSON.stringify({ runs, p95, budget: SEARCH_MS, limit: budgetMs(SEARCH_MS), buildLimit: budgetMs(SEARCH_MS / 2) }));
    const total = summarize(runs.map((run) => run.totalMs));
    const build = summarize(runs.map((run) => run.buildMs));
    console.log(`boards-gallery SP-019: search ms median/max ${total.median.toFixed(2)}/${total.max.toFixed(2)}, p95 ${p95.toFixed(2)} (limit ≤ ${budgetMs(SEARCH_MS)}); filter median/max ${build.median.toFixed(2)}/${build.max.toFixed(2)} (max limit ≤ ${budgetMs(SEARCH_MS / 2)})`);
    // p95 of twenty searches: one scheduler hiccup of a busy machine is not the board's time.
    expect(p95).toBeLessThanOrEqual(budgetMs(SEARCH_MS));
    // The dataset's filtering work has its own bound, separate from painting the answer.
    expect(build.max).toBeLessThanOrEqual(budgetMs(SEARCH_MS / 2));
    // The answers are real: a narrow query finds some, an impossible one none, an empty one everybody.
    expect(runs[0]?.shown).toBeGreaterThan(0);
    expect(runs[0]?.shown).toBeLessThan(1000);
    expect(runs[3]?.shown).toBe(0);
    expect(runs[4]?.shown).toBe(1000);
    expect(await browser.execute(() => window.__boards?.listNodes() ?? -1)).toBeLessThanOrEqual(MAX_DOM_ROWS);
  });
});
