import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { ParityException } from '../../packages/contracts/src/parity/exceptions.ts';
import type { ManifestRow } from './derive.ts';
import { checklistIds, checkParityManifest, manifestRequired } from './manifest.ts';

const row = (overrides: Partial<ManifestRow> & Pick<ManifestRow, 'id'>): ManifestRow => ({
  function: 'f',
  target: 'пилот',
  module: 'core/x',
  packages: ['R11'],
  owner: 'R11',
  milestones: ['M2'],
  mark: null,
  check: { kind: 'unit' },
  ...overrides,
});

const exception = (overrides: Partial<ParityException> = {}): ParityException => ({
  id: 'NEG-HELP',
  verdict: 'убрано владельцем',
  source: 'Б3',
  reason: 'Help убран.',
  check: { kind: 'e2e', proves: 'Help нет.' },
  rows: ['AI-101'],
  ...overrides,
});

describe('parity manifest checks', () => {
  const ids = checklistIds('| AI-001 | Reply | … |\n| AI-101 | Help | … |\ntext\n| NEW-01 | not a checklist row |\n');

  it('reads checklist row ids (three digits)', () => {
    expect(ids).toEqual(['AI-001', 'AI-101']);
  });

  const sound = {
    rows: [
      row({ id: 'AI-001' }),
      row({ id: 'AI-101', target: 'убрано владельцем', module: '—', packages: [], owner: 'R02', check: { kind: 'negative', exception: 'NEG-HELP' } }),
      row({ id: 'NEW-01', module: 'host-chatspace/insert', packages: ['R09', 'R10'], owner: 'R09', check: { kind: 'e2e' } }),
      row({ id: 'AI-032', target: 'Fansly', packages: ['R20'], owner: 'R20', check: { kind: 'n/a', reason: 'фаза Fansly' } }),
    ],
  };

  it('accepts a complete manifest', () => {
    expect(checkParityManifest(sound, ids, [exception()])).toEqual([]);
  });

  it('flags missing rows, owners, checks and reasons', () => {
    const problems = checkParityManifest(
      { rows: [row({ id: 'AI-001', owner: 'Bob', check: { kind: 'n/a' } }), { id: 'AI-002', target: 'пилот', packages: [], owner: 'R01' }] },
      ids,
      [],
    );
    expect(problems).toEqual([
      'row 0 (AI-001): owner must be a work package R00–R20',
      'row 0 (AI-001): an n/a check needs a reason',
      'row 1 (AI-002): check missing or of an unknown kind',
      'AI-101: checklist row has no manifest row',
    ]);
  });

  it('requires a negative check from the registry for removed and not-needed rows', () => {
    const removedAsUnit = { rows: [row({ id: 'AI-001' }), row({ id: 'AI-101', target: 'убрано владельцем', owner: 'R02' })] };
    expect(checkParityManifest(removedAsUnit, ids, [exception()])).toEqual(['row 1 (AI-101): a «убрано владельцем» row needs a negative check from the exceptions registry']);

    const unknownException = { rows: [row({ id: 'AI-001' }), row({ id: 'AI-101', target: 'убрано владельцем', owner: 'R02', check: { kind: 'negative', exception: 'NEG-NOPE' } })] };
    expect(checkParityManifest(unknownException, ids, [exception()])).toEqual(['row 1 (AI-101): negative check NEG-NOPE is not in the exceptions registry']);

    const wrongVerdict = exception({ verdict: 'не нужно' });
    expect(checkParityManifest(sound, ids, [wrongVerdict])).toEqual([
      'row 1 (AI-101): NEG-HELP is «не нужно», the row is «убрано владельцем»',
      'exception NEG-HELP: AI-101 is «убрано владельцем», not «не нужно»',
    ]);
  });

  it('keeps the exceptions registry consistent with the rows', () => {
    const stray = exception({ id: 'NEG-STRAY', verdict: 'не нужно', rows: ['AI-001', 'ZZ-999'] });
    const double = exception({ id: 'NEG-AGAIN' });
    expect(checkParityManifest(sound, ids, [exception(), stray, double])).toEqual([
      'exception NEG-STRAY: AI-001 is «пилот», not «не нужно»',
      'exception NEG-STRAY: ZZ-999 is not a manifest row',
      'exception NEG-AGAIN: AI-101 is already covered by NEG-HELP',
    ]);
  });

  it('rejects a manifest that is not an object with rows', () => {
    expect(checkParityManifest([], ids, [])).toEqual(['parity manifest must be an object with a `rows` array']);
  });

  it('lets a missing manifest pass only while the contracts are the R00 scaffold', () => {
    expect(manifestRequired("export const CONTRACTS_VERSION = '0.0.0-r00';")).toBeNull();
    expect(manifestRequired("export const CONTRACTS_VERSION = '1.0.0';")).toBe('CONTRACTS_VERSION 1.0.0');
    expect(manifestRequired('export const SOMETHING_ELSE = 1;')).toMatch(/not found/);
    // The real contracts are frozen (R01), so the manifest is required.
    const contracts = readFileSync(new URL('../../packages/contracts/src/index.ts', import.meta.url), 'utf8');
    expect(manifestRequired(contracts)).toMatch(/^CONTRACTS_VERSION \d+\.\d+\.\d+$/);
  });
});
