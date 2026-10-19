// Fansly's profile on our hosts (Project Unite architecture §1.5, §7.8; R20 P8d; FS-DOCK-1, FS-PLC-7): on a page
// that plays fansly.com, the mount puts the variant `fansly` on the host, adopts the palette read off the page by
// Fansly's own theme reader and the variant's sheet after the surface's own, and a switch of the page's theme
// rewrites the one palette sheet without a remount. The palette itself (X57): the family's warm greys whatever the
// page's theme, the page's own blue, and the family's accent still reads where it stands (the same bars as
// ui/kit tokens.test.ts, over the family's greys instead of ChatSpace's). In Firefox: dock-gallery-fansly.e2e.ts.

import { afterEach, describe, expect, it } from 'vitest';

import { DOCK_VARIANT_ATTRIBUTE, THEME_TOKEN_NAMES, type ColorScheme, type HostPalette, type ThemeTokenName } from '@cg/contracts';
import { FAMILY_NEUTRALS, FANSLY_BLUE, fanslyPalette } from '@cg/host-fansly/isolated/palette';
import { createFanslyTheme } from '@cg/host-fansly/isolated/theme';
import { dockSurface } from '@cg/ui/dock';
import { FANSLY_DOCK_SHEET } from '@cg/ui/hosts/fansly';
import { KIT_STYLE_SOURCES, mountKitSurface, tokenValue } from '@cg/ui/kit';

import { playFanslyPage, setFanslyTheme } from './fansly-page';
import { fanslyProfile, galleryHostOf } from './profiles';
import { flush, kitWorld } from './harness';

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
  document.documentElement.className = '';
  document.documentElement.removeAttribute('data-gal-host');
  for (const style of document.head.querySelectorAll('style')) style.remove();
});

function closedRoot(): { readonly host: HTMLElement; readonly root: ShadowRoot } {
  const host = document.createElement('div');
  host.setAttribute('data-host', 'dock');
  document.body.append(host);
  hosts.push(host);
  return { host, root: host.attachShadow({ mode: 'closed' }) };
}

const cssOf = (root: ShadowRoot): string[] => root.adoptedStyleSheets.map((sheet) => [...sheet.cssRules].map((rule) => rule.cssText).join('\n'));

describe('[R20-P8d] [host:fansly] Fansly’s profile on our hosts', () => {
  it('the variant on the host; the palette of the page’s own variables, then the variant’s sheet, after the surface’s own sheets', async () => {
    playFanslyPage(document, 'dark');
    const world = kitWorld('gallery-ready');
    const { host, root } = closedRoot();
    const site = galleryHostOf(new URLSearchParams('host=fansly'));
    expect(site.host).toBe('fansly');
    const mount = mountKitSurface('dock', root, { ...world.deps, profile: site.profile }, dockSurface);
    await flush();
    expect(host.getAttribute(DOCK_VARIANT_ATTRIBUTE)).toBe('fansly');
    const css = cssOf(root);
    expect(css).toHaveLength(KIT_STYLE_SOURCES.length + 3);
    expect(css[KIT_STYLE_SOURCES.length]).toContain('cg-strip');
    // The family's dark card and page (X57), Fansly's blue read off the page.
    expect(css[KIT_STYLE_SOURCES.length + 1]).toMatch(/^:host \{/);
    expect(css[KIT_STYLE_SOURCES.length + 1]).toContain('--color-om-neutral-900: 38 36 32');
    expect(css[KIT_STYLE_SOURCES.length + 1]).toContain('--color-om-neutral-950: 27 26 23');
    expect(css[KIT_STYLE_SOURCES.length + 1]).toContain('--color-om-brand-500: 38 153 247');
    expect(css[KIT_STYLE_SOURCES.length + 2]).toContain('[data-dock-variant="fansly"]');
    expect(root.innerHTML.length).toBeGreaterThan(500);
    mount.unmount();
    expect(root.adoptedStyleSheets).toHaveLength(0);
    expect(host.hasAttribute(DOCK_VARIANT_ATTRIBUTE)).toBe(false);
  });

  it('[I18-005] the page’s theme switched by the person: the palette follows at once in every root, the same sheet, nothing remounted', async () => {
    playFanslyPage(document, 'dark');
    const world = kitWorld('gallery-ready');
    const dock = closedRoot();
    const overlay = closedRoot();
    const profile = fanslyProfile(createFanslyTheme(document));
    const mounts = [mountKitSurface('dock', dock.root, { ...world.deps, profile }, dockSurface), mountKitSurface('toasts', overlay.root, { ...world.deps, profile }, { view: () => <p>toasts</p> })];
    const palette = (root: ShadowRoot): CSSStyleSheet | undefined => root.adoptedStyleSheets.find((sheet) => [...sheet.cssRules].some((rule) => rule.cssText.includes('--color-om-neutral-900')));
    const shared = palette(dock.root);
    expect(palette(overlay.root)).toBe(shared);
    const containers = [dock.root, overlay.root].map((root) => root.querySelector('.cg-root'));
    setFanslyTheme(document, 'light');
    await settle();
    for (const root of [dock.root, overlay.root]) {
      expect(palette(root)).toBe(shared);
      // Fansly's translucent blue of the light theme over our light card; the greys stay the family's.
      expect(cssOf(root).join('\n')).toContain('--color-om-brand-75: 216 234 245');
      expect(cssOf(root).join('\n')).toContain('--color-om-neutral-0: 250 249 245');
    }
    expect([dock.root, overlay.root].map((root) => root.querySelector('.cg-root'))).toEqual(containers);
    setFanslyTheme(document, 'dark');
    await settle();
    expect(cssOf(dock.root).join('\n')).toContain('--color-om-brand-75: 220 239 254');
    for (const mount of mounts) mount.unmount();
  });

  it('the gallery’s profile is built of the parts the tab’s is (composition/tab/hosts/fansly/app.ts): Fansly’s phrases, the variant’s sheet', () => {
    playFanslyPage(document, 'light');
    const profile = fanslyProfile({ current: () => ({ scheme: 'light', tokens: {}, fixedWidth: false }), onChange: () => () => undefined });
    expect([profile.dock.variant, profile.sheet, profile.phrases.ru.onSite, profile.palette?.value['--color-om-neutral-900']]).toEqual(['fansly', FANSLY_DOCK_SHEET, 'на Fansly', '38 36 32']);
  });
});

/** The kit's steps a token reads in a scheme: `rgb(var(--color-om-neutral-900, …))` → neutral-900. */
function stepsOf(name: ThemeTokenName, scheme: ColorScheme): string[] {
  return [...tokenValue(name, scheme).matchAll(/--color-om-([a-z0-9-]+)/g)].map((match) => match[1] ?? '');
}

/** An opaque token's colour in a scheme over Fansly's palette (or its fixed value, or the kit's fallback). */
function rgbOf(name: ThemeTokenName, scheme: ColorScheme, palette: HostPalette): readonly number[] {
  const value = tokenValue(name, scheme);
  const alias = /^var\((--cg-[a-z0-9-]+)\)$/.exec(value);
  if (alias !== null) return rgbOf(alias[1] as ThemeTokenName, scheme, palette);
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
  if (hex !== null) return hex.slice(1).map((byte) => Number.parseInt(byte, 16));
  const triplet = /^rgb\(var\((--color-om-[a-z0-9-]+), (\d+ \d+ \d+)\)\)$/.exec(value);
  if (triplet === null) throw new Error(`${name} is not an opaque colour: ${value}`);
  const [, step = '', fallback = ''] = triplet;
  return (palette[step as keyof HostPalette] ?? fallback).split(' ').map(Number);
}

function contrast(ink: ThemeTokenName, fill: ThemeTokenName, scheme: ColorScheme, palette: HostPalette): number {
  const luminance = (name: ThemeTokenName): number => {
    const [r = 0, g = 0, b = 0] = rgbOf(name, scheme, palette).map((byte) => {
      const channel = byte / 255;
      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [low = 0, high = 0] = [luminance(ink), luminance(fill)].sort((a, b) => a - b);
  return (high + 0.05) / (low + 0.05);
}

describe('[R20-P8d] [host:fansly] Fansly’s palette under the kit’s tokens (ui-design §2.1 «Fansly»)', () => {
  it('[I18-005] every grey the kit reads in a scheme is the family’s, the same on either theme of the page; every blue is the page’s; green and red stay the kit’s own', () => {
    for (const scheme of ['light', 'dark'] as const) {
      const read = new Set(THEME_TOKEN_NAMES.flatMap((name) => stepsOf(name, scheme)));
      for (const step of read) {
        if (step.startsWith('success-') || step.startsWith('error-')) {
          expect(FAMILY_NEUTRALS[step] ?? FANSLY_BLUE[step], step).toBeUndefined();
          continue;
        }
        if (step.startsWith('brand-')) expect(FANSLY_BLUE[step], `${scheme}: ${step}`).toBeDefined();
        else for (const page of ['light', 'dark'] as const) expect(fanslyPalette(page, () => '')[`--color-om-${step}`], `${scheme} on a ${page} page: ${step}`).toBe(FAMILY_NEUTRALS[step]);
      }
    }
  });

  // The page shows one theme; the person may force the other (`ui.theme`): the palette of each of Fansly's themes is
  // drawn in both schemes, and each of the four meets the kit's own bars (ui/kit tokens.test.ts).
  for (const page of ['light', 'dark'] as const) {
    for (const scheme of ['light', 'dark'] as const) {
      const forced = page === scheme ? '' : ' (forced against the page)';
      it(`the family’s accent reads where it stands on the family’s greys (WCAG 2) · Fansly ${page}, our ${scheme}${forced}: its ink 4.5 : 1 on a chip, a tint and a draft; the focus ring and a state dot 3 : 1; muted ink and Split’s word 4.5 : 1; a chip stands off the bar`, () => {
        const palette = fanslyPalette(page, () => '');
        for (const fill of ['--cg-raised', '--cg-chip', '--cg-clay-bg', '--cg-draft', '--cg-draft-hover'] as const) {
          expect(contrast('--cg-clay-ink', fill, scheme, palette), `clay-ink on ${fill}`).toBeGreaterThanOrEqual(4.5);
        }
        for (const fill of ['--cg-surface', '--cg-raised', '--cg-chip', '--cg-groove', '--cg-sunk', '--cg-draft', '--cg-clay-bg'] as const) {
          expect(contrast('--cg-focus', fill, scheme, palette), `the focus ring on ${fill}`).toBeGreaterThanOrEqual(3);
          expect(contrast('--cg-accent', fill, scheme, palette), `a state dot on ${fill}`).toBeGreaterThanOrEqual(3);
        }
        for (const fill of ['--cg-raised', '--cg-draft', '--cg-draft-hover'] as const) {
          expect(contrast('--cg-ink-muted', fill, scheme, palette), `muted ink on ${fill}`).toBeGreaterThanOrEqual(4.5);
        }
        expect(contrast('--cg-ink-2', '--cg-groove', scheme, palette), 'Split in the groove').toBeGreaterThanOrEqual(4.5);
        expect(contrast('--cg-ink', '--cg-chip', scheme, palette), "a chip's word").toBeGreaterThanOrEqual(4.5);
        expect(contrast('--cg-ink', '--cg-raised', scheme, palette), "the bar's ink").toBeGreaterThanOrEqual(7);
        // A raised chip is a tone off the bar it stands on, as ChatSpace's (1.08 dark, 1.09 light) and Fansly's own (1.07, 1.09).
        expect(contrast('--cg-chip', '--cg-raised', scheme, palette), 'a chip off the bar').toBeGreaterThanOrEqual(1.05);
      });
    }
  }
});
