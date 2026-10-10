// The dock in headless Firefox: what hides on which composer width (ui-design
// §3.3), the wide strip with the tones as buttons (both kinds of key labels),
// the 900 → 320 px sweep in 1 px steps, both «Вид ответа», the height limit
// (§3.2) and the order of Tab (§6.3). Every state in every theme,
// language and zoom is dock-gallery-states-*.e2e.ts; the overlays are
// dock-gallery-overlays.e2e.ts.

import { browser, expect } from '@wdio/globals';

import { COLUMN, LANGUAGES, SMALL, THEMES, WIDTHS, WINDOW, box, captureWindow, focused, health, measure, open, resetWindow, shown } from '../support/dock-gallery';
import { useNetworkTrap } from '../support/network-trap';

describe('dock gallery: what hides on which width (ui-design §3.3)', () => {
  useNetworkTrap();
  after(resetWindow);

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

  const TONES = ['Casual', 'Flirt', 'Sell', 'Spice'];
  const WINDOWS = ['Spenders', 'Новые'];
  /** The tones stand right after Reply: they are its own. */
  const withTones = (actions: readonly string[]): string[] => [...actions.slice(0, 1), ...TONES, ...actions.slice(1)];

  it('[AI-002] [NEW-01] a wide composer (from 1000 px with short key labels): the tones are four buttons instead of the «Тон» menu, Spenders and «Новые» stand in the strip; the persona and ⌘K come back at 1120 px', async () => {
    await open('theme=light&lang=ru&w=1000');
    await captureWindow('dock-wide-light-ru-w1000');
    expect((await measure('1a'))?.buttons).toEqual([...withTones(withKeys(SEVEN)), 'Split', ...WINDOWS]);
    expect(await shown('1a', '.cg-persona')).toEqual([]);
    expect(await shown('1a', '.cg-hint')).toEqual([]);
    // A crowded strip («AI: 12», a generation with its two locks) still fits, the quota short.
    expect(await shown('1b', '.cg-quota .cg-short')).toEqual(['AI: 12']);
    expect((await measure('2a'))?.buttons).toEqual(['Reply+key', ...TONES, 'Fix', 'Hi', 'Ping', 'Review', 'Recap', 'Coach', 'Split', ...WINDOWS]);
    expect(await shown('2a', '.cg-tones > .cg-lock')).toHaveLength(1);
    // While the chat loads nothing can be opened from the strip: the two windows give their place to the status words.
    expect((await measure('9d'))?.buttons).toEqual([...withTones(SEVEN), 'Split']);
    expect((await health()).problems).toEqual([]);
    await open('theme=light&lang=ru&w=1120');
    expect((await measure('1a'))?.buttons).toEqual([...withTones(withKeys(SEVEN)), 'Split', ...WINDOWS]);
    expect(await shown('1a', '.cg-persona')).toEqual(['Лора · VIP']);
    expect(await shown('1a', '.cg-hint')).toHaveLength(1);
    expect((await health()).problems).toEqual([]);
    // One pixel narrower than wide: the strip of the reference widths, as it was.
    await open('theme=light&lang=ru&w=999');
    expect((await measure('1a'))?.buttons).toEqual([...withKeys(SEVEN), 'Тон', 'Split']);
    expect(await shown('1a', '.cg-persona')).toEqual(['Лора · VIP']);
  });

  it('[UI-006] long key labels («Ctrl+Alt+B», Windows and Linux): the wide strip starts at 840 px — a 1440 px window (a composer of 853 px) has it — and the labels stay off the buttons until 1320 px — in the tooltips and the cheatsheet they always are', async () => {
    await open('theme=dark&lang=ru&w=840&os=win');
    await captureWindow('dock-wide-dark-ru-win-w840');
    expect((await measure('1a'))?.buttons).toEqual([...withTones(SEVEN), 'Split', ...WINDOWS]);
    expect(await shown('1a', '.cg-persona')).toEqual([]);
    expect((await health()).problems).toEqual([]);
    await open('theme=dark&lang=ru&w=980&os=win');
    expect((await measure('1a'))?.buttons).toEqual([...withTones(SEVEN), 'Split', ...WINDOWS]);
    expect(await shown('1a', '.cg-persona')).toEqual(['Лора · VIP']);
    await open('theme=dark&lang=ru&w=1320&os=win');
    await captureWindow('dock-wide-dark-ru-win-w1320');
    expect((await measure('1a'))?.buttons).toEqual([...withTones(withKeys(SEVEN)), 'Split', ...WINDOWS]);
    expect(await shown('1a', '.cg-strip__acts kbd')).toEqual(['Ctrl+E', 'Ctrl+I', 'Ctrl+G', 'Ctrl+P', 'Ctrl+Alt+B', 'Ctrl+Alt+S', 'Ctrl+Alt+C']);
    expect((await health()).problems).toEqual([]);
    // Below 840 px: the «Тон» menu, and still no long labels on the buttons — they would not fit there either.
    await open('theme=dark&lang=ru&w=839&os=win');
    expect((await measure('1a'))?.buttons).toEqual([...SEVEN, 'Тон', 'Split']);
    expect((await health()).problems).toEqual([]);
  });

  for (const os of ['mac', 'win'] as const) {
    it(`[UI-004] 1400 → 700 px · ${os} key labels: every dock state fits the wide strip and the step down to the narrow one — no overflow, no overlap, the strip stays 34 px`, async () => {
      await open(`theme=light&lang=en&w=1400${os === 'win' ? '&os=win' : ''}`);
      const problems: string[] = [];
      for (let from = 1400; from > 700; from -= 100) {
        problems.push(
          ...(await browser.execute(
            async (start, end) => {
              const dock = window.__dock;
              if (dock === undefined) throw new Error('window.__dock is missing');
              const frame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));
              const out: string[] = [];
              for (let px = start; px > end; px -= 2) {
                dock.setWidth(px);
                await frame();
                out.push(...dock.check());
                if (out.length > 12) break;
              }
              return out;
            },
            from,
            from - 100,
          )),
        );
        if (problems.length > 0) break;
      }
      expect(problems).toEqual([]);
    });
  }

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
    it(`[UI-004] 900 → ${COLUMN} px in 1 px steps · ${language}: no overflow, no overlap, the strip stays 34 px, and what a narrower composer hid never comes back`, async () => {
      await open(`theme=light&lang=${language}&w=900`);
      const problems: string[] = [];
      // In chunks: one script call may not run for half a minute.
      for (let from = 900; from > COLUMN; from -= 60) {
        const to = Math.max(COLUMN, from - 59);
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
      // The sweep ended on the column (ui-design §6.5).
      expect((await measure('1a'))?.strip).toBe(34);
      expect((await box('1a', '.cg-dock'))?.width).toBe(COLUMN);
    });
  }

  it(`below 360 px the buttons of a Recap head take a second line inside the dock; a draft head stays one line with «черновик · не отправлено» whole (${COLUMN} px)`, async () => {
    await open(`theme=light&lang=ru&w=${COLUMN}`);
    await captureWindow(`dock-column-${COLUMN}-light-ru`);
    expect((await health()).problems).toEqual([]);
    for (const id of ['18a', '18b', '18c'] as const) {
      const dock = await box(id, '.cg-dock');
      const head = await box(id, '.cg-head');
      const title = await box(id, '.cg-head__title');
      const acts = await box(id, '.cg-head__acts');
      const close = await box(id, '.cg-hide');
      // Two lines: the buttons stand under the title and the segment, at the right edge, whole.
      expect(head?.height ?? 0).toBeGreaterThan(50);
      expect(acts?.top ?? 0).toBeGreaterThanOrEqual((title?.bottom ?? Number.POSITIVE_INFINITY) - 1);
      expect(acts?.left ?? -1).toBeGreaterThanOrEqual(dock?.left ?? 0);
      expect(close?.right ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(dock?.right ?? 0);
      expect(close?.width).toBe(26);
    }
    expect((await box('3a', '.cg-head'))?.height).toBe(34);
    expect((await measure('3a'))?.draftVisible).toBe(true);
    // At 360 px, the narrowest reference width, the same head is one line, as in the mockup.
    await open('theme=light&lang=ru&w=360');
    expect((await box('18b', '.cg-head'))?.height).toBe(34);
  });

  it('Tab goes strip → head buttons → the next part → its buttons → … → the footer (ui-design §6.3), though the sheet stands above the strip on screen', async () => {
    await open('state=3a&theme=light&lang=ru&w=853');
    // On screen: the sheet above, the strip below.
    expect((await box('3a', '.cg-sheet'))?.bottom ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(((await box('3a', '.cg-strip'))?.top ?? 0) + 0.5);
    const stops: string[] = [];
    for (let press = 0; press < 16; press += 1) {
      await browser.keys('Tab');
      const now = await focused('3a');
      if (now === null) break;
      stops.push(now.includes('cg-act') ? 'strip' : now.includes('cg-again') ? 'again' : now.includes('cg-keys__hide') ? 'footer' : now.includes('cg-hide') ? 'hide' : /\bcg-part\b/.test(now) ? 'part' : now.includes('cg-part__copy') ? 'copy' : now.includes('cg-ins') ? 'insert' : now);
    }
    // One stop for the strip, the head's two buttons, one stop for the parts (the next one), then each part's own buttons, the footer last.
    expect(stops).toEqual(['strip', 'again', 'hide', 'part', 'copy', 'insert', 'copy', 'insert', 'copy', 'insert', 'footer']);
  });

  it('[UI-003] «Ещё» stays inside the dock while the composer narrows under the open menu (600 → 320 px), and goes away with its button on a wide one', async () => {
    await open('state=1d&theme=light&lang=ru&w=600');
    expect(await shown('1d', '.cg-menu [role="menuitem"]')).toHaveLength(3);
    const problems = await browser.execute(async () => {
      const dock = window.__dock;
      if (dock === undefined) throw new Error('window.__dock is missing');
      const frame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));
      const out: string[] = [];
      for (let px = 600; px >= 320; px -= 1) {
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
  after(resetWindow);

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

  it('[UI-030] the debug cost line and the stage profiler stand under the result — and under a Recap — only in debug mode', async () => {
    await open('state=10&theme=light&lang=ru&w=853');
    await captureWindow('dock-debug-10-light-ru');
    expect(await shown('10', '.cg-debug')).toHaveLength(1);
    await open('state=3a&theme=light&lang=ru&w=853');
    expect(await shown('3a', '.cg-debug')).toEqual([]);
    await open('state=x-recap-debug&theme=light&lang=ru&w=853');
    await captureWindow('dock-debug-recap-light-ru');
    expect(await shown('x-recap-debug', '.cg-debug .cg-debug__line span')).toEqual(['in 9 120 tok • out 640 tok • $0.0312 • 6.2 s • model-test']);
    // The footer: under the facts row, the sheet's last row above the strip.
    const facts = await box('x-recap-debug', '.cg-facts');
    const debug = await box('x-recap-debug', '.cg-debug');
    expect(debug?.top ?? 0).toBeGreaterThanOrEqual((facts?.bottom ?? Number.POSITIVE_INFINITY) - 0.5);
    await open('state=18a&theme=light&lang=ru&w=853');
    expect(await shown('18a', '.cg-debug')).toEqual([]);
  });
});

