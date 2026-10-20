// `--cg-*` theme tokens (architecture.md §10.1 «Тема», ui-design §2.1–§2.9).
// The NAMES are frozen in @cg/contracts/vm (THEME_TOKENS); the values live
// here. The family's look is the same on every site (decisions X28, X57,
// X60): the warm paper of the old Fansly extension's panel for the greys, the
// terracotta accent, the warm fill of an AI draft, the system UI face — fixed
// values, which no site's page changes. A site gives one thing: its blue, for
// what reaches the fan («Отправить», a sent bubble) — the brand steps of
// `--color-om-*`, "R G B" triplets, with ChatSpace 0.172.0's as the fallback
// (our extension pages, I18-006; a site that gives none).
//
// A closed shadow root sees neither the host's `.dark` class nor
// `:host-context()` (Firefox has none), so the mount writes the resolved
// scheme to `data-scheme` on our host element and the dark values key on
// it. Extension pages put the same attribute on <html>.
//
// Where the blue comes from is the site's (Project Unite architecture §1.5;
// R20 F5): on ChatSpace its own variables reach our hosts by inheritance; a
// site whose page has none gives them in its profile (`HostUiProfile.palette`),
// and the mount puts them on our host element as a `:host` rule of one shared
// sheet (`paletteSource`) — the same names, so the tokens below read them
// unchanged.

import { TEXT_SIZE_ATTRIBUTE, THEME_TOKEN_NAMES, type ColorScheme, type HostPalette, type ThemeTokenName } from '@cg/contracts/vm';

import { ROOT_CLASS } from './base';
import { type StyleSource } from './styles';

/**
 * The family's palette (X57, X60; ui-design §2.1): the old Fansly panel's warm paper — its card #faf9f5, chip #f2f0e9,
 * groove #e8e5da, lines #e2dfd3 / #cfcaba, ink #262420 and their dark twins — one ramp for both schemes, where a step
 * plays one role in the light scheme and another in the dark one (light / dark below); and the kit's own green and red,
 * text colours a site's bright badge tones would not carry.
 */
export const FAMILY_TRIPLETS = {
  // surface, raised card / —
  'neutral-0': '250 249 245',
  // chip, sunk / —
  'neutral-50': '242 240 233',
  // hover, the segment's pick / —
  'neutral-75': '238 235 227',
  // rule, press, the groove / —
  'neutral-100': '232 229 218',
  // the card's and the chip's outline / ink
  'neutral-200': '226 223 211',
  // seams, key caps / secondary ink
  'neutral-300': '207 202 186',
  // faint ink / muted ink
  'neutral-400': '163 158 147',
  // muted ink / — (4.5 : 1 on a draft card)
  'neutral-500': '107 103 94',
  // strong bars / faint ink
  'neutral-600': '93 90 82',
  // secondary ink / seams, key caps
  'neutral-700': '77 73 64',
  // — / the card's and the chip's outline
  'neutral-750': '58 55 47',
  // — / press, the floating card's outline
  'neutral-800': '51 48 42',
  // — / chip, hover, rule
  'neutral-850': '46 43 38',
  // ink / raised card, sunk
  'neutral-900': '38 36 32',
  // strong ink / surface, the groove
  'neutral-950': '27 26 23',
  // — / strong ink
  white: '250 249 245',
  // money / — ; — / money
  'success-600': '53 129 58',
  'success-400': '97 189 100',
  // the error dot / — ; — / the error dot
  'error-500': '217 32 28',
  'error-400': '234 95 93',
} as const;

export type FamilyStep = keyof typeof FAMILY_TRIPLETS;

/** The steps of the site's blue the tokens read, with ChatSpace 0.172.0's values as the fallback (ui-design §2.2). */
export const SITE_BLUE_FALLBACK = {
  // a sent bubble / —
  'brand-75': '200 223 255',
  // — / the hover of «Отправить»
  'brand-400': '10 109 255',
  // «Отправить»
  'brand-500': '0 82 204',
  // the hover of «Отправить» / —
  'brand-600': '0 57 143',
  // — / a sent bubble
  'brand-800': '0 24 61',
} as const;

export type BlueStep = keyof typeof SITE_BLUE_FALLBACK;

/**
 * A site's blue as the sheet the mount adopts into our roots: its triplets on our host element. One id for the
 * document — every root of the tab shares the one sheet, and a new value rewrites it for all of them at once.
 */
export function paletteSource(palette: HostPalette): StyleSource {
  return { id: 'cg-host-palette', css: `:host { ${Object.entries(palette).map(([name, triplet]) => `${name}: ${triplet};`).join(' ')} }` };
}

/** `rgb(38 36 32)`: a step of the family's ramp, optionally with alpha. */
export function family(step: FamilyStep, alpha?: number): string {
  const triplet = FAMILY_TRIPLETS[step];
  return alpha === undefined ? `rgb(${triplet})` : `rgb(${triplet} / ${alpha})`;
}

/** `rgb(var(--color-om-brand-500, 0 82 204))`: a step of the site's blue. */
export function blue(step: BlueStep): string {
  return `rgb(var(--color-om-${step}, ${SITE_BLUE_FALLBACK[step]}))`;
}

/** A value that differs by scheme, or one value for both. */
export type TokenValue = string | { readonly light: string; readonly dark: string };

const both = (light: string, dark: string): TokenValue => ({ light, dark });

/** Every frozen token name with its value (the compiler checks completeness). */
export const TOKEN_VALUES: Readonly<Record<ThemeTokenName, TokenValue>> = {
  // ── ink: importance is ink level and weight; hue only where a meaning is fixed (below), and in a report's blocks ──
  '--cg-ink-strong': both(family('neutral-950'), family('white')),
  '--cg-ink': both(family('neutral-900'), family('neutral-200')),
  '--cg-ink-2': both(family('neutral-700'), family('neutral-300')),
  '--cg-ink-muted': both(family('neutral-500'), family('neutral-400')),
  '--cg-ink-faint': both(family('neutral-400'), family('neutral-600')),
  // ── rules ──
  '--cg-rule': both(family('neutral-100'), family('neutral-850')),
  '--cg-rule-2': both(family('neutral-200'), family('neutral-750')),
  '--cg-rule-3': both(family('neutral-300'), family('neutral-700')),
  '--cg-rule-float': both(family('neutral-200'), family('neutral-800')),
  // Retired with the bare strip and the printed result (decision X28); the names stay frozen, as aliases.
  '--cg-divider': 'var(--cg-rule-3)',
  '--cg-bare-rule': 'var(--cg-rule)',
  '--cg-bare-edge': 'var(--cg-rule-2)',
  // ── surfaces ──
  '--cg-surface': both(family('neutral-0'), family('neutral-950')),
  '--cg-sunk': both(family('neutral-50'), family('neutral-900')),
  '--cg-hover': both(family('neutral-75'), family('neutral-850')),
  '--cg-press': both(family('neutral-100'), family('neutral-800')),
  '--cg-seg-on': both(family('neutral-75'), family('neutral-800')),
  '--cg-sel': both('#fbf0ea', 'rgb(63 43 33 / 0.62)'),
  '--cg-bare-hover': 'var(--cg-sunk)',
  '--cg-input-bg': both(family('neutral-0'), family('neutral-900')),
  '--cg-input-border': both(family('neutral-200'), family('neutral-800')),
  // A conversation stands on the family's paper in both schemes, its bubbles our cards on it — no site's black.
  '--cg-feed-bg': both(family('neutral-50'), family('neutral-950')),
  '--cg-debug-bg': both(family('neutral-50'), family('neutral-900', 0.6)),
  '--cg-nav-bg': both(family('neutral-50'), family('neutral-900', 0.5)),
  '--cg-nav-current': both(family('neutral-0'), family('neutral-850')),
  '--cg-scrim': both(family('neutral-950', 0.18), 'rgb(0 0 0 / 0.5)'),
  '--cg-tip-bg': 'var(--cg-raised)',
  '--cg-tip-ink': 'var(--cg-ink)',
  // A fan's bubble is our card; a sent one wears the site's blue — ChatSpace's own bubble colour where its page has one.
  '--cg-chat-in': both(family('neutral-0'), family('neutral-900')),
  '--cg-chat-out': both(
    `rgb(var(--chat-outgoing, var(--color-om-brand-75, ${SITE_BLUE_FALLBACK['brand-75']})))`,
    `rgb(var(--chat-outgoing, var(--color-om-brand-800, ${SITE_BLUE_FALLBACK['brand-800']})))`,
  ),
  // ── our own cards: the bar and a result, a raised chip, the sunken groove of a button's options, an AI draft ──
  '--cg-raised': both(family('neutral-0'), family('neutral-900')),
  '--cg-chip': both(family('neutral-50'), family('neutral-850')),
  '--cg-groove': both(family('neutral-100'), family('neutral-950')),
  // The light fill is a shade lighter than the family's #f7f1e8: muted ink (a part's number, «После Fix») reads on it at 4.5 : 1.
  '--cg-draft': both('#f9f4eb', '#2e2a21'),
  '--cg-draft-hover': both('#fbf7f1', '#363126'),
  // ── colours with a fixed meaning (ui-design §1 п. 4, closed list) ──
  // A state dot and the focus ring are the accent's INK: they stand on tints too (a chip, the groove, a draft), where the terracotta itself is under 3 : 1.
  '--cg-accent': 'var(--cg-clay-ink)',
  '--cg-focus': 'var(--cg-clay-ink)',
  '--cg-focus-soft': 'rgb(217 119 87 / 0.28)',
  '--cg-send': blue('brand-500'),
  '--cg-send-hover': both(blue('brand-600'), blue('brand-400')),
  '--cg-send-ink': both(family('neutral-0'), family('white')),
  '--cg-send-kbd': 'rgb(255 255 255 / 0.72)',
  '--cg-money': both(family('success-600'), family('success-400')),
  '--cg-danger': both(family('error-500'), family('error-400')),
  '--cg-bar': both(family('neutral-300'), family('neutral-700')),
  '--cg-bar-strong': both(family('neutral-600'), family('neutral-300')),
  // The family accent: the same terracotta in both schemes; its ink on a tint is deeper in light, brighter in dark.
  '--cg-clay': '#d97757',
  '--cg-clay-ink': both('#a84d2b', '#e08566'),
  '--cg-clay-bg': both('#f7e8e1', '#3f2b21'),
  '--cg-clay-line': both('#e8c3b3', '#61412f'),
  // The old client's report colours (its styles.css, both schemes): the blocks of Review and Recap and the score.
  '--cg-good-ink': both('#3a7d44', '#54a263'),
  '--cg-good-bg': both('#e9f1e5', '#233a28'),
  '--cg-good-line': both('#c9dcc2', '#38583f'),
  '--cg-good-fill': '#3a7d44',
  '--cg-amber-ink': both('#96691c', '#cda04b'),
  '--cg-amber-bg': both('#f6efdc', '#3a3220'),
  '--cg-amber-line': both('#e4d4a8', '#5c4c29'),
  '--cg-bad-ink': both('#bb4430', '#e25549'),
  '--cg-bad-bg': both('#f8e6e1', '#3d2320'),
  '--cg-bad-line': both('#ecc4ba', '#64332c'),
  '--cg-warn-ink': both('#b45309', '#d0863e'),
  // ── elevation: page flow (none), windows, floating ──
  '--cg-shadow': both(`0 1px 4px -1px ${family('neutral-900', 0.1)}`, '0 1px 4px -1px rgb(0 0 0 / 0.6)'),
  '--cg-shadow-float': both(
    `0 10px 28px -12px ${family('neutral-900', 0.22)}, 0 1px 3px ${family('neutral-900', 0.06)}`,
    '0 12px 32px -12px rgb(0 0 0 / 0.8), 0 0 0 1px rgb(0 0 0 / 0.4)',
  ),
  // ── fonts: the family's face is the system UI font, as the old Fansly panel's (X57, X60) — on every site, not the
  // page's own; pages use locally installed fonts only, nothing is downloaded (I18-007) ──
  '--cg-font': '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
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

/**
 * «Размер текста: крупнее» (decision X55): the type scale a step up — the base 13 → 15 px, the captions 11–12 → 13 px,
 * the AI text 14.5 → 16.5 px, the keycaps in proportion. Only on our surface roots in a site's tab (the mount writes
 * `data-text-size` on each `.cg-root` inside the closed shadow root, never on the host the page sees); the extension
 * pages keep the agency's own scale.
 */
export const LARGE_TEXT: Readonly<Partial<Record<ThemeTokenName, string>>> = {
  '--cg-text-2xs': '12px',
  '--cg-text-xs': '13px',
  '--cg-text-sm': '13px',
  '--cg-text-sm2': '14px',
  '--cg-text-base': '15px',
  '--cg-text-md': '15.5px',
  '--cg-text-lg': '16px',
  '--cg-text-xl': '17px',
  '--cg-text-2xl': '18px',
  '--cg-text-3xl': '25px',
  '--cg-text-ai': '16.5px',
  '--cg-leading-ai': '24px',
  '--cg-text-kbd': '11px',
};
export const LARGE_TEXT_SCOPE = `.${ROOT_CLASS}[${TEXT_SIZE_ATTRIBUTE}="large"]`;
/** The root's own line goes with its larger text; a component's fixed line keeps its box. */
const LARGE_TEXT_CSS = `${LARGE_TEXT_SCOPE} { ${Object.entries(LARGE_TEXT)
  .map(([name, value]) => `${name}: ${value};`)
  .join(' ')} line-height: 21px; }\n`;

/** The token sheet: every token in light, the differing ones again under dark, the larger type scale (X55). */
export const THEME_CSS = `${block(LIGHT_SCOPE, 'light', false)}\n${block(DARK_SCOPE, 'dark', true)}\n${LARGE_TEXT_CSS}`;

/**
 * The R00 placeholders' short names, kept as aliases of the real tokens until
 * R14 replaces the placeholder dock and the spike list goes away.
 */
const LEGACY_ALIASES_CSS = `:host { --cg-bg: var(--cg-surface); --cg-fg: var(--cg-ink); --cg-muted: var(--cg-ink-muted); --cg-border: var(--cg-rule-2); --cg-radius: var(--cg-r-md); all: initial; display: block; font-family: var(--cg-font); color: var(--cg-ink); }\n`;

/** Tokens plus the legacy aliases: what the R00 placeholder dock and the spike adopt. */
export const BASE_TOKENS_CSS = THEME_CSS + LEGACY_ALIASES_CSS;
