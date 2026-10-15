// Parity coverage (architecture.md §12, §17; docs/parity/; R20 P1b): which
// rows of the parity manifest are named by a test, per host. A test names a
// row by a `[ROW-ID]` tag in its title (`it('[ST-042] …')`, a `describe`, a
// row of `it.each`); its host comes from its path or an explicit host mark
// (hosts.ts). This module is the pure part: reading tags and host marks out of
// a test file, closing the rows on Fansly, counting rows by milestone, by
// owning work package and by owning PR, and rendering the report.
// tools/parity/coverage.ts reads the files and writes the report; `pnpm
// parity` (index.ts) holds the Fansly gate on the same closure.
//
// What counts as a tag: `[ID]` inside a string literal or a template of a
// test file — never inside a comment — and not inside a test that is
// switched off (`it.skip`, `it.todo`, `describe.skip`, `xit`, `xdescribe`).
// A row id is letters and digits, a dash and two or three digits (`AI-001`,
// `NEW-08`, `X8-01`); a tag that is no row of the manifest is reported, not
// counted. A host mark `[host:fansly]` is read the same way.
//
// Relative imports carry `.ts`: this file runs under plain Node 26.

import ts from 'typescript';

import { prOfOwner, type CheckKind, type ManifestRow } from './derive.ts';
import { closes, HOST_MARK, placeOfTest, type TestPlace } from './hosts.ts';
import type { HubConfirmation } from './matrix.ts';

export const TAG = /\[([A-Z][A-Z0-9]*-\d{2,3})\]/g;

export type TestKind = 'unit' | 'e2e';

/** An `.e2e.ts` spec runs in Firefox against the stand; everything else is Vitest. */
export function testKindOf(path: string): TestKind {
  return /\.e2e\.tsx?$/.test(path) ? 'e2e' : 'unit';
}

const TEST_FUNCTIONS = new Set(['it', 'test', 'describe', 'suite', 'bench']);
const OFF_MODIFIERS = new Set(['skip', 'todo']);
const OFF_FUNCTIONS = new Set(['xit', 'xtest', 'xdescribe']);

/** `it.skip(…)`, `describe.skip.each(…)(…)`, `it.todo(…)`, `xit(…)`: a test that does not run. */
function isSwitchedOff(call: ts.CallExpression): boolean {
  let callee: ts.Expression = call.expression;
  // `it.each(table)(title, fn)`: the callee of the outer call is itself a call.
  while (ts.isCallExpression(callee) || ts.isTaggedTemplateExpression(callee)) callee = ts.isCallExpression(callee) ? callee.expression : callee.tag;
  const names: string[] = [];
  while (ts.isPropertyAccessExpression(callee)) {
    names.push(callee.name.text);
    callee = callee.expression;
  }
  if (!ts.isIdentifier(callee)) return false;
  if (OFF_FUNCTIONS.has(callee.text)) return true;
  return TEST_FUNCTIONS.has(callee.text) && names.some((name) => OFF_MODIFIERS.has(name));
}

export interface FileTags {
  /** Row ids named by tests that run, each once, in the order they first appear. */
  readonly tags: readonly string[];
  /** Row ids named only by tests that are switched off. */
  readonly skipped: readonly string[];
  /** Host marks (`[host:fansly]`) of tests that run, each once: they put the whole file on those sites. */
  readonly hosts: readonly string[];
  /**
   * The titles of the file's top-level blocks (`describe`, `it`, … at the top of the file) that name a row but carry
   * no host mark. In a file marked for one site they leak: the mark puts their rows on that site too (R20 F9b,
   * `hostMarkProblems`). Absent — not read (a file made by hand in a test).
   */
  readonly unmarked?: readonly string[];
}

/** The text of a test's title: a string, or a template with its substitutions left out. */
function titleText(node: ts.Expression | undefined): string | null {
  if (node === undefined) return null;
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isTemplateExpression(node)) return [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join('…');
  return null;
}

/** `describe(…)`, `it.each(…)(…)`, `xit(…)`: a call of a test function, whatever its modifiers. */
function isTestCall(call: ts.CallExpression): boolean {
  let callee: ts.Expression = call.expression;
  while (ts.isCallExpression(callee) || ts.isTaggedTemplateExpression(callee)) callee = ts.isCallExpression(callee) ? callee.expression : callee.tag;
  while (ts.isPropertyAccessExpression(callee)) callee = callee.expression;
  return ts.isIdentifier(callee) && (TEST_FUNCTIONS.has(callee.text) || OFF_FUNCTIONS.has(callee.text));
}

/** The `[ROW-ID]` tags and `[host:…]` marks of one test file: from its strings and templates, never from comments. */
export function tagsOfTestFile(path: string, source: string): FileTags {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, false, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const live = new Set<string>();
  const off = new Set<string>();
  const hosts = new Set<string>();
  const collect = (text: string, skipped: boolean): void => {
    for (const match of text.matchAll(TAG)) (skipped ? off : live).add(match[1] ?? '');
    if (!skipped) for (const match of text.matchAll(HOST_MARK)) hosts.add(match[1] ?? '');
  };
  const visit = (node: ts.Node, skipped: boolean): void => {
    if (ts.isStringLiteralLike(node)) collect(node.text, skipped);
    else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) collect(node.text, skipped);
    const inside = skipped || (ts.isCallExpression(node) && isSwitchedOff(node));
    ts.forEachChild(node, (child) => visit(child, inside));
  };
  visit(file, false);
  const unmarked: string[] = [];
  for (const statement of file.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression) || !isTestCall(statement.expression)) continue;
    const title = titleText(statement.expression.arguments[0]);
    if (title === null || new RegExp(HOST_MARK.source).test(title)) continue;
    // Only a block that names a row can carry it to the wrong site.
    let names = false;
    const look = (node: ts.Node): void => {
      if (names) return;
      if ((ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) && new RegExp(TAG.source).test(node.text)) names = true;
      else ts.forEachChild(node, look);
    };
    look(statement);
    if (names) unmarked.push(title);
  }
  return { tags: [...live], skipped: [...off].filter((id) => !live.has(id)), hosts: [...hosts], unmarked };
}

export interface TaggedFile extends FileTags {
  readonly path: string;
}

/**
 * Problems of the host marks of the test files: an unknown site, a mark against the file's path, and a mark that
 * leaks — a file marked for ONE site whose top-level block names a row but carries no mark: the mark puts that block
 * on its site too, so its rows close there and leave the site they were written for (R20 F9b; the Fansly claim block
 * of sdk-alignment.test.ts took ChatSpace's AI-142 to Fansly this way). Mark the block, or give the site's block a
 * file of its own. A file marked for both sites is on both by its author's word.
 */
export function hostMarkProblems(files: readonly TaggedFile[]): string[] {
  return files.flatMap((file) => [
    ...placeOfTest(file.path, file.hosts).problems,
    ...(file.hosts.length !== 1
      ? []
      : (file.unmarked ?? []).map(
          (title) =>
            `${file.path}: [host:${file.hosts[0] ?? ''}] puts the whole file on its site, and so the block «${title.slice(0, 60)}», which names rows but carries no mark — mark it, or move the site's block to a file of its own`,
        )),
  ]);
}

/** Rows that carry `пилот` in their target: what the pilot is accepted by (§17). */
export function isPilotRow(row: Pick<ManifestRow, 'target'>): boolean {
  return row.target.includes('пилот');
}

/** Checks a tagged test of ours carries out on a host; the rest are proven otherwise (registry, hub) or not at all. */
export function hasOwnCheck(kind: CheckKind): boolean {
  return kind !== 'negative' && kind !== 'n/a' && kind !== 'hub' && kind !== 'after-pilot';
}

// ── Fansly: closing a row on its host and level ─────────────────────────────

export interface FanslyClosure {
  readonly closed: boolean;
  /** What closes it: test files on Fansly at the row's level (or host-free for a shared row), the hub's confirmation, the negative check. */
  readonly by: readonly string[];
}

/**
 * Closes every row on Fansly (plan.md §0, parity-matrix.md §1): a test with
 * the row's id on Fansly and at the row's level (`shared` — also a host-free
 * test); `hub` — the hub's confirmation of the row by its owner PR (§10 of the
 * matrix); `negative` — the exceptions registry; `after-pilot` and `n/a` are
 * not closed before the pilot.
 */
export function closeOnFansly(rows: readonly ManifestRow[], files: readonly TaggedFile[], confirmations: readonly HubConfirmation[]): Map<string, FanslyClosure> {
  const placed = [...files]
    .sort((a, b) => (a.path < b.path ? -1 : 1))
    .map((file) => ({ path: file.path, tags: new Set(file.tags), place: placeOfTest(file.path, file.hosts).place }));
  const closure = new Map<string, FanslyClosure>();
  for (const row of rows) {
    const { check, owner } = row.fansly;
    let by: string[] = [];
    if (check.kind === 'negative') by = [check.exception ?? ''];
    else if (check.kind === 'hub') by = confirmations.filter((item) => item.id === row.id && item.pr === prOfOwner(owner)).map((item) => `${item.pr} ${item.commit}`);
    else if (hasOwnCheck(check.kind)) by = placed.filter((file) => file.tags.has(row.id) && closes(file.place, 'fansly', check.kind)).map((file) => file.path);
    closure.set(row.id, { closed: by.length > 0, by });
  }
  return closure;
}

// ── the report ──────────────────────────────────────────────────────────────

export interface RowCoverage {
  readonly id: string;
  readonly function: string;
  readonly target: string;
  /** ChatSpace: the owning work package, the planned check and the tests on ChatSpace (and host-free) that name the row, by kind. */
  readonly owner: string;
  readonly milestones: readonly string[];
  readonly planned: CheckKind;
  readonly pilot: boolean;
  readonly unit: readonly string[];
  readonly e2e: readonly string[];
  readonly covered: boolean;
  /** Fansly: the owning PR, the planned check and what closes it. */
  readonly fansly: { readonly owner?: string; readonly planned: CheckKind; readonly closed: boolean; readonly by: readonly string[] };
}

export interface Bucket {
  readonly name: string;
  /** Rows with a check of our own (not `negative`, not `n/a`). */
  readonly rows: number;
  readonly covered: number;
  readonly uncovered: number;
  readonly pilot: number;
  readonly pilotCovered: number;
  readonly pilotUncovered: number;
  /** Rows the bucket holds besides those: negative checks and rows without a check. */
  readonly other: number;
}

/** Rows of one planned check kind: where the tests that name them run. */
export interface PlannedLine {
  readonly planned: CheckKind;
  readonly rows: number;
  /** Named by at least one Vitest file / by at least one e2e spec. */
  readonly inUnit: number;
  readonly inE2e: number;
  /** Named by Vitest files only: no e2e spec names the row. */
  readonly unitOnly: number;
  readonly uncovered: number;
}

/** Fansly rows of one check kind or one owning PR. */
export interface FanslyLine {
  readonly name: string;
  readonly rows: number;
  readonly closed: number;
  readonly open: number;
}

export interface FanslyReport {
  /** Rows of the matrix (§7) and rows Fansly does not concern (§9). */
  readonly rows: number;
  readonly notConcerned: number;
  /** Rows that need a check before the pilot (all but `after-pilot`). */
  readonly required: number;
  readonly closed: number;
  readonly open: number;
  readonly afterPilot: number;
  readonly byKind: readonly FanslyLine[];
  readonly byPr: ReadonlyArray<FanslyLine & { readonly done: boolean }>;
  /** Rows of PRs marked done that are open on Fansly: the gate fails on each. */
  readonly openOfDone: readonly string[];
}

export interface CoverageReport {
  readonly generated: string;
  readonly testFiles: { readonly unit: number; readonly e2e: number; readonly chatspace: number; readonly fansly: number; readonly free: number };
  readonly totals: Bucket & { readonly all: number; readonly negative: number; readonly notApplicable: number; readonly taggedAnyway: number };
  readonly milestones: readonly Bucket[];
  readonly packages: readonly Bucket[];
  /** By the check the manifest plans: a row planned for e2e and named only by unit tests is seen here. */
  readonly planned: readonly PlannedLine[];
  readonly fansly: FanslyReport;
  readonly rows: readonly RowCoverage[];
  /** Tags of tests that are no row of the manifest: a typo or a row that was removed. */
  readonly unknownTags: ReadonlyArray<{ readonly tag: string; readonly files: readonly string[] }>;
  /** Rows named only by tests that are switched off. */
  readonly skippedOnly: ReadonlyArray<{ readonly id: string; readonly files: readonly string[] }>;
  /** Host marks that are wrong: an unknown site, a mark against the file's path. */
  readonly hostProblems: readonly string[];
}

export const GENERATED_NOTE =
  'node tools/parity/coverage.ts (pnpm parity:coverage) — руками не править; источник: docs/parity/parity-manifest.json, docs/project-unite/plan.md и done/<PR id>, §10 docs/project-unite/parity-matrix.md, метки [ID] и [host:…] в названиях тестов';

/** ChatSpace check kinds a test of ours can carry out, in the order of the report. */
const OWN_CHECKS: readonly CheckKind[] = ['unit', 'e2e', 'stand-visual', 'manual-smoke'];
/** Fansly check kinds in the order of the report (parity-matrix.md §1). */
const FANSLY_KINDS: readonly CheckKind[] = ['e2e', 'stand-visual', 'unit', 'hub', 'shared', 'negative', 'after-pilot'];

/** Milestones in the order of §17; anything else after them, by name. */
const MILESTONE_ORDER = ['M0', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'F'];
export const NO_MILESTONE = '—';

function bucket(name: string, rows: readonly RowCoverage[]): Bucket {
  const own = rows.filter((row) => row.planned !== 'negative' && row.planned !== 'n/a');
  const pilot = own.filter((row) => row.pilot);
  return {
    name,
    rows: own.length,
    covered: own.filter((row) => row.covered).length,
    uncovered: own.filter((row) => !row.covered).length,
    pilot: pilot.length,
    pilotCovered: pilot.filter((row) => row.covered).length,
    pilotUncovered: pilot.filter((row) => !row.covered).length,
    other: rows.length - own.length,
  };
}

const byName = (order: readonly string[]) => (a: string, b: string): number => {
  const [ia, ib] = [order.indexOf(a), order.indexOf(b)];
  if (ia >= 0 || ib >= 0) return (ia < 0 ? order.length : ia) - (ib < 0 ? order.length : ib);
  return a < b ? -1 : a > b ? 1 : 0;
};

/** What the Fansly part of the report needs besides the manifest and the tests. */
export interface FanslyInput {
  readonly confirmations: readonly HubConfirmation[];
  /** PRs of the R20 plan, in its order. */
  readonly prs: readonly string[];
  /** PRs marked by done files or legacy marks in plan.md. */
  readonly done: ReadonlySet<string>;
}

function fanslyLine(name: string, rows: readonly RowCoverage[]): FanslyLine {
  const closed = rows.filter((row) => row.fansly.closed).length;
  return { name, rows: rows.length, closed, open: rows.length - closed };
}

function fanslyReport(rows: readonly RowCoverage[], input: FanslyInput): FanslyReport {
  const concerned = rows.filter((row) => row.fansly.planned !== 'n/a');
  const required = concerned.filter((row) => row.fansly.planned !== 'after-pilot');
  const prOf = (row: RowCoverage): string => prOfOwner(row.fansly.owner) ?? '';
  const prs = [...new Set(concerned.map(prOf))].sort(byName(input.prs));
  const closed = required.filter((row) => row.fansly.closed).length;
  return {
    rows: concerned.length,
    notConcerned: rows.length - concerned.length,
    required: required.length,
    closed,
    open: required.length - closed,
    afterPilot: concerned.length - required.length,
    byKind: FANSLY_KINDS.map((kind) => fanslyLine(kind, concerned.filter((row) => row.fansly.planned === kind))),
    byPr: prs.map((pr) => ({ ...fanslyLine(pr, concerned.filter((row) => prOf(row) === pr)), done: input.done.has(pr) })),
    openOfDone: required.filter((row) => !row.fansly.closed && input.done.has(prOf(row))).map((row) => row.id),
  };
}

export function buildCoverage(manifestRows: readonly ManifestRow[], files: readonly TaggedFile[], fansly: FanslyInput): CoverageReport {
  const known = new Set(manifestRows.map((row) => row.id));
  const namedBy = new Map<string, { unit: string[]; e2e: string[] }>();
  const unknown = new Map<string, string[]>();
  const skipped = new Map<string, string[]>();
  const places = new Map<string, TestPlace>(files.map((file) => [file.path, placeOfTest(file.path, file.hosts).place]));
  const onChatSpace = (place: TestPlace | undefined): boolean => place === undefined || place.hosts.length === 0 || place.hosts.includes('chatspace');
  for (const file of [...files].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    for (const tag of file.tags) {
      if (!known.has(tag)) {
        unknown.set(tag, [...(unknown.get(tag) ?? []), file.path]);
        continue;
      }
      // ChatSpace: a test of Fansly alone does not name a row there.
      if (!onChatSpace(places.get(file.path))) continue;
      const entry = namedBy.get(tag) ?? { unit: [], e2e: [] };
      entry[testKindOf(file.path)].push(file.path);
      namedBy.set(tag, entry);
    }
    for (const tag of file.skipped) if (known.has(tag)) skipped.set(tag, [...(skipped.get(tag) ?? []), file.path]);
  }
  const closure = closeOnFansly(manifestRows, files, fansly.confirmations);
  const rows: RowCoverage[] = manifestRows.map((row) => {
    const named = namedBy.get(row.id) ?? { unit: [], e2e: [] };
    const closed = closure.get(row.id) ?? { closed: false, by: [] };
    return {
      id: row.id,
      function: row.function,
      target: row.target,
      owner: row.chatspace.owner ?? '',
      milestones: row.milestones,
      planned: row.chatspace.check.kind,
      pilot: isPilotRow(row),
      unit: named.unit,
      e2e: named.e2e,
      covered: named.unit.length + named.e2e.length > 0,
      fansly: { ...(row.fansly.owner === undefined ? {} : { owner: row.fansly.owner }), planned: row.fansly.check.kind, closed: closed.closed, by: closed.by },
    };
  });
  const group = (keysOf: (row: RowCoverage) => readonly string[], order: readonly string[]): Bucket[] => {
    const groups = new Map<string, RowCoverage[]>();
    for (const row of rows) for (const key of keysOf(row)) groups.set(key, [...(groups.get(key) ?? []), row]);
    return [...groups.keys()].sort(byName(order)).map((key) => bucket(key, groups.get(key) ?? []));
  };
  const total = bucket('всего', rows);
  const placeList = [...places.values()];
  return {
    generated: GENERATED_NOTE,
    testFiles: {
      unit: files.filter((file) => testKindOf(file.path) === 'unit').length,
      e2e: files.filter((file) => testKindOf(file.path) === 'e2e').length,
      chatspace: placeList.filter((place) => place.hosts.includes('chatspace')).length,
      fansly: placeList.filter((place) => place.hosts.includes('fansly')).length,
      free: placeList.filter((place) => place.hosts.length === 0).length,
    },
    totals: {
      ...total,
      all: rows.length,
      negative: rows.filter((row) => row.planned === 'negative').length,
      notApplicable: rows.filter((row) => row.planned === 'n/a').length,
      taggedAnyway: rows.filter((row) => (row.planned === 'negative' || row.planned === 'n/a') && row.covered).length,
    },
    // A row of two milestones is counted in both.
    milestones: group((row) => (row.milestones.length === 0 ? [NO_MILESTONE] : row.milestones), [...MILESTONE_ORDER, NO_MILESTONE]),
    packages: group((row) => [row.owner], []),
    planned: OWN_CHECKS.map((planned) => {
      const of = rows.filter((row) => row.planned === planned);
      return {
        planned,
        rows: of.length,
        inUnit: of.filter((row) => row.unit.length > 0).length,
        inE2e: of.filter((row) => row.e2e.length > 0).length,
        unitOnly: of.filter((row) => row.unit.length > 0 && row.e2e.length === 0).length,
        uncovered: of.filter((row) => !row.covered).length,
      };
    }),
    fansly: fanslyReport(rows, fansly),
    rows,
    unknownTags: [...unknown.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([tag, paths]) => ({ tag, files: paths })),
    skippedOnly: [...skipped.entries()]
      .filter(([id]) => !namedBy.has(id))
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([id, paths]) => ({ id, files: paths })),
    hostProblems: hostMarkProblems([...files].sort((a, b) => (a.path < b.path ? -1 : 1))),
  };
}

export function serializeCoverage(report: CoverageReport): string {
  const { rows, ...head } = report;
  // One row per line: a change of one row is one line of a diff.
  const lines = rows.map((row) => `    ${JSON.stringify(row)}`).join(',\n');
  return `${JSON.stringify(head, null, 2).replace(/\n}$/, '')},\n  "rows": [\n${lines}\n  ]\n}\n`;
}

// ── the Russian report ──────────────────────────────────────────────────────

const PLANNED_RU: Readonly<Record<CheckKind, string>> = {
  unit: 'юнит-тест',
  e2e: 'e2e на стенде',
  'stand-visual': 'снимок на стенде',
  'manual-smoke': 'smoke владельца',
  hub: 'тест хаба',
  shared: 'общий тест',
  negative: 'отрицательная проверка',
  'after-pilot': 'после пилота',
  'n/a': 'своей проверки нет',
};

/** The matrix's names of the Fansly checks (parity-matrix.md §1). */
const FANSLY_RU: Readonly<Record<CheckKind, string>> = {
  e2e: 'браузер · спек',
  'stand-visual': 'браузер · галерея',
  unit: 'юнит',
  hub: 'хаб',
  shared: 'общий',
  negative: 'отрицательная',
  'after-pilot': 'после пилота',
  'manual-smoke': 'smoke',
  'n/a': 'не касается',
};

const percent = (part: number, whole: number): string => (whole === 0 ? '—' : `${String(Math.round((part / whole) * 100))} %`);

function table(buckets: readonly Bucket[], first: string): string[] {
  return [
    `| ${first} | Строк с проверкой | С тестом | Без теста | Покрыто | Пилотных | Пилотных без теста | Прочих строк |`,
    '|---|---:|---:|---:|---:|---:|---:|---:|',
    ...buckets.map((item) => `| ${item.name} | ${String(item.rows)} | ${String(item.covered)} | ${String(item.uncovered)} | ${percent(item.covered, item.rows)} | ${String(item.pilot)} | ${String(item.pilotUncovered)} | ${String(item.other)} |`),
  ];
}

/** A cell of a Markdown table: no pipe breaks the row. */
const cell = (text: string): string => text.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

function chatspaceLines(report: CoverageReport): string[] {
  const { totals } = report;
  const uncoveredPilot = report.rows.filter((row) => row.pilot && !row.covered && row.planned !== 'negative' && row.planned !== 'n/a');
  const milestoneOf = (row: RowCoverage): string => (row.milestones.length === 0 ? NO_MILESTONE : row.milestones.join(', '));
  const groups = new Map<string, RowCoverage[]>();
  for (const row of uncoveredPilot) {
    const key = row.milestones[0] ?? NO_MILESTONE;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const lines: string[] = [
    '## ChatSpace',
    '',
    'Строку называет тест на ChatSpace или тест без хоста. Владелец строки — пакет работ (первый в колонке',
    '«Пакет» карты паритета), проверка — по модулю строки. Здесь это отчёт: `pnpm parity` строки ChatSpace',
    'по тестам не держит.',
    '',
    '### Итог',
    '',
    `- Строк в манифесте: **${String(totals.all)}**. Из них с проверкой — ${String(totals.rows)}, с отрицательной проверкой — ${String(totals.negative)}, без своей проверки — ${String(totals.notApplicable)}.`,
    `- Названы в тестах: **${String(totals.covered)} из ${String(totals.rows)}** (${percent(totals.covered, totals.rows)}). Без теста — ${String(totals.uncovered)}.`,
    `- Пилотных строк: ${String(totals.pilot)}. Названы в тестах — **${String(totals.pilotCovered)}** (${percent(totals.pilotCovered, totals.pilot)}), без теста — **${String(totals.pilotUncovered)}**.`,
    ...(totals.taggedAnyway === 0 ? [] : [`- Ещё ${String(totals.taggedAnyway)} строк без своей проверки или с отрицательной проверкой тоже названы в тестах.`]),
    '',
    '### По этапам',
    '',
    ...table(report.milestones, 'Этап'),
    '',
    '`—` — строки без этапа: «не нужно», «убрано владельцем», «даёт ChatSpace», «ждёт владельца».',
    '',
    '### По пакетам работ',
    '',
    ...table(report.packages, 'Пакет'),
    '',
    '### Проверка по плану и по факту',
    '',
    'Какую проверку строке назначил манифест и в каких тестах она названа. «Только юнит» у строк',
    'с планом «e2e на стенде» или «снимок на стенде» — повод посмотреть, хватает ли юнит-теста.',
    '',
    '| Проверка по плану | Строк | Названы в юнит-тестах | Названы в e2e | Только юнит | Без теста |',
    '|---|---:|---:|---:|---:|---:|',
    ...report.planned.map((line) => `| ${PLANNED_RU[line.planned]} | ${String(line.rows)} | ${String(line.inUnit)} | ${String(line.inE2e)} | ${String(line.unitOnly)} | ${String(line.uncovered)} |`),
    '',
    '### Пилотные строки без теста',
    '',
  ];
  if (uncoveredPilot.length === 0) lines.push('Нет: каждая пилотная строка названа хотя бы в одном тесте.', '');
  for (const key of [...groups.keys()].sort(byName([...MILESTONE_ORDER, NO_MILESTONE]))) {
    const rows = groups.get(key) ?? [];
    lines.push(`#### ${key === NO_MILESTONE ? 'Без этапа' : key} — ${String(rows.length)}`, '', '| Строка | Что это | Пакет | Этап | Проверка по плану |', '|---|---|---|---|---|');
    for (const row of [...rows].sort((a, b) => (a.owner === b.owner ? (a.id < b.id ? -1 : 1) : a.owner < b.owner ? -1 : 1))) {
      lines.push(`| ${row.id} | ${cell(row.function)} | ${row.owner} | ${milestoneOf(row)} | ${PLANNED_RU[row.planned]} |`);
    }
    lines.push('');
  }
  return lines;
}

function fanslyLines(report: CoverageReport): string[] {
  const { fansly } = report;
  const done = fansly.byPr.filter((line) => line.done);
  const lines: string[] = [
    '## Fansly (R20)',
    '',
    'Часть строки для Fansly — из матрицы паритета R20 (`docs/project-unite/parity-matrix.md`): один PR-владелец',
    'из `plan.md` и проверка на Fansly. Строку закрывает тест с её id на хосте Fansly и на её уровне: браузерную —',
    'только e2e на стенде Fansly, юнит — любой тест на Fansly; `общий` — ещё и тест без хоста; `хаб` — тест PR хаба,',
    'записанный в §10 матрицы; `отрицательная` — реестр исключений. Тест ChatSpace строку Fansly не закрывает.',
    '',
    '**Здесь гейт.** `pnpm parity` падает, если у PR, отмеченного сделанным (`done/<PR id>` или `✓` в `plan.md`), есть строка, открытая',
    'на Fansly, и — когда отмечен пилот (P16c) — если открыта любая строка Fansly, кроме «после пилота». Строки PR,',
    'которые ещё не сделаны, — план, не ошибка.',
    '',
    '### Итог',
    '',
    `- Строк матрицы: **${String(fansly.rows)}**; Fansly не касаются — ${String(fansly.notConcerned)} (§9 матрицы).`,
    `- Нужна проверка к пилоту: ${String(fansly.required)}. Закрыто — **${String(fansly.closed)}** (${percent(fansly.closed, fansly.required)}), открыто — **${String(fansly.open)}**; после пилота — ${String(fansly.afterPilot)}.`,
    `- PR-владельцев: ${String(fansly.byPr.length)}, отмечены сделанными — ${String(done.length)}${done.length === 0 ? '' : ` (${done.map((line) => line.name).join(', ')})`}.`,
    `- Строк сделанных PR, открытых на Fansly: **${String(fansly.openOfDone.length)}**${fansly.openOfDone.length === 0 ? '' : ` — ${fansly.openOfDone.join(', ')}`}.`,
    '',
    '### По видам проверки',
    '',
    '| Проверка | Строк | Закрыто | Открыто |',
    '|---|---:|---:|---:|',
    ...fansly.byKind.map((line) => `| ${FANSLY_RU[line.name as CheckKind]} | ${String(line.rows)} | ${String(line.closed)} | ${String(line.open)} |`),
    '',
    '«Открыто» у «после пилота» — не ошибка: в пилот эти строки не входят.',
    '',
    '### По PR',
    '',
    '| PR | Сделан | Строк | Закрыто | Открыто |',
    '|---|---|---:|---:|---:|',
    ...fansly.byPr.map((line) => `| ${line.name} | ${line.done ? '✓' : ''} | ${String(line.rows)} | ${String(line.closed)} | ${String(line.open)} |`),
    '',
  ];
  return lines;
}

export function renderCoverage(report: CoverageReport): string {
  const lines: string[] = [
    '# Покрытие паритета тестами',
    '',
    `<!-- ${report.generated} -->`,
    '',
    'Какие строки чек-листа паритета названы в тестах — отдельно на ChatSpace и на Fansly. Тест называет строку',
    'меткой `[ID]` в своём названии: `it(\'[ST-042] адрес хаба меняется только без входа\', …)`. Отчёт собирает',
    '`pnpm parity:coverage` (`tools/parity/coverage.ts`) из манифеста паритета (`parity-manifest.json`), отметок',
    'сделанных PR (`docs/project-unite/done/<PR id>` или `✓` в `plan.md`), подтверждений хаба (§10 матрицы паритета) и всех файлов тестов —',
    'юнит-тестов (`*.test.ts`, `*.test.tsx`) и e2e (`*.e2e.ts`). Рядом лежит то же в машинном виде — `coverage.json`.',
    '',
    'Сам отчёт `pnpm check` не пересобирает; гейт по тем же правилам держит `pnpm parity` — для строк Fansly',
    '(раздел «Fansly»). Метка в названии говорит, что тест назван по строке, но не доказывает, что он проверяет её',
    'целиком, — это по-прежнему смотрит ревью.',
    '',
    'Как считается:',
    '- метка берётся из строк и шаблонов файла теста, не из комментариев; выключенные тесты',
    '  (`it.skip`, `it.todo`, `describe.skip`) не считаются;',
    '- хост теста — по пути файла (`docs/project-unite/plan.md` §0): Fansly — спеки `suite-fansly-*` и',
    '  `fansly-*`, `packages/host-fansly`, `packages/fansly-api`, `hosts/fansly`, `bg/fansly`; ChatSpace —',
    '  `packages/host-chatspace`, `hosts/chatspace`, `bg/chatspace`, фикстура стенда ChatSpace; в общем коде —',
    '  явная метка `[host:fansly]` или `[host:chatspace]` в названии теста (метки собираются на файл, обе — тест на',
    '  обоих сайтах); без пути и метки e2e идёт на стенде ChatSpace, остальное — тест без хоста;',
    '- уровень: `*.e2e.ts` — браузер, остальное — юнит; юнит-тест строку браузерного уровня не закрывает;',
    '- пилотная строка — с целью «пилот», «пилот + ChatSpace» или «пилот + Fansly»;',
    '- строка с двумя этапами считается в обоих.',
    '',
    `Файлов тестов: ${String(report.testFiles.unit)} юнит и ${String(report.testFiles.e2e)} e2e; на ChatSpace — ${String(report.testFiles.chatspace)}, на Fansly — ${String(report.testFiles.fansly)}, без хоста — ${String(report.testFiles.free)}.`,
    '',
    ...chatspaceLines(report),
    ...fanslyLines(report),
    '## Метки, которых нет в манифесте',
    '',
  ];
  if (report.unknownTags.length === 0) lines.push('Нет: каждая метка в тестах — строка манифеста.', '');
  else {
    lines.push('Опечатка в метке или строка, убранная из чек-листа:', '');
    for (const entry of report.unknownTags) lines.push(`- \`[${entry.tag}]\` — ${entry.files.map((file) => `\`${file}\``).join(', ')}`);
    lines.push('');
  }
  if (report.skippedOnly.length > 0) {
    lines.push('## Строки, названные только в выключенных тестах', '');
    for (const entry of report.skippedOnly) lines.push(`- ${entry.id} — ${entry.files.map((file) => `\`${file}\``).join(', ')}`);
    lines.push('');
  }
  if (report.hostProblems.length > 0) {
    lines.push('## Метки хоста с ошибкой', '');
    for (const problem of report.hostProblems) lines.push(`- ${problem}`);
    lines.push('');
  }
  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}
