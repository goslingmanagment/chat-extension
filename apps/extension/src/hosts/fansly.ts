// Fansly's entry in the host registry (docs/project-unite/architecture.md §1.2;
// R20 P7a0): its addresses come from its runtime row (./runtime/fansly.ts); the
// rest is build data — its scripts, lazy build, permissions, contract check,
// archive markers and test config — read by build/manifest.ts,
// wxt.config.ts, lazy/vite.config.ts and
// tools/{gates,archive-check,host-contract-check}. Nothing that
// ships imports this file.
//
// Its two scripts are registered by the background, never by the manifest, in
// a release and in a test build alike (§4, А12): Firefox grants every match of
// a manifest content script at install (MV3 `extensions.originControls.
// grantByDefault`), so a static one would hand fansly.com — and in a test
// build the stand — to every installation before anyone switched Fansly on.
// The registration comes with «Включить Fansly»: the background's sync
// (P9a; composition/site-access.ts `scriptSet`) registers `[fansly-main,
// fansly]` in one call on fansly.com in a release, on the stand too in a test
// build, and its e2e grants the stand's origins as a person would
// (packages/testing/e2e/support/fansly-site.ts). The tab registers with the
// background as Fansly's (`fansly-web`), and the background admits what it
// asks by Fansly's slice of the feature manifest, which Fansly's background
// module brings (bg/fansly.ts, R20 P7i).

import { BEFORE_THE_DOCK, LAZY_LAYERS } from '../../lazy/entries/names.ts';
import { FANSLY_API_MATCHES, FANSLY_LAZY_ROOT, FANSLY_MATCHES, FANSLY_QUIET_DOMAINS, FANSLY_RELAY_PAGE } from './runtime/fansly.ts';
import { FANSLY_STAND_MATCHES } from './runtime/index.ts';
import type { HostDescriptor, TestHostConfig } from './types.ts';

const KIB = 1024;

/** The Fansly stand: its own loopback name, `localhost` (ChatSpace's stand is `127.0.0.1`), optional as the site's pages (R20 P6a). */
export const FANSLY_TEST: TestHostConfig = { pageMatches: FANSLY_STAND_MATCHES };

/**
 * Fansly's own lazy build (§3.1, §3.2): `lazy/fansly/<entry>.js`. Its first chunk is the bridge's schemas, which every
 * Fansly page loads with MAIN's first frame. With the dock (R20 P7d) comes the application: the shared entries the
 * tab's application loads — built again from the same source, cut by the same plan of layers as ChatSpace's (the
 * dock, the schemas, the protocol, the application, the AI and navigation controllers) — with Fansly's own `tab-app`
 * (the application's half of its adapter) and its texts (the shared catalog with Fansly's codes). The surfaces
 * ChatSpace alone has — its palette with its cached chats, the preview window of X8, its «Новые» of the hub — are not
 * in it; Fansly's panels and «Новые» come with their work packages: its AI policy (`ai-fansly`, P8b1) and the vault's
 * panel (P13b) are here, and with the vault Fansly's `tab-protocol`, which lets Fansly's own types through to the
 * site's code; «Новые» of the background's pass (P10a) are Fansly's own `boards` and `newcomers`, under the shared
 * names the tab asks for.
 */
export const FANSLY_LAZY_ENTRIES: Readonly<Record<string, string>> = {
  'bridge-validation': 'fansly/bridge-validation.ts',
  // The shared registry, and Fansly's own types let through to the site's code that checks them (R20 P13b).
  'tab-protocol': 'fansly/tab-protocol.ts',
  'tab-app': 'fansly/tab-app.ts',
  'i18n-ru': 'fansly/i18n-ru.ts',
  'i18n-en': 'fansly/i18n-en.ts',
  dock: 'entries/dock.ts',
  ai: 'entries/ai.ts',
  navigation: 'entries/navigation.ts',
  'ai-analysis': 'entries/ai-analysis.ts',
  'ai-coach': 'entries/ai-coach.ts',
  'tab-health': 'entries/tab-health.ts',
  boards: 'fansly/boards.ts',
  'boards-preview': 'fansly/boards-preview.ts',
  'dock-analysis': 'entries/dock-analysis.ts',
  'dock-debug': 'entries/dock-debug.ts',
  coach: 'entries/coach.ts',
  cheatsheet: 'entries/cheatsheet.ts',
  'result-expanded': 'entries/result-expanded.ts',
  dialogs: 'entries/dialogs.ts',
  spenders: 'entries/spenders.ts',
  'fan-panel': 'entries/fan-panel.ts',
  // Fansly's AI policy (§1.6, §3.1): the proof of a start from MAIN's snapshot, loaded with the dock (R20 P8b1).
  'ai-fansly': 'fansly/ai-fansly.ts',
  // Fansly's own panels (§3.1): the vault on `/creator/vault` (R20 P13b) and the «Новые» window (R20 P10a).
  vault: 'fansly/vault.ts',
  registration: 'fansly/registration.ts',
  newcomers: 'fansly/newcomers.ts',
  // «Заметки» (R20 P11b): their button, panel and controller, with «Регистрация» on /messages.
  notes: 'fansly/notes.ts',
  // The floating launcher of Spenders and «Новые» (X46): plain DOM, every page of an admitted tab, before any application.
  launcher: 'fansly/launcher.ts',
};

export const FANSLY: HostDescriptor = {
  kind: 'fansly-web',
  platform: 'fansly',
  background: { source: 'bg/fansly.ts', file: 'bg/fansly.js', rawBytes: 256 * KIB }, // 200 → 256 KiB, 2026-10-16: P10c's greeting put it 2.4 KiB over (owner: raise, no byte-hunting)
  // «Fansly через вкладку» (§8.5, R20 P9c): the relay page its tabs frame, web-accessible to Fansly's pages alone.
  relayPage: FANSLY_RELAY_PAGE,
  matches: FANSLY_MATCHES,
  quietDomains: FANSLY_QUIET_DOMAINS,
  scripts: {
    // MAIN: the boot of host-kit, the traps on the page's sockets and requests, the observation — one bundle (§3.1).
    main: { entry: 'fansly-main', file: 'fansly-main.js', world: 'MAIN', registration: 'dynamic' },
    // The early isolated bootstrap: the adapter's start, the bridge client, the keys (§7.1).
    isolated: { entry: 'fansly', file: 'fansly.js', world: 'ISOLATED', registration: 'dynamic' },
    notice: { entry: 'fansly-notice', file: 'fansly-notice.js', world: 'ISOLATED', registration: 'execute' },
  },
  lazy: { root: FANSLY_LAZY_ROOT, entries: FANSLY_LAZY_ENTRIES, layers: LAZY_LAYERS, beforeTheDock: BEFORE_THE_DOCK },
  // Asked for on the person's gesture, all at once (§4 «Включить Fansly»): the pages, the API and webRequest.
  permissions: { origins: [...FANSLY_MATCHES, ...FANSLY_API_MATCHES], optional: true, api: ['webRequest'] },
  // The boot, the traps and the observation run in the page's own world (§5).
  mainWorldSources: ['packages/host-fansly/src/main/'],
  // Local only, never in CI: the copies of Fansly's bundles stay outside the repository (§0; docs/research/fansly.md
  // says where they are). The module is the check's anchor set (P7h): it reads the adapter's own selectors and addresses.
  contractCheck: { module: 'tools/host-contract-check/anchors-fansly.ts', bundlesRootEnv: 'CG_FANSLY_BUNDLES' },
  archiveMarkers: {
    code: [
      // The research copy's folder of fansly.com's bundle (architecture.md header: the snapshot of 2026-10-12).
      /fansly-web-bundle/,
      // Angular's emulated-encapsulation attribute: the fingerprint of a saved Fansly page or its CSS.
      /\b_ngcontent-[a-z0-9]+-c\d+\b/,
    ],
    // Library code only its app carries: we ship Preact, never Angular. The Fansly-like stand
    // (packages/testing/fixture-fansly) is our own plain TypeScript page.
    libraries: [/@angular\/(?:core|common|router|platform-browser)\b/],
  },
  // The Fansly-like stand is on loopback, `localhost`: never ChatSpace's `127.0.0.1`.
  test: FANSLY_TEST,
};
