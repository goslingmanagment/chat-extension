// Fansly's entry in the host registry (docs/project-unite/architecture.md §1.2;
// R20 P7a0): its addresses come from its runtime row (./runtime/fansly.ts); the
// rest is build data — its scripts, lazy build, permissions, budgets, contract
// check, archive markers and test config — read by build/manifest.ts,
// wxt.config.ts, lazy/vite.config.ts and
// tools/{gates,size-budget,archive-check,host-contract-check}. Nothing that
// ships imports this file.
//
// Its two scripts are registered by the background, never by the manifest, in
// a release and in a test build alike (§4, А12): Firefox grants every match of
// a manifest content script at install (MV3 `extensions.originControls.
// grantByDefault`), so a static one would hand fansly.com — and in a test
// build the stand — to every installation before anyone switched Fansly on.
// The registration comes with «Включить Fansly» (P9a); on the stand the e2e
// makes the same one call `[fansly-main, fansly]` itself
// (packages/testing/e2e/support/fansly-site.ts), with the stand's origins
// granted as a person would.

import { FANSLY_LAZY_ROOT, FANSLY_MATCHES, FANSLY_QUIET_DOMAINS } from './runtime/fansly.ts';
import { FANSLY_STAND_MATCHES } from './runtime/index.ts';
import type { HostDescriptor, TestHostConfig } from './types.ts';

const KIB = 1024;

/** The Fansly stand: its own loopback name, `localhost` (ChatSpace's stand is `127.0.0.1`), optional as the site's pages (R20 P6a). */
export const FANSLY_TEST: TestHostConfig = { pageMatches: FANSLY_STAND_MATCHES };

/** Fansly's API: its background asks it, by the list of FS-NET-1 (§8.3); the session and its answers come from `webRequest` (§8.2). */
export const FANSLY_API_MATCHES: readonly string[] = ['https://apiv3.fansly.com/*'];

/**
 * Fansly's own lazy build (§3.1, §3.2): `lazy/fansly/<entry>.js`, cut by the bundler alone until it has the dock's
 * layers. Its first chunk is the bridge's schemas, which every Fansly page loads with MAIN's first frame; the
 * application's chunks, the AI policy of the site and its panels come with their work packages.
 */
export const FANSLY_LAZY_ENTRIES: Readonly<Record<string, string>> = {
  'bridge-validation': 'fansly/bridge-validation.ts',
};

export const FANSLY: HostDescriptor = {
  kind: 'fansly-web',
  platform: 'fansly',
  background: { source: 'bg/fansly.ts', file: 'bg/fansly.js', rawBytes: 200 * KIB },
  matches: FANSLY_MATCHES,
  quietDomains: FANSLY_QUIET_DOMAINS,
  scripts: {
    // MAIN: the boot of host-kit, the traps on the page's sockets and requests, the observation — one bundle (§3.1).
    main: { entry: 'fansly-main', file: 'fansly-main.js', world: 'MAIN', registration: 'dynamic' },
    // The early isolated bootstrap: the adapter's start, the bridge client, the keys (§7.1).
    isolated: { entry: 'fansly', file: 'fansly.js', world: 'ISOLATED', registration: 'dynamic' },
    notice: { entry: 'fansly-notice', file: 'fansly-notice.js', world: 'ISOLATED', registration: 'execute' },
  },
  lazy: { root: FANSLY_LAZY_ROOT, entries: FANSLY_LAZY_ENTRIES, layers: [], beforeTheDock: [] },
  // Asked for on the person's gesture, all at once (§4 «Включить Fansly»): the pages, the API and webRequest.
  permissions: { origins: [...FANSLY_MATCHES, ...FANSLY_API_MATCHES], optional: true, api: ['webRequest'] },
  // The boot, the traps and the observation run in the page's own world (§5).
  mainWorldSources: ['packages/host-fansly/src/main/'],
  // §3.1, gzip -9. The isolated line: the part every site's early bundle carries is 18 227 B of it (F3's measure).
  budgets: {
    scripts: [
      // Everything of MAIN in one script, ≤ 1 ms at document_start (e2e): the P3a prototype was 8.8 KiB.
      { entry: 'fansly-main', label: 'MAIN: boot, traps, observation (fansly-main)', gzipBytes: 16 * KIB },
      { entry: 'fansly', label: 'early isolated start of the site (fansly)', gzipBytes: 30 * KIB },
      { entry: 'fansly-notice', label: 'reload notice (fansly-notice)', gzipBytes: 2 * KIB },
    ],
    contracts: [],
  },
  // Local only, never in CI: the copies of Fansly's bundles stay outside the repository (§0; P7h brings the module).
  contractCheck: { module: 'packages/host-fansly/src/isolated/host-contract.ts', bundlesRootEnv: 'CG_FANSLY_BUNDLES' },
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
