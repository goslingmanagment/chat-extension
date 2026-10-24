// `pnpm fansly:bundle` — a fresh snapshot of fansly.com's own code to read (docs/research/fansly.md §2): the app's
// JS and CSS as the site's service-worker manifest (`ngsw.json`) lists them, each checked against its SHA-1 there,
// formatted for reading (esbuild, never executed), the API calls the code makes listed (`index/endpoints.json`), and
// what changed since the latest snapshot (`CHANGES.md`, `diff/`). Nothing is written when the site's code has not
// changed since that snapshot (`--force` writes it anyway).
//
//   pnpm fansly:bundle [--force] [--out <dir>]
//
// Snapshots live outside the repo, beside the earlier ones: ~/Documents/Codex/fansly-web-bundle-<date>/
// (CG_FANSLY_BUNDLE_ROOT names another folder). Unauthenticated static GETs only — no cookies, no API — one at a
// time, 1.1 s apart, no redirects followed.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

import { fail, REPO_ROOT } from '../lib/paths.ts';

const ORIGIN = 'https://fansly.com';
const PACE_MS = 1100;
const ROOT = process.env['CG_FANSLY_BUNDLE_ROOT'] || join(homedir(), 'Documents/Codex');
const PREFIX = 'fansly-web-bundle-';
const ESBUILD = join(REPO_ROOT, 'node_modules/.bin/esbuild');

const args = process.argv.slice(2);
const force = args.includes('--force');
const outArg = args.includes('--out') ? args[args.indexOf('--out') + 1] : undefined;

interface Ngsw {
  readonly timestamp?: number;
  readonly hashTable: Record<string, string>;
}

let lastRequest = 0;
async function get(path: string): Promise<Buffer> {
  const wait = lastRequest + PACE_MS - Date.now();
  if (wait > 0) await new Promise((done) => setTimeout(done, wait));
  lastRequest = Date.now();
  const response = await fetch(`${ORIGIN}${path}`, { redirect: 'manual', headers: { accept: '*/*' } });
  if (response.status !== 200) fail(`fansly:bundle: GET ${path} answered ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

const sha1 = (data: Buffer): string => createHash('sha1').update(data).digest('hex');
/** The app's own code: the hashed files at the root (main, runtime, polyfills, scripts, styles, lazy chunks). */
const isAppCode = (path: string): boolean => /^\/[^/]+\.(?:js|css)$/.test(path);
/** A file's name without its content hash: `main.2e6b…js` → `main.js`, the key two snapshots are compared by. */
const stable = (path: string): string => basename(path).replace(/\.[0-9a-f]{16,}\./, '.');

function previousSnapshot(): string | null {
  if (!existsSync(ROOT)) return null;
  const dirs = readdirSync(ROOT)
    .filter((name) => name.startsWith(PREFIX) && existsSync(join(ROOT, name, 'raw/ngsw.json')))
    .sort();
  const last = dirs.at(-1);
  return last === undefined ? null : join(ROOT, last);
}

function codeTable(ngsw: Ngsw): Record<string, string> {
  return Object.fromEntries(Object.entries(ngsw.hashTable).filter(([path]) => isAppCode(path)));
}

/**
 * Every request the code builds as `new X("METHOD", this.<base>Uri_ + "<path>"…)`, the way the site's services call
 * its APIs — in formatted or minified code alike (a snapshot may hold only `raw/`).
 */
function endpoints(codeDir: string): string[] {
  const found = new Set<string>();
  if (!existsSync(codeDir)) return [];
  for (const name of readdirSync(codeDir)) {
    if (!name.endsWith('.js')) continue;
    const text = readFileSync(join(codeDir, name), 'utf8');
    for (const match of text.matchAll(/new [\w$.]+\(\s*"(GET|POST|PUT|PATCH|DELETE)"\s*,\s*this\.(\w+?)(?:BaseUri_|Uri_)\s*\+\s*"([^"]+)"/g)) {
      const [, method, base, path] = match;
      found.add(`${method} ${base === 'api' ? '' : `${base}:`}${path}`);
    }
  }
  return [...found].sort();
}

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function newDir(): string {
  if (outArg !== undefined) return outArg;
  const base = join(ROOT, `${PREFIX}${today()}`);
  if (!existsSync(base)) return base;
  for (let n = 2; ; n += 1) if (!existsSync(`${base}-${n}`)) return `${base}-${n}`;
}

const say = (line: string): void => console.log(`fansly:bundle: ${line}`);

const ngswBytes = await get('/ngsw.json');
const ngsw = JSON.parse(ngswBytes.toString('utf8')) as Ngsw;
const code = codeTable(ngsw);
const previous = previousSnapshot();
const previousCode = previous === null ? {} : codeTable(JSON.parse(readFileSync(join(previous, 'raw/ngsw.json'), 'utf8')) as Ngsw);
const same = previous !== null && JSON.stringify(Object.entries(code).sort()) === JSON.stringify(Object.entries(previousCode).sort());
const built = ngsw.timestamp === undefined ? 'unknown' : new Date(ngsw.timestamp).toISOString();
if (same && !force) {
  say(`the site's code is the same as in ${previous} (build ${built}): nothing written (--force writes anyway)`);
  process.exit(0);
}

const dir = newDir();
mkdirSync(join(dir, 'raw'), { recursive: true });
mkdirSync(join(dir, 'pretty'), { recursive: true });
mkdirSync(join(dir, 'index'), { recursive: true });
writeFileSync(join(dir, 'raw/ngsw.json'), ngswBytes);
writeFileSync(join(dir, 'raw/index.html'), await get('/'));

const files: Array<{ path: string; size: number; sha1: string; matchesNgsw: boolean }> = [];
for (const [path, expected] of Object.entries(code)) {
  const data = await get(path);
  const got = sha1(data);
  files.push({ path, size: data.length, sha1: got, matchesNgsw: got === expected });
  writeFileSync(join(dir, 'raw', basename(path)), data);
  const formatted = spawnSync(ESBUILD, [join(dir, 'raw', basename(path)), `--outfile=${join(dir, 'pretty', basename(path))}`, '--charset=utf8', '--log-level=error'], { encoding: 'utf8' });
  if (formatted.status !== 0) say(`could not format ${path}: ${formatted.stderr.trim().split('\n')[0] ?? ''}`);
}
const mismatched = files.filter((file) => !file.matchesNgsw);
writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify({ origin: ORIGIN, collectedAt: new Date().toISOString(), ngswTimestamp: ngsw.timestamp ?? null, build: built, files }, null, 2)}\n`);

const list = endpoints(join(dir, 'pretty'));
writeFileSync(join(dir, 'index/endpoints.json'), `${JSON.stringify(list, null, 2)}\n`);

// What changed since the latest snapshot: files by their name without the hash, the API calls, a diff of each changed file.
const before = new Map(Object.entries(previousCode).map(([path, hash]) => [stable(path), { path, hash }]));
const after = new Map(Object.entries(code).map(([path, hash]) => [stable(path), { path, hash }]));
const added = [...after.keys()].filter((key) => !before.has(key));
const removed = [...before.keys()].filter((key) => !after.has(key));
const changed = [...after.keys()].filter((key) => before.has(key) && before.get(key)?.hash !== after.get(key)?.hash);
let previousEndpoints: string[] = [];
if (previous !== null) {
  const saved = join(previous, 'index/endpoints.json');
  previousEndpoints = existsSync(saved) ? (JSON.parse(readFileSync(saved, 'utf8')) as string[]) : endpoints(join(previous, existsSync(join(previous, 'pretty')) ? 'pretty' : 'raw'));
}
const endpointsAdded = list.filter((entry) => !previousEndpoints.includes(entry));
const endpointsRemoved = previousEndpoints.filter((entry) => !list.includes(entry));
if (previous !== null && changed.length > 0) {
  mkdirSync(join(dir, 'diff'), { recursive: true });
  for (const key of changed) {
    const name = basename(before.get(key)?.path ?? '');
    const now = join(dir, 'pretty', basename(after.get(key)?.path ?? ''));
    let old = join(previous, 'pretty', name);
    // A snapshot of raw files only: its file is formatted beside the diffs, never into that snapshot.
    if (!existsSync(old) && existsSync(join(previous, 'raw', name))) {
      old = join(dir, 'diff', `.previous-${name}`);
      spawnSync(ESBUILD, [join(previous, 'raw', name), `--outfile=${old}`, '--charset=utf8', '--log-level=error']);
    }
    if (!existsSync(old) || !existsSync(now)) continue;
    const diff = spawnSync('diff', ['-u', old, now], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    writeFileSync(join(dir, 'diff', `${key}.diff`), diff.stdout);
  }
}
const section = (title: string, items: readonly string[]): string => `## ${title} (${items.length})\n\n${items.length === 0 ? '—' : items.map((item) => `- \`${item}\``).join('\n')}\n`;
writeFileSync(
  join(dir, 'CHANGES.md'),
  [
    `# fansly.com code, ${today()}`,
    '',
    `Build \`${built}\` (ngsw timestamp). Compared with ${previous === null ? 'nothing (first snapshot)' : `\`${basename(previous)}\``}.`,
    `${files.length} code files, ${mismatched.length === 0 ? 'every one matching its SHA-1 in ngsw.json' : `${mismatched.length} NOT matching ngsw.json: ${mismatched.map((file) => file.path).join(', ')}`}.`,
    '',
    section('API calls added', endpointsAdded),
    section('API calls removed', endpointsRemoved),
    section('Files changed (diff/<name>.diff)', changed),
    section('Files added', added),
    section('Files removed', removed),
  ].join('\n'),
);

say(`${dir}`);
say(`build ${built}; ${files.length} code files${mismatched.length === 0 ? '' : `, ${mismatched.length} not matching ngsw.json`}`);
say(previous === null ? 'first snapshot' : `vs ${basename(previous)}: ${changed.length} changed, ${added.length} added, ${removed.length} removed`);
say(`API calls: ${list.length} (${endpointsAdded.length} new, ${endpointsRemoved.length} gone) — index/endpoints.json, CHANGES.md`);
