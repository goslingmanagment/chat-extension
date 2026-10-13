// What must never ship (architecture.md §12 п. 7, §3 «pnpm check» п. 9): no
// OnlyMonster code, CSS, fonts or images, no real messages, tokens or prod
// HTML — in the XPI and in the sources archive that goes to AMO for signing.
// A .gitignore alone is not enough. R02: the ChatSpace-like stand (our own
// Vue/TipTap app) stays out of the sources archive altogether
// (apps/extension/build/sources-archive.ts); only the testing package manifest
// and the lockfile may name those libraries (perf traces come with tools/perf).

import { createHash } from 'node:crypto';
import { posix } from 'node:path';

import ts from 'typescript';

import { isStandSource } from '../../apps/extension/build/sources-archive.ts';
import { HOSTS, type HostDescriptor } from '../../apps/extension/src/hosts/index.ts';
import type { ZipEntry } from '../lib/zip.ts';

export interface ArchiveProblem {
  readonly archive: string;
  readonly file: string;
  readonly rule: string;
  readonly detail: string;
}

/**
 * Each site's own code (its bundles' chunk names, a research copy's folder, its framework's fingerprints) and the
 * libraries only its app carries: the `archiveMarkers` of its entry in the host registry (apps/extension/src/hosts).
 */
export function hostCodeMarkers(hosts: readonly HostDescriptor[] = HOSTS): { readonly code: readonly RegExp[]; readonly libraries: readonly RegExp[] } {
  return { code: hosts.flatMap((host) => host.archiveMarkers.code), libraries: hosts.flatMap((host) => host.archiveMarkers.libraries) };
}

/**
 * The test stand (packages/testing/fixture-chatspace, R02) is our own small
 * Vue + TipTap app imitating the host. It is not in the sources archive
 * (`stand-in-sources`); the testing package manifest and the lockfile there
 * may still name its libraries. The XPI never may.
 */
export const STAND_FIXTURE_DIR = 'packages/testing/fixture-chatspace/';
const STAND_LIBRARY_ALLOWED: readonly RegExp[] = [/^packages\/testing\/package\.json$/, /^pnpm-lock\.yaml$/];
/**
 * Fixture provenance, should the stand ever travel in an archive again: its
 * folders hold hand-written sources only — no built or saved bundles, pages
 * or API answers (a saved JSON or Markdown capture included). Per folder: the
 * file kinds it may hold.
 */
const STAND_SOURCE_DIRS: ReadonlyArray<readonly [string, RegExp, string]> = [
  [STAND_FIXTURE_DIR, /^packages\/testing\/fixture-chatspace\/(?:tsconfig\.json|.+\.(?:ts|html|css))$/, 'ts, html, css and its tsconfig.json'],
  // The M0 spike page is plain hand-written HTML, CSS and JS.
  ['packages/testing/stand/', /\.(?:html|css|js)$/, 'html, css, js'],
  ['packages/testing/src/stand/', /\.ts$/, 'ts'],
];

/**
 * Real ids that must never ship, as sha256 of the decimal string: the archive
 * that carries this checker must not carry the ids themselves. Today: the
 * owner's OnlyMonster test account and test chat from decision X9
 * (rules.test.ts recomputes both from docs/decisions.md).
 */
export const REAL_ID_SHA256: ReadonlySet<string> = new Set([
  '8c5c7d36ab0e8de3fe20bfdddf463fb579d40290fcc7660dd15f7be5345ae513',
  'fd088c4b834f95a3fe504ce81606cec4844c762c32f737b19f8587009d29fd07',
]);
/** Every standalone run of 5+ digits is hashed and looked up in REAL_ID_SHA256. */
const NUMERIC_TOKEN = /\b\d{5,}\b/g;

export const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

/** Real data and secrets (patterns that do not match their own source text). */
export const REAL_DATA_MARKERS: ReadonlyArray<[RegExp, string]> = [
  [/\beyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{8,}/, 'a JWT'],
  [/\bBearer\s+[A-Za-z0-9._~+/-]{24,}/, 'a bearer token'],
  [/\bsk-ant-[A-Za-z0-9_-]{10,}/, 'an Anthropic key'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'an AWS key'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
  [/\bop:\/\/[^\s'"]+/, 'a 1Password secret reference'],
  [/https?:\/\/(?:cdn\d*|public)\.onlyfans\.com\//, 'an OnlyFans media URL'],
];

const FORBIDDEN_FILES: ReadonlyArray<[RegExp, string]> = [
  [/\.(?:woff2?|ttf|otf|eot)$/i, 'font file'],
  [/\.(?:har|sqlite|db|pem|p12|key|log)$/i, 'data/secret file'],
  [/(^|\/)\.env(\.|$)/, 'env file'],
  [/(^|\/)(?:node_modules|\.dev-profile|\.output|docs\/research)\//, 'build/profile/research folder'],
];

const TEXT_FILE = /\.(?:js|mjs|cjs|ts|tsx|json|html|css|md|txt|yaml|yml|svg)$/i;
const IMAGE_FILE = /\.(?:png|jpe?g|gif|webp|svg|ico|avif)$/i;
/** Our own images (icons) only; anything else is suspect until allow-listed. */
const ALLOWED_IMAGES = /^(?:icons?\/|apps\/extension\/public\/icons?\/)/;
/**
 * The checker's own files, and the host registry's entries, which name the markers they ask for (only those): a
 * marker matches its own source text.
 */
const SELF = /^(?:tools\/archive-check\/|apps\/extension\/src\/hosts\/[^/]+\.ts$)/;
/** A single minified file this large means someone bundled something foreign. */
export const MAX_JS_BYTES = 400 * 1024;
/**
 * The background is the one file that is larger by design: it alone carries
 * the vendored hub SDK (D-13) — the hub's whole route contract with its zod
 * schemas, about 450 KiB minified — next to the hub layer and the services
 * (682 KiB when the M1 skeleton was wired). Its own ceiling keeps the
 * tripwire: a re-vendored SDK fits, a foreign bundle on top of it does not.
 */
export const MAX_BACKGROUND_JS_BYTES = 800 * 1024;
const jsCeiling = (name: string): number => (name === 'background.js' ? MAX_BACKGROUND_JS_BYTES : MAX_JS_BYTES);

export interface ArchiveCheckOptions {
  /** Defaults to REAL_ID_SHA256 (tests pass synthetic ids). */
  readonly realIdHashes?: ReadonlySet<string>;
  /** Defaults to the host registry's sites (tests pass synthetic ones). */
  readonly hosts?: readonly HostDescriptor[];
}

export function checkArchive(
  archive: string,
  entries: readonly ZipEntry[],
  kind: 'xpi' | 'sources',
  options: ArchiveCheckOptions = {},
): ArchiveProblem[] {
  const realIdHashes = options.realIdHashes ?? REAL_ID_SHA256;
  const markers = hostCodeMarkers(options.hosts);
  const problems: ArchiveProblem[] = [];
  const add = (file: string, rule: string, detail: string): void => {
    problems.push({ archive, file, rule, detail });
  };
  for (const entry of entries) {
    for (const [pattern, what] of FORBIDDEN_FILES) if (pattern.test(entry.name)) add(entry.name, 'forbidden-file', what);
    if (IMAGE_FILE.test(entry.name) && !ALLOWED_IMAGES.test(entry.name)) add(entry.name, 'foreign-image', 'image outside our icons folder');
    if (kind === 'xpi' && entry.name.endsWith('.map')) add(entry.name, 'sourcemap', 'sourcemaps do not ship in the XPI');
    if (kind === 'xpi' && /\.js$/.test(entry.name) && entry.data.length > jsCeiling(entry.name)) {
      add(entry.name, 'oversized-js', `${entry.data.length} bytes > ${jsCeiling(entry.name)}`);
    }
    if (kind === 'sources' && isStandSource(entry.name)) add(entry.name, 'stand-in-sources', 'the ChatSpace-like stand stays out of the AMO sources archive (apps/extension/build/sources-archive.ts)');
    for (const [dir, allowed, kinds] of STAND_SOURCE_DIRS) {
      if (entry.name.startsWith(dir) && !allowed.test(entry.name)) add(entry.name, 'fixture-provenance', `${dir} holds hand-written sources only (${kinds})`);
    }
    if (!TEXT_FILE.test(entry.name)) continue;
    const text = entry.data.toString('utf8');
    if (!SELF.test(entry.name)) {
      const libraryAllowed = kind === 'sources' && STAND_LIBRARY_ALLOWED.some((pattern) => pattern.test(entry.name));
      for (const pattern of [...markers.code, ...(libraryAllowed ? [] : markers.libraries)]) {
        const match = pattern.exec(text);
        if (match) add(entry.name, 'onlymonster-code', `marker «${match[0]}»`);
      }
    }
    for (const [pattern, what] of REAL_DATA_MARKERS) if (pattern.test(text)) add(entry.name, 'real-data', what);
    const realIds = new Set([...text.matchAll(NUMERIC_TOKEN)].map((match) => sha256(match[0])).filter((hash) => realIdHashes.has(hash)));
    for (const hash of realIds) add(entry.name, 'real-data', `a real id (sha256 ${hash.slice(0, 12)}…, decision X9)`);
  }
  if (kind === 'sources') problems.push(...danglingReferences(archive, entries));
  return problems;
}

// ── dangling imports in the sources archive ────────────────────────────────

const CODE_FILE = /\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/;
const TSCONFIG_FILE = /(?:^|\/)tsconfig[^/]*\.json$/;
const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.d.ts', '.js', '.mjs', '.cjs', '.json'];

/** Archive paths a relative module specifier may resolve to (moduleResolution «bundler»). */
function moduleCandidates(path: string): string[] {
  const swapped = /\.[mc]?js$/.test(path) ? [path.replace(/\.js$/, '.ts'), path.replace(/\.js$/, '.tsx'), path.replace(/\.mjs$/, '.mts'), path.replace(/\.cjs$/, '.cts')] : [];
  return [path, ...swapped, ...RESOLVE_EXTENSIONS.map((ext) => `${path}${ext}`), ...RESOLVE_EXTENSIONS.map((ext) => `${path}/index${ext}`)];
}

interface WorkspacePackage {
  readonly dir: string;
  readonly exports: Readonly<Record<string, unknown>> | null;
}

function workspacePackages(entries: readonly ZipEntry[]): Map<string, WorkspacePackage> {
  const packages = new Map<string, WorkspacePackage>();
  for (const entry of entries) {
    if (!/(?:^|\/)package\.json$/.test(entry.name) || entry.name.includes('node_modules/')) continue;
    try {
      const manifest = JSON.parse(entry.data.toString('utf8')) as { name?: unknown; exports?: unknown };
      if (typeof manifest.name !== 'string') continue;
      const exports = typeof manifest.exports === 'string' ? { '.': manifest.exports } : typeof manifest.exports === 'object' && manifest.exports !== null ? (manifest.exports as Record<string, unknown>) : null;
      packages.set(manifest.name, { dir: posix.dirname(entry.name), exports });
    } catch {
      // Not ours to judge here.
    }
  }
  return packages;
}

/** The file an export target names (a string, or the import/default/types condition). */
function exportTarget(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null) {
    for (const condition of ['import', 'default', 'types']) {
      const inner = exportTarget((value as Record<string, unknown>)[condition]);
      if (inner !== null) return inner;
    }
  }
  return null;
}

/** null: not a workspace package (an installed dependency); [] — the package does not export it. */
function workspaceCandidates(specifier: string, packages: ReadonlyMap<string, WorkspacePackage>): string[] | null {
  for (const [name, pkg] of packages) {
    if (specifier !== name && !specifier.startsWith(`${name}/`)) continue;
    if (pkg.exports === null) return null;
    const subpath = specifier === name ? '.' : `.${specifier.slice(name.length)}`;
    let target = exportTarget(pkg.exports[subpath]);
    if (target === null) {
      for (const [pattern, value] of Object.entries(pkg.exports)) {
        const star = pattern.indexOf('*');
        if (star < 0 || !subpath.startsWith(pattern.slice(0, star)) || !subpath.endsWith(pattern.slice(star + 1))) continue;
        const inner = exportTarget(value);
        if (inner !== null) target = inner.replace('*', subpath.slice(star, subpath.length - (pattern.length - star - 1)));
      }
    }
    return target === null ? [] : moduleCandidates(posix.normalize(posix.join(pkg.dir, target)));
  }
  return null;
}

/**
 * Every relative import (static, dynamic, re-export, triple-slash), every
 * import of a workspace package's export, and every tsconfig `extends` and
 * project reference in the sources archive must point at a file that is in
 * the archive: a file left in it must not need one that was left out.
 */
export function danglingReferences(archive: string, entries: readonly ZipEntry[]): ArchiveProblem[] {
  const names = new Set(entries.map((entry) => entry.name));
  const packages = workspacePackages(entries);
  const problems: ArchiveProblem[] = [];
  const dangling = (file: string, specifier: string, what: string): void => {
    problems.push({ archive, file, rule: 'dangling-import', detail: `${what} «${specifier}» is not in the archive` });
  };
  for (const entry of entries) {
    if (entry.name.includes('node_modules/')) continue;
    const dir = posix.dirname(entry.name);
    if (CODE_FILE.test(entry.name)) {
      const info = ts.preProcessFile(entry.data.toString('utf8'), true, true);
      for (const { fileName } of [...info.importedFiles, ...info.referencedFiles]) {
        const specifier = fileName.replace(/[?#].*$/, '');
        const candidates = specifier.startsWith('.') ? moduleCandidates(posix.normalize(posix.join(dir, specifier))) : workspaceCandidates(specifier, packages);
        if (candidates !== null && !candidates.some((candidate) => names.has(candidate))) dangling(entry.name, fileName, 'import');
      }
    } else if (TSCONFIG_FILE.test(entry.name)) {
      const parsed = ts.parseConfigFileTextToJson(entry.name, entry.data.toString('utf8')).config as { extends?: unknown; references?: unknown } | undefined;
      for (const extended of typeof parsed?.extends === 'string' ? [parsed.extends] : Array.isArray(parsed?.extends) ? (parsed.extends as unknown[]) : []) {
        if (typeof extended !== 'string' || !extended.startsWith('.')) continue;
        const path = posix.normalize(posix.join(dir, extended));
        if (!names.has(path) && !names.has(`${path}.json`)) dangling(entry.name, extended, 'tsconfig extends');
      }
      for (const reference of Array.isArray(parsed?.references) ? (parsed.references as Array<{ path?: unknown }>) : []) {
        if (typeof reference.path !== 'string') continue;
        const path = posix.normalize(posix.join(dir, reference.path));
        if (!names.has(path.endsWith('.json') ? path : `${path}/tsconfig.json`)) dangling(entry.name, reference.path, 'tsconfig reference');
      }
    }
  }
  return problems;
}

/**
 * The XPI must hold exactly the build directory's files, byte for byte: nothing
 * smuggled in by the zipper, and not an older build's archive.
 */
export function compareWithBuild(archive: string, entries: readonly ZipEntry[], buildFiles: readonly ZipEntry[]): ArchiveProblem[] {
  const inZip = new Map(entries.map((entry) => [entry.name, entry.data]));
  const inBuild = new Map(buildFiles.map((file) => [file.name, file.data]));
  const problems: ArchiveProblem[] = [];
  for (const [file, data] of inZip) {
    const built = inBuild.get(file);
    if (built === undefined) problems.push({ archive, file, rule: 'extra-file', detail: 'in the XPI but not in the build dir' });
    else if (!built.equals(data)) problems.push({ archive, file, rule: 'changed-file', detail: 'differs from the build dir (stale archive?)' });
  }
  for (const file of inBuild.keys()) {
    if (!inZip.has(file)) problems.push({ archive, file, rule: 'missing-file', detail: 'in the build dir but not in the XPI' });
  }
  return problems;
}
