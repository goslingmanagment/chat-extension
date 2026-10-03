import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { PARITY_EXCEPTIONS } from '../../packages/contracts/src/parity/exceptions.ts';
import { REPO_ROOT } from '../lib/paths.ts';
import { deriveManifest, MANIFEST_PATH, serializeManifest, type ParityManifest } from './derive.ts';
import { parseParityMap, tableCells, type MapRow } from './map.ts';
import { checklistIds, checkParityManifest } from './manifest.ts';

const read = (path: string): string => readFileSync(`${REPO_ROOT}${path}`, 'utf8');
const mapRows = parseParityMap(read('docs/parity/parity-map.md'));
const derived = deriveManifest(mapRows, PARITY_EXCEPTIONS);
const byId = new Map(derived.rows.map((row) => [row.id, row]));

describe('parity map', () => {
  it('reads every checklist row and every new row', () => {
    const checklist = checklistIds(read('docs/parity/parity-checklist.md'));
    expect(checklist).toHaveLength(787);
    expect(mapRows.filter((row) => row.origin === 'checklist').map((row) => row.id)).toEqual(checklist);
    const added = mapRows.filter((row) => row.origin === 'new').map((row) => row.id);
    expect(added).toHaveLength(23);
    for (const prefix of ['NEW-', 'X8-', 'REC-']) expect(added.some((id) => id.startsWith(prefix)), prefix).toBe(true);
  });

  it('matches the summary of parity-map.md', () => {
    const counts = new Map<string, number>();
    for (const row of mapRows.filter((item) => item.origin === 'checklist')) counts.set(row.target, (counts.get(row.target) ?? 0) + 1);
    expect(Object.fromEntries(counts)).toEqual({
      пилот: 595,
      'пилот + ChatSpace': 4,
      'пилот + Fansly': 6,
      Fansly: 67,
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
  it('is exactly what the map and the exceptions registry derive (node tools/parity/generate.ts)', () => {
    expect(read(MANIFEST_PATH)).toBe(serializeManifest(derived));
  });

  it('passes the gate checks', () => {
    const manifest = JSON.parse(read(MANIFEST_PATH)) as ParityManifest;
    expect(checkParityManifest(manifest, checklistIds(read('docs/parity/parity-checklist.md')), PARITY_EXCEPTIONS)).toEqual([]);
  });

  it('gives every removed and not-needed row a negative check owned by R02', () => {
    const removed = derived.rows.filter((row) => row.target === 'не нужно' || row.target === 'убрано владельцем');
    expect(removed).toHaveLength(86);
    for (const row of removed) {
      expect(row.check.kind, row.id).toBe('negative');
      expect(row.owner, row.id).toBe('R02');
    }
    expect(new Set(PARITY_EXCEPTIONS.flatMap((exception) => exception.rows)).size).toBe(86);
  });

  it('plans checks by module: unit for logic, e2e for the host, visual for surfaces, smoke for release', () => {
    expect(byId.get('AI-001')?.check).toEqual({ kind: 'unit' });
    expect(byId.get('UI-001')?.check).toEqual({ kind: 'e2e' });
    expect(byId.get('ST-001')?.check).toEqual({ kind: 'stand-visual' });
    expect(byId.get('UP-001')?.check).toEqual({ kind: 'manual-smoke' });
    expect(byId.get('X8-10')?.check).toEqual({ kind: 'manual-smoke' });
    expect(byId.get('UI-016')?.check).toEqual({ kind: 'e2e' });
    expect(byId.get('EX-009')?.check).toEqual({ kind: 'e2e' });
    expect(byId.get('AI-102')?.check).toEqual({ kind: 'negative', exception: 'NEG-HELP' });
    expect(byId.get('AI-032')?.check.kind).toBe('n/a');
    expect(byId.get('ST-108')?.check.kind).toBe('n/a');
    expect(byId.get('CS-001')).toMatchObject({ owner: 'R02', check: { kind: 'n/a' } });
  });

  it('takes the owner from the first package', () => {
    expect(byId.get('AI-001')?.owner).toBe('R11');
    expect(byId.get('X8-02')?.owner).toBe('R09');
    expect(byId.get('ST-108')?.owner).toBe('R12');
  });

  it('fails closed: a removed row without an exception or a module without a rule stops the derivation', () => {
    const removed = mapRows.find((row) => row.id === 'AI-101') as MapRow;
    expect(() => deriveManifest([removed], [])).toThrow(/AI-101: «убрано владельцем» row has no entry/);
    const odd: MapRow = { ...removed, id: 'ZZ-001', target: 'пилот', module: 'somewhere/else' };
    expect(() => deriveManifest([odd], [])).toThrow(/no check rule for module «somewhere\/else»/);
  });
});
