// `pnpm parity`: every parity row has a plan per host — ChatSpace: an owner
// work package and a planned check; Fansly: one owning PR of the R20 plan and
// the matrix's check, or the reason it does not concern Fansly — every
// «не нужно» / «убрано владельцем» row a negative check, and the manifest is
// exactly what the map, the R20 parity matrix and the exceptions registry
// derive (no hand edits). Then the gate on Fansly (plan.md §0, P1b): every
// row of a PR marked done by a done file or in plan.md is closed on Fansly — by a test with its
// id on its host and at its level, the hub's confirmation or the exceptions
// registry — and at the pilot no Fansly row is open; host marks of tests and
// the hub's confirmations are well formed. Network: none.
// A missing manifest passes with a warning only while the contracts are the
// R00 scaffold; past R00, or with an unreadable version, it fails.

import { existsSync, readFileSync } from 'node:fs';

import { PARITY_EXCEPTIONS } from '../../packages/contracts/src/parity/exceptions.ts';
import { fail, REPO_ROOT } from '../lib/paths.ts';
import { closeOnFansly, hostMarkProblems } from './coverage-report.ts';
import { deriveManifest, MANIFEST_PATH, serializeManifest, type ManifestRow } from './derive.ts';
import { parseParityMap } from './map.ts';
import { checklistIds, checkParityManifest, fanslyGateProblems, hubConfirmationProblems, manifestRequired } from './manifest.ts';
import { MATRIX_PATH, parseParityMatrix } from './matrix.ts';
import { readPlanPrs } from './plan.ts';
import { readTestFiles } from './test-files.ts';

const MANIFEST = `${REPO_ROOT}${MANIFEST_PATH}`;
const read = (path: string): string => readFileSync(`${REPO_ROOT}${path}`, 'utf8');

const ids = checklistIds(read('docs/parity/parity-checklist.md'));
if (!existsSync(MANIFEST)) {
  const required = manifestRequired(read('packages/contracts/src/index.ts'));
  if (required) fail(`parity: ${MANIFEST_PATH} is missing, but the contracts are past R00 (${required}). Run node tools/parity/generate.ts.`);
  console.warn(`parity: WARNING — no manifest yet (${MANIFEST_PATH}). ${String(ids.length)} checklist rows unowned by machine check.`);
  process.exit(0);
}

const text = readFileSync(MANIFEST, 'utf8');
let manifest: unknown;
try {
  manifest = JSON.parse(text);
} catch (error) {
  fail(`parity: ${MANIFEST_PATH} is not valid JSON (${String(error)}).`);
}
const plan = readPlanPrs(REPO_ROOT);
const matrix = parseParityMatrix(read(MATRIX_PATH));
const problems = checkParityManifest(manifest, ids, PARITY_EXCEPTIONS, plan.all);
try {
  const expected = serializeManifest(deriveManifest(parseParityMap(read('docs/parity/parity-map.md')), PARITY_EXCEPTIONS, matrix));
  if (text !== expected) problems.push(`${MANIFEST_PATH} is stale against parity-map.md, parity-matrix.md or the exceptions registry: run node tools/parity/generate.ts`);
} catch (error) {
  problems.push(`cannot derive the manifest: ${error instanceof Error ? error.message : String(error)}`);
}
if (problems.length > 0) {
  for (const problem of problems) console.error(`parity: ${problem}`);
  fail(`parity: ${String(problems.length)} problem(s) in the manifest.`);
}

// The manifest is sound: hold Fansly to its tests.
const rows = (manifest as { rows: ManifestRow[] }).rows;
const files = readTestFiles(REPO_ROOT);
const closure = closeOnFansly(rows, files, matrix.hub);
const gate = [...hostMarkProblems(files), ...hubConfirmationProblems(matrix.hub, rows), ...fanslyGateProblems(rows, closure, plan.done)];
for (const problem of gate) console.error(`parity: ${problem}`);
if (gate.length > 0) fail(`parity: ${String(gate.length)} problem(s) on Fansly.`);

const fansly = rows.filter((row) => row.fansly.check.kind !== 'n/a');
const required = fansly.filter((row) => row.fansly.check.kind !== 'after-pilot');
const closed = required.filter((row) => closure.get(row.id)?.closed === true).length;
console.log(`parity: ${String(rows.length)} rows (${String(ids.length)} from the checklist), each with a plan on ChatSpace and on Fansly; ${String(PARITY_EXCEPTIONS.length)} negative checks.`);
console.log(
  `parity: Fansly — ${String(fansly.length)} rows of the matrix, ${String(closed)} of ${String(required.length)} closed; ${String(plan.done.size)} of ${String(plan.all.length)} PRs of the plan done (done/<PR id> or legacy ✓ in plan.md), none with an open row; ${String(files.length)} test files read.`,
);
