// The gates that keep the two sites apart (docs/project-unite/architecture.md
// §1.8; R20 F9a — the early gates; R20 F9b — the final ones, with no
// exceptions). Pure functions over {path, text}; index.ts feeds them the repo,
// the release build and the diff of the change.
//
// 1. Site literals, by AST and by meaning. Shared code (core, ui, hub and the
//    shared page mechanics of host-kit) names no site: no string equal to a
//    value of HostKind or Platform, no comparison with one, no table keyed by
//    one, no read of such a key. A site's own code names no OTHER site. A value
//    counts wherever it stands — a comparison, a switch, a literal type, an
//    object key written without quotes — and only a value does:
//    `platform === 'mac'`, `host === null`, a comment, a longer text or an i18n
//    key never trip it. The debt list of §1.9 is empty since F9b: an entry
//    stays only while a PR of plan.md that owns it is in flight, and the gate
//    fails on a literal outside the list, on an entry the code has outgrown and
//    on an entry of a PR already done — so the list only shrinks.
// 1a. Site names in texts (F9b). No text of shared code — a catalog entry, a
//    string, a template, a JSX text — says «ChatSpace», «OnlyMonster»,
//    «OnlyFans» or «Fansly»: it says the site's phrase (`{site}`, `{onSite}`,
//    `{siteAccount}`, `{sitePlatform}`), which the I18n port fills from the
//    site's own text pack. The names are derived from those packs.
// 2. Bytes per site. ChatSpace's built files — its scripts, its lazy build, its
//    background chunk and the background core — are pinned by size and hash in
//    chatspace-bytes.json, and the release build must match it. A change of
//    Fansly's files alone must leave it untouched; a change of shared code
//    rewrites it on purpose (`pnpm gates:bytes`), so the PR shows what moved.
// 3. No Fansly data in ChatSpace's bundles: the strings only Fansly's own
//    modules carry (its bridge types, tab requests, error codes, text keys,
//    API address) are derived from the source and searched for in the build.
// 4. No build field of the host registry and no parity row in any bundle.
//
// The package graph itself is .dependency-cruiser.cjs; whose path is whose is
// one table for both, site-paths.cjs.
//
// Relative imports carry `.ts`: this file runs under plain Node 26.

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

import ts from 'typescript';

import type { HostDescriptor } from '../../apps/extension/src/hosts/index.ts';
import { HOST_KINDS, HOST_PLATFORM, type HostKind } from '../../packages/contracts/src/hosts.ts';
import type { HostPhrases } from '../../packages/contracts/src/vm/host-profile.ts';
import { CHATSPACE_PHRASES } from '../../packages/core/src/domain/hosts/chatspace/i18n/index.ts';
import { FANSLY_PHRASES } from '../../packages/core/src/domain/hosts/fansly/i18n/phrases.ts';
import { lineOf, parse, walk, type SourceFile, type Violation } from './checks.ts';

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ── Whose path is whose ─────────────────────────────────────────────────────

const sitePaths = createRequire(import.meta.url)('./site-paths.cjs') as {
  readonly FANSLY_OWNED: string;
  readonly CHATSPACE_OWNED: string;
  readonly NEUTRAL: readonly string[];
};

/** A site's own paths, by its kind: a new host kind does not typecheck until it has its row. */
const OWNED_PATHS = { chatspace: sitePaths.CHATSPACE_OWNED, 'fansly-web': sitePaths.FANSLY_OWNED } as const satisfies Record<HostKind, string>;

export interface Site {
  readonly kind: HostKind;
  /** What names the site in code: its host kind and the platform it serves (contracts hosts.ts). */
  readonly values: readonly string[];
  /** Its own paths (site-paths.cjs). */
  readonly owned: RegExp;
}

export const SITES: readonly Site[] = HOST_KINDS.map((kind) => ({ kind, values: [kind, HOST_PLATFORM[kind]], owned: new RegExp(OWNED_PATHS[kind]) }));

/** Every value that names a site, with the site it names. */
const SITE_OF_VALUE: ReadonlyMap<string, HostKind> = new Map(SITES.flatMap((site) => site.values.map((value) => [value, site.kind] as const)));

const NEUTRAL_PATHS: readonly RegExp[] = sitePaths.NEUTRAL.map((source) => new RegExp(source));

/** The site a path belongs to by its name; null — shared (or nobody's). */
export function siteOfPath(path: string): Site | null {
  return SITES.find((site) => site.owned.test(path)) ?? null;
}

/**
 * What a changed path can do to ChatSpace's bundles: `neutral` — nothing is built from it (documents, tests, tools);
 * `fansly` — Fansly's own file, which no ChatSpace bundle can reach (the graph rules hold that); `shared` — anything
 * else: shared source, ChatSpace's own, the build, the dependencies.
 */
export type ChangeKind = 'neutral' | 'fansly' | 'shared';

export function changeKindOf(path: string): ChangeKind {
  if (isNeutralPath(path)) return 'neutral';
  return siteOfPath(path)?.kind === 'fansly-web' ? 'fansly' : 'shared';
}

/** Documents, tests, the test package, tools: no bundle is built from the file, and no gate of the sites reads it as code that ships. */
export function isNeutralPath(path: string): boolean {
  return NEUTRAL_PATHS.some((pattern) => pattern.test(path));
}

// ── 1. Site literals ────────────────────────────────────────────────────────

/** Shared code that names no site at all: core, ui, the hub layer and the shared mechanics of the page (host-kit, R20 P5). */
export const SITE_FREE_SCOPES: readonly RegExp[] = [/^packages\/core\/src\//, /^packages\/ui\/src\//, /^packages\/hub\/src\//, /^packages\/host-kit\/src\//];
/** The one shared module that decides by site: the admission of a feature on a host (architecture.md §1.4). */
export const SITE_LITERALS_ALLOWED: readonly RegExp[] = [/^packages\/core\/src\/domain\/features\/admission\.ts$/];
/** How a site value stands in the code. */
export type SiteLiteralUse = 'value' | 'comparison' | 'key' | 'type';

export interface SiteLiteral {
  readonly path: string;
  readonly line: number;
  /** The value: a host kind or a platform. */
  readonly value: string;
  readonly use: SiteLiteralUse;
}

/**
 * The site values a file may not name: every site's in shared code, the other sites' in a site's own code; null —
 * the file is not gated (the contracts, the platform, the composition roots, the host registry, tests).
 */
export function forbiddenSiteValues(path: string): ReadonlySet<string> | null {
  // Tests and the test package name both sites freely.
  if (isNeutralPath(path)) return null;
  const owner = siteOfPath(path);
  if (owner !== null) return new Set(SITES.filter((site) => site !== owner).flatMap((site) => site.values));
  if (!SITE_FREE_SCOPES.some((pattern) => pattern.test(path)) || SITE_LITERALS_ALLOWED.some((pattern) => pattern.test(path))) return null;
  return new Set(SITE_OF_VALUE.keys());
}

const NAMED_MEMBERS = new Set([
  ts.SyntaxKind.PropertyAssignment,
  ts.SyntaxKind.ShorthandPropertyAssignment,
  ts.SyntaxKind.PropertySignature,
  ts.SyntaxKind.PropertyDeclaration,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.MethodSignature,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.SetAccessor,
  ts.SyntaxKind.EnumMember,
]);
const EQUALITY = new Set([ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken]);

/** `{ name: … }`, `interface { name: … }`, `enum { name }`: the node is the member's name. */
function isMemberName(node: ts.Node): boolean {
  const parent = node.parent;
  return NAMED_MEMBERS.has(parent.kind) && (parent as ts.NamedDeclaration).name === node;
}

/** A key read by its name: `x.name`, `const { name } = x`, `const { name: y } = x`. */
function isNamedKey(node: ts.Node): boolean {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent)) return parent.name === node;
  if (ts.isBindingElement(parent) && ts.isObjectBindingPattern(parent.parent)) return parent.propertyName === node || (parent.propertyName === undefined && parent.name === node);
  return false;
}

/** A key given as an expression — `x['name']`, `{ ['name']: … }`: a key only when the expression is the string itself. */
function isIndexedKey(node: ts.Node): boolean {
  const parent = node.parent;
  return (ts.isElementAccessExpression(parent) && parent.argumentExpression === node) || ts.isComputedPropertyName(parent);
}

/** A module specifier is a path, not a value: `import … from 'x'`, `export … from 'x'`, `import('x')`, `import('x').T`. */
function isModuleSpecifier(node: ts.Node): boolean {
  const parent = node.parent;
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isExternalModuleReference(parent)) return true;
  if (ts.isCallExpression(parent) && parent.expression.kind === ts.SyntaxKind.ImportKeyword) return true;
  return ts.isLiteralTypeNode(parent) && ts.isImportTypeNode(parent.parent);
}

function useOf(node: ts.Node): SiteLiteralUse {
  if (isMemberName(node) || isNamedKey(node) || isIndexedKey(node)) return 'key';
  const parent = node.parent;
  if (ts.isLiteralTypeNode(parent)) return 'type';
  if ((ts.isBinaryExpression(parent) && EQUALITY.has(parent.operatorToken.kind)) || ts.isCaseClause(parent)) return 'comparison';
  return 'value';
}

/**
 * Every place a gated file names a site value it may not: a string (or a template without substitutions) equal to
 * one, wherever it stands, and a key equal to one written as a bare name. By AST: comments, longer texts and the
 * names of variables are not values.
 */
export function findSiteLiterals(files: readonly SourceFile[]): SiteLiteral[] {
  const found: SiteLiteral[] = [];
  for (const file of files) {
    const forbidden = forbiddenSiteValues(file.path);
    if (forbidden === null) continue;
    const source = parse(file);
    walk(source, (node) => {
      let use: SiteLiteralUse | null = null;
      let value = '';
      if (ts.isStringLiteralLike(node)) {
        if (isModuleSpecifier(node)) return;
        value = node.text;
        use = useOf(node);
      } else if (ts.isIdentifier(node) && (isMemberName(node) || isNamedKey(node))) {
        value = node.text;
        use = 'key';
      }
      if (use !== null && forbidden.has(value)) found.push({ path: file.path, line: lineOf(source, node), value, use });
    });
  }
  return found;
}

/** One place shared code still names a site: the file, the value, how many times — and the PR that removes it. */
export interface SiteLiteralDebt {
  readonly path: string;
  readonly value: string;
  /** How many times the file names the value today (strings and keys alike). Only ever lowered. */
  readonly count: number;
  /** The PR of docs/project-unite/plan.md that removes it. */
  readonly pr: string;
  /** What it is now and what it becomes (architecture.md §1.9). */
  readonly note: string;
}

/**
 * The debt of architecture.md §1.9. An entry is a file and a value, not a line: lines move with every edit of the
 * file, the count moves only when a literal comes or goes. The PR that removes a literal lowers the count or drops the
 * entry in the same commit. The final gate (F9b) emptied the list of every entry no PR in flight owns: the platforms'
 * names went to the sites' phrases, the default tones to the background's table of the sites, `settings.ext` is read
 * by the sections its schema names, the compat bootstrap takes the build's platforms from the composition root. F10
 * took the last one: the Ping rule of one site left the shared gate for the sites' AI policy (`AiHostPolicy.preflight`).
 */
export const SITE_LITERAL_DEBT: readonly SiteLiteralDebt[] = [];

/** The PRs of plan.md and which of them are marked done (tools/parity/matrix.ts `parsePlanPrs`). */
export interface PlanState {
  readonly all: readonly string[];
  readonly done: ReadonlySet<string>;
}

const quote = (value: string): string => `'${value}'`;
const DEBT_FILE = 'tools/gates/sites.ts';

/**
 * Site literals against the debt list: a literal the list does not allow is a violation at its line; an entry the
 * file no longer fills, an entry of a PR that is done or unknown to the plan and an entry written twice are
 * violations of the list itself.
 */
export function checkSiteLiterals(files: readonly SourceFile[], debt: readonly SiteLiteralDebt[] = SITE_LITERAL_DEBT, plan: PlanState | null = null): Violation[] {
  const violations: Violation[] = [];
  const keyOf = (path: string, value: string): string => `${path}\n${value}`;
  const found = new Map<string, SiteLiteral[]>();
  for (const literal of findSiteLiterals(files)) {
    const key = keyOf(literal.path, literal.value);
    found.set(key, [...(found.get(key) ?? []), literal]);
  }
  const allowed = new Map<string, SiteLiteralDebt>();
  for (const entry of debt) {
    const key = keyOf(entry.path, entry.value);
    if (allowed.has(key)) violations.push({ gate: 'site-literal-debt', path: DEBT_FILE, line: 1, message: `the debt list names ${quote(entry.value)} in ${entry.path} twice.` });
    allowed.set(key, entry);
    if (entry.count < 1) violations.push({ gate: 'site-literal-debt', path: DEBT_FILE, line: 1, message: `the debt entry ${quote(entry.value)} in ${entry.path} has no count: drop it.` });
    if (forbiddenSiteValues(entry.path)?.has(entry.value) !== true) {
      violations.push({ gate: 'site-literal-debt', path: DEBT_FILE, line: 1, message: `the debt entry ${quote(entry.value)} in ${entry.path} is not debt: the gate does not forbid that value there.` });
    }
    if (plan !== null && !plan.all.includes(entry.pr)) {
      violations.push({ gate: 'site-literal-debt', path: DEBT_FILE, line: 1, message: `the debt entry ${quote(entry.value)} in ${entry.path} names ${entry.pr}, which is no PR of docs/project-unite/plan.md.` });
    } else if (plan?.done.has(entry.pr) === true) {
      violations.push({
        gate: 'site-literal-debt',
        path: entry.path,
        line: found.get(key)?.[0]?.line ?? 1,
        message: `${entry.pr} is done (done file or ✓ in plan.md) but still owns ${quote(entry.value)} ×${entry.count} here (${entry.note}): remove the literal, or hand the entry to a later PR in ${DEBT_FILE}.`,
      });
    }
  }
  for (const [key, literals] of found) {
    const entry = allowed.get(key);
    const first = literals[0];
    if (first === undefined) continue;
    if (entry === undefined) {
      const owner = siteOfPath(first.path);
      const why = owner === null ? 'shared code names no site: take it from the binding, the site profile or the feature manifest' : `${owner.kind}'s own code names no other site`;
      for (const literal of literals) {
        violations.push({ gate: 'site-literal', path: literal.path, line: literal.line, message: `${quote(literal.value)} as a ${literal.use} — ${why} (docs/project-unite/architecture.md §1.8).` });
      }
    } else if (literals.length > entry.count) {
      violations.push({
        gate: 'site-literal',
        path: first.path,
        line: first.line,
        message: `${quote(first.value)} ×${literals.length} (lines ${literals.map((literal) => literal.line).join(', ')}), the debt list allows ×${entry.count} (${entry.pr}): a new site literal in shared code (docs/project-unite/architecture.md §1.8).`,
      });
    }
  }
  for (const entry of debt) {
    const now = found.get(keyOf(entry.path, entry.value))?.length ?? 0;
    if (now < entry.count) {
      violations.push({
        gate: 'site-literal-debt',
        path: entry.path,
        line: 1,
        message: `names ${quote(entry.value)} ×${now} now, the debt list says ×${entry.count} (${entry.pr}): ${now === 0 ? 'drop the entry' : `lower it to ${now}`} in ${DEBT_FILE} — the list only shrinks.`,
      });
    }
  }
  return violations;
}

// ── 1a. Site names in texts ─────────────────────────────────────────────────

/** The names in a site's phrases (`HostPhrases`): the site, its accounts, its platform — every language's. */
function namesOf(phrases: { readonly [locale: string]: HostPhrases }): readonly string[] {
  return [...new Set(Object.values(phrases).flatMap((phrase) => [phrase.site, phrase.siteAccount, phrase.sitePlatform]))];
}

/**
 * What says a site in a text, by its kind: the names its own phrases give (its text pack, `core/domain/hosts/<site>/
 * i18n`). A new host kind does not typecheck until its phrases are here.
 */
export const SITE_NAMES: { readonly [K in HostKind]: readonly string[] } = { chatspace: namesOf(CHATSPACE_PHRASES), 'fansly-web': namesOf(FANSLY_PHRASES) };

/** The site names a file's texts may not say: every site's in shared code, the other sites' in a site's own; null — not gated. */
export function forbiddenSiteNames(path: string): readonly string[] | null {
  if (isNeutralPath(path)) return null;
  const owner = siteOfPath(path);
  if (owner !== null) return SITES.filter((site) => site !== owner).flatMap((site) => SITE_NAMES[site.kind]);
  return SITE_FREE_SCOPES.some((pattern) => pattern.test(path)) ? HOST_KINDS.flatMap((kind) => SITE_NAMES[kind]) : null;
}

/** A name as a word of a text: «ChatSpace обновился», «Fansly’s» — not `openChatSpace`, an i18n key or an identifier. */
const nameInText = (names: readonly string[]): RegExp => new RegExp(`(?<![\\p{L}\\p{N}_$])(?:${names.map(escapeRegExp).join('|')})(?![\\p{L}\\p{N}_$])`, 'u');

/**
 * 1a. A text of a gated file that says a site's name — a string, a template's chunk, a JSX text; by AST, so a comment
 * never counts. A shared text says the site's phrase instead (`{site}`, `{onSite}`, `{siteAccount}`, `{sitePlatform}`).
 */
export function checkSiteNames(files: readonly SourceFile[]): Violation[] {
  const violations: Violation[] = [];
  for (const file of files) {
    const names = forbiddenSiteNames(file.path);
    if (names === null || names.length === 0) continue;
    const pattern = nameInText(names);
    const source = parse(file);
    walk(source, (node) => {
      const isText = ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isJsxText(node);
      if (!isText || (ts.isStringLiteralLike(node) && isModuleSpecifier(node))) return;
      const name = pattern.exec(node.text)?.[0];
      if (name === undefined) return;
      const owner = siteOfPath(file.path);
      const where = owner === null ? 'a shared text names no site: say its phrase — {site}, {onSite}, {siteAccount}, {sitePlatform} — and the I18n port puts the site’s own in' : `${owner.kind}'s own text names no other site`;
      violations.push({ gate: 'site-name', path: file.path, line: lineOf(source, node), message: `«${name}» in «${node.text.trim().slice(0, 60)}» — ${where} (docs/project-unite/architecture.md §1.8, §3.4).` });
    });
  }
  return violations;
}

// ── 2. Bytes per site ───────────────────────────────────────────────────────

/** The background core: the event page both sites load. Pinned with ChatSpace's files (architecture.md §1.8). */
export const BACKGROUND_CORE_FILE = 'background.js';

/** A built file, by its path inside the extension. */
export interface BuiltFile {
  readonly path: string;
  readonly data: Uint8Array;
}

/**
 * Whether a built file is the site's own — one of its scripts, a file of its lazy build, its background chunk — or
 * the background core: everything a tab of the site and its background load.
 */
export function isSiteArtifact(host: HostDescriptor, path: string): boolean {
  const scripts = [host.scripts.main, host.scripts.isolated, ...(host.scripts.notice === undefined ? [] : [host.scripts.notice]), ...(host.scripts.extra ?? [])];
  return path === BACKGROUND_CORE_FILE || path === host.background?.file || path.startsWith(`${host.lazy.root}/`) || scripts.some((script) => script.file === path);
}

export interface ArtifactPin {
  /** The file as it ships, in bytes. */
  readonly bytes: number;
  readonly sha256: string;
}

/** What a site's built files are in the release build: tools/gates/<site>-bytes.json. */
export interface SiteBytes {
  readonly site: string;
  readonly files: Readonly<Record<string, ArtifactPin>>;
}

/** Where ChatSpace's pins are kept. */
export const CHATSPACE_BYTES_PATH = 'tools/gates/chatspace-bytes.json';

export function measureSiteBytes(host: HostDescriptor, built: readonly BuiltFile[]): SiteBytes {
  const files: Record<string, ArtifactPin> = {};
  for (const file of [...built].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    if (isSiteArtifact(host, file.path)) files[file.path] = { bytes: file.data.byteLength, sha256: createHash('sha256').update(file.data).digest('hex') };
  }
  return { site: host.kind, files };
}

/** One file a line, sorted: a diff of the pins is the list of files that moved, and two PRs collide only on a file both changed. */
export function serializeSiteBytes(pins: SiteBytes): string {
  const lines = Object.entries(pins.files).map(([path, pin]) => `    ${JSON.stringify(path)}: { "bytes": ${pin.bytes}, "sha256": "${pin.sha256}" }`);
  return `{\n  "site": ${JSON.stringify(pins.site)},\n  "files": {\n${lines.join(',\n')}\n  }\n}\n`;
}

export function parseSiteBytes(text: string): SiteBytes {
  const parsed = JSON.parse(text) as { site?: unknown; files?: unknown };
  if (typeof parsed.site !== 'string' || typeof parsed.files !== 'object' || parsed.files === null) throw new Error('not a site bytes file: no `site` or no `files`');
  const files: Record<string, ArtifactPin> = {};
  for (const [path, pin] of Object.entries(parsed.files as Record<string, { bytes?: unknown; sha256?: unknown }>)) {
    if (typeof pin.bytes !== 'number' || typeof pin.sha256 !== 'string') throw new Error(`not a site bytes file: ${path} has no bytes or no sha256`);
    files[path] = { bytes: pin.bytes, sha256: pin.sha256 };
  }
  return { site: parsed.site, files };
}

/** A chunk's name without the hash the bundler gives it (`chunks/ai-CG6HL9UU.js` → `chunks/ai-*.js`): the same chunk before and after a change. */
function chunkStem(path: string): string {
  return path.replace(/-[A-Za-z0-9_-]{8}(\.[a-z]+)$/, '-*$1');
}

export interface ByteChange {
  /** The file now; for a file that is gone, the file as it was. */
  readonly path: string;
  /** The pinned name, when the bundler renamed the chunk. */
  readonly was?: string;
  readonly before: number | null;
  readonly after: number | null;
}

/** What differs between the pins and a build: changed, new and gone files; a renamed chunk is one change, not two. */
export function diffSiteBytes(pinned: SiteBytes, built: SiteBytes): ByteChange[] {
  const changes: ByteChange[] = [];
  const gone = Object.keys(pinned.files).filter((path) => built.files[path] === undefined);
  const added = Object.keys(built.files).filter((path) => pinned.files[path] === undefined);
  for (const [path, pin] of Object.entries(built.files)) {
    const before = pinned.files[path];
    if (before !== undefined && before.sha256 !== pin.sha256) changes.push({ path, before: before.bytes, after: pin.bytes });
  }
  const renamedFrom = new Set<string>();
  for (const path of added) {
    const candidates = gone.filter((old) => chunkStem(old) === chunkStem(path) && chunkStem(old) !== old);
    const twins = added.filter((other) => chunkStem(other) === chunkStem(path));
    const old = candidates.length === 1 && twins.length === 1 ? candidates[0] : undefined;
    if (old !== undefined) renamedFrom.add(old);
    changes.push({ path, ...(old === undefined ? {} : { was: old }), before: old === undefined ? null : (pinned.files[old]?.bytes ?? null), after: built.files[path]?.bytes ?? null });
  }
  for (const path of gone) if (!renamedFrom.has(path)) changes.push({ path, before: pinned.files[path]?.bytes ?? null, after: null });
  return changes.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

const signed = (bytes: number): string => (bytes > 0 ? `+${bytes}` : String(bytes));

export function describeByteChange(change: ByteChange): string {
  if (change.before === null) return `new file, ${change.after ?? 0} B`;
  if (change.after === null) return `gone (was ${change.before} B)`;
  const renamed = change.was === undefined ? '' : ` (was ${change.was})`;
  return `${change.before} → ${change.after} B (${signed(change.after - change.before)})${renamed}`;
}

/** 2. The release build's ChatSpace files against their pins: any difference is a violation, with the bytes it moved. */
export function checkSiteBytes(pinned: SiteBytes, built: SiteBytes): Violation[] {
  const violations: Violation[] = [];
  if (pinned.site !== built.site) violations.push({ gate: 'site-bytes', path: CHATSPACE_BYTES_PATH, line: 1, message: `the pins are of ${pinned.site}, the build measured is of ${built.site}.` });
  if (Object.keys(built.files).length === 0) violations.push({ gate: 'site-bytes', path: CHATSPACE_BYTES_PATH, line: 1, message: `the build has no file of ${built.site}: nothing was compared.` });
  for (const change of diffSiteBytes(pinned, built)) {
    violations.push({ gate: 'site-bytes', path: change.path, line: 1, message: `${built.site}'s built file differs from its pin: ${describeByteChange(change)}.` });
  }
  return violations;
}

/**
 * 2a. The diff of the change against the pins: a change that touches Fansly's own files and no shared source cannot
 * rewrite ChatSpace's pins — what moved the bytes is a leak to find, not a number to write down. (A change of
 * neutral files alone may: that is the repair of pins left stale.)
 */
export function checkBytesPinDiff(changedPaths: readonly string[], pinsPath: string = CHATSPACE_BYTES_PATH): Violation[] {
  if (!changedPaths.includes(pinsPath)) return [];
  const others = changedPaths.filter((path) => path !== pinsPath);
  const fansly = others.filter((path) => changeKindOf(path) === 'fansly');
  const shared = others.filter((path) => changeKindOf(path) === 'shared');
  if (fansly.length === 0 || shared.length > 0) return [];
  const shown = fansly.slice(0, 5).join(', ') + (fansly.length > 5 ? ` and ${fansly.length - 5} more` : '');
  return [
    {
      gate: 'site-bytes-diff',
      path: pinsPath,
      line: 1,
      message: `ChatSpace's pins are rewritten by a change of Fansly's own files alone (${shown}): such a change leaves ChatSpace byte-identical — find what leaked into its bundles (\`pnpm lint\`: chatspace-graph-without-fansly, background-core-graph) instead (docs/project-unite/architecture.md §1.8).`,
    },
  ];
}

// ── 3. No Fansly data in ChatSpace's bundles ────────────────────────────────

/**
 * A marker is a name out of a registry of the site — not a word, a sentence or a token of the web platform (a MIME
 * type, a file name): a dotted name (`fx.batch`, `fansly.voice.start`, a text key), a CG code, an absolute address.
 */
const MARKER_SHAPES: readonly RegExp[] = [/^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)+$/, /^CG-[A-Z0-9]+(?:-[A-Z0-9]+)+$/, /^https?:\/\/\S+$/];
/** Addresses that are tokens of the web platform, not of a site: the W3C's namespaces (`createElementNS` of an SVG). */
const PLATFORM_ADDRESSES: readonly RegExp[] = [/^http:\/\/www\.w3\.org\//];
const MARKER_MIN_LENGTH = 6;

function stringsOf(file: SourceFile): string[] {
  const strings: string[] = [];
  walk(parse(file), (node) => {
    if (ts.isStringLiteralLike(node) && !isModuleSpecifier(node)) strings.push(node.text);
  });
  return strings;
}

/**
 * The strings only a site's own modules carry: every string literal of its files (site-paths.cjs) that has the shape
 * of a registry name and stands in no other file given — the shared source and the vendored packages a bundle is
 * built from. Derived at gate time, so a new registry of the site brings its own markers. What shared code also
 * names — the host kind, the platform, an address the hub's schema knows — is no marker: a ChatSpace bundle carries
 * it by right.
 */
export function deriveSiteMarkers(files: readonly SourceFile[], site: Site): string[] {
  const own = new Set<string>();
  const others = new Set<string>();
  for (const file of files) {
    if (isNeutralPath(file.path)) continue;
    const target = site.owned.test(file.path) ? own : others;
    for (const text of stringsOf(file)) target.add(text);
  }
  return [...own]
    .filter((text) => text.length >= MARKER_MIN_LENGTH && MARKER_SHAPES.some((shape) => shape.test(text)) && !PLATFORM_ADDRESSES.some((token) => token.test(text)) && !others.has(text))
    .sort();
}


/**
 * 3. No built file of `host` carries a marker of another site: a marker counts as a whole string of the bundle (a
 * minifier keeps a string literal verbatim between its quotes), so a longer text that happens to contain one is not
 * a hit.
 */
export function checkSiteMarkers(built: ReadonlyArray<{ readonly path: string; readonly text: string }>, host: HostDescriptor, markers: readonly string[], of: string): Violation[] {
  if (markers.length === 0) throw new Error(`checkSiteMarkers: no markers of ${of} (derive them from its own sources).`);
  const longestFirst = [...markers].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`(["'\`])(${longestFirst.map(escapeRegExp).join('|')})\\1`, 'g');
  const violations: Violation[] = [];
  for (const file of built) {
    if (!/\.[cm]?js$/.test(file.path) || !isSiteArtifact(host, file.path)) continue;
    const hits = [...file.text.matchAll(pattern)];
    const first = hits[0];
    if (first === undefined) continue;
    const found = [...new Set(hits.map((hit) => hit[2] ?? ''))];
    const shown = found.slice(0, 3).map((text) => `«${text}»`);
    const more = found.length > 3 ? ` and ${found.length - 3} more` : '';
    violations.push({
      gate: 'site-markers',
      path: file.path,
      line: file.text.slice(0, first.index).split('\n').length,
      message: `a file ${host.kind} loads carries data of ${of}: ${shown.join(', ')}${more} (docs/project-unite/architecture.md §1.8, §3.2).`,
    });
  }
  return violations;
}

// ── 4. No build field and no parity row in a bundle ─────────────────────────

/** What of the host registry is build data and must never ship (architecture.md §1.2): the strings its entries carry for the tools alone. */
export function registryBuildFields(hosts: readonly HostDescriptor[]): string[] {
  return hosts.flatMap((host) => [
    ...host.budgets.scripts.map((budget) => budget.label),
    ...host.budgets.contracts.map((probe) => probe.label),
    ...Object.values(host.lazy.entries),
    host.contractCheck.module,
    host.contractCheck.bundlesRootEnv,
    ...host.mainWorldSources,
    ...[...host.archiveMarkers.code, ...host.archiveMarkers.libraries].map((marker) => marker.source),
  ]);
}

/**
 * 4. No built file carries a build field of the host registry or a row of the parity tables (the negative checks of
 * the exceptions registry are the one piece of them a package exports): both are for the tools.
 */
export function checkBuildData(built: ReadonlyArray<{ readonly path: string; readonly text: string }>, hosts: readonly HostDescriptor[], parityIds: readonly string[]): Violation[] {
  const fields = registryBuildFields(hosts);
  if (fields.length === 0) throw new Error('checkBuildData: the host registry has no build field to look for.');
  const violations: Violation[] = [];
  const parity = parityIds.length === 0 ? null : new RegExp(`(?<![\\w-])(?:${parityIds.map(escapeRegExp).join('|')})(?![\\w-])`);
  for (const file of built) {
    if (!/\.(?:js|html|css|json)$/.test(file.path)) continue;
    for (const field of fields) {
      const at = file.text.indexOf(field);
      if (at >= 0) violations.push({ gate: 'build-data', path: file.path, line: file.text.slice(0, at).split('\n').length, message: `a build field of the host registry is in the bundle: «${field}» (docs/project-unite/architecture.md §1.2).` });
    }
    const row = parity?.exec(file.text);
    if (row) violations.push({ gate: 'build-data', path: file.path, line: file.text.slice(0, row.index).split('\n').length, message: `a row of the parity tables is in the bundle: «${row[0]}» (docs/project-unite/architecture.md §1.8).` });
  }
  return violations;
}
