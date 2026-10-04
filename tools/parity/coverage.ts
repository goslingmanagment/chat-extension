// `pnpm parity:coverage`: which rows of the parity manifest are named by a
// test (a `[ROW-ID]` tag in a test's title). Reads every test file of the
// repository, writes docs/parity/coverage.md (the Russian report: by
// milestone, by work package, the pilot rows without a test) and
// docs/parity/coverage.json (the same for a machine). A report, not a gate:
// `pnpm check` does not run it, and an uncovered row fails nothing.
//
// Usage: node tools/parity/coverage.ts [--check]
//   --check  writes nothing; exits 1 when the files on disk differ from what
//            would be written (for the day the report becomes a gate).

import { globSync, readFileSync, writeFileSync } from 'node:fs';
import { sep } from 'node:path';
import { parseArgs } from 'node:util';

import { fail, REPO_ROOT } from '../lib/paths.ts';
import { buildCoverage, renderCoverage, serializeCoverage, tagsOfTestFile, type TaggedFile } from './coverage-report.ts';
import { MANIFEST_PATH, type ParityManifest } from './derive.ts';

export const COVERAGE_MD_PATH = 'docs/parity/coverage.md';
export const COVERAGE_JSON_PATH = 'docs/parity/coverage.json';

/** Every test of the repository: Vitest files and the e2e specs. */
const TEST_GLOBS = ['{packages,apps,tools,tests}/**/*.test.{ts,tsx}', 'packages/testing/e2e/**/*.e2e.ts'];
const NOT_OURS = /(^|\/)(node_modules|\.tsbuild|\.output|\.wxt|\.cache|dist|coverage)\//;
/** The tests of the parity tools themselves: their strings are samples of test files, with made-up tags. */
const OWN_TESTS = /^tools\/parity\//;

const { values } = parseArgs({ options: { check: { type: 'boolean', default: false } } });

const paths = [...new Set(TEST_GLOBS.flatMap((pattern) => globSync(pattern, { cwd: REPO_ROOT })).map((path) => path.split(sep).join('/')))].filter((path) => !NOT_OURS.test(path) && !OWN_TESTS.test(path)).sort();
const files: TaggedFile[] = paths.map((path) => ({ path, ...tagsOfTestFile(path, readFileSync(`${REPO_ROOT}${path}`, 'utf8')) }));

let manifest: ParityManifest;
try {
  manifest = JSON.parse(readFileSync(`${REPO_ROOT}${MANIFEST_PATH}`, 'utf8')) as ParityManifest;
} catch (error) {
  fail(`parity:coverage: cannot read ${MANIFEST_PATH} (${String(error)}). Run node tools/parity/generate.ts.`);
}

const report = buildCoverage(manifest.rows, files);
const outputs: ReadonlyArray<readonly [string, string]> = [
  [COVERAGE_MD_PATH, renderCoverage(report)],
  [COVERAGE_JSON_PATH, serializeCoverage(report)],
];

if (values.check) {
  const stale = outputs.filter(([path, text]) => {
    try {
      return readFileSync(`${REPO_ROOT}${path}`, 'utf8') !== text;
    } catch {
      return true;
    }
  });
  if (stale.length > 0) fail(`parity:coverage: ${stale.map(([path]) => path).join(', ')} is stale — run pnpm parity:coverage.`);
} else {
  for (const [path, text] of outputs) writeFileSync(`${REPO_ROOT}${path}`, text);
}

const { totals } = report;
console.log(
  `parity:coverage: ${String(totals.covered)} of ${String(totals.rows)} rows with a check are named by a test (${String(totals.pilotCovered)} of ${String(totals.pilot)} pilot rows); ` +
    `${String(totals.pilotUncovered)} pilot rows without one; ${String(report.testFiles.unit)} unit and ${String(report.testFiles.e2e)} e2e files.`,
);
if (report.unknownTags.length > 0) console.warn(`parity:coverage: ${String(report.unknownTags.length)} tag(s) that are no row of the manifest: ${report.unknownTags.map((entry) => entry.tag).join(', ')}`);
console.log(values.check ? 'parity:coverage: the report on disk is current.' : `parity:coverage: wrote ${COVERAGE_MD_PATH} and ${COVERAGE_JSON_PATH}.`);
