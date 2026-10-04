// The lazy entries of the tab by name, and the order the tab loads the ones
// every chat tab needs (architecture.md §11). Plain data shared by the build
// (lazy/vite.config.ts), the size budgets (tools/size-budget, through the
// chunk list the build writes) and the tab itself, which loads them by these
// names (src/composition/tab).

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
  coach: 'entries/coach.ts',
  cheatsheet: 'entries/cheatsheet.ts',
  'result-expanded': 'entries/result-expanded.ts',
  dialogs: 'entries/dialogs.ts',
  spenders: 'entries/spenders.ts',
  newcomers: 'entries/newcomers.ts',
  'fan-panel': 'entries/fan-panel.ts',
  palette: 'entries/palette.ts',
} as const;

export type LazyEntryName = keyof typeof LAZY_ENTRIES;

/**
 * The entries every chat tab loads, in the order their budgets stack
 * (tools/size-budget): the first dock chunk, then each next one on top of
 * the ones before it. The tab really loads them so (composition/tab/runtime.ts
 * and app.ts); apps/extension/test/lazy.test.ts holds the two together.
 */
export const LAZY_LAYERS = ['dock', 'bridge-validation', 'tab-protocol', 'tab-app', 'ai', 'navigation'] as const satisfies readonly LazyEntryName[];
/** The layers that load before the dock or without it: what the dock shares with one of them is the kernel. */
export const BEFORE_THE_DOCK: readonly string[] = ['bridge-validation', 'tab-protocol', 'tab-app'];
