// AMO signing (architecture.md §13 п. 3–4, UP-002): `web-ext sign --channel
// unlisted` with the sources archive and the build instructions for Mozilla's
// reviewers. The keys are read by web-ext itself from WEB_EXT_API_KEY and
// WEB_EXT_API_SECRET in the environment — they are never an argument, never in
// a file, never printed. The signed XPI is then checked against the build and
// stored under .release/<version>/ with the record of the release; it is never
// signed twice.

import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { dropUploadUuid } from '../lib/web-ext.ts';
import { readZip, type ZipEntry } from '../lib/zip.ts';
import { ENV, type ReleaseTarget } from './config.ts';
import type { CommandSpec, Exec } from './exec.ts';
import type { ArtifactRef, GateRecord, ReleaseRecord } from './records.ts';
import { checkSignedXpi, type XpiIdentity } from './xpi.ts';

export interface SignInput {
  readonly repoRoot: string;
  /** The release build directory and the sources archive the gate checked. */
  readonly buildDir: string;
  readonly sourcesZip: string;
  /** web-ext saves the signed file here. */
  readonly artifactsDir: string;
  readonly metadataPath: string;
  /** Tests only: a local stand-in for AMO. */
  readonly amoBaseUrl?: string;
}

/** Waiting for AMO: validation and automatic approval of an unlisted version take a few minutes at most. */
const AMO_TIMEOUT_MS = 15 * 60 * 1000;

export function signCommand(input: SignInput): CommandSpec {
  if (input.amoBaseUrl !== undefined && !/^http:\/\/127\.0\.0\.1:\d+\//.test(input.amoBaseUrl)) {
    throw new Error('sign: the AMO address can be replaced only by a loopback stand-in (tests).');
  }
  return {
    program: `${input.repoRoot}node_modules/.bin/web-ext`,
    args: [
      'sign',
      '--no-config-discovery',
      '--no-input',
      '--channel',
      'unlisted',
      '--source-dir',
      input.buildDir,
      '--upload-source-code',
      input.sourcesZip,
      '--amo-metadata',
      input.metadataPath,
      '--artifacts-dir',
      input.artifactsDir,
      '--timeout',
      String(AMO_TIMEOUT_MS),
      '--approval-timeout',
      String(AMO_TIMEOUT_MS),
      ...(input.amoBaseUrl === undefined ? [] : ['--amo-base-url', input.amoBaseUrl]),
    ],
    cwd: input.repoRoot,
    env: { NO_UPDATE_NOTIFIER: '1' },
    secretEnv: [ENV.amoKey, ENV.amoSecret],
    inherit: true,
  };
}

/**
 * Runs the signing and returns the signed XPI — only if it is the build,
 * signed: this add-on, this version, every file of the build unchanged. On any
 * failure nothing is returned and the downloaded file (if any) stays in
 * `artifactsDir` for a look.
 */
export async function signBuild(exec: Exec, input: SignInput, expected: XpiIdentity, buildFiles: () => ZipEntry[], command: CommandSpec = signCommand(input)): Promise<Buffer> {
  mkdirSync(input.artifactsDir, { recursive: true });
  // No upload id left by an earlier run (a dry run against the stand-in, an attempt that failed): upload afresh.
  dropUploadUuid(input.buildDir);
  let result;
  try {
    result = await exec(command);
  } finally {
    dropUploadUuid(input.buildDir);
  }
  if (result.code !== 0) throw new Error(`web-ext sign exited ${result.code}. Nothing was stored; look at the developer hub before trying again — AMO may have taken the version.`);
  const signed = readdirSync(input.artifactsDir).filter((name) => name.endsWith('.xpi'));
  const name = signed[0];
  if (signed.length !== 1 || name === undefined) throw new Error(`expected one signed .xpi in ${input.artifactsDir}, found ${signed.length}.`);
  const data = readFileSync(join(input.artifactsDir, name));
  const wrong = checkSignedXpi(readZip(data), expected, buildFiles());
  if (wrong.length > 0) throw new Error(`the signed XPI is not the build that passed the gate:\n  ${wrong.join('\n  ')}\nIt stays in ${input.artifactsDir}; nothing was stored.`);
  return data;
}

export interface ReviewerNotesInput {
  readonly version: string;
  readonly commit: string;
  readonly nodeVersion: string;
  readonly pnpmVersion: string;
}

/**
 * What Mozilla's reviewer needs to rebuild the XPI from the sources archive
 * (their policy asks for it when the code is bundled). BUILD.md in the archive
 * says the same without the numbers of one release.
 */
export function reviewerNotes(input: ReviewerNotesInput): string {
  return [
    `ChatGoose for ChatSpace ${input.version}, built from commit ${input.commit}.`,
    '',
    'The uploaded source archive is the repository itself (a pnpm workspace). The code in the XPI is bundled and minified by WXT (Vite); nothing is fetched or evaluated at run time.',
    '',
    'To rebuild (any OS; the build was made on macOS):',
    `1. Node ${input.nodeVersion} (the major version in .nvmrc) and pnpm ${input.pnpmVersion} (package.json "packageManager"; "npm install -g pnpm@${input.pnpmVersion}").`,
    '2. In the root of the unpacked archive: pnpm install --frozen-lockfile',
    '3. pnpm build',
    '4. The extension is apps/extension/.output/firefox-mv3/ — the same files, byte for byte, as in the submitted XPI.',
    '',
    'BUILD.md in the archive repeats these steps.',
  ].join('\n');
}

/** The file `--amo-metadata` takes: the notes for reviewers of this version. */
export function amoMetadata(notes: string): string {
  return `${JSON.stringify({ version: { approval_notes: notes } }, null, 2)}\n`;
}

export function releaseRecord(input: {
  readonly target: ReleaseTarget;
  readonly gate: GateRecord;
  readonly signedXpi: ArtifactRef;
  readonly signedAt: string;
}): ReleaseRecord {
  return {
    schema: 1,
    version: input.gate.version,
    geckoId: input.target.geckoId,
    strictMinVersion: input.target.strictMinVersion,
    commit: input.gate.commit,
    signedAt: input.signedAt,
    xpi: input.signedXpi,
    unsignedXpiSha256: input.gate.build.xpi.sha256,
    sourcesSha256: input.gate.build.sources.sha256,
    vendor: input.gate.vendor,
  };
}
