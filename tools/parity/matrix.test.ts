import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from '../lib/paths.ts';
import { fanslyCheckOf } from './derive.ts';
import { MATRIX_PATH, parseParityMatrix, parsePlanPrs } from './matrix.ts';
import { readPlanPrs } from './plan.ts';

const read = (path: string): string => readFileSync(`${REPO_ROOT}${path}`, 'utf8');
const matrixText = read(MATRIX_PATH);
const matrix = parseParityMatrix(matrixText);
const plan = readPlanPrs(REPO_ROOT);

const count = <T>(items: readonly T[], key: (item: T) => string): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const item of items) counts[key(item)] = (counts[key(item)] ?? 0) + 1;
  return counts;
};

describe('the R20 parity matrix (docs/project-unite/parity-matrix.md)', () => {
  it('matches its own summary (§2): rows, origins, checks, owning PRs', () => {
    expect(matrix.rows).toHaveLength(718);
    expect(matrix.rows.filter((row) => row.id.startsWith('FX-'))).toHaveLength(18);
    expect(matrix.notFansly).toHaveLength(110);
    expect(count(matrix.rows, (row) => row.origin)).toEqual({ старое: 599, ChatSpace: 118, новое: 1 });
    const kinds = count(matrix.rows, (row) => fanslyCheckOf(row).kind);
    expect({ browser: (kinds.e2e ?? 0) + (kinds['stand-visual'] ?? 0), unit: kinds.unit, hub: kinds.hub, shared: kinds.shared, negative: kinds.negative, afterPilot: kinds['after-pilot'] }).toEqual({
      browser: 111,
      unit: 128,
      hub: 12,
      shared: 444,
      negative: 17,
      afterPilot: 6,
    });
    // «Строк на PR: HF-6 — 1; HF-7а — 1; …» — the same per PR.
    const line = /Строк на PR: ([^]*?)\n\n/.exec(matrixText)?.[1] ?? '';
    const summary = Object.fromEntries([...line.replace(/\n/g, ' ').matchAll(/(\S+) — (\d+)/g)].map(([, pr = '', rows = '']) => [pr, Number(rows)]));
    expect(Object.keys(summary)).toHaveLength(55);
    expect(count(matrix.rows, (row) => row.pr)).toEqual(summary);
  });

  it('holds the hub confirmations in §10 (none yet)', () => {
    expect(matrix.hub).toEqual([]);
  });

  it('reads §7, §9 and §10 rows; a row of the wrong width stops the reading', () => {
    const doc = [
      '# m',
      '## 7. Матрица',
      '### 1.1 Reply',
      '| ID | Функция | Откуда | Требование | PR | Проверка | На Fansly |',
      '|---|---|---|---|---|---|---|',
      '| AI-001 | Reply | старое | FS-AI-1 | P8b3 | браузер · `suite-fansly-tail` | a \\| b |',
      '## 8. Требования',
      '| FS-AI-1 | x | AI-001 | P8b3 | общий |',
      '## 9. Строки, которые Fansly не касаются',
      '| UI-028 | «Вставить все» | убрано владельцем |',
      '## 10. Подтверждения хаба',
      '| REC-01 | HF-10 | `apps/api/src/recap.test.ts` «[REC-01] one body» | `0123abc` |',
      '',
    ].join('\n');
    expect(parseParityMatrix(doc)).toEqual({
      rows: [{ id: 'AI-001', function: 'Reply', origin: 'старое', requirement: 'FS-AI-1', pr: 'P8b3', check: 'браузер · `suite-fansly-tail`' }],
      notFansly: [{ id: 'UI-028', function: '«Вставить все»', reason: 'убрано владельцем' }],
      hub: [{ id: 'REC-01', pr: 'HF-10', test: '`apps/api/src/recap.test.ts` «[REC-01] one body»', commit: '0123abc' }],
    });
    expect(() => parseParityMatrix(doc.replace('| UI-028 | «Вставить все» |', '| UI-028 |'))).toThrow(/§9: UI-028: expected 3 cells, got 2/);
    expect(() => parseParityMatrix(doc.replace('## 10. Подтверждения хаба', '## 10. Другое'))).toThrow(/section «10. Подтверждения хаба» not found/);
  });
});

describe('the PRs of the R20 plan (docs/project-unite/plan.md §2)', () => {
  it('reads every PR of the stage tables, hub PRs and P17 among them', () => {
    expect(plan.all).toHaveLength(103);
    for (const pr of ['P1a', 'P1b', 'HF-8а', 'HF-7д0', 'F2b', 'P7a0', 'P10b1', 'P16c', 'P17']) expect(plan.all, pr).toContain(pr);
    // Every owner of a matrix row is a PR of the plan.
    for (const row of matrix.rows) expect(plan.all, row.id).toContain(row.pr);
  });

  it('marks done only PRs of the plan; the matrix PR and the gate are done', () => {
    for (const pr of plan.done) expect(plan.all, pr).toContain(pr);
    expect(plan.done.has('P1a') && plan.done.has('P1b')).toBe(true);
  });

  it('reads the done mark after the id; a PR of two rows stops the reading', () => {
    const doc = '# plan\n## 2. PR по этапам\n\n| PR | Что |\n|---|---|\n| P7e ✓ | вставка |\n| P7f | отправка |\n| HF-7д0 ✓ | хаб |\n\n## 3. Каталог\n\n| P9z ✓ | not in §2 |\n';
    expect(parsePlanPrs(doc)).toEqual({ all: ['P7e', 'P7f', 'HF-7д0'], done: new Set(['P7e', 'HF-7д0']) });
    expect(() => parsePlanPrs(`${doc.replace('| P7f |', '| P7e |')}`)).toThrow(/PR P7e has two rows/);
  });

  it('unions file ids with legacy marks, including hub ids, and rejects unknown ids', () => {
    const doc = '# Plan\n## 2. PR по этапам\n| P7e ✓ | insertion |\n| P7f | send |\n| HF-7д0 | hub |\n';
    expect(parsePlanPrs(doc, ['P7e', 'P7f', 'HF-7д0'])).toEqual({
      all: ['P7e', 'P7f', 'HF-7д0'], done: new Set(['P7e', 'P7f', 'HF-7д0']),
    });
    expect(() => parsePlanPrs(doc, ['P99'])).toThrow('docs/project-unite/done/P99: unknown PR id');
  });
});
