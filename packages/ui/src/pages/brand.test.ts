// The agency identity on the extension pages (decision X32; ui-design §2.2а):
// the palette the pages' sheet sets reads at WCAG contrast in both schemes,
// the typefaces travel inside the package, and the kit's tokens are
// re-pointed on the pages only — never in the sheets the dock adopts.

import { describe, expect, it } from 'vitest';

import { THEME_CSS } from '../kit';
import { FONTS_SOURCE } from './brand/fonts';
import { PAGES_CSS } from './styles';

/** `--pg-*` hex values of one block of the pages' sheet. */
function palette(selector: string): Record<string, string> {
  const start = PAGES_CSS.indexOf(`${selector} {`);
  const block = PAGES_CSS.slice(start, PAGES_CSS.indexOf('}', start));
  return Object.fromEntries([...block.matchAll(/(--pg-[a-z0-9-]+):\s*(#[0-9a-f]{6})/gi)].map(([, name = '', value = '']) => [name, value.toLowerCase()]));
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((at) => {
    const channel = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

const SCHEMES = { light: palette(':root'), dark: palette(':root[data-scheme="dark"]') } as const;

describe('the pages in the agency identity (X32)', () => {
  it('the palette is the brand’s: paper, ink, the pond, the goslings’ yellow', () => {
    expect(SCHEMES.light).toMatchObject({ '--pg-paper': '#f7f3ea', '--pg-ink': '#1c1b17', '--pg-pond': '#8db8d4', '--pg-down': '#f4c845', '--pg-card': '#fffdf8', '--pg-shade': '#e7dfcf' });
    expect(SCHEMES.dark).toMatchObject({ '--pg-paper': '#1c1b17', '--pg-ink': '#f7f3ea', '--pg-down': '#f4c845' });
  });

  for (const [scheme, colors] of Object.entries(SCHEMES)) {
    it(`[I18-006] text reads at 4.5 : 1 and marks at 3 : 1 on every page surface · ${scheme}`, () => {
      const at = (name: string): string => colors[name] ?? '';
      for (const surface of ['--pg-paper', '--pg-card', '--pg-shade']) {
        for (const ink of ['--pg-ink', '--pg-ink-2', '--pg-ink-3']) expect(contrast(at(ink), at(surface)), `${ink} on ${surface}`).toBeGreaterThanOrEqual(4.5);
        // The focus ring and the failure's dot are marks, not words.
        expect(contrast(at('--pg-focus'), at(surface)), `focus on ${surface}`).toBeGreaterThanOrEqual(3);
        expect(contrast(at('--pg-danger'), at(surface)), `danger on ${surface}`).toBeGreaterThanOrEqual(3);
      }
      // The verdict stands on the stage: the pond when ready, the goslings' yellow when something waits.
      expect(contrast(at('--pg-on-pond'), at('--pg-pond'))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(at('--pg-on-down'), at('--pg-down'))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(at('--pg-btn-ink'), at('--pg-btn'))).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('[I18-007] the typefaces are inside the package: Literata 800 and Golos Text as data, nothing to fetch', () => {
    expect(FONTS_SOURCE.css).toContain("font-family:'Literata'");
    expect(FONTS_SOURCE.css).toContain("font-family:'Golos Text'");
    expect([...FONTS_SOURCE.css.matchAll(/src:url\(([^)]*)\)/g)].map(([, source = '']) => source.slice(0, 22))).toEqual(Array(4).fill('data:font/woff2;base64'));
    expect(FONTS_SOURCE.css).not.toMatch(/https?:|@import/);
    expect(PAGES_CSS).not.toMatch(/https?:|@import|url\(/);
  });

  it('the kit’s tokens are re-pointed on the pages’ sheet only: the dock’s sheets keep the family look (X28)', () => {
    expect(PAGES_CSS).toMatch(/:root, :root\[data-scheme\] \{[^}]*--cg-surface: var\(--pg-paper\)/);
    expect(THEME_CSS).not.toContain('--pg-');
  });
});
