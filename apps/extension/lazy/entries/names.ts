// The lazy entries of the tab by name, and the order the tab loads the ones
// every chat tab needs. Plain data shared by the build (lazy/vite.config.ts)
// and the tab itself, which loads them by these names (src/composition/tab).

/** Entry name → source. Output: lazy/<name>.js. */
export const LAZY_ENTRIES = {
  // Every ChatSpace page, with the first frame from MAIN: the bridge's schemas.
  'bridge-validation': 'entries/bridge-validation.ts',
  // The application base: loaded with the first composer (or the first key of ours).
  'tab-protocol': 'entries/tab-protocol.ts',
  'tab-app': 'entries/tab-app.ts',
  'i18n-ru': 'entries/i18n-ru.ts',
  'i18n-en': 'entries/i18n-en.ts',
  dock: 'entries/dock.ts',
  ai: 'entries/ai.ts',
  navigation: 'entries/navigation.ts',
  // Right after the dock is on screen.
  'ai-analysis': 'entries/ai-analysis.ts',
  'ai-coach': 'entries/ai-coach.ts',
  'tab-health': 'entries/tab-health.ts',
  // With the first Spenders, «Новые», fan panel or palette.
  boards: 'entries/boards.ts',
  'boards-preview': 'entries/boards-preview.ts',
  // Surfaces, each with the first time it is shown.
  'dock-analysis': 'entries/dock-analysis.ts',
  'dock-debug': 'entries/dock-debug.ts',
  'dock-voice': 'entries/dock-voice.ts',
  coach: 'entries/coach.ts',
  cheatsheet: 'entries/cheatsheet.ts',
  'result-expanded': 'entries/result-expanded.ts',
  dialogs: 'entries/dialogs.ts',
  spenders: 'entries/spenders.ts',
  newcomers: 'entries/newcomers.ts',
  // «Рассылка»: its window and the chip it folds into.
  outreach: 'entries/outreach.ts',
  // «Онлайн»: its window, one on both sites.
  online: 'entries/online.ts',
  'fan-panel': 'entries/fan-panel.ts',
  palette: 'entries/palette.ts',
  // The preview's own window, for a fan of the palette's «Онлайн» (X24).
  preview: 'entries/preview.ts',
  // The preview send's own chunk (feature `preview-send`): the media panel of a preview (X53), with its first «Медиа»
  // click; the three previews share it.
  'preview-send': 'entries/preview-send.ts',
} as const;

/**
 * Entries only a site's own build has (R20: Fansly's AI policy, P8b1; its panels — the vault, P13b), named for the
 * loader's type: the site's registry entry builds them (apps/extension/src/hosts/<site>.ts), and no other build has a
 * file of that name.
 */
export type SiteLazyEntryName = 'ai-fansly' | 'vault' | 'registration' | 'notes' | 'launcher';

export type LazyEntryName = keyof typeof LAZY_ENTRIES | SiteLazyEntryName;

/**
 * The entries every chat tab loads, in their order: the first dock chunk,
 * then each next one on top of the ones before it. The tab really loads them so (composition/tab/runtime.ts
 * and app.ts); apps/extension/test/lazy.test.ts holds the two together.
 */
export const LAZY_LAYERS = ['dock', 'bridge-validation', 'tab-protocol', 'tab-app', 'ai', 'navigation'] as const satisfies readonly LazyEntryName[];
/** The layers that load before the dock or without it: what the dock shares with one of them is the kernel. */
export const BEFORE_THE_DOCK: readonly string[] = ['bridge-validation', 'tab-protocol', 'tab-app'];
