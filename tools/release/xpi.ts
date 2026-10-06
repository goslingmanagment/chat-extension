// What the tool can say about a signed XPI without Firefox (architecture.md
// §13 п. 4–5): it carries Mozilla's signature files, it is this add-on at this
// version, and apart from the signature it is byte for byte the build that
// passed the gate. Whether the signature itself is good, Firefox decides when
// it installs the file — that is a line of the owner's smoke, not of this
// check. No I/O here.

import { createHash } from 'node:crypto';

import type { ZipEntry } from '../lib/zip.ts';

export const sha256Hex = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');

const SIGNATURE_DIR = 'META-INF/';
/** The PKCS#7 signature AMO puts into every signed XPI. */
export const SIGNATURE_FILES = ['META-INF/manifest.mf', 'META-INF/mozilla.sf', 'META-INF/mozilla.rsa'] as const;

export interface XpiIdentity {
  readonly version: string;
  readonly geckoId: string;
}

export function xpiIdentity(entries: readonly ZipEntry[]): XpiIdentity {
  const manifest = entries.find((entry) => entry.name === 'manifest.json');
  if (manifest === undefined) throw new Error('no manifest.json in the XPI.');
  const parsed = JSON.parse(manifest.data.toString('utf8')) as { version?: unknown; browser_specific_settings?: { gecko?: { id?: unknown } } };
  const geckoId = parsed.browser_specific_settings?.gecko?.id;
  if (typeof parsed.version !== 'string' || typeof geckoId !== 'string') throw new Error('manifest.json in the XPI has no version or no gecko id.');
  return { version: parsed.version, geckoId };
}

export function isSigned(entries: readonly ZipEntry[]): boolean {
  const names = new Set(entries.map((entry) => entry.name));
  return SIGNATURE_FILES.every((name) => names.has(name));
}

/**
 * Problems of a signed XPI against what was built; [] — it is the build, signed.
 * `buildFiles` are the files of the build directory (names relative to it).
 */
export function checkSignedXpi(entries: readonly ZipEntry[], expected: XpiIdentity, buildFiles: readonly ZipEntry[]): string[] {
  const problems: string[] = [];
  const names = new Set(entries.map((entry) => entry.name));
  for (const name of SIGNATURE_FILES) if (!names.has(name)) problems.push(`not signed: ${name} is missing`);
  try {
    const identity = xpiIdentity(entries);
    if (identity.geckoId !== expected.geckoId) problems.push(`add-on id ${identity.geckoId}, expected ${expected.geckoId}`);
    if (identity.version !== expected.version) problems.push(`version ${identity.version}, expected ${expected.version}`);
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  }
  const payload = new Map(entries.filter((entry) => !entry.name.startsWith(SIGNATURE_DIR)).map((entry) => [entry.name, entry.data]));
  const build = new Map(buildFiles.map((file) => [file.name, file.data]));
  for (const [name, data] of payload) {
    const built = build.get(name);
    if (built === undefined) problems.push(`${name} is in the XPI but not in the build`);
    else if (!built.equals(data)) problems.push(`${name} differs from the build`);
  }
  for (const name of build.keys()) if (!payload.has(name)) problems.push(`${name} is in the build but not in the XPI`);
  return problems;
}
