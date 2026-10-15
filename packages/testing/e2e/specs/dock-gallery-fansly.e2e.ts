import { browser, expect } from '@wdio/globals';

import { box, captureGroups, captureWindow, dispatched, expectHealthy, health, open, resetWindow, shown } from '../support/dock-gallery';
import { useNetworkTrap } from '../support/network-trap';

const style = (id: string, selector: string, property: string): Promise<string | null> => browser.execute((state, query, key) => window.__dock?.style(state, query, key) ?? null, id, selector, property);

describe('dock gallery · Fansly profile and ChatSpace reference', () => {
  useNetworkTrap();
  after(resetWindow);

  for (const theme of ['light', 'dark']) {
    for (const width of [853, 622, 360]) {
      it(`ChatSpace reference · ${theme} · ${width}`, async () => {
        await open(`host=chatspace&state=3a&theme=${theme}&w=${width}`);
        expect((await health()).problems).toEqual([]);
        await captureWindow(`p8d-chatspace-${theme}-${width}`);
      });
    }
  }
});

// Every scenario is synthetic. The profile reads real computed CSS variables and
// mounts the production sheet; no network outside the stand is available.
describe('[host:fansly] P8d · page palette and dock variant', () => {
  useNetworkTrap();
  after(resetWindow);

  for (const theme of ['light', 'dark']) {
    for (const width of [853, 622, 360, 320]) {
      it(`[UI-002] [UI-004] [UI-007] [UI-008] [UI-009] [UI-010] [UI-013] [UI-015] [UI-018] [UI-022] [UI-024] [UI-030] [UI-031] [UI-032] states · ${theme} · ${width}`, async () => {
        await open(`host=fansly&theme=${theme}&w=${width}`);
        await captureGroups(`p8d-fansly-${theme}-${width}`);
        expectHealthy(await health(), width);
        expect(await shown('1a', '.cg-tone')).toHaveLength(4);
        expect(await shown('2a', '.cg-act.is-busy')).toHaveLength(1);
        expect((await shown('2a', '.cg-act[aria-disabled="true"]')).length).toBeGreaterThan(0);
        expect(await shown('3a', '.cg-part')).toHaveLength(3);
        expect(await shown('3b', '.cg-part.is-done')).toHaveLength(1);
        expect((await shown('9f', '.cg-banner')).join(' ')).toContain('персон');
        expect((await shown('1b', '.cg-quota')).length).toBe(1);
        expect((await shown('10', '.cg-debug')).length).toBe(1);
        expect((await shown('x-unparsed', '.cg-sheet')).join(' ')).toContain('[VARIANT]');
      });
    }
  }

  it('[UI-003] [UI-005] [UI-006] icons below 660 px, whole labels in tooltips and the narrow menu; key caps remain', async () => {
    await open('host=fansly&state=1a&theme=light&w=622');
    expect(await style('1a', '.cg-slot--two .cg-act > .cg-ico', 'display')).toBe('block');
    expect(await style('1a', '.cg-slot--two .cg-act__t', 'position')).toBe('absolute');
    expect(await browser.execute(() => window.__dock?.caps('1a'))).toContain('⌘⇧B');
    await open('host=fansly&state=1d&theme=light&w=360');
    expect((await shown('1d', '.cg-menu')).join(' ')).toContain('Review');
    const menu = await box('1d', '.cg-menu');
    expect(menu?.left).toBeGreaterThanOrEqual(0);
    expect(menu?.right).toBeLessThanOrEqual(360);
  });

  it('[I18-005] [I18-006] [I18-007] live bright → dark → bright: palette, scheme and all mounted roots change without replacing the dock', async () => {
    await open('host=fansly&state=3a&theme=light&w=622');
    await browser.execute(() => document.querySelector('[data-host="dock"]')?.setAttribute('data-p8d-original', '1'));
    expect(await style('3a', '.cg-strip', 'background-color')).toBe('rgb(255, 255, 255)');
    expect(await style('3a', '.cg-dock', 'font-family')).toContain('Roboto');
    expect(await style('3a', '.cg-part__t', 'font-family')).toContain('Georgia');
    for (const scheme of ['dark', 'light'] as const) {
      await browser.execute((next) => {
        document.documentElement.classList.toggle('bright-theme', next === 'light');
        document.documentElement.classList.toggle('dark-theme', next === 'dark');
      }, scheme);
      const background = scheme === 'dark' ? 'rgb(25, 30, 38)' : 'rgb(255, 255, 255)';
      await browser.waitUntil(async () => await style('3a', '.cg-strip', 'background-color') === background);
      expect(await browser.execute(() => document.querySelector('[data-p8d-original="1"]')?.getAttribute('data-scheme'))).toBe(scheme);
      await browser.execute(async () => {
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        await window.__dock?.settle();
      });
      expect(await style('3a', '.cg-part', 'background-color')).toBe(scheme === 'dark' ? 'rgb(46, 42, 33)' : 'rgb(249, 244, 235)');
      expect((await health()).problems).toEqual([]);
      await captureWindow(`p8d-fansly-live-${scheme}`);
    }
  });

  it('an overlay and its dock share the live palette', async () => {
    await open('host=fansly&state=17a&theme=light&w=622');
    await browser.execute(() => {
      document.documentElement.classList.remove('bright-theme');
      document.documentElement.classList.add('dark-theme');
    });
    await browser.waitUntil(async () => await style('17a', '.cg-strip', 'background-color') === 'rgb(25, 30, 38)');
    const roots = await browser.execute(() => [...document.querySelectorAll('[data-host]')].map((host) => ({ scheme: host.getAttribute('data-scheme'), surface: getComputedStyle(host).getPropertyValue('--color-om-neutral-900').trim() })));
    expect(roots).toHaveLength(2);
    for (const root of roots) expect(root).toEqual({ scheme: 'dark', surface: '25 30 38' });
  });

  for (const theme of ['light', 'dark']) {
    it(`[UI-014] [ER-009] [ER-010] [ER-011] [ER-013] [ER-015] overlays, errors and settings action · ${theme}`, async () => {
      for (const id of ['12a', '12b', '17a', 'x-expanded-recap']) {
        await open(`host=fansly&state=${id}&theme=${theme}&w=622`);
        expect((await health()).failures).toEqual([]);
        await captureWindow(`p8d-fansly-overlay-${id}-${theme}`);
        if (id === '12a') {
          expect((await shown(id, '.cg-toast')).length).toBe(3);
          expect((await shown(id, '.cg-toast')).join(' ')).toContain('Настройки хаба обновляются');
          const toast = await box(id, '.cg-toast');
          expect(toast?.top).toBeLessThan(150);
          expect(toast?.left).toBeGreaterThan(900);
        }
        if (id === '12b') {
          const target = await box(id, '[data-cg-toast="toast-contract"] .cg-toast__acts .cg-btn');
          if (!target) throw new Error('settings action missing');
          await browser.action('pointer').move({ x: Math.round(target.left + target.width / 2), y: Math.round(target.top + target.height / 2) }).down().up().perform();
          await browser.waitUntil(async () => (await dispatched(id)).includes('OpenSettings'));
        }
      }
    });
  }

  for (const theme of ['light', 'dark']) {
    it(`English labels fit the narrow Fansly column · ${theme}`, async () => {
      await open(`host=fansly&theme=${theme}&lang=en&w=622`);
      expectHealthy(await health(), 622);
      await captureGroups(`p8d-fansly-${theme}-en-622`);
    });
  }

  it('[UI-025] copy action reaches the controller from a draft card', async () => {
    await open('host=fansly&state=3a&theme=dark&w=622');
    const target = await box('3a', '.cg-part .cg-part__copy');
    if (!target) throw new Error('copy button missing');
    await browser.action('pointer').move({ x: Math.round(target.left + target.width / 2), y: Math.round(target.top + target.height / 2) }).down().up().perform();
    await browser.waitUntil(async () => (await dispatched('3a')).includes('Copy'));
  });

  it('[ER-020] the failure card stays visible and its diagnostic action works', async () => {
    await open('host=fansly&state=x-overlay-failed&theme=dark');
    expect((await health()).failures).toEqual(['render:CG-UI-FAILED:TypeError']);
    const target = await box('x-overlay-failed', '.cg-boundary .cg-card__acts > button:nth-of-type(2)');
    if (!target) throw new Error('diagnostics button missing');
    await browser.action('pointer').move({ x: Math.round(target.left + target.width / 2), y: Math.round(target.top + target.height / 2) }).down().up().perform();
    await browser.waitUntil(async () => (await dispatched('x-overlay-failed')).includes('ExportDiagnostics'));
    await captureWindow('p8d-fansly-failed-dark');
  });
});
