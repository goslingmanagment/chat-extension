// `pnpm parity:coverage`: which rows of the parity manifest are named by a
// test, on ChatSpace and on Fansly (a `[ROW-ID]` tag in a test's title; the
// host from the file's path or a `[host:…]` mark). Reads every test file of
// the repository, the done marks of docs/project-unite/plan.md and the hub's
// confirmations (§10 of docs/project-unite/parity-matrix.md), writes
// docs/parity/coverage.md (the Russian report: ChatSpace by milestone and by
// work package; Fansly by check and by owning PR) and docs/parity/coverage.json
// (the same for a machine). The report itself is not rebuilt by `pnpm check`;
// the gate on the same rules is `pnpm parity`.
//
// Usage: node tools/parity/coverage.ts [--check]
//   --check  writes nothing; exits 1 when the files on disk differ from what
//            would be written.

import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { fail, REPO_ROOT } from '../lib/paths.ts';
import { buildCoverage, renderCoverage, serializeCoverage } from './coverage-report.ts';
import { MANIFEST_PATH, type ParityManifest } from './derive.ts';
import { MATRIX_PATH, parseParityMatrix, parsePlanPrs, PLAN_PATH } from './matrix.ts';
import { readTestFiles } from './test-files.ts';

export const COVERAGE_MD_PATH = 'docs/parity/coverage.md';
export const COVERAGE_JSON_PATH = 'docs/parity/coverage.json';

const { values } = parseArgs({ options: { check: { type: 'boolean', default: false } } });

const read = (path: string): string => readFileSync(`${REPO_ROOT}${path}`, 'utf8');
const files = readTestFiles(REPO_ROOT);

let manifest: ParityManifest;
try {
  manifest = JSON.parse(read(MANIFEST_PATH)) as ParityManifest;
} catch (error) {
  fail(`parity:coverage: cannot read ${MANIFEST_PATH} (${String(error)}). Run node tools/parity/generate.ts.`);
}
const plan = parsePlanPrs(read(PLAN_PATH));
const report = buildCoverage(manifest.rows, files, { confirmations: parseParityMatrix(read(MATRIX_PATH)).hub, prs: plan.all, done: plan.done });
const outputs: ReadonlyArray<readonly [string, string]> = [
  [COVERAGE_MD_PATH, renderCoverage(report)],
  [COVERAGE_JSON_PATH, serializeCoverage(report)],
];

if (values.check) {
  const stale = outputs.filter(([path, text]) => {
    try {
      return read(path) !== text;
    } catch {
      return true;
    }
  });
  if (stale.length > 0) fail(`parity:coverage: ${stale.map(([path]) => path).join(', ')} is stale — run pnpm parity:coverage.`);
} else {
  for (const [path, text] of outputs) writeFileSync(`${REPO_ROOT}${path}`, text);
}

const { totals, fansly } = report;
console.log(
  `parity:coverage: ChatSpace — ${String(totals.covered)} of ${String(totals.rows)} rows with a check are named by a test (${String(totals.pilotCovered)} of ${String(totals.pilot)} pilot rows); ` +
    `${String(totals.pilotUncovered)} pilot rows without one; ${String(report.testFiles.unit)} unit and ${String(report.testFiles.e2e)} e2e files.`,
);
console.log(`parity:coverage: Fansly — ${String(fansly.closed)} of ${String(fansly.required)} rows closed, ${String(fansly.open)} open (${String(fansly.afterPilot)} after the pilot); ${String(fansly.openOfDone.length)} open rows of done PRs.`);
if (report.unknownTags.length > 0) console.warn(`parity:coverage: ${String(report.unknownTags.length)} tag(s) that are no row of the manifest: ${report.unknownTags.map((entry) => entry.tag).join(', ')}`);
console.log(values.check ? 'parity:coverage: the report on disk is current.' : `parity:coverage: wrote ${COVERAGE_MD_PATH} and ${COVERAGE_JSON_PATH}.`);
