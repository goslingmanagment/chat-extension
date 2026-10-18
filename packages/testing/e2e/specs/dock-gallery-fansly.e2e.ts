// Fansly's look in headless Firefox (R20 P8d; docs/project-unite/architecture.md §1.5, §7.8; FS-DOCK-1, FS-PLC-7;
// ui-design §2.1 «Fansly», §3.1 «Вариант Fansly»): the galleries with Fansly's profile (`?host=fansly`) on a page
// that plays fansly.com — its colour variables, its theme class on <html>, its font (kit/fansly-page.ts) — in both
// of its themes. The palette is read off that page by Fansly's own theme reader, as on fansly.com.
// - Every dock state at Fansly's column widths (622 px in a 1728 px window, 489, 381 beside a neighbour's panel):
//   nothing sticks out, the bar stays 40 px, the closed list of accent dots holds; the bar, its ink, the chips and
//   the capsule are the family's warm greys and the font the system's (X57); the card keeps 4 px in from the column.
// - The overlays — toasts, the cheatsheet, Coach, the expanded result, the error boundary's card — in both themes.
// - The window check's marks over a result (R20 P8b2), over Recap, Review and a Coach answer (P8c): drawn in Fansly's
//   gallery alone, in their own words.
// - The person switches Fansly's theme: the palette follows at once, nothing remounts.
// - The boards and the kit in both themes.
// - «Новые» of the background's pass, Fansly's own window (R20 P10a, P10b1, P10b2, P10c), in both themes: states 13f–13n.
// Pictures in .cache/e2e/ (dock-fansly-*, dock-fansly-mark-*, overlay-fansly-*, boards-fansly-*, kit-fansly-*),
// compared by eye with ui-design.md. ChatSpace's own galleries are the other specs, untouched by this profile.

import { mkdirSync, writeFileSync } from 'node:fs';

import { browser, expect } from '@wdio/globals';

import { BOARDS_GALLERY_PATH, E2E_EVIDENCE_DIR, KIT_GALLERY_PATH } from '../../src/stand/paths';
import { FANSLY_ACCENTS, SMALL, THEMES, WINDOW, box, captureGroups, captureWindow, expectHealthy, health, open, resetWindow, shown } from '../support/dock-gallery';
import { useNetworkTrap } from '../support/network-trap';
import { standOrigin } from '../support/stand';

/** Fansly's conversation column: 622 px in the live 1728 px window (docs/research/fansly.md §3), narrower windows, beside the neighbour's panel. */
const FANSLY_WIDTHS = [622, 489, 381] as const;
/** The rows of the parity matrix this gallery closes on Fansly (parity-matrix.md, P8d): the dock's states and the toasts. */
const DOCK_ROWS = '[UI-002] [UI-003] [UI-004] [UI-005] [UI-006] [UI-007] [UI-008] [UI-009] [UI-010] [UI-013] [UI-014] [UI-015] [UI-018] [UI-022] [UI-024] [UI-025] [UI-030] [UI-031] [UI-032]';
const TOAST_ROWS = '[ER-009] [ER-010] [ER-011] [ER-013]';
/** The window check's marks of Fansly's verdict (R20 P8b2) and the whole line each says, in its own words. */
const MARKS = [
  ['unverified', 'Свежесть не проверена: неизвестно, учёл ли ответ последние сообщения чата.'],
  ['window-miss', 'Ответ мог не учесть последние сообщения чата.'],
  ['deleted-served', 'Контекст устарел: ответ учитывает сообщение, удалённое из чата.'],
] as const;

/** What the dock is drawn in, per Fansly theme: the family's warm greys (host-fansly isolated/palette.ts, X57). */
const LOOK = {
  light: { raised: 'rgb(250, 249, 245)', ink: 'rgb(38, 36, 32)', chip: 'rgb(242, 240, 233)', groove: 'rgb(232, 229, 218)' },
  dark: { raised: 'rgb(38, 36, 32)', ink: 'rgb(226, 223, 211)', chip: 'rgb(46, 43, 38)', groove: 'rgb(27, 26, 23)' },
} as const;

type Colours = { readonly raised: string; readonly ink: string; readonly chip: string; readonly groove: string; readonly font: string; readonly scheme: string | null };

const colours = (id: string): Promise<Colours | null> => browser.execute((state) => window.__dock?.colours(state) ?? null, id);

async function expectFanslyLook(id: string, theme: (typeof THEMES)[number]): Promise<void> {
  const drawn = await colours(id);
  expect(drawn).toMatchObject({ ...LOOK[theme], scheme: theme });
  // Our text is the system's font, as the old Fansly extension's (X57): nothing downloaded (I18-007).
  expect(drawn?.font).toMatch(/system-ui/);
  // The variant's sheet: the card keeps to the line of Fansly's composer, 4 px in from the column, 4 px over its hairline.
  const host = await browser.execute((state) => {
    const element = document.querySelector(`[data-gal-state="${state}"] [data-host="dock"]`);
    const own = element?.getBoundingClientRect();
    return own === undefined ? null : { left: own.left, right: own.right, bottom: own.bottom };
  }, id);
  const strip = await box(id, '.cg-strip');
  expect(strip).not.toBeNull();
  expect([Math.round((strip?.left ?? 0) - (host?.left ?? 0)), Math.round((host?.right ?? 0) - (strip?.right ?? 0)), Math.round((host?.bottom ?? 0) - (strip?.bottom ?? 0))]).toEqual([4, 4, 4]);
}

function save(name: string, data: string): void {
  mkdirSync(E2E_EVIDENCE_DIR, { recursive: true });
  writeFileSync(`${E2E_EVIDENCE_DIR}${name}.png`, Buffer.from(data, 'base64'));
}

async function openPage(path: string, query: string, ready: string, size: { readonly width: number; readonly height: number } = WINDOW): Promise<void> {
  const context = await browser.getWindowHandle();
  await browser.browsingContextSetViewport({ context, viewport: { width: size.width, height: size.height }, devicePixelRatio: 1 });
  await browser.url(`${standOrigin()}${path}?${query}`);
  await browser.waitUntil(async () => (await browser.execute((name) => document.documentElement.getAttribute(name), ready)) === '1', { timeout: 15_000, timeoutMsg: `${path} not ready: ${query}` });
}

describe('[host:fansly] the galleries with Fansly’s profile: its palette, its variant, both of its themes (R20 P8d)', () => {
  useNetworkTrap();
  after(resetWindow);

  for (const theme of THEMES) {
    for (const width of FANSLY_WIDTHS) {
      it(`${DOCK_ROWS} [I18-006] [I18-007] [host:fansly] every dock state · ${theme} · ru · ${width} px: the family’s card, ink and greys, the system font, the card 4 px in`, async () => {
        await open(`host=fansly&theme=${theme}&lang=ru&w=${width}`);
        // Pictures first: a failed check still leaves the evidence.
        await captureGroups(`dock-fansly-${theme}-ru-w${width}`);
        expectHealthy(await health(), width, FANSLY_ACCENTS);
        await expectFanslyLook('1a', theme);
        // The phrases are Fansly's: no shared text names ChatSpace on its page.
        expect((await shown('9g', '.cg-dock')).join(' ')).toMatch(/Fansly обновился/);
        expect((await shown('9g', '.cg-dock')).join(' ')).not.toMatch(/ChatSpace/);
        // Copy only says why as Fansly has it: the fan does not accept messages (Fansly's own wording, R20 P8d).
        expect((await shown('9h', '.cg-dock')).join(' ')).toMatch(/Фан не принимает сообщения/);
        expect((await shown('9h', '.cg-dock')).join(' ')).not.toMatch(/заблокирован/);
      });
    }
    it(`[X55] [host:fansly] «Размер текста: Крупнее» · ${theme} · ru · 622 px: every dock state a step larger on Fansly too — its card, its ink, nothing sticks out`, async () => {
      await open(`host=fansly&theme=${theme}&lang=ru&w=622&text=large`);
      await captureGroups(`dock-fansly-large-${theme}-ru-w622`);
      expectHealthy(await health(), 622, FANSLY_ACCENTS);
      await expectFanslyLook('1a', theme);
    });

    it(`[UI-004] [UI-006] [UI-027] [host:fansly] every dock state · ${theme} · en · 622 px, Windows key labels; copy only in Fansly’s words`, async () => {
      await open(`host=fansly&theme=${theme}&lang=en&w=622&os=win`);
      await captureGroups(`dock-fansly-${theme}-en-w622-win`);
      expectHealthy(await health(), 622, FANSLY_ACCENTS);
      await expectFanslyLook('1a', theme);
      expect(await shown('x-stale-window-miss', '.cg-stale__t')).toEqual(['The answer may have missed the latest messages of the chat.']);
      expect((await shown('9h', '.cg-dock')).join(' ')).toMatch(/The fan doesn’t accept messages/);
    });

    it(`[R20-P8b2] [host:fansly] the window check’s marks over a result · ${theme} · 622 px: the plate of 3c in their own words, the accent dot, «Ещё раз» (spec §3.5, ui-design §4.7)`, async () => {
      for (const [reason, words] of MARKS) {
        const id = `x-stale-${reason}`;
        await open(`host=fansly&state=${id}&theme=${theme}&lang=ru&w=622`);
        // Pictures first: a failed check still leaves the evidence.
        await captureGroups(`dock-fansly-mark-${reason}-${theme}-ru-w622`);
        const result = await health();
        expect([result.failures, result.problems, result.accents]).toEqual([[], [], [`${id}:result-stale`]]);
        expect(await shown(id, '.cg-stale__t')).toEqual([words]);
        expect(await shown(id, '.cg-stale .cg-btn')).toEqual(['Ещё раз']);
        await expectFanslyLook(id, theme);
      }
      // The same marks in ChatSpace's gallery: none — no ChatSpace verdict gives them, and its catalog has no words for them.
      await open(`theme=${theme}&lang=ru&w=622&group=results`);
      expect((await health()).accents.filter((accent) => accent.startsWith('x-stale-'))).toEqual([]);
    });

    it(`[R20-P8c] [host:fansly] the mark over Recap, Review and a Coach answer · ${theme}: the plate of 3c over their text, the accent dot, «Ещё раз» (ui-design §4.7)`, async () => {
      for (const [id, words] of [
        ['x-stale-recap', MARKS[1][1]],
        ['x-stale-review', MARKS[0][1]],
      ] as const) {
        await open(`host=fansly&state=${id}&theme=${theme}&lang=ru&w=622`);
        await captureGroups(`dock-fansly-mark-${id.slice('x-stale-'.length)}-${theme}-ru-w622`);
        const result = await health();
        expect([result.failures, result.problems, result.accents]).toEqual([[], [], [`${id}:result-stale`]]);
        expect(await shown(id, '.cg-stale__t')).toEqual([words]);
        expect(await shown(id, '.cg-stale .cg-btn')).toEqual(['Ещё раз']);
        await expectFanslyLook(id, theme);
      }
      for (const size of [WINDOW, SMALL]) {
        await open(`host=fansly&state=x-stale-coach&theme=${theme}&lang=ru`, 1, size);
        await captureWindow(`overlay-fansly-x-stale-coach-${theme}-ru-${size.width}x${size.height}`);
        const result = await health();
        expect([result.failures, result.problems]).toEqual([[], []]);
        expect(result.scrollWidth).toBeLessThanOrEqual(result.clientWidth);
      }
      expect(await shown('x-stale-coach', '.cg-stale__t')).toEqual([MARKS[2][1]]);
      expect(await shown('x-stale-coach', '.cg-stale .cg-btn')).toEqual(['Ещё раз']);
    });

    it(`${TOAST_ROWS} [UI-014] [I18-006] [host:fansly] the overlays · ${theme}: toasts, the cheatsheet, Coach, the expanded result — drawn, nothing failed`, async () => {
      for (const id of ['12a', '16', '17a', 'x-expanded-recap'] as const) {
        for (const size of [WINDOW, SMALL]) {
          await open(`host=fansly&state=${id}&theme=${theme}&lang=ru`, 1, size);
          await captureWindow(`overlay-fansly-${id}-${theme}-ru-${size.width}x${size.height}`);
          const result = await health();
          expect(result.failures).toEqual([]);
          expect(result.problems).toEqual([]);
          expect(result.scrollWidth).toBeLessThanOrEqual(result.clientWidth);
        }
      }
      // An error toast with its code, «готово» and «инфо»; «Настройки» on the error (ER-010, ER-011).
      await open(`host=fansly&state=12a&theme=${theme}&lang=ru`);
      expect((await shown('12a', '.cg-toast')).length).toBe(3);
      expect((await shown('12a', '.cg-toast button')).join(' ')).toContain('Настройки');
    });

    it(`[ER-015] [host:fansly] «Настройки хаба обновляются» · ${theme}: an info toast with no buttons`, async () => {
      await open(`host=fansly&state=x-hub-settings&theme=${theme}&lang=ru`);
      await captureWindow(`overlay-fansly-x-hub-settings-${theme}-ru-1440x900`);
      expect((await health()).failures).toEqual([]);
      expect(await shown('x-hub-settings', '.cg-toast--info .cg-toast__t')).toEqual(['Настройки хаба обновляются…']);
      expect(await shown('x-hub-settings', '.cg-toast__acts .cg-btn')).toEqual([]);
    });

    it(`[ER-020] [host:fansly] a surface that failed to render keeps its card · ${theme}`, async () => {
      await open(`host=fansly&state=x-overlay-failed&theme=${theme}&lang=ru`);
      await captureWindow(`overlay-fansly-x-overlay-failed-${theme}-ru-1440x900`);
      expect((await health()).failures).toEqual(['render:CG-UI-FAILED:TypeError']);
      expect(await shown('x-overlay-failed', '.cg-boundary .cg-card__code')).toEqual(['ChatGoose · CG-UI-FAILED']);
    });
  }

  it('[I18-005] [host:fansly] the person switches Fansly’s theme: the palette follows at once, in place — nothing remounted', async () => {
    await open('host=fansly&theme=dark&lang=ru&state=3a');
    await expectFanslyLook('3a', 'dark');
    const mounts = await browser.execute(() => window.__dock?.mounts ?? 0);
    for (const theme of ['light', 'dark', 'light'] as const) {
      await browser.execute((next) => window.__dock?.setHostTheme(next), theme);
      await browser.waitUntil(async () => (await colours('3a'))?.raised === LOOK[theme].raised, { timeout: 5_000, timeoutMsg: `the dock in Fansly's ${theme} card` });
      await browser.execute(async () => window.__dock?.settle());
      await expectFanslyLook('3a', theme);
      await captureWindow(`dock-fansly-switch-${theme}`);
    }
    expect(await browser.execute(() => window.__dock?.mounts ?? 0)).toBe(mounts);
    expect(await browser.execute(() => [document.documentElement.classList.contains('bright-theme'), document.documentElement.classList.contains('dark-theme')])).toEqual([true, false]);
  });

  for (const theme of THEMES) {
    it(`[I18-006] [host:fansly] the boards in Fansly’s ${theme} theme: Spenders with the preview, «Новые», the fan panel`, async () => {
      for (const [state, marker] of [['11a', '.cg-pvp'], ['13a', '.cg-nc'], ['14a', '.cg-fp']] as const) {
        await openPage(BOARDS_GALLERY_PATH, `host=fansly&state=${state}&theme=${theme}&lang=ru`, 'data-boards-ready');
        const context = await browser.getWindowHandle();
        save(`boards-fansly-${state}-${theme}-ru-1440x900`, (await browser.browsingContextCaptureScreenshot({ context, origin: 'viewport' })).data);
        const probe = await browser.execute((selector) => {
          const boards = window.__boards;
          if (boards === undefined) throw new Error('window.__boards is missing');
          return { failures: boards.failures.map((failure) => failure.code), drawn: boards.count(selector), overflow: [...boards.overflow()], scheme: boards.scheme(), dispatched: [...boards.dispatched()] };
        }, marker);
        expect(probe).toEqual({ failures: [], drawn: probe.drawn, overflow: [], scheme: theme, dispatched: [] });
        expect(probe.drawn).toBeGreaterThan(0);
      }
    });

    it(`[NF-002] [NF-007] [NF-008] [NF-038] [FX-017] [host:fansly] «Новые» of the pass in Fansly’s ${theme} theme (R20 P10a, P10b1): the queue with its card and «Пауза», «Уже писали», the list not read, the cooldown, the first page on its way, the standing queue with «Проверить оставшихся» and «Проверить чат»`, async () => {
      for (const state of ['13f', '13g', '13h', '13i', '13j', '13k', '13l', '13m', '13n'] as const) {
        await openPage(BOARDS_GALLERY_PATH, `host=fansly&state=${state}&theme=${theme}&lang=ru`, 'data-boards-ready');
        const context = await browser.getWindowHandle();
        save(`boards-fansly-${state}-${theme}-ru-1440x900`, (await browser.browsingContextCaptureScreenshot({ context, origin: 'viewport' })).data);
        const probe = await browser.execute(() => {
          const boards = window.__boards;
          if (boards === undefined) throw new Error('window.__boards is missing');
          return {
            failures: boards.failures.map((failure) => failure.code),
            window: boards.count('.cg-fnw'),
            overflow: [...boards.overflow()],
            squeezed: [...boards.squeezed()],
            scheme: boards.scheme(),
            dispatched: [...boards.dispatched()],
            // Nothing of ours is blue (nothing here reaches the fan) and no remote picture is loaded.
            images: boards.count('img'),
          };
        });
        expect({ state, ...probe }).toEqual({ state, failures: [], window: 1, overflow: [], squeezed: [], scheme: theme, dispatched: [], images: 0 });
      }
    });

    it(`[I18-006] [host:fansly] the kit in Fansly’s ${theme} theme: every component, nothing sticks out`, async () => {
      await openPage(KIT_GALLERY_PATH, `host=fansly&theme=${theme}&lang=ru`, 'data-gal-ready');
      const context = await browser.getWindowHandle();
      save(`kit-fansly-${theme}-ru`, (await browser.browsingContextCaptureScreenshot({ context, origin: 'document' })).data);
      const probe = await browser.execute(() => {
        const gallery = window.__gallery;
        if (gallery === undefined) throw new Error('window.__gallery is missing');
        return { failures: gallery.failures.map((failure) => failure.code), overflow: [...gallery.overflow()], mode: gallery.styles.mode, scheme: document.querySelector('[data-host="gallery"]')?.getAttribute('data-scheme') ?? null };
      });
      // The kit's specimen of a failed surface fails on purpose (kit-gallery.e2e.ts).
      expect(probe).toEqual({ failures: ['CG-UI-FAILED'], overflow: [], mode: 'adopted', scheme: theme });
    });
  }
});
