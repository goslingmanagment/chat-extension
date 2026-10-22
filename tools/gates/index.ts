// `pnpm gates` (architecture.md §3 «pnpm check» п. 7): static invariants of
// our source plus the built release manifest and bundle, and the gates that
// keep the two sites apart (sites.ts; docs/project-unite/architecture.md §1.8).
// Exit 1 on any violation.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { checkManifest } from '../../apps/extension/build/manifest.ts';
import { hostOf, HOSTS } from '../../apps/extension/src/hosts/index.ts';
import { readSources, readTree } from '../lib/files.ts';
import { fail, RELEASE_DIR, REPO_ROOT, TEST_DIR } from '../lib/paths.ts';
import {
  checkIsolatedStart,
  checkMainWorldBundles,
  checkReleaseBundle,
  MAIN_WORLD_BUNDLES,
  checkSdkCustody,
  checkTabStorageListeners,
  deriveSdkMarkers,
  FETCH_EXCEPTIONS,
  missingSdkMarkerKinds,
  runSourceGates,
  type Violation,
} from './checks.ts';
import { notesViolations } from './notes.ts';
import { checkBuildData, checkSiteLiterals, checkSiteMarkers, deriveSiteMarkers, SITE_LITERAL_DEBT, SITES } from './sites.ts';

const sources = readSources();
const violations: Violation[] = [...runSourceGates(sources)];

// The notes of changes parse; a PR keeps the rules of notes and versions (notes.ts).
violations.push(...notesViolations());

// Site literals: shared code names no site, but for the debt list.
violations.push(...checkSiteLiterals(sources, SITE_LITERAL_DEBT));

if (!existsSync(join(RELEASE_DIR, 'manifest.json'))) fail('gates: release build missing — run pnpm build first.');
const release = JSON.parse(readFileSync(join(RELEASE_DIR, 'manifest.json'), 'utf8')) as Record<string, unknown>;
for (const problem of checkManifest(release, 'release')) {
  violations.push({ gate: 'release-manifest', path: 'apps/extension/.output/firefox-mv3/manifest.json', line: 1, message: problem });
}
// Every script the manifest runs in the page's world is one the MAIN-world bundle gate reads.
for (const script of (release['content_scripts'] ?? []) as Array<{ world?: string; js?: string[] }>) {
  if (script.world !== 'MAIN') continue;
  for (const js of script.js ?? []) {
    if (!MAIN_WORLD_BUNDLES.includes(js)) violations.push({ gate: 'main-world-bundle', path: 'apps/extension/.output/firefox-mv3/manifest.json', line: 1, message: `MAIN-world content script ${js} is not in MAIN_WORLD_BUNDLES (tools/gates/checks.ts).` });
  }
}
// Markers of SDK code in a bundle come from the vendored dist itself (parsed:
// its extensionless imports keep plain Node from importing it). A kind that
// disappears fails the gate instead of silently checking less.
const sdkMarkers = deriveSdkMarkers(readTree(`${REPO_ROOT}vendor/kernel-sdk/dist`, (path) => path.endsWith('.js')));
const missingKinds = missingSdkMarkerKinds(sdkMarkers);
if (missingKinds.length > 0) {
  fail(`gates: no SDK markers of kind ${missingKinds.join(', ')} in vendor/kernel-sdk/dist — update deriveSdkMarkers (tools/gates/checks.ts).`);
}
const releaseFiles = readTree(RELEASE_DIR, (path) => /\.(js|json|html|css)$/.test(path));
violations.push(...checkReleaseBundle(releaseFiles), ...checkSdkCustody(releaseFiles, sdkMarkers), ...checkMainWorldBundles(releaseFiles), ...checkIsolatedStart(releaseFiles), ...checkTabStorageListeners(releaseFiles));

// ── The two sites kept apart (docs/project-unite/architecture.md §1.8) ──
const chatspace = hostOf('chatspace');
const fansly = SITES.find((site) => site.kind === 'fansly-web');
if (chatspace === undefined || fansly === undefined) fail('gates: the host registry has no ChatSpace, or the contracts no fansly-web: the gates between the sites have nothing to hold.');

// No Fansly data in what ChatSpace loads: the strings only Fansly's own modules carry, against the shared source and
// the vendored packages a bundle is built from. No marker at all is a gate that checks nothing.
const vendored = readdirSync(`${REPO_ROOT}vendor`)
  .filter((name) => existsSync(`${REPO_ROOT}vendor/${name}/dist`))
  .flatMap((name) => readTree(`${REPO_ROOT}vendor/${name}/dist`, (path) => path.endsWith('.js')).map((file) => ({ path: `vendor/${name}/dist/${file.path}`, text: file.text })));
const fanslyMarkers = deriveSiteMarkers([...sources, ...vendored], fansly);
if (fanslyMarkers.length === 0) fail('gates: no marker string of Fansly was derived from its own sources — update deriveSiteMarkers (tools/gates/sites.ts).');
violations.push(...checkSiteMarkers(releaseFiles, chatspace, fanslyMarkers, fansly.kind));

// No build field of the host registry in any bundle.
violations.push(...checkBuildData(releaseFiles, HOSTS));

if (existsSync(join(TEST_DIR, 'manifest.json'))) {
  const test = JSON.parse(readFileSync(join(TEST_DIR, 'manifest.json'), 'utf8')) as Record<string, unknown>;
  for (const problem of checkManifest(test, 'test')) {
    violations.push({ gate: 'test-manifest', path: 'apps/extension/.output/firefox-mv3-test/manifest.json', line: 1, message: problem });
  }
}

for (const violation of violations) {
  console.error(`${violation.gate}: ${violation.path}:${violation.line} — ${violation.message}`);
}
if (violations.length > 0) fail(`gates: ${violations.length} violation(s).`);
const debt = SITE_LITERAL_DEBT.length === 0 ? 'none left' : `${SITE_LITERAL_DEBT.reduce((sum, entry) => sum + entry.count, 0)} left in ${SITE_LITERAL_DEBT.length} debt entries`;
console.log(
  `gates: HTML sinks, browser.* scope, send-queue scope, stand-only hooks, MAIN-world guards, fetch only in the hub, fansly-api and the relay (${FETCH_EXCEPTIONS.length} counted exceptions), Fansly's addresses under its API, no /message/ack, release manifest and bundle, SDK custody (${sdkMarkers.length} SDK markers), MAIN-world bundles (no console, debugger or WXT wrapper), the isolated start without WXT's context, no storage listener in the tab — all clean.`,
);
console.log(
  `gates: the two sites — site literals (${debt}), no Fansly data in ChatSpace's files (${fanslyMarkers.length} markers), no build field in a bundle — all clean.`,
);
