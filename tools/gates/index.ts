// `pnpm gates` (architecture.md §3 «pnpm check» п. 7): static invariants of
// our source plus the built release manifest and bundle. Exit 1 on any violation.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { checkManifest } from '../../apps/extension/build/manifest.ts';
import { readSources, readTree } from '../lib/files.ts';
import { fail, RELEASE_DIR, REPO_ROOT, TEST_DIR } from '../lib/paths.ts';
import {
  checkMainWorldBundles,
  checkReleaseBundle,
  MAIN_WORLD_BUNDLES,
  checkSdkCustody,
  checkTabStorageListeners,
  deriveSdkMarkers,
  missingSdkMarkerKinds,
  runSourceGates,
  type Violation,
} from './checks.ts';

const violations: Violation[] = [...runSourceGates(readSources())];

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
violations.push(...checkReleaseBundle(releaseFiles), ...checkSdkCustody(releaseFiles, sdkMarkers), ...checkMainWorldBundles(releaseFiles), ...checkTabStorageListeners(releaseFiles));

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
console.log(
  `gates: onlymonster references, HTML sinks, browser.* scope, UI vocabulary, send-queue scope, stand-only hooks, MAIN-world guards, release manifest and bundle, SDK custody (${sdkMarkers.length} SDK markers), MAIN-world bundles (no console, debugger or WXT wrapper), no storage listener in the tab — all clean.`,
);
