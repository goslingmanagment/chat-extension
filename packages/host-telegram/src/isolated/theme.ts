// Telegram's theme as its page shows it (the port's `theme`, the tab's scheme «как на сайте»): Web A puts
// `theme-dark` on <html> in its dark theme (src/styles/index.scss), light otherwise.

import type { HostTheme } from '@cg/contracts/host';

const DARK_CLASS = 'theme-dark';

export interface TelegramTheme {
  current(): HostTheme;
  onChange(listener: (theme: HostTheme) => void): () => void;
  dispose(): void;
}

export function readTelegramTheme(doc: Document): HostTheme {
  const dark = (doc.documentElement as HTMLElement | null)?.classList.contains(DARK_CLASS) === true;
  return { scheme: dark ? 'dark' : 'light', tokens: {}, fixedWidth: false };
}

export function createTelegramTheme(doc: Document): TelegramTheme {
  let theme: HostTheme | null = null;
  const listeners = new Set<(theme: HostTheme) => void>();
  let observer: MutationObserver | null = null;
  let waiting: MutationObserver | null = null;
  let disposed = false;

  const refresh = (): void => {
    if (theme === null) return;
    const next = readTelegramTheme(doc);
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
  return {
    current() {
      if (theme === null) {
        theme = readTelegramTheme(doc);
        watch();
      }
      return theme;
    },
    onChange(listener) {
      listeners.add(listener);
      watch();
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      disposed = true;
      observer?.disconnect();
      waiting?.disconnect();
      listeners.clear();
    },
  };
}
