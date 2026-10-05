// `pnpm sign:dry-run` (spike M0, check 1 «пробная подпись»): runs the real
// `web-ext sign --channel unlisted --upload-source-code …` on the current Node
// against a LOCAL mock of the AMO submission API on 127.0.0.1 — never
// addons.mozilla.org, no keys (throwaway JWT credentials), nothing is signed.
// Proves the signing toolchain works end to end on Node 26: JWT auth, XPI
// upload, validation poll, version creation, sources upload, approval poll,
// download of the "signed" file. The real signing step is `pnpm release sign`
// (tools/release, docs/release.md). Needs a release build (`pnpm build`).

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { amoStepsMissing, startAmoMock } from '../lib/amo-mock.ts';
import { builtArtifacts, type BuiltArtifacts } from '../lib/artifacts.ts';
import { fail, REPO_ROOT } from '../lib/paths.ts';
import { dropUploadUuid } from '../lib/web-ext.ts';

function pickArtifacts(): BuiltArtifacts & { readonly sources: string } {
  try {
    const built = builtArtifacts('release');
    if (built.sources === null) fail('sign-dry-run: the release build has no sources archive.');
    return { ...built, sources: built.sources };
  } catch (error) {
    fail(`sign-dry-run: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const built = pickArtifacts();
const manifest = JSON.parse(readFileSync(join(built.dir, 'manifest.json'), 'utf8')) as {
  browser_specific_settings: { gecko: { id: string } };
};
const geckoId = manifest.browser_specific_settings.gecko.id;
const xpi = readFileSync(built.xpi);
const mock = await startAmoMock({ geckoId, version: built.version, signedXpi: xpi });

const artifactsDir = mkdtempSync(join(tmpdir(), 'cg-sign-dry-run-'));
const webExt = `${REPO_ROOT}node_modules/.bin/web-ext`;
const args = [
  'sign',
  '--no-config-discovery',
  '--source-dir',
  built.dir,
  '--channel',
  'unlisted',
  '--upload-source-code',
  built.sources,
  '--amo-base-url',
  mock.baseUrl,
  '--api-key',
  'user:00000000:000',
  '--api-secret',
  randomBytes(32).toString('hex'),
  '--artifacts-dir',
  artifactsDir,
  '--timeout',
  '60000',
];

dropUploadUuid(built.dir);
const exitCode = await new Promise<number>((resolve) => {
  const child = spawn(webExt, args, { cwd: REPO_ROOT, stdio: 'inherit', env: { ...process.env, NO_UPDATE_NOTIFIER: '1' } });
  child.on('exit', (code) => resolve(code ?? 1));
});
// The id of the mock upload must not stay in the build: a real signing run would reuse it (lib/web-ext.ts).
dropUploadUuid(built.dir);
await mock.close();

const signedPath = join(artifactsDir, mock.signedName);
const downloaded = existsSync(signedPath) ? readFileSync(signedPath) : null;
rmSync(artifactsDir, { recursive: true, force: true });

const missing = amoStepsMissing(mock, geckoId);
const unauthenticated = mock.seen.filter((request) => !request.path.startsWith('/files/') && request.auth !== 'JWT');

console.log(`sign-dry-run: Node ${process.version}, web-ext exit ${exitCode}, ${mock.seen.length} request(s) to the local mock:`);
for (const request of mock.seen) console.log(`  ${request.method.padEnd(5)} ${request.path}  ${request.auth || '-'}  ${request.contentType || '-'}  ${request.bytes} B`);
if (exitCode !== 0) fail('sign-dry-run: web-ext sign failed.');
if (missing.length > 0) fail(`sign-dry-run: steps never reached: ${missing.join(', ')}.`);
if (unauthenticated.length > 0) fail('sign-dry-run: API requests without a JWT.');
if (!downloaded?.equals(xpi)) fail('sign-dry-run: the downloaded file is not the served XPI.');
console.log(`sign-dry-run: ok — upload → validation → version → sources → approval → ${mock.signedName} downloaded (mock AMO, nothing signed).`);
