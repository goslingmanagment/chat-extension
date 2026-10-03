// What must never ship (architecture.md §12 п. 7, §3 «pnpm check» п. 9): no
// OnlyMonster code, CSS, fonts or images, no real messages, tokens or prod
// HTML — in the XPI and in the sources archive that goes to AMO for signing.
// A .gitignore alone is not enough. R02 extends these rules (perf traces,
// fixture provenance); R00 checks everything that can be checked today.

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
  // Library code that only their app carries (we ship Preact, never Vue/PrimeVue/TipTap).
  /__VUE_PROD_DEVTOOLS__|__VUE_OPTIONS_API__|__VUE_PROD_HYDRATION_MISMATCH_DETAILS__/,
  /@tiptap\/|prosemirror-(?:model|view|state)/i,
  // Vue scoped-style attributes: the fingerprint of a saved prod page or CSS.
  /\bdata-v-[0-9a-f]{8}\b/,
];

/** Real data and secrets. */
export const REAL_DATA_MARKERS: ReadonlyArray<[RegExp, string]> = [
  [/\b518588958\b/, "the owner's real test chat id"],
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
/** The checker's own rule files name the markers they look for. */
const SELF = /^tools\/archive-check\//;
/** A single minified file this large means someone bundled something foreign. */
const MAX_JS_BYTES = 400 * 1024;

export function checkArchive(archive: string, entries: readonly ZipEntry[], kind: 'xpi' | 'sources'): ArchiveProblem[] {
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
    if (!TEXT_FILE.test(entry.name) || SELF.test(entry.name)) continue;
    const text = entry.data.toString('utf8');
    for (const pattern of ONLYMONSTER_BUNDLE_MARKERS) {
      const match = pattern.exec(text);
      if (match) add(entry.name, 'onlymonster-code', `marker «${match[0]}»`);
    }
    for (const [pattern, what] of REAL_DATA_MARKERS) if (pattern.test(text)) add(entry.name, 'real-data', what);
  }
  return problems;
}

/** The XPI must hold exactly the build directory's files (nothing smuggled in by the zipper). */
export function compareWithBuild(archive: string, entries: readonly ZipEntry[], buildFiles: readonly string[]): ArchiveProblem[] {
  const inZip = new Set(entries.map((entry) => entry.name));
  const inBuild = new Set(buildFiles);
  return [
    ...[...inZip].filter((name) => !inBuild.has(name)).map((file) => ({ archive, file, rule: 'extra-file', detail: 'in the XPI but not in the build dir' })),
    ...[...inBuild].filter((name) => !inZip.has(name)).map((file) => ({ archive, file, rule: 'missing-file', detail: 'in the build dir but not in the XPI' })),
  ];
}
