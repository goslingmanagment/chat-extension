// Theme tokens and the scheme signal (architecture.md §10.1 «Тема», §10.2 п. 4;
// ui-design.md §2). The NAMES are frozen here; values are ui/kit's job: each
// token is computed from ChatSpace's `--color-om-*` triples with a fallback,
// and the dark values live under `:host([data-scheme="dark"])` because a
// closed shadow root sees neither the host's `.dark` class nor
// `:host-context()` in Firefox. No colour outside this list. 1.13.0 (decision
// X28) adds the family's own voice: the terracotta accent (`--cg-clay-*`), the
// raised chip and the sunken groove of a bar, the warm fill of an AI draft,
// and the serif AI-authored text is set in.

import { type ValueSignal } from './signal';

export const THEME_TOKENS = {
  /** Five ink levels: importance is ink level and weight, never hue. */
  ink: ['--cg-ink-strong', '--cg-ink', '--cg-ink-2', '--cg-ink-muted', '--cg-ink-faint'],
  rule: ['--cg-rule', '--cg-rule-2', '--cg-rule-3', '--cg-rule-float', '--cg-divider', '--cg-bare-rule', '--cg-bare-edge'],
  surface: [
    '--cg-surface',
    '--cg-sunk',
    '--cg-hover',
    '--cg-press',
    '--cg-seg-on',
    '--cg-sel',
    '--cg-bare-hover',
    '--cg-input-bg',
    '--cg-input-border',
    '--cg-feed-bg',
    '--cg-debug-bg',
    '--cg-nav-bg',
    '--cg-nav-current',
    '--cg-scrim',
    '--cg-tip-bg',
    '--cg-tip-ink',
    '--cg-chat-in',
    '--cg-chat-out',
    /** 1.13.0: a card of ours (the bar, a result), a raised chip, the sunken groove of a button's options, an AI draft. */
    '--cg-raised',
    '--cg-chip',
    '--cg-groove',
    '--cg-draft',
    '--cg-draft-hover',
  ],
  /**
   * Colours with a fixed meaning: blue = will reach the fan (the host's own Send), terracotta = ChatGoose itself
   * (the main action, what is armed, focus, a state of our result; 1.13.0), green = money in, red = our failure.
   */
  meaning: [
    '--cg-accent',
    '--cg-focus',
    '--cg-focus-soft',
    '--cg-send',
    '--cg-send-hover',
    '--cg-send-ink',
    '--cg-send-kbd',
    '--cg-money',
    '--cg-danger',
    '--cg-bar',
    '--cg-bar-strong',
    '--cg-clay',
    '--cg-clay-ink',
    '--cg-clay-bg',
    '--cg-clay-line',
  ],
  elevation: ['--cg-shadow', '--cg-shadow-float'],
  font: ['--cg-font', '--cg-font-page', '--cg-mono', '--cg-serif'],
  text: [
    '--cg-text-2xs',
    '--cg-text-xs',
    '--cg-text-sm',
    '--cg-text-sm2',
    '--cg-text-base',
    '--cg-text-md',
    '--cg-text-lg',
    '--cg-text-xl',
    '--cg-text-2xl',
    '--cg-text-3xl',
    /** 1.22.0 (X49): the serif AI-authored text and its line, the keycap of a chip — so «Крупнее» moves them too. */
    '--cg-text-ai',
    '--cg-leading-ai',
    '--cg-text-kbd',
  ],
  space: [
    '--cg-s-1',
    '--cg-s-2',
    '--cg-s-3',
    '--cg-s-4',
    '--cg-s-5',
    '--cg-s-6',
    '--cg-s-7',
    '--cg-s-8',
    '--cg-s-9',
    '--cg-s-10',
    '--cg-s-11',
    '--cg-s-12',
  ],
  radius: ['--cg-r-xs', '--cg-r-sm', '--cg-r-md', '--cg-r-lg', '--cg-r-xl', '--cg-r-pill'],
  /** The 36 px gutter, the easing, and `--cg-cap` — the result height limit computed at run time (ui-design §3.2). */
  layout: ['--cg-gutter', '--cg-ease', '--cg-cap'],
} as const;

export type ThemeTokenGroup = keyof typeof THEME_TOKENS;
export type ThemeTokenName = (typeof THEME_TOKENS)[ThemeTokenGroup][number];
export const THEME_TOKEN_NAMES: readonly ThemeTokenName[] = Object.values(THEME_TOKENS).flat();

export const THEME_TOKEN_PATTERN = /^--cg-[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The scheme our surfaces render in, after `ui.theme` (host/system/light/dark) is resolved. */
export const COLOR_SCHEMES = ['light', 'dark'] as const;
export type ColorScheme = (typeof COLOR_SCHEMES)[number];

/** Set by the mount on our host element; the stylesheets key the dark values on it. The page sees it: a neutral name (X22). */
export const SCHEME_ATTRIBUTE = 'data-scheme';

/** 1.22.0 (X49): `normal` or `large` («Размер текста»), set by the mount on our host element; the type tokens key the larger scale on it. */
export const TEXT_SIZE_ATTRIBUTE = 'data-text-size';

/**
 * The resolved scheme as a signal: `host` follows ChatSpace's class on
 * <html>, `system` follows `prefers-color-scheme`, and extension pages treat
 * `host` as `system` (ui-design §2.1).
 */
export type SchemeSignal = ValueSignal<ColorScheme>;
