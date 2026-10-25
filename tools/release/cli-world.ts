// For cli.test.ts: a throwaway checkout and a scripted world around it, so the
// whole release tool runs in a test — every command, through `runCli` — and
// nothing real is touched. The files of the checkout are real (the committed
// site, changelog and version; a small build that `pnpm build` remakes for the
// version in package.json; the records in .release/); git, pnpm, gh and web-ext
// answer from a script; the "server" is a folder of this machine that `scp` and
// `ssh … sh -s` are played into (the scripts themselves run for real) and that
// the scripted HTTP reads back; Telegram is a list of replies. Whatever the
// tool asks that the script does not know is an error. The notes of changes
// are files a test writes into the checkout's changes/, with the commit that
// added each (`World.added`).

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { artifactNames } from '../../apps/extension/build/artifacts.ts';
import { listTree } from '../lib/files.ts';
import { writeZip } from '../lib/zip-write.ts';
import type { ZipEntry } from '../lib/zip.ts';
import type { FetchLike } from './announce.ts';
import { runCli, type CliDeps } from './cli.ts';
import { CHANGELOG_FILE, ENV, HUB_HEALTH_PATH, OPTIONAL_SITE_ORIGINS, recordName, releaseTarget, REPO_ROOT, signedXpiName, SITE_DIR, VERSION_FILE } from './config.ts';
import { realExec, type CommandResult, type CommandSpec, type Exec } from './exec.ts';
import type { Http } from './publish.ts';
import type { ReleaseRecord } from './records.ts';
import { bumpVersion, readPackageVersion } from './version.ts';
import { sha256Hex, SIGNATURE_FILES } from './xpi.ts';

/** git's version: the last release, tagged v<VERSION> on COMMIT_A. */
export const VERSION = readPackageVersion(readFileSync(join(REPO_ROOT, VERSION_FILE), 'utf8'));
/** What `pnpm release` makes of it. */
export const NEXT = bumpVersion(VERSION, 'patch');
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
  /** The subjects `git log --first-parent` gives for any range, newest first. */
  subjects: string[];
  /** The notes each commit of main added: changes/<slug>.md (and their pictures). */
  added: Map<string, string[]>;
  /** The day of each tag's commit, YYYY-MM-DD (2026-10-01 unless named). */
  tagDays: Map<string, string>;
  /** The message of the lock tag here and on origin; null — none. */
  localLock: string | null;
  originLock: string | null;
  /** GitHub releases by tag: the address. */
  githubReleases: Map<string, string>;
  /** No git at all: the checkout is a copy of the tree (the e2e image's); every git command fails to start. */
  noGit: boolean;
  // ── the gate ──
  checkExit: number;
  hubCompare: string | null;
  /** GitHub's check runs of a commit of this repository (`commits/<sha>/check-runs`): the CI of main. */
  mainCi: string;
  // ── public addresses ──
  /** null — the feed is what lies in the server folder (404 while nothing is published). */
  feed: { status: number; body: string } | null;
  health: { status: number; body: string };
  // ── AMO ──
  /** The exit code of `web-ext sign`; 0 leaves the signed XPI in the artifacts folder. */
  signExit: number;
  /** Runs when `pnpm build` runs in the checkout: what changes in the tree while it builds. */
  onBuild: (() => void) | null;
  /** Runs when `web-ext sign` starts, with its --source-dir: what changes while AMO has the upload. */
  onSign: ((sourceDir: string) => void) | null;
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
  /** Every request to Telegram: its form fields, and its files by part name. */
  readonly posts: Array<{ url: string; fields: Record<string, string>; files: Record<string, { name: string; type: string; bytes: number }> }>;
  readonly out: string[];
  readonly err: string[];
  /** `pnpm release <argv>`; resolves with the exit code. */
  run(...argv: string[]): Promise<number>;
  /** The commands so far that leave the machine or write to git: origin, the server, AMO, GitHub, a tag. */
  outward(): string[];
  /** Forgets what was recorded so far (the world stays). */
  forget(): void;
  /** The signed XPI as AMO would hand it back for the build of a version (VERSION unless named). */
  signedXpi(version?: string): Buffer;
  /** Puts a signed XPI and its record into .release/, as `sign` leaves them. */
  seedSigned(commit: string): ReleaseRecord;
  path(relative: string): string;
  remote(relative: string): string;
  remove(): void;
}

const buildOf = (version: string): readonly ZipEntry[] => [
  {
    name: 'manifest.json',
    data: Buffer.from(
      JSON.stringify({
        manifest_version: 3,
        name: 'ChatGoose для ChatSpace',
        version,
        host_permissions: ['https://gosling-agency.ru/*'],
        optional_host_permissions: ['https://*/*', ...OPTIONAL_SITE_ORIGINS],
        optional_permissions: ['webRequest'],
        browser_specific_settings: { gecko: { id: target.geckoId, update_url: target.feedUrl } },
      }),
    ),
  },
  { name: 'background.js', data: Buffer.from('console.log(1)') },
];
const BUILD = buildOf(VERSION);

/**
 * A small site of its own, every page the release checks (site.ts): the tests do not hang on what the real pages say
 * or show (the 3.0 landing declares its launch and shows the screenshots of its own notes).
 */
const page = (title: string, body: string, head = ''): string =>
  `<!doctype html>\n<html lang="ru">\n<head>\n  <meta charset="utf-8">${head}\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>${title}</title>\n  <link rel="stylesheet" href="site.css">\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
const nav = '<nav><a href="index.html">Установка</a> <a href="start.html">Как начать</a> <a href="guide.html">Руководство</a> <a href="whats-new.html">Что нового</a> <a href="changelog.html">История версий</a> <a href="privacy.html">О данных</a></nav>';
const region = (name: string): string => `  <!-- cg:begin ${name} -->\n  <!-- cg:end ${name} -->`;
export const FIXTURE_SITE: ReadonlyMap<string, string> = new Map([
  ['index.html', page('ChatGoose', `${nav}\n<h1>ChatGoose</h1>\n<p><a data-cg="xpi" href="firefox/chatgoose-0.0.0.xpi">Установить в Firefox</a> Версия <b data-cg="version">0.0.0</b> · Firefox <b data-cg="firefox">142</b></p>`)],
  ['start.html', page('Как начать — ChatGoose', `${nav}\n<h1>Как начать</h1>`)],
  ['guide.html', page('Руководство — ChatGoose', `${nav}\n<h1>Руководство</h1>`)],
  ['whats-new.html', page('Что нового — ChatGoose', `${nav}\n<h1>Что нового</h1>\n${region('whats-new')}\n<p>ChatGoose <span data-cg="version">0.0.0</span></p>`)],
  ['changelog.html', page('История версий — ChatGoose', `${nav}\n<h1>История версий</h1>\n${region('changelog')}`)],
  ['privacy.html', page('О данных — ChatGoose', `${nav}\n<h1>О данных</h1>`)],
  ['404.html', page('Страницы нет — ChatGoose', `${nav}\n<h1>Такой страницы нет</h1>`, '\n  <base href="/">')],
  ['site.css', 'body { margin: 0; }\n'],
]);

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
  for (const [name, text] of FIXTURE_SITE) put(join(SITE_DIR, name), text);
  put('vendor/kernel-sdk/kernel-sdk.vendor.json', JSON.stringify({ contractHash: SDK_HASH, sourceCommit: SDK_COMMIT }));
  put('vendor/chatgoose-hotkeys/chatgoose-hotkeys.vendor.json', JSON.stringify({ sha256: HOTKEYS }));
  put('tests/vendor-pins.json', JSON.stringify({ kernelSdk: { contractHash: SDK_HASH, sourceCommit: SDK_COMMIT }, chatgooseHotkeys: { sha256: HOTKEYS } }));
  /** What `pnpm build` leaves: the build of the version package.json holds now. */
  const build = (): void => {
    const version = readPackageVersion(readFileSync(join(checkout, VERSION_FILE), 'utf8'));
    rmSync(join(checkout, 'apps/extension/.output'), { recursive: true, force: true });
    for (const file of buildOf(version)) put(`apps/extension/.output/firefox-mv3/${file.name}`, file.data);
    const names = artifactNames(version, 'release');
    put(`apps/extension/.output/${names.xpi}`, writeZip(buildOf(version)));
    put(`apps/extension/.output/${names.sources}`, writeZip([{ name: 'package.json', data: Buffer.from(`{"version":"${version}"}`) }, { name: 'BUILD.md', data: Buffer.from('how to build') }]));
  };
  build();

  const world: World = {
    head: COMMIT_B,
    branch: 'main',
    porcelain: '',
    main: [COMMIT_A, COMMIT_B],
    localTags: new Map([[`v${VERSION}`, { commit: COMMIT_A, annotated: true }]]),
    originTags: new Set([`v${VERSION}`]),
    pushFails: false,
    subjects: ['feat(ai): reply drafts keep the last messages (#240)', 'docs: release notes (#241)', 'fix(fansly): Spenders opens on the first click (#239)'],
    added: new Map(),
    tagDays: new Map(),
    localLock: null,
    originLock: null,
    githubReleases: new Map(),
    noGit: false,
    checkExit: 0,
    hubCompare: 'ahead',
    mainCi: JSON.stringify({ check_runs: ['pnpm check', 'pnpm e2e'].map((name, index) => ({ id: index + 1, name, status: 'completed', conclusion: 'success' })) }),
    feed: null,
    health: { status: 200, body: JSON.stringify({ status: 'ok', contractHash: SDK_HASH, compatibleClientSdks: [SDK_HASH] }) },
    signExit: 0,
    onBuild: null,
    onSign: null,
    telegram: [],
    now: new Date('2026-10-05T11:00:00.000Z'),
  };

  const commands: string[] = [];
  const requests: string[] = [];
  const posts: Harness['posts'] = [];
  const out: string[] = [];
  const err: string[] = [];
  const answer = (stdout = '', code = 0, stderr = ''): CommandResult => ({ code, stdout, stderr });
  const signedXpi = (version = VERSION): Buffer => writeZip([...SIGNATURE_FILES.map((name) => ({ name, data: Buffer.from('signature') })), ...buildOf(version)]);
  const signedFolder = (dir: string): Buffer =>
    writeZip([...SIGNATURE_FILES.map((name) => ({ name, data: Buffer.from('signature') })), ...listTree(dir).map((name) => ({ name, data: readFileSync(join(dir, name)) }))]);

  const commit = (name: string): string =>
    name === 'HEAD' ? world.head : name === 'origin/main' ? (world.main.at(-1) ?? '') : name.startsWith('v') ? (world.localTags.get(name)?.commit ?? `no-such-tag-${name}`) : name;
  const LOCK_REF = 'refs/tags/release-lock';
  function git(args: readonly string[]): CommandResult {
    const line = args.join(' ');
    if (line === 'rev-parse HEAD') return answer(`${world.head}\n`);
    if (line === 'rev-parse --abbrev-ref HEAD') return answer(`${world.branch}\n`);
    if (line === 'status --porcelain' || line === 'status --porcelain --untracked-files=no') return answer(world.porcelain);
    if (/^fetch origin main( --tags)? --quiet$/.test(line) || line === 'fetch --quiet --force origin main --tags') return answer();
    if (line === 'tag -l v*') return answer([...world.localTags.keys()].filter((name) => name.startsWith('v')).join('\n'));
    if (line.startsWith('log --first-parent --format=%s ')) return answer(world.subjects.join('\n'));
    // The notes a range of main added (local.ts notesAdded): `from..to` or everything up to `to`, oldest first.
    if (line.startsWith('log --first-parent --reverse --diff-filter=A --no-renames --format= --name-only ')) {
      const range = args[args.indexOf('--name-only') + 1] ?? '';
      const dots = range.indexOf('..');
      const end = world.main.indexOf(commit(dots < 0 ? range : range.slice(dots + 2)));
      const start = dots < 0 ? 0 : world.main.indexOf(commit(range.slice(0, dots))) + 1;
      return answer(world.main.slice(start, end + 1).flatMap((each) => world.added.get(each) ?? []).join('\n'));
    }
    // The subjects and files of a range (local.ts commitsWithNotes): the subjects, no files.
    if (line.startsWith('log --first-parent --format=%x01%s --name-only ')) return answer(world.subjects.map((subject) => `\x01${subject}\n`).join(''));
    const day = /^log -1 --format=%cs (v[0-9.]+)\^\{commit\}$/.exec(line);
    if (day !== null) return answer(`${world.tagDays.get(day[1] ?? '') ?? '2026-10-01'}\n`);
    // The lock (lock.ts).
    if (line === `ls-remote origin ${LOCK_REF}`) return answer(world.originLock === null ? '' : `${'7'.repeat(40)}\t${LOCK_REF}\n`);
    if (line === `fetch --quiet --no-tags origin +${LOCK_REF}:${LOCK_REF}`) {
      world.localLock = world.originLock;
      return world.originLock === null ? answer('', 128, "fatal: couldn't find remote ref") : answer();
    }
    if (line === 'tag -l --format=%(contents) release-lock') return answer(world.localLock ?? '');
    if (args[0] === 'tag' && args[1] === '-f' && args[3] === 'release-lock') {
      world.localLock = args[5] ?? '';
      return answer();
    }
    if (line === `push --quiet origin ${LOCK_REF}`) {
      if (world.pushFails) return answer('', 128, 'fatal: unable to access the remote: Could not resolve host');
      if (world.originLock !== null) return answer('', 1, ` ! [rejected]        release-lock -> release-lock (already exists)\nerror: failed to push some refs`);
      world.originLock = world.localLock;
      return answer();
    }
    if (line === `push --quiet origin :${LOCK_REF}`) {
      world.originLock = null;
      return answer();
    }
    if (line === 'tag -d release-lock') {
      const had = world.localLock !== null;
      world.localLock = null;
      return had ? answer() : answer('', 1, "error: tag 'release-lock' not found.");
    }
    const drop = /^tag -d (v[0-9.]+)$/.exec(line);
    if (drop !== null) return world.localTags.delete(drop[1] ?? '') ? answer() : answer('', 1, 'not found');
    if (line === 'rev-parse origin/main') return answer(`${world.main.at(-1) ?? ''}\n`);
    // The last commit that changed more than documents: HEAD itself here.
    if (line.startsWith('log -1 --first-parent --format=%H HEAD -- ')) return answer(`${world.head}\n`);
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
    if (program === 'gh' && spec.args[0] === 'api' && spec.args[1]?.includes('/check-runs') === true) return Promise.resolve(answer(world.mainCi));
    if (program === 'gh' && spec.args[0] === 'release' && spec.args[1] === 'view') {
      const url = world.githubReleases.get(spec.args[2] ?? '');
      return Promise.resolve(url === undefined ? answer('', 1, 'release not found') : answer(`${url}\n`));
    }
    if (program === 'gh' && spec.args[0] === 'release' && spec.args[1] === 'create') {
      const tag = spec.args[2] ?? '';
      if (!world.originTags.has(tag)) return Promise.resolve(answer('', 1, `tag ${tag} does not exist on the remote`));
      const url = `https://github.com/example/chat-extension/releases/tag/${tag}`;
      world.githubReleases.set(tag, url);
      return Promise.resolve(answer(`${url}\n`));
    }
    if (program === 'gh' && spec.args[0] === 'api') return Promise.resolve(world.hubCompare === null ? answer('', 1, 'gh: Not Found (HTTP 404)') : answer(`${world.hubCompare}\n`));
    if (line === 'pnpm --version') return Promise.resolve(answer('10.33.1\n'));
    if (line === 'pnpm check') return Promise.resolve(answer('', world.checkExit));
    if (line === 'pnpm install --frozen-lockfile --offline') return Promise.resolve(answer());
    if (line === 'pnpm build') {
      if (spec.cwd !== undefined && spec.cwd.startsWith(checkout)) {
        build();
        world.onBuild?.();
      }
      // The rebuild in the unpacked sources archive: the same extension again.
      if (spec.cwd !== undefined && !spec.cwd.startsWith(checkout)) {
        mkdirSync(join(spec.cwd, 'apps/extension/.output/firefox-mv3'), { recursive: true });
        for (const file of BUILD) writeFileSync(join(spec.cwd, 'apps/extension/.output/firefox-mv3', file.name), file.data);
      }
      return Promise.resolve(answer());
    }
    if (program === 'web-ext' && spec.args[0] === 'sign') {
      world.onSign?.(spec.args[spec.args.indexOf('--source-dir') + 1] ?? '');
      if (world.signExit === 0) {
        const dir = spec.args[spec.args.indexOf('--artifacts-dir') + 1] ?? '';
        const source = spec.args[spec.args.indexOf('--source-dir') + 1] ?? '';
        mkdirSync(dir, { recursive: true });
        // A P3b test build is signed as the folder it was given; the release — as the build of the checkout.
        writeFileSync(join(dir, 'signed.xpi'), signedFolder(source));
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
    const fields: Record<string, string> = {};
    const files: Record<string, { name: string; type: string; bytes: number }> = {};
    for (const [name, value] of init.body.entries()) {
      if (typeof value === 'string') fields[name] = value;
      else files[name] = { name: value.name, type: value.type, bytes: value.size };
    }
    posts.push({ url, fields, files });
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
    who: 'agent@test/pid1',
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
    signedXpi: (version) => signedXpi(version),
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
      writeFileSync(join(releaseDir, recordName(VERSION)), `${JSON.stringify(record, null, 2)}\n`);
      return record;
    },
    path: (relative) => join(checkout, relative),
    remote: (relative) => join(remoteDir, relative),
    remove: () => rmSync(root, { recursive: true, force: true }),
  };
}
