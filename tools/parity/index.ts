// `pnpm parity`: every parity checklist row has an owner and a check.
// R00 stub: while the contracts are still the R00 scaffold (CONTRACTS_VERSION
// '0.0.0-r00') a missing manifest is only a warning. From R01 on — the moment
// R01 bumps CONTRACTS_VERSION — a missing manifest fails `pnpm check`.

import { existsSync, readFileSync } from 'node:fs';

import { fail, REPO_ROOT } from '../lib/paths.ts';
import { checklistIds, checkParityManifest, manifestRequired } from './manifest.ts';

const MANIFEST = `${REPO_ROOT}docs/parity/parity-manifest.json`;
const CHECKLIST = `${REPO_ROOT}docs/parity/parity-checklist.md`;
const CONTRACTS = `${REPO_ROOT}packages/contracts/src/index.ts`;

const ids = checklistIds(readFileSync(CHECKLIST, 'utf8'));
if (!existsSync(MANIFEST)) {
  const required = manifestRequired(readFileSync(CONTRACTS, 'utf8'));
  if (required) fail(`parity: docs/parity/parity-manifest.json is missing, but the contracts are past R00 (${required}). R01 owns the manifest.`);
  console.warn(`parity: WARNING — no manifest yet (docs/parity/parity-manifest.json, R01). ${ids.length} checklist rows unowned by machine check.`);
  process.exit(0);
}
const problems = checkParityManifest(JSON.parse(readFileSync(MANIFEST, 'utf8')) as unknown, ids);
for (const problem of problems) console.error(`parity: ${problem}`);
if (problems.length > 0) fail(`parity: ${problems.length} problem(s).`);
console.log(`parity: ${ids.length} rows, each with an owner and a check.`);
