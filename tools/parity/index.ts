// `pnpm parity`: every parity row has an owner and a planned check, every
// «не нужно» / «убрано владельцем» row a negative check, and the manifest is
// exactly what the map and the exceptions registry derive (no hand edits).
// A missing manifest passes with a warning only while the contracts are the
// R00 scaffold; past R00, or with an unreadable version, it fails.

import { existsSync, readFileSync } from 'node:fs';

import { PARITY_EXCEPTIONS } from '../../packages/contracts/src/parity/exceptions.ts';
import { fail, REPO_ROOT } from '../lib/paths.ts';
import { deriveManifest, MANIFEST_PATH, serializeManifest } from './derive.ts';
import { parseParityMap } from './map.ts';
import { checklistIds, checkParityManifest, manifestRequired } from './manifest.ts';

const MANIFEST = `${REPO_ROOT}${MANIFEST_PATH}`;
const read = (path: string): string => readFileSync(`${REPO_ROOT}${path}`, 'utf8');

const ids = checklistIds(read('docs/parity/parity-checklist.md'));
if (!existsSync(MANIFEST)) {
  const required = manifestRequired(read('packages/contracts/src/index.ts'));
  if (required) fail(`parity: ${MANIFEST_PATH} is missing, but the contracts are past R00 (${required}). Run node tools/parity/generate.ts.`);
  console.warn(`parity: WARNING — no manifest yet (${MANIFEST_PATH}). ${ids.length} checklist rows unowned by machine check.`);
  process.exit(0);
}

const text = readFileSync(MANIFEST, 'utf8');
let manifest: unknown;
try {
  manifest = JSON.parse(text);
} catch (error) {
  fail(`parity: ${MANIFEST_PATH} is not valid JSON (${String(error)}).`);
}
const problems = checkParityManifest(manifest, ids, PARITY_EXCEPTIONS);
try {
  const expected = serializeManifest(deriveManifest(parseParityMap(read('docs/parity/parity-map.md')), PARITY_EXCEPTIONS));
  if (text !== expected) problems.push(`${MANIFEST_PATH} is stale against parity-map.md or the exceptions registry: run node tools/parity/generate.ts`);
} catch (error) {
  problems.push(`cannot derive the manifest: ${error instanceof Error ? error.message : String(error)}`);
}
for (const problem of problems) console.error(`parity: ${problem}`);
if (problems.length > 0) fail(`parity: ${problems.length} problem(s).`);
const rows = (manifest as { rows: unknown[] }).rows.length;
console.log(`parity: ${rows} rows (${ids.length} from the checklist), each with an owner and a check; ${PARITY_EXCEPTIONS.length} negative checks.`);
