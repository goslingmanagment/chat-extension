// `pnpm sign:dry-run` (spike M0, check 1 «пробная подпись»): runs the real
// `web-ext sign --channel unlisted --upload-source-code …` on the current Node
// against a LOCAL mock of the AMO submission API on 127.0.0.1 — never
// addons.mozilla.org, no keys (throwaway JWT credentials), nothing is signed.
// Proves the signing toolchain works end to end on Node 26: JWT auth, XPI
// upload, validation poll, version creation, sources upload, approval poll,
// download of the "signed" file. Real AMO acceptance stays with R19.
// Needs a release build (`pnpm build`).

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { builtArtifacts, type BuiltArtifacts } from '../lib/artifacts.ts';
import { fail, REPO_ROOT } from '../lib/paths.ts';

interface SeenRequest {
  readonly method: string;
  readonly path: string;
  readonly auth: string;
  readonly contentType: string;
  readonly bytes: number;
}

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
const addonPath = `/api/v5/addons/addon/${geckoId}/`;
const signedName = `signed-${built.version}.xpi`;
const xpi = readFileSync(built.xpi);
const seen: SeenRequest[] = [];

function reply(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

const server = createServer((request: IncomingMessage, response: ServerResponse) => {
  const chunks: Buffer[] = [];
  request.on('data', (chunk: Buffer) => chunks.push(chunk));
  request.on('end', () => {
    const path = decodeURIComponent(request.url ?? '');
    const method = request.method ?? '';
    const auth = (request.headers.authorization ?? '').split(' ')[0] ?? '';
    seen.push({ method, path, auth, contentType: (request.headers['content-type'] ?? '').split(';')[0] ?? '', bytes: Buffer.concat(chunks).length });
    const origin = `http://127.0.0.1:${port()}`;
    if (method === 'POST' && path === '/api/v5/addons/upload/') return reply(response, 201, { uuid: 'dry-run', processed: false });
    if (method === 'GET' && path === '/api/v5/addons/upload/dry-run/') return reply(response, 200, { uuid: 'dry-run', processed: true, valid: true, validation: {} });
    if (method === 'PUT' && path === addonPath) return reply(response, 200, { guid: geckoId, version: { id: 7, edit_url: `${origin}/edit` } });
    if (method === 'PATCH' && path === `${addonPath}versions/7/`) return reply(response, 200, {});
    if (method === 'GET' && path === `${addonPath}versions/7/`) return reply(response, 200, { file: { status: 'public', url: `${origin}/files/${signedName}` } });
    if (method === 'GET' && path === `/files/${signedName}`) {
      response.writeHead(200, { 'content-type': 'application/x-xpinstall' }).end(xpi);
      return;
    }
    reply(response, 404, { detail: 'not mocked' });
  });
});

function port(): number {
  const address = server.address();
  return typeof address === 'object' && address !== null ? address.port : 0;
}

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
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
  `http://127.0.0.1:${port()}/api/v5/`,
  '--api-key',
  'user:00000000:000',
  '--api-secret',
  randomBytes(32).toString('hex'),
  '--artifacts-dir',
  artifactsDir,
  '--timeout',
  '60000',
];

const exitCode = await new Promise<number>((resolve) => {
  const child = spawn(webExt, args, { cwd: REPO_ROOT, stdio: 'inherit', env: { ...process.env, NO_UPDATE_NOTIFIER: '1' } });
  child.on('exit', (code) => resolve(code ?? 1));
});
server.close();

const signedPath = join(artifactsDir, signedName);
const downloaded = existsSync(signedPath) ? readFileSync(signedPath) : null;
rmSync(artifactsDir, { recursive: true, force: true });

const steps: Array<[string, (request: SeenRequest) => boolean]> = [
  ['XPI upload (multipart, JWT)', (r) => r.method === 'POST' && r.path === '/api/v5/addons/upload/' && r.contentType === 'multipart/form-data' && r.bytes > 0],
  ['validation poll', (r) => r.method === 'GET' && r.path === '/api/v5/addons/upload/dry-run/'],
  ['version creation', (r) => r.method === 'PUT' && r.path === addonPath],
  ['sources upload (multipart)', (r) => r.method === 'PATCH' && r.contentType === 'multipart/form-data' && r.bytes > 0],
  ['approval poll', (r) => r.method === 'GET' && r.path.endsWith('/versions/7/')],
  ['signed file download', (r) => r.method === 'GET' && r.path === `/files/${signedName}`],
];
const missing = steps.filter(([, test]) => !seen.some(test)).map(([label]) => label);
const unauthenticated = seen.filter((request) => !request.path.startsWith('/files/') && request.auth !== 'JWT');

console.log(`sign-dry-run: Node ${process.version}, web-ext exit ${exitCode}, ${seen.length} request(s) to the local mock:`);
for (const request of seen) console.log(`  ${request.method.padEnd(5)} ${request.path}  ${request.auth || '-'}  ${request.contentType || '-'}  ${request.bytes} B`);
if (exitCode !== 0) fail('sign-dry-run: web-ext sign failed.');
if (missing.length > 0) fail(`sign-dry-run: steps never reached: ${missing.join(', ')}.`);
if (unauthenticated.length > 0) fail('sign-dry-run: API requests without a JWT.');
if (!downloaded?.equals(xpi)) fail('sign-dry-run: the downloaded file is not the served XPI.');
console.log(`sign-dry-run: ok — upload → validation → version → sources → approval → ${signedName} downloaded (mock AMO, nothing signed).`);
