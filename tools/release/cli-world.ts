// For cli.test.ts: a throwaway checkout and a scripted world around it, so the
// whole release tool runs in a test — every command, through `runCli` — and
// nothing real is touched. The files of the checkout are real (the committed
// site, changelog and version; a small build; the records in .release/); git,
// pnpm, gh and web-ext answer from a script; the "server" is a folder of this
// machine that `scp` and `ssh … sh -s` are played into (the scripts themselves
// run for real) and that the scripted HTTP reads back; Telegram is a list of
// replies. Whatever the tool asks that the script does not know is an error.

import { cpSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { listTree } from '../lib/files.ts';
import { writeZip } from '../lib/zip-write.ts';
import type { ZipEntry } from '../lib/zip.ts';
import type { FetchLike } from './announce.ts';
import { runCli, type CliDeps } from './cli.ts';
import { CHANGELOG_FILE, ENV, HUB_HEALTH_PATH, noteFile, OPTIONAL_SITE_ORIGINS, releaseTarget, REPO_ROOT, signedXpiName, SITE_DIR, VERSION_FILE } from './config.ts';
import { realExec, type CommandResult, type CommandSpec, type Exec } from './exec.ts';
import { BEFORE_SIGNING, renderNote } from './note.ts';
import type { Http } from './publish.ts';
import type { ReleaseRecord } from './records.ts';
import { readPackageVersion } from './version.ts';
import { sha256Hex, SIGNATURE_FILES } from './xpi.ts';

export const VERSION = readPackageVersion(readFileSync(join(REPO_ROOT, VERSION_FILE), 'utf8'));
/** Commits of origin/main in these tests, oldest first. */
export const COMMIT_A = 'a'.repeat(40);
export const COMMIT_B = 'b'.repeat(40);
/** A commit that is on no branch of origin. */
export const COMMIT_ELSEWHERE = '9'.repeat(40);
export const SDK_HASH = 'c'.repeat(64);
const SDK_COMMIT = 'e'.repeat(40);
const HOTKEYS = 'f'.repeat(64);
export const BOT_TOKEN = '123456:synthetic-bot-token';

export const target = releaseTarget();

export interface World {
  // ── git ──
  head: string;
  branch: string;
  /** What `git status --porcelain` prints. */
  porcelain: string;
  /** origin/main, oldest first; the last one is its tip. */
  main: string[];
  localTags: Map<string, { commit: string; annotated: boolean }>;
  originTags: Set<string>;
  pushFails: boolean;
  /** No git at all: the checkout is a copy of the tree (the e2e image's); every git command fails to start. */
  noGit: boolean;
  // ── the gate ──
  checkExit: number;
  hubCompare: string | null;
  // ── public addresses ──
  /** null — the feed is what lies in the server folder (404 while nothing is published). */
  feed: { status: number; body: string } | null;
  health: { status: number; body: string };
  // ── AMO ──
  /** The exit code of `web-ext sign`; 0 leaves the signed XPI in the artifacts folder. */
  signExit: number;
  // ── Telegram: one reply per request ──
  telegram: Array<{ status: number; body: unknown } | Error>;
  now: Date;
}

export interface Harness {
  readonly root: string;
  /** The folder the "server" serves as the site. */
  readonly remoteDir: string;
  readonly world: World;
  readonly deps: CliDeps;
  /** Every program the tool started, as a command line. */
  readonly commands: string[];
  /** Every address it read over HTTP. */
  readonly requests: string[];
  /** Every request to Telegram. */
  readonly posts: Array<{ url: string; body: unknown }>;
  readonly out: string[];
  readonly err: string[];
  /** `pnpm release <argv>`; resolves with the exit code. */
  run(...argv: string[]): Promise<number>;
  /** The commands so far that leave the machine or write to git: origin, the server, AMO, GitHub, a tag. */
  outward(): string[];
  /** Forgets what was recorded so far (the world stays). */
  forget(): void;
  /** The signed XPI as AMO would hand it back for the build in the checkout. */
  signedXpi(): Buffer;
  /** Puts a signed XPI and its record into .release/, as `sign` leaves them. */
  seedSigned(commit: string): ReleaseRecord;
  path(relative: string): string;
  remote(relative: string): string;
  remove(): void;
}

const BUILD: readonly ZipEntry[] = [
  {
    name: 'manifest.json',
    data: Buffer.from(
      JSON.stringify({
        manifest_version: 3,
        name: 'ChatGoose для ChatSpace',
        version: VERSION,
        host_permissions: ['https://gosling-agency.ru/*'],
        optional_host_permissions: ['https://*/*', ...OPTIONAL_SITE_ORIGINS],
        optional_permissions: ['webRequest'],
        browser_specific_settings: { gecko: { id: target.geckoId, update_url: target.feedUrl } },
      }),
    ),
  },
  { name: 'background.js', data: Buffer.from('console.log(1)') },
];

const OUTWARD_RE = /^(?:git (?:fetch|ls-remote|push|tag )|ssh |scp |web-ext |gh )/;

export function makeHarness(): Harness {
  const root = mkdtempSync(join(tmpdir(), 'cg-release-cli-'));
  const remoteDir = join(root, 'www', 'chat-extension');
  const checkout = join(root, 'checkout');
  const put = (relative: string, data: string | Buffer): void => {
    mkdirSync(join(checkout, relative, '..'), { recursive: true });
    writeFileSync(join(checkout, relative), data);
  };
  for (const file of [VERSION_FILE, CHANGELOG_FILE]) put(file, readFileSync(join(REPO_ROOT, file)));
  cpSync(join(REPO_ROOT, SITE_DIR), join(checkout, SITE_DIR), { recursive: true });
  put(noteFile(VERSION), BEFORE_SIGNING.reduce((text, item) => text.replace(`- [ ] \`${item.id}\``, `- [x] \`${item.id}\``), renderNote(VERSION)));
  put('vendor/kernel-sdk/kernel-sdk.vendor.json', JSON.stringify({ contractHash: SDK_HASH, sourceCommit: SDK_COMMIT }));
  put('vendor/chatgoose-hotkeys/chatgoose-hotkeys.vendor.json', JSON.stringify({ sha256: HOTKEYS }));
  put('tests/vendor-pins.json', JSON.stringify({ kernelSdk: { contractHash: SDK_HASH, sourceCommit: SDK_COMMIT }, chatgooseHotkeys: { sha256: HOTKEYS } }));
  for (const file of BUILD) put(`apps/extension/.output/firefox-mv3/${file.name}`, file.data);
  put(`apps/extension/.output/chatgoose-chatspace-${VERSION}-firefox.zip`, writeZip(BUILD));
  put(`apps/extension/.output/chatgoose-chatspace-${VERSION}-sources.zip`, writeZip([{ name: 'package.json', data: Buffer.from('{}') }, { name: 'BUILD.md', data: Buffer.from('how to build') }]));

  const world: World = {
    head: COMMIT_A,
    branch: 'main',
    porcelain: '',
    main: [COMMIT_A],
    localTags: new Map(),
    originTags: new Set(),
    pushFails: false,
    noGit: false,
    checkExit: 0,
    hubCompare: 'ahead',
    feed: null,
    health: { status: 200, body: JSON.stringify({ status: 'ok', contractHash: SDK_HASH, compatibleClientSdks: [SDK_HASH] }) },
    signExit: 0,
    telegram: [],
    now: new Date('2026-10-05T11:00:00.000Z'),
  };

  const commands: string[] = [];
  const requests: string[] = [];
  const posts: Array<{ url: string; body: unknown }> = [];
  const out: string[] = [];
  const err: string[] = [];
  const answer = (stdout = '', code = 0, stderr = ''): CommandResult => ({ code, stdout, stderr });
  const signedXpi = (): Buffer => writeZip([...SIGNATURE_FILES.map((name) => ({ name, data: Buffer.from('signature') })), ...BUILD]);
  const signedFolder = (dir: string): Buffer =>
    writeZip([...SIGNATURE_FILES.map((name) => ({ name, data: Buffer.from('signature') })), ...listTree(dir).map((name) => ({ name, data: readFileSync(join(dir, name)) }))]);

  const commit = (name: string): string => (name === 'HEAD' ? world.head : name === 'origin/main' ? (world.main.at(-1) ?? '') : name);
  function git(args: readonly string[]): CommandResult {
    const line = args.join(' ');
    if (line === 'rev-parse HEAD') return answer(`${world.head}\n`);
    if (line === 'rev-parse --abbrev-ref HEAD') return answer(`${world.branch}\n`);
    if (line === 'status --porcelain') return answer(world.porcelain);
    if (/^fetch origin main( --tags)? --quiet$/.test(line)) return answer();
    if (line === 'rev-parse origin/main') return answer(`${world.main.at(-1) ?? ''}\n`);
    const verify = /^rev-parse (?:-q --verify )?refs\/tags\/(v[0-9.]+)(\^\{commit\})?$/.exec(line);
    if (verify !== null) {
      const tag = world.localTags.get(verify[1] ?? '');
      return tag === undefined ? answer('', 1) : answer(`${tag.commit}\n`);
    }
    const kind = /^cat-file -t refs\/tags\/(v[0-9.]+)$/.exec(line);
    if (kind !== null) {
      const tag = world.localTags.get(kind[1] ?? '');
      return tag === undefined ? answer('', 128, 'fatal: Not a valid object name') : answer(tag.annotated ? 'tag\n' : 'commit\n');
    }
    const remote = /^ls-remote --tags origin refs\/tags\/(v[0-9.]+)$/.exec(line);
    if (remote !== null) return answer(world.originTags.has(remote[1] ?? '') ? `${COMMIT_A}\trefs/tags/${remote[1]}\n` : '');
    const ancestor = /^merge-base --is-ancestor (\S+) (\S+)$/.exec(line);
    if (ancestor !== null) {
      const older = world.main.indexOf(commit(ancestor[1] ?? ''));
      const newer = world.main.indexOf(commit(ancestor[2] ?? ''));
      return answer('', commit(ancestor[1] ?? '') === commit(ancestor[2] ?? '') || (older !== -1 && newer !== -1 && older <= newer) ? 0 : 1);
    }
    if (args[0] === 'tag' && args[1] === '-a') {
      const name = args[2] ?? '';
      if (world.localTags.has(name)) return answer('', 128, `fatal: tag '${name}' already exists`);
      world.localTags.set(name, { commit: args.at(-1) ?? '', annotated: true });
      return answer();
    }
    const push = /^push origin (v[0-9.]+)$/.exec(line);
    if (push !== null) {
      if (world.pushFails) return answer('', 128, 'fatal: unable to access the remote: Could not resolve host');
      world.originTags.add(push[1] ?? '');
      return answer();
    }
    throw new Error(`unexpected command: git ${line}`);
  }

  const exec: Exec = (spec: CommandSpec) => {
    const program = spec.program.endsWith('/node_modules/.bin/web-ext') ? 'web-ext' : spec.program;
    const line = [program, ...spec.args].join(' ');
    commands.push(line);
    if (program === 'git') return world.noGit ? Promise.reject(new Error('git: spawn git ENOENT')) : Promise.resolve(git(spec.args));
    if (program === 'gh' && spec.args[0] === 'api') return Promise.resolve(world.hubCompare === null ? answer('', 1, 'gh: Not Found (HTTP 404)') : answer(`${world.hubCompare}\n`));
    if (line === 'pnpm --version') return Promise.resolve(answer('10.33.1\n'));
    if (line === 'pnpm check') return Promise.resolve(answer('', world.checkExit));
    if (line === 'pnpm install --frozen-lockfile --offline') return Promise.resolve(answer());
    if (line === 'pnpm build') {
      // The rebuild in the unpacked sources archive: the same extension again.
      if (spec.cwd !== undefined && !spec.cwd.startsWith(checkout)) {
        mkdirSync(join(spec.cwd, 'apps/extension/.output/firefox-mv3'), { recursive: true });
        for (const file of BUILD) writeFileSync(join(spec.cwd, 'apps/extension/.output/firefox-mv3', file.name), file.data);
      }
      return Promise.resolve(answer());
    }
    if (program === 'web-ext' && spec.args[0] === 'sign') {
      if (world.signExit === 0) {
        const dir = spec.args[spec.args.indexOf('--artifacts-dir') + 1] ?? '';
        const source = spec.args[spec.args.indexOf('--source-dir') + 1] ?? '';
        mkdirSync(dir, { recursive: true });
        // A P3b test build is signed as the folder it was given; the release — as the build of the checkout.
        const testBuild = source.includes(`${join('.release', 'test-builds')}`);
        writeFileSync(join(dir, 'signed.xpi'), testBuild ? signedFolder(source) : signedXpi());
      }
      return Promise.resolve(answer('', world.signExit));
    }
    if (program === 'scp') {
      const [local = '', destination = ''] = spec.args.slice(-2);
      try {
        copyFileSync(local, destination.slice(destination.indexOf(':') + 1));
        return Promise.resolve(answer());
      } catch (error) {
        return Promise.resolve(answer('', 1, error instanceof Error ? error.message : String(error)));
      }
    }
    // The script ssh would feed to `sh -s` on the server runs here, against the server folder.
    if (program === 'ssh' && spec.args.slice(-2).join(' ') === 'sh -s') return realExec({ program: 'sh', args: ['-s'], stdin: spec.stdin ?? '' });
    throw new Error(`unexpected command: ${line}`);
  };

  const http: Http = (url) => {
    requests.push(url);
    const reply = (status: number, body: string | Buffer): ReturnType<Http> => Promise.resolve({ status, body: Buffer.from(body) });
    if (url === `${target.hubOrigin}${HUB_HEALTH_PATH}`) return reply(world.health.status, world.health.body);
    if (url === target.feedUrl && world.feed !== null) return reply(world.feed.status, world.feed.body);
    if (url.startsWith(target.siteBase)) {
      const file = join(remoteDir, url.slice(target.siteBase.length));
      return existsSync(file) ? reply(200, readFileSync(file)) : reply(404, 'not found');
    }
    throw new Error(`unexpected request: ${url}`);
  };

  const fetchImpl: FetchLike = (url, init) => {
    posts.push({ url, body: JSON.parse(init.body) });
    const next = world.telegram.shift();
    if (next === undefined) throw new Error('no Telegram reply is scripted');
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve({ ok: next.status >= 200 && next.status < 300, status: next.status, json: () => (next.body === undefined ? Promise.reject(new Error('not JSON')) : Promise.resolve(next.body)) });
  };

  let nonce = 0;
  const deps: CliDeps = {
    root: checkout,
    exec,
    http,
    fetchImpl,
    env: {
      [ENV.ssh]: 'deploy@ext.example.test',
      [ENV.remoteDir]: remoteDir,
      [ENV.amoKey]: 'user:00000000:000',
      [ENV.amoSecret]: 'synthetic-amo-secret',
      [ENV.telegramToken]: BOT_TOKEN,
      [ENV.telegramChannel]: '-100200300',
    },
    print: (line) => out.push(line),
    printError: (line) => err.push(line),
    now: () => world.now,
    sleep: () => Promise.resolve(),
    nonce: () => `test${(nonce += 1)}`,
    target,
  };

  const releaseDir = join(checkout, '.release', VERSION);
  return {
    root: checkout,
    remoteDir,
    world,
    deps,
    commands,
    requests,
    posts,
    out,
    err,
    run: (...argv) => runCli(argv, deps),
    outward: () => commands.filter((line) => OUTWARD_RE.test(line)),
    forget: () => {
      for (const list of [commands, requests, posts, out, err]) list.length = 0;
    },
    signedXpi,
    seedSigned: (signedFrom) => {
      const xpi = signedXpi();
      const record: ReleaseRecord = {
        schema: 1,
        version: VERSION,
        geckoId: target.geckoId,
        strictMinVersion: target.strictMinVersion,
        commit: signedFrom,
        signedAt: '2026-10-05T11:30:00.000Z',
        xpi: { file: signedXpiName(VERSION), sha256: sha256Hex(xpi), bytes: xpi.length },
        unsignedXpiSha256: sha256Hex(writeZip(BUILD)),
        sourcesSha256: 'b'.repeat(64),
        vendor: { sdkContractHash: SDK_HASH, sdkSourceCommit: SDK_COMMIT, hotkeysSha256: HOTKEYS },
      };
      mkdirSync(releaseDir, { recursive: true });
      writeFileSync(join(releaseDir, signedXpiName(VERSION)), xpi);
      writeFileSync(join(releaseDir, `chatgoose-chatspace-${VERSION}.json`), `${JSON.stringify(record, null, 2)}\n`);
      return record;
    },
    path: (relative) => join(checkout, relative),
    remote: (relative) => join(remoteDir, relative),
    remove: () => rmSync(root, { recursive: true, force: true }),
  };
}
