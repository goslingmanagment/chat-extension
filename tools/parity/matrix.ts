// Reads the two R20 documents the parity gate needs besides the map:
//
// - docs/project-unite/parity-matrix.md (P1a): §7 «Матрица» — every row that
//   concerns Fansly with its one owning PR and its check on Fansly
//   (ID | Функция | Откуда | Требование | PR | Проверка | На Fansly); §9 — the
//   rows Fansly does not concern (ID | Функция | Почему); §10 — the hub's
//   confirmations of the `хаб` rows (ID | PR | Тест хаба | Коммит хаба).
// - docs/project-unite/plan.md: the PR ids of its stage tables (§2) and which
//   of them are marked done — `✓` after the id in the first cell
//   (`| P1b ✓ | …`). A PR marks itself done in its own diff, so the gate holds
//   its rows to their tests before it merges.
//
// Relative imports carry `.ts`: this file runs under plain Node 26.

import { section, tableCells } from './map.ts';

export const MATRIX_PATH = 'docs/project-unite/parity-matrix.md';
export const PLAN_PATH = 'docs/project-unite/plan.md';

/** A PR of the R20 plan: `P7e`, `P10b1`, `P2v`, `F2b`, `HF-7д0`. */
export const PLAN_PR = /^(?:[PF]\d+[a-z]?\d*|HF-\d+[а-яё]?\d*)$/;
/** The mark of a done PR in the first cell of its plan row. */
export const DONE_MARK = '✓';

const ROW = /^\| ([A-Z0-9]+-\d+) \|/;

export interface MatrixRow {
  readonly id: string;
  readonly function: string;
  /** `старое`, `ChatSpace` or `новое`. */
  readonly origin: string;
  readonly requirement: string;
  /** The one PR of the plan that owns the row on Fansly. */
  readonly pr: string;
  /** The «Проверка» cell as written: `браузер · \`suite-fansly-tail\``, `общий`, … */
  readonly check: string;
}

export interface NotFanslyRow {
  readonly id: string;
  readonly function: string;
  readonly reason: string;
}

/**
 * A hub test that proves a `хаб` row (§10 of the matrix): an external
 * confirmation. The gate checks its shape and that it belongs to the row; it
 * never reaches the hub — whoever writes the line has read that test on the
 * hub's main at that commit.
 */
export interface HubConfirmation {
  readonly id: string;
  /** The hub PR of the plan (`HF-10`). */
  readonly pr: string;
  /** Path of the test file in the hub repository and the test's title with `[ID]`. */
  readonly test: string;
  /** The hub commit on its main that carries the test. */
  readonly commit: string;
}

export interface ParityMatrix {
  readonly rows: readonly MatrixRow[];
  readonly notFansly: readonly NotFanslyRow[];
  readonly hub: readonly HubConfirmation[];
}

function rowsOf(text: string, columns: number, where: string): string[][] {
  return text
    .split('\n')
    .filter((line) => ROW.test(line))
    .map((line) => {
      const cells = tableCells(line);
      if (cells.length !== columns) throw new Error(`parity-matrix.md ${where}: ${cells[0] ?? line}: expected ${String(columns)} cells, got ${String(cells.length)}`);
      return cells;
    });
}

const unquote = (cell: string): string => cell.replace(/^`([^`]*)`$/, '$1');

export function parseParityMatrix(markdown: string): ParityMatrix {
  const rows = rowsOf(section(markdown, '7. Матрица', 'parity-matrix.md'), 7, '§7').map(
    ([id = '', fn = '', origin = '', requirement = '', pr = '', check = '']): MatrixRow => ({ id, function: fn, origin, requirement, pr, check }),
  );
  const notFansly = rowsOf(section(markdown, '9. Строки, которые Fansly не касаются', 'parity-matrix.md'), 3, '§9').map(
    ([id = '', fn = '', reason = '']): NotFanslyRow => ({ id, function: fn, reason }),
  );
  const hub = rowsOf(section(markdown, '10. Подтверждения хаба', 'parity-matrix.md'), 4, '§10').map(
    ([id = '', pr = '', test = '', commit = '']): HubConfirmation => ({ id, pr, test, commit: unquote(commit) }),
  );
  return { rows, notFansly, hub };
}

export interface PlanPrs {
  /** Every PR of the stage tables (§2), in the order of the plan. */
  readonly all: readonly string[];
  /** The PRs marked done (`✓`). */
  readonly done: ReadonlySet<string>;
}

/** PR ids of the stage tables of plan.md §2 and their done marks. */
export function parsePlanPrs(markdown: string): PlanPrs {
  const all: string[] = [];
  const done = new Set<string>();
  for (const line of section(markdown, '2. PR по этапам', 'plan.md').split('\n')) {
    if (!line.startsWith('| ')) continue;
    const first = tableCells(line)[0] ?? '';
    const marked = first.endsWith(` ${DONE_MARK}`);
    const id = marked ? first.slice(0, -DONE_MARK.length - 1) : first;
    if (!PLAN_PR.test(id)) continue;
    if (all.includes(id)) throw new Error(`plan.md §2: PR ${id} has two rows`);
    all.push(id);
    if (marked) done.add(id);
  }
  return { all, done };
}
