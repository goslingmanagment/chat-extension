// Versions of the extension: three numbers, X.Y.Z. Firefox compares add-on
// versions part by part as numbers and takes an update only when the feed's
// version is higher; AMO refuses a version it has already signed. So a version
// is never reused and never goes down — a fix after a bad release is a higher
// version (architecture.md §13 «Откат»).

export type Version = readonly [number, number, number];
export type BumpKind = 'patch' | 'minor' | 'major';

/** No leading zeros, each part at most nine digits (the manifest's own limit). */
const VERSION_RE = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/;

export function isVersion(text: string): boolean {
  return VERSION_RE.test(text);
}

export function parseVersion(text: string): Version {
  const match = VERSION_RE.exec(text);
  if (match === null) throw new Error(`"${text}" is not a version: three numbers X.Y.Z without leading zeros are expected.`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Negative: a < b; zero: equal; positive: a > b. */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  for (let index = 0; index < 3; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function bumpVersion(current: string, kind: BumpKind): string {
  const [major, minor, patch] = parseVersion(current);
  if (kind === 'major') return `${major + 1}.0.0`;
  if (kind === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/**
 * The new text of a package.json with its "version" replaced — the one line,
 * nothing else reformatted. Throws unless the file has exactly one top-level
 * "version" line and the new version is higher than the old one.
 */
export function setPackageVersion(packageJson: string, next: string): string {
  parseVersion(next);
  const lines = packageJson.split('\n');
  const found = lines.flatMap((line, index) => (/^ {2}"version": "[^"]*",?\s*$/.test(line) ? [index] : []));
  const index = found[0];
  if (found.length !== 1 || index === undefined) throw new Error(`expected exactly one top-level "version" line, found ${found.length}.`);
  const current = readPackageVersion(packageJson);
  if (compareVersions(next, current) <= 0) throw new Error(`${next} is not higher than the current ${current}: a version never goes down and is never reused.`);
  lines[index] = (lines[index] ?? '').replace(/"version": "[^"]*"/, `"version": "${next}"`);
  return lines.join('\n');
}

export function readPackageVersion(packageJson: string): string {
  const version = (JSON.parse(packageJson) as { version?: unknown }).version;
  if (typeof version !== 'string' || !isVersion(version)) throw new Error(`package.json version ${JSON.stringify(version)} is not X.Y.Z.`);
  return version;
}

/**
 * 1.x and 2.x are the versions of the old Fansly extension (fansly-chat, chatgoose@gosling.agency, last 2.13.x).
 * This extension goes from 0.5.x straight to 3.0.0, the launch of the one extension for both sites (owner,
 * 2026-10-22), so a chatter never sees the two products under one number. null — the version is free.
 */
export function reservedVersionProblem(version: string): string | null {
  const [major] = parseVersion(version);
  if (major === 1 || major === 2) return `${version}: 1.x and 2.x are the old Fansly extension's numbers — this one goes from 0.5.x to 3.0.0 (docs/release.md «Versions»).`;
  return null;
}
