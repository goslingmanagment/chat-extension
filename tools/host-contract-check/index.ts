// `node tools/host-contract-check/index.ts [--host chatspace|fansly] [--dir <copy>] [--against <other copy>] [--json]`
//
// --host is a site of the host registry (apps/extension/src/hosts; default
// chatspace), by its kind or its platform (`--host fansly`): its entry names
// the module of its anchors and the variable with the root of its copies.
// ChatSpace's anchors are check.ts's; Fansly's are anchors-fansly.ts's (R20
// P7h). The modules are loaded through jiti: the contracts they read the
// report by use extensionless imports, which plain Node does not resolve.
//
// Checks the site's host contract against a LOCAL copy of its bundles and
// prints what is present and what is missing, with the build of the copy.
// Local only: it is not part of `pnpm check` and never runs in CI — the
// bundles are the sites' code and stay outside the repository (ChatSpace:
// README.md of the copy; Fansly: docs/research/fansly.md). CI checks
// synthetic copies (check.test.ts, anchors-fansly.test.ts).
//
// --dir is the folder with the copy's files (its `pretty/` folder). Without
// it: the newest copy under the site's variable (`contractCheck.bundlesRootEnv`;
// ChatSpace: $CG_CHATSPACE_BUNDLES, its version folders; Fansly:
// $CG_FANSLY_BUNDLES, its folders named by the date of the copy, or the copy
// itself), the root of the copies (docs/architecture.md §6.2 and
// docs/research/fansly.md say where they live; the paths are not repeated
// here — the sources archive carries no trace of the copies).
//
// ChatSpace (architecture.md §6.2): the anchors, the receipt-profile
// fingerprint of the copy and, with --against, what changed in the send path
// between two copies. Exit code: 0 — every anchor present, every role module
// found, the send path's anchors only in the role modules and the telemetry
// tripwire quiet; 1 — an anchor or a role module missing, or the send path
// outside the role modules; 2 — those hold, but the telemetry tripwire fired
// (read the new code before the next pilot day). The telemetry tripwire
// (telemetry.ts, decision X22): Sentry Replay, tracing, new integrations or
// init options, or code that looks for extensions, counted against the
// 0.195.0 baseline (or the --against copy).
//
// Fansly (docs/project-unite/architecture.md §7.12, FS-CTR-3 — a new `main.*`
// hash in client_health is the signal to run it on a fresh copy): the strings
// of every anchor of its contract, then the report the adapter would make on a
// page of this build, read by Fansly's expected set as the tab's log reads it.
// Exit code: 0 — green, every anchor of the 17 ok; 1 — not green.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { parseArgs } from 'node:util';

import { createJiti } from 'jiti';

import { HOSTS } from '../../apps/extension/src/hosts/index.ts';
import type { HostDescriptor } from '../../apps/extension/src/hosts/types.ts';
import type { HostKind } from '../../packages/contracts/src/hosts.ts';
import { fail } from '../lib/paths.ts';
import type * as FanslyModule from './anchors-fansly.ts';
import type * as CheckModule from './check.ts';
import { TELEMETRY_BASELINE, telemetryCounts, telemetryTripwire } from './telemetry.ts';

const { values } = parseArgs({ options: { host: { type: 'string', default: 'chatspace' }, dir: { type: 'string' }, against: { type: 'string' }, json: { type: 'boolean', default: false } } });

const jiti = createJiti(import.meta.url);

/**
 * The copies of a site under the root of its variable, each a folder with `pretty/`: ChatSpace's named by the version
 * (newest — the highest), Fansly's by the date of the copy at the end of the name (newest — the latest); a Fansly
 * variable may name one copy itself.
 */
const COPIES: Readonly<Record<HostKind, { readonly key: (name: string) => string | null; readonly what: string; readonly itself: boolean }>> = {
  chatspace: { key: (name) => (/^\d+\.\d+\.\d+$/.test(name) ? name : null), what: 'version folders', itself: false },
  'fansly-web': { key: (name) => /\d{4}-\d{2}-\d{2}$/.exec(name)?.[0] ?? null, what: 'folders named by the date of the copy', itself: true },
};

function newestCopy(host: HostDescriptor): string {
  const rootEnv = host.contractCheck.bundlesRootEnv;
  const root = process.env[rootEnv];
  if (root === undefined || root === '') fail(`host-contract-check: pass --dir <copy>, or set ${rootEnv} to the root of the local bundle copies.`);
  if (!existsSync(root)) fail(`host-contract-check: no bundle copies at ${root}.`);
  const rule = COPIES[host.kind];
  if (rule.itself && existsSync(join(root, 'pretty'))) return join(root, 'pretty');
  const copies = readdirSync(root)
    .flatMap((name) => {
      const key = rule.key(name);
      return key !== null && statSync(join(root, name)).isDirectory() && existsSync(join(root, name, 'pretty')) ? [{ name, key }] : [];
    })
    .sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
  const newest = copies.at(-1);
  if (newest === undefined) fail(`host-contract-check: no ${rule.what} with a pretty/ folder under ${root}.`);
  return join(root, newest.name, 'pretty');
}

function readFiles(dir: string, take: (name: string) => boolean = () => true): { name: string; text: string }[] {
  if (!existsSync(dir)) fail(`host-contract-check: ${dir} does not exist.`);
  return readdirSync(dir)
    .filter((name) => /\.(js|css|html)$/.test(name) && take(name))
    .map((name) => ({ name, text: readFileSync(join(dir, name), 'utf8') }));
}

async function checkChatSpace(host: HostDescriptor): Promise<void> {
  const { buildOf, checkAnchors, diffCopies, missingRoles, receiptProfile, sendPathOutsideRoles } = await jiti.import<typeof CheckModule>('./check.ts');

  const readCopy = (dir: string): { files: CheckModule.BundleFile[]; build: string | null; version: string | null } => {
    const files = readFiles(dir);
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
  };

  const dir = values.dir ?? newestCopy(host);
  const copy = readCopy(dir);
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
}

async function checkFansly(host: HostDescriptor): Promise<void> {
  if (values.against !== undefined) fail('host-contract-check: --against compares the send path and the telemetry of two ChatSpace copies; Fansly has neither here — run the check on each copy.');
  const { checkFanslyCopy, isAppScript } = await jiti.import<typeof FanslyModule>('./anchors-fansly.ts');
  const dir = values.dir ?? newestCopy(host);
  const files = readFiles(dir, isAppScript);
  const others = readdirSync(dir).filter((name) => /\.(js|css|html)$/.test(name) && !isAppScript(name)).length;
  const check = checkFanslyCopy(files, Date.now());
  const { verdict } = check;

  if (values.json) {
    console.log(JSON.stringify({ dir, build: check.build, anchors: check.anchors, strings: check.strings, report: check.report, verdict }, null, 2));
  } else {
    console.log(`host-contract-check --host fansly: ${dir}`);
    console.log(`build ${check.build ?? 'unknown'}; ${files.length} script(s) of the app read, ${others} other file(s) not\n`);
    for (const { anchor, state } of check.anchors) {
      const strings = check.strings.filter((result) => result.group === anchor);
      console.log(`[${anchor}] ${state === 'ok' ? 'ok' : 'MISSING'}${strings.length === 0 ? ' — the set has no string for it' : ''}`);
      for (const result of strings) {
        console.log(`  ${result.present ? 'present' : 'MISSING'}  ${result.id.padEnd(64)} ${result.present ? `${result.at.join(', ')}${result.count > result.at.length ? ` (+${result.count - result.at.length})` : ''}` : ''}`);
      }
    }
    const facts = verdict.facts;
    console.log(`\nthe adapter's report for a page of this build, read by Fansly's expected set (contractFactsOf, FANSLY_CONTRACT):`);
    console.log(`  build ${facts?.build ?? 'unknown'}, adapter ${facts?.adapterVersion ?? 'unknown'}`);
    for (const problem of verdict.problems) console.log(`  ${problem}`);
    console.log(`\n${verdict.green ? `green: every one of the ${check.anchors.length} anchors is ok` : `NOT green: ${check.anchors.filter((item) => item.state !== 'ok').length} anchor(s) missing`}.`);
  }
  if (!verdict.green) process.exit(1);
}

/** Each site's check: a new site of the registry brings its own. */
const CHECKS: Readonly<Record<HostKind, (host: HostDescriptor) => Promise<void>>> = { chatspace: checkChatSpace, 'fansly-web': checkFansly };

const host = HOSTS.find((item) => item.kind === values.host || item.platform === values.host);
if (host === undefined) fail(`host-contract-check: --host ${values.host} is not a site of the host registry (${HOSTS.map((item) => `${item.kind} or ${item.platform}`).join('; ')}).`);
await CHECKS[host.kind](host);
