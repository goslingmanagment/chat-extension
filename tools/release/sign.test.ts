// The signing step against a LOCAL stand-in for AMO on 127.0.0.1 (the one
// `pnpm sign:dry-run` uses): the real `web-ext sign` runs, nothing is signed,
// nothing leaves the machine.

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { amoStepsMissing, startAmoMock, type AmoMock } from '../lib/amo-mock.ts';
import { UPLOAD_UUID_FILE } from '../lib/web-ext.ts';
import { writeZip } from '../lib/zip-write.ts';
import { readZip, type ZipEntry } from '../lib/zip.ts';
import { BUILD_INSTRUCTIONS, ENV, releaseTarget, REPO_ROOT } from './config.ts';
import { realExec, renderCommand, type Exec } from './exec.ts';
import type { GateRecord } from './records.ts';
import { amoMetadata, importSigned, releaseRecord, reviewerNotes, signBuild, signCommand, type SignInput } from './sign.ts';
import { isSigned, SIGNATURE_FILES } from './xpi.ts';

const ID = 'chat-extension-sign-test@example.test';
const VERSION = '0.1.0';
const NOTES = reviewerNotes({ version: VERSION, commit: 'd'.repeat(40), nodeVersion: '26', pnpmVersion: '10.33.1' });

let root = '';
let mock: AmoMock | null = null;

afterEach(async () => {
  await mock?.close();
  mock = null;
  if (root !== '') rmSync(root, { recursive: true, force: true });
});

function workspace(): { input: SignInput; buildFiles: ZipEntry[] } {
  root = mkdtempSync(join(tmpdir(), 'cg-release-sign-'));
  const buildFiles: ZipEntry[] = [
    { name: 'manifest.json', data: Buffer.from(JSON.stringify({ manifest_version: 3, name: 'sign test', version: VERSION, browser_specific_settings: { gecko: { id: ID } } })) },
    { name: 'background.js', data: Buffer.from('console.log("sign test")') },
  ];
  mkdirSync(join(root, 'build'));
  for (const file of buildFiles) writeFileSync(join(root, 'build', file.name), file.data);
  writeFileSync(join(root, 'sources.zip'), writeZip([{ name: 'README.md', data: Buffer.from('sources') }]));
  writeFileSync(join(root, 'amo-metadata.json'), amoMetadata(NOTES));
  return { input: { repoRoot: REPO_ROOT, buildDir: join(root, 'build'), sourcesZip: join(root, 'sources.zip'), artifactsDir: join(root, 'artifacts'), metadataPath: join(root, 'amo-metadata.json') }, buildFiles };
}

/** What AMO hands back: the uploaded files plus its signature. */
const signedBy = (files: readonly ZipEntry[]): Buffer => writeZip([...SIGNATURE_FILES.map((name) => ({ name, data: Buffer.from('signature') })), ...files]);

/** The command with throwaway credentials in the child's environment, output captured. */
const withKeys = (exec: Exec): Exec => (spec) => exec({ ...spec, inherit: false, env: { ...spec.env, [ENV.amoKey]: 'user:00000000:000', [ENV.amoSecret]: randomBytes(32).toString('hex') } });

describe('signing at AMO', () => {
  it('[UP-002] the command is web-ext sign, unlisted, with the sources archive and the reviewer notes — and carries no key', () => {
    const { input } = workspace();
    const command = signCommand(input);
    expect(command.program).toBe(`${REPO_ROOT}node_modules/.bin/web-ext`);
    expect(command.args.slice(0, 5)).toEqual(['sign', '--no-config-discovery', '--no-input', '--channel', 'unlisted']);
    expect(command.args).toEqual(expect.arrayContaining(['--source-dir', input.buildDir, '--upload-source-code', input.sourcesZip, '--amo-metadata', input.metadataPath, '--artifacts-dir', input.artifactsDir]));
    // The keys are read by web-ext from the environment: no argument names them, and the plan shows them by name only.
    expect(command.args.join(' ')).not.toMatch(/api-key|api-secret/);
    expect(command.secretEnv).toEqual(['WEB_EXT_API_KEY', 'WEB_EXT_API_SECRET']);
    expect(renderCommand(command)[0]).toContain('WEB_EXT_API_KEY=<from the environment> WEB_EXT_API_SECRET=<from the environment>');
    // Only the real AMO, or a loopback stand-in in tests.
    expect(command.args).not.toContain('--amo-base-url');
    expect(() => signCommand({ ...input, amoBaseUrl: 'https://amo.example.test/api/v5/' })).toThrow(/loopback stand-in/);
  });

  it('the notes tell a reviewer how to rebuild the XPI from the archive', () => {
    expect(NOTES).toContain(`built from commit ${'d'.repeat(40)}`);
    expect(NOTES).toContain('pnpm install --frozen-lockfile');
    expect(NOTES).toContain('3. pnpm build');
    expect(NOTES).toContain('apps/extension/.output/firefox-mv3/');
    expect(JSON.parse(amoMetadata(NOTES))).toEqual({ version: { approval_notes: NOTES } });
    // AMO takes a few thousand characters of notes.
    expect(NOTES.length).toBeLessThan(2000);
  });

  it('BUILD.md, which travels in the sources archive, names the Node and the pnpm this repository pins', () => {
    const build = readFileSync(join(REPO_ROOT, BUILD_INSTRUCTIONS), 'utf8');
    const node = readFileSync(join(REPO_ROOT, '.nvmrc'), 'utf8').trim();
    const pnpm = (JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as { packageManager: string }).packageManager.replace(/^pnpm@/, '');
    expect(build).toContain(`Node.js ${node} `);
    expect(build).toContain(`pnpm ${pnpm} `);
    expect(build).toContain(`npm install -g pnpm@${pnpm}`);
    expect(build).toContain('pnpm install --frozen-lockfile\npnpm build');
    expect(build).toContain('apps/extension/.output/firefox-mv3/');
    expect(build).toContain(releaseTarget().geckoId);
  });

  it('[UP-002] a whole run: upload, sources, notes, approval, download — and the signed XPI is the build, signed', async () => {
    const { input, buildFiles } = workspace();
    mock = await startAmoMock({ geckoId: ID, version: VERSION, signedXpi: signedBy(buildFiles) });
    // An upload id left in the build by an earlier dry run must not be reused.
    writeFileSync(join(input.buildDir, UPLOAD_UUID_FILE), JSON.stringify({ uploadUuid: 'stale', channel: 'unlisted', xpiCrcHash: 'x' }));

    const data = await signBuild(withKeys(realExec), { ...input, amoBaseUrl: mock.baseUrl }, { version: VERSION, geckoId: ID }, () => buildFiles);

    expect(isSigned(readZip(data))).toBe(true);
    expect(amoStepsMissing(mock, ID)).toEqual([]);
    expect(mock.seen.filter((request) => !request.path.startsWith('/files/')).every((request) => request.auth === 'JWT')).toBe(true);
    const created = mock.seen.find((request) => request.method === 'PUT');
    expect(JSON.parse(created?.json ?? '{}')).toMatchObject({ version: { upload: 'dry-run', approval_notes: NOTES } });
    // The build directory is left as it was built.
    expect(existsSync(join(input.buildDir, UPLOAD_UUID_FILE))).toBe(false);
    expect(readdirSync(input.buildDir).sort()).toEqual(['background.js', 'manifest.json']);
  });

  it('a signed file that is not the build is refused and left for a look', async () => {
    const { input, buildFiles } = workspace();
    const tampered = buildFiles.map((file) => (file.name === 'background.js' ? { ...file, data: Buffer.from('console.log("something else")') } : file));
    mock = await startAmoMock({ geckoId: ID, version: VERSION, signedXpi: signedBy(tampered) });
    await expect(signBuild(withKeys(realExec), { ...input, amoBaseUrl: mock.baseUrl }, { version: VERSION, geckoId: ID }, () => buildFiles)).rejects.toThrow(/not the build that passed the gate:\n {2}background\.js differs from the build/);
    expect(readdirSync(input.artifactsDir).filter((name) => name.endsWith('.xpi'))).toHaveLength(1);
  });

  it('a signed XPI downloaded by hand is taken on the same terms: the build, signed', () => {
    const { input, buildFiles } = workspace();
    const good = join(root, 'from-amo.xpi');
    writeFileSync(good, signedBy(buildFiles));
    expect(importSigned(good, { version: VERSION, geckoId: ID }, buildFiles).equals(signedBy(buildFiles))).toBe(true);
    const unsigned = join(root, 'unsigned.xpi');
    writeFileSync(unsigned, writeZip(buildFiles));
    expect(() => importSigned(unsigned, { version: VERSION, geckoId: ID }, buildFiles)).toThrow(/not signed: META-INF\/manifest\.mf is missing/);
    expect(() => importSigned(good, { version: '0.1.1', geckoId: ID }, buildFiles)).toThrow(/version 0\.1\.0, expected 0\.1\.1/);
    expect(() => importSigned(join(input.buildDir, 'manifest.json'), { version: VERSION, geckoId: ID }, buildFiles)).toThrow(/not a zip archive/);
  });

  it('a failed web-ext run stores nothing and does not leave its upload id behind', async () => {
    const { input, buildFiles } = workspace();
    const failing: Exec = () => {
      writeFileSync(join(input.buildDir, UPLOAD_UUID_FILE), '{}');
      return Promise.resolve({ code: 1, stdout: '', stderr: 'Validation failed' });
    };
    await expect(signBuild(failing, input, { version: VERSION, geckoId: ID }, () => buildFiles)).rejects.toThrow(/web-ext sign exited 1/);
    expect(existsSync(join(input.buildDir, UPLOAD_UUID_FILE))).toBe(false);
  });

  it('the record of a release ties the signed XPI to the commit, the build and the SDK the gate saw', () => {
    const gate: GateRecord = {
      schema: 1,
      version: VERSION,
      commit: 'd'.repeat(40),
      createdAt: '2026-10-05T11:00:00.000Z',
      online: true,
      checks: [{ id: 'check', ok: true, detail: 'green' }],
      build: { xpi: { file: 'a.zip', sha256: 'a'.repeat(64), bytes: 1 }, sources: { file: 'b.zip', sha256: 'b'.repeat(64), bytes: 2 } },
      vendor: { sdkContractHash: 'c'.repeat(64), sdkSourceCommit: 'e'.repeat(40), hotkeysSha256: 'f'.repeat(64) },
    };
    const target = releaseTarget();
    expect(releaseRecord({ target, gate, signedXpi: { file: 'chatgoose-chatspace-0.1.0.xpi', sha256: '9'.repeat(64), bytes: 3 }, signedAt: '2026-10-05T11:30:00.000Z' })).toEqual({
      schema: 1,
      version: VERSION,
      geckoId: target.geckoId,
      strictMinVersion: target.strictMinVersion,
      commit: gate.commit,
      signedAt: '2026-10-05T11:30:00.000Z',
      xpi: { file: 'chatgoose-chatspace-0.1.0.xpi', sha256: '9'.repeat(64), bytes: 3 },
      unsignedXpiSha256: 'a'.repeat(64),
      sourcesSha256: 'b'.repeat(64),
      vendor: gate.vendor,
    });
  });
});
