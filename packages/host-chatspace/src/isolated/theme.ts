// ChatSpace's theme as our UI needs it (architecture.md §6.1, §6.2): the
// `dark`/`light` class on <html>, the `--color-om-*` tokens ChatSpace sets
// inline on <html>, and its fixed-width workspace (`--app-content-max-width`).
// One attribute observer on <html> (class and style only, no subtree) follows
// changes; no timers. When the tokens are gone the anchor is `missing` and the
// UI falls back to its own theme (§6.2 «своя тема»).

import type { HostTheme } from '@cg/contracts/host';

import { FIXED_WIDTH_VARIABLE, THEME_DARK_CLASS, THEME_TOKEN_PREFIX } from './host-contract';

/** Contracts HostThemeSchema caps the token map at 64; the palettes the UI uses first. */
const TOKEN_PRIORITY = ['neutral-', 'brand-', 'error-', 'success-', 'warning-'].map((name) => `${THEME_TOKEN_PREFIX}${name}`);
const MAX_TOKENS = 64;
const TOKEN_NAME = /^--[a-z0-9-]{1,62}$/;

export interface ThemeReader {
  current(): HostTheme;
  onChange(listener: (theme: HostTheme) => void): () => void;
  /** §6.2 anchor `theme`: ChatSpace's tokens are there. */
  anchor(): 'ok' | 'missing';
  dispose(): void;
}

/** ChatSpace's own theme is unknown until <html> exists. */
const NO_THEME: HostTheme = { scheme: 'light', tokens: {}, fixedWidth: false };

export function readTheme(doc: Document): HostTheme {
  const html = doc.documentElement as HTMLElement | null;
  if (!html) return NO_THEME;
  const style = html.style;
  const found: Array<[string, string]> = [];
  for (let i = 0; i < style.length; i += 1) {
    const name = style.item(i);
    if (!name.startsWith(THEME_TOKEN_PREFIX) || !TOKEN_NAME.test(name)) continue;
    found.push([name, style.getPropertyValue(name).trim().slice(0, 64)]);
  }
  const rank = (name: string): number => {
    const index = TOKEN_PRIORITY.findIndex((prefix) => name.startsWith(prefix) && !name.slice(prefix.length).includes('-'));
    return index === -1 ? TOKEN_PRIORITY.length : index;
  };
  found.sort((a, b) => rank(a[0]) - rank(b[0]));
  const width = style.getPropertyValue(FIXED_WIDTH_VARIABLE).trim();
  return {
    scheme: html.classList.contains(THEME_DARK_CLASS) ? 'dark' : 'light',
    tokens: Object.fromEntries(found.slice(0, MAX_TOKENS)),
    fixedWidth: width !== '' && width !== 'none',
  };
}

export function createThemeReader(doc: Document): ThemeReader {
  let theme = readTheme(doc);
  let text = JSON.stringify(theme);
  const listeners = new Set<(theme: HostTheme) => void>();
  const refresh = (): void => {
    const next = readTheme(doc);
    const nextText = JSON.stringify(next);
    if (nextText === text) return;
    theme = next;
    text = nextText;
    for (const listener of [...listeners]) listener(theme);
  };
  const observer = new MutationObserver(refresh);
  const observe = (): void => observer.observe(doc.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
  // A document_start script may run before <html> exists: watch for it, then for its attributes.
  let waiting: MutationObserver | null = null;
  if ((doc.documentElement as HTMLElement | null) === null) {
    waiting = new MutationObserver(() => {
      if ((doc.documentElement as HTMLElement | null) === null) return;
      waiting?.disconnect();
      waiting = null;
      observe();
      refresh();
    });
    waiting.observe(doc, { childList: true });
  } else observe();
  return {
    current: () => theme,
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    anchor: () => (Object.keys(theme.tokens).length > 0 ? 'ok' : 'missing'),
    dispose() {
      observer.disconnect();
      waiting?.disconnect();
      listeners.clear();
    },
  };
}
