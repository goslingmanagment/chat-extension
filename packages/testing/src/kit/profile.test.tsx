// The site's profile on our hosts (Project Unite architecture §1.5; R20 F5): the mount puts the dock's variant on
// the host next to `data-scheme`, adopts the site's palette and its variant's sheet after the surface's own sheets,
// keeps the palette current, and gives everything back with the last surface of the root. ChatSpace's profile adds
// the variant's name and nothing else: the same tree, the same sheets as before profiles existed.

import { afterEach, describe, expect, it } from 'vitest';

import { DOCK_VARIANT_ATTRIBUTE, SCHEME_ATTRIBUTE, type HostUiProfile, type MountDeps } from '@cg/contracts';
import { CHATSPACE_UI } from '@cg/host-chatspace/isolated/profile';
import { DOCK_STYLE, dockSurface } from '@cg/ui/dock';
import { KIT_STYLE_SOURCES, attributeHolds, createMountPort, mountKitPage, mountKitSurface, paletteSource } from '@cg/ui/kit';

import { PaletteSignal, TEST_SITE_PALETTE, TEST_SITE_SHEET, galleryHostOf, testSiteProfile } from './profiles';
import { flush, kitWorld } from './harness';

const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
  document.documentElement.removeAttribute(SCHEME_ATTRIBUTE);
});

function closedRoot(): { readonly host: HTMLElement; readonly root: ShadowRoot } {
  const host = document.createElement('div');
  host.setAttribute('data-host', 'dock');
  document.body.append(host);
  hosts.push(host);
  return { host, root: host.attachShadow({ mode: 'closed' }) };
}

const attributes = (host: Element): Record<string, string> => Object.fromEntries([...host.attributes].map((attribute) => [attribute.name, attribute.value]));
const cssOf = (root: ShadowRoot): string[] => root.adoptedStyleSheets.map((sheet) => [...sheet.cssRules].map((rule) => rule.cssText).join('\n'));
const withProfile = (deps: MountDeps, profile: HostUiProfile | undefined): MountDeps => (profile === undefined ? deps : { ...deps, profile });

describe('[R20-F5] [host:chatspace] ChatSpace’s profile', () => {
  it('adds the variant’s name to our host and nothing else: the same tree and the same sheets as a mount without a profile', async () => {
    const drawn = [undefined, CHATSPACE_UI].map((profile) => {
      const world = kitWorld('gallery-ready');
      const { host, root } = closedRoot();
      const mount = mountKitSurface('dock', root, withProfile(world.deps, profile), dockSurface, { now: () => world.client.now() });
      return { host, root, mount };
    });
    await flush();
    const [bare, chatspace] = drawn;
    if (bare === undefined || chatspace === undefined) throw new Error('two mounts');
    expect(chatspace.root.innerHTML).toBe(bare.root.innerHTML);
    expect(chatspace.root.innerHTML.length).toBeGreaterThan(500);
    expect(chatspace.root.adoptedStyleSheets).toEqual(bare.root.adoptedStyleSheets);
    expect(chatspace.root.adoptedStyleSheets).toHaveLength(KIT_STYLE_SOURCES.length + 1);
    expect(attributes(chatspace.host)).toEqual({ ...attributes(bare.host), [DOCK_VARIANT_ATTRIBUTE]: 'chatspace' });
    // No palette of its own: the page's `--color-om-*` reach the host by inheritance, nothing is written on it.
    expect(chatspace.host.hasAttribute('style')).toBe(false);
    for (const item of drawn) item.mount.unmount();
    expect(chatspace.host.hasAttribute(DOCK_VARIANT_ATTRIBUTE)).toBe(false);
  });

  it('is what the galleries draw in unless `?host=test` asks for the test site', () => {
    expect(galleryHostOf(new URLSearchParams(''))).toEqual({ host: 'chatspace', profile: CHATSPACE_UI });
    expect(galleryHostOf(new URLSearchParams('host=chatspace'))).toEqual({ host: 'chatspace', profile: CHATSPACE_UI });
    expect(galleryHostOf(new URLSearchParams('host=unknown')).host).toBe('chatspace');
    expect(galleryHostOf(new URLSearchParams('host=test')).profile.dock.variant).toBe('fansly');
  });
});

describe('[R20-F5] a second site’s profile', () => {
  it('its palette on our host as a `:host` rule, the variant on the host, its sheet after the surface’s own', () => {
    const world = kitWorld('gallery-ready');
    const { host, root } = closedRoot();
    const mount = mountKitSurface('dock', root, { ...world.deps, profile: testSiteProfile() }, dockSurface);
    expect(host.getAttribute(DOCK_VARIANT_ATTRIBUTE)).toBe('fansly');
    expect(host.getAttribute(SCHEME_ATTRIBUTE)).toBe('light');
    // Kit, the dock's own sheet, then the site's: the palette and the variant's rules.
    const css = cssOf(root);
    expect(css).toHaveLength(KIT_STYLE_SOURCES.length + 3);
    expect(css[KIT_STYLE_SOURCES.length]).toContain('cg-strip');
    expect(css[KIT_STYLE_SOURCES.length + 1]).toMatch(/^:host \{/);
    expect(css[KIT_STYLE_SOURCES.length + 1]).toContain('--color-om-brand-500: 10 128 114');
    expect(css[KIT_STYLE_SOURCES.length + 1]).toContain('--color-om-neutral-950: 13 16 20');
    expect(css[KIT_STYLE_SOURCES.length + 2]).toContain('--cg-r-pill: 4px');
    // Inline style stays the host side's: the palette is not written there.
    expect(host.hasAttribute('style')).toBe(false);
    mount.unmount();
    expect(root.adoptedStyleSheets).toHaveLength(0);
    expect(host.hasAttribute(DOCK_VARIANT_ATTRIBUTE)).toBe(false);
  });

  it('the palette is live: a new value rewrites the one shared sheet in every root of ours, without a remount', () => {
    const palette = new PaletteSignal(TEST_SITE_PALETTE);
    const profile = testSiteProfile(palette);
    const world = kitWorld('gallery-ready');
    const dock = closedRoot();
    const overlay = closedRoot();
    const mounts = [mountKitSurface('dock', dock.root, { ...world.deps, profile }, dockSurface), mountKitSurface('toasts', overlay.root, { ...world.deps, profile }, { view: () => <p>toasts</p> })];
    const sheetOf = (root: ShadowRoot): CSSStyleSheet | undefined => root.adoptedStyleSheets.find((sheet) => [...sheet.cssRules].some((rule) => rule.cssText.startsWith(':host {')));
    const shared = sheetOf(dock.root);
    expect(shared).toBeDefined();
    expect(sheetOf(overlay.root)).toBe(shared);
    palette.set({ ...TEST_SITE_PALETTE, '--color-om-brand-500': '200 40 90' });
    expect(sheetOf(dock.root)).toBe(shared);
    expect(sheetOf(overlay.root)).toBe(shared);
    expect(cssOf(dock.root).join('\n')).toContain('--color-om-brand-500: 200 40 90');
    expect(cssOf(dock.root).join('\n')).not.toContain('--color-om-brand-500: 10 128 114');
    for (const mount of mounts) mount.unmount();
  });

  it('surfaces sharing one root (the overlay host): the variant and the site’s sheets go with the last of them', () => {
    const world = kitWorld();
    const { host, root } = closedRoot();
    const deps = { ...world.deps, profile: testSiteProfile() };
    const port = createMountPort({ palette: { view: () => <p>palette</p> }, 'fan-panel': { view: () => <p>fan</p>, styles: [DOCK_STYLE] } });
    const closePalette = port.mountSurface('palette', root, deps);
    const closePanel = port.mountSurface('fan-panel', root, deps);
    expect(attributeHolds(host, DOCK_VARIANT_ATTRIBUTE)).toBe(2);
    expect(root.adoptedStyleSheets).toHaveLength(KIT_STYLE_SOURCES.length + 3);
    closePanel();
    closePanel();
    expect(host.getAttribute(DOCK_VARIANT_ATTRIBUTE)).toBe('fansly');
    expect(cssOf(root).some((css) => css.includes('--cg-r-pill: 4px'))).toBe(true);
    expect(root.adoptedStyleSheets).toHaveLength(KIT_STYLE_SOURCES.length + 2);
    closePalette();
    expect(host.hasAttribute(DOCK_VARIANT_ATTRIBUTE)).toBe(false);
    expect(root.adoptedStyleSheets).toHaveLength(0);
  });

  it('where adoption is refused (Firefox Xray) the palette is a <style> of the root, kept current all the same', () => {
    const world = kitWorld();
    const { root } = closedRoot();
    Object.defineProperty(root, 'adoptedStyleSheets', {
      get: () => [],
      set: () => {
        throw new TypeError('Xray: not allowed');
      },
    });
    const palette = new PaletteSignal(TEST_SITE_PALETTE);
    const mount = mountKitSurface('dock', root, { ...world.deps, profile: testSiteProfile(palette) }, { view: () => <p>x</p> });
    expect(mount.styleMode).toBe('style-element');
    const style = (): string => root.querySelector(`style[data-cg-style="${paletteSource({}).id}"]`)?.textContent ?? '';
    expect(style()).toContain('--color-om-brand-500: 10 128 114');
    palette.set({ '--color-om-brand-500': '200 40 90' });
    expect(style()).toBe(':host { --color-om-brand-500: 200 40 90; }');
    expect(root.querySelector(`style[data-cg-style="${TEST_SITE_SHEET.id}"]`)).not.toBeNull();
    mount.unmount();
    expect(root.querySelectorAll('style[data-cg-style]')).toHaveLength(0);
  });

  it('an extension page has no site: its profile, if any, puts nothing on <html>', () => {
    const world = kitWorld();
    const container = document.createElement('div');
    document.body.append(container);
    hosts.push(container);
    const mount = mountKitPage(container, { ...world.deps, profile: testSiteProfile() }, { view: () => <p>page</p> });
    expect(document.documentElement.hasAttribute(DOCK_VARIANT_ATTRIBUTE)).toBe(false);
    expect(document.adoptedStyleSheets.map((sheet) => [...sheet.cssRules].map((rule) => rule.cssText).join('')).join('')).not.toContain('10 128 114');
    mount.unmount();
    document.adoptedStyleSheets = [];
  });
});

describe('[R20-F5] paletteSource', () => {
  it('writes the triplets as they are, in their order, under one id for the document', () => {
    expect(paletteSource({ '--color-om-neutral-0': '255 255 255', '--color-om-brand-500': '0 82 204' })).toEqual({ id: 'cg-host-palette', css: ':host { --color-om-neutral-0: 255 255 255; --color-om-brand-500: 0 82 204; }' });
    expect(paletteSource({}).css).toBe(':host {  }');
  });
});
