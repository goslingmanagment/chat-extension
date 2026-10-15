// Fansly's theme as our UI needs it (docs/project-unite/architecture.md §7.8;
// FS-PLC-7): the scheme its page shows, from the class on <html> — dark by
// default, light with `bright-theme` (`dark-theme` says dark outright). One
// attribute observer on <html> (`class` only, no subtree) follows it; no
// timers, and idle it is silent: the class changes only when the person
// switches the theme.
//
// The page's colour variables (`--blue-1`, `--dark-1…8`, …) translated into
// the kit's `--color-om-*` triplets are the palette of Fansly's profile
// (./palette.ts, R20 P8d): only the application draws with it, so it rides in
// Fansly's application chunk and reads the page on this reader's word — the
// early bundle says the scheme alone, and `tokens` stay empty. Fansly has no
// fixed-width workspace.
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

/** Which of Fansly's theme classes <html> wears: its controller has run when one is there. */
const marksOf = (doc: Document): string => {
  const classes = (doc.documentElement as HTMLElement | null)?.classList;
  return `${classes?.contains(LIGHT_CLASS) === true ? 'b' : ''}${classes?.contains(DARK_CLASS) === true ? 'd' : ''}`;
};

export function createFanslyTheme(doc: Document): FanslyTheme {
  /** null — nothing asked for it yet. */
  let theme: HostTheme | null = null;
  let marks = '';
  const listeners = new Set<(theme: HostTheme) => void>();
  let observer: MutationObserver | null = null;
  let waiting: MutationObserver | null = null;
  let disposed = false;

  // Said when the scheme moves, and when Fansly's theme class comes or goes with the scheme the same: its variables
  // may have come with it, and the palette (./palette.ts) reads them anew (R20 P8d). Other classes say nothing.
  const refresh = (): void => {
    if (theme === null) return;
    const next = readFanslyTheme(doc);
    const nextMarks = marksOf(doc);
    if (next.scheme === theme.scheme && nextMarks === marks) return;
    theme = next;
    marks = nextMarks;
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
      marks = marksOf(doc);
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
