import { describe, expect, it } from 'vitest';

import { SCHEME_ATTRIBUTE, THEME_TOKEN_NAMES, THEME_TOKENS } from '@cg/contracts/vm';

import { BASE_CSS } from './base';
import { KIT_STYLE_SOURCES } from './sheets';
import { DARK_HOST, DARK_PAGE, HOST_FALLBACK_TRIPLETS, THEME_CSS, TOKEN_VALUES, dark, om, tokenValue } from './tokens';

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
    expect(tokenValue('--cg-sel', 'dark')).toBe(om('brand-800', 0.45));
    expect(tokenValue('--cg-tip-bg', 'light')).toBe('var(--cg-ink-strong)');
  });

  it('every fallback triplet is three bytes', () => {
    for (const triplet of Object.values(HOST_FALLBACK_TRIPLETS)) {
      const parts = triplet.split(' ').map(Number);
      expect(parts).toHaveLength(3);
      for (const part of parts) expect(part >= 0 && part <= 255 && Number.isInteger(part)).toBe(true);
    }
  });

  it('the host’s blue feeds only the closed list of meaning tokens (ui-design §1 п. 4, §11 п. 5)', () => {
    const blue = THEME_TOKEN_NAMES.filter((name) => {
      const value = TOKEN_VALUES[name];
      const text = typeof value === 'string' ? value : `${value.light} ${value.dark}`;
      return text.includes('brand-');
    });
    expect(blue.sort()).toEqual(['--cg-accent', '--cg-chat-out', '--cg-focus', '--cg-focus-soft', '--cg-sel', '--cg-send', '--cg-send-hover'].sort());
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
    expect(BASE_CSS).toMatch(/:host \{[^}]*font-family: inherit/);
    const css = KIT_STYLE_SOURCES.map((source) => source.css).join('\n');
    expect(css).not.toMatch(/@font-face|@import|url\(/);
  });

  it('the type scale, spacing and radii are the spec values', () => {
    expect(THEME_TOKENS.text.map((name) => TOKEN_VALUES[name])).toEqual(['10.5px', '11px', '12px', '12.5px', '13px', '13.5px', '14px', '15px', '16px', '22px']);
    expect(THEME_TOKENS.space.map((name) => TOKEN_VALUES[name])).toEqual(['2px', '4px', '6px', '8px', '10px', '12px', '14px', '16px', '20px', '24px', '28px', '40px']);
    expect(THEME_TOKENS.radius.map((name) => TOKEN_VALUES[name])).toEqual(['2px', '6px', '8px', '10px', '12px', '99px']);
    expect(TOKEN_VALUES['--cg-gutter']).toBe('36px');
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
