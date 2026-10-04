// Parity coverage (architecture.md §12, §17; docs/parity/): which rows of the
// parity manifest are named by a test. A test names a row by a `[ROW-ID]`
// tag in its title (`it('[ST-042] …')`, a `describe`, a row of `it.each`).
// This module is the pure part: reading tags out of a test file, counting
// rows by milestone and by owning work package, and rendering the report.
// tools/parity/coverage.ts reads the files and writes the result. It is a
// report, not a gate: `pnpm check` does not run it.
//
// What counts as a tag: `[ID]` inside a string literal or a template of a
// test file — never inside a comment — and not inside a test that is
// switched off (`it.skip`, `it.todo`, `describe.skip`, `xit`, `xdescribe`).
// A row id is letters and digits, a dash and two or three digits (`AI-001`,
// `NEW-08`, `X8-01`); a tag that is no row of the manifest is reported, not
// counted.
//
// Relative imports carry `.ts`: this file runs under plain Node 26.

import ts from 'typescript';

import type { CheckKind, ManifestRow } from './derive.ts';

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
}

/** The `[ROW-ID]` tags of one test file: from its strings and templates, never from comments. */
export function tagsOfTestFile(path: string, source: string): FileTags {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, false, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const live = new Set<string>();
  const off = new Set<string>();
  const collect = (text: string, skipped: boolean): void => {
    for (const match of text.matchAll(TAG)) (skipped ? off : live).add(match[1] ?? '');
  };
  const visit = (node: ts.Node, skipped: boolean): void => {
    if (ts.isStringLiteralLike(node)) collect(node.text, skipped);
    else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) collect(node.text, skipped);
    const inside = skipped || (ts.isCallExpression(node) && isSwitchedOff(node));
    ts.forEachChild(node, (child) => visit(child, inside));
  };
  visit(file, false);
  return { tags: [...live], skipped: [...off].filter((id) => !live.has(id)) };
}

export interface TaggedFile extends FileTags {
  readonly path: string;
}

/** Rows that carry `пилот` in their target: what the pilot is accepted by (§17). */
export function isPilotRow(row: Pick<ManifestRow, 'target'>): boolean {
  return row.target.includes('пилот');
}

/** Rows proven otherwise than by a tagged test of ours: a negative check of the exceptions registry, or no check at all. */
export function hasOwnCheck(row: Pick<ManifestRow, 'check'>): boolean {
  return row.check.kind !== 'negative' && row.check.kind !== 'n/a';
}

export interface RowCoverage {
  readonly id: string;
  readonly function: string;
  readonly target: string;
  readonly owner: string;
  readonly milestones: readonly string[];
  /** The check the manifest plans for the row. */
  readonly planned: CheckKind;
  readonly pilot: boolean;
  /** Test files that name the row, by kind. */
  readonly unit: readonly string[];
  readonly e2e: readonly string[];
  readonly covered: boolean;
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

export interface CoverageReport {
  readonly generated: string;
  readonly testFiles: { readonly unit: number; readonly e2e: number };
  readonly totals: Bucket & { readonly all: number; readonly negative: number; readonly notApplicable: number; readonly taggedAnyway: number };
  readonly milestones: readonly Bucket[];
  readonly packages: readonly Bucket[];
  /** By the check the manifest plans: a row planned for e2e and named only by unit tests is seen here. */
  readonly planned: readonly PlannedLine[];
  readonly rows: readonly RowCoverage[];
  /** Tags of tests that are no row of the manifest: a typo or a row that was removed. */
  readonly unknownTags: ReadonlyArray<{ readonly tag: string; readonly files: readonly string[] }>;
  /** Rows named only by tests that are switched off. */
  readonly skippedOnly: ReadonlyArray<{ readonly id: string; readonly files: readonly string[] }>;
}

export const GENERATED_NOTE = 'node tools/parity/coverage.ts (pnpm parity:coverage) — руками не править; источник: docs/parity/parity-manifest.json и метки [ID] в названиях тестов';

/** Check kinds a test of ours can carry out, in the order of the report. */
const OWN_CHECKS: readonly CheckKind[] = ['unit', 'e2e', 'stand-visual', 'manual-smoke'];

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

export function buildCoverage(manifestRows: readonly ManifestRow[], files: readonly TaggedFile[]): CoverageReport {
  const known = new Set(manifestRows.map((row) => row.id));
  const namedBy = new Map<string, { unit: string[]; e2e: string[] }>();
  const unknown = new Map<string, string[]>();
  const skipped = new Map<string, string[]>();
  for (const file of [...files].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    for (const tag of file.tags) {
      if (!known.has(tag)) {
        unknown.set(tag, [...(unknown.get(tag) ?? []), file.path]);
        continue;
      }
      const entry = namedBy.get(tag) ?? { unit: [], e2e: [] };
      entry[testKindOf(file.path)].push(file.path);
      namedBy.set(tag, entry);
    }
    for (const tag of file.skipped) if (known.has(tag)) skipped.set(tag, [...(skipped.get(tag) ?? []), file.path]);
  }
  const rows: RowCoverage[] = manifestRows.map((row) => {
    const named = namedBy.get(row.id) ?? { unit: [], e2e: [] };
    return {
      id: row.id,
      function: row.function,
      target: row.target,
      owner: row.owner,
      milestones: row.milestones,
      planned: row.check.kind,
      pilot: isPilotRow(row),
      unit: named.unit,
      e2e: named.e2e,
      covered: named.unit.length + named.e2e.length > 0,
    };
  });
  const group = (keysOf: (row: RowCoverage) => readonly string[], order: readonly string[]): Bucket[] => {
    const groups = new Map<string, RowCoverage[]>();
    for (const row of rows) for (const key of keysOf(row)) groups.set(key, [...(groups.get(key) ?? []), row]);
    return [...groups.keys()].sort(byName(order)).map((key) => bucket(key, groups.get(key) ?? []));
  };
  const total = bucket('всего', rows);
  return {
    generated: GENERATED_NOTE,
    testFiles: { unit: files.filter((file) => testKindOf(file.path) === 'unit').length, e2e: files.filter((file) => testKindOf(file.path) === 'e2e').length },
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
    rows,
    unknownTags: [...unknown.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([tag, paths]) => ({ tag, files: paths })),
    skippedOnly: [...skipped.entries()]
      .filter(([id]) => !namedBy.has(id))
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([id, paths]) => ({ id, files: paths })),
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
  negative: 'отрицательная проверка',
  'n/a': 'своей проверки нет',
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

export function renderCoverage(report: CoverageReport): string {
  const { totals } = report;
  const uncoveredPilot = report.rows.filter((row) => row.pilot && !row.covered && row.planned !== 'negative' && row.planned !== 'n/a');
  const milestoneOf = (row: RowCoverage): string => (row.milestones.length === 0 ? NO_MILESTONE : row.milestones.join(', '));
  const groups = new Map<string, RowCoverage[]>();
  for (const row of uncoveredPilot) {
    const key = row.milestones[0] ?? NO_MILESTONE;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const lines: string[] = [
    '# Покрытие паритета тестами',
    '',
    `<!-- ${report.generated} -->`,
    '',
    'Какие строки чек-листа паритета названы в тестах. Тест называет строку меткой `[ID]` в своём',
    'названии: `it(\'[ST-042] адрес хаба меняется только без входа\', …)`. Отчёт собирает',
    '`pnpm parity:coverage` (`tools/parity/coverage.ts`) из манифеста паритета',
    '(`parity-manifest.json`) и всех файлов тестов — юнит-тестов (`*.test.ts`, `*.test.tsx`) и e2e',
    '(`*.e2e.ts`). Рядом лежит то же в машинном виде — `coverage.json`.',
    '',
    '**Это отчёт, а не гейт:** `pnpm check` его не запускает и на непокрытые строки не падает.',
    'Метка в названии говорит, что тест назван по строке, но не доказывает, что он проверяет её',
    'целиком, — это по-прежнему смотрит ревью. Строка без метки может быть проверена тестом без',
    'метки; такие тесты отчёт не видит.',
    '',
    'Как считается:',
    '- метка берётся из строк и шаблонов файла теста, не из комментариев; выключенные тесты',
    '  (`it.skip`, `it.todo`, `describe.skip`) не считаются;',
    '- «строки с проверкой» — все, кроме строк с отрицательной проверкой («не нужно», «убрано',
    '  владельцем» — их держит реестр исключений) и строк без своей проверки (фаза Fansly, «даёт',
    '  ChatSpace», «ждёт владельца»); эти — в колонке «Прочих строк»;',
    '- пилотная строка — с целью «пилот», «пилот + ChatSpace» или «пилот + Fansly»;',
    '- пакет — пакет работ, владелец строки (первый в колонке «Пакет» карты паритета);',
    '- строка с двумя этапами считается в обоих.',
    '',
    '## Итог',
    '',
    `- Строк в манифесте: **${String(totals.all)}**. Из них с проверкой — ${String(totals.rows)}, с отрицательной проверкой — ${String(totals.negative)}, без своей проверки — ${String(totals.notApplicable)}.`,
    `- Названы в тестах: **${String(totals.covered)} из ${String(totals.rows)}** (${percent(totals.covered, totals.rows)}). Без теста — ${String(totals.uncovered)}.`,
    `- Пилотных строк: ${String(totals.pilot)}. Названы в тестах — **${String(totals.pilotCovered)}** (${percent(totals.pilotCovered, totals.pilot)}), без теста — **${String(totals.pilotUncovered)}**.`,
    `- Файлов тестов: ${String(report.testFiles.unit)} юнит и ${String(report.testFiles.e2e)} e2e.`,
    ...(totals.taggedAnyway === 0 ? [] : [`- Ещё ${String(totals.taggedAnyway)} строк без своей проверки или с отрицательной проверкой тоже названы в тестах.`]),
    '',
    '## По этапам',
    '',
    ...table(report.milestones, 'Этап'),
    '',
    '`—` — строки без этапа: «не нужно», «убрано владельцем», «даёт ChatSpace», «ждёт владельца».',
    '',
    '## По пакетам работ',
    '',
    ...table(report.packages, 'Пакет'),
    '',
    '## Проверка по плану и по факту',
    '',
    'Какую проверку строке назначил манифест и в каких тестах она названа. «Только юнит» у строк',
    'с планом «e2e на стенде» или «снимок на стенде» — повод посмотреть, хватает ли юнит-теста.',
    '',
    '| Проверка по плану | Строк | Названы в юнит-тестах | Названы в e2e | Только юнит | Без теста |',
    '|---|---:|---:|---:|---:|---:|',
    ...report.planned.map((line) => `| ${PLANNED_RU[line.planned]} | ${String(line.rows)} | ${String(line.inUnit)} | ${String(line.inE2e)} | ${String(line.unitOnly)} | ${String(line.uncovered)} |`),
    '',
    '## Пилотные строки без теста',
    '',
  ];
  if (uncoveredPilot.length === 0) lines.push('Нет: каждая пилотная строка названа хотя бы в одном тесте.', '');
  for (const key of [...groups.keys()].sort(byName([...MILESTONE_ORDER, NO_MILESTONE]))) {
    const rows = groups.get(key) ?? [];
    lines.push(`### ${key === NO_MILESTONE ? 'Без этапа' : key} — ${String(rows.length)}`, '', '| Строка | Что это | Пакет | Этап | Проверка по плану |', '|---|---|---|---|---|');
    for (const row of [...rows].sort((a, b) => (a.owner === b.owner ? (a.id < b.id ? -1 : 1) : a.owner < b.owner ? -1 : 1))) {
      lines.push(`| ${row.id} | ${cell(row.function)} | ${row.owner} | ${milestoneOf(row)} | ${PLANNED_RU[row.planned]} |`);
    }
    lines.push('');
  }
  lines.push('## Метки, которых нет в манифесте', '');
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
  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}
