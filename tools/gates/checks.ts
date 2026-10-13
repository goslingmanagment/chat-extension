// Static invariants of architecture.md §3 «pnpm check» п. 7 (and §12 «Гейт
// безопасности»). Pure functions over {path, text}; index.ts feeds them the
// repo and the release build. Code is parsed with the TypeScript compiler, so
// comments and prose never trip a gate — only real code does.
//
// The gates that keep the two sites apart (R20 F9a: site literals, bytes per
// site, marker strings, build fields) are in sites.ts.

import ts from 'typescript';

import { HOSTS, scriptsOf, type HostDescriptor } from '../../apps/extension/src/hosts/index.ts';

export interface SourceFile {
  /** Repo-relative POSIX path. */
  readonly path: string;
  readonly text: string;
}

export interface Violation {
  readonly gate: string;
  readonly path: string;
  readonly line: number;
  readonly message: string;
}

/** The host registry (apps/extension/src/hosts): its runtime rows and entries name the sites' addresses. */
export const HOST_REGISTRY_DIR = 'apps/extension/src/hosts/';

/** Files allowed to name the ChatSpace origin: the host registry and each site's host contract (§3). */
export function onlyMonsterAllowed(path: string, hosts: readonly HostDescriptor[] = HOSTS): boolean {
  return path.startsWith(HOST_REGISTRY_DIR) || hosts.some((host) => host.contractCheck.module === path);
}

/** Where `browser.*` / `chrome.*` may appear: packages/platform only (§3, §4, D-01). */
export const BROWSER_API_ALLOWED: readonly RegExp[] = [/^packages\/platform\/src\//];

/** The only file that may reference ChatSpace's send queue method (§6.7, D-07). */
export const SEND_PORT_FILE = 'packages/host-chatspace/src/main/send-port.ts';
const SEND_QUEUE_METHOD = 'enqueue';
/** The method name as a whole identifier inside a string or template: `not_enqueued` (a hub wire token) is not it. */
const SEND_QUEUE_IN_TEXT = new RegExp(`(?<![\\w$])${SEND_QUEUE_METHOD}(?![\\w$])`);

/** Where user-visible UI text lives until the i18n catalogs exist (R13/R16). */
export const UI_TEXT_SCOPES: readonly RegExp[] = [/^packages\/ui\/src\/.*\.tsx$/, /^apps\/extension\/src\/composition\/pages\.ts$/];
/** AU-019: no keys and no token/key/API/bearer vocabulary in UI texts. */
export const UI_FORBIDDEN_WORDS = /\b(?:api|tokens?|bearer|keys?|apikey|api-key)\b|токен|ключ(?!ев)/i;

const HTML_SINKS = new Set(['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'createContextualFragment', 'dangerouslySetInnerHTML']);
const UI_TEXT_ATTRIBUTES = new Set(['title', 'placeholder', 'aria-label', 'alt', 'label', 'aria-description']);

export function parse(file: SourceFile): ts.SourceFile {
  const kind = file.path.endsWith('.tsx') ? ts.ScriptKind.TSX : /\.[cm]?js$/.test(file.path) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  return ts.createSourceFile(file.path, file.text, ts.ScriptTarget.Latest, true, kind);
}

/** String literals and every template chunk (`…${x}…`). */
function isTextNode(node: ts.Node): node is ts.StringLiteralLike | ts.TemplateHead | ts.TemplateMiddle | ts.TemplateTail {
  return ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node);
}

export function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

export function walk(source: ts.SourceFile, visit: (node: ts.Node) => void): void {
  const step = (node: ts.Node): void => {
    visit(node);
    ts.forEachChild(node, step);
  };
  step(source);
}

/**
 * Text of a string/template chunk or a regex literal, with regex escaping
 * undone (`chat\.onlymonster\.ai`, `onlymonster[.]ai` → `onlymonster.ai`).
 */
function namesOnlyMonster(text: string): boolean {
  const plain = text.replace(/\[\.\]/g, '.').replace(/\\/g, '');
  return /onlymonster\.ai/i.test(plain);
}

/** 1. No reference to onlymonster.ai in our code outside the allowlist (strings, templates, regexes). */
export function checkOnlyMonsterReferences(files: readonly SourceFile[]): Violation[] {
  const violations: Violation[] = [];
  for (const file of files) {
    if (onlyMonsterAllowed(file.path)) continue;
    const source = parse(file);
    walk(source, (node) => {
      if ((isTextNode(node) || ts.isRegularExpressionLiteral(node)) && namesOnlyMonster(node.text)) {
        violations.push({
          gate: 'onlymonster-reference',
          path: file.path,
          line: lineOf(source, node),
          message: 'ChatSpace origin named outside the host registry (apps/extension/src/hosts) and the host contract file (§3, X3).',
        });
      }
    });
  }
  return violations;
}

/** 2. No HTML sinks (innerHTML & co): our DOM is built by Preact or textContent only. */
export function checkHtmlSinks(files: readonly SourceFile[]): Violation[] {
  const violations: Violation[] = [];
  for (const file of files) {
    const source = parse(file);
    walk(source, (node) => {
      let name: string | null = null;
      if (ts.isPropertyAccessExpression(node)) name = node.name.text;
      else if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) name = node.argumentExpression.text;
      else if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name)) name = node.name.text;
      else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'write') {
        const target = node.expression.expression;
        if (ts.isIdentifier(target) && target.text === 'document') name = 'document.write';
      }
      if (name !== null && (HTML_SINKS.has(name) || name === 'document.write')) {
        violations.push({
          gate: 'html-sink',
          path: file.path,
          line: lineOf(source, node),
          message: `\`${name}\` is forbidden: render with Preact or textContent (§14).`,
        });
      }
    });
  }
  return violations;
}

/** 3. `browser.*` / `chrome.*` only in packages/platform (entry points go through it too). */
export function checkBrowserApiScope(files: readonly SourceFile[]): Violation[] {
  const violations: Violation[] = [];
  for (const file of files) {
    if (BROWSER_API_ALLOWED.some((pattern) => pattern.test(file.path))) continue;
    const source = parse(file);
    walk(source, (node) => {
      if (
        ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        (node.expression.text === 'browser' || node.expression.text === 'chrome')
      ) {
        violations.push({
          gate: 'browser-api-scope',
          path: file.path,
          line: lineOf(source, node),
          message: `\`${node.expression.text}.${node.name.text}\` outside packages/platform (§3, §4, D-01).`,
        });
      }
    });
  }
  return violations;
}

/** 4. No token/key/API/bearer words in UI texts (AU-019) — placeholder until i18n catalogs exist. */
export function checkUiTexts(files: readonly SourceFile[]): Violation[] {
  const violations: Violation[] = [];
  for (const file of files) {
    if (!UI_TEXT_SCOPES.some((pattern) => pattern.test(file.path))) continue;
    const source = parse(file);
    const report = (node: ts.Node, text: string): void => {
      if (!UI_FORBIDDEN_WORDS.test(text)) return;
      violations.push({
        gate: 'ui-text-vocabulary',
        path: file.path,
        line: lineOf(source, node),
        message: `UI text «${text.trim().slice(0, 60)}» uses token/key/API/bearer vocabulary (AU-019).`,
      });
    };
    const pagesFile = !file.path.endsWith('.tsx');
    walk(source, (node) => {
      if (ts.isJsxText(node)) report(node, node.text);
      else if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && UI_TEXT_ATTRIBUTES.has(node.name.text)) {
        const value = node.initializer;
        if (value && ts.isStringLiteral(value)) report(value, value.text);
      } else if (ts.isJsxExpression(node) && node.expression && ts.isStringLiteralLike(node.expression)) {
        report(node.expression, node.expression.text);
      } else if (pagesFile && ts.isStringLiteralLike(node) && !ts.isImportDeclaration(node.parent) && !ts.isLiteralTypeNode(node.parent)) {
        // Page composition passes plain strings as texts; property keys and imports are not texts.
        if (!(ts.isPropertyAssignment(node.parent) && node.parent.name === node)) report(node, node.text);
      }
    });
  }
  return violations;
}

/** 5. The send-queue method is referenced only from the MAIN send port (§6.7, D-07). */
export function checkSendQueueReferences(files: readonly SourceFile[]): Violation[] {
  const violations: Violation[] = [];
  for (const file of files) {
    if (file.path === SEND_PORT_FILE) continue;
    const source = parse(file);
    walk(source, (node) => {
      const hit =
        (ts.isIdentifier(node) && node.text === SEND_QUEUE_METHOD) ||
        (ts.isPrivateIdentifier(node) && node.text === `#${SEND_QUEUE_METHOD}`) ||
        (isTextNode(node) && SEND_QUEUE_IN_TEXT.test(node.text));
      if (hit) {
        violations.push({
          gate: 'send-queue-scope',
          path: file.path,
          line: lineOf(source, node),
          message: `\`${SEND_QUEUE_METHOD}\` may be referenced only from ${SEND_PORT_FILE} (§6.7, D-07).`,
        });
      }
    });
  }
  return violations;
}

/** 6. The release bundle carries nothing test-only: no loopback hosts, no spike or egress probe. */
export function checkReleaseBundle(files: readonly SourceFile[]): Violation[] {
  const markers: Array<[RegExp, string]> = [
    [/127\.0\.0\.1|\blocalhost\b/, 'loopback stand / fake hub host'],
    [/data-cg-spike|lazy\/spike\.js/, 'spike M0 probe'],
    [/cg-test-egress-probe|cg-bg-probe\.invalid/, 'background egress probe'],
    [/chat-extension-test@/, 'test gecko id'],
    [/__cgBundleMarks/, 'spike timing marks'],
    [/cg-e2e-main-throw/, 'the sentry-gate e2e\'s throwing MAIN probe'],
  ];
  const violations: Violation[] = [];
  for (const file of files) {
    for (const [pattern, what] of markers) {
      const match = pattern.exec(file.text);
      if (!match) continue;
      const line = file.text.slice(0, match.index).split('\n').length;
      violations.push({ gate: 'release-bundle', path: file.path, line, message: `release build contains a ${what} (CG_TEST_HOSTS leak).` });
    }
  }
  return violations;
}

/** What marks vendored @kernel/sdk code in a bundle (most telling first); every kind must be found in the SDK. */
export const SDK_MARKER_KINDS = ['error-class', 'kernel-header', 'contract-hash', 'hub-route'] as const;
export type SdkMarkerKind = (typeof SDK_MARKER_KINDS)[number];

export interface SdkMarker {
  readonly kind: SdkMarkerKind;
  readonly text: string;
}

const CONTRACT_HASH = /^[0-9a-f]{64}$/;
const KERNEL_HEADER = /^x-kernel-[a-z0-9-]+$/;
const HUB_ROUTE = /^\/api\/v\d+\/\S+$/;

function isErrorNameAssignment(node: ts.Node): node is ts.BinaryExpression & { right: ts.StringLiteralLike } {
  return (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    ts.isPropertyAccessExpression(node.left) &&
    node.left.expression.kind === ts.SyntaxKind.ThisKeyword &&
    node.left.name.text === 'name' &&
    ts.isStringLiteralLike(node.right)
  );
}

/**
 * Markers of SDK code, derived at gate time from the vendored dist itself (a
 * re-vendor brings its own). Only strings a minifier keeps verbatim count —
 * string literals and template heads, never comments or identifiers:
 * - `contract-hash`: KERNEL_CONTRACT_HASH (bundled only when code reads it);
 * - `error-class`: `this.name = "KernelApiError"` — every request, stream and
 *   read-gateway helper constructs the SDK error, so any of them carries it;
 * - `kernel-header`: `x-kernel-*` request headers;
 * - `hub-route`: hub API paths — the operation table, the stream and gateway
 *   helpers, the route schemas.
 * A lone pure helper or schema may carry none of them: the dependency-cruiser
 * rule `hub-unreachable-outside-background` owns the graph, this gate checks
 * what actually got bundled.
 */
export function deriveSdkMarkers(sdkFiles: readonly SourceFile[]): SdkMarker[] {
  const markers = new Map<string, SdkMarkerKind>();
  for (const file of sdkFiles) {
    walk(parse(file), (node) => {
      if (isErrorNameAssignment(node)) {
        markers.set(node.right.text, 'error-class');
      } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node)) {
        const kind = CONTRACT_HASH.test(node.text)
          ? 'contract-hash'
          : KERNEL_HEADER.test(node.text)
            ? 'kernel-header'
            : HUB_ROUTE.test(node.text)
              ? 'hub-route'
              : null;
        if (kind !== null && !markers.has(node.text)) markers.set(node.text, kind);
      }
    });
  }
  return [...markers].map(([text, kind]) => ({ kind, text })).sort((a, b) => a.text.localeCompare(b.text));
}

/** Kinds the SDK no longer yields: the gate must fail closed rather than check nothing. */
export function missingSdkMarkerKinds(markers: readonly SdkMarker[]): SdkMarkerKind[] {
  return SDK_MARKER_KINDS.filter((kind) => !markers.some((marker) => marker.kind === kind));
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A marker counts only as a whole token: not inside a longer name, path or
 * URL (`/api/v1/pages/7`, `https://host/api/…`, `KernelApiErrorView` do not
 * match). Longest first, so the most specific route is the one reported.
 */
function sdkMarkerPattern(markers: readonly SdkMarker[]): RegExp {
  const texts = markers.map((marker) => marker.text).sort((a, b) => b.length - a.length);
  return new RegExp(`(?<![\\w./-])(?:${texts.map(escapeRegExp).join('|')})(?![\\w./-])`, 'g');
}

/** The only built file that may carry the SDK (§4 «hub только в фоне», D-13). */
export const SDK_BUNDLES_ALLOWED: readonly string[] = ['background.js'];

/**
 * 7. SDK custody (§4, D-13): no built JS file but background.js — no content
 * script, WS tap, lazy chunk or extension page — carries vendored SDK code.
 */
export function checkSdkCustody(
  files: readonly SourceFile[],
  markers: readonly SdkMarker[],
  allowed: readonly string[] = SDK_BUNDLES_ALLOWED,
): Violation[] {
  if (markers.length === 0) throw new Error('checkSdkCustody: no SDK markers (derive them from vendor/kernel-sdk/dist).');
  const pattern = sdkMarkerPattern(markers);
  const kindOf = new Map(markers.map((marker) => [marker.text, marker.kind]));
  const order = (text: string): number => SDK_MARKER_KINDS.indexOf(kindOf.get(text) ?? 'hub-route');
  const violations: Violation[] = [];
  for (const file of files) {
    if (!/\.[cm]?js$/.test(file.path) || allowed.includes(file.path)) continue;
    const hits = [...file.text.matchAll(pattern)];
    const first = hits[0];
    if (first === undefined) continue;
    const found = [...new Set(hits.map((hit) => hit[0]))].sort((a, b) => order(a) - order(b));
    const shown = found.slice(0, 3).map((text) => `${kindOf.get(text) ?? 'marker'} «${text}»`);
    const more = found.length > 3 ? ` and ${found.length - 3} more` : '';
    violations.push({
      gate: 'sdk-custody',
      path: file.path,
      line: file.text.slice(0, first.index).split('\n').length,
      message: `the vendored @kernel/sdk is bundled outside the background (§4, D-13): ${shown.join(', ')}${more}.`,
    });
  }
  return violations;
}

/**
 * Built MAIN-world bundles: every site's scripts of the page's world in the host registry, the manifest's and the ones
 * the background registers alike (ChatSpace: the bridge and the WS tap). The manifest's MAIN content scripts must all be
 * here (index.ts checks it).
 */
export const MAIN_WORLD_BUNDLES: readonly string[] = HOSTS.flatMap((host) => scriptsOf(host).filter((script) => script.world === 'MAIN').map((script) => script.file));

/**
 * 8. The MAIN-world bundles stay self-contained (§4, D-06): no extension API
 * (it does not exist in the page world — a stray import of @cg/platform shows
 * up as `globalThis.browser` / `runtime.getURL`) and no zod (contracts). And
 * nothing that would speak to the page's telemetry (decision X22): no
 * `console` at all (ChatSpace's Sentry keeps every console line as a breadcrumb
 * and sends it with its next error), no `debugger`, and not WXT's entry
 * wrapper, which rethrows a failed start into the page (its log line is the
 * marker; apps/extension/build/main-world-entry.ts keeps it out). The source
 * has the same `console` rule (ESLint); this catches what a dependency or the
 * build brings in.
 */
export function checkMainWorldBundles(files: readonly SourceFile[]): Violation[] {
  const markers: Array<[RegExp, string]> = [
    [/\b(?:browser|chrome)\s*(?:\?\.|\.|\[)|globalThis\.(?:browser|chrome)\b/, 'extension API access'],
    [/\bruntime\.(?:getURL|id|connect|sendMessage)\b/, 'extension runtime call'],
    [/\$Zod|\bZodError\b/, 'zod'],
    // Any reference: an alias (`var c = console`) calls it just the same.
    [/\bconsole\b/, 'a console reference'],
    [/\bdebugger\b/, 'a debugger statement'],
    [/crashed on startup/, 'WXT\'s entry wrapper (it rethrows into the page)'],
  ];
  const violations: Violation[] = [];
  for (const file of files) {
    if (!MAIN_WORLD_BUNDLES.includes(file.path)) continue;
    for (const [pattern, what] of markers) {
      const match = pattern.exec(file.text);
      if (!match) continue;
      const line = file.text.slice(0, match.index).split('\n').length;
      violations.push({ gate: 'main-world-bundle', path: file.path, line, message: `MAIN-world bundle carries ${what} «${match[0]}» (§4, D-06).` });
    }
  }
  return violations;
}

/** Every site's isolated content script, the early bootstrap of its tabs (the host registry; ChatSpace: chatspace.js). */
export const ISOLATED_BUNDLES: readonly string[] = HOSTS.map((host) => host.scripts.isolated.file);

/**
 * 8b. A site's isolated content script starts without WXT's
 * ContentScriptContext and entry wrapper (architecture.md §11,
 * apps/extension/build/isolated-entry.ts): the context touches the extension
 * API in the synchronous start at document_start and posts an event that
 * names the extension to the page (decision X22). Its event name and the
 * wrapper's log line are the markers: if a WXT upgrade renames its virtual
 * entry module, the plugin stops matching and both come back.
 */
export function checkIsolatedStart(files: readonly SourceFile[]): Violation[] {
  const markers: Array<[RegExp, string]> = [
    [/content-script-started/, "WXT's ContentScriptContext"],
    [/crashed on startup/, "WXT's entry wrapper"],
  ];
  const violations: Violation[] = [];
  for (const file of files) {
    if (!ISOLATED_BUNDLES.includes(file.path)) continue;
    for (const [pattern, what] of markers) {
      const match = pattern.exec(file.text);
      if (!match) continue;
      const line = file.text.slice(0, match.index).split('\n').length;
      violations.push({ gate: 'isolated-start', path: file.path, line, message: `the isolated content script carries ${what} «${match[0]}» (§11, build/isolated-entry.ts).` });
    }
  }
  return violations;
}

/** Bundles that run in a site's tab, isolated world: the content script and every lazy chunk it loads. */
const isTabBundle = (path: string): boolean => ISOLATED_BUNDLES.includes(path) || path.startsWith('lazy/');

/**
 * 8a. A ChatSpace tab listens to no storage change (architecture.md §14: the
 * hub token is the background's alone). The browser hands a
 * `storage.onChanged` listener every change of the area with its old and new
 * values — the sign-in record with the token among them — into the page's
 * own process. The tab reads and writes its one key by name.
 */
export function checkTabStorageListeners(files: readonly SourceFile[]): Violation[] {
  const pattern = /\bstorage\s*(?:\?\.|\.)\s*(?:(?:local|session|sync|managed)\s*(?:\?\.|\.)\s*)?onChanged\b/;
  const violations: Violation[] = [];
  for (const file of files) {
    if (!isTabBundle(file.path)) continue;
    const match = pattern.exec(file.text);
    if (!match) continue;
    const line = file.text.slice(0, match.index).split('\n').length;
    violations.push({ gate: 'tab-storage-listener', path: file.path, line, message: `a ChatSpace tab's bundle listens to storage changes («${match[0]}»): every change of the area — the sign-in record too — would be delivered into the tab (§14).` });
  }
  return violations;
}

/** The test stand's own package: the only code that may name its hooks. */
export const STAND_PACKAGE = /^packages\/testing\//;
/** Stand-only hooks: `data-stand-*` attributes, `window.__stand`, the `x-stand-*` headers. None exist on ChatSpace. */
const STAND_HOOK = /data-stand-|__stand\b|x-stand-/;

/** 9. Our code never leans on the stand's own hooks (they pass on the stand and find nothing on ChatSpace). */
export function checkStandHooks(files: readonly SourceFile[]): Violation[] {
  const violations: Violation[] = [];
  for (const file of files) {
    if (STAND_PACKAGE.test(file.path)) continue;
    const source = parse(file);
    walk(source, (node) => {
      const text = isTextNode(node) || ts.isRegularExpressionLiteral(node) ? node.text : ts.isIdentifier(node) ? node.text : null;
      if (text === null || !STAND_HOOK.test(text)) return;
      violations.push({ gate: 'stand-hooks', path: file.path, line: lineOf(source, node), message: `«${STAND_HOOK.exec(text)?.[0] ?? ''}» is a stand-only hook, absent on ChatSpace (§12 п. 3).` });
    });
  }
  return violations;
}

/**
 * MAIN-world source: the modules of every site's `mainWorldSources` folder in the host registry (ChatSpace: the
 * bridge, its runtime and the tap script in packages/host-chatspace/src/main, §4, D-06), not their subfolders.
 */
export function isMainWorldSource(path: string, hosts: readonly HostDescriptor[] = HOSTS): boolean {
  return hosts.some((host) => host.mainWorldSources.some((dir) => path.startsWith(dir) && /^[^/]+\.ts$/.test(path.slice(dir.length))));
}

/**
 * Where the page or the browser takes a callback of ours, by the name of the call, and which argument the callback is.
 * `listen`, `later` and `nextFrame` are the natives the boot captures at load (bridge.ts). The boot's `setTimer` and
 * `frame` are not here: they guard what they are given themselves.
 */
export const MAIN_CALLBACK_SITES: Readonly<Record<string, number>> = {
  addEventListener: 1,
  listen: 1,
  setTimeout: 0,
  setInterval: 0,
  later: 0,
  requestAnimationFrame: 0,
  nextFrame: 0,
  queueMicrotask: 0,
  $onAction: 0,
  $subscribe: 0,
  afterEach: 0,
  use: 0,
  on: 1,
  after: 0,
  onError: 0,
};
/** Constructors that take a callback the browser calls (`new MutationObserver(callback)`). */
const MAIN_CALLBACK_CONSTRUCTORS = new Set(['MutationObserver', 'ResizeObserver', 'IntersectionObserver', 'PerformanceObserver']);

const nameOf = (node: ts.Expression): string | null => {
  const bare = ts.isParenthesizedExpression(node) ? node.expression : node;
  return ts.isPropertyAccessExpression(bare) ? bare.name.text : ts.isIdentifier(bare) ? bare.text : null;
};
const isGuardCall = (node: ts.Node): boolean => ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'guard';

/**
 * 10. Every callback MAIN hands the page or the browser goes through `guard` (decision X22, guard.ts): the argument is
 * a `guard(…)` call, or a `const` of the same file bound to one. A handler property (`port.onmessage = …`) too. An
 * exception of ours that left such a callback would reach ChatSpace's own error handling (its Sentry) with our frames,
 * and where ChatSpace calls us inside its own work it would stop that work.
 */
export function checkMainWorldGuards(files: readonly SourceFile[]): Violation[] {
  const violations: Violation[] = [];
  for (const file of files) {
    if (!isMainWorldSource(file.path) || file.path.endsWith('.test.ts')) continue;
    const source = parse(file);
    const guarded = new Set<string>();
    walk(source, (node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && isGuardCall(node.initializer) && ts.isVariableDeclarationList(node.parent) && node.parent.flags & ts.NodeFlags.Const) {
        guarded.add(node.name.text);
      }
    });
    const ok = (node: ts.Expression | undefined): boolean => node === undefined || isGuardCall(node) || (ts.isIdentifier(node) && guarded.has(node.text));
    const report = (node: ts.Node, what: string): void => {
      violations.push({ gate: 'main-world-guard', path: file.path, line: lineOf(source, node), message: `${what} hands the page or the browser a callback that is not a guard(…) (decision X22, guard.ts).` });
    };
    walk(source, (node) => {
      if (ts.isCallExpression(node)) {
        const name = nameOf(node.expression);
        const index = name === null ? undefined : MAIN_CALLBACK_SITES[name];
        if (name !== null && index !== undefined && !ok(node.arguments[index])) report(node, `\`${name}(…)\``);
      } else if (ts.isNewExpression(node)) {
        const name = nameOf(node.expression);
        if (name !== null && MAIN_CALLBACK_CONSTRUCTORS.has(name) && !ok(node.arguments?.[0])) report(node, `\`new ${name}(…)\``);
      } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(node.left) && /^on[a-z]+$/.test(node.left.name.text)) {
        if (node.right.kind !== ts.SyntaxKind.NullKeyword && !ok(node.right)) report(node, `\`.${node.left.name.text} =\``);
      }
    });
  }
  return violations;
}

export function runSourceGates(files: readonly SourceFile[]): Violation[] {
  return [
    ...checkOnlyMonsterReferences(files),
    ...checkHtmlSinks(files),
    ...checkBrowserApiScope(files),
    ...checkUiTexts(files),
    ...checkSendQueueReferences(files),
    ...checkStandHooks(files),
    ...checkMainWorldGuards(files),
  ];
}
