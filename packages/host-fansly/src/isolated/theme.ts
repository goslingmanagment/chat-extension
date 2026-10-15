// Fansly's theme as our UI needs it (docs/project-unite/architecture.md §7.8;
// FS-PLC-7): the scheme its page shows, from the class on <html> — dark by
// default, light with `bright-theme` (`dark-theme` says dark outright). One
// attribute observer on <html> (`class` only, no subtree) follows it; no
// timers, and idle it is silent: the class changes only when the person
// switches the theme.
//
// The page's colour variables (`--blue-1`, `--dark-1…8`, …) translated into
// the kit's `--color-om-*` triplets are P8d's (the palette of Fansly's
// profile): until then `tokens` is empty and the dock wears the kit's own
// palette in the page's scheme. Fansly has no fixed-width workspace.
//
// Read when first asked for, not at document_start: nothing needs the theme
// before the UI does, and Angular sets the class only once it runs.

import type { HostTheme } from '@cg/contracts/host';

import { FANSLY_SELECTORS } from './anchors';

const [LIGHT_CLASS, DARK_CLASS] = FANSLY_SELECTORS.themeClasses;

/** Fansly's theme as its page shows it (the port's `theme`, the tab's scheme «как на сайте»). */
export interface FanslyTheme {
  current(): HostTheme;
  onChange(listener: (theme: HostTheme) => void): () => void;
  dispose(): void;
}

/** The scheme by the class on <html>: light only with `bright-theme` (and without `dark-theme`); dark by default. */
export function readFanslyTheme(doc: Document): HostTheme {
  const classes = (doc.documentElement as HTMLElement | null)?.classList;
  const light = classes?.contains(LIGHT_CLASS) === true && !classes.contains(DARK_CLASS);
  return { scheme: light ? 'light' : 'dark', tokens: {}, fixedWidth: false };
}

export function createFanslyTheme(doc: Document): FanslyTheme {
  /** null — nothing asked for it yet. */
  let theme: HostTheme | null = null;
  const listeners = new Set<(theme: HostTheme) => void>();
  let observer: MutationObserver | null = null;
  let waiting: MutationObserver | null = null;
  let disposed = false;

  const refresh = (): void => {
    if (theme === null) return;
    const next = readFanslyTheme(doc);
    if (next.scheme === theme.scheme) return;
    theme = next;
    for (const listener of [...listeners]) listener(next);
  };
  /** The class on <html>, from the first read on; a document_start script may run before <html> exists. */
  const watch = (): void => {
    if (observer !== null || waiting !== null || disposed) return;
    if ((doc.documentElement as HTMLElement | null) === null) {
      waiting = new MutationObserver(() => {
        if ((doc.documentElement as HTMLElement | null) === null) return;
        waiting?.disconnect();
        waiting = null;
        watch();
        refresh();
      });
      waiting.observe(doc, { childList: true });
      return;
    }
    observer = new MutationObserver(refresh);
    observer.observe(doc.documentElement, { attributes: true, attributeFilter: ['class'] });
  };
  const read = (): HostTheme => {
    if (theme === null) {
      theme = readFanslyTheme(doc);
      watch();
    }
    return theme;
  };

  return {
    current: read,
    onChange(listener) {
      read();
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      disposed = true;
      observer?.disconnect();
      waiting?.disconnect();
      observer = null;
      waiting = null;
      listeners.clear();
    },
  };
}
