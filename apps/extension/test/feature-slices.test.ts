// A site's bundles carry its own slice of the feature manifest and nothing of another site's
// (docs/project-unite/architecture.md §1.4, §3.2; R20 F4): the slice is cut by the module graph — a site's
// composition root imports the common file and its OWN site file — so an entry added only to
// `contracts/src/features/fansly.ts` moves no byte of ChatSpace.
//
// Real builds through the build's own function (lazy/vite.config.ts), into temp dirs, as lazy-sites.test.ts does:
// ChatSpace's lazy chunks as they are, and again with a plugin that writes one more entry into the Fansly file —
// the same bytes, and the plugin never sees the file, because ChatSpace's graph does not have it. The same plugin
// on a second site's build that does carry the Fansly file changes that build: the plugin is not a no-op.

import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildLazySite, type LazyChunkInfo } from '../lazy/vite.config.ts';
import { lazySitesOf, type LazySite } from '../src/hosts/index.ts';

const [CHATSPACE_SITE] = lazySitesOf(false);
if (CHATSPACE_SITE === undefined) throw new Error('the registry has ChatSpace');

/** A second site's build whose one entry carries that site's slice of the manifest (test/fixtures/second-site/features.ts). */
const SLICE = fileURLToPath(new URL('./fixtures/second-site/features.ts', import.meta.url));
const SECOND: LazySite = { site: 'fansly-web', build: { root: 'lazy/second', entries: { features: SLICE }, layers: [], beforeTheDock: [] }, matches: ['http://localhost/*'] };

const FANSLY_FILE = /\/packages\/contracts\/src\/features\/fansly\.ts$/;
const TABLE_START = 'const FEATURES = {\n';
/** One more feature of Fansly alone, as a PR of recipe 2 (architecture §1.7) would add it. */
const NEW_ENTRY = "  'sitefix-album': { kind: 'panel', base: { flags: ['vault'], hostCapabilities: ['vault'] }, actions: {}, surfaces: ['vault'], source: 'host-pass' },\n";

/** Writes NEW_ENTRY into the Fansly file of the manifest for one build, and counts how often the build loaded that file. */
function newFanslyEntry(): { readonly plugin: { name: string; enforce: 'pre'; transform(code: string, id: string): string | null }; seen(): number } {
  let seen = 0;
  return {
    plugin: {
      name: 'cg-test-new-fansly-entry',
      enforce: 'pre',
      transform(code, id) {
        if (!FANSLY_FILE.test(id.split('?')[0] ?? id)) return null;
        if (!code.includes(TABLE_START)) throw new Error('features/fansly.ts: the table does not start as this test expects');
        seen += 1;
        return code.replace(TABLE_START, `${TABLE_START}${NEW_ENTRY}`);
      },
    },
    seen: () => seen,
  };
}

interface Built {
  readonly dir: string;
  readonly chunks: readonly LazyChunkInfo[];
}

const dirs: string[] = [];
async function built(name: string, site: LazySite, plugins?: Parameters<typeof buildLazySite>[2]): Promise<Built> {
  const dir = mkdtempSync(join(tmpdir(), `cg-feature-slices-${name}-`));
  dirs.push(dir);
  return { dir, chunks: await buildLazySite(dir, site, plugins) };
}

const listTree = (dir: string): string[] =>
  readdirSync(dir)
    .flatMap((name) => (statSync(join(dir, name)).isDirectory() ? listTree(join(dir, name)).map((child) => `${name}/${child}`) : [name]))
    .sort();
const hashes = (out: Built, root: string): Record<string, string> =>
  Object.fromEntries(listTree(join(out.dir, root)).map((file) => [`${root}/${file}`, createHash('sha256').update(readFileSync(join(out.dir, root, file))).digest('hex')]));
const textOf = (out: Built, root: string, only: (file: string) => boolean = () => true): string =>
  listTree(join(out.dir, root))
    .filter(only)
    .map((file) => readFileSync(join(out.dir, root, file), 'utf8'))
    .join('\n');

/** What only Fansly's file of the manifest says: its own features, switches, capabilities and source. */
const FANSLY_ONLY = ['notes-fill', 'notesFill', 'via-tab', 'host-pass', 'fileAttach', 'headerSlot', 'sitefix-album'];
/** What only ChatSpace's file says. */
const CHATSPACE_ONLY = ['preview-send', 'previewSend'];

let chatspace: Built;
let chatspaceAfter: Built;
let second: Built;
let secondAfter: Built;
const overChatSpace = newFanslyEntry();
const overSecond = newFanslyEntry();

beforeAll(async () => {
  chatspace = await built('chatspace', CHATSPACE_SITE);
  chatspaceAfter = await built('chatspace-new-entry', CHATSPACE_SITE, [overChatSpace.plugin]);
  second = await built('second', SECOND);
  secondAfter = await built('second-new-entry', SECOND, [overSecond.plugin]);
}, 240_000);

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe('the feature manifest is cut by the module graph (R20 F4)', () => {
  const root = CHATSPACE_SITE.build.root;

  it('a new entry only in features/fansly.ts changes no byte of ChatSpace’s chunks: its graph does not have the file', () => {
    const own = hashes(chatspace, root);
    expect(Object.keys(own).length).toBeGreaterThan(20);
    expect(hashes(chatspaceAfter, root)).toEqual(own);
    expect(chatspaceAfter.chunks).toEqual(chatspace.chunks);
    // The build with the plugin never loaded the Fansly file: neither the plan's pass nor the build itself.
    expect(overChatSpace.seen()).toBe(0);
  });

  it('the same new entry does change a build that carries Fansly’s slice: the plugin wrote it, and the slice has it', () => {
    expect(overSecond.seen()).toBeGreaterThan(0);
    expect(hashes(secondAfter, SECOND.build.root)).not.toEqual(hashes(second, SECOND.build.root));
    expect(textOf(second, SECOND.build.root)).not.toContain('sitefix-album');
    expect(textOf(secondAfter, SECOND.build.root)).toContain('sitefix-album');
  });

  it('ChatSpace’s chunks carry ChatSpace’s slice — with the application, in `tab-app` — and no entry of Fansly', () => {
    const all = textOf(chatspace, root);
    for (const marker of FANSLY_ONLY) expect(all, marker).not.toContain(marker);
    // The slice comes with the application's half of the adapter: the dock's first chunk and the schemas' chunks do not pay for it.
    const app = textOf(chatspace, root, (file) => file === 'tab-app.js');
    for (const marker of ['hostCapabilities', 'clientNeeds', 'fresh-text', ...CHATSPACE_ONLY]) expect(app, marker).toContain(marker);
    const rest = textOf(chatspace, root, (file) => file !== 'tab-app.js');
    for (const marker of ['hostCapabilities', 'clientNeeds', 'fresh-text']) expect(rest, marker).not.toContain(marker);
  });

  it('a build with Fansly’s slice carries Fansly’s entries and nothing only ChatSpace has', () => {
    const all = textOf(second, SECOND.build.root);
    for (const marker of FANSLY_ONLY.filter((name) => name !== 'sitefix-album')) expect(all, marker).toContain(marker);
    for (const marker of CHATSPACE_ONLY) expect(all, marker).not.toContain(marker);
    // The common part is in both: it names no site.
    for (const out of [all, textOf(chatspace, root)]) expect(out).toContain('fresh-text');
  });
});
