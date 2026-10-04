// `node tools/host-contract-check/index.ts [--dir <copy>] [--against <other copy>] [--json]`
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
// it: the newest version folder under $CG_CHATSPACE_BUNDLES, the root of the
// copies (docs/architecture.md §6.2 says where it lives; the path is not
// repeated here — the sources archive carries no trace of the copy).
// Exit code: 0 — every anchor present and every role module found; 1 — not.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { parseArgs } from 'node:util';

import { fail } from '../lib/paths.ts';
import { buildOf, checkAnchors, diffCopies, missingRoles, receiptProfile, type BundleFile } from './check.ts';

const { values } = parseArgs({ options: { dir: { type: 'string' }, against: { type: 'string' }, json: { type: 'boolean', default: false } } });

function newestCopy(): string {
  const root = process.env['CG_CHATSPACE_BUNDLES'];
  if (root === undefined || root === '') fail('host-contract-check: pass --dir <copy>, or set CG_CHATSPACE_BUNDLES to the root of the local bundle copies (docs/architecture.md §6.2).');
  if (!existsSync(root)) fail(`host-contract-check: no bundle copies at ${root}.`);
  const versions = readdirSync(root)
    .filter((name) => /^\d+\.\d+\.\d+$/.test(name) && statSync(join(root, name)).isDirectory())
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const newest = versions.at(-1);
  if (newest === undefined) fail(`host-contract-check: no version folders under ${root}.`);
  return join(root, newest, 'pretty');
}

function readCopy(dir: string): { files: BundleFile[]; build: string | null; version: string | null } {
  if (!existsSync(dir)) fail(`host-contract-check: ${dir} does not exist.`);
  const names = readdirSync(dir).filter((name) => /\.(js|css|html)$/.test(name));
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
const results = checkAnchors(copy.files);
const scripts = copy.files.filter((file) => file.name.endsWith('.js')).map((file) => file.name);
const profile = receiptProfile(scripts, copy.version);
const noRole = missingRoles(profile.modules);
const diff = values.against !== undefined ? diffCopies(readCopy(values.against).files, copy.files) : null;
const missing = results.filter((result) => !result.present);

if (values.json) {
  console.log(JSON.stringify({ dir, version: copy.version, build: copy.build, anchors: results, receiptProfile: profile, missingRoles: noRole, diff }, null, 2));
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
  console.log(`\n${missing.length === 0 ? 'every anchor is present' : `${missing.length} anchor(s) MISSING`}; the profile above is a candidate — it goes into the hub only after the send path of this build was read (§6.2).`);
}
if (missing.length > 0 || noRole.length > 0) process.exit(1);
