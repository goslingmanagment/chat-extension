import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { PARITY_EXCEPTIONS } from '../../packages/contracts/src/parity/exceptions.ts';
import { REPO_ROOT } from '../lib/paths.ts';
import { deriveManifest, MANIFEST_PATH, serializeManifest, type ParityManifest } from './derive.ts';
import { parseParityMap, tableCells, type MapRow } from './map.ts';
import { checklistIds, checkParityManifest } from './manifest.ts';
import { MATRIX_PATH, parseParityMatrix, parsePlanPrs, PLAN_PATH, type ParityMatrix } from './matrix.ts';

const read = (path: string): string => readFileSync(`${REPO_ROOT}${path}`, 'utf8');
const mapRows = parseParityMap(read('docs/parity/parity-map.md'));
const matrix = parseParityMatrix(read(MATRIX_PATH));
const derived = deriveManifest(mapRows, PARITY_EXCEPTIONS, matrix);
const byId = new Map(derived.rows.map((row) => [row.id, row]));

describe('parity map', () => {
  it('reads every checklist row and every new row', () => {
    const checklist = checklistIds(read('docs/parity/parity-checklist.md'));
    expect(checklist).toHaveLength(805);
    expect(mapRows.filter((row) => row.origin === 'checklist').map((row) => row.id)).toEqual(checklist);
    const added = mapRows.filter((row) => row.origin === 'new').map((row) => row.id);
    expect(added).toHaveLength(23);
    for (const prefix of ['NEW-', 'X8-', 'REC-']) expect(added.some((id) => id.startsWith(prefix)), prefix).toBe(true);
  });

  it('matches the summary of parity-map.md', () => {
    const counts = new Map<string, number>();
    for (const row of mapRows.filter((item) => item.origin === 'checklist')) counts.set(row.target, (counts.get(row.target) ?? 0) + 1);
    expect(Object.fromEntries(counts)).toEqual({
      пилот: 596,
      'пилот + ChatSpace': 4,
      'пилот + Fansly': 5,
      Fansly: 85,
      'даёт ChatSpace': 28,
      'не нужно': 73,
      'убрано владельцем': 13,
      'ждёт владельца': 1,
    });
  });

  it('keeps escaped pipes inside a cell and splits packages and stages', () => {
    expect(tableCells('| A-001 | x \\| y | z |')).toEqual(['A-001', 'x | y', 'z']);
    const claim = mapRows.find((row) => row.id === 'NF-021') as MapRow;
    expect(claim.mark).toContain('claim | renew | release');
    expect(claim.packages).toEqual(['R12', 'R05']);
    const split = mapRows.find((row) => row.id === 'NEW-04') as MapRow;
    expect(split.milestones).toEqual(['M2', 'M3']);
    expect(split.target).toBe('пилот');
    expect((mapRows.find((row) => row.id === 'NEW-12') as MapRow).target).toBe('Fansly');
  });
});

describe('parity manifest (docs/parity/parity-manifest.json)', () => {
  it('is exactly what the map, the R20 matrix and the exceptions registry derive (node tools/parity/generate.ts)', () => {
    expect(read(MANIFEST_PATH)).toBe(serializeManifest(derived));
  });

  it('passes the gate checks', () => {
    const manifest = JSON.parse(read(MANIFEST_PATH)) as ParityManifest;
    expect(checkParityManifest(manifest, checklistIds(read('docs/parity/parity-checklist.md')), PARITY_EXCEPTIONS, parsePlanPrs(read(PLAN_PATH)).all)).toEqual([]);
  });

  it('gives every removed and not-needed row a negative check owned by R02 on ChatSpace', () => {
    const removed = derived.rows.filter((row) => row.target === 'не нужно' || row.target === 'убрано владельцем');
    expect(removed).toHaveLength(86);
    for (const row of removed) {
      expect(row.chatspace.check.kind, row.id).toBe('negative');
      expect(row.chatspace.owner, row.id).toBe('R02');
      // On Fansly the same exception, or the row does not concern Fansly.
      expect(['negative', 'n/a'], row.id).toContain(row.fansly.check.kind);
    }
    expect(new Set(PARITY_EXCEPTIONS.flatMap((exception) => exception.rows)).size).toBe(86);
  });

  it('plans ChatSpace checks by module: unit for logic, e2e for the host, visual for surfaces, smoke for release', () => {
    expect(byId.get('AI-001')?.chatspace.check).toEqual({ kind: 'unit' });
    expect(byId.get('UI-001')?.chatspace.check).toEqual({ kind: 'e2e' });
    expect(byId.get('ST-001')?.chatspace.check).toEqual({ kind: 'stand-visual' });
    expect(byId.get('UP-001')?.chatspace.check).toEqual({ kind: 'manual-smoke' });
    expect(byId.get('X8-10')?.chatspace.check).toEqual({ kind: 'manual-smoke' });
    expect(byId.get('UI-016')?.chatspace.check).toEqual({ kind: 'e2e' });
    expect(byId.get('EX-009')?.chatspace.check).toEqual({ kind: 'e2e' });
    expect(byId.get('AI-102')?.chatspace.check).toEqual({ kind: 'negative', exception: 'NEG-HELP' });
    expect(byId.get('ST-108')?.chatspace.check.kind).toBe('n/a');
    expect(byId.get('CS-001')?.chatspace).toMatchObject({ owner: 'R02', check: { kind: 'n/a' } });
  });

  it('takes the ChatSpace owner from the first package', () => {
    expect(byId.get('AI-001')?.chatspace.owner).toBe('R11');
    expect(byId.get('X8-02')?.chatspace.owner).toBe('R09');
    expect(byId.get('ST-108')?.chatspace.owner).toBe('R12');
  });

  it('a Fansly row is no longer n/a: ChatSpace has no check for it, Fansly has the matrix one', () => {
    expect(byId.get('AI-032')?.chatspace).toEqual({ owner: 'R20', check: { kind: 'n/a', reason: 'строка только Fansly: на ChatSpace её нет, проверка — в части fansly' } });
    expect(byId.get('AI-032')?.fansly).toEqual({ owner: 'R20/P8c', check: { kind: 'e2e', where: 'suite-fansly-ai' } });
    const fanslyOnly = derived.rows.filter((row) => row.target === 'Fansly');
    expect(fanslyOnly).toHaveLength(86);
    for (const row of fanslyOnly) expect(row.fansly.check.kind, row.id).not.toBe('n/a');
  });

  it('takes the Fansly owner and check from the matrix: one PR of the plan, every kind of §1', () => {
    expect(byId.get('AI-001')?.fansly).toEqual({ owner: 'R20/P8b3', check: { kind: 'e2e', where: 'suite-fansly-tail' } });
    expect(byId.get('AI-002')?.fansly).toEqual({ owner: 'R20/P8b3', check: { kind: 'shared' } });
    expect(byId.get('NF-011')?.fansly).toEqual({ owner: 'R20/P10a', check: { kind: 'unit', where: 'hosts/fansly' } });
    expect(byId.get('NEW-03')?.fansly).toEqual({ owner: 'R20/F7', check: { kind: 'unit', where: 'метка fansly' } });
    expect(byId.get('EX-014')?.fansly).toEqual({ owner: 'R20/F9a', check: { kind: 'unit', where: 'гейт' } });
    expect(byId.get('REC-01')?.fansly).toEqual({ owner: 'R20/HF-10', check: { kind: 'hub', where: 'HF-10' } });
    expect(byId.get('HK-036')?.fansly).toEqual({ owner: 'R20/P17', check: { kind: 'after-pilot' } });
    expect(byId.get('AI-102')?.fansly.check).toEqual({ kind: 'negative', exception: 'NEG-HELP' });
    expect(derived.rows.find((row) => row.fansly.check.kind === 'stand-visual')?.fansly.check).toEqual({ kind: 'stand-visual', where: 'галерея host=fansly' });
    // §9: the row does not concern Fansly — no owner, the matrix's reason.
    expect(byId.get('UI-028')?.fansly).toEqual({ check: { kind: 'n/a', reason: 'убрано владельцем (NEG-INSERT-ALL): функция десктопа, у старого Fansly-расширения её нет' } });
  });

  it('fails closed: a removed row without an exception, a module without a rule, a row the matrix misses or holds twice, an unknown check', () => {
    const removed = mapRows.find((row) => row.id === 'AI-101') as MapRow;
    const only = (ids: readonly string[]): ParityMatrix => ({ rows: matrix.rows.filter((row) => ids.includes(row.id)), notFansly: matrix.notFansly.filter((row) => ids.includes(row.id)), hub: [] });
    expect(() => deriveManifest([removed], [], only(['AI-101']))).toThrow(/AI-101: «убрано владельцем» row has no entry/);
    const odd: MapRow = { ...removed, id: 'ZZ-001', target: 'пилот', module: 'somewhere/else' };
    const oddMatrix: ParityMatrix = { rows: [{ ...(matrix.rows[0] as ParityMatrix['rows'][number]), id: 'ZZ-001' }], notFansly: [], hub: [] };
    expect(() => deriveManifest([odd], [], oddMatrix)).toThrow(/no check rule for module «somewhere\/else»/);

    const reply = mapRows.find((row) => row.id === 'AI-001') as MapRow;
    expect(() => deriveManifest([reply], [], only([]))).toThrow(/AI-001: neither in §7 nor in §9 of parity-matrix.md/);
    expect(() => deriveManifest([reply], [], { ...only(['AI-001']), notFansly: [{ id: 'AI-001', function: 'Reply', reason: 'x' }] })).toThrow(/AI-001: two rows in parity-matrix.md/);
    expect(() => deriveManifest([], [], only(['AI-001']))).toThrow(/AI-001: in parity-matrix.md, but no row of the parity map/);
    const unknown: ParityMatrix = { rows: [{ ...(only(['AI-001']).rows[0] as ParityMatrix['rows'][number]), check: 'браузер' }], notFansly: [], hub: [] };
    expect(() => deriveManifest([reply], [], unknown)).toThrow(/AI-001: unknown check «браузер» in parity-matrix.md/);
  });
});
