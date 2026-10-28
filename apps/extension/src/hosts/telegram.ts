// Telegram's entry in the host registry (docs/specs/2026-10-27-telegram-site.md §6.4): Telegram Web A as the third
// site. Its addresses come from its runtime row (./runtime/telegram.ts); the rest is build data — its one script, its
// lazy build, its permission, contract check, archive markers and test config — read by build/manifest.ts,
// wxt.config.ts, lazy/vite.config.ts and tools/{gates,archive-check,host-contract-check}. Nothing that ships imports
// this file.
//
// One isolated script and no MAIN one: the adapter reads the page's DOM and the active slot's session entry, and writes
// only into the main field (packages/host-telegram). Registered by the background, never by the manifest, as Fansly's
// (§4): Firefox would grant a manifest content script's matches at install, so the background's sync registers it with
// «Включить Telegram» — on web.telegram.org/a/ in a release, on the stand too in a test build.

import { TELEGRAM_LAZY_ROOT, TELEGRAM_MATCHES, TELEGRAM_QUIET_DOMAINS } from './runtime/telegram.ts';
import { TELEGRAM_STAND_MATCHES } from './runtime/index.ts';
import type { HostDescriptor, TestHostConfig } from './types.ts';

/** The Telegram stand: its own loopback name, `telegram.localhost` (ChatSpace's `127.0.0.1`, Fansly's `localhost`). */
export const TELEGRAM_TEST: TestHostConfig = { pageMatches: TELEGRAM_STAND_MATCHES };

/**
 * Telegram's own lazy build (§6.4): the dock, the application with Telegram's own `tab-app` (the application's half of
 * its adapter, its AI policy inside) and its texts, the AI and navigation controllers, Coach's base layers, the tab's
 * health, and on demand the dialogs, the expanded result, the cheatsheet and the dock's debug part. Coach's window comes
 * with Coach (its own PR).
 */
export const TELEGRAM_LAZY_ENTRIES: Readonly<Record<string, string>> = {
  'tab-protocol': 'entries/tab-protocol.ts',
  'tab-app': 'telegram/tab-app.ts',
  'i18n-ru': 'telegram/i18n-ru.ts',
  'i18n-en': 'telegram/i18n-en.ts',
  dock: 'entries/dock.ts',
  ai: 'entries/ai.ts',
  navigation: 'entries/navigation.ts',
  'ai-analysis': 'entries/ai-analysis.ts',
  'ai-coach': 'entries/ai-coach.ts',
  'tab-health': 'entries/tab-health.ts',
  'dock-debug': 'entries/dock-debug.ts',
  cheatsheet: 'entries/cheatsheet.ts',
  'result-expanded': 'entries/result-expanded.ts',
  dialogs: 'entries/dialogs.ts',
};

/** The entries every Telegram tab loads, in their order: no bridge's schemas (no MAIN world). */
export const TELEGRAM_LAZY_LAYERS: readonly string[] = ['dock', 'tab-protocol', 'tab-app', 'ai', 'navigation'];

export const TELEGRAM: HostDescriptor = {
  kind: 'telegram-web',
  platform: 'telegram',
  background: { source: 'bg/telegram.ts', file: 'bg/telegram.js' },
  matches: TELEGRAM_MATCHES,
  quietDomains: TELEGRAM_QUIET_DOMAINS,
  scripts: {
    // The isolated bootstrap: the host's start, the keys of our roots held on `window`, the early dispatcher (§4.5).
    isolated: { entry: 'telegram', file: 'telegram.js', world: 'ISOLATED', registration: 'dynamic' },
  },
  lazy: { root: TELEGRAM_LAZY_ROOT, entries: TELEGRAM_LAZY_ENTRIES, layers: TELEGRAM_LAZY_LAYERS, beforeTheDock: ['tab-protocol', 'tab-app'] },
  // Asked for on the person's gesture («Включить Telegram»): the pages only — the extension talks to nothing of Telegram's.
  permissions: { origins: TELEGRAM_MATCHES, optional: true },
  mainWorldSources: [],
  // A stub (§6.9): the anchors are Web A's global classes (packages/host-telegram/src/isolated/dom.ts); a copy of its
  // bundle is not kept, the live check stands for it.
  contractCheck: { module: 'tools/host-contract-check/anchors-telegram.ts', bundlesRootEnv: 'CG_TELEGRAM_BUNDLES' },
  archiveMarkers: {
    // A saved Web A page or its bundle: telegram-tt's entry chunk and its Teact runtime.
    code: [/telegram-tt-bundle/, /\bteactFastList\b/],
    libraries: [],
  },
  test: TELEGRAM_TEST,
};
