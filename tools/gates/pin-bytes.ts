// `pnpm gates:bytes`: rewrites tools/gates/chatspace-bytes.json — the size and
// the hash of every file a ChatSpace tab and its background load, in the
// release build (`pnpm build` first) — and prints what moved.
//
// On demand only: a tool to see what a change did to ChatSpace's bundles, not
// a per-PR duty — `pnpm gates` does not compare the build with the pins.
//
// Usage: node tools/gates/pin-bytes.ts [--check]
//   --check  writes nothing; exits 1 when the pins differ from the build.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { hostOf } from '../../apps/extension/src/hosts/index.ts';
import { readTreeBytes } from '../lib/files.ts';
import { fail, RELEASE_DIR, REPO_ROOT } from '../lib/paths.ts';
import { CHATSPACE_BYTES_PATH, describeByteChange, diffSiteBytes, measureSiteBytes, parseSiteBytes, serializeSiteBytes, type SiteBytes } from './sites.ts';

const { values } = parseArgs({ options: { check: { type: 'boolean', default: false } } });

if (!existsSync(join(RELEASE_DIR, 'manifest.json'))) fail('gates:bytes: release build missing — run pnpm build first.');
const chatspace = hostOf('chatspace');
if (chatspace === undefined) fail('gates:bytes: the host registry has no ChatSpace.');

const built = measureSiteBytes(chatspace, readTreeBytes(RELEASE_DIR));
const count = Object.keys(built.files).length;
if (count === 0) fail('gates:bytes: the release build has no file of ChatSpace.');

const file = `${REPO_ROOT}${CHATSPACE_BYTES_PATH}`;
let pinned: SiteBytes = { site: built.site, files: {} };
if (existsSync(file)) {
  try {
    pinned = parseSiteBytes(readFileSync(file, 'utf8'));
  } catch (error) {
    console.warn(`gates:bytes: ${CHATSPACE_BYTES_PATH} does not read (${error instanceof Error ? error.message : String(error)}); every file counts as new.`);
  }
}

const changes = diffSiteBytes(pinned, built);
for (const change of changes) console.log(`  ${change.path}: ${describeByteChange(change)}`);
const total = (pins: SiteBytes): number => Object.values(pins.files).reduce((sum, pin) => sum + pin.bytes, 0);

if (changes.length === 0) {
  console.log(`gates:bytes: ${CHATSPACE_BYTES_PATH} is the release build — ${count} files of ChatSpace, ${total(built)} B.`);
} else if (values.check) {
  fail(`gates:bytes: ${changes.length} of ChatSpace's built files differ from ${CHATSPACE_BYTES_PATH}.`);
} else {
  writeFileSync(file, serializeSiteBytes(built));
  const delta = total(built) - total(pinned);
  console.log(`gates:bytes: wrote ${CHATSPACE_BYTES_PATH} — ${changes.length} file(s) moved, ${count} files of ChatSpace, ${total(built)} B (${delta > 0 ? '+' : ''}${delta}).`);
}
