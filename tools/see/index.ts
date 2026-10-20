// `pnpm see …` — see a change with one's own eyes (tools/see/README.md): the TEST build in a headless Firefox on
// the stand (fake ChatSpace / Fansly + the fake hub), a scenario pressed through by hand, pictures and the
// extension's reports in .cache/see/<time>-<scenario>/ with an index.html contact sheet.
//
//   pnpm see                         the scenarios
//   pnpm see <scenario|file> [--site fansly] [--gif] [--no-build]
//   pnpm see --new <name>            a scenario of one's own (packages/testing/e2e/see/scratch, not committed)
//   pnpm see:session [chatspace|fansly]   a shift held open; pnpm see:do drives it
//   pnpm see:do '<js>' | --file f.js | --shot <name> | --stop
//   pnpm see:gallery                 the UI galleries (vite, hot reload)
//
// Not CI and not a test: nothing here asserts. Headless Firefox only (AGENTS.md: never a windowed one from an
// agent's shell on macOS).

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline';

import { REPO_ROOT, fail } from '../lib/paths.ts';

const TESTING = join(REPO_ROOT, 'packages/testing');
const SEE_DIR = join(TESTING, 'e2e/see');
const SCENARIOS = join(SEE_DIR, 'scenarios');
const SCRATCH = join(SEE_DIR, 'scratch');
const CACHE = join(REPO_ROOT, '.cache/see');
const SESSION_FILE = join(CACHE, 'session.json');
const BIN = (name: string): string => join(TESTING, 'node_modules/.bin', name);

const t0 = Date.now();
const secs = (from = t0): string => `${((Date.now() - from) / 1000).toFixed(1)} s`;
const say = (line: string): void => console.log(`see: ${line}`);

// ── ports: one block per worktree ──────────────────────────────────────────

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (const byte of Buffer.from(text, 'utf8')) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/** Eight ports of this worktree, below the system's ephemeral range and the dev profiles' ports (49152+). */
const PORT_BASE = 41_000 + (fnv1a(resolve(REPO_ROOT)) % 900) * 8;
const SESSION_PORT = PORT_BASE;
const GALLERY_PORT = PORT_BASE + 2;

// ── builds: only when a source is newer than the output ────────────────────

const SKIP = /(?:^|\/)(?:node_modules|\.output|\.wxt|\.tsbuild|dist|coverage|\.cache|test|tests)(?:\/|$)|\.test\.tsx?$/;

function newestIn(path: string): number {
  if (!existsSync(path)) return 0;
  const stat = statSync(path);
  if (!stat.isDirectory()) return stat.mtimeMs;
  let newest = 0;
  for (const entry of readdirSync(path, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const full = join(entry.parentPath, entry.name);
    if (SKIP.test(relative(REPO_ROOT, full))) continue;
    newest = Math.max(newest, statSync(full).mtimeMs);
  }
  return newest;
}

function oldestOut(paths: readonly string[]): number {
  return Math.min(...paths.map((path) => (existsSync(path) ? statSync(path).mtimeMs : 0)));
}

interface Build {
  readonly name: string;
  readonly outputs: () => readonly string[];
  readonly inputs: readonly string[];
  readonly command: readonly string[];
}

const extensionVersion = (): string => (JSON.parse(readFileSync(join(REPO_ROOT, 'apps/extension/package.json'), 'utf8')) as { version: string }).version;

const TEST_BUILD: Build = {
  name: 'test build',
  outputs: () => [join(REPO_ROOT, `apps/extension/.output/chatgoose-chatspace-${extensionVersion()}-firefox-test.zip`)],
  inputs: ['apps/extension', 'packages/contracts', 'packages/core', 'packages/platform', 'packages/hub', 'packages/host-kit', 'packages/host-chatspace', 'packages/host-fansly', 'packages/fansly-api', 'packages/ui', 'vendor', 'pnpm-lock.yaml'],
  command: ['pnpm', 'build:test'],
};

const STAND_BUILD: Build = {
  name: 'stand',
  outputs: () => ['.cache/fixture-chatspace/index.html', '.cache/fixture-fansly/index.html', '.cache/fansly-neighbor/neighbor.js'].map((path) => join(REPO_ROOT, path)),
  inputs: ['packages/testing/fixture-chatspace', 'packages/testing/fixture-fansly', 'packages/testing/src/fake-fansly/neighbor', 'packages/testing/fixture-chatspace.vite.config.ts', 'packages/testing/fixture-fansly.vite.config.ts', 'packages/testing/fansly-neighbor.vite.config.ts'],
  command: ['pnpm', '--filter', '@cg/testing', 'build:stand'],
};

function ensure(build: Build): void {
  const started = Date.now();
  const built = oldestOut(build.outputs());
  const changed = Math.max(...build.inputs.map((path) => newestIn(join(REPO_ROOT, path))));
  if (built > 0 && built >= changed) {
    say(`${build.name}: fresh`);
    return;
  }
  const [command = 'pnpm', ...args] = build.command;
  const done = spawnSync(command, args, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (done.status !== 0) {
    console.error(`${done.stdout}\n${done.stderr}`);
    fail(`see: ${build.name} failed (${build.command.join(' ')})`);
  }
  say(`${build.name}: built in ${secs(started)}`);
}

function ensureBuilds(skip: boolean): void {
  if (skip) {
    say('builds: skipped (--no-build)');
    return;
  }
  ensure(TEST_BUILD);
  ensure(STAND_BUILD);
}

// ── scenarios ──────────────────────────────────────────────────────────────

function scenarioFiles(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith('.see.ts') || name.endsWith('.e2e.ts')).sort() : [];
}

const scenarioName = (file: string): string => basename(file).replace(/\.(?:see|e2e)\.ts$/, '');

/** The first comment line of a scenario file: what it shows. */
function describeScenario(file: string): string {
  const first = readFileSync(file, 'utf8').split('\n').find((line) => line.startsWith('//'));
  return first?.replace(/^\/\/\s*/, '') ?? '';
}

function listScenarios(): void {
  console.log('pnpm see <scenario> [--site fansly] [--gif] [--no-build]   (tools/see/README.md)\n');
  for (const [title, dir] of [
    ['scenarios', SCENARIOS],
    ['scratch (yours, not committed)', SCRATCH],
  ] as const) {
    const files = scenarioFiles(dir);
    if (files.length === 0) continue;
    console.log(`${title}:`);
    for (const file of files) console.log(`  ${scenarioName(file).padEnd(14)} ${describeScenario(join(dir, file))}`);
    console.log('');
  }
  console.log('also: pnpm see --new <name> · pnpm see:session [chatspace|fansly] · pnpm see:do \'<js>\' · pnpm see:gallery');
}

function resolveScenario(arg: string): string {
  for (const dir of [SCENARIOS, SCRATCH]) {
    for (const suffix of ['.see.ts', '.e2e.ts']) {
      const file = join(dir, `${arg.replace(/^scratch\//, '')}${suffix}`);
      if (existsSync(file)) return file;
    }
  }
  const here = process.env['INIT_CWD'] ?? process.cwd();
  for (const base of [here, REPO_ROOT, TESTING]) {
    const file = isAbsolute(arg) ? arg : resolve(base, arg);
    if (existsSync(file) && statSync(file).isFile()) return file;
  }
  listScenarios();
  return fail(`\nsee: no scenario «${arg}»`);
}

/** The template of a scratch scenario (a plain file: the sources archive must hold no import of e2e code). */
const TEMPLATE = join(SEE_DIR, 'scratch.template');

function newScenario(name: string | undefined): void {
  if (name === undefined || !/^[\w-]+$/.test(name)) fail('see: pnpm see --new <name> (letters, digits, - and _)');
  mkdirSync(SCRATCH, { recursive: true });
  const file = join(SCRATCH, `${name}.see.ts`);
  if (existsSync(file)) fail(`see: ${file} is there already`);
  writeFileSync(file, readFileSync(TEMPLATE, 'utf8').replaceAll('__NAME__', name));
  say(`${file}\nsee: run it: pnpm see ${name}`);
}

// ── a run of wdio, its output filtered ─────────────────────────────────────

function stamp(): string {
  const now = new Date();
  const two = (value: number): string => String(value).padStart(2, '0');
  return `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
}

function outDir(name: string): string {
  const dir = join(CACHE, `${stamp()}-${name}`);
  mkdirSync(dir, { recursive: true });
  const latest = join(CACHE, 'latest');
  rmSync(latest, { force: true });
  try {
    symlinkSync(dir, latest);
  } catch {
    // no symlinks here: the path is printed all the same
  }
  return dir;
}

const NOISE = /^\s*$|^\[0-\d+\] (?:RUNNING|PASSED|FAILED) in |"spec" Reporter|^-{20,}|^\[firefox .*(?:Running:|Session ID:|^\[firefox [^\]]*\]\s*$)|^Execution of \d+ workers|cg-e2e-time:/;
const SHOW = /cg-see |✖|Error|error:|failing|Spec Files:/;

/** Runs wdio on one spec file; every line goes to wdio.log, the telling ones to the terminal. */
function wdio(spec: string, out: string, env: Record<string, string>, onLine: (line: string) => void = () => undefined): { readonly child: ChildProcess; readonly exit: Promise<number> } {
  const log: string[] = [];
  const child = spawn(BIN('wdio'), ['run', 'e2e/wdio.conf.ts', '--spec', spec], { cwd: TESTING, env: { ...process.env, ...env, CG_SEE_OUT: out, FORCE_COLOR: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [child.stdout, child.stderr]) {
    createInterface({ input: stream }).on('line', (line) => {
      log.push(line);
      onLine(line);
      if (NOISE.test(line) || !SHOW.test(line)) return;
      const at = line.indexOf('cg-see ');
      console.log(at >= 0 ? `  ${line.slice(at + 'cg-see '.length)}` : `  ${line.replace(/^\[0-\d+\] /, '')}`);
    });
  }
  const exit = new Promise<number>((done) => {
    child.on('close', (code) => {
      writeFileSync(join(out, 'wdio.log'), `${log.join('\n')}\n`);
      if (code !== 0) {
        console.log('see: the last lines of wdio.log:');
        for (const line of log.filter((each) => !NOISE.test(each)).slice(-25)) console.log(`  │ ${line}`);
      }
      done(code ?? 1);
    });
  });
  return { child, exit };
}

// ── what a run leaves: the contact sheet, the GIF ──────────────────────────

interface ShotNote {
  readonly file: string;
  readonly name: string;
  readonly seconds: number;
  readonly dock: string | null;
}

const pngs = (out: string): string[] => readdirSync(out).filter((name) => name.endsWith('.png')).sort();

function readNotes(out: string): ShotNote[] {
  try {
    return JSON.parse(readFileSync(join(out, 'shots.json'), 'utf8')) as ShotNote[];
  } catch {
    return [];
  }
}

const escape = (text: string): string => text.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char] ?? char);

function contactSheet(out: string, title: string, status: string): string {
  const notes = new Map(readNotes(out).map((note) => [note.file, note]));
  const figures = pngs(out)
    .map((file) => {
      const note = notes.get(file);
      const caption = [file, note === undefined ? '' : `+${note.seconds.toFixed(1)} s`, note?.dock ?? ''].filter((part) => part !== '').map(escape).join(' · ');
      return `<figure><a href="${escape(file)}"><img src="${escape(file)}" loading="lazy" alt="${escape(file)}"></a><figcaption>${caption}</figcaption></figure>`;
    })
    .join('\n');
  const gif = existsSync(join(out, 'see.gif')) ? '<figure><img src="see.gif" alt="see.gif"><figcaption>see.gif</figcaption></figure>' : '';
  const files = ['report.json', 'diagnostics.json', 'journals.json', 'hub-calls.json', 'console.json', 'egress.json', 'violations.txt', 'error.txt', 'wdio.log']
    .filter((file) => existsSync(join(out, file)))
    .map((file) => `<a href="${file}">${file}</a>`)
    .join(' · ');
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>see · ${escape(title)}</title>
<style>
:root { color-scheme: light dark; --bg: #f6f4ef; --ink: #222; --mute: #777; --card: #fff; }
@media (prefers-color-scheme: dark) { :root { --bg: #161616; --ink: #e8e6e1; --mute: #999; --card: #222; } }
body { margin: 0; padding: 16px; background: var(--bg); color: var(--ink); font: 14px/1.4 system-ui, sans-serif; }
h1 { font-size: 18px; margin: 0 0 4px; } p { margin: 0 0 16px; color: var(--mute); } a { color: inherit; }
main { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 560px), 1fr)); gap: 16px; }
figure { margin: 0; background: var(--card); border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px #0003; }
img { display: block; width: 100%; height: auto; } figcaption { padding: 8px 10px; color: var(--mute); font-size: 12px; }
</style></head>
<body><h1>${escape(title)}</h1><p>${escape(status)} · ${files}</p><main>${gif}${figures}</main></body></html>
`;
  const path = join(out, 'index.html');
  writeFileSync(path, html);
  return path;
}

/**
 * The GIF of a run: the frames of `--gif` (taken every 250 ms, named by their millisecond) at their own pace, each
 * picture of the scenario held 1.5 s where it was taken, the last one 2.5 s.
 */
function makeGif(out: string): string | null {
  if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0) {
    say('--gif: no ffmpeg on PATH (brew install ffmpeg)');
    return null;
  }
  const framesDir = join(out, 'frames');
  const frames = existsSync(framesDir)
    ? readdirSync(framesDir)
        .filter((name) => /^f\d+\.png$/.test(name))
        .map((name) => ({ path: join(framesDir, name), ms: Number(name.slice(1, -4)), hold: 0 }))
    : [];
  const notes = new Map(readNotes(out).map((note) => [note.file, note.seconds * 1000]));
  const shots = pngs(out).map((file, index) => ({ path: join(out, file), ms: notes.get(file) ?? index * 1000, hold: 1500 }));
  const items = [...frames, ...shots].sort((a, b) => a.ms - b.ms);
  if (items.length === 0) return null;
  const list = items.map((item, index) => {
    const next = items[index + 1];
    const seconds = next === undefined ? 2.5 : Math.max(item.hold, Math.min(next.ms - item.ms, 1000)) / 1000;
    return `file '${item.path}'\nduration ${Math.max(seconds, 0.05).toFixed(3)}`;
  });
  const listFile = join(out, 'gif-frames.txt');
  writeFileSync(listFile, `${list.join('\n')}\nfile '${items.at(-1)?.path ?? ''}'\n`);
  const gif = join(out, 'see.gif');
  const filter = 'scale=960:600:force_original_aspect_ratio=decrease,pad=960:600:(ow-iw)/2:(oh-ih)/2,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4';
  const made = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile, '-vf', filter, '-fps_mode', 'vfr', gif], { encoding: 'utf8' });
  rmSync(listFile, { force: true });
  if (made.status !== 0) {
    say(`--gif: ffmpeg failed: ${made.stderr.trim().split('\n').at(-1) ?? ''}`);
    return null;
  }
  return gif;
}

function printResult(out: string, title: string, ok: boolean, timing: string): void {
  const sheet = contactSheet(out, title, `${ok ? 'ok' : 'FAILED'} · ${timing}`);
  console.log('');
  say(`${title}: ${ok ? 'ok' : 'FAILED'} — ${timing}`);
  say(`folder ${out}`);
  for (const file of pngs(out)) console.log(`  ${join(out, file)}`);
  if (existsSync(join(out, 'see.gif'))) console.log(`  ${join(out, 'see.gif')}`);
  for (const file of ['violations.txt', 'error.txt']) if (existsSync(join(out, file))) console.log(`  ${join(out, file)}`);
  console.log(`  ${sheet}`);
}

// ── commands ───────────────────────────────────────────────────────────────

interface Flags {
  readonly positional: string[];
  readonly site: string | null;
  readonly gif: boolean;
  readonly noBuild: boolean;
  readonly values: Map<string, string>;
  readonly switches: Set<string>;
}

function parse(args: readonly string[]): Flags {
  const positional: string[] = [];
  const values = new Map<string, string>();
  const switches = new Set<string>();
  const valued = new Set(['--site', '--new', '--file', '--shot', '--name', '--idle']);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    if (arg === '--') continue;
    if (valued.has(arg)) {
      values.set(arg, args[index + 1] ?? '');
      index += 1;
    } else if (arg.startsWith('--') && arg.includes('=')) values.set(arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1));
    else if (arg.startsWith('--')) switches.add(arg);
    else positional.push(arg);
  }
  const site = values.get('--site') ?? null;
  if (site !== null && site !== 'chatspace' && site !== 'fansly') fail(`see: --site ${site}: chatspace or fansly`);
  return { positional, site, gif: switches.has('--gif'), noBuild: switches.has('--no-build'), values, switches };
}

async function run(flags: Flags): Promise<void> {
  if (flags.values.has('--new')) return newScenario(flags.values.get('--new'));
  const [arg] = flags.positional;
  if (arg === undefined) return listScenarios();
  const spec = resolveScenario(arg);
  ensureBuilds(flags.noBuild);
  const built = Date.now();
  const name = `${scenarioName(spec)}${flags.site === null ? '' : `-${flags.site}`}`;
  const out = outDir(name);
  say(`${relative(REPO_ROOT, spec)} → headless Firefox on the stand…`);
  const env: Record<string, string> = { ...(flags.site === null ? {} : { CG_SEE_SITE: flags.site }), ...(flags.gif ? { CG_SEE_GIF: '1' } : {}) };
  const code = await wdio(spec, out, env).exit;
  if (flags.gif) makeGif(out);
  printResult(out, name, code === 0, `${secs()} (builds ${((built - t0) / 1000).toFixed(1)} s, Firefox and the scenario ${secs(built)})`);
  process.exitCode = code;
}

interface SessionInfo {
  readonly pid: number;
  readonly port: number;
  readonly site: string;
  readonly out: string;
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

function readSession(): SessionInfo | null {
  try {
    const info = JSON.parse(readFileSync(SESSION_FILE, 'utf8')) as SessionInfo;
    return alive(info.pid) ? info : null;
  } catch {
    return null;
  }
}

async function session(flags: Flags): Promise<void> {
  const site = flags.positional[0] ?? flags.site ?? 'chatspace';
  if (site !== 'chatspace' && site !== 'fansly') fail(`see: pnpm see:session [chatspace|fansly], not «${site}»`);
  const running = readSession();
  if (running !== null) fail(`see: a session (${running.site}) already runs on http://127.0.0.1:${running.port}/live — pnpm see:do --stop`);
  ensureBuilds(flags.noBuild);
  const out = outDir(`session-${site}`);
  const idle = flags.values.get('--idle') ?? process.env['CG_SEE_IDLE_MIN'] ?? '30';
  say(`starting a ${site} session (headless Firefox; stops after ${idle} min without a request)…`);
  const { child, exit } = wdio(join(SEE_DIR, 'session.see.ts'), out, { CG_SEE_SITE: site, CG_SEE_PORT: String(SESSION_PORT), CG_SEE_IDLE_MIN: idle }, (line) => {
    if (!line.includes('cg-see session ready')) return;
    console.log('');
    say(`session ready in ${secs()} — live view: http://127.0.0.1:${SESSION_PORT}/live`);
    say(`drive it: pnpm see:do 'await s.press(/^Reply/); await s.done(); return s.dock()'   (a picture after each)`);
    say(`stop it:  pnpm see:do --stop   ·   pictures: ${out}`);
  });
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(SESSION_FILE, `${JSON.stringify({ pid: process.pid, port: SESSION_PORT, site, out } satisfies SessionInfo)}\n`);
  const stop = (): void => {
    void fetch(`http://127.0.0.1:${SESSION_PORT}/stop`, { method: 'POST' }).catch(() => child.kill('SIGINT'));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  const code = await exit;
  rmSync(SESSION_FILE, { force: true });
  printResult(out, `session-${site}`, code === 0, secs());
  process.exitCode = code;
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const info = readSession();
  const port = info?.port ?? SESSION_PORT;
  const until = Date.now() + 120_000;
  for (;;) {
    try {
      return await fetch(`http://127.0.0.1:${port}${path}`, init);
    } catch (error) {
      // A session still starting: wait for it. No session at all: say so.
      if (readSession() === null) fail(`see: no session on port ${port} — start one: pnpm see:session [chatspace|fansly]`);
      if (Date.now() > until) fail(`see: the session on port ${port} does not answer: ${String(error)}`);
      await new Promise((done) => setTimeout(done, 500));
    }
  }
}

async function doCommand(flags: Flags): Promise<void> {
  if (flags.switches.has('--stop')) {
    await (await call('/stop', { method: 'POST' })).text();
    say('the session is stopping');
    return;
  }
  if (flags.switches.has('--status')) {
    console.log(await (await call('/status')).text());
    return;
  }
  if (flags.values.has('--shot')) {
    const answer = (await (await call(`/shot?name=${encodeURIComponent(flags.values.get('--shot') ?? 'shot')}`)).json()) as { shot?: string };
    console.log(answer.shot ?? JSON.stringify(answer));
    return;
  }
  const file = flags.values.get('--file');
  const code = file !== undefined ? readFileSync(resolve(process.env['INIT_CWD'] ?? process.cwd(), file), 'utf8') : flags.positional[0] === '-' ? readFileSync(0, 'utf8') : flags.positional.join(' ');
  if (code.trim() === '') fail("see: pnpm see:do '<async JS with s and browser>' | --file f.js | - (stdin) | --shot <name> | --status | --stop");
  const query = new URLSearchParams();
  if (flags.values.has('--name')) query.set('name', flags.values.get('--name') ?? 'do');
  if (flags.switches.has('--no-shot')) query.set('shot', '0');
  const response = await call(`/run?${query.toString()}`, { method: 'POST', body: code });
  const answer = (await response.json()) as { ok: boolean; result?: unknown; error?: string; shot?: string | null; seconds?: number };
  if (answer.ok) console.log(JSON.stringify(answer.result, null, 2));
  else console.error(answer.error);
  if (answer.shot) console.log(`see: ${answer.shot}`);
  say(`${answer.ok ? 'ok' : 'FAILED'} in ${answer.seconds?.toFixed(1) ?? '?'} s`);
  if (!answer.ok) process.exitCode = 1;
}

const GALLERIES = ['kit', 'dock', 'boards', 'pages'] as const;

async function gallery(): Promise<void> {
  const children = GALLERIES.map((name, index) => {
    const port = GALLERY_PORT + index;
    const child = spawn(BIN('vite'), ['--config', `${name}-gallery.vite.config.ts`, '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: TESTING, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stderr.on('data', (chunk: Buffer) => process.stderr.write(`[${name}] ${chunk.toString()}`));
    return { name, port, child };
  });
  const ready = await Promise.all(
    children.map(async ({ name, port }) => {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        try {
          if ((await fetch(`http://127.0.0.1:${port}/${name}-gallery/`)).ok) return true;
        } catch {
          // not yet
        }
        await new Promise((done) => setTimeout(done, 100));
      }
      return false;
    }),
  );
  say(`galleries in ${secs()} (vite, hot reload; Ctrl+C stops):`);
  children.forEach(({ name, port }, index) => console.log(`  ${name.padEnd(7)} http://127.0.0.1:${port}/${name}-gallery/${ready[index] === true ? '' : '   (did not answer)'}`));
  const stop = (): void => {
    for (const { child } of children) child.kill('SIGTERM');
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  await Promise.all(children.map(({ child }) => new Promise((done) => child.on('close', done))));
}

const [command = 'run', ...rest] = process.argv.slice(2);
const flags = parse(rest);
switch (command) {
  case 'run':
    await run(flags);
    break;
  case 'session':
    await session(flags);
    break;
  case 'do':
    await doCommand(flags);
    break;
  case 'gallery':
    await gallery();
    break;
  default:
    fail(`see: unknown command «${command}» (run, session, do, gallery)`);
}
