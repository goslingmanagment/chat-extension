// The dock in headless Firefox: what hides on which composer width (ui-design
// §3.3), the capsule of Reply's options at every width, the key caps of both
// kinds of labels, the 900 → 320 px sweep in 1 px steps, both «Вид ответа»,
// the height limit (§3.2) and the order of Tab (§6.3). Every state in every
// theme, language and zoom is dock-gallery-states-*.e2e.ts; the overlays are
// dock-gallery-overlays.e2e.ts.

import { browser, expect } from '@wdio/globals';

import { COLUMN, LANGUAGES, SMALL, THEMES, WIDTHS, WINDOW, box, captureGroups, captureWindow, expectHealthy, focused, health, measure, open, resetWindow, shown } from '../support/dock-gallery';
import { useNetworkTrap } from '../support/network-trap';

describe('dock gallery: what hides on which width (ui-design §3.3)', () => {
  useNetworkTrap();
  after(resetWindow);

  /** «+key»: the chip carries its key — a cap at its corner, shown on hover and on keyboard focus (UI-006). */
  const keyed = (labels: readonly string[]): string[] => labels.map((label) => `${label}+key`);
  const TONES = ['Casual', 'Flirt', 'Sell', 'Spice'];
  /** Reply and the capsule of its options: the four tones and Split. */
  const REPLY = ['Reply+key', ...TONES, 'Split+key'];
  const FOUR = [...REPLY, ...keyed(['Fix', 'Hi', 'Ping'])];
  const SEVEN = [...FOUR, ...keyed(['Review', 'Recap', 'Coach'])];
  const WINDOWS = ['Spenders+key', 'Новые+key'];
  const caps = (id: string): Promise<readonly string[]> => browser.execute((state) => [...(window.__dock?.caps(state) ?? [])], id);

  for (const width of [853, 693, 489] as const) {
    it(`[X55] «Размер текста: Крупнее» · ${width} px · light/dark: every dock state a step larger — the bar stays 40 px, nothing sticks out`, async () => {
      for (const theme of THEMES) {
        await open(`theme=${theme}&lang=ru&w=${width}&text=large`);
        // Pictures first: a failed check still leaves the evidence.
        await captureGroups(`dock-large-${theme}-ru-w${width}`);
        expectHealthy(await health(), width);
        expect(await box('1a', '.cg-strip')).toMatchObject({ height: 40 });
      }
    });
  }

  it('[UI-002] [UI-006] [UI-009] [AI-002] [NEW-01] 853 px: Reply with its capsule, the six other actions, Spenders and «Новые» — every tone and both windows one click away; the quota is a count over Reply\'s corner', async () => {
    await open('theme=light&lang=ru&w=853');
    await captureWindow('dock-bar-light-ru-w853');
    expect((await measure('1a'))?.buttons).toEqual([...SEVEN, ...WINDOWS]);
    expect(await caps('1a')).toEqual(['⌘E', '⌘⇧L', '⌘I', '⌘G', '⌘P', '⌘⇧B', '⌘⇧S', '⌘⇧C', '⌘⇧M', '⌘⇧U']);
    // The capsule is a groove: the tones are emoji cells, Split is its glyph alone below 900 px.
    expect(await shown('1a', '.cg-tones .cg-tone__e')).toEqual(['😌', '😏', '💰', '🔥']);
    expect((await box('1a', '.cg-split'))?.width).toBe(26);
    expect(await shown('1a', '.cg-persona')).toEqual([]);
    expect(await shown('1a', '.cg-hint')).toEqual([]);
    // «AI: 12» costs the bar no width: a count on the bar's frame over Reply's corner. No goose (decision X31).
    expect(await shown('1b', '.cg-slot--reply .cg-quota')).toEqual(['12']);
    expect(await shown('1a', '.cg-strip .cg-goose')).toEqual([]);
    expect((await measure('1b'))?.buttons).toEqual([...SEVEN, ...WINDOWS]);
    // A chosen tone is the raised cell; nothing in the bar moves.
    expect((await box('1c', '.cg-tones'))?.width).toBe((await box('1a', '.cg-tones'))?.width);
    // Hi: three variants side by side; the whole meta line in the head.
    const columns = await browser.execute(() => [1, 2, 3].map((index) => window.__dock?.box('4', `.cg-hi__col:nth-child(${index})`)?.left ?? null));
    expect(new Set(columns).size).toBe(3);
    expect((await shown('3a', '.cg-head__meta')).length).toBeGreaterThan(0);
    expect(await shown('3a', '.cg-head__draft')).toEqual(['черновик · не отправлено']);
    expect(await shown('3a', '.cg-keys')).toHaveLength(1);
    expect((await shown('2a', '.cg-stage')).length).toBeGreaterThan(1);
    // While a generation runs the options are locked with one lock; the chips that are off carry no key.
    expect((await measure('2a'))?.buttons).toEqual(['Reply+key', ...TONES, 'Split', 'Fix', 'Hi', 'Ping', 'Review', 'Recap', 'Coach', ...WINDOWS]);
    expect(await shown('2a', '.cg-tones > .cg-lock')).toHaveLength(1);
    // While the chat loads nothing can be opened from the bar: the two windows give their place to the status.
    expect((await measure('9d'))?.buttons).toEqual(['Reply', ...TONES, 'Split', 'Fix', 'Hi', 'Ping', 'Review', 'Recap', 'Coach']);
    expect(await shown('9d', '.cg-status-word .cg-short')).toEqual(['Загрузка…']);
    // X64: Spenders and «Новые» keep their icons at every width.
    expect(await shown('1a', '.cg-act--ico > .cg-ico')).toHaveLength(2);
    expect((await health()).problems).toEqual([]);
  });

  it('[UI-002] from 900 px Split has its word; from 1000 px the persona and the palette key stand on the right — whatever the bar shows: a tone, a quota, a generation take no width', async () => {
    await open('theme=light&lang=ru&w=900');
    expect((await box('1a', '.cg-split'))?.width ?? 0).toBeGreaterThan(40);
    expect(await shown('1a', '.cg-persona')).toEqual([]);
    expect((await health()).problems).toEqual([]);
    await open('theme=light&lang=ru&w=1000');
    await captureWindow('dock-bar-light-ru-w1000');
    expect((await measure('1a'))?.buttons).toEqual([...SEVEN, ...WINDOWS]);
    expect(await shown('1a', '.cg-persona')).toEqual(['Лора · VIP']);
    expect(await shown('1a', '.cg-hint')).toEqual(['⌘K']);
    for (const state of ['1b', '1c', '2a']) expect([state, await shown(state, '.cg-persona')]).toEqual([state, ['Лора · VIP']]);
    expect(await shown('9d', '.cg-status-word .cg-long')).toEqual(['Чат загружается…']);
    expect((await health()).problems).toEqual([]);
    // One pixel narrower than 1000: no persona, no palette key.
    await open('theme=light&lang=ru&w=999');
    expect(await shown('1a', '.cg-persona')).toEqual([]);
    expect(await shown('1a', '.cg-hint')).toEqual([]);
  });

  it('[UI-006] long key labels («Ctrl+Alt+B», Windows and Linux) change nothing in the bar: a key is a cap at its chip\'s corner, so the widths are the same ones', async () => {
    await open('theme=dark&lang=ru&w=853&os=win');
    await captureWindow('dock-bar-dark-ru-win-w853');
    expect((await measure('1a'))?.buttons).toEqual([...SEVEN, ...WINDOWS]);
    expect(await caps('1a')).toEqual(['Ctrl+E', 'Ctrl+Alt+L', 'Ctrl+I', 'Ctrl+G', 'Ctrl+P', 'Ctrl+Alt+B', 'Ctrl+Alt+S', 'Ctrl+Alt+C', 'Ctrl+Alt+M', 'Ctrl+Alt+U']);
    expect((await health()).problems).toEqual([]);
    for (const width of [1000, 693, 548, 489, 360, COLUMN]) {
      await open(`theme=dark&lang=ru&w=${width}&os=win`);
      expect([width, (await health()).problems]).toEqual([width, []]);
    }
    await open('theme=dark&lang=ru&w=1000&os=win');
    expect(await shown('1a', '.cg-hint')).toEqual(['Ctrl+K']);
  });

  for (const os of ['mac', 'win'] as const) {
    it(`[UI-004] 1400 → 700 px · ${os} key labels: every dock state fits the bar at every width — no overflow, no overlap, the bar stays 40 px`, async () => {
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

  it('[UI-002] [UI-003] 693 px: all seven actions in words, the capsule and both windows as icons — no «Ещё»; no persona, no palette key; Hi still in three columns', async () => {
    await open('theme=light&lang=ru&w=693');
    expect((await measure('1a'))?.buttons).toEqual([...SEVEN, ...WINDOWS]);
    expect(await shown('1a', '.cg-act--ico > .cg-ico')).toHaveLength(2);
    expect(await shown('1a', '.cg-persona')).toEqual([]);
    expect(await shown('1a', '.cg-hint')).toEqual([]);
    // Nothing is hidden: a ready Recap is the point on Recap itself.
    expect(await shown('1b', '.cg-slot--two .cg-badge')).toHaveLength(1);
    const columns = await browser.execute(() => [1, 2, 3].map((index) => window.__dock?.box('4', `.cg-hi__col:nth-child(${index})`)?.left ?? null));
    expect(new Set(columns).size).toBe(3);
    // While the chat loads the windows give their place to the status words.
    expect((await measure('9d'))?.buttons).toEqual(['Reply', ...TONES, 'Split', 'Fix', 'Hi', 'Ping', 'Review', 'Recap', 'Coach']);
    expect(await shown('9d', '.cg-status-word .cg-short')).toEqual(['Загрузка…']);
  });

  it('[UI-002] [UI-003] [UI-010] [UI-031] 548 px (a 1512 px window with ChatSpace\'s side panel open): every chip is on the bar — Review, Recap, Coach, Spenders and «Новые» as their icons; no «Ещё»', async () => {
    await open('theme=dark&lang=ru&w=548');
    await captureWindow('dock-bar-dark-ru-w548');
    // The words stay the chips' names: a narrow bar hides them from the eye only.
    expect((await measure('1a'))?.buttons).toEqual([...SEVEN, ...WINDOWS]);
    expect(await shown('1a', '.cg-act--ico > .cg-ico')).toHaveLength(5);
    expect((await box('1a', '.cg-slot--two .cg-act'))?.width).toBe(28);
    expect((await box('1a', '.cg-slot--boards .cg-act'))?.width).toBe(28);
    // The capsule keeps its 26 px cells.
    expect((await box('1a', '.cg-tones__track'))?.width).toBe(4 * 26 + 3 * 1);
    // The «Recap готов» point is on the Recap icon; the quota count over Reply's corner.
    expect(await shown('1b', '.cg-slot--two .cg-badge')).toHaveLength(1);
    expect(await shown('1b', '.cg-slot--more .cg-badge')).toEqual([]);
    expect(await shown('1b', '.cg-slot--reply .cg-quota')).toEqual(['12']);
    // While the chat loads the status is a spinner in the windows' place.
    expect((await measure('9d'))?.buttons).toEqual(['Reply', ...TONES, 'Split', 'Fix', 'Hi', 'Ping', 'Review', 'Recap', 'Coach']);
    expect(await shown('9d', '.cg-status-word .cg-spin')).toHaveLength(1);
    expect((await health()).problems).toEqual([]);
    // At 640 px Review, Recap and Coach are still words; only the windows are icons.
    await open('theme=light&lang=ru&w=640');
    expect(await shown('1a', '.cg-slot--two .cg-ico')).toEqual([]);
    expect(await shown('1a', '.cg-slot--boards .cg-ico')).toHaveLength(2);
    expect((await health()).problems).toEqual([]);
  });

  it('[UI-003] [UI-006] 489 px: Reply with its capsule · Fix · Hi · Ping · Ещё; Review, Recap, Coach and the two windows live in «Ещё»; Hi in a column; the head keeps «черновик · не отправлено» and drops the meta; one stage', async () => {
    await open('theme=light&lang=ru&w=489');
    expect((await measure('1a'))?.buttons).toEqual([...FOUR, 'Ещё']);
    // 1d is the same bar with «Ещё» pressed: the five live in its menu, with their keys.
    expect(await shown('1d', '.cg-menu [role="menuitem"]')).toEqual(['Review⌘⇧B', 'Recap⌘⇧S', 'Coach⌘⇧C', 'Spenders⌘⇧M', 'Новые⌘⇧U']);
    // «Ещё» stands for Recap here: its point is on «Ещё».
    expect(await shown('1b', '.cg-slot--more .cg-badge')).toHaveLength(1);
    expect(await shown('1b', '.cg-slot--reply .cg-quota')).toEqual(['12']);
    const columns = await browser.execute(() => [1, 2, 3].map((index) => window.__dock?.box('4', `.cg-hi__col:nth-child(${index})`)?.left ?? null));
    expect(new Set(columns).size).toBe(1);
    expect(await shown('3a', '.cg-head__meta')).toEqual([]);
    expect(await shown('3a', '.cg-head__draft')).toEqual(['черновик · не отправлено']);
    // «Скрыть» is × at every width (X57).
    expect(await shown('3a', '.cg-hide .cg-ico')).toHaveLength(1);
    expect((await box('3a', '.cg-hide'))?.width).toBe(26);
    expect(await shown('2a', '.cg-stage')).toHaveLength(1);
    // «Вставить» stands on every part: a mouse needs no hover to find it.
    expect(await shown('3a', '.cg-part .cg-ins')).toHaveLength(3);
  });

  it('[UI-018] 360 px: the capsule still stands — narrower cells, no seams; «Вставить» under the text, × for «Скрыть», no keys footer; «черновик · не отправлено» stays whole', async () => {
    await open('theme=light&lang=ru&w=360');
    expect((await measure('1a'))?.buttons).toEqual([...FOUR, 'Ещё']);
    expect(await shown('1a', '.cg-strip .cg-div')).toEqual([]);
    // Four 22 px cells 2 px apart: a tone stays a target of its own, 24 px from the next one (WCAG 2.5.8).
    expect((await box('1a', '.cg-tones__track'))?.width).toBe(4 * 22 + 3 * 2);
    // While the chat loads the status keeps its spinner: it stands in for «Ещё», which would open nothing then.
    expect((await measure('9d'))?.buttons).toEqual(['Reply', ...TONES, 'Split', 'Fix', 'Hi', 'Ping']);
    expect(await shown('9d', '.cg-status-word .cg-spin')).toHaveLength(1);
    // The quota count costs no width: it is there on every composer.
    expect(await shown('1b', '.cg-quota')).toEqual(['12']);
    expect(await shown('3a', '.cg-keys')).toEqual([]);
    expect(await shown('3a', '.cg-hide .cg-ico')).toHaveLength(1);
    expect((await box('3a', '.cg-hide'))?.width).toBe(26);
    expect((await measure('3a'))?.draftVisible).toBe(true);
    const text = await box('3a', '.cg-part.is-next .cg-part__t');
    const insert = await box('3a', '.cg-part.is-next .cg-ins');
    expect(insert?.top).toBeGreaterThanOrEqual((text?.bottom ?? Number.POSITIVE_INFINITY) - 1);
  });

  it('[UI-005] «Ещё» opens above the bar and inside the dock at every width that has it', async () => {
    // One menu at a time holds focus, so each is pictured on a page of its own.
    for (const width of WIDTHS) {
      await open(`state=1d&theme=${width > 600 ? 'light' : 'dark'}&lang=${width > 600 ? 'ru' : 'en'}&w=${width}`);
      await captureWindow(`dock-menu-more-w${width}`);
      const items = await shown('1d', '.cg-menu [role^="menuitem"]');
      // From 500 px every chip is on the bar (words or icons): there is no «Ещё» to open.
      if (width >= 500) expect(items).toEqual([]);
      else expect(items).toEqual(['Review⌘⇧B', 'Recap⌘⇧S', 'Coach⌘⇧C', 'Spenders⌘⇧M', width > 600 ? 'Новые⌘⇧U' : 'New⌘⇧U']);
      expect((await health()).problems).toEqual([]);
      if (items.length === 0) continue;
      const menu = await box('1d', '.cg-menu');
      const strip = await box('1d', '.cg-strip');
      expect(menu?.bottom ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(strip?.top ?? 0);
    }
  });

  for (const language of LANGUAGES) {
    it(`[UI-004] 900 → ${COLUMN} px in 1 px steps · ${language}: no overflow, no overlap, the bar stays 40 px, and what a narrower composer hid never comes back`, async () => {
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
                ['1a', '.cg-slot--boards .cg-act'],
                ['1a', '.cg-slot--two'],
                ['1a', '.cg-strip .cg-div'],
                ['1b', '.cg-quota'],
                ['9d', '.cg-status-word'],
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
      // The sweep ended on the column (ui-design §6.5): the capsule is still there.
      expect((await measure('1a'))?.strip).toBe(40);
      expect((await box('1a', '.cg-dock'))?.width).toBe(COLUMN);
      expect((await measure('1a'))?.buttons).toEqual([...FOUR, language === 'ru' ? 'Ещё' : 'More']);
    });
  }

  it(`in a ${COLUMN} px column the buttons of a Recap head stay inside the dock — on a second line where one is not enough; a draft head stays one line with «черновик · не отправлено» whole`, async () => {
    await open(`theme=light&lang=ru&w=${COLUMN}`);
    await captureWindow(`dock-column-${COLUMN}-light-ru`);
    expect((await health()).problems).toEqual([]);
    for (const id of ['18a', '18b', '18c'] as const) {
      const dock = await box(id, '.cg-dock');
      const head = await box(id, '.cg-head');
      const title = await box(id, '.cg-head__title');
      const acts = await box(id, '.cg-head__acts');
      const close = await box(id, '.cg-hide');
      // One line where the segment and the four buttons fit it; otherwise the buttons stand under the title, at the right edge, whole.
      const lines = (head?.height ?? 0) > 50 ? 2 : 1;
      if (lines === 2) expect(acts?.top ?? 0).toBeGreaterThanOrEqual((title?.bottom ?? Number.POSITIVE_INFINITY) - 1);
      else expect(head?.height).toBe(36);
      expect(acts?.left ?? -1).toBeGreaterThanOrEqual(dock?.left ?? 0);
      expect(close?.right ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(dock?.right ?? 0);
      expect(close?.width).toBe(26);
    }
    expect((await box('3a', '.cg-head'))?.height).toBe(36);
    expect((await measure('3a'))?.draftVisible).toBe(true);
    // At 360 px, the narrowest reference width, the same head is one line.
    await open('theme=light&lang=ru&w=360');
    expect((await box('18b', '.cg-head'))?.height).toBe(36);
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

  it('[UI-003] «Ещё» stays inside the dock while the composer narrows under the open menu (499 → 320 px), and goes away with its button on a wider one', async () => {
    await open('state=1d&theme=light&lang=ru&w=499');
    expect(await shown('1d', '.cg-menu [role="menuitem"]')).toHaveLength(5);
    const problems = await browser.execute(async () => {
      const dock = window.__dock;
      if (dock === undefined) throw new Error('window.__dock is missing');
      const frame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));
      const out: string[] = [];
      for (let px = 499; px >= 320; px -= 1) {
        dock.setWidth(px);
        await frame();
        await frame();
        out.push(...dock.check());
        if (dock.shown('1d', '.cg-menu [role="menuitem"]').length !== 5) out.push(`the menu closed at ${px} px`);
        if (out.length > 12) break;
      }
      return out;
    });
    expect(problems).toEqual([]);
    const widen = async (px: number): Promise<void> => {
      await browser.execute(async (width) => {
        window.__dock?.setWidth(width);
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      }, px);
    };
    // 548 px: every chip is on the bar again, «Ещё» is gone and its menu with it.
    await widen(548);
    expect(await shown('1d', '.cg-menu')).toEqual([]);
    expect((await measure('1d'))?.buttons).toHaveLength(14);
  });
});

describe('dock gallery: both «Вид ответа» and the height limit (ui-design §3.2, §11 п. 3–4)', () => {
  useNetworkTrap();
  after(resetWindow);

  for (const state of ['3a', '4'] as const) {
    for (const theme of THEMES) {
      it(`«без подложки» and «на подложке» on ${state} · ${theme}: the sheet and the bar are one card, or the sheet is a card of its own 2 px above the bar`, async () => {
        for (const style of ['bare', 'sheet'] as const) {
          await open(`state=${state}&theme=${theme}&lang=ru&w=853&style=${style}`);
          await captureWindow(`dock-view-${state}-${style}-${theme}`);
          const sheet = await box(state, '.cg-sheet');
          const strip = await box(state, '.cg-strip');
          expect(strip?.height).toBe(40);
          expect((strip?.top ?? 0) - (sheet?.bottom ?? 0)).toBeCloseTo(style === 'sheet' ? 2 : 0, 1);
          // Both are as wide as the composer: one card, or two of one width.
          expect(sheet?.width).toBe(strip?.width);
          const result = await health();
          expect(result.problems).toEqual([]);
          expect(result.failures).toEqual([]);
        }
      });
    }
  }

  it('the collapsed dock is exactly 40 px tall and nothing else (architecture.md §10.1: not above 40)', async () => {
    await open('state=1a&theme=light&lang=ru&w=853');
    expect((await box('1a', '.cg-dock'))?.height).toBe(40);
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
      expect(measured?.strip).toBe(40);
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
    expect(await shown('x-recap-debug', '.cg-debug .cg-debug__line > span')).toEqual(['in 9 120 tok • out 640 tok • $0.0312 • 6.2 s • model-test']);
    // The footer: under the facts row, the sheet's last row above the strip.
    const facts = await box('x-recap-debug', '.cg-facts');
    const debug = await box('x-recap-debug', '.cg-debug');
    expect(debug?.top ?? 0).toBeGreaterThanOrEqual((facts?.bottom ?? Number.POSITIVE_INFINITY) - 0.5);
    await open('state=18a&theme=light&lang=ru&w=853');
    expect(await shown('18a', '.cg-debug')).toEqual([]);
  });
});

