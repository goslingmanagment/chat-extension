import { describe, expect, it } from 'vitest';

import { buildCoverage, renderCoverage, serializeCoverage, tagsOfTestFile, testKindOf, type FanslyInput, type TaggedFile } from './coverage-report.ts';
import type { CheckKind, HostPlan, ManifestRow } from './derive.ts';

/** A row; `owner` and `check` are its ChatSpace plan, `fansly` its Fansly plan (shared, owned by P8b3, unless given). */
const row = (overrides: Partial<Omit<ManifestRow, 'chatspace'>> & Pick<ManifestRow, 'id'> & { owner?: string; check?: HostPlan['check'] }): ManifestRow => {
  const { owner = 'R11', check = { kind: 'unit' as CheckKind }, ...rest } = overrides;
  return {
    function: 'f',
    target: 'пилот',
    module: 'core/x',
    packages: ['R11'],
    milestones: ['M2'],
    mark: null,
    fansly: { owner: 'R20/P8b3', check: { kind: 'shared' } },
    ...rest,
    chatspace: { owner, check },
  };
};

const NO_FANSLY: FanslyInput = { confirmations: [], prs: [], done: new Set() };

describe('tags of a test file', () => {
  it('reads row ids from test titles — strings and templates, never comments', () => {
    const source = `
      // [ZZ-001] a comment is not a test
      /* [ZZ-002] neither is this one */
      import { describe, it } from 'vitest';
      describe('[AI-001] Reply', () => {
        it('[AI-002] [AI-003] two rows in one title', () => undefined);
        it(\`[NEW-08] a template \${1 + 1} [X8-01] with a tail\`, () => undefined);
        it.each([['[ST-042] a row of a table', 1]])('%s', () => undefined);
        it("[HK-012] double quotes; a regex with a quote does not confuse the reader", () => /['"]/.test('[UP-009]'));
        it('not a tag: [abc-001], [AI-1], [AI-0001], [AI001], AI-005', () => undefined);
      });
    `;
    expect(tagsOfTestFile('a.test.ts', source)).toEqual({ tags: ['AI-001', 'AI-002', 'AI-003', 'NEW-08', 'X8-01', 'ST-042', 'HK-012', 'UP-009'], skipped: [], hosts: [] });
  });

  it('a test that is switched off names nothing; a row it names is reported as skipped only', () => {
    const source = `
      describe('suite', () => {
        it.skip('[AI-010] off', () => undefined);
        it.todo('[AI-011] later');
        xit('[AI-012] off too', () => undefined);
        describe.skip('[AI-013] a whole suite', () => { it('[AI-014] inside it', () => undefined); });
        it.skip.each([['[AI-015] a table']])('%s', () => undefined);
        it('[AI-014] the same row in a test that runs', () => undefined);
        it.skipIf(false)('[AI-016] a conditional skip still counts', () => undefined);
      });
    `;
    const tags = tagsOfTestFile('a.test.ts', source);
    expect(tags.tags).toEqual(['AI-014', 'AI-016']);
    expect(tags.skipped).toEqual(['AI-010', 'AI-011', 'AI-012', 'AI-013', 'AI-015']);
  });

  it('reads host marks the same way: from titles of tests that run, once per file', () => {
    const source = `
      // [host:chatspace] a comment marks nothing
      describe('[host:fansly] sound on Fansly', () => {
        it('[SN-018] [host:fansly] relay', () => undefined);
        it.skip('[host:onlyfans] off', () => undefined);
      });
    `;
    expect(tagsOfTestFile('a.test.ts', source)).toEqual({ tags: ['SN-018'], skipped: [], hosts: ['fansly'] });
  });

  it('reads a .tsx file, and tells an e2e spec from a unit test by its name', () => {
    expect(tagsOfTestFile('a.test.tsx', `it('[UI-002] renders', () => { const node = <div title="[UI-003]">x</div>; return node; });`).tags).toEqual(['UI-002', 'UI-003']);
    expect(testKindOf('packages/testing/e2e/specs/x8-send.e2e.ts')).toBe('e2e');
    expect(testKindOf('packages/core/test/ops.test.ts')).toBe('unit');
    expect(testKindOf('packages/ui/src/kit/focus.dom.test.ts')).toBe('unit');
  });
});

describe('the coverage report', () => {
  const rows: ManifestRow[] = [
    row({ id: 'AI-001' }),
    row({ id: 'AI-002', check: { kind: 'e2e' }, milestones: ['M2', 'M3'] }),
    row({ id: 'AI-003', owner: 'R14', check: { kind: 'stand-visual' } }),
    row({ id: 'SP-001', owner: 'R12', milestones: ['M4'], function: 'Доска | Spenders' }),
    row({ id: 'AI-101', target: 'убрано владельцем', owner: 'R02', milestones: [], check: { kind: 'negative', exception: 'NEG-HELP' } }),
    row({ id: 'AI-032', target: 'Fansly', owner: 'R20', milestones: ['F'], check: { kind: 'n/a', reason: 'фаза Fansly' } }),
    row({ id: 'CS-001', target: 'даёт ChatSpace', owner: 'R02', milestones: ['M1'], check: { kind: 'e2e' } }),
  ];
  const files: TaggedFile[] = [
    { path: 'packages/core/test/reply.test.ts', tags: ['AI-001', 'AI-002', 'AI-101', 'ZZ-999'], skipped: [], hosts: [] },
    { path: 'packages/testing/e2e/specs/tab.e2e.ts', tags: ['AI-001', 'CS-001'], skipped: ['SP-001', 'AI-001'], hosts: [] },
  ];
  const report = buildCoverage(rows, files, NO_FANSLY);

  it('counts rows with a check of our own; negative and n/a rows stand aside', () => {
    expect(report.totals).toMatchObject({ all: 7, rows: 5, covered: 3, uncovered: 2, pilot: 4, pilotCovered: 2, pilotUncovered: 2, negative: 1, notApplicable: 1, taggedAnyway: 1, other: 2 });
    expect(report.testFiles).toEqual({ unit: 1, e2e: 1, chatspace: 1, fansly: 0, free: 1 });
    expect(report.rows.find((item) => item.id === 'AI-001')).toMatchObject({ covered: true, unit: ['packages/core/test/reply.test.ts'], e2e: ['packages/testing/e2e/specs/tab.e2e.ts'], pilot: true, planned: 'unit' });
    expect(report.rows.find((item) => item.id === 'SP-001')).toMatchObject({ covered: false, unit: [], e2e: [] });
  });

  it('groups by milestone in the order of the plan (a row of two milestones in both) and by owning package', () => {
    expect(report.milestones.map((item) => [item.name, item.rows, item.covered, item.pilotUncovered, item.other])).toEqual([
      ['M1', 1, 1, 0, 0],
      ['M2', 3, 2, 1, 0],
      ['M3', 1, 1, 0, 0],
      ['M4', 1, 0, 1, 0],
      ['F', 0, 0, 0, 1],
      ['—', 0, 0, 0, 1],
    ]);
    expect(report.packages.map((item) => [item.name, item.rows, item.covered, item.other])).toEqual([
      ['R02', 1, 1, 1],
      ['R11', 2, 2, 0],
      ['R12', 1, 0, 0],
      ['R14', 1, 0, 0],
      ['R20', 0, 0, 1],
    ]);
  });

  it('says where the tests of each planned check run: an e2e row named only by unit tests is seen', () => {
    expect(report.planned).toEqual([
      { planned: 'unit', rows: 2, inUnit: 1, inE2e: 1, unitOnly: 0, uncovered: 1 },
      { planned: 'e2e', rows: 2, inUnit: 1, inE2e: 1, unitOnly: 1, uncovered: 0 },
      { planned: 'stand-visual', rows: 1, inUnit: 0, inE2e: 0, unitOnly: 0, uncovered: 1 },
      { planned: 'manual-smoke', rows: 0, inUnit: 0, inE2e: 0, unitOnly: 0, uncovered: 0 },
    ]);
  });

  it('reports a tag that is no row, and a row named only by a switched-off test', () => {
    expect(report.unknownTags).toEqual([{ tag: 'ZZ-999', files: ['packages/core/test/reply.test.ts'] }]);
    expect(report.skippedOnly).toEqual([{ id: 'SP-001', files: ['packages/testing/e2e/specs/tab.e2e.ts'] }]);
  });

  it('renders the Russian report: the totals, both tables, the uncovered pilot rows by milestone, the unknown tags', () => {
    const text = renderCoverage(report);
    expect(text).toContain('# Покрытие паритета тестами');
    expect(text).toContain('Названы в тестах: **3 из 5** (60 %)');
    expect(text).toContain('| M2 | 3 | 2 | 1 | 67 % | 3 | 1 | 0 |');
    expect(text).toContain('| R12 | 1 | 0 | 1 | 0 % | 1 | 1 | 0 |');
    expect(text).toContain('#### M2 — 1');
    expect(text).toContain('| AI-003 | f | R14 | M2 | снимок на стенде |');
    // A pipe in a row's name does not break the table.
    expect(text).toContain('| SP-001 | Доска \\| Spenders | R12 | M4 | юнит-тест |');
    expect(text).toContain('- `[ZZ-999]` — `packages/core/test/reply.test.ts`');
    expect(text).toContain('## Строки, названные только в выключенных тестах');
    expect(text.endsWith('\n')).toBe(true);
    expect(text).not.toMatch(/\n\n\n/);
  });

  it('is deterministic: the same input gives the same files, one manifest row per line of the JSON', () => {
    const again = buildCoverage(rows, [...files].reverse(), NO_FANSLY);
    expect(serializeCoverage(again)).toBe(serializeCoverage(report));
    expect(renderCoverage(again)).toBe(renderCoverage(report));
    const json = serializeCoverage(report);
    expect((JSON.parse(json) as { rows: unknown[] }).rows).toHaveLength(7);
    expect(json.split('\n').filter((line) => line.startsWith('    {"id":'))).toHaveLength(7);
  });

  it('without gaps says so plainly', () => {
    const full = buildCoverage([row({ id: 'AI-001' })], [{ path: 'a.test.ts', tags: ['AI-001'], skipped: [], hosts: [] }], NO_FANSLY);
    const text = renderCoverage(full);
    expect(text).toContain('Нет: каждая пилотная строка названа хотя бы в одном тесте.');
    expect(text).toContain('Нет: каждая метка в тестах — строка манифеста.');
    expect(text).not.toContain('выключенных тестах');
  });
});

describe('the Fansly part of the report', () => {
  const rows: ManifestRow[] = [
    row({ id: 'AI-001', fansly: { owner: 'R20/P8b3', check: { kind: 'e2e', where: 'suite-fansly-tail' } } }),
    row({ id: 'AI-002' }),
    row({ id: 'AI-020', fansly: { owner: 'R20/P8b3', check: { kind: 'e2e', where: 'suite-fansly-tail' } } }),
    row({ id: 'NF-011', fansly: { owner: 'R20/P10a', check: { kind: 'unit', where: 'hosts/fansly' } } }),
    row({ id: 'REC-01', fansly: { owner: 'R20/HF-10', check: { kind: 'hub', where: 'HF-10' } } }),
    row({ id: 'AI-101', target: 'убрано владельцем', owner: 'R02', check: { kind: 'negative', exception: 'NEG-HELP' }, fansly: { owner: 'R20/P8c', check: { kind: 'negative', exception: 'NEG-HELP' } } }),
    row({ id: 'HK-036', fansly: { owner: 'R20/P17', check: { kind: 'after-pilot' } } }),
    row({ id: 'UI-034', fansly: { check: { kind: 'n/a', reason: 'не касается Fansly' } } }),
  ];
  const files: TaggedFile[] = [
    { path: 'packages/core/test/reply.test.ts', tags: ['AI-002', 'NF-011'], skipped: [], hosts: [] },
    { path: 'packages/testing/e2e/specs/suite-preview.e2e.ts', tags: ['NF-011', 'AI-001'], skipped: [], hosts: [] },
    { path: 'packages/testing/e2e/specs/suite-fansly-tail.e2e.ts', tags: ['AI-001', 'AI-020'], skipped: [], hosts: [] },
    { path: 'packages/host-fansly/src/x.test.ts', tags: ['AI-001'], skipped: [], hosts: ['chatspace'] },
  ];
  const fansly: FanslyInput = { confirmations: [], prs: ['P8b3', 'P8c', 'HF-10', 'P10a', 'P17'], done: new Set(['P8b3', 'P10a']) };
  const report = buildCoverage(rows, files, fansly);

  it('closes rows on Fansly by host and level; a test of Fansly does not name a ChatSpace row', () => {
    expect(report.rows.find((item) => item.id === 'AI-001')).toMatchObject({
      unit: [],
      e2e: ['packages/testing/e2e/specs/suite-preview.e2e.ts'],
      fansly: { owner: 'R20/P8b3', planned: 'e2e', closed: true, by: ['packages/testing/e2e/specs/suite-fansly-tail.e2e.ts'] },
    });
    expect(report.rows.find((item) => item.id === 'NF-011')?.fansly).toEqual({ owner: 'R20/P10a', planned: 'unit', closed: false, by: [] });
    expect(report.rows.find((item) => item.id === 'AI-101')?.fansly).toMatchObject({ closed: true, by: ['NEG-HELP'] });
    expect(report.rows.find((item) => item.id === 'UI-034')?.fansly).toEqual({ planned: 'n/a', closed: false, by: [] });
    expect(report.testFiles).toEqual({ unit: 2, e2e: 2, chatspace: 1, fansly: 2, free: 1 });
  });

  it('counts by check and by owning PR in the order of the plan, and the open rows of done PRs', () => {
    expect(report.fansly).toMatchObject({ rows: 7, notConcerned: 1, required: 6, closed: 4, open: 2, afterPilot: 1, openOfDone: ['NF-011'] });
    expect(report.fansly.byKind.map((line) => [line.name, line.rows, line.closed])).toEqual([
      ['e2e', 2, 2],
      ['stand-visual', 0, 0],
      ['unit', 1, 0],
      ['hub', 1, 0],
      ['shared', 1, 1],
      ['negative', 1, 1],
      ['after-pilot', 1, 0],
    ]);
    expect(report.fansly.byPr.map((line) => [line.name, line.done, line.rows, line.open])).toEqual([
      ['P8b3', true, 3, 0],
      ['P8c', false, 1, 0],
      ['HF-10', false, 1, 1],
      ['P10a', true, 1, 1],
      ['P17', false, 1, 1],
    ]);
    expect(report.hostProblems).toEqual(['packages/host-fansly/src/x.test.ts: a test of fansly code cannot carry [host:chatspace]']);
  });

  it('renders the Fansly section: totals, by check, by PR, the host marks in error', () => {
    const text = renderCoverage(report);
    expect(text).toContain('## Fansly (R20)');
    expect(text).toContain('- Нужна проверка к пилоту: 6. Закрыто — **4** (67 %), открыто — **2**; после пилота — 1.');
    expect(text).toContain('- PR-владельцев: 5, отмечены сделанными — 2 (P8b3, P10a).');
    expect(text).toContain('- Строк сделанных PR, открытых на Fansly: **1** — NF-011.');
    expect(text).toContain('| браузер · спек | 2 | 2 | 0 |');
    expect(text).toContain('| P10a | ✓ | 1 | 0 | 1 |');
    expect(text).toContain('## Метки хоста с ошибкой');
    expect(text).not.toMatch(/\n\n\n/);
  });
});
