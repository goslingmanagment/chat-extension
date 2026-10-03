// Reads docs/parity/parity-map.md: the per-row table «Все строки чек-листа»
// (ID | Функция | Было | Итог | Модуль | Пакет | Этап | Пометка) and the
// table of new rows «Новые строки» (ID | Что | Модуль | Пакет | Этап), which
// the checklist does not have (NEW-*, X8-*, REC-*).

export interface MapRow {
  readonly id: string;
  readonly function: string;
  /** Outcome after the rounds («Итог»); new rows are pilot rows, or Fansly at stage F. */
  readonly target: string;
  readonly module: string;
  readonly packages: readonly string[];
  readonly milestones: readonly string[];
  /** «Пометка» without the bold markers; null when empty. */
  readonly mark: string | null;
  readonly origin: 'checklist' | 'new';
}

const ROW = /^\| ([A-Z0-9]+-\d+) \|/;
const ESCAPED_PIPE = '\u0000';

/** Cells of a table row; `\|` inside a cell stays a literal pipe. */
export function tableCells(line: string): string[] {
  return line
    .replace(/\\\|/g, ESCAPED_PIPE)
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim().replaceAll(ESCAPED_PIPE, '|'));
}

/** The text between a `## heading` and the next `## ` heading. */
function section(markdown: string, heading: string): string {
  const start = markdown.indexOf(`\n## ${heading}`);
  if (start < 0) throw new Error(`parity-map.md: section «${heading}» not found`);
  const next = markdown.indexOf('\n## ', start + 1);
  return markdown.slice(start, next < 0 ? undefined : next);
}

const list = (cell: string, separator: string): string[] =>
  cell === '—' || cell === ''
    ? []
    : cell
        .split(separator)
        .map((item) => item.trim())
        .filter(Boolean);

const markOf = (cell: string): string | null => {
  const mark = cell.replace(/\*\*/g, '').trim();
  return mark === '' ? null : mark;
};

function rowsOf(text: string, columns: number): string[][] {
  return text
    .split('\n')
    .filter((line) => ROW.test(line))
    .map((line) => {
      const cells = tableCells(line);
      if (cells.length !== columns) throw new Error(`parity-map.md: ${cells[0] ?? line}: expected ${columns} cells, got ${cells.length}`);
      return cells;
    });
}

export function parseParityMap(markdown: string): MapRow[] {
  const checklist = rowsOf(section(markdown, 'Все строки чек-листа'), 8).map(
    ([id = '', fn = '', , target = '', module = '', packages = '', milestones = '', mark = '']): MapRow => ({
      id,
      function: fn,
      target,
      module,
      packages: list(packages, '·'),
      milestones: list(milestones, ','),
      mark: markOf(mark),
      origin: 'checklist',
    }),
  );
  const added = rowsOf(section(markdown, 'Новые строки'), 5).map(([id = '', what = '', module = '', packages = '', milestones = '']): MapRow => {
    const stages = list(milestones, ',');
    return {
      id,
      function: what,
      target: stages.length > 0 && stages.every((stage) => stage === 'F') ? 'Fansly' : 'пилот',
      module,
      packages: list(packages, '·'),
      milestones: stages,
      mark: null,
      origin: 'new',
    };
  });
  return [...checklist, ...added];
}
