// What must never ship (architecture.md §12 п. 7, §3 «pnpm check» п. 9): no
// OnlyMonster code, CSS, fonts or images, no real messages, tokens or prod
// HTML — in the XPI and in the sources archive that goes to AMO for signing.
// A .gitignore alone is not enough. R02 adds the stand's place in the sources
// archive: its own Vue/TipTap sources may name those libraries, nothing else may
// (perf traces come with tools/perf).

import { createHash } from 'node:crypto';

import type { ZipEntry } from '../lib/zip.ts';

export interface ArchiveProblem {
  readonly archive: string;
  readonly file: string;
  readonly rule: string;
  readonly detail: string;
}

/** ChatSpace bundle chunk names from the research copy (0.172.0) and that copy's folder. */
export const ONLYMONSTER_BUNDLE_MARKERS: readonly RegExp[] = [
  /\b(?:messages-DlBZ5e81|composables-BUNn3xEu|notificationEntry-DgqI6Vgc|accounts-BWN_jVY3|ChatView-DOQWEL72|inbox-SRJHz93Z|onlyfans-CaxZc4_R|MainLayout-DBvnSRX2|index-DEVowLko)\b/,
  /chatspace-bundles/,
  // Vue scoped-style attributes: the fingerprint of a saved prod page or CSS.
  /\bdata-v-[0-9a-f]{8}\b/,
];

/** Library code that only their app carries (we ship Preact, never Vue/PrimeVue/TipTap). */
export const HOST_LIBRARY_MARKERS: readonly RegExp[] = [
  /__VUE_PROD_DEVTOOLS__|__VUE_OPTIONS_API__|__VUE_PROD_HYDRATION_MISMATCH_DETAILS__/,
  /@tiptap\/|prosemirror-(?:model|view|state)/i,
];

/**
 * The test stand (packages/testing/fixture-chatspace, R02) is our own small
 * Vue + TipTap app imitating the host. In the SOURCES archive (AMO rebuilds
 * the whole workspace) its source files, the testing package manifest and the
 * lockfile may name those libraries. The XPI never may.
 */
export const STAND_FIXTURE_DIR = 'packages/testing/fixture-chatspace/';
const STAND_LIBRARY_ALLOWED: readonly RegExp[] = [/^packages\/testing\/fixture-chatspace\/.+\.(?:ts|html|css)$/, /^packages\/testing\/package\.json$/, /^pnpm-lock\.yaml$/];
/** Fixture provenance: only hand-written sources live in the stand folder — no built or saved bundles. */
const STAND_SOURCE_FILE = /\.(?:ts|html|css|json|md)$/;

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
/** The checker's own rule file names the OnlyMonster markers it looks for (only those). */
const SELF = /^tools\/archive-check\//;
/** A single minified file this large means someone bundled something foreign. */
const MAX_JS_BYTES = 400 * 1024;

export interface ArchiveCheckOptions {
  /** Defaults to REAL_ID_SHA256 (tests pass synthetic ids). */
  readonly realIdHashes?: ReadonlySet<string>;
}

export function checkArchive(
  archive: string,
  entries: readonly ZipEntry[],
  kind: 'xpi' | 'sources',
  options: ArchiveCheckOptions = {},
): ArchiveProblem[] {
  const realIdHashes = options.realIdHashes ?? REAL_ID_SHA256;
  const problems: ArchiveProblem[] = [];
  const add = (file: string, rule: string, detail: string): void => {
    problems.push({ archive, file, rule, detail });
  };
  for (const entry of entries) {
    for (const [pattern, what] of FORBIDDEN_FILES) if (pattern.test(entry.name)) add(entry.name, 'forbidden-file', what);
    if (IMAGE_FILE.test(entry.name) && !ALLOWED_IMAGES.test(entry.name)) add(entry.name, 'foreign-image', 'image outside our icons folder');
    if (kind === 'xpi' && entry.name.endsWith('.map')) add(entry.name, 'sourcemap', 'sourcemaps do not ship in the XPI');
    if (kind === 'xpi' && /\.js$/.test(entry.name) && entry.data.length > MAX_JS_BYTES) {
      add(entry.name, 'oversized-js', `${entry.data.length} bytes > ${MAX_JS_BYTES}`);
    }
    if (entry.name.startsWith(STAND_FIXTURE_DIR) && !STAND_SOURCE_FILE.test(entry.name)) {
      add(entry.name, 'fixture-provenance', 'the stand folder holds hand-written sources only (ts, html, css, json, md)');
    }
    if (!TEXT_FILE.test(entry.name)) continue;
    const text = entry.data.toString('utf8');
    if (!SELF.test(entry.name)) {
      const libraryAllowed = kind === 'sources' && STAND_LIBRARY_ALLOWED.some((pattern) => pattern.test(entry.name));
      for (const pattern of [...ONLYMONSTER_BUNDLE_MARKERS, ...(libraryAllowed ? [] : HOST_LIBRARY_MARKERS)]) {
        const match = pattern.exec(text);
        if (match) add(entry.name, 'onlymonster-code', `marker «${match[0]}»`);
      }
    }
    for (const [pattern, what] of REAL_DATA_MARKERS) if (pattern.test(text)) add(entry.name, 'real-data', what);
    const realIds = new Set([...text.matchAll(NUMERIC_TOKEN)].map((match) => sha256(match[0])).filter((hash) => realIdHashes.has(hash)));
    for (const hash of realIds) add(entry.name, 'real-data', `a real id (sha256 ${hash.slice(0, 12)}…, decision X9)`);
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
