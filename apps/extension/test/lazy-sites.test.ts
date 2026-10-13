// The sites' lazy builds are separate (docs/project-unite/architecture.md §3.2,
// R20 F2b): a second site's entry, its own error and its own schema never move
// a byte of ChatSpace's chunks. Real builds through the build's own function
// (lazy/vite.config.ts), into temp dirs: ChatSpace alone, ChatSpace with a
// second site beside it, and — the reason the builds are separate — ChatSpace's
// build with that entry inside it.

import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildLazyChunks, buildLazySite, type LazyChunkInfo } from '../lazy/vite.config.ts';
import { lazySitesOf, type LazySite } from '../src/hosts/index.ts';

const [CHATSPACE_SITE] = lazySitesOf(false);
if (CHATSPACE_SITE === undefined) throw new Error('the registry has ChatSpace');

/** A second site's build: the fictitious panel (test/fixtures/second-site) with its own error and schema. */
const PANEL = fileURLToPath(new URL('./fixtures/second-site/panel.ts', import.meta.url));
const SECOND: LazySite = { site: 'fansly-web', build: { root: 'lazy/second', entries: { panel: PANEL }, layers: [], beforeTheDock: [] }, matches: ['http://localhost/*'] };

interface Built {
  readonly dir: string;
  readonly chunks: readonly LazyChunkInfo[];
}

const dirs: string[] = [];
async function built(name: string, run: (dir: string) => Promise<LazyChunkInfo[]>): Promise<Built> {
  const dir = mkdtempSync(join(tmpdir(), `cg-lazy-sites-${name}-`));
  dirs.push(dir);
  return { dir, chunks: await run(dir) };
}

/** Every file under `dir`, paths relative to it. */
const listTree = (dir: string): string[] =>
  readdirSync(dir)
    .flatMap((name) => (statSync(join(dir, name)).isDirectory() ? listTree(join(dir, name)).map((child) => `${name}/${child}`) : [name]))
    .sort();

/** Every file of a build's folder by its path inside the extension, with its sha256. */
const hashes = (out: Built, root: string): Record<string, string> =>
  Object.fromEntries(listTree(join(out.dir, root)).map((file) => [`${root}/${file}`, createHash('sha256').update(readFileSync(join(out.dir, root, file))).digest('hex')]));
const textOf = (out: Built, root: string): string =>
  listTree(join(out.dir, root))
    .map((file) => readFileSync(join(out.dir, root, file), 'utf8'))
    .join('\n');

let alone: Built;
let beside: Built;
let inside: Built;

beforeAll(async () => {
  alone = await built('alone', (dir) => buildLazyChunks(dir, [CHATSPACE_SITE]));
  beside = await built('beside', (dir) => buildLazyChunks(dir, [CHATSPACE_SITE, SECOND]));
  inside = await built('inside', (dir) => buildLazySite(dir, { ...CHATSPACE_SITE, build: { ...CHATSPACE_SITE.build, entries: { ...CHATSPACE_SITE.build.entries, panel: PANEL } } }));
}, 180_000);

afterAll(() => {
  for (const dir of dirs) for (const path of [dir, `${dir}.lazy-chunks.json`]) rmSync(path, { recursive: true, force: true });
});

describe('the sites’ lazy builds (R20 F2b)', () => {
  const root = CHATSPACE_SITE.build.root;

  it('a second site’s entry, its error and its schema built beside ChatSpace change no byte of ChatSpace’s chunks', () => {
    const own = hashes(alone, root);
    expect(Object.keys(own).length).toBeGreaterThan(20);
    expect(hashes(beside, root)).toEqual(own);
    // The chunk graph of ChatSpace — files, imports, layers — is the same too.
    expect(beside.chunks.filter((chunk) => chunk.site === CHATSPACE_SITE.site)).toEqual(alone.chunks);
    // The second build is its own folder, its own error and schema in it and nowhere in ChatSpace's.
    const second = beside.chunks.filter((chunk) => chunk.site === SECOND.site);
    expect(second.length).toBeGreaterThan(0);
    for (const chunk of second) expect(chunk.file.startsWith(`${SECOND.build.root}/`), chunk.file).toBe(true);
    expect(textOf(beside, SECOND.build.root)).toContain('CG-SITEFIX-NOTES');
    expect(textOf(beside, SECOND.build.root)).toContain('sitefix.batch');
    expect(textOf(beside, root)).not.toMatch(/CG-SITEFIX|sitefix\.batch/);
    // The chunk list the size budgets read is written beside the extension dir.
    expect(JSON.parse(readFileSync(`${beside.dir}.lazy-chunks.json`, 'utf8'))).toEqual(beside.chunks);
  });

  it('the same entry inside ChatSpace’s build moves ChatSpace’s bytes: why every site has a build of its own', () => {
    const own = hashes(alone, root);
    const shared = hashes(inside, root);
    const changed = Object.keys(own).filter((file) => shared[file] !== own[file]);
    expect(changed.length).toBeGreaterThan(0);
  });
});
