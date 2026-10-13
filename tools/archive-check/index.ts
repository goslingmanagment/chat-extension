// `pnpm archive-check`: inspects the release XPI and the AMO sources archive of
// the LAST release build (named by the version in its manifest; see
// tools/lib/artifacts.ts). Exit 1 on any problem.

import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { builtArtifacts, type BuiltArtifacts } from '../lib/artifacts.ts';
import { listTree } from '../lib/files.ts';
import { fail } from '../lib/paths.ts';
import { readZip } from '../lib/zip.ts';
import { STAND_SOURCE_KEPT } from '../../apps/extension/build/sources-archive.ts';
import { checkArchive, compareWithBuild, missingBackgroundChunks, type ArchiveProblem } from './rules.ts';

function pickArtifacts(): BuiltArtifacts & { readonly sources: string } {
  try {
    const built = builtArtifacts('release');
    if (built.sources === null) fail('archive-check: the release build has no sources archive.');
    return { ...built, sources: built.sources };
  } catch (error) {
    fail(`archive-check: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const built = pickArtifacts();
const xpi = basename(built.xpi);
const sources = basename(built.sources);

const problems: ArchiveProblem[] = [];
const xpiEntries = readZip(readFileSync(built.xpi));
const buildFiles = listTree(built.dir).map((name) => ({ name, data: readFileSync(join(built.dir, name)) }));
problems.push(...checkArchive(xpi, xpiEntries, 'xpi'), ...compareWithBuild(xpi, xpiEntries, buildFiles), ...missingBackgroundChunks(xpi, xpiEntries));
const sourceEntries = readZip(readFileSync(built.sources));
problems.push(...checkArchive(sources, sourceEntries, 'sources'));
if (!sourceEntries.some((entry) => entry.name === 'pnpm-lock.yaml')) {
  problems.push({ archive: sources, file: 'pnpm-lock.yaml', rule: 'reproducible-build', detail: 'the sources archive must carry the lockfile' });
}
// `tsc -b` in the archive needs the fixture's tsconfig and its protocol types (build/sources-archive.ts).
for (const kept of STAND_SOURCE_KEPT.filter((name) => !sourceEntries.some((entry) => entry.name === name))) {
  problems.push({ archive: sources, file: kept, rule: 'reproducible-build', detail: 'kept for `tsc -b` in the archive, but missing from it' });
}

for (const problem of problems) console.error(`${problem.rule}: ${problem.archive} → ${problem.file} (${problem.detail})`);
if (problems.length > 0) fail(`archive-check: ${problems.length} problem(s).`);
console.log(`archive-check: ${xpi} (${xpiEntries.length} files, same as the build dir) and ${sources} (${sourceEntries.length} files) are clean.`);
