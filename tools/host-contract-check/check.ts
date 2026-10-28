// Local check of the ChatSpace host contract against a copy of ChatSpace's
// bundles (architecture.md §6.2 «Сверка с новой сборкой»). Pure functions over
// file names and texts; index.ts reads the copy from disk. Never in CI: the
// bundles are someone else's code and live outside the repository (А2).
//
// The machinery is the sites' common one: a string looked for line by line
// (`Anchor`, `checkAnchors`, the pattern helpers) and — R20 P7h — a site's
// report of a copy read by the site's EXPECTED set of anchors, the way the
// tab's log reads a page's (`verdictOf` → `contractFactsOf`, FS-CTR-1). The
// anchors below are ChatSpace's; Fansly's are in anchors-fansly.ts.
//
// What it tells: for every string the adapter relies on
// (packages/host-chatspace/src/isolated/host-contract.ts) — present or
// missing, with file:line of the first places; the receipt-profile
// fingerprint of the copy (the role modules of the send path, §6.2 «профиль
// пути отправки и квитанции»); whether the send path's own anchors all sit in
// those role modules (the regroup tripwire, §6.2 «Перегруппировка модулей»);
// and, against another copy, which role modules and which of their imports
// changed. It prints names, lines and hashes — never ChatSpace's code.

import { createHash } from 'node:crypto';

import { contractFactsOf } from '../../apps/extension/src/composition/tab/host-facts.ts';
import { HostContractReportSchema, contractHostOf, type HostContractShape } from '../../packages/contracts/src/host.ts';
import type { HostKind } from '../../packages/contracts/src/hosts.ts';
import * as contract from '../../packages/host-chatspace/src/isolated/host-contract.ts';

export interface BundleFile {
  /** File name inside the copy: `<role>-<hash>.js`, `index.html`, a stylesheet. */
  readonly name: string;
  readonly text: string;
}

export interface Anchor {
  readonly id: string;
  /** What breaks when it is missing. */
  readonly group: string;
  readonly pattern: RegExp;
  /** A line the pattern matched counts only when this agrees (the file's lines, the line's index). */
  readonly confirm?: (lines: readonly string[], index: number) => boolean;
}

export interface AnchorResult {
  readonly id: string;
  readonly group: string;
  readonly present: boolean;
  /** First places, `file:line`. */
  readonly at: readonly string[];
  readonly count: number;
}

/** The send queue's action (the name lives in the send port's file only; pinned by check.test.ts). */
export const QUEUE_ACTION = 'enqueue';
/** The platform part of KEY_BUYING_POWERS: the argument ChatSpace's key factory gets for it (platformKeyAnchor). */
export const BUYING_POWERS_PLATFORM = 'onlyfans';

/** The text as a part of a regular expression. */
export const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A string literal in any quotes. */
export const literal = (value: string): RegExp => new RegExp(`[\`'"]${escape(value)}[\`'"]`);
/** A member or identifier: not a part of a longer name. */
export const word = (value: string): RegExp => new RegExp(`(?<![\\w$])${escape(value)}(?![\\w$])`);
export const text = (value: string): RegExp => new RegExp(escape(value));

/** How a minified build names a variable or a parameter. */
const NAME = '[A-Za-z_$][\\w$]*';
/** Lines above the key where its factory may begin (the prettified copy breaks after `{`). */
const FACTORY_LINES = 2;

/**
 * A cache key ChatSpace builds per platform. Through 0.195.0 it wrote the key
 * as a literal (`["onlyfansBuyingPowers"]`); since 0.200.0 a factory takes the
 * platform and builds the key from it (`${platform}BuyingPowers`), and the
 * module calls the factory once per platform. The key in the page is the same.
 * Either form counts, the second only when all of it is there: the template
 * is the platform part as the factory's one parameter followed by the rest of
 * the key, it stands in that factory's body (the factory begins on its line or
 * at most FACTORY_LINES above, with no other function between), and the same
 * module calls the factory with this platform. A template of another suffix,
 * one the factory is not called with for this platform, or one built from
 * something other than the factory's parameter does not count.
 */
export function platformKeyAnchor(key: string, platform: string, group: string): Anchor {
  if (!key.startsWith(platform) || key.length === platform.length) throw new Error(`host-contract-check: ${key} is not a ${platform} key`);
  const suffix = escape(key.slice(platform.length));
  const template = new RegExp(`\`\\$\\{(${NAME})\\}${suffix}\``);
  const confirm = (lines: readonly string[], index: number): boolean => {
    const line = lines[index] ?? '';
    if (literal(key).test(line)) return true;
    const found = template.exec(line);
    const param = found?.[1];
    if (found === null || param === undefined) return false;
    // The text from FACTORY_LINES above up to the template: its last function head must be the factory, right before the key.
    const before = [...lines.slice(Math.max(0, index - FACTORY_LINES), index), line.slice(0, found.index)].join('\n');
    const heads = [...before.matchAll(new RegExp(`(?<![\\w$.])(${NAME})\\s*=\\s*(?:\\(\\s*(${NAME})\\s*\\)|(${NAME}))\\s*=>|function\\s+(${NAME})\\s*\\(\\s*(${NAME})\\s*\\)`, 'g'))];
    const head = heads.at(-1);
    if (head === undefined) return false;
    const factory = head[1] ?? head[4];
    if (factory === undefined || (head[2] ?? head[3] ?? head[5]) !== param) return false;
    if (/=>|function\b/.test(before.slice(head.index + head[0].length))) return false;
    const called = new RegExp(`(?<![\\w$.])${escape(factory)}\\(\\s*[\`'"]${escape(platform)}[\`'"]\\s*\\)`);
    return lines.some((other) => called.test(other));
  };
  return { id: `cache key ${key}`, group, pattern: new RegExp(`${literal(key).source}|${template.source}`), confirm };
}

/** The anchor's places in one file: line indexes. */
function placesIn(anchor: Anchor, lines: readonly string[]): number[] {
  const places: number[] = [];
  lines.forEach((line, index) => {
    if (anchor.pattern.test(line) && (anchor.confirm === undefined || anchor.confirm(lines, index))) places.push(index);
  });
  return places;
}

/** Every string of the host contract, as it must appear in ChatSpace's bundles. */
export function contractAnchors(): Anchor[] {
  const anchors: Anchor[] = [
    { id: `selector ${contract.APP_SELECTOR}`, group: 'app', pattern: literal(contract.APP_SELECTOR) },
    { id: 'composer slot data-id', group: 'composerBridge', pattern: literal(/data-id="([^"]+)"/.exec(contract.SLOT_SELECTOR)?.[1] ?? '') },
    { id: `class ${contract.FRAME_SELECTOR}`, group: 'composerFrame', pattern: word(contract.FRAME_SELECTOR.slice(1)) },
    { id: `class ${contract.EDITOR_SELECTOR}`, group: 'composerBridge', pattern: word(contract.EDITOR_SELECTOR.slice(1)) },
    { id: `attribute ${contract.DISMISSIBLE_ATTRIBUTE}`, group: 'overlays', pattern: text(contract.DISMISSIBLE_ATTRIBUTE) },
    { id: `route ${contract.ROUTE_CHAT}`, group: 'router', pattern: literal(contract.ROUTE_CHAT) },
    { id: `route ${contract.ROUTE_OVERVIEW}`, group: 'router', pattern: literal(contract.ROUTE_OVERVIEW) },
    { id: 'route params accountId/chatId', group: 'router', pattern: /accounts\/:accountId\/chats\/:chatId/ },
    ...[contract.STORE_CACHE, contract.STORE_CHATS, contract.STORE_QUEUE, contract.STORE_TRANSLATOR, contract.STORE_TABS, contract.STORE_ACCOUNTS].map((id) => ({ id: `store ${id}`, group: 'stores', pattern: literal(id) })),
    ...[
      contract.KEY_ACCOUNTS,
      contract.KEY_MESSAGES,
      contract.KEY_FANS,
      contract.KEY_CHAT_LIST,
      contract.KEY_MIMIC_SETTINGS,
      contract.KEY_MIMIC_CHATS,
      contract.KEY_PERMISSIONS,
      contract.KEY_INSIGHTS,
    ].map((key) => ({ id: `cache key ${key}`, group: 'cache', pattern: literal(key) })),
    // Since 0.200.0 ChatSpace builds this key per platform (`${platform}BuyingPowers`); the page's key is the same.
    platformKeyAnchor(contract.KEY_BUYING_POWERS, BUYING_POWERS_PLATFORM, 'cache'),
    { id: `queue action ${QUEUE_ACTION}`, group: 'pendingMessages', pattern: word(QUEUE_ACTION) },
    { id: 'draft key prefix', group: 'draftKey', pattern: text(contract.DRAFT_KEY_PREFIX.split(':').slice(0, 2).join(':')) },
    { id: `socket path ${contract.WS_PATH}`, group: 'wsFrames', pattern: text(contract.WS_PATH) },
    { id: `socket event ${contract.WS_NEW_MESSAGE}`, group: 'wsFrames', pattern: literal(contract.WS_NEW_MESSAGE) },
    { id: `socket event ${contract.WS_AUTHENTICATED}`, group: 'wsFrames', pattern: literal(contract.WS_AUTHENTICATED) },
    { id: 'native send request path', group: 'receipt', pattern: /api\/v0\/accounts\/\$\{[^}]+\}\/chats\/\$\{[^}]+\}\/messages/ },
    { id: `permission ${contract.PERMISSION_NO_SEND}`, group: 'userPermissions', pattern: literal(contract.PERMISSION_NO_SEND) },
    ...contract.PERMISSIONS_UPLOAD.map((permission) => ({ id: `permission ${permission}`, group: 'userPermissions', pattern: literal(permission) })),
    { id: `guard code ${contract.GUARD_CODE}`, group: 'receipt', pattern: literal(contract.GUARD_CODE) },
    { id: `theme class ${contract.THEME_DARK_CLASS}`, group: 'theme', pattern: literal(contract.THEME_DARK_CLASS) },
    { id: `theme tokens ${contract.THEME_TOKEN_PREFIX}`, group: 'theme', pattern: text(contract.THEME_TOKEN_PREFIX) },
    { id: `fixed width ${contract.FIXED_WIDTH_VARIABLE}`, group: 'theme', pattern: text(contract.FIXED_WIDTH_VARIABLE) },
    // 2026-10-28: «Заметки» in the conversation header, and OnlyMonster's fan notes (their path, the socket's word on them).
    ...[contract.HEADER_SEARCH_TEST_ID, ...contract.HEADER_AFTER_TEST_IDS].map((id) => ({ id: `header test id ${id}`, group: 'chatHeader', pattern: literal(id) })),
    { id: 'fan notes request path', group: 'fanNotes', pattern: /api\/v0\/accounts\/\$\{[^}]+\}\/fans\/\$\{[^}]+\}\/notes/ },
    { id: `socket event ${contract.WS_DATA_UPDATED}`, group: 'fanNotes', pattern: literal(contract.WS_DATA_UPDATED) },
    { id: `socket data type ${contract.WS_USER_NOTES}`, group: 'fanNotes', pattern: literal(contract.WS_USER_NOTES) },
  ];
  for (const [group, members] of Object.entries(contract.HOST_MEMBERS)) {
    for (const member of members) anchors.push({ id: `member ${member}`, group, pattern: word(member) });
  }
  return anchors;
}

/** Looks for every anchor in the copy; `limit` places per anchor. */
export function checkAnchors(files: readonly BundleFile[], anchors: readonly Anchor[] = contractAnchors(), limit = 3): AnchorResult[] {
  const lines = files.map((file) => ({ name: file.name, lines: file.text.split('\n') }));
  return anchors.map((anchor) => {
    const at: string[] = [];
    let count = 0;
    for (const file of lines) {
      for (const index of placesIn(anchor, file.lines)) {
        count += 1;
        if (at.length < limit) at.push(`${file.name}:${index + 1}`);
      }
    }
    return { id: anchor.id, group: anchor.group, present: count > 0, at, count };
  });
}

// ── A site's report of a copy, read by its expected set (R20 P7h) ──────────

/**
 * The contract anchors a copy shows, by the strings found: an anchor (the strings' `group`) is `ok` when every one of
 * its strings is present, `missing` when one is not. Only the anchors the strings name: an anchor of the site that has
 * no string here is absent, and the reader of the expected set reads it `missing`.
 */
export function anchorStates(results: readonly AnchorResult[]): Record<string, 'ok' | 'missing'> {
  const states: Record<string, 'ok' | 'missing'> = {};
  for (const result of results) states[result.group] = states[result.group] === 'missing' || !result.present ? 'missing' : 'ok';
  return states;
}

/** The contract facts of the tab's log (DB-031). */
export type ContractFacts = ReturnType<typeof contractFactsOf>;

/** What a schema says against a value: where and why. */
interface SchemaIssues {
  readonly issues: ReadonlyArray<{ readonly path: readonly PropertyKey[]; readonly message: string }>;
}

/** How a site's own report is told from any other (its strict schema), as the check needs it. */
export interface StrictReport {
  safeParse(value: unknown): { readonly success: boolean; readonly error?: SchemaIssues };
}

/** What a site's report is read by: the site, its expected set of anchors and the strict branch of its report. */
export interface SiteContract {
  readonly kind: HostKind;
  readonly shape: HostContractShape;
  readonly strict: StrictReport;
}

export interface ContractVerdict {
  /** Every anchor of the site's expected set is `ok`, in a report of the site's own shape. */
  readonly green: boolean;
  /** The report as the tab's log reads it; null — it is no report of this site. */
  readonly facts: ContractFacts | null;
  /** Why it is not green, one line each. */
  readonly problems: readonly string[];
}

const issuesOf = (error: SchemaIssues | undefined): string => (error?.issues ?? []).map((issue) => `${issue.path.map(String).join('.') || 'the report'}: ${issue.message}`).join('; ');

/**
 * A site's report of a copy, read the way the tab's log reads a page's (FS-CTR-1): first by the schema the hub
 * accepts, then by the site's EXPECTED set (`contractFactsOf`) — an anchor the report does not name is `missing`,
 * never «nothing to check» — and by the strict branch of the site's report (its block, every anchor and capability
 * named). Green only when every expected anchor is `ok`: in a copy of the bundle all of the site's code is there, so
 * an anchor a page shows only sometimes (`notYet`) or only behind the owner's switch (`switchedAnchors`) must be found
 * too. A report without the site's block, or without one anchor, is not green.
 */
export function verdictOf(report: unknown, site: SiteContract): ContractVerdict {
  const parsed = HostContractReportSchema.safeParse(report);
  if (!parsed.success) return { green: false, facts: null, problems: [`no host contract report the hub accepts: ${issuesOf(parsed.error)}`] };
  const host = contractHostOf(parsed.data);
  if (host !== site.kind) return { green: false, facts: null, problems: [`a report of ${host}, not of ${site.kind}`] };
  const facts = contractFactsOf(parsed.data, site.shape);
  const problems = [...facts.missing.map((anchor) => `anchor ${anchor}: not ok`), ...(facts.notYet ?? []).map((anchor) => `anchor ${anchor}: not yet`)];
  const strict = site.strict.safeParse(report);
  if (!strict.success) problems.push(`not a report of ${site.kind}'s own shape: ${issuesOf(strict.error)}`);
  return { green: problems.length === 0, facts, problems };
}

/** The build fingerprint (the entry module's hashed name) from the copy's index.html. */
export function buildOf(indexHtml: string): string | null {
  return contract.BUILD_PATTERN.exec(indexHtml)?.[1] ?? null;
}

/**
 * Role → fingerprint of the copy's send-path modules: the same rule as the
 * adapter's `receiptModules` (isolated/receipt-profile.ts; check.test.ts pins
 * the two together).
 */
export function receiptFingerprint(fileNames: readonly string[]): Record<string, string> {
  const modules: Record<string, string> = {};
  for (const role of contract.RECEIPT_MODULE_ROLES) {
    const hashes = new Set<string>();
    for (const name of fileNames) {
      const match = contract.MODULE_PATTERN.exec(`/assets/${name}`);
      if (match?.[1] === role && match[2] !== undefined) hashes.add(match[2]);
    }
    if (hashes.size > 0) modules[role] = [...hashes].sort().join('+');
  }
  return modules;
}

/** A profile ready for the hub's `limits.previewSendReceiptProfiles` — to be added only after the review of §6.2. */
export function receiptProfile(fileNames: readonly string[], version: string | null): { id: string; adapterVersion: string; modules: Record<string, string> } {
  return { id: `chatspace-${version ?? 'unknown'}`, adapterVersion: contract.ADAPTER_VERSION, modules: receiptFingerprint(fileNames) };
}

/** Roles of the send path that have no module in the copy: such a build matches no profile. */
export function missingRoles(modules: Readonly<Record<string, string>>): string[] {
  return contract.RECEIPT_MODULE_ROLES.filter((role) => !(role in modules));
}

/** A send-path anchor found outside the role modules, or nowhere at all: the build regrouped or changed its send path. */
export interface SendPathProblem {
  readonly part: string;
  readonly anchor: string;
  /** Places outside the role modules, `file:line` (the first few); empty — found nowhere. */
  readonly at: readonly string[];
  readonly count: number;
}

const isRoleModule = (fileName: string): boolean => {
  const role = contract.MODULE_PATTERN.exec(`/assets/${fileName}`)?.[1];
  return role !== undefined && contract.RECEIPT_MODULE_ROLES.includes(role);
};

/** The send path's anchors (host-contract.ts SEND_PATH_ANCHORS) as the tool looks for them. */
export function sendPathAnchors(): Anchor[] {
  const pattern = (anchor: contract.SendPathAnchor): RegExp => (anchor.kind === 'member' ? word(anchor.value) : anchor.kind === 'string' ? literal(anchor.value) : text(anchor.value));
  return contract.SEND_PATH_ANCHORS.map((anchor) => ({ id: `${anchor.kind} ${anchor.value}`, group: anchor.part, pattern: pattern(anchor) }));
}

/**
 * The regroup tripwire (§6.2 «Перегруппировка модулей»): every send-path
 * anchor must be found, and only in the role modules; the queue's action must
 * be in the module of the queue store. Nothing returned — the send path is
 * where the profile looks.
 */
export function sendPathOutsideRoles(files: readonly BundleFile[], limit = 3): SendPathProblem[] {
  const problems: SendPathProblem[] = [];
  for (const anchor of sendPathAnchors()) {
    const found = checkAnchors(files, [anchor], Number.MAX_SAFE_INTEGER)[0];
    const outside = (found?.at ?? []).filter((place) => !isRoleModule(place.slice(0, place.lastIndexOf(':'))));
    if (found === undefined || !found.present) problems.push({ part: anchor.group, anchor: anchor.id, at: [], count: 0 });
    else if (outside.length > 0) problems.push({ part: anchor.group, anchor: anchor.id, at: outside.slice(0, limit), count: outside.length });
  }
  const storeFiles = files.filter((file) => literal(contract.STORE_QUEUE).test(file.text));
  const action = word(QUEUE_ACTION);
  const without = storeFiles.filter((file) => !action.test(file.text)).map((file) => file.name);
  if (storeFiles.length > 0 && without.length > 0) problems.push({ part: 'queue action', anchor: `queue action ${QUEUE_ACTION} beside store ${contract.STORE_QUEUE}`, at: without.slice(0, limit), count: without.length });
  return problems;
}

/** The modules a role module imports statically, by name without the hash, with their hashes. */
export function importsOf(file: BundleFile): Record<string, string> {
  const imports: Record<string, string> = {};
  for (const match of file.text.matchAll(/from\s*["'`]\.\/([^"'`]+)["'`]/g)) {
    const module = contract.MODULE_PATTERN.exec(`/assets/${match[1] ?? ''}`);
    if (module?.[1] !== undefined && module[2] !== undefined) imports[module[1]] = imports[module[1]] ? `${imports[module[1]]}+${module[2]}` : module[2];
  }
  return imports;
}

const KEYWORDS = new Set(
  'async await break case catch class const continue default delete do else export extends false finally for from function if import in instanceof let new null of return static super switch this throw true try typeof undefined var void while yield'.split(' '),
);

/**
 * The shape of a piece of built code: strings, numbers, member and key names,
 * keywords and punctuation as they are; every other name — a variable the
 * minifier renames from build to build — as `$`. Two builds of unchanged
 * source have the same shape.
 */
export function shapeOf(code: string): string {
  const tokens = code.match(/`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[A-Za-z_$][\w$]*|\d[\w.]*|\S/g) ?? [];
  return tokens
    .map((token, index) => {
      if (!/^[A-Za-z_$]/.test(token) || KEYWORDS.has(token)) return token;
      return tokens[index - 1] === '.' || tokens[index + 1] === ':' ? token : '$';
    })
    .join(' ');
}

/** Lines of built code around an anchor that are compared between two copies. */
const WINDOW_LINES = 12;
/** Places of one anchor in one role that are compared; more than that says nothing about the send path. */
const MAX_PLACES = 40;

/** Role → anchor → the shape hash of the code around each place of the anchor, with its line. */
function anchorShapes(files: readonly BundleFile[], anchors: readonly Anchor[]): Map<string, Array<{ readonly at: string; readonly hash: string }>> {
  const shapes = new Map<string, Array<{ at: string; hash: string }>>();
  for (const file of files) {
    const role = contract.MODULE_PATTERN.exec(`/assets/${file.name}`)?.[1];
    if (role === undefined || !contract.RECEIPT_MODULE_ROLES.includes(role)) continue;
    const lines = file.text.split('\n');
    for (const anchor of anchors) {
      const key = `${role}\n${anchor.id}`;
      const list = shapes.get(key) ?? [];
      for (const index of placesIn(anchor, lines)) {
        if (list.length >= MAX_PLACES) break;
        const window = lines.slice(Math.max(0, index - WINDOW_LINES), index + WINDOW_LINES + 1).join('\n');
        list.push({ at: `${file.name}:${index + 1}`, hash: createHash('sha256').update(shapeOf(window)).digest('hex').slice(0, 12) });
      }
      if (list.length > 0) shapes.set(key, list);
    }
  }
  return shapes;
}

export interface CopyDiff {
  /** Role modules whose fingerprint differs between the two copies. */
  readonly roles: ReadonlyArray<{ readonly role: string; readonly from: string | null; readonly to: string | null }>;
  /**
   * Inside the role modules: the code around each anchor, compared by shape
   * (names the minifier renames do not count). `changed` lists the places of
   * the new copy whose surroundings are not found in the old one. A role
   * whose hash changed and whose anchors all stand in unchanged code is the
   * false alarm of a big shared module (§6.2).
   */
  readonly code: ReadonlyArray<{ readonly role: string; readonly anchor: string; readonly same: number; readonly changed: readonly string[] }>;
  /** Imports of the role modules that changed, appeared or went: where to look when a role's hash changed. */
  readonly imports: ReadonlyArray<{ readonly role: string; readonly module: string; readonly from: string | null; readonly to: string | null }>;
  /** Anchors present in one copy and missing in the other. */
  readonly anchors: ReadonlyArray<{ readonly id: string; readonly from: boolean; readonly to: boolean }>;
}

/** What changed in the send path between two copies: hashes and anchors, never code. */
export function diffCopies(from: readonly BundleFile[], to: readonly BundleFile[]): CopyDiff {
  const names = (files: readonly BundleFile[]): string[] => files.map((file) => file.name);
  const before = receiptFingerprint(names(from));
  const after = receiptFingerprint(names(to));
  const roles = contract.RECEIPT_MODULE_ROLES.filter((role) => before[role] !== after[role]).map((role) => ({ role, from: before[role] ?? null, to: after[role] ?? null }));
  const importsByRole = (files: readonly BundleFile[]): Record<string, Record<string, string>> => {
    const result: Record<string, Record<string, string>> = {};
    for (const file of files) {
      const role = contract.MODULE_PATTERN.exec(`/assets/${file.name}`)?.[1];
      if (role !== undefined && contract.RECEIPT_MODULE_ROLES.includes(role)) result[role] = { ...result[role], ...importsOf(file) };
    }
    return result;
  };
  const beforeImports = importsByRole(from);
  const afterImports = importsByRole(to);
  const imports: Array<{ role: string; module: string; from: string | null; to: string | null }> = [];
  for (const role of contract.RECEIPT_MODULE_ROLES) {
    const modules = new Set([...Object.keys(beforeImports[role] ?? {}), ...Object.keys(afterImports[role] ?? {})]);
    for (const module of [...modules].sort()) {
      const was = beforeImports[role]?.[module] ?? null;
      const now = afterImports[role]?.[module] ?? null;
      if (was !== now) imports.push({ role, module, from: was, to: now });
    }
  }
  const anchorsBefore = checkAnchors(from);
  const anchorsAfter = checkAnchors(to);
  const anchors = anchorsBefore.flatMap((result, index) => (result.present === anchorsAfter[index]?.present ? [] : [{ id: result.id, from: result.present, to: anchorsAfter[index]?.present ?? false }]));
  const all = contractAnchors();
  const shapesBefore = anchorShapes(from, all);
  const code: Array<{ role: string; anchor: string; same: number; changed: string[] }> = [];
  for (const [key, places] of anchorShapes(to, all)) {
    const [role = '', anchor = ''] = key.split('\n');
    const known = (shapesBefore.get(key) ?? []).map((place) => place.hash);
    const changed: string[] = [];
    for (const place of places) {
      const index = known.indexOf(place.hash);
      if (index === -1) changed.push(place.at);
      else known.splice(index, 1);
    }
    code.push({ role, anchor, same: places.length - changed.length, changed });
  }
  return { roles, imports, anchors, code };
}
