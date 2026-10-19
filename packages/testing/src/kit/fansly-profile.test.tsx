// Fansly's profile on our hosts (Project Unite architecture §1.5, §7.8; R20 P8d; FS-DOCK-1, FS-PLC-7): on a page
// that plays fansly.com, the mount puts the variant `fansly` on the host, adopts the blue read off the page by
// Fansly's own theme reader and the variant's sheet after the surface's own, and a switch of the page's theme
// rewrites the one palette sheet without a remount. The rest of the look is the family's on every site (X60): the kit
// reads nothing else off the page, and its own contrast bars hold everywhere (ui/kit tokens.test.ts). In Firefox:
// dock-gallery-fansly.e2e.ts.

import { afterEach, describe, expect, it } from 'vitest';

import { DOCK_VARIANT_ATTRIBUTE, THEME_TOKEN_NAMES, type ColorScheme, type ThemeTokenName } from '@cg/contracts';
import { FANSLY_BLUE, OUR_CARD } from '@cg/host-fansly/isolated/palette';
import { createFanslyTheme } from '@cg/host-fansly/isolated/theme';
import { dockSurface } from '@cg/ui/dock';
import { FANSLY_DOCK_SHEET } from '@cg/ui/hosts/fansly';
import { FAMILY_TRIPLETS, KIT_STYLE_SOURCES, mountKitSurface, tokenValue } from '@cg/ui/kit';

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
    // Fansly's blue read off the page, and nothing else of it (X60).
    expect(css[KIT_STYLE_SOURCES.length + 1]).toMatch(/^:host \{/);
    expect(css[KIT_STYLE_SOURCES.length + 1]).toContain('--color-om-brand-500: 38 153 247');
    expect(css[KIT_STYLE_SOURCES.length + 1]).not.toContain('--color-om-neutral-');
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
    const palette = (root: ShadowRoot): CSSStyleSheet | undefined => root.adoptedStyleSheets.find((sheet) => [...sheet.cssRules].some((rule) => rule.cssText.includes('--color-om-brand-500')));
    const shared = palette(dock.root);
    expect(palette(overlay.root)).toBe(shared);
    const containers = [dock.root, overlay.root].map((root) => root.querySelector('.cg-root'));
    setFanslyTheme(document, 'light');
    await settle();
    for (const root of [dock.root, overlay.root]) {
      expect(palette(root)).toBe(shared);
      // Fansly's translucent blue of the light theme over our light card.
      expect(cssOf(root).join('\n')).toContain('--color-om-brand-75: 216 234 245');
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
    expect([profile.dock.variant, profile.sheet, profile.phrases.ru.onSite, profile.palette?.value['--color-om-brand-500']]).toEqual(['fansly', FANSLY_DOCK_SHEET, 'на Fansly', '38 153 247']);
  });
});

/** The site's steps a token reads in a scheme: `rgb(var(--color-om-brand-500, …))` → brand-500. */
function stepsOf(name: ThemeTokenName, scheme: ColorScheme): string[] {
  return [...tokenValue(name, scheme).matchAll(/--color-om-([a-z0-9-]+)/g)].map((match) => match[1] ?? '');
}

describe('[R20-P8d] [host:fansly] Fansly’s palette under the kit’s tokens (ui-design §2.1 «Fansly»)', () => {
  it('[I18-005] the kit reads only the blue off the page, every step of it Fansly gives; greys, green and red are the family’s own (X60)', () => {
    for (const scheme of ['light', 'dark'] as const) {
      for (const step of new Set(THEME_TOKEN_NAMES.flatMap((name) => stepsOf(name, scheme)))) {
        expect(step.startsWith('brand-'), `${scheme}: ${step}`).toBe(true);
        expect(FANSLY_BLUE[step], `${scheme}: ${step}`).toBeDefined();
      }
    }
  });

  it('a translucent blue of the page is laid over the family’s own card in each scheme', () => {
    expect(OUR_CARD).toEqual({ light: FAMILY_TRIPLETS['neutral-0'], dark: FAMILY_TRIPLETS['neutral-900'] });
  });
});
