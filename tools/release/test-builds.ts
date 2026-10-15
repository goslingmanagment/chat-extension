// Signed test builds for the release gate's P3b checks (docs/project-unite/
// spike.md «Что должен проверить P3b»; plan.md row P3b): how Firefox treats a
// SIGNED build of this tree on a real update, on a restart and on the optional
// grant — what a temporary install on the stand cannot show. Four builds of
// one release build, under an add-on of their own so the real one is never
// touched:
//
//   n0       the release build without the optional sites' permissions (what a
//            chatter's 0.2.x has), id TEST_BUILDS_GECKO_ID, version <X.Y.Z>.<stamp>0 —
//            the update N0 → N is the one that ADDS them
//   n        the release build, version <X.Y.Z>.<stamp>1
//   n1       the same, version <X.Y.Z>.<stamp>2 — the update N → N+1
//   control  the same, version <X.Y.Z>.<stamp>3, with the optional sites'
//            origins moved into host_permissions — what Firefox would do with
//            fansly.com in the manifest (spike item 1's comparison)
//
// Each differs from the release build in manifest.json alone: the id, the
// version, the name (marked «P3b» on the developer hub and in about:addons), no
// update_url — no build of the set ever asks the production feed; the harness
// serves its own feed on loopback (extensions.update.url) — and, for N0 and the
// control, the sites' permissions. Every other file is the release build's,
// byte for byte.
// The stamp is the minute the set was made (minutes since 2026-01-01 UTC, × 10):
// a later set has higher versions, and AMO, which takes a version of an add-on
// once, never sees one twice. Pure functions; the files are written by cli.ts.

import type { ZipEntry } from '../lib/zip.ts';
import type { ArtifactRef } from './records.ts';

/** The test add-on: AMO keeps it apart from chat-extension@gosling.agency, Firefox too. */
export const TEST_BUILDS_GECKO_ID = 'chatgoose-p3b-test@gosling.agency';
/** Where the sets lie: one folder per set, named by the version of its N. Under .release/, never committed. */
export const TEST_BUILDS_DIR = '.release/test-builds';
export const TEST_BUILD_ROLES = ['n0', 'n', 'n1', 'control'] as const;
export type TestBuildRole = (typeof TEST_BUILD_ROLES)[number];
/** The names the harness takes the signed XPIs under (packages/testing/e2e/specs/p3b-signed-builds.e2e.ts). */
export const TEST_BUILD_ENV: Readonly<Record<TestBuildRole, string>> = { n0: 'CG_P3B_XPI_N0', n: 'CG_P3B_XPI_N', n1: 'CG_P3B_XPI_N1', control: 'CG_P3B_XPI_CONTROL' };

/** The optional sites' permissions (the host registry's): their origins and their API permissions (webRequest). */
export interface OptionalSites {
  readonly origins: readonly string[];
  readonly api: readonly string[];
}
const NAME_MARK = ' (P3b)';
const STAMP_EPOCH = Date.UTC(2026, 0, 1);
const RELEASE_VERSION_RE = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/;
/** A test build's version: four numbers. A release has three, so no build of a set can pass for a release. */
const TEST_VERSION_RE = /^(0|[1-9]\d{0,8})(\.(0|[1-9]\d{0,8})){3}$/;

/** The versions of a set made at `now` from a release build of `base` (X.Y.Z). */
export function testBuildVersions(base: string, now: Date): Readonly<Record<TestBuildRole, string>> {
  if (!RELEASE_VERSION_RE.test(base)) throw new Error(`the release build's version «${base}» is not X.Y.Z.`);
  const minutes = Math.floor((now.getTime() - STAMP_EPOCH) / 60_000);
  if (minutes <= 0) throw new Error(`the clock says ${now.toISOString()}, before 2026: no stamp for a set.`);
  const stamp = minutes * 10;
  return { n0: `${base}.${stamp}`, n: `${base}.${stamp + 1}`, n1: `${base}.${stamp + 2}`, control: `${base}.${stamp + 3}` };
}

type Json = Record<string, unknown>;
const record = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);

/**
 * The manifest of one test build from the release build's. `sites` are the optional sites' permissions (the host
 * registry's): N0 has none of them, the control asks for their origins at install. Throws when the release manifest is
 * not what P3b checks — no update_url of the release, or the sites' origins not optional — so a set is never made of
 * the wrong build.
 */
export function testManifest(release: Json, role: TestBuildRole, version: string, sites: OptionalSites): Json {
  const siteOrigins = sites.origins;
  const manifest = structuredClone(release);
  const gecko = record(manifest['browser_specific_settings']) ? (manifest['browser_specific_settings'])['gecko'] : undefined;
  if (!record(gecko) || typeof gecko['id'] !== 'string' || typeof gecko['update_url'] !== 'string') {
    throw new Error('manifest.json is not a release build: no gecko id or no update_url (pnpm build makes one; pnpm build:test does not).');
  }
  const optional = strings(manifest['optional_host_permissions']);
  const missing = siteOrigins.filter((origin) => !optional.includes(origin));
  if (siteOrigins.length === 0 || missing.length > 0) {
    throw new Error(`the release build does not ask for the optional sites' origins on request (${missing.join(', ') || 'no optional site'}): P3b checks a build that does.`);
  }
  if (typeof manifest['name'] !== 'string') throw new Error('manifest.json has no name.');
  manifest['name'] = `${manifest['name']}${NAME_MARK}`;
  manifest['version'] = version;
  gecko['id'] = TEST_BUILDS_GECKO_ID;
  delete gecko['update_url'];
  if (role === 'control') {
    manifest['host_permissions'] = [...strings(manifest['host_permissions']), ...siteOrigins];
    manifest['optional_host_permissions'] = optional.filter((origin) => !siteOrigins.includes(origin));
  }
  if (role === 'n0') {
    // The build before the sites: none of their origins or API permissions, not even on request.
    manifest['optional_host_permissions'] = optional.filter((origin) => !siteOrigins.includes(origin));
    const api = strings(manifest['optional_permissions']).filter((permission) => !sites.api.includes(permission));
    if (api.length > 0) manifest['optional_permissions'] = api;
    else delete manifest['optional_permissions'];
  }
  return manifest;
}

/** The files of one test build: the release build's, manifest.json replaced. */
export function deriveTestBuild(files: readonly ZipEntry[], role: TestBuildRole, version: string, sites: OptionalSites): ZipEntry[] {
  const manifest = files.find((file) => file.name === 'manifest.json');
  if (manifest === undefined) throw new Error('the release build has no manifest.json.');
  const parsed = JSON.parse(manifest.data.toString('utf8')) as unknown;
  if (!record(parsed)) throw new Error('manifest.json is not an object.');
  const data = Buffer.from(`${JSON.stringify(testManifest(parsed, role, version, sites), null, 2)}\n`);
  return files.map((file) => (file.name === 'manifest.json' ? { name: file.name, data } : file));
}

/** What sets a test build apart from the release build: [] — manifest.json alone, every other file byte for byte. */
export function differencesBeyondManifest(release: readonly ZipEntry[], test: readonly ZipEntry[]): string[] {
  const left = new Map(release.map((file) => [file.name, file.data]));
  const right = new Map(test.map((file) => [file.name, file.data]));
  const out: string[] = [];
  for (const [name, data] of left) {
    if (name === 'manifest.json') continue;
    const other = right.get(name);
    if (other === undefined) out.push(`${name}: missing from the test build`);
    else if (!other.equals(data)) out.push(`${name}: differs`);
  }
  for (const name of right.keys()) if (!left.has(name)) out.push(`${name}: only in the test build`);
  return out;
}

/** The unsigned XPI of a role, in the set's folder. */
export const testXpiName = (role: TestBuildRole, version: string): string => `chatgoose-p3b-${role}-${version}.xpi`;
/** The signed XPI of a role, in the set's `signed/` folder: one fixed name, so the harness's lines never change. */
export const signedTestXpiName = (role: TestBuildRole): string => `${role}.xpi`;

export interface TestBuild {
  readonly role: TestBuildRole;
  readonly version: string;
  /** The unpacked build (what `web-ext sign --source-dir` takes), relative to the set's folder. */
  readonly dir: string;
  readonly xpi: ArtifactRef;
}

/** `set.json` of a set: what it was made from and its three builds. */
export interface TestBuildSet {
  readonly schema: 1;
  /** The version of its N: the set's name and the word `sign --test-builds --confirm` takes. */
  readonly set: string;
  readonly geckoId: string;
  /** The commit the release build was made from; null — not a git checkout (a copy of the tree: a stand-in run only). */
  readonly commit: string | null;
  /** false — the tree had uncommitted changes: the builds are of no commit, and `sign` refuses them. */
  readonly clean: boolean;
  readonly createdAt: string;
  readonly base: { readonly version: string; readonly xpiSha256: string; readonly sourcesSha256: string };
  readonly builds: readonly TestBuild[];
}

/** A `set.json` read back: throws with every problem unless it is whole. */
export function parseTestBuildSet(text: string): TestBuildSet {
  const parsed = JSON.parse(text) as unknown;
  const problems: string[] = [];
  if (!record(parsed)) throw new Error('set.json: not an object.');
  if (parsed['schema'] !== 1) problems.push('schema: 1 expected');
  if (typeof parsed['set'] !== 'string') problems.push('set: missing');
  if (parsed['geckoId'] !== TEST_BUILDS_GECKO_ID) problems.push(`geckoId: ${TEST_BUILDS_GECKO_ID} expected`);
  if (parsed['commit'] !== null && (typeof parsed['commit'] !== 'string' || !/^[0-9a-f]{40}$/.test(parsed['commit']))) problems.push('commit: a full commit or null');
  if (typeof parsed['clean'] !== 'boolean') problems.push('clean: missing');
  const builds = Array.isArray(parsed['builds']) ? (parsed['builds'] as unknown[]) : [];
  const roles = builds.map((build) => (record(build) ? build['role'] : null));
  if (TEST_BUILD_ROLES.some((role) => !roles.includes(role)) || builds.length !== TEST_BUILD_ROLES.length) problems.push(`builds: exactly ${TEST_BUILD_ROLES.join(', ')}`);
  for (const build of builds) {
    if (!record(build) || typeof build['version'] !== 'string' || !TEST_VERSION_RE.test(build['version']) || typeof build['dir'] !== 'string' || build['dir'].includes('..') || !record(build['xpi'])) {
      problems.push('builds: a role, a test version, a folder and an XPI each');
    }
  }
  if (problems.length > 0) throw new Error(`set.json: ${problems.join('; ')}`);
  return parsed as unknown as TestBuildSet;
}

/**
 * What a build's OWN manifest says against what the set says it is — read before anything is sent to AMO, since a set
 * can be replaced consistently around another add-on: [] — the test add-on, a test version, the one set.json names, and
 * no update_url.
 */
export function testBuildIdentityProblems(manifest: unknown, build: Pick<TestBuild, 'role' | 'version'>): string[] {
  const { role } = build;
  if (!record(manifest)) return [`${role}: manifest.json is not an object`];
  const gecko = record(manifest['browser_specific_settings']) ? manifest['browser_specific_settings']['gecko'] : undefined;
  const id = record(gecko) ? gecko['id'] : undefined;
  const version = manifest['version'];
  const out: string[] = [];
  if (id !== TEST_BUILDS_GECKO_ID) out.push(`${role}: add-on id ${String(id)}, not ${TEST_BUILDS_GECKO_ID}`);
  if (typeof version !== 'string' || !TEST_VERSION_RE.test(version)) out.push(`${role}: version ${String(version)} is not a test version (four numbers)`);
  else if (version !== build.version) out.push(`${role}: version ${version}, set.json names ${build.version}`);
  if (record(gecko) && gecko['update_url'] !== undefined) out.push(`${role}: an update_url (${JSON.stringify(gecko['update_url'])}): a test build asks no feed`);
  return out;
}

/** Why a set cannot be signed: [] — it can. */
export function setSigningProblems(set: TestBuildSet): string[] {
  const out: string[] = [];
  if (set.commit === null) out.push('the set was made outside a git checkout: its builds are of no commit (good for an unsigned stand-in run only)');
  else if (!set.clean) out.push(`the set was made from ${set.commit.slice(0, 12)} with uncommitted changes (or the tree changed while it built): its builds are of no commit — commit, then pnpm release test-builds again`);
  return out;
}

/**
 * What Mozilla's reviewer reads with each test build: what it is, why it exists and how to rebuild it — the
 * release build of the commit, manifest.json rewritten by the release tool.
 */
export function testBuildNotes(input: { readonly set: TestBuildSet; readonly role: TestBuildRole; readonly nodeVersion: string; readonly pnpmVersion: string }): string {
  const { set, role } = input;
  const build = set.builds.find((item) => item.role === role);
  return [
    `A test build of ChatGoose for ChatSpace ${set.base.version} (commit ${set.commit ?? 'unknown'}), role «${role}», version ${build?.version ?? '?'}.`,
    '',
    'It exists for our release gate: automated checks of how Firefox treats a signed build on an update, a restart and an optional permission grant. It is never distributed: unlisted, no update_url, installed only in a throwaway headless profile.',
    '',
    'The code is the release build of that commit, unchanged. Only manifest.json differs: the add-on id (a separate test add-on), the version, the name, no update_url' +
      (role === 'control' ? ', and the optional sites’ origins moved into host_permissions (a control build).' : role === 'n0' ? ', and none of the optional sites’ permissions (the build before them).' : '.'),
    '',
    'To rebuild:',
    `1. Node ${input.nodeVersion} and pnpm ${input.pnpmVersion}; in the root of the source archive: pnpm install --frozen-lockfile`,
    '2. pnpm build — apps/extension/.output/firefox-mv3/ is the release build;',
    '3. pnpm release test-builds — the same build with manifest.json rewritten as above (tools/release/test-builds.ts).',
  ].join('\n');
}
