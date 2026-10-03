// `pnpm archive-check`: inspects the release XPI and the AMO sources archive.
// Exit 1 on any problem.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { listTree } from '../lib/files.ts';
import { fail, OUTPUT_ROOT, RELEASE_DIR } from '../lib/paths.ts';
import { readZip } from '../lib/zip.ts';
import { checkArchive, compareWithBuild, type ArchiveProblem } from './rules.ts';

const zips = readdirSync(OUTPUT_ROOT).filter((name) => name.endsWith('.zip') && !name.includes('-test'));
const xpi = zips.find((name) => name.endsWith('-firefox.zip'));
const sources = zips.find((name) => name.endsWith('-sources.zip'));
if (!xpi || !sources) fail('archive-check: release XPI or sources archive missing — run pnpm build first.');

const problems: ArchiveProblem[] = [];
const xpiEntries = readZip(readFileSync(join(OUTPUT_ROOT, xpi)));
problems.push(...checkArchive(xpi, xpiEntries, 'xpi'), ...compareWithBuild(xpi, xpiEntries, listTree(RELEASE_DIR)));
const sourceEntries = readZip(readFileSync(join(OUTPUT_ROOT, sources)));
problems.push(...checkArchive(sources, sourceEntries, 'sources'));
if (!sourceEntries.some((entry) => entry.name === 'pnpm-lock.yaml')) {
  problems.push({ archive: sources, file: 'pnpm-lock.yaml', rule: 'reproducible-build', detail: 'the sources archive must carry the lockfile' });
}

for (const problem of problems) console.error(`${problem.rule}: ${problem.archive} → ${problem.file} (${problem.detail})`);
if (problems.length > 0) fail(`archive-check: ${problems.length} problem(s).`);
console.log(`archive-check: ${xpi} (${xpiEntries.length} files) and ${sources} (${sourceEntries.length} files) are clean.`);
