// Static invariants of architecture.md §3 «pnpm check» п. 7 (and §12 «Гейт
// безопасности»). Pure functions over {path, text}; index.ts feeds them the
// repo and the release build. Code is parsed with the TypeScript compiler, so
// comments and prose never trip a gate — only real code does.

import ts from 'typescript';

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

/** Files allowed to name the ChatSpace origin: manifest/host matching and the host contract (§3). */
export const ONLYMONSTER_ALLOWLIST: readonly string[] = [
  'apps/extension/src/hosts.ts',
  'packages/host-chatspace/src/isolated/host-contract.ts',
];

/** Where `browser.*` / `chrome.*` may appear (§4, D-01). */
export const BROWSER_API_ALLOWED: readonly RegExp[] = [/^packages\/platform\/src\//, /^apps\/extension\/src\/entrypoints\//];

/** The only file that may reference ChatSpace's send queue method (§6.7, D-07). */
export const SEND_PORT_FILE = 'packages/host-chatspace/src/main/send-port.ts';
const SEND_QUEUE_METHOD = 'enqueue';

/** Where user-visible UI text lives until the i18n catalogs exist (R13/R16). */
export const UI_TEXT_SCOPES: readonly RegExp[] = [/^packages\/ui\/src\/.*\.tsx$/, /^apps\/extension\/src\/composition\/pages\.ts$/];
/** AU-019: no keys and no token/key/API/bearer vocabulary in UI texts. */
export const UI_FORBIDDEN_WORDS = /\b(?:api|tokens?|bearer|keys?|apikey|api-key)\b|токен|ключ(?!ев)/i;

const HTML_SINKS = new Set(['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'createContextualFragment', 'dangerouslySetInnerHTML']);
const UI_TEXT_ATTRIBUTES = new Set(['title', 'placeholder', 'aria-label', 'alt', 'label', 'aria-description']);

function parse(file: SourceFile): ts.SourceFile {
  const kind = file.path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(file.path, file.text, ts.ScriptTarget.Latest, true, kind);
}

/** String literals and every template chunk (`…${x}…`). */
function isTextNode(node: ts.Node): node is ts.StringLiteralLike | ts.TemplateHead | ts.TemplateMiddle | ts.TemplateTail {
  return ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node);
}

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

function walk(source: ts.SourceFile, visit: (node: ts.Node) => void): void {
  const step = (node: ts.Node): void => {
    visit(node);
    ts.forEachChild(node, step);
  };
  step(source);
}

/** 1. No reference to onlymonster.ai in our code outside the allowlist. */
export function checkOnlyMonsterReferences(files: readonly SourceFile[]): Violation[] {
  const violations: Violation[] = [];
  for (const file of files) {
    if (ONLYMONSTER_ALLOWLIST.includes(file.path)) continue;
    const source = parse(file);
    walk(source, (node) => {
      if (isTextNode(node) && /onlymonster\.ai/i.test(node.text)) {
        violations.push({
          gate: 'onlymonster-reference',
          path: file.path,
          line: lineOf(source, node),
          message: 'ChatSpace origin named outside apps/extension/src/hosts.ts and the host contract file (§3, X3).',
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

/** 3. `browser.*` / `chrome.*` only in packages/platform and the entry points. */
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
          message: `\`${node.expression.text}.${node.name.text}\` outside packages/platform and the entry points (§4, D-01).`,
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
        (isTextNode(node) && node.text.includes(SEND_QUEUE_METHOD));
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

/** 6. The release bundle carries nothing test-only: no loopback hosts, no spike probe. */
export function checkReleaseBundle(files: readonly SourceFile[]): Violation[] {
  const markers: Array<[RegExp, string]> = [
    [/127\.0\.0\.1|\blocalhost\b/, 'loopback stand / fake hub host'],
    [/data-cg-spike|lazy\/spike\.js/, 'spike M0 probe'],
    [/chat-extension-test@/, 'test gecko id'],
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

export function runSourceGates(files: readonly SourceFile[]): Violation[] {
  return [
    ...checkOnlyMonsterReferences(files),
    ...checkHtmlSinks(files),
    ...checkBrowserApiScope(files),
    ...checkUiTexts(files),
    ...checkSendQueueReferences(files),
  ];
}
