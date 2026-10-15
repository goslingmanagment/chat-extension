// The P3b test builds (test-builds.ts): what sets them apart from the release
// build — the manifest alone — and the two commands, `test-builds` (local) and
// `sign --test-builds` (AMO, behind the owner's `--confirm`), through `runCli`
// in the scripted world of cli-world.ts. Nothing real is signed.

import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { baseManifest, GECKO_ID, UPDATE_URL } from '../../apps/extension/build/manifest.ts';
import { readZip, type ZipEntry } from '../lib/zip.ts';
import { COMMIT_A, makeHarness, VERSION, type Harness } from './cli-world.ts';
import { OPTIONAL_SITE_API, OPTIONAL_SITE_ORIGINS } from './config.ts';
import {
  deriveTestBuild,
  differencesBeyondManifest,
  parseTestBuildSet,
  setSigningProblems,
  TEST_BUILDS_GECKO_ID,
  testBuildVersions,
  testManifest,
  type TestBuildSet,
} from './test-builds.ts';
import { SIGNATURE_FILES } from './xpi.ts';

const SITES = { origins: OPTIONAL_SITE_ORIGINS, api: OPTIONAL_SITE_API };
/** The release manifest as the build makes it: the policy of build/manifest.ts plus what WXT adds. */
const releaseManifest = (): Record<string, unknown> => ({ manifest_version: 3, version: '0.2.4', ...structuredClone(baseManifest('release')) });
const gecko = (manifest: Record<string, unknown>): Record<string, unknown> => (manifest['browser_specific_settings'] as { gecko: Record<string, unknown> }).gecko;

describe('the versions of a set', () => {
  it('are the release version with a fourth part: the minute the set was made, then its role', () => {
    const versions = testBuildVersions('0.2.4', new Date('2026-10-15T05:30:45.000Z'));
    const minutes = (Date.UTC(2026, 9, 15, 5, 30) - Date.UTC(2026, 0, 1)) / 60_000;
    expect(versions).toEqual({ n0: `0.2.4.${minutes * 10}`, n: `0.2.4.${minutes * 10 + 1}`, n1: `0.2.4.${minutes * 10 + 2}`, control: `0.2.4.${minutes * 10 + 3}` });
    // Each part of a Firefox/AMO version: at most nine digits, no leading zero.
    for (const version of Object.values(versions)) expect(version).toMatch(/^(0|[1-9]\d{0,8})(\.(0|[1-9]\d{0,8})){3}$/);
  });

  it('of a later set are higher, so AMO never sees a version of the test add-on twice', () => {
    const earlier = testBuildVersions('0.2.4', new Date('2026-10-15T05:30:00.000Z'));
    const later = testBuildVersions('0.2.4', new Date('2026-10-15T05:31:00.000Z'));
    const fourth = (version: string): number => Number(version.split('.')[3]);
    expect(fourth(later.n0)).toBeGreaterThan(fourth(earlier.control));
    expect([earlier.n0, earlier.n, earlier.n1, earlier.control].map(fourth)).toEqual([...[earlier.n0, earlier.n, earlier.n1, earlier.control].map(fourth)].sort((a, b) => a - b));
  });

  it('need a release version X.Y.Z and a clock after 2026', () => {
    expect(() => testBuildVersions('0.2.4.1', new Date('2026-10-15T05:30:00.000Z'))).toThrow(/X\.Y\.Z/);
    expect(() => testBuildVersions('0.2.4', new Date('2025-12-31T23:00:00.000Z'))).toThrow(/before 2026/);
  });
});

describe('the manifest of a test build', () => {
  it('N and N+1: another add-on, no update_url, the version and a marked name — the permissions of the release', () => {
    const release = releaseManifest();
    const test = testManifest(release, 'n', '0.2.4.1', SITES);
    expect(gecko(test)).toEqual({ ...gecko(release), id: TEST_BUILDS_GECKO_ID, update_url: undefined });
    expect('update_url' in gecko(test)).toBe(false);
    expect(test['version']).toBe('0.2.4.1');
    expect(test['name']).toBe(`${String(release['name'])} (P3b)`);
    for (const key of ['permissions', 'host_permissions', 'optional_host_permissions', 'optional_permissions']) expect(test[key], key).toEqual(release[key]);
    // The release manifest itself is untouched.
    expect(gecko(release)['id']).toBe(GECKO_ID);
    expect(gecko(release)['update_url']).toBe(UPDATE_URL);
  });

  it('the control: the optional sites’ origins asked for at install instead', () => {
    const release = releaseManifest();
    const control = testManifest(release, 'control', '0.2.4.3', SITES);
    expect(OPTIONAL_SITE_ORIGINS).toEqual(['https://fansly.com/*', 'https://apiv3.fansly.com/*']);
    expect(control['host_permissions']).toEqual([...(release['host_permissions'] as string[]), ...OPTIONAL_SITE_ORIGINS]);
    expect(control['optional_host_permissions']).toEqual((release['optional_host_permissions'] as string[]).filter((origin) => !OPTIONAL_SITE_ORIGINS.includes(origin)));
    expect(control['optional_permissions']).toEqual(release['optional_permissions']);
  });

  it('N0: the build before the sites — none of their origins or API permissions, not even on request', () => {
    const release = releaseManifest();
    const n0 = testManifest(release, 'n0', '0.2.4.0', SITES);
    expect(OPTIONAL_SITE_API).toEqual(['webRequest']);
    expect(n0['optional_host_permissions']).toEqual((release['optional_host_permissions'] as string[]).filter((origin) => !OPTIONAL_SITE_ORIGINS.includes(origin)));
    expect('optional_permissions' in n0).toBe(false);
    expect(n0['host_permissions']).toEqual(release['host_permissions']);
    expect(gecko(n0)['id']).toBe(TEST_BUILDS_GECKO_ID);
  });

  it('is made only of a release build that asks for the sites on request', () => {
    const testFlavor = { ...structuredClone(baseManifest('test')), version: '0.2.4' } as Record<string, unknown>;
    expect(() => testManifest(testFlavor, 'n', '0.2.4.1', SITES)).toThrow(/not a release build/);
    const noSites = releaseManifest();
    noSites['optional_host_permissions'] = ['https://*/*'];
    expect(() => testManifest(noSites, 'n', '0.2.4.1', SITES)).toThrow(/optional sites/);
  });

  it('is the one file a test build changes: every other file is the release build’s, byte for byte', () => {
    const files: ZipEntry[] = [
      { name: 'manifest.json', data: Buffer.from(JSON.stringify(releaseManifest())) },
      { name: 'background.js', data: Buffer.from('console.log(1)') },
      { name: 'lazy/fansly/bridge-validation.js', data: Buffer.from('export {}') },
    ];
    for (const role of ['n0', 'n', 'n1', 'control'] as const) {
      const test = deriveTestBuild(files, role, `0.2.4.${role.length}`, SITES);
      expect(differencesBeyondManifest(files, test), role).toEqual([]);
      expect(test.find((file) => file.name === 'manifest.json')?.data.equals(files[0]?.data ?? Buffer.alloc(0)), role).toBe(false);
    }
    expect(differencesBeyondManifest(files, [...files.slice(0, 2), { name: 'lazy/fansly/bridge-validation.js', data: Buffer.from('changed') }])).toEqual(['lazy/fansly/bridge-validation.js: differs']);
  });
});

let harness: Harness | null = null;
afterEach(() => {
  harness?.remove();
  harness = null;
});
function world(): Harness {
  harness = makeHarness();
  return harness;
}

const setOf = (h: Harness): { readonly dir: string; readonly set: TestBuildSet } => {
  const root = h.path('.release/test-builds');
  const names = readdirSync(root);
  expect(names).toHaveLength(1);
  const dir = join(root, names[0] ?? '');
  return { dir, set: parseTestBuildSet(readFileSync(join(dir, 'set.json'), 'utf8')) };
};

const WEB_EXT_SIGN = /^web-ext sign /;

describe('pnpm release test-builds', () => {
  it('builds, then makes N, N+1 and the control of the release build under the test add-on — locally, nothing leaves', async () => {
    const h = world();
    expect(await h.run('test-builds'), h.err.join('\n')).toBe(0);
    expect(h.commands.filter((line) => line === 'pnpm build')).toHaveLength(1);
    expect(h.outward()).toEqual([]);
    const { dir, set } = setOf(h);
    expect(set).toMatchObject({ schema: 1, geckoId: TEST_BUILDS_GECKO_ID, commit: COMMIT_A, clean: true, base: { version: VERSION } });
    expect(set.set).toBe(set.builds.find((build) => build.role === 'n')?.version);
    expect(set.builds.map((build) => build.role)).toEqual(['n0', 'n', 'n1', 'control']);
    const release = ['manifest.json', 'background.js'].map((name) => ({ name, data: readFileSync(h.path(`apps/extension/.output/firefox-mv3/${name}`)) }));
    for (const build of set.builds) {
      const packed = readZip(readFileSync(join(dir, build.xpi.file)));
      expect(differencesBeyondManifest(release, packed), build.role).toEqual([]);
      const manifest = JSON.parse(packed.find((entry) => entry.name === 'manifest.json')?.data.toString('utf8') ?? '{}') as Record<string, unknown>;
      expect(manifest['version'], build.role).toBe(build.version);
      expect(gecko(manifest), build.role).toEqual({ id: TEST_BUILDS_GECKO_ID });
      // The unpacked folder is what AMO gets; it holds the XPI's files.
      expect(readFileSync(join(dir, build.dir, 'manifest.json')).equals(packed.find((entry) => entry.name === 'manifest.json')?.data ?? Buffer.alloc(0))).toBe(true);
    }
    expect(existsSync(join(dir, 'sources.zip'))).toBe(true);
    // The release's own records are not touched.
    expect(existsSync(h.path(`.release/${VERSION}`))).toBe(false);
    expect(h.out.join('\n')).toContain(`next: the owner signs — pnpm release sign --test-builds --confirm ${set.set}`);
    expect(h.out.join('\n')).toContain('CG_P3B_UNSIGNED=1 CG_P3B_XPI_N0=.release/test-builds/');
  });

  it('from a tree with changes or outside git: made (a stand-in run needs no commit), never signed', async () => {
    for (const setup of [(h: Harness) => void (h.world.porcelain = ' M apps/extension/src/x.ts\n'), (h: Harness) => void (h.world.noGit = true)]) {
      const h = world();
      setup(h);
      expect(await h.run('test-builds'), h.err.join('\n')).toBe(0);
      const { set } = setOf(h);
      expect(setSigningProblems(set)).toHaveLength(1);
      expect(h.out.join('\n')).not.toContain('next: the owner signs');
      h.forget();
      expect(await h.run('sign', '--test-builds', '--confirm', set.set)).toBe(2);
      expect(h.err.join('\n')).toMatch(/cannot sign the test builds/);
      expect(h.outward()).toEqual([]);
      harness?.remove();
    }
    harness = null;
  });
});

describe('pnpm release sign --test-builds', () => {
  async function made(): Promise<{ readonly h: Harness; readonly dir: string; readonly set: TestBuildSet }> {
    const h = world();
    expect(await h.run('test-builds'), h.err.join('\n')).toBe(0);
    h.forget();
    return { h, ...setOf(h) };
  }

  it('without the owner’s word only prints its plan: four unlisted signings of the test add-on, nothing sent, nothing written', async () => {
    const { h, dir, set } = await made();
    const before = readdirSync(dir).sort();
    for (const [flags, code] of [[[], 2], [['--dry-run'], 0], [['--confirm', VERSION], 2], [['--confirm', '9.9.9.9'], 2], [['--dry-run', '--confirm', set.set], 0]] as const) {
      h.forget();
      expect(await h.run('sign', '--test-builds', ...flags), flags.join(' ')).toBe(code);
      expect(h.outward(), flags.join(' ')).toEqual([]);
      expect(h.requests).toEqual([]);
      expect(readdirSync(dir).sort()).toEqual(before);
      const plan = h.out.join('\n');
      for (const build of set.builds) expect(plan).toContain(`--source-dir ${join(dir, build.dir)}`);
      expect(plan.match(/web-ext sign/g)).toHaveLength(4);
      expect(plan).toContain('--channel unlisted');
      expect(plan).toContain('WEB_EXT_API_SECRET=<from the environment>');
      expect(plan).not.toContain('synthetic-amo-secret');
      if (code === 2) expect(h.err.join('\n')).toMatch(/not run: .*--confirm/);
    }
  });

  it('with --confirm <N’s version> signs each build, checks it against its folder and stores it; the release is not touched', async () => {
    const { h, dir, set } = await made();
    expect(await h.run('sign', '--test-builds', '--confirm', set.set), h.err.join('\n')).toBe(0);
    const signings = h.outward().filter((line) => WEB_EXT_SIGN.test(line));
    expect(signings).toHaveLength(4);
    for (const build of set.builds) {
      const signed = readZip(readFileSync(join(dir, 'signed', `${build.role}.xpi`)));
      for (const name of SIGNATURE_FILES) expect(signed.some((entry) => entry.name === name), `${build.role} ${name}`).toBe(true);
      expect(signed.find((entry) => entry.name === 'manifest.json')?.data.toString('utf8')).toContain(build.version);
      expect(existsSync(join(dir, `web-ext-artifacts-${build.role}`))).toBe(false);
    }
    expect(existsSync(h.path(`.release/${VERSION}`))).toBe(false);
    const signed = (role: string): string => `.release/test-builds/${set.set}/signed/${role}.xpi`;
    expect(h.out.at(-1)).toBe(`the test builds ${set.set} are signed. The harness (docs/project-unite/spike.md «P3b: как прогнать»): CG_P3B_XPI_N0=${signed('n0')} CG_P3B_XPI_N=${signed('n')} CG_P3B_XPI_N1=${signed('n1')} CG_P3B_XPI_CONTROL=${signed('control')}`);

    // Once signed, nothing goes to AMO again; a build lost from signed/ is the only one sent again.
    h.forget();
    expect(await h.run('sign', '--test-builds', '--confirm', set.set)).toBe(0);
    expect(h.outward()).toEqual([]);
    rmSync(join(dir, 'signed', 'control.xpi'));
    h.forget();
    expect(await h.run('sign', '--test-builds', '--confirm', set.set)).toBe(0);
    expect(h.outward().filter((line) => WEB_EXT_SIGN.test(line))).toEqual([expect.stringContaining(`--source-dir ${join(dir, 'control')}`)]);

    h.forget();
    expect(await h.run('status')).toBe(0);
    expect(h.out.join('\n')).toContain(`test builds  ${set.set} (P3b) from ${COMMIT_A.slice(0, 12)}, signed: n0, n, n1, control`);
  });

  it('refuses a set whose files are not what set.json says, and stores nothing when AMO fails', async () => {
    const { h, dir, set } = await made();
    const n = set.builds.find((build) => build.role === 'n0');
    writeFileSync(join(dir, n?.dir ?? 'n0', 'background.js'), 'changed');
    expect(await h.run('sign', '--test-builds', '--confirm', set.set)).toBe(2);
    expect(h.err.join('\n')).toContain('the folder n0/ is not what');
    expect(h.outward()).toEqual([]);
    writeFileSync(join(dir, n?.dir ?? 'n0', 'background.js'), 'console.log(1)');

    h.forget();
    h.world.signExit = 1;
    expect(await h.run('sign', '--test-builds', '--confirm', set.set)).toBe(1);
    expect(h.outward().filter((line) => WEB_EXT_SIGN.test(line))).toHaveLength(1);
    expect(existsSync(join(dir, 'signed'))).toBe(false);
  });
});
