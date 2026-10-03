import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';

import { checklistIds, checkParityManifest, manifestRequired } from './manifest.ts';

describe('parity manifest', () => {
  const ids = checklistIds('| AI-001 | Reply | … |\n| EX-001 | MV3 | … |\ntext\n');

  it('reads checklist row ids', () => {
    expect(ids).toEqual(['AI-001', 'EX-001']);
  });

  it('accepts a complete manifest', () => {
    const rows = [
      { id: 'AI-001', owner: 'R11', check: 'core/domain/features reply.test.ts' },
      { id: 'EX-001', owner: 'R00', check: 'apps/extension/test/manifest.test.ts' },
    ];
    expect(checkParityManifest(rows, ids)).toEqual([]);
  });

  it('flags missing rows, owners and checks', () => {
    const problems = checkParityManifest([{ id: 'AI-001', owner: 'Bob', check: '' }], ids);
    expect(problems).toEqual(['row 0 (AI-001): owner must be a work package R00–R20', 'row 0 (AI-001): check missing', 'EX-001: checklist row has no manifest row']);
  });

  it('lets a missing manifest pass only while the contracts are the R00 scaffold', () => {
    expect(manifestRequired("export const CONTRACTS_VERSION = '0.0.0-r00';")).toBeNull();
    expect(manifestRequired("export const CONTRACTS_VERSION = '1.0.0';")).toBe('CONTRACTS_VERSION 1.0.0');
    expect(manifestRequired('export const SOMETHING_ELSE = 1;')).toMatch(/not found/);
    // The real contracts file keeps a version this gate can read.
    const contracts = readFileSync(new URL('../../packages/contracts/src/index.ts', import.meta.url), 'utf8');
    expect(manifestRequired(contracts) ?? 'still R00').not.toMatch(/not found/);
  });
});
