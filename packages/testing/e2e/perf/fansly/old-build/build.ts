// The old Fansly extension's TEST build for the Fansly perf stand (R20 P3d):
// its released sources, built by its own build script with its own esbuild,
// the stand's addresses substituted at build time (rules.ts) — the checkout is
// never changed. Run on the machine that has the old checkout installed (its
// node_modules), never inside the e2e container:
//
//   pnpm --filter @cg/testing exec tsx e2e/perf/fansly/old-build/build.ts \
//     --source <fansly-chat checkout at a release tag, `pnpm install`ed> \
//     --out <dir> [--served <the served XPI of that release>] [--build-time <ISO stamp>] [--commit <sha>]
//
// It builds twice:
// 1. release-equivalent — no rules, the served release's build stamp: with
//    --served every file of it must equal the served XPI's byte for byte
//    (signature aside; the manifest as JSON — signing drops its final newline) —
//    what is measured is what chatters run;
// 2. test — the rules (each must meet its count) and the test manifest; its
//    bundles must equal the release-equivalent ones once both have every
//    address of the rules masked — the build changes addresses and nothing else.
// Out: <out>/release/, <out>/stand/, <out>/old-fansly-<version>-stand.xpi and
// <out>/build.json (version, commit, ports, rule counts, file hashes).

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { FANSLY_PERF_PORTS } from '../ports';
import { LIVE_ADDRESS_PATTERNS, RULES_RELEASE, standManifest, standRules, type SourceRule } from './rules';

const HOOKS = fileURLToPath(new URL('./hooks.mjs', import.meta.url));

const { values } = parseArgs({
  options: { source: { type: 'string' }, out: { type: 'string' }, served: { type: 'string' }, 'build-time': { type: 'string' }, commit: { type: 'string' } },
});

function fail(message: string): never {
  process.stderr.write(`old-build: ${message}\n`);
  process.exit(1);
}

if (values.source === undefined || values.out === undefined) fail('usage: build.ts --source <checkout> --out <dir> [--served <xpi>] [--build-time <ISO>]');
const source = resolve(values.source);
const out = resolve(values.out);

const pkg = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')) as { version: string };
if (pkg.version !== RULES_RELEASE) fail(`the checkout is ${pkg.version}; rules.ts was read against ${RULES_RELEASE} — read the new release's addresses first`);
if (!existsSync(join(source, 'node_modules', 'esbuild'))) fail(`${source} has no node_modules: run \`pnpm install --frozen-lockfile\` there`);

/** Every file under `dir`, relative, sorted. */
function filesOf(dir: string): string[] {
  const found: string[] = [];
  const walk = (at: string): void => {
    for (const name of readdirSync(at)) {
      const path = join(at, name);
      if (statSync(path).isDirectory()) walk(path);
      else found.push(relative(dir, path));
    }
  };
  walk(dir);
  return found.sort();
}

const sha256 = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');

// The served XPI: its files, and the build stamp its bundles carry.
let served: string | null = null;
if (values.served !== undefined) {
  served = mkdtempSync(join(tmpdir(), 'old-fansly-served-'));
  execFileSync('unzip', ['-q', resolve(values.served), '-d', served]);
}
const stampOf = (dir: string): string | null => /"(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z)"/.exec(readFileSync(join(dir, 'background.js'), 'utf8'))?.[1] ?? null;
const buildTime = values['build-time'] ?? (served === null ? null : stampOf(served));
if (buildTime === null) fail('no build stamp: pass --served <xpi> (its stamp is read) or --build-time <ISO>');

// The rules must meet the source exactly where they were read.
const rules = standRules(FANSLY_PERF_PORTS);
for (const rule of rules) {
  const text = readFileSync(join(source, rule.file), 'utf8');
  const found = text.split(rule.from).length - 1;
  if (found !== rule.count) fail(`${rule.file}: ${JSON.stringify(rule.from)} stands ${String(found)} times, the rule expects ${String(rule.count)}`);
}

/** Runs the checkout's own build script under the shim; returns a copy of its dist. */
function runBuild(name: string, buildRules: readonly SourceRule[]): { dir: string; ledger: Array<{ file: string; from: string; found: number }> } {
  const ledger = join(out, `${name}.ledger.jsonl`);
  rmSync(ledger, { force: true });
  writeFileSync(ledger, '');
  const run = spawnSync(process.execPath, ['--import', HOOKS, 'esbuild.config.mjs'], {
    cwd: source,
    env: { ...process.env, CG_OLD_FANSLY_BUILD: JSON.stringify({ source, buildTime, rules: buildRules, ledger }) },
    stdio: 'inherit',
  });
  if (run.status !== 0) fail(`the ${name} build failed (exit ${String(run.status)})`);
  const dir = join(out, name);
  rmSync(dir, { recursive: true, force: true });
  cpSync(join(source, 'dist'), dir, { recursive: true });
  const lines = readFileSync(ledger, 'utf8').split('\n').filter((line) => line !== '');
  rmSync(ledger);
  return { dir, ledger: lines.map((line) => JSON.parse(line) as { file: string; from: string; found: number }) };
}

mkdirSync(out, { recursive: true });

// 1. Release-equivalent.
const release = runBuild('release', []);
const releaseFiles = filesOf(release.dir);
const servedCheck: { compared: number; differing: string[]; missing: string[]; extra: string[] } | null =
  served === null
    ? null
    : (() => {
        const servedFiles = filesOf(served).filter((file) => !file.startsWith('META-INF'));
        // Signing rewrites the manifest without its final newline: it is compared as JSON, every other file by its bytes.
        const same = (file: string): boolean => {
          const [ours, theirs] = [readFileSync(join(release.dir, file)), readFileSync(join(served, file))];
          return file === 'manifest.json' ? JSON.stringify(JSON.parse(ours.toString('utf8'))) === JSON.stringify(JSON.parse(theirs.toString('utf8'))) : ours.equals(theirs);
        };
        const differing = releaseFiles.filter((file) => servedFiles.includes(file) && !same(file));
        return { compared: servedFiles.length, differing, missing: servedFiles.filter((file) => !releaseFiles.includes(file)), extra: releaseFiles.filter((file) => !servedFiles.includes(file)) };
      })();
if (servedCheck !== null && (servedCheck.differing.length > 0 || servedCheck.missing.length > 0 || servedCheck.extra.length > 0)) {
  fail(`the release-equivalent build is not the served XPI: ${JSON.stringify(servedCheck)}`);
}

// 2. Test: the rules, then the test manifest.
const stand = runBuild('stand', rules);
for (const rule of rules) {
  const loads = stand.ledger.filter((entry) => entry.file === rule.file && entry.from === rule.from);
  if (loads.length === 0) fail(`${rule.file} was never loaded by the build: the rule ${JSON.stringify(rule.from)} did nothing`);
  const wrong = loads.find((entry) => entry.found !== rule.count);
  if (wrong !== undefined) fail(`${rule.file}: a load met ${JSON.stringify(rule.from)} ${String(wrong.found)} times, not ${String(rule.count)}`);
}
const releasedManifest = JSON.parse(readFileSync(join(release.dir, 'manifest.json'), 'utf8')) as Record<string, unknown>;
writeFileSync(join(stand.dir, 'manifest.json'), `${JSON.stringify(standManifest(releasedManifest), null, 2)}\n`);

// The bundles differ by the rules' addresses only, and no live address is left in them.
const bundles = releaseFiles.filter((file) => file.endsWith('.js'));
/** The addresses inside a rule's text: its quoted parts (a quote may open and not close), or all of it. */
const atomsOf = (text: string): string[] => {
  const quoted = [...text.matchAll(/['`]([^'`]*)['`]?/g)].map((match) => match[1] ?? '');
  return quoted.length > 0 ? quoted : [text];
};
const masks = [...new Set(rules.flatMap((rule) => [...atomsOf(rule.from), ...atomsOf(rule.to)]))].filter((atom) => atom !== '').sort((a, b) => b.length - a.length);
const mask = (text: string): string => masks.reduce((masked, address) => masked.split(address).join('§'), text);
const changed: string[] = [];
for (const file of bundles) {
  const before = readFileSync(join(release.dir, file), 'utf8');
  const after = readFileSync(join(stand.dir, file), 'utf8');
  if (before !== after) changed.push(file);
  if (mask(before) !== mask(after)) fail(`${file}: the test build differs from the release beyond the rules' addresses`);
  const live = LIVE_ADDRESS_PATTERNS.filter((pattern) => pattern.test(after));
  if (live.length > 0) fail(`${file}: a live address is left: ${live.map(String).join(', ')}`);
}
const nonBundles = releaseFiles.filter((file) => !file.endsWith('.js') && !file.endsWith('.js.map') && file !== 'manifest.json');
for (const file of nonBundles) {
  if (!readFileSync(join(release.dir, file)).equals(readFileSync(join(stand.dir, file)))) fail(`${file}: differs between the builds`);
}

// The XPI: the test build's files, sorted, no extra attributes.
const xpi = join(out, `old-fansly-${pkg.version}-stand.xpi`);
rmSync(xpi, { force: true });
execFileSync('zip', ['-X', '-q', '-D', xpi, ...filesOf(stand.dir)], { cwd: stand.dir });

// A checkout names its own commit; an exported tree (`git archive`) has none, and says it with --commit.
const commit = values.commit ?? (existsSync(join(source, '.git')) ? execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() : null);
const record = {
  version: pkg.version,
  commit,
  buildTime,
  esbuild: (JSON.parse(readFileSync(join(source, 'node_modules', 'esbuild', 'package.json'), 'utf8')) as { version: string }).version,
  node: process.version,
  ports: FANSLY_PERF_PORTS,
  served: values.served === undefined ? null : { xpi: values.served, sha256: sha256(readFileSync(resolve(values.served))), ...servedCheck },
  rules: rules.map((rule) => ({ file: rule.file, from: rule.from, to: rule.to, count: rule.count })),
  changedBundles: changed,
  xpi: { file: relative(out, xpi), sha256: sha256(readFileSync(xpi)) },
  files: Object.fromEntries(filesOf(stand.dir).map((file) => [file, sha256(readFileSync(join(stand.dir, file)))])),
};
writeFileSync(join(out, 'build.json'), `${JSON.stringify(record, null, 2)}\n`);
if (served !== null) rmSync(served, { recursive: true, force: true });
process.stdout.write(
  `old-build: ${pkg.version} → ${xpi}\n  release-equivalent = served XPI: ${servedCheck === null ? 'not checked' : `${String(servedCheck.compared)} files, byte for byte`}\n  changed bundles: ${changed.join(', ')}\n`,
);
