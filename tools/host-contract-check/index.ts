// `node tools/host-contract-check/index.ts [--host chatspace|fansly] [--dir <copy>] [--against <other copy>] [--json]`
//
// --host is a site of the host registry (apps/extension/src/hosts; default
// chatspace): its entry names the contract module and the variable with the
// root of its copies. `--host fansly` (alias of fansly-web) selects P7h's
// anchors and main.<hash>; no ChatSpace receipt or telemetry verdict applies.
//
// Checks the ChatSpace host contract (packages/host-chatspace/src/isolated/
// host-contract.ts) against a LOCAL copy of ChatSpace's bundles and prints
// what is present and what is missing, the build, and the receipt-profile
// fingerprint of that copy (architecture.md §6.2). With --against it also
// prints what changed in the send path between two copies. Local only: it is
// not part of `pnpm check` and never runs in CI — the bundles are OnlyMonster's
// code and stay outside the repository (README.md of the copy).
//
// --dir is the folder with the copy's files (its `pretty/` folder). Without
// it: the newest version folder under the site's variable
// (`contractCheck.bundlesRootEnv`; ChatSpace: $CG_CHATSPACE_BUNDLES), the root
// of the copies (docs/architecture.md §6.2 says where it lives; the path is
// not repeated here — the sources archive carries no trace of the copy).
// Exit code: 0 — every anchor present, every role module found, the send
// path's anchors only in the role modules and the telemetry tripwire quiet;
// 1 — an anchor or a role module missing, or the send path outside the role
// modules; 2 — those hold, but the telemetry tripwire fired (read the new
// code before the next pilot day).
//
// The telemetry tripwire (telemetry.ts, decision X22): Sentry Replay,
// tracing, new integrations or init options, or code that looks for
// extensions, counted against the 0.195.0 baseline (or the --against copy).

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { parseArgs } from 'node:util';

import { createJiti } from 'jiti';

import { HOSTS, hostOf } from '../../apps/extension/src/hosts/index.ts';
import { fail } from '../lib/paths.ts';
import type * as FanslyModule from './anchors-fansly.ts';
import { buildOf, checkAnchors, diffAnchorPresence, diffCopies, missingRoles, receiptProfile, sendPathOutsideRoles, type BundleFile } from './check.ts';
import { TELEMETRY_BASELINE, telemetryCounts, telemetryTripwire } from './telemetry.ts';

const { values } = parseArgs({ options: { host: { type: 'string', default: 'chatspace' }, dir: { type: 'string' }, against: { type: 'string' }, json: { type: 'boolean', default: false } } });

/** The sites whose anchors this tool knows (check.ts, telemetry.ts); another site's come with its own module. */
const CHECKED_HOSTS: readonly string[] = ['chatspace', 'fansly-web'];
const host = hostOf(values.host === 'fansly' ? 'fansly-web' : values.host);
if (host === undefined) fail(`host-contract-check: --host ${values.host} is not a site of the host registry (${HOSTS.map((item) => item.kind).join(', ')}).`);
if (!CHECKED_HOSTS.includes(host.kind)) fail(`host-contract-check: no anchors for ${host.kind} yet (its contract: ${host.contractCheck.module}).`);
const rootEnv = host.contractCheck.bundlesRootEnv;

function newestCopy(): string {
  const root = process.env[rootEnv];
  if (root === undefined || root === '') fail(`host-contract-check: pass --dir <copy>, or set ${rootEnv} to the root of the local bundle copies (docs/architecture.md §6.2).`);
  if (!existsSync(root)) fail(`host-contract-check: no bundle copies at ${root}.`);
  if (host?.kind === 'fansly-web') {
    // Fansly snapshots are dated, not semver releases. The variable may also name one snapshot or its pretty/.
    if (existsSync(join(root, 'pretty'))) return join(root, 'pretty');
    if (readdirSync(root).some((name) => /^main\.[0-9a-f]{8,32}\.js$/.test(name))) return root;
    const dated = readdirSync(root).filter((name) => /\d{4}-\d{2}-\d{2}$/.test(name) && existsSync(join(root, name, 'pretty'))).sort((a, b) => a.slice(-10).localeCompare(b.slice(-10)));
    const newest = dated.at(-1);
    if (newest === undefined) fail(`host-contract-check: no dated snapshots under ${root}; pass --dir <snapshot/pretty>.`);
    return join(root, newest, 'pretty');
  }
  const versions = readdirSync(root)
    .filter((name) => /^\d+\.\d+\.\d+$/.test(name) && statSync(join(root, name)).isDirectory())
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const newest = versions.at(-1);
  if (newest === undefined) fail(`host-contract-check: no version folders under ${root}.`);
  return join(root, newest, 'pretty');
}

function readCopy(dir: string): { files: BundleFile[]; build: string | null; version: string | null } {
  if (!existsSync(dir)) fail(`host-contract-check: ${dir} does not exist.`);
  const names = readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(js|css|html)$/.test(entry.name))
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)))
    .sort();
  const files = names.map((name) => ({ name, text: readFileSync(join(dir, name), 'utf8') }));
  const index = files.find((file) => file.name === 'index.html');
  // The copy's own manifest (one level up) names the version; else the folder does.
  let version: string | null = /^\d+\.\d+\.\d+$/.test(basename(dirname(dir))) ? basename(dirname(dir)) : null;
  try {
    const manifest = JSON.parse(readFileSync(join(dirname(dir), 'manifest.json'), 'utf8')) as { version?: unknown };
    if (typeof manifest.version === 'string') version = manifest.version;
  } catch {
    // No manifest: the folder name, or unknown.
  }
  return { files, build: index ? buildOf(index.text) : null, version };
}

const dir = values.dir ?? newestCopy();
const copy = readCopy(dir);
if (host.kind === 'fansly-web') {
  // The package sources use extensionless imports. jiti resolves them for Node, as in tools/cg-registry.
  const { fanslyAnchors, fanslyBuildOf } = await createJiti(import.meta.url).import<typeof FanslyModule>('./anchors-fansly.ts');
  const anchors = fanslyAnchors();
  const results = checkAnchors(copy.files, anchors);
  const build = fanslyBuildOf(copy.files);
  const missing = results.filter((result) => !result.present);
  const against = values.against === undefined ? null : readCopy(values.against);
  const diff = against === null ? null : { build: { from: fanslyBuildOf(against.files), to: build }, anchors: diffAnchorPresence(against.files, copy.files, anchors) };
  if (values.json) {
    console.log(JSON.stringify({ host: host.kind, dir, build, anchors: results, missing: missing.map((anchor) => anchor.id), diff }, null, 2));
  } else {
    console.log(`host-contract-check: ${host.kind}, ${dir}\nbuild ${build ?? 'unknown'}, ${copy.files.length} files`);
    for (const result of results) console.log(`  ${result.present ? 'present' : 'MISSING'}  ${result.id}  ${result.at.join(', ')}`);
    if (diff !== null) {
      console.log(`against ${values.against}: build ${diff.build.from ?? 'unknown'} → ${diff.build.to ?? 'unknown'}`);
      for (const change of diff.anchors) console.log(`  ${change.id}: ${change.from ? 'present' : 'missing'} → ${change.to ? 'present' : 'MISSING'}`);
    }
    console.log(missing.length === 0 ? 'every anchor is present; static evidence only — DOM hierarchy and runtime behaviour need their own checks.' : `${missing.length} anchor probe(s) MISSING`);
  }
  process.exit(missing.length === 0 ? 0 : 1);
}
const results = checkAnchors(copy.files);
const scripts = copy.files.filter((file) => file.name.endsWith('.js')).map((file) => file.name);
const profile = receiptProfile(scripts, copy.version);
const noRole = missingRoles(profile.modules);
const sendPath = sendPathOutsideRoles(copy.files);
const against = values.against !== undefined ? readCopy(values.against) : null;
const diff = against !== null ? diffCopies(against.files, copy.files) : null;
const missing = results.filter((result) => !result.present);
const tripwireBase = against !== null ? { version: against.version ?? values.against ?? 'the other copy', counts: telemetryCounts(against.files).counts } : TELEMETRY_BASELINE;
const tripwire = telemetryTripwire(copy.files, tripwireBase.counts);

if (values.json) {
  console.log(JSON.stringify({ dir, version: copy.version, build: copy.build, anchors: results, receiptProfile: profile, missingRoles: noRole, sendPathOutsideRoles: sendPath, diff, telemetry: { baseline: tripwireBase.version, warnings: tripwire } }, null, 2));
} else {
  console.log(`host-contract-check: ${dir}`);
  console.log(`version ${copy.version ?? 'unknown'}, build ${copy.build ?? 'unknown'}, ${copy.files.length} files\n`);
  let group = '';
  for (const result of [...results].sort((a, b) => a.group.localeCompare(b.group))) {
    if (result.group !== group) console.log(`[${(group = result.group)}]`);
    console.log(`  ${result.present ? 'present' : 'MISSING'}  ${result.id.padEnd(44)} ${result.present ? `${result.at.join(', ')}${result.count > result.at.length ? ` (+${result.count - result.at.length})` : ''}` : ''}`);
  }
  console.log('\nreceipt profile of this copy (the role modules of the send path, §6.2):');
  console.log(JSON.stringify(profile, null, 2));
  if (noRole.length > 0) console.log(`MISSING role modules: ${noRole.join(', ')} — this build matches no profile; the send path must be read again.`);
  if (sendPath.length === 0) console.log('send path: every one of its anchors is in the role modules.');
  for (const problem of sendPath) {
    const where = problem.at.length === 0 ? 'found nowhere' : `outside the role modules: ${problem.at.join(', ')}${problem.count > problem.at.length ? ` (+${problem.count - problem.at.length})` : ''}`;
    console.log(`SEND PATH ${problem.part}: ${problem.anchor} — ${where}`);
  }
  if (sendPath.length > 0) console.log('the send path is not where the profile looks: the bundler regrouped or changed it, and a profile of this adapter would leave it out — the role list needs an adapter release (§6.2 «Перегруппировка модулей»).');
  if (diff) {
    console.log(`\nagainst ${values.against}:`);
    console.log(diff.roles.length === 0 ? '  role modules: unchanged' : diff.roles.map((change) => `  role ${change.role}: ${change.from ?? '—'} → ${change.to ?? '—'}`).join('\n'));
    for (const change of diff.imports) console.log(`  import of ${change.role}: ${change.module} ${change.from ?? '—'} → ${change.to ?? '—'}`);
    for (const change of diff.anchors) console.log(`  anchor ${change.id}: ${change.from ? 'present' : 'missing'} → ${change.to ? 'present' : 'MISSING'}`);
    // The code around the anchors inside the role modules, by shape: where to look when a big shared module changed its hash.
    const moved = diff.code.filter((item) => item.changed.length > 0);
    console.log(`  code around the anchors in the role modules: ${diff.code.reduce((sum, item) => sum + item.same, 0)} place(s) unchanged, ${moved.reduce((sum, item) => sum + item.changed.length, 0)} changed`);
    for (const item of moved) console.log(`    ${item.role}: ${item.anchor} — ${item.changed.slice(0, 6).join(', ')}${item.changed.length > 6 ? ` (+${item.changed.length - 6})` : ''}`);
  }
  console.log(`\ntelemetry tripwire against ${tripwireBase.version} (decision X22):`);
  if (tripwire.length === 0) console.log('  quiet: no new Sentry integration, option, Replay or tracing, no new look for extensions');
  for (const warning of tripwire) console.log(`  WARN ${warning.key}: ${warning.from} → ${warning.to} — ${warning.what}${warning.at.length > 0 ? ` (${warning.at.join(', ')})` : ''}`);
  const verdict =
    noRole.length > 0 || sendPath.length > 0
      ? 'the profile above is NOT a candidate: this adapter does not read the send path of this build (§6.2).'
      : 'the profile above is a candidate — it goes into the hub only after the send path of this build was read (§6.2).';
  console.log(`\n${missing.length === 0 ? 'every anchor is present' : `${missing.length} anchor(s) MISSING`}; ${verdict}`);
}
if (missing.length > 0 || noRole.length > 0 || sendPath.length > 0) process.exit(1);
if (tripwire.length > 0) process.exit(2);
