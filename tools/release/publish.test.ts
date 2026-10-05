// The server steps end to end, on this machine: the "server" is a temporary
// folder (the local transport runs the very scripts ssh would feed to `sh -s`),
// and a loopback HTTP server serves that folder the way the site is served —
// and stands in for the hub: its health document is a file of that folder too.
// Every address of the target is on 127.0.0.1; nothing here may reach a real one.

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { writeZip } from '../lib/zip-write.ts';
import { releaseTarget, type ReleaseTarget } from './config.ts';
import { realExec, runSteps, type Step } from './exec.ts';
import { parseFeed } from './feed.ts';
import { httpTimeoutSeconds, pagesOnlySteps, publishSteps, realHttp, rollbackSteps, servedFeed, type LocalFile, type PublishInput, type ServerDeps } from './publish.ts';
import type { ReleaseRecord } from './records.ts';
import { checkRemoteDir, checkSiteFolder, localTransport, replaceScript, sshTransport, type Transport } from './remote.ts';
import { sha256Hex, SIGNATURE_FILES } from './xpi.ts';

let root = '';
let server: Server;
let target: ReleaseTarget;
let remoteDir = '';
let nonce = 0;
const SDK_HASH = 'c'.repeat(64);

const local = (name: string): string => join(root, 'local', name);
const remote = (name: string): string => join(remoteDir, name);
const remoteText = (name: string): string => readFileSync(remote(name), 'utf8');

function deps(): ServerDeps {
  nonce += 1;
  return { exec: realExec, http: realHttp, transport: localTransport(), remoteDir, target, nonce: `test${nonce}`, sleep: () => Promise.resolve() };
}

function xpiBytes(version: string, options: { signed?: boolean; salt?: string } = {}): Buffer {
  const manifest = { manifest_version: 3, version, browser_specific_settings: { gecko: { id: target.geckoId } } };
  return writeZip([
    ...(options.signed === false ? [] : SIGNATURE_FILES.map((name) => ({ name, data: Buffer.from(`signature ${version}`) }))),
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest)) },
    { name: 'background.js', data: Buffer.from(`console.log(${JSON.stringify(`${version}${options.salt ?? ''}`)})`) },
  ]);
}

function release(version: string, options: { signed?: boolean; salt?: string; pages?: Record<string, string> } = {}): PublishInput {
  const dir = local(`release-${version}${options.salt ?? ''}`);
  mkdirSync(dir, { recursive: true });
  const xpi = xpiBytes(version, options);
  const record: ReleaseRecord = {
    schema: 1,
    version,
    geckoId: target.geckoId,
    strictMinVersion: target.strictMinVersion,
    commit: 'd'.repeat(40),
    signedAt: '2026-10-05T11:30:00.000Z',
    xpi: { file: `chatgoose-chatspace-${version}.xpi`, sha256: sha256Hex(xpi), bytes: xpi.length },
    unsignedXpiSha256: 'a'.repeat(64),
    sourcesSha256: 'b'.repeat(64),
    vendor: { sdkContractHash: SDK_HASH, sdkSourceCommit: 'e'.repeat(40), hotkeysSha256: 'f'.repeat(64) },
  };
  const recordText = `${JSON.stringify(record, null, 2)}\n`;
  writeFileSync(join(dir, record.xpi.file), xpi);
  writeFileSync(join(dir, 'record.json'), recordText);
  return {
    record,
    signedXpiPath: join(dir, record.xpi.file),
    recordPath: join(dir, 'record.json'),
    recordSha256: sha256Hex(recordText),
    localFeedPath: join(dir, 'updates.json'),
    pages: pages(options.pages ?? { 'index.html': `<h1>${version}</h1>`, 'site.css': 'body{}' }, dir),
  };
}

function pages(files: Record<string, string>, dir: string): LocalFile[] {
  return Object.entries(files).map(([name, text]) => {
    writeFileSync(join(dir, name), text);
    return { name, path: join(dir, name), sha256: sha256Hex(text) };
  });
}

const run = (steps: readonly Step[]): Promise<void> => runSteps(steps, { dryRun: false, print: () => undefined });
const servedVersion = async (): Promise<string | null> => (await servedFeed(deps()))?.version ?? null;
const leftovers = (): string[] => [...readdirSync(remoteDir), ...readdirSync(remote(target.feedDir))].filter((name) => name.includes('.upload-'));

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'cg-release-publish-'));
  server = createServer((request, response) => {
    const path = join(root, 'www', decodeURIComponent((request.url ?? '/').split('?')[0] ?? '/'));
    if (!path.startsWith(join(root, 'www')) || !existsSync(path) || path.endsWith('/')) {
      response.writeHead(404).end('not found');
      return;
    }
    response.writeHead(200).end(readFileSync(path));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  target = releaseTarget({ siteBase: `http://127.0.0.1:${port}/chat-extension/`, hubOrigin: `http://127.0.0.1:${port}` });
  for (const address of [target.siteBase, target.feedBase, target.feedUrl, target.hubOrigin]) expect(address).toMatch(/^http:\/\/127\.0\.0\.1:\d+(\/|$)/);
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(join(root, 'www'), { recursive: true, force: true });
  rmSync(join(root, 'local'), { recursive: true, force: true });
  remoteDir = join(root, 'www', 'chat-extension');
  mkdirSync(join(root, 'local'), { recursive: true });
  mkdirSync(join(root, 'www'), { recursive: true });
  hubHealth({ status: 'ok', contractHash: SDK_HASH, compatibleClientSdks: [SDK_HASH] });
});

/** What the stand-in hub answers at /api/v1/health; null — it is down. */
function hubHealth(body: unknown): void {
  rmSync(join(root, 'www', 'api'), { recursive: true, force: true });
  if (body === null) return;
  mkdirSync(join(root, 'www', 'api', 'v1'), { recursive: true });
  writeFileSync(join(root, 'www', 'api', 'v1', 'health'), JSON.stringify(body));
}

describe('publishing a release', () => {
  it('[UP-001] [UP-006] the first release: the XPI and its record under versioned names, then the feed, then the pages — and each is read back', async () => {
    expect(await servedVersion()).toBeNull();
    const input = release('0.1.0');
    await run(publishSteps(deps(), input));

    expect(readFileSync(remote('firefox/chatgoose-chatspace-0.1.0.xpi')).equals(readFileSync(input.signedXpiPath))).toBe(true);
    expect(JSON.parse(remoteText('firefox/chatgoose-chatspace-0.1.0.json'))).toEqual(input.record);
    expect(parseFeed(remoteText('firefox/updates.json'), target.geckoId)).toEqual({
      version: '0.1.0',
      updateLink: `${target.feedBase}chatgoose-chatspace-0.1.0.xpi`,
      sha256: input.record.xpi.sha256,
      strictMinVersion: target.strictMinVersion,
    });
    expect(remoteText('index.html')).toBe('<h1>0.1.0</h1>');
    expect(remoteText('site.css')).toBe('body{}');
    // What went up is also kept locally, and nothing temporary is left on the server.
    expect(readFileSync(input.localFeedPath, 'utf8')).toBe(remoteText('firefox/updates.json'));
    expect(existsSync(remote('firefox/updates.previous.json'))).toBe(false);
    expect(leftovers()).toEqual([]);
    expect(await servedVersion()).toBe('0.1.0');
  });

  it('a dry run prints the exact commands and scripts and touches nothing', async () => {
    const printed: string[] = [];
    await runSteps(publishSteps(deps(), release('0.1.0')), { dryRun: true, print: (line) => printed.push(line) });
    expect(existsSync(remoteDir)).toBe(false);
    const text = printed.join('\n');
    expect(text).toContain(`[dry-run] 1/9 Check that the production hub still takes the SDK of this release\n    GET ${target.hubOrigin}/api/v1/health — healthy, and compatibleClientSdks lists ${SDK_HASH}`);
    expect(text).toContain('[dry-run] 2/9 Check what the feed serves now');
    expect(text).toContain(`$ cp ${local('release-0.1.0/chatgoose-chatspace-0.1.0.xpi')} ${remote('firefox/.chatgoose-chatspace-0.1.0.xpi.upload-')}`);
    expect(text).toContain("$ sh -s <<'SCRIPT'");
    expect(text).toContain(`mv -f '${remote('firefox/.updates.json.upload-')}`);
    expect(text).toContain(`GET ${target.feedUrl} — must serve 0.1.0 → ${target.feedBase}chatgoose-chatspace-0.1.0.xpi`);
    expect(text).toContain(`GET ${target.siteBase}index.html — sha256 `);
    // What a failed step does about its own uploads is part of the plan.
    expect(text).toContain('if any of the above fails — remove what this run uploaded:');
    expect(text).toContain(`rm -f '${remote('firefox/.chatgoose-chatspace-0.1.0.xpi.upload-')}`);
    expect(text).toContain(`rm -f '${remote('firefox/.updates.json.upload-')}`);
    expect(text).toContain(`rm -f '${remote('.index.html.upload-')}`);
  });

  it('[UP-004] the hub is asked again on the day of the publication: one that no longer takes the SDK of the release, or is down, stops it before anything is uploaded', async () => {
    hubHealth({ status: 'ok', contractHash: 'd'.repeat(64), compatibleClientSdks: ['d'.repeat(64)] });
    await expect(run(publishSteps(deps(), release('0.1.0')))).rejects.toThrow(/is not in the hub's compatibleClientSdks[\s\S]*Nothing was uploaded: 0\.1\.0 was signed 2026-10-05T11:30:00\.000Z/);
    expect(existsSync(remoteDir)).toBe(false);
    hubHealth(null);
    await expect(run(publishSteps(deps(), release('0.1.0')))).rejects.toThrow(/the hub health answered HTTP 404/);
    expect(existsSync(remoteDir)).toBe(false);
  });

  it('a failed upload leaves no temporary file in the served folder: the feed damaged on its way up', async () => {
    await run(publishSteps(deps(), release('0.1.0')));
    const local_ = localTransport();
    const damaging: Transport = { ...local_, upload: (from, to) => (to.includes('updates.json') ? { program: 'sh', args: ['-c', 'echo damaged > "$1"', 'sh', to] } : local_.upload(from, to)) };
    await expect(run(publishSteps({ ...deps(), transport: damaging }, release('0.1.1')))).rejects.toThrow(/upload damaged/);
    expect(leftovers()).toEqual([]);
    // The XPI of 0.1.1 is in place, the feed is where it was: the run can simply be repeated.
    expect(await servedVersion()).toBe('0.1.0');
    await run(publishSteps(deps(), release('0.1.1')));
    expect(await servedVersion()).toBe('0.1.1');
    expect(leftovers()).toEqual([]);
  });

  it('… and a page that did not get there: the ones already uploaded are removed, the pages on the server stay whole', async () => {
    await run(publishSteps(deps(), release('0.1.0', { pages: { 'index.html': 'old index', 'start.html': 'old start', 'site.css': 'old css' } })));
    const input = release('0.1.1', { pages: { 'index.html': 'new index', 'start.html': 'new start', 'site.css': 'new css' } });
    rmSync(input.pages[1]?.path ?? '');
    await expect(run(publishSteps(deps(), input))).rejects.toThrow(/cp .*exited 1/);
    expect(leftovers()).toEqual([]);
    expect([remoteText('index.html'), remoteText('start.html'), remoteText('site.css')]).toEqual(['old index', 'old start', 'old css']);
  });

  it('the server-side script itself removes a damaged upload, also when the connection is gone before the tool can', async () => {
    mkdirSync(remoteDir, { recursive: true });
    writeFileSync(remote('.a.upload-x'), 'a');
    writeFileSync(remote('.b.upload-x'), 'damaged');
    const script = replaceScript([
      { tmp: remote('.a.upload-x'), final: remote('a'), sha256: sha256Hex('a') },
      { tmp: remote('.b.upload-x'), final: remote('b'), sha256: sha256Hex('b') },
    ]);
    expect(await realExec({ program: 'sh', args: ['-s'], stdin: script })).toMatchObject({ code: 3 });
    // Nothing was renamed, nothing temporary is left.
    expect(readdirSync(remoteDir)).toEqual([]);
  });

  it('the XPI that cannot be read back stops the run before the feed, and says that running it again is safe', async () => {
    await run(publishSteps(deps(), release('0.1.0')));
    const slow: ServerDeps = { ...deps(), http: (url) => (url.endsWith('-0.1.1.xpi') ? Promise.resolve({ status: 0, body: Buffer.alloc(0) }) : realHttp(url)), env: { CG_RELEASE_HTTP_TIMEOUT_S: '300' } };
    const input = release('0.1.1');
    await expect(run(publishSteps(slow, input))).rejects.toThrow(/chatgoose-chatspace-0\.1\.1\.xpi: HTTP no answer\nThe feed was not touched[\s\S]*Running the command again is safe[\s\S]*CG_RELEASE_HTTP_TIMEOUT_S=<seconds> \(now 300\)/);
    expect(await servedVersion()).toBe('0.1.0');
    await run(publishSteps(deps(), input));
    expect(await servedVersion()).toBe('0.1.1');
  });

  it('how long one read may take comes from the environment: whole seconds, 120 unless said', () => {
    expect(httpTimeoutSeconds({})).toBe(120);
    expect(httpTimeoutSeconds({ CG_RELEASE_HTTP_TIMEOUT_S: '' })).toBe(120);
    expect(httpTimeoutSeconds({ CG_RELEASE_HTTP_TIMEOUT_S: '600' })).toBe(600);
    for (const bad of ['abc', '1.5', '0', '4', '99999', '-30', '60s']) expect(() => httpTimeoutSeconds({ CG_RELEASE_HTTP_TIMEOUT_S: bad }), bad).toThrow(/whole seconds from 5 to 3600/);
  });

  it('the next release replaces the feed by one rename and keeps the feed before it', async () => {
    await run(publishSteps(deps(), release('0.1.0')));
    const before = remoteText('firefox/updates.json');
    await run(publishSteps(deps(), release('0.1.1')));
    expect(await servedVersion()).toBe('0.1.1');
    expect(remoteText('firefox/updates.previous.json')).toBe(before);
    expect(remoteText('index.html')).toBe('<h1>0.1.1</h1>');
    // The earlier XPI stays: a rollback needs it.
    expect(existsSync(remote('firefox/chatgoose-chatspace-0.1.0.xpi'))).toBe(true);
    expect(leftovers()).toEqual([]);
  });

  it('a repeated run of the same release (a lost answer) is a no-op that ends green', async () => {
    await run(publishSteps(deps(), release('0.1.0')));
    const before = remoteText('firefox/updates.json');
    const input = release('0.1.1');
    await run(publishSteps(deps(), input));
    const feed = remoteText('firefox/updates.json');
    await run(publishSteps(deps(), input));
    expect(remoteText('firefox/updates.json')).toBe(feed);
    // The feed kept as «the one before» is still the one before, not a copy of the current.
    expect(remoteText('firefox/updates.previous.json')).toBe(before);
    expect(leftovers()).toEqual([]);
  });

  it('[UP-003] never a downgrade and never a second file under a published version', async () => {
    await run(publishSteps(deps(), release('0.1.1')));
    await expect(run(publishSteps(deps(), release('0.1.0')))).rejects.toThrow(/already serves 0\.1\.1; 0\.1\.0 would be a downgrade/);
    await expect(run(publishSteps(deps(), release('0.1.1', { salt: '-again' })))).rejects.toThrow(/never published twice/);
    expect(await servedVersion()).toBe('0.1.1');
    expect(existsSync(remote('firefox/chatgoose-chatspace-0.1.0.xpi'))).toBe(false);
  });

  it('the server itself refuses to replace a published XPI, and the feed stays where it was', async () => {
    await run(publishSteps(deps(), release('0.1.0')));
    // A file of the next version got to the server some other way.
    writeFileSync(remote('firefox/chatgoose-chatspace-0.1.1.xpi'), 'something else');
    await expect(run(publishSteps(deps(), release('0.1.1')))).rejects.toThrow(/refusing: .*chatgoose-chatspace-0\.1\.1\.xpi is already published with other bytes/);
    expect(remoteText('firefox/chatgoose-chatspace-0.1.1.xpi')).toBe('something else');
    expect(await servedVersion()).toBe('0.1.0');
    expect(leftovers()).toEqual([]);
  });

  it('[UP-002] an XPI that is served unsigned stops the publication before the feed moves', async () => {
    await run(publishSteps(deps(), release('0.1.0')));
    await expect(run(publishSteps(deps(), release('0.1.1', { signed: false })))).rejects.toThrow(/chatgoose-chatspace-0\.1\.1\.xpi: carries no Mozilla signature/);
    expect(await servedVersion()).toBe('0.1.0');
    expect(remoteText('index.html')).toBe('<h1>0.1.0</h1>');
  });

  it('[UP-006] the pages alone: the given files are replaced, the feed and the XPIs are not touched', async () => {
    await run(publishSteps(deps(), release('0.1.0', { pages: { 'index.html': 'old index', 'start.html': 'old start', 'site.css': 'old css' } })));
    const feed = remoteText('firefox/updates.json');
    const dir = local('pages');
    mkdirSync(dir, { recursive: true });
    await run(pagesOnlySteps(deps(), pages({ 'start.html': 'new start', 'site.css': 'new css' }, dir)));
    expect([remoteText('index.html'), remoteText('start.html'), remoteText('site.css')]).toEqual(['old index', 'new start', 'new css']);
    expect(remoteText('firefox/updates.json')).toBe(feed);
    expect(leftovers()).toEqual([]);
  });
});

describe('pages ahead of a release', () => {
  it('the stylesheet goes up only when the site has none; one that is there draws the released pages and is left as it is', async () => {
    const dir = local('ahead');
    mkdirSync(dir, { recursive: true });
    const said: string[] = [];
    const ahead = (css: string, start: string): Promise<void> => {
      const [sheet] = pages({ 'site.css': css }, dir);
      return run(pagesOnlySteps({ ...deps(), say: (line) => said.push(line) }, pages({ 'start.html': start }, dir), sheet === undefined ? {} : { stylesheetIfAbsent: sheet }));
    };
    // The very first publication: no stylesheet on the server yet.
    await ahead('first css', 'start 1');
    expect([remoteText('site.css'), remoteText('start.html')]).toEqual(['first css', 'start 1']);
    // The same stylesheet again: nothing to do, nothing to say.
    await ahead('first css', 'start 2');
    expect(said).toEqual([]);
    // The tree's stylesheet has changed since: the page goes out, the stylesheet does not.
    await ahead('restyled', 'start 3');
    expect([remoteText('site.css'), remoteText('start.html')]).toEqual(['first css', 'start 3']);
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/NOT replaced: site\.css on the server differs from the one in the tree/);
    expect(leftovers()).toEqual([]);
  });

  it('the plan says in words that the stylesheet is not replaced', async () => {
    const dir = local('ahead-plan');
    mkdirSync(dir, { recursive: true });
    const printed: string[] = [];
    const [sheet] = pages({ 'site.css': 'css' }, dir);
    await runSteps(pagesOnlySteps(deps(), pages({ 'start.html': 'start' }, dir), sheet === undefined ? {} : { stylesheetIfAbsent: sheet }), { dryRun: true, print: (line) => printed.push(line) });
    expect(printed.join('\n')).toContain('[dry-run] 2/4 Put site.css in place only if the site has none yet\n    site.css on the server draws the pages of the released version: one that is there is NOT replaced');
    expect(existsSync(remoteDir)).toBe(false);
  });
});

describe('rolling the feed back', () => {
  it('points the feed at the earlier version from its record on the server; the newer files stay', async () => {
    const first = release('0.1.0');
    await run(publishSteps(deps(), first));
    await run(publishSteps(deps(), release('0.1.1')));
    const newer = remoteText('firefox/updates.json');

    await run(rollbackSteps(deps(), { to: '0.1.0', localFeedPath: local('rollback/updates.json') }));
    expect(parseFeed(remoteText('firefox/updates.json'), target.geckoId)).toMatchObject({ version: '0.1.0', sha256: first.record.xpi.sha256 });
    expect(remoteText('firefox/updates.previous.json')).toBe(newer);
    expect(existsSync(remote('firefox/chatgoose-chatspace-0.1.1.xpi'))).toBe(true);
    expect(leftovers()).toEqual([]);

    // Going forward again is a publication, and the feed now allows it.
    await run(publishSteps(deps(), release('0.1.2')));
    expect(await servedVersion()).toBe('0.1.2');
  });

  it('refuses when there is nothing earlier to go back to, or no record, or the XPI on the server is not the recorded one', async () => {
    await expect(run(rollbackSteps(deps(), { to: '0.1.0', localFeedPath: local('r/updates.json') }))).rejects.toThrow(/no feed is published/);
    await run(publishSteps(deps(), release('0.1.0')));
    await run(publishSteps(deps(), release('0.1.2')));
    await expect(run(rollbackSteps(deps(), { to: '0.1.2', localFeedPath: local('r/updates.json') }))).rejects.toThrow(/0\.1\.2 is not an earlier version/);
    await expect(run(rollbackSteps(deps(), { to: '0.1.1', localFeedPath: local('r/updates.json') }))).rejects.toThrow(/chatgoose-chatspace-0\.1\.1\.json answered HTTP 404/);
    writeFileSync(remote('firefox/chatgoose-chatspace-0.1.0.xpi'), xpiBytes('0.1.0', { salt: '-swapped' }));
    await expect(run(rollbackSteps(deps(), { to: '0.1.0', localFeedPath: local('r/updates.json') }))).rejects.toThrow(/serves sha256 .* expected/);
    expect(await servedVersion()).toBe('0.1.2');
  });
});

describe('where the server is', () => {
  it('an SSH destination and a server folder are plain names: nothing that could turn into an option or leave the folder', () => {
    expect(sshTransport('deploy@ext.example.test').upload('/tmp/a.xpi', '/var/www/x/a.xpi')).toEqual({
      program: 'scp',
      args: ['-q', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '/tmp/a.xpi', 'deploy@ext.example.test:/var/www/x/a.xpi'],
    });
    expect(sshTransport('ext-server').shell('set -eu\n')).toEqual({ program: 'ssh', args: ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', 'ext-server', 'sh', '-s'], stdin: 'set -eu\n' });
    for (const bad of ['-oProxyCommand=evil', 'host; rm -rf /', 'user@host path', '']) expect(() => sshTransport(bad), bad).toThrow(/not an SSH destination/);
    expect(checkRemoteDir('/var/www/ext/chat-extension/')).toBe('/var/www/ext/chat-extension');
    for (const bad of ['relative/path', '/var/www/../etc', '/var/www/my site', '/', '/var/www/$(id)', "/var/www/a'b"]) expect(() => checkRemoteDir(bad), bad).toThrow(/not a usable server folder/);
  });

  it('the server folder is the site’s own folder by name: a path one level short would overwrite the old extension’s page and feed', () => {
    const site = 'https://ext.example.test/chat-extension/';
    expect(checkSiteFolder('/var/www/ext/chat-extension', site)).toBe('/var/www/ext/chat-extension');
    expect(checkSiteFolder('/srv/site/chat-extension/', site)).toBe('/srv/site/chat-extension');
    for (const bad of ['/var/www/ext', '/var/www/ext/chat-extension/firefox', '/var/www/ext/chat-extension-old']) expect(() => checkSiteFolder(bad, site), bad).toThrow(/its last part must be «chat-extension»/);
    expect(() => checkSiteFolder('relative', site)).toThrow(/not a usable server folder/);
  });
});
