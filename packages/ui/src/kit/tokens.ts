// `--cg-*` theme tokens (architecture.md §10.1 «Тема», ui-design §2.1–§2.9).
// The NAMES are frozen in @cg/contracts/vm (THEME_TOKENS); the values live
// here. Inks, rules and surfaces are computed from ChatSpace's
// `--color-om-<scale>-<step>` "R G B" triplets (identical in both host themes;
// the dark theme takes other steps) with the ChatSpace 0.172.0 value as the
// fallback, so the same rules work on our extension pages where no host
// variables exist (I18-006). The family's own voice is fixed and the same in
// every host (decision X28): the terracotta accent and the warm fill of an AI
// draft are the ChatGoose desktop's and the Fansly extension's values.
//
// A closed shadow root sees neither the host's `.dark` class nor
// `:host-context()` (Firefox has none), so the mount writes the resolved
// scheme to `data-scheme` on our host element and the dark values key on
// it. Extension pages put the same attribute on <html>.
//
// The triplets are the site's (Project Unite architecture §1.5; R20 F5): on
// ChatSpace they come from its <html> by inheritance; a site whose page has
// no such variables gives them in its profile (`HostUiProfile.palette`), and
// the mount puts them on our host element as a `:host` rule of one shared
// sheet (`paletteSource`) — the same names, so every token below reads them
// unchanged.

import { THEME_TOKEN_NAMES, type ColorScheme, type HostPalette, type ThemeTokenName } from '@cg/contracts/vm';

import { type StyleSource } from './styles';

/** ChatSpace 0.172.0 values of the steps we read: the fallback of each triplet (ui-design §2.2). */
export const HOST_FALLBACK_TRIPLETS = {
  'neutral-0': '255 255 255',
  'neutral-50': '246 245 244',
  'neutral-75': '241 241 238',
  'neutral-100': '234 233 229',
  'neutral-200': '225 224 218',
  'neutral-300': '203 202 195',
  'neutral-400': '171 168 156',
  'neutral-500': '114 112 100',
  'neutral-600': '83 81 70',
  'neutral-700': '61 59 50',
  'neutral-750': '51 49 41',
  'neutral-800': '42 40 32',
  'neutral-850': '34 32 25',
  'neutral-900': '26 24 19',
  'neutral-950': '19 18 15',
  white: '255 255 255',
  'brand-50': '235 243 255',
  'brand-75': '200 223 255',
  'brand-300': '71 145 255',
  'brand-400': '10 109 255',
  'brand-500': '0 82 204',
  'brand-600': '0 57 143',
  'brand-800': '0 24 61',
  'success-400': '97 189 100',
  'success-600': '53 129 58',
  'error-400': '234 95 93',
  'error-500': '217 32 28',
} as const;

export type HostStep = keyof typeof HOST_FALLBACK_TRIPLETS;

/**
 * A site's palette as the sheet the mount adopts into our roots: its triplets on our host element. One id for the
 * document — every root of the tab shares the one sheet, and a new value rewrites it for all of them at once.
 */
export function paletteSource(palette: HostPalette): StyleSource {
  return { id: 'cg-host-palette', css: `:host { ${Object.entries(palette).map(([name, triplet]) => `${name}: ${triplet};`).join(' ')} }` };
}

/** `rgb(var(--color-om-neutral-900, 26 24 19))`, optionally with alpha. */
export function om(step: HostStep, alpha?: number): string {
  const triplet = `var(--color-om-${step}, ${HOST_FALLBACK_TRIPLETS[step]})`;
  return alpha === undefined ? `rgb(${triplet})` : `rgb(${triplet} / ${alpha})`;
}

/** A value that differs by scheme, or one value for both. */
export type TokenValue = string | { readonly light: string; readonly dark: string };

const both = (light: string, dark: string): TokenValue => ({ light, dark });

/** Every frozen token name with its value (the compiler checks completeness). */
export const TOKEN_VALUES: Readonly<Record<ThemeTokenName, TokenValue>> = {
  // ── ink: importance is ink level and weight, never hue ──
  '--cg-ink-strong': both(om('neutral-950'), om('white')),
  '--cg-ink': both(om('neutral-900'), om('neutral-200')),
  '--cg-ink-2': both(om('neutral-700'), om('neutral-300')),
  '--cg-ink-muted': both(om('neutral-500'), om('neutral-400')),
  '--cg-ink-faint': both(om('neutral-400'), om('neutral-600')),
  // ── rules ──
  '--cg-rule': both(om('neutral-100'), om('neutral-850')),
  '--cg-rule-2': both(om('neutral-200'), om('neutral-750')),
  '--cg-rule-3': both(om('neutral-300'), om('neutral-700')),
  '--cg-rule-float': both(om('neutral-200'), om('neutral-800')),
  // Retired with the bare strip and the printed result (decision X28); the names stay frozen, as aliases.
  '--cg-divider': 'var(--cg-rule-3)',
  '--cg-bare-rule': 'var(--cg-rule)',
  '--cg-bare-edge': 'var(--cg-rule-2)',
  // ── surfaces ──
  '--cg-surface': both(om('neutral-0'), om('neutral-950')),
  '--cg-sunk': both(om('neutral-50'), om('neutral-900')),
  '--cg-hover': both(om('neutral-75'), om('neutral-850')),
  '--cg-press': both(om('neutral-100'), om('neutral-800')),
  '--cg-seg-on': both(om('neutral-75'), om('neutral-800')),
  '--cg-sel': both('#fbf0ea', 'rgb(63 43 33 / 0.62)'),
  '--cg-bare-hover': 'var(--cg-sunk)',
  '--cg-input-bg': both(om('neutral-0'), om('neutral-900')),
  '--cg-input-border': both(om('neutral-200'), om('neutral-800')),
  '--cg-feed-bg': both(om('neutral-50'), 'rgb(0 0 0)'),
  '--cg-debug-bg': both(om('neutral-50'), om('neutral-900', 0.6)),
  '--cg-nav-bg': both(om('neutral-50'), om('neutral-900', 0.5)),
  '--cg-nav-current': both(om('neutral-0'), om('neutral-850')),
  '--cg-scrim': both(om('neutral-950', 0.18), 'rgb(0 0 0 / 0.5)'),
  '--cg-tip-bg': 'var(--cg-raised)',
  '--cg-tip-ink': 'var(--cg-ink)',
  '--cg-chat-in': both(
    `rgb(var(--chat-incoming, var(--color-om-neutral-0, ${HOST_FALLBACK_TRIPLETS['neutral-0']})))`,
    `rgb(var(--chat-incoming, var(--color-om-neutral-900, ${HOST_FALLBACK_TRIPLETS['neutral-900']})))`,
  ),
  '--cg-chat-out': both(
    `rgb(var(--chat-outgoing, var(--color-om-brand-75, ${HOST_FALLBACK_TRIPLETS['brand-75']})))`,
    `rgb(var(--chat-outgoing, var(--color-om-brand-800, ${HOST_FALLBACK_TRIPLETS['brand-800']})))`,
  ),
  // ── our own cards: the bar and a result, a raised chip, the sunken groove of a button's options, an AI draft ──
  '--cg-raised': both(om('neutral-0'), om('neutral-900')),
  '--cg-chip': both(om('neutral-50'), om('neutral-850')),
  '--cg-groove': both(om('neutral-100'), om('neutral-950')),
  // The light fill is a shade lighter than the family's #f7f1e8: muted ink (a part's number, «После Fix») reads on it at 4.5 : 1.
  '--cg-draft': both('#f9f4eb', '#2e2a21'),
  '--cg-draft-hover': both('#fbf7f1', '#363126'),
  // ── colours with a fixed meaning (ui-design §1 п. 4, closed list) ──
  // A state dot and the focus ring are the accent's INK: they stand on tints too (a chip, the groove, a draft), where the terracotta itself is under 3 : 1.
  '--cg-accent': 'var(--cg-clay-ink)',
  '--cg-focus': 'var(--cg-clay-ink)',
  '--cg-focus-soft': 'rgb(217 119 87 / 0.28)',
  '--cg-send': om('brand-500'),
  '--cg-send-hover': both(om('brand-600'), om('brand-400')),
  '--cg-send-ink': both(om('neutral-0'), om('white')),
  '--cg-send-kbd': 'rgb(255 255 255 / 0.72)',
  '--cg-money': both(om('success-600'), om('success-400')),
  '--cg-danger': both(om('error-500'), om('error-400')),
  '--cg-bar': both(om('neutral-300'), om('neutral-700')),
  '--cg-bar-strong': both(om('neutral-600'), om('neutral-300')),
  // The family accent: the same terracotta in both schemes; its ink on a tint is deeper in light, brighter in dark.
  '--cg-clay': '#d97757',
  '--cg-clay-ink': both('#a84d2b', '#e08566'),
  '--cg-clay-bg': both('#f7e8e1', '#3f2b21'),
  '--cg-clay-line': both('#e8c3b3', '#61412f'),
  // ── elevation: page flow (none), windows, floating ──
  '--cg-shadow': both(`0 1px 4px -1px ${om('neutral-900', 0.1)}`, '0 1px 4px -1px rgb(0 0 0 / 0.6)'),
  '--cg-shadow-float': both(
    `0 10px 28px -12px ${om('neutral-900', 0.22)}, 0 1px 3px ${om('neutral-900', 0.06)}`,
    '0 12px 32px -12px rgb(0 0 0 / 0.8), 0 0 0 1px rgb(0 0 0 / 0.4)',
  ),
  // ── fonts: the host's own font; pages use locally installed fonts only, nothing is downloaded (I18-007) ──
  '--cg-font': 'inherit',
  '--cg-font-page': 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  '--cg-mono': 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace',
  // AI-authored text is serif: a draft never reads as interface, nor as a sent bubble. Local faces only.
  '--cg-serif': '"Source Serif 4", Georgia, "Times New Roman", serif',
  // ── type scale (size; the line height goes with the .cg-t-* classes) ──
  '--cg-text-2xs': '10.5px',
  '--cg-text-xs': '11px',
  '--cg-text-sm': '12px',
  '--cg-text-sm2': '12.5px',
  '--cg-text-base': '13px',
  '--cg-text-md': '13.5px',
  '--cg-text-lg': '14px',
  '--cg-text-xl': '15px',
  '--cg-text-2xl': '16px',
  '--cg-text-3xl': '22px',
  // 1.26.0 (X55): the serif AI text (a part, a draft, Recap and Review blocks, Coach) and a chip's keycap.
  '--cg-text-ai': '14.5px',
  '--cg-leading-ai': '21px',
  '--cg-text-kbd': '9.5px',
  // ── spacing ──
  '--cg-s-1': '2px',
  '--cg-s-2': '4px',
  '--cg-s-3': '6px',
  '--cg-s-4': '8px',
  '--cg-s-5': '10px',
  '--cg-s-6': '12px',
  '--cg-s-7': '14px',
  '--cg-s-8': '16px',
  '--cg-s-9': '20px',
  '--cg-s-10': '24px',
  '--cg-s-11': '28px',
  '--cg-s-12': '40px',
  // ── radii ──
  '--cg-r-xs': '2px',
  '--cg-r-sm': '6px',
  '--cg-r-md': '8px',
  '--cg-r-lg': '10px',
  '--cg-r-xl': '12px',
  '--cg-r-pill': '99px',
  // ── layout ──
  '--cg-gutter': '36px',
  '--cg-ease': 'cubic-bezier(.2, .7, .3, 1)',
  /** Written at run time from MountPort geometry (ui-design §3.2); this is the pre-measure default. */
  '--cg-cap': 'min(45vh, 360px)',
};

/** Line heights that go with the type scale (ui-design §2.3). */
export const LINE_HEIGHTS = {
  '2xs': 18,
  xs: 16,
  sm: 18,
  sm2: 18,
  base: 18,
  md: 20,
  lg: 20,
  xl: 22,
  '2xl': 24,
  '3xl': 28,
} as const;

/** The value of a token in a scheme. */
export function tokenValue(name: ThemeTokenName, scheme: ColorScheme): string {
  const value = TOKEN_VALUES[name];
  return typeof value === 'string' ? value : value[scheme];
}

/** The scheme selectors: our shadow hosts and, on extension pages, <html>. */
export const LIGHT_SCOPE = ':host, :root';
export const DARK_HOST = ':host([data-scheme="dark"])';
export const DARK_PAGE = ':root[data-scheme="dark"]';
export const DARK_SCOPE = `${DARK_HOST}, ${DARK_PAGE}`;

/** `X` under the dark scheme, inside a shadow root and on a page. */
export function dark(selector: string): string {
  return selector
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .flatMap((part) => [`${DARK_HOST} ${part}`, `${DARK_PAGE} ${part}`])
    .join(', ');
}

function block(selector: string, scheme: ColorScheme, onlyDiffering: boolean): string {
  const lines: string[] = [];
  for (const name of THEME_TOKEN_NAMES) {
    const value = TOKEN_VALUES[name];
    if (onlyDiffering && typeof value === 'string') continue;
    lines.push(`${name}: ${typeof value === 'string' ? value : value[scheme]};`);
  }
  return `${selector} { ${lines.join(' ')} color-scheme: ${scheme}; }`;
}

/** The token sheet: every token in light, the differing ones again under dark. */
export const THEME_CSS = `${block(LIGHT_SCOPE, 'light', false)}\n${block(DARK_SCOPE, 'dark', true)}\n`;

/**
 * The R00 placeholders' short names, kept as aliases of the real tokens until
 * R14 replaces the placeholder dock and the spike list goes away.
 */
const LEGACY_ALIASES_CSS = `:host { --cg-bg: var(--cg-surface); --cg-fg: var(--cg-ink); --cg-muted: var(--cg-ink-muted); --cg-border: var(--cg-rule-2); --cg-radius: var(--cg-r-md); all: initial; display: block; font-family: inherit; color: var(--cg-ink); }\n`;

/** Tokens plus the legacy aliases: what the R00 placeholder dock and the spike adopt. */
export const BASE_TOKENS_CSS = THEME_CSS + LEGACY_ALIASES_CSS;
