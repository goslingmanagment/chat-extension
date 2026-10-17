import { describe, expect, it } from 'vitest';

import { SCHEME_ATTRIBUTE, THEME_TOKEN_NAMES, THEME_TOKENS, type ColorScheme, type ThemeTokenName } from '@cg/contracts/vm';

import { BASE_CSS } from './base';
import { KIT_STYLE_SOURCES } from './sheets';
import { DARK_HOST, DARK_PAGE, HOST_FALLBACK_TRIPLETS, LARGE_TEXT, LARGE_TEXT_SCOPE, THEME_CSS, TOKEN_VALUES, dark, om, tokenValue } from './tokens';

/** `--x: value;` declarations of one rule block of THEME_CSS. */
function declarations(block: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of block.matchAll(/(--cg-[a-z0-9-]+):\s*([^;]+);/g)) out.set(match[1] as string, (match[2] as string).trim());
  return out;
}

const [lightBlock = '', darkBlock = ''] = THEME_CSS.split('\n');

/** A selector list split at top-level commas (`:where(a, b)` stays whole). */
function splitSelectors(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of list) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      out.push(current.trim());
      current = '';
    } else current += char;
  }
  out.push(current.trim());
  return out.filter((part) => part !== '');
}

/** An opaque token's colour in a scheme, with ChatSpace's 0.172.0 values where it reads the host's palette. */
function rgbOf(name: ThemeTokenName, scheme: ColorScheme): readonly number[] {
  const value = tokenValue(name, scheme);
  const alias = /^var\((--cg-[a-z0-9-]+)\)$/.exec(value);
  if (alias !== null) return rgbOf(alias[1] as ThemeTokenName, scheme);
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
  if (hex !== null) return hex.slice(1).map((byte) => Number.parseInt(byte, 16));
  const triplet = /^rgb\(var\(--color-om-[a-z0-9-]+, (\d+) (\d+) (\d+)\)\)$/.exec(value);
  if (triplet === null) throw new Error(`${name} is not an opaque colour: ${value}`);
  return triplet.slice(1).map(Number);
}

/** WCAG 2 contrast ratio of two opaque tokens. */
function contrast(ink: ThemeTokenName, fill: ThemeTokenName, scheme: ColorScheme): number {
  const luminance = (name: ThemeTokenName): number => {
    const [r = 0, g = 0, b = 0] = rgbOf(name, scheme).map((byte) => {
      const channel = byte / 255;
      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [low = 0, high = 0] = [luminance(ink), luminance(fill)].sort((a, b) => a - b);
  return (high + 0.05) / (low + 0.05);
}

describe('[I18-006] theme on every surface: one token sheet for shadow roots and extension pages', () => {
  it('every frozen token name has a value, and nothing else is defined', () => {
    expect(Object.keys(TOKEN_VALUES).sort()).toEqual([...THEME_TOKEN_NAMES].sort());
    expect([...declarations(lightBlock).keys()].sort()).toEqual([...THEME_TOKEN_NAMES].sort());
  });

  it('light values sit on `:host` (our shadow hosts) and `:root` (our pages)', () => {
    expect(lightBlock.startsWith(':host, :root {')).toBe(true);
    expect(lightBlock).toContain('color-scheme: light;');
  });

  it('dark values key on data-scheme of the host element or of <html>, never on the host page’s .dark class', () => {
    expect(darkBlock.startsWith(`${DARK_HOST}, ${DARK_PAGE} {`)).toBe(true);
    expect(DARK_HOST).toBe(`:host([${SCHEME_ATTRIBUTE}="dark"])`);
    expect(DARK_PAGE).toBe(`:root[${SCHEME_ATTRIBUTE}="dark"]`);
    expect(THEME_CSS).not.toMatch(/\.dark\b|:host-context/);
    expect(darkBlock).toContain('color-scheme: dark;');
  });

  it('the dark block repeats exactly the tokens whose value differs by scheme', () => {
    const differing = THEME_TOKEN_NAMES.filter((name) => typeof TOKEN_VALUES[name] !== 'string');
    expect([...declarations(darkBlock).keys()].sort()).toEqual([...differing].sort());
    for (const name of differing) expect(declarations(darkBlock).get(name)).toBe(tokenValue(name, 'dark'));
  });

  it('`dark(selector)` scopes a rule under both dark hosts', () => {
    expect(dark('.a, .b:hover')).toBe(`${DARK_HOST} .a, ${DARK_PAGE} .a, ${DARK_HOST} .b:hover, ${DARK_PAGE} .b:hover`);
  });
});

describe('[I18-005] colours come from ChatSpace’s palette, with its 0.172.0 values as the fallback (ui-design §2.1)', () => {
  it('a host step reads the --color-om-* triplet and falls back to the fixed one', () => {
    expect(om('neutral-900')).toBe('rgb(var(--color-om-neutral-900, 26 24 19))');
    expect(om('brand-400', 0.25)).toBe('rgb(var(--color-om-brand-400, 10 109 255) / 0.25)');
  });

  it('the ink and surface steps of both schemes match the spec table', () => {
    expect(tokenValue('--cg-ink-strong', 'light')).toBe(om('neutral-950'));
    expect(tokenValue('--cg-ink-strong', 'dark')).toBe(om('white'));
    expect(tokenValue('--cg-ink-muted', 'light')).toBe(om('neutral-500'));
    expect(tokenValue('--cg-ink-muted', 'dark')).toBe(om('neutral-400'));
    expect(tokenValue('--cg-surface', 'dark')).toBe(om('neutral-950'));
    expect(tokenValue('--cg-raised', 'light')).toBe(om('neutral-0'));
    expect(tokenValue('--cg-raised', 'dark')).toBe(om('neutral-900'));
    expect(tokenValue('--cg-chip', 'dark')).toBe(om('neutral-850'));
    expect(tokenValue('--cg-groove', 'light')).toBe(om('neutral-100'));
    expect(tokenValue('--cg-tip-bg', 'light')).toBe('var(--cg-raised)');
  });

  it('every fallback triplet is three bytes', () => {
    for (const triplet of Object.values(HOST_FALLBACK_TRIPLETS)) {
      const parts = triplet.split(' ').map(Number);
      expect(parts).toHaveLength(3);
      for (const part of parts) expect(part >= 0 && part <= 255 && Number.isInteger(part)).toBe(true);
    }
  });

  it('the host’s blue is only what reaches the fan: «Отправить» and the outgoing bubble (ui-design §1 п. 4, §11 п. 5)', () => {
    const blue = THEME_TOKEN_NAMES.filter((name) => {
      const value = TOKEN_VALUES[name];
      const text = typeof value === 'string' ? value : `${value.light} ${value.dark}`;
      return text.includes('brand-');
    });
    expect(blue.sort()).toEqual(['--cg-chat-out', '--cg-send', '--cg-send-hover'].sort());
  });

  it('the accent is the family’s terracotta, the same in both schemes and in every host: the main action, focus, a state of our result (decision X28)', () => {
    expect(TOKEN_VALUES['--cg-clay']).toBe('#d97757');
    // Its ink is deeper in light and brighter in dark; a state dot and the focus ring are that ink.
    expect(tokenValue('--cg-clay-ink', 'light')).toBe('#a84d2b');
    expect(tokenValue('--cg-clay-ink', 'dark')).toBe('#e08566');
    expect(TOKEN_VALUES['--cg-accent']).toBe('var(--cg-clay-ink)');
    expect(TOKEN_VALUES['--cg-focus']).toBe('var(--cg-clay-ink)');
    for (const name of ['--cg-clay', '--cg-clay-ink', '--cg-clay-bg', '--cg-clay-line', '--cg-draft', '--cg-draft-hover', '--cg-sel'] as const) {
      expect(JSON.stringify(TOKEN_VALUES[name]), name).not.toMatch(/color-om|brand-/);
    }
  });

  it('the accent reads where it stands (WCAG 2): its ink as a word on a chip, a tint and a draft — 4.5 : 1; the focus ring and a state dot on every fill they meet — 3 : 1; muted ink on a draft and Split’s word in the groove — 4.5 : 1', () => {
    for (const scheme of ['light', 'dark'] as const) {
      for (const fill of ['--cg-raised', '--cg-chip', '--cg-clay-bg', '--cg-draft', '--cg-draft-hover'] as const) {
        expect(contrast('--cg-clay-ink', fill, scheme), `${scheme}: clay-ink on ${fill}`).toBeGreaterThanOrEqual(4.5);
      }
      for (const fill of ['--cg-surface', '--cg-raised', '--cg-chip', '--cg-groove', '--cg-sunk', '--cg-draft', '--cg-clay-bg'] as const) {
        expect(contrast('--cg-focus', fill, scheme), `${scheme}: the focus ring on ${fill}`).toBeGreaterThanOrEqual(3);
        expect(contrast('--cg-accent', fill, scheme), `${scheme}: a state dot on ${fill}`).toBeGreaterThanOrEqual(3);
      }
      for (const fill of ['--cg-raised', '--cg-draft', '--cg-draft-hover'] as const) {
        expect(contrast('--cg-ink-muted', fill, scheme), `${scheme}: muted ink on ${fill}`).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast('--cg-ink-2', '--cg-groove', scheme), `${scheme}: Split in the groove`).toBeGreaterThanOrEqual(4.5);
      expect(contrast('--cg-ink', '--cg-chip', scheme), `${scheme}: a chip's word`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('green is only the money token', () => {
    const green = THEME_TOKEN_NAMES.filter((name) => JSON.stringify(TOKEN_VALUES[name]).includes('success-'));
    expect(green).toEqual(['--cg-money']);
  });
});

describe('[I18-007] fonts: the host’s own, locally installed only on our pages', () => {
  it('surfaces inherit the host font; pages name local families; nothing is downloaded', () => {
    expect(TOKEN_VALUES['--cg-font']).toBe('inherit');
    expect(TOKEN_VALUES['--cg-font-page']).toMatch(/^Inter, -apple-system/);
    // AI-authored text is serif; the faces are the machine's own.
    expect(TOKEN_VALUES['--cg-serif']).toMatch(/Georgia, "Times New Roman", serif$/);
    expect(BASE_CSS).toMatch(/:host \{[^}]*font-family: inherit/);
    const css = KIT_STYLE_SOURCES.map((source) => source.css).join('\n');
    expect(css).not.toMatch(/@font-face|@import|url\(/);
  });

  it('the type scale, spacing and radii are the spec values', () => {
    // …and since 1.22.0 (X49) the AI text, its line and the keycap.
    expect(THEME_TOKENS.text.map((name) => TOKEN_VALUES[name])).toEqual(['10.5px', '11px', '12px', '12.5px', '13px', '13.5px', '14px', '15px', '16px', '22px', '14.5px', '21px', '9.5px']);
    expect(THEME_TOKENS.space.map((name) => TOKEN_VALUES[name])).toEqual(['2px', '4px', '6px', '8px', '10px', '12px', '14px', '16px', '20px', '24px', '28px', '40px']);
    expect(THEME_TOKENS.radius.map((name) => TOKEN_VALUES[name])).toEqual(['2px', '6px', '8px', '10px', '12px', '99px']);
    expect(TOKEN_VALUES['--cg-gutter']).toBe('36px');
  });

  it('[X49] «Крупнее»: the type scale a step up under `data-text-size="large"` of our host — base 15, captions 13, AI text 16.5 — and nothing else moves', () => {
    expect(LARGE_TEXT).toMatchObject({ '--cg-text-base': '15px', '--cg-text-xs': '13px', '--cg-text-sm': '13px', '--cg-text-ai': '16.5px', '--cg-leading-ai': '24px', '--cg-text-kbd': '11px' });
    // Every larger value is a type token, and larger than the normal one.
    for (const [name, value] of Object.entries(LARGE_TEXT)) {
      expect(THEME_TOKENS.text, name).toContain(name);
      expect(Number.parseFloat(value), name).toBeGreaterThan(Number.parseFloat(TOKEN_VALUES[name as keyof typeof TOKEN_VALUES] as string));
    }
    expect(THEME_CSS).toContain(`${LARGE_TEXT_SCOPE} { --cg-text-2xs: 12px;`);
    expect(LARGE_TEXT_SCOPE).toBe(':host([data-text-size="large"])');
    // Only the host of our roots carries it: no page rule, so the extension pages keep the agency's own scale.
    expect(THEME_CSS).not.toContain(':root[data-text-size');
  });
});

describe('kit stylesheets', () => {
  it('no global selectors: every rule is scoped to our host, our root class or our own classes', () => {
    const css = KIT_STYLE_SOURCES.map((source) => source.css).join('\n');
    // Strip at-rule preludes and keyframe steps, then check each selector list.
    const selectors = [...css.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/@keyframes[^{]+\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, '').matchAll(/([^{}@]+)\{[^{}]*\}/g)]
      .map((match) => (match[1] as string).trim())
      .filter((selector) => selector !== '' && !selector.startsWith('@'));
    for (const list of selectors) {
      for (const selector of splitSelectors(list)) {
        expect(selector, selector).toMatch(/^(:host|:root|\.cg-)/);
      }
    }
  });

  it('transitions never run longer than 150 ms (ui-design §2.9)', () => {
    const css = KIT_STYLE_SOURCES.map((source) => source.css).join('\n');
    for (const match of css.matchAll(/transition:[^;]*?(\d+)ms/g)) expect(Number(match[1])).toBeLessThanOrEqual(150);
    for (const match of css.matchAll(/animation: cg-open (\d+)ms/g)) expect(Number(match[1])).toBeLessThanOrEqual(150);
  });

  it('reduced motion stops every cycle and entrance', () => {
    expect(BASE_CSS).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    const css = KIT_STYLE_SOURCES.map((source) => source.css).join('\n');
    for (const name of ['cg-spin', 'cg-caret', 'cg-dot--pulse', 'is-busy']) {
      expect(css).toMatch(new RegExp(`prefers-reduced-motion: reduce\\)[^@]*${name}`));
    }
  });
});
