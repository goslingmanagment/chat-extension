import { afterEach, describe, expect, it } from 'vitest';

import { KIT_STYLE_SOURCES, adoptKitStyles } from './sheets';
import { adoptSheets, adoptStyles, sharedSheet } from './styles';

function shadowHost(): { host: HTMLElement; root: ShadowRoot } {
  const host = document.createElement('div');
  document.body.append(host);
  return { host, root: host.attachShadow({ mode: 'closed' }) };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('[EX-012] styles and roots: constructable sheets shared by every shadow root, nothing global', () => {
  it('ten roots adopt the same sheet objects in the same order: one parse per document', () => {
    const roots = Array.from({ length: 10 }, () => shadowHost().root);
    for (const root of roots) expect(adoptKitStyles(root)).toBe('adopted');
    const first = roots[0]?.adoptedStyleSheets ?? [];
    expect(first).toHaveLength(KIT_STYLE_SOURCES.length);
    for (const root of roots) {
      expect(root.adoptedStyleSheets).toHaveLength(KIT_STYLE_SOURCES.length);
      root.adoptedStyleSheets.forEach((sheet, index) => expect(sheet).toBe(first[index]));
    }
    expect(document.adoptedStyleSheets).toHaveLength(0);
    expect(document.querySelectorAll('style')).toHaveLength(0);
  });

  it('adopting again adds nothing twice and keeps what the root already had', () => {
    const { root } = shadowHost();
    const own = new CSSStyleSheet();
    root.adoptedStyleSheets = [own];
    adoptKitStyles(root);
    adoptKitStyles(root, [{ id: 'surface', css: '.cg-x { color: red; }' }]);
    adoptKitStyles(root, [{ id: 'surface', css: '.cg-x { color: red; }' }]);
    expect(root.adoptedStyleSheets[0]).toBe(own);
    expect(root.adoptedStyleSheets).toHaveLength(1 + KIT_STYLE_SOURCES.length + 1);
  });

  it('a changed source updates its shared sheet in place for every root', () => {
    const a = shadowHost().root;
    const b = shadowHost().root;
    const sheet = sharedSheet(a, { id: 'live', css: '.cg-a { color: red; }' });
    adoptSheets(a, [{ id: 'live', css: '.cg-a { color: red; }' }]);
    adoptSheets(b, [{ id: 'live', css: '.cg-a { color: blue; }' }]);
    expect(sharedSheet(b, { id: 'live', css: '.cg-a { color: blue; }' })).toBe(sheet);
    expect(a.adoptedStyleSheets).toContain(sheet);
    expect(b.adoptedStyleSheets).toContain(sheet);
  });

  it('falls back to one <style> per source inside the root when adoption is refused (Firefox Xray)', () => {
    const { root } = shadowHost();
    Object.defineProperty(root, 'adoptedStyleSheets', {
      get: () => [],
      set: () => {
        throw new TypeError('Xray: not allowed');
      },
    });
    expect(adoptKitStyles(root)).toBe('style-element');
    expect(adoptKitStyles(root)).toBe('style-element');
    const styles = root.querySelectorAll('style[data-cg-style]');
    expect(styles).toHaveLength(KIT_STYLE_SOURCES.length);
    expect(document.head.querySelectorAll('style')).toHaveLength(0);
  });

  it('extension pages adopt into their own document', () => {
    expect(adoptKitStyles(document)).toBe('adopted');
    expect(document.adoptedStyleSheets).toHaveLength(KIT_STYLE_SOURCES.length);
    document.adoptedStyleSheets = [];
  });

  it('the R00 helper keys a sheet by its content', () => {
    const a = shadowHost().root;
    const b = shadowHost().root;
    adoptStyles(a, '.cg-p { color: red; }');
    adoptStyles(b, '.cg-p { color: red; }');
    expect(a.adoptedStyleSheets[0]).toBe(b.adoptedStyleSheets[0]);
  });
});
