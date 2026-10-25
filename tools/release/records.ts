// The records of a release (architecture.md §13 п. 4: «Записываются sha256,
// коммит исходников и хеш SDK»), all under .release/<version>/:
//
//   gate.json       what `pnpm release` checked before it signed: the commit,
//                   every check with its result, the hashes of the build.
//   submitted.json  the gate a submission to AMO was made under, copied the
//                   moment before `web-ext sign` starts. If AMO signs the
//                   version later than web-ext waits, `sign --import` goes by
//                   this record — the gate itself may be old or gone by then.
//   release.json    what was signed: the signed XPI's name, size and sha256,
//                   the commit, the vendored SDK. It is published next to the
//                   XPI and is what a rollback reads to point the feed back.
//   announced.json  that the version was posted to the channel, or may have been.
//
// Shapes and their checks only; the files are read and written by local.ts and cli.ts.

import { join } from 'node:path';

import { recordNameOf, RELEASE_DIR, signedXpiName, signedXpiNames } from './config.ts';
import { isVersion } from './version.ts';

export interface ArtifactRef {
  readonly file: string;
  readonly sha256: string;
  readonly bytes: number;
}

export interface VendorRef {
  /** `contractHash` of vendor/kernel-sdk: what the hub must list in `compatibleClientSdks`. */
  readonly sdkContractHash: string;
  /** The hub commit the SDK was generated from. */
  readonly sdkSourceCommit: string;
  readonly hotkeysSha256: string;
}

export interface GateCheck {
  readonly id: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface GateRecord {
  readonly schema: 1;
  readonly version: string;
  readonly commit: string;
  readonly createdAt: string;
  /** false — the network checks were not made: good for a rehearsal, not for signing. */
  readonly online: boolean;
  readonly checks: readonly GateCheck[];
  readonly build: { readonly xpi: ArtifactRef; readonly sources: ArtifactRef };
  readonly vendor: VendorRef;
}

export interface ReleaseRecord {
  readonly schema: 1;
  readonly version: string;
  readonly geckoId: string;
  readonly strictMinVersion: string;
  /** The commit of this repository the XPI was built from. */
  readonly commit: string;
  readonly signedAt: string;
  /** The signed XPI as served. */
  readonly xpi: ArtifactRef;
  /** The build before signing and the sources archive AMO received. */
  readonly unsignedXpiSha256: string;
  readonly sourcesSha256: string;
  readonly vendor: VendorRef;
}

export interface ReleasePaths {
  readonly dir: string;
  readonly gate: string;
  readonly submitted: string;
  readonly record: string;
  readonly signedXpi: string;
  readonly amoMetadata: string;
  readonly announced: string;
}

/**
 * What is known about the announcement of a version: `sending` — a request
 * was about to leave (if the tool died there, nobody knows the rest);
 * `indeterminate` — Telegram may have taken it; `posted` — it answered so.
 */
export interface AnnouncedRecord {
  readonly schema: 1;
  readonly version: string;
  readonly state: 'sending' | 'indeterminate' | 'posted';
  readonly at: string;
  readonly messageId: number | null;
}

/** `xpiFile` — the name of the version's signed XPI: today's unless the version was signed before the rename. */
export function releasePaths(repoRoot: string, version: string, xpiFile: string = signedXpiName(version)): ReleasePaths {
  const dir = join(repoRoot, RELEASE_DIR, version);
  return {
    dir,
    gate: join(dir, 'gate.json'),
    submitted: join(dir, 'submitted.json'),
    record: join(dir, recordNameOf(xpiFile)),
    signedXpi: join(dir, xpiFile),
    amoMetadata: join(dir, 'amo-metadata.json'),
    announced: join(dir, 'announced.json'),
  };
}

const SHA256_RE = /^[0-9a-f]{64}$/;
const COMMIT_RE = /^[0-9a-f]{40}$/;

function artifactProblems(label: string, value: unknown): string[] {
  const artifact = value as Partial<ArtifactRef> | null | undefined;
  if (typeof artifact !== 'object' || artifact === null) return [`${label}: missing`];
  const out: string[] = [];
  if (typeof artifact.file !== 'string' || artifact.file === '' || artifact.file.includes('/')) out.push(`${label}.file: a plain file name is expected`);
  if (typeof artifact.sha256 !== 'string' || !SHA256_RE.test(artifact.sha256)) out.push(`${label}.sha256: not a sha256`);
  if (typeof artifact.bytes !== 'number' || !Number.isInteger(artifact.bytes) || artifact.bytes <= 0) out.push(`${label}.bytes: a size is expected`);
  return out;
}

function vendorProblems(value: unknown): string[] {
  const vendor = value as Partial<VendorRef> | null | undefined;
  if (typeof vendor !== 'object' || vendor === null) return ['vendor: missing'];
  const out: string[] = [];
  if (typeof vendor.sdkContractHash !== 'string' || !SHA256_RE.test(vendor.sdkContractHash)) out.push('vendor.sdkContractHash: not a sha256');
  if (typeof vendor.sdkSourceCommit !== 'string' || !COMMIT_RE.test(vendor.sdkSourceCommit)) out.push('vendor.sdkSourceCommit: not a full commit');
  if (typeof vendor.hotkeysSha256 !== 'string' || !SHA256_RE.test(vendor.hotkeysSha256)) out.push('vendor.hotkeysSha256: not a sha256');
  return out;
}

/** A release record read from a file or from the server: throws with every problem unless it is whole. */
export function parseReleaseRecord(text: string): ReleaseRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('release record: not JSON.');
  }
  const record = parsed as Partial<ReleaseRecord> | null;
  if (typeof record !== 'object' || record === null) throw new Error('release record: not an object.');
  const problems: string[] = [];
  if (record.schema !== 1) problems.push(`schema ${JSON.stringify(record.schema)}: this tool reads schema 1`);
  if (typeof record.version !== 'string' || !isVersion(record.version)) problems.push('version: not X.Y.Z');
  if (typeof record.geckoId !== 'string' || record.geckoId === '') problems.push('geckoId: missing');
  if (typeof record.strictMinVersion !== 'string' || record.strictMinVersion === '') problems.push('strictMinVersion: missing');
  if (typeof record.commit !== 'string' || !COMMIT_RE.test(record.commit)) problems.push('commit: not a full commit');
  if (typeof record.signedAt !== 'string' || Number.isNaN(Date.parse(record.signedAt))) problems.push('signedAt: not a time');
  if (typeof record.unsignedXpiSha256 !== 'string' || !SHA256_RE.test(record.unsignedXpiSha256)) problems.push('unsignedXpiSha256: not a sha256');
  if (typeof record.sourcesSha256 !== 'string' || !SHA256_RE.test(record.sourcesSha256)) problems.push('sourcesSha256: not a sha256');
  problems.push(...artifactProblems('xpi', record.xpi), ...vendorProblems(record.vendor));
  // A version signed before the rename names its file by the old prefix: that is its name for good.
  const names = signedXpiNames(record.version ?? '');
  if (problems.length === 0 && !names.includes(record.xpi?.file ?? '')) problems.push(`xpi.file: ${names.join(' or ')} is expected`);
  if (problems.length > 0) throw new Error(`release record: ${problems.join('; ')}.`);
  return record as ReleaseRecord;
}

export function parseGateRecord(text: string): GateRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('gate record: not JSON.');
  }
  const gate = parsed as Partial<GateRecord> | null;
  if (typeof gate !== 'object' || gate === null) throw new Error('gate record: not an object.');
  const problems: string[] = [];
  if (gate.schema !== 1) problems.push(`schema ${JSON.stringify(gate.schema)}: this tool reads schema 1`);
  if (typeof gate.version !== 'string' || !isVersion(gate.version)) problems.push('version: not X.Y.Z');
  if (typeof gate.commit !== 'string' || !COMMIT_RE.test(gate.commit)) problems.push('commit: not a full commit');
  if (typeof gate.createdAt !== 'string' || Number.isNaN(Date.parse(gate.createdAt))) problems.push('createdAt: not a time');
  if (typeof gate.online !== 'boolean') problems.push('online: missing');
  if (!Array.isArray(gate.checks) || gate.checks.some((check: Partial<GateCheck> | null) => typeof check?.id !== 'string' || typeof check.ok !== 'boolean' || typeof check.detail !== 'string')) {
    problems.push('checks: a list of { id, ok, detail } is expected');
  }
  problems.push(...artifactProblems('build.xpi', gate.build?.xpi), ...artifactProblems('build.sources', gate.build?.sources), ...vendorProblems(gate.vendor));
  if (problems.length > 0) throw new Error(`gate record: ${problems.join('; ')}.`);
  return gate as GateRecord;
}

export function parseAnnouncedRecord(text: string): AnnouncedRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('announcement record: not JSON.');
  }
  const record = parsed as Partial<AnnouncedRecord> | null;
  const states: readonly unknown[] = ['sending', 'indeterminate', 'posted'];
  if (typeof record !== 'object' || record === null || record.schema !== 1 || typeof record.version !== 'string' || !states.includes(record.state) || typeof record.at !== 'string') {
    throw new Error('announcement record: { schema: 1, version, state, at } is expected.');
  }
  return { schema: 1, version: record.version, state: record.state as AnnouncedRecord['state'], at: record.at, messageId: typeof record.messageId === 'number' ? record.messageId : null };
}

/** How long a passed gate stays good for signing. */
export interface GateContext {
  readonly version: string;
  /** sha256 of the release XPI and of the sources archive as they lie in .output/ now. */
  readonly xpiSha256: string;
  readonly sourcesSha256: string;
}

/** What every use of a gate asks: it passed, with the network, for this version and for the build that lies in .output/. */
function passedForBuild(gate: GateRecord, context: GateContext, rebuilt: string): string[] {
  const problems: string[] = [];
  if (!gate.online) problems.push('the checks of that run were not made online');
  const failed = gate.checks.filter((check) => !check.ok);
  if (failed.length > 0) problems.push(`the gate did not pass: ${failed.map((check) => check.id).join(', ')}`);
  if (gate.checks.length === 0) problems.push('the gate record lists no checks');
  if (gate.version !== context.version) problems.push(`the gate is for ${gate.version}, the tree holds ${context.version}`);
  if (gate.build.xpi.sha256 !== context.xpiSha256) problems.push(`the release XPI in .output/ is not the one the gate checked — ${rebuilt}`);
  if (gate.build.sources.sha256 !== context.sourcesSha256) problems.push(`the sources archive in .output/ is not the one the gate checked — ${rebuilt}`);
  return problems;
}

/**
 * Why a signed XPI downloaded by hand cannot be taken under this gate; [] — it
 * can. The file is already signed, so what the gate says about TODAY does not
 * matter — neither its age nor where HEAD and origin/main are now; `publish`
 * looks at the feed, the hub and origin again. What matters is that the build
 * the file is compared with is the build this gate passed.
 */
export function importProblems(gate: GateRecord, context: GateContext): string[] {
  return passedForBuild(gate, context, `the build in .output/ must be the one sent to AMO (from ${gate.commit.slice(0, 12)})`);
}
