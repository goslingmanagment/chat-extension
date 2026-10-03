// `pnpm gates` (architecture.md §3 «pnpm check» п. 7): static invariants of
// our source plus the built release manifest and bundle. Exit 1 on any violation.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { checkManifest } from '../../apps/extension/build/manifest.ts';
import { readSources, readTree } from '../lib/files.ts';
import { fail, RELEASE_DIR, TEST_DIR } from '../lib/paths.ts';
import { checkReleaseBundle, runSourceGates, type Violation } from './checks.ts';

const violations: Violation[] = [...runSourceGates(readSources())];

if (!existsSync(join(RELEASE_DIR, 'manifest.json'))) fail('gates: release build missing — run pnpm build first.');
const release = JSON.parse(readFileSync(join(RELEASE_DIR, 'manifest.json'), 'utf8')) as Record<string, unknown>;
for (const problem of checkManifest(release, 'release')) {
  violations.push({ gate: 'release-manifest', path: 'apps/extension/.output/firefox-mv3/manifest.json', line: 1, message: problem });
}
violations.push(...checkReleaseBundle(readTree(RELEASE_DIR, (path) => /\.(js|json|html|css)$/.test(path))));

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
console.log('gates: onlymonster references, HTML sinks, browser.* scope, UI vocabulary, send-queue scope, release manifest and bundle — all clean.');
