// `pnpm parity`: every parity checklist row has an owner and a check.
// R00 stub: passes with a warning until R01 adds the manifest.

import { existsSync, readFileSync } from 'node:fs';

import { fail, REPO_ROOT } from '../lib/paths.ts';
import { checklistIds, checkParityManifest } from './manifest.ts';

const MANIFEST = `${REPO_ROOT}docs/parity/parity-manifest.json`;
const CHECKLIST = `${REPO_ROOT}docs/parity/parity-checklist.md`;

const ids = checklistIds(readFileSync(CHECKLIST, 'utf8'));
if (!existsSync(MANIFEST)) {
  console.warn(`parity: WARNING — no manifest yet (docs/parity/parity-manifest.json, R01). ${ids.length} checklist rows unowned by machine check.`);
  process.exit(0);
}
const problems = checkParityManifest(JSON.parse(readFileSync(MANIFEST, 'utf8')) as unknown, ids);
for (const problem of problems) console.error(`parity: ${problem}`);
if (problems.length > 0) fail(`parity: ${problems.length} problem(s).`);
console.log(`parity: ${ids.length} rows, each with an owner and a check.`);
