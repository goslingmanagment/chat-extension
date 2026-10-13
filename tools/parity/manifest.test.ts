import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { ParityException } from '../../packages/contracts/src/parity/exceptions.ts';
import { REPO_ROOT } from '../lib/paths.ts';
import { closeOnFansly, tagsOfTestFile, type TaggedFile } from './coverage-report.ts';
import type { ManifestRow, ParityManifest } from './derive.ts';
import { checklistIds, checkParityManifest, fanslyGateProblems, hubConfirmationProblems, manifestRequired, PILOT_PR } from './manifest.ts';
import type { HubConfirmation } from './matrix.ts';

const row = (overrides: Partial<ManifestRow> & Pick<ManifestRow, 'id'>): ManifestRow => ({
  function: 'f',
  target: 'пилот',
  module: 'core/x',
  packages: ['R11'],
  milestones: ['M2'],
  mark: null,
  chatspace: { owner: 'R11', check: { kind: 'unit' } },
  fansly: { owner: 'R20/P8b3', check: { kind: 'shared' } },
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

const PRS = ['P7e', 'P8b3', 'P8c', 'P10a', 'P11b', 'HF-10', 'P16c', 'P17'];

describe('parity manifest checks', () => {
  const ids = checklistIds('| AI-001 | Reply | … |\n| AI-101 | Help | … |\ntext\n| NEW-01 | not a checklist row |\n');

  it('reads checklist row ids (three digits)', () => {
    expect(ids).toEqual(['AI-001', 'AI-101']);
  });

  const sound = {
    rows: [
      row({ id: 'AI-001' }),
      row({
        id: 'AI-101',
        target: 'убрано владельцем',
        module: '—',
        packages: [],
        chatspace: { owner: 'R02', check: { kind: 'negative', exception: 'NEG-HELP' } },
        fansly: { owner: 'R20/P8c', check: { kind: 'negative', exception: 'NEG-HELP' } },
      }),
      row({ id: 'NEW-01', module: 'host-chatspace/insert', packages: ['R09', 'R10'], chatspace: { owner: 'R09', check: { kind: 'e2e' } }, fansly: { owner: 'R20/P7e', check: { kind: 'e2e', where: 'suite-fansly-insert' } } }),
      row({ id: 'AI-032', target: 'Fansly', packages: ['R20'], chatspace: { owner: 'R20', check: { kind: 'n/a', reason: 'строка только Fansly' } }, fansly: { owner: 'R20/P8c', check: { kind: 'e2e', where: 'suite-fansly-ai' } } }),
      row({ id: 'REC-01', fansly: { owner: 'R20/HF-10', check: { kind: 'hub', where: 'HF-10' } } }),
      row({ id: 'UI-034', fansly: { check: { kind: 'n/a', reason: 'не касается Fansly' } } }),
    ],
  };

  it('accepts a complete manifest', () => {
    expect(checkParityManifest(sound, ids, [exception()], PRS)).toEqual([]);
  });

  it('flags missing rows, owners, checks and reasons on either host', () => {
    const problems = checkParityManifest(
      {
        rows: [
          row({ id: 'AI-001', chatspace: { owner: 'Bob', check: { kind: 'n/a' } }, fansly: { owner: 'R20/P8b3', check: { kind: 'n/a' } } }),
          { id: 'AI-002', target: 'пилот', packages: [], chatspace: { owner: 'R01' } },
        ],
      },
      ids,
      [],
      PRS,
    );
    expect(problems).toEqual([
      'row 0 (AI-001) chatspace: owner must be a work package R00–R20',
      'row 0 (AI-001) chatspace: an n/a check needs a reason',
      'row 0 (AI-001) fansly: an n/a check needs a reason',
      'row 0 (AI-001) fansly: a row Fansly does not concern has no owner',
      'row 1 (AI-002) chatspace: check missing or of an unknown kind',
      'row 1 (AI-002) fansly: check missing or of an unknown kind',
      'AI-101: checklist row has no manifest row',
    ]);
  });

  it('takes the Fansly owner only from the PRs of the R20 plan, and its checks only from the matrix kinds', () => {
    const rows = [
      row({ id: 'AI-001', fansly: { owner: 'R20', check: { kind: 'shared' } } }),
      row({ id: 'AI-002', fansly: { owner: 'R20/P99', check: { kind: 'shared' } } }),
      row({ id: 'AI-003', fansly: { owner: 'R20/P8b3', check: { kind: 'manual-smoke' } } }),
      row({ id: 'AI-004', chatspace: { owner: 'R11', check: { kind: 'shared' } } }),
      row({ id: 'REC-01', fansly: { owner: 'R20/P8c', check: { kind: 'hub', where: 'HF-10' } } }),
    ];
    expect(checkParityManifest({ rows }, [], [], PRS)).toEqual([
      'row 0 (AI-001) fansly: owner must be a PR of the R20 plan (R20/<PR> of plan.md §2), not R20',
      'row 1 (AI-002) fansly: owner must be a PR of the R20 plan (R20/<PR> of plan.md §2), not R20/P99',
      'row 2 (AI-003) fansly: check missing or of an unknown kind',
      'row 3 (AI-004) chatspace: check missing or of an unknown kind',
      'row 4 (REC-01) fansly: the hub test is in HF-10, the owner is R20/P8c',
    ]);
  });

  it('requires a negative check from the registry for removed and not-needed rows, on Fansly too', () => {
    const removedAsUnit = { rows: [row({ id: 'AI-001' }), row({ id: 'AI-101', target: 'убрано владельцем', chatspace: { owner: 'R02', check: { kind: 'unit' } }, fansly: { owner: 'R20/P8c', check: { kind: 'shared' } } })] };
    expect(checkParityManifest(removedAsUnit, ids, [exception()], PRS)).toEqual([
      'row 1 (AI-101) chatspace: a «убрано владельцем» row needs a negative check from the exceptions registry',
      'row 1 (AI-101) fansly: a «убрано владельцем» row needs its negative check on Fansly too, or a place in §9 of parity-matrix.md',
    ]);

    const unknownException = {
      rows: [row({ id: 'AI-001' }), row({ id: 'AI-101', target: 'убрано владельцем', chatspace: { owner: 'R02', check: { kind: 'negative', exception: 'NEG-NOPE' } }, fansly: { check: { kind: 'n/a', reason: 'x' } } })],
    };
    expect(checkParityManifest(unknownException, ids, [exception()], PRS)).toEqual(['row 1 (AI-101) chatspace: negative check NEG-NOPE is not in the exceptions registry']);

    const wrongVerdict = exception({ verdict: 'не нужно' });
    expect(checkParityManifest(sound, ids, [wrongVerdict], PRS)).toEqual([
      'row 1 (AI-101) chatspace: NEG-HELP is «не нужно», the row is «убрано владельцем»',
      'row 1 (AI-101) fansly: NEG-HELP is «не нужно», the row is «убрано владельцем»',
      'exception NEG-HELP: AI-101 is «убрано владельцем», not «не нужно»',
    ]);
  });

  it('keeps the exceptions registry consistent with the rows', () => {
    const stray = exception({ id: 'NEG-STRAY', verdict: 'не нужно', rows: ['AI-001', 'ZZ-999'] });
    const double = exception({ id: 'NEG-AGAIN' });
    expect(checkParityManifest(sound, ids, [exception(), stray, double], PRS)).toEqual([
      'exception NEG-STRAY: AI-001 is «пилот», not «не нужно»',
      'exception NEG-STRAY: ZZ-999 is not a manifest row',
      'exception NEG-AGAIN: AI-101 is already covered by NEG-HELP',
    ]);
  });

  it('rejects a manifest that is not an object with rows', () => {
    expect(checkParityManifest([], ids, [], PRS)).toEqual(['parity manifest must be an object with a `rows` array']);
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

describe('the gate on Fansly: a row × its host × its level (plan.md §0, P1b)', () => {
  const real = JSON.parse(readFileSync(`${REPO_ROOT}docs/parity/parity-manifest.json`, 'utf8')) as ParityManifest;
  const realRow = (id: string): ManifestRow => real.rows.find((item) => item.id === id) as ManifestRow;
  const file = (path: string, tags: readonly string[], hosts: readonly string[] = []): TaggedFile => ({ path, tags, skipped: [], hosts });
  const gate = (rows: readonly ManifestRow[], files: readonly TaggedFile[], done: readonly string[], hub: readonly HubConfirmation[] = []): string[] =>
    fanslyGateProblems(rows, closeOnFansly(rows, files, hub), new Set(done));

  it('[NF-011] of suite-preview — a ChatSpace spec — does not close the Fansly row; a test on Fansly does', () => {
    const path = 'packages/testing/e2e/specs/suite-preview.e2e.ts';
    const preview: TaggedFile = { path, ...tagsOfTestFile(path, readFileSync(`${REPO_ROOT}${path}`, 'utf8')) };
    expect(preview.tags).toContain('NF-011');
    const nf011 = realRow('NF-011');
    expect(nf011.fansly).toEqual({ owner: 'R20/P10a', check: { kind: 'unit', where: 'hosts/fansly' } });
    expect(closeOnFansly([nf011], [preview], []).get('NF-011')).toEqual({ closed: false, by: [] });
    // Planned while P10a is not done; an error once it is marked done.
    expect(gate([nf011], [preview], [])).toEqual([]);
    expect(gate([nf011], [preview], ['P10a'])).toEqual(['NF-011: P10a is done (✓ in plan.md), but the row is open on Fansly — needs a test on Fansly (hosts/fansly) with [NF-011]']);
    const onFansly = file('packages/core/src/services/hosts/fansly/newcomers/open.test.ts', ['NF-011']);
    expect(gate([nf011], [preview, onFansly], ['P10a'])).toEqual([]);
  });

  it('a unit test does not close a row of the browser level; an e2e spec on the Fansly stand does', () => {
    const reply = realRow('AI-001');
    expect(reply.fansly.check).toEqual({ kind: 'e2e', where: 'suite-fansly-tail' });
    const unit = file('packages/host-fansly/src/main/tail.test.ts', ['AI-001']);
    const marked = file('packages/core/test/reply.test.ts', ['AI-001'], ['fansly']);
    expect(gate([reply], [unit, marked], ['P8b3'])).toEqual(['AI-001: P8b3 is done (✓ in plan.md), but the row is open on Fansly — needs a browser test on the Fansly stand (suite-fansly-tail) with [AI-001]']);
    const spec = file('packages/testing/e2e/specs/suite-fansly-tail.e2e.ts', ['AI-001']);
    expect(closeOnFansly([reply], [unit, spec], []).get('AI-001')).toEqual({ closed: true, by: ['packages/testing/e2e/specs/suite-fansly-tail.e2e.ts'] });
    expect(gate([reply], [unit, spec], ['P8b3'])).toEqual([]);
  });

  it('an owner exception passes: a negative row of a done PR needs no test, the registry proves it', () => {
    const help = realRow('AI-102');
    expect(help.fansly.check).toEqual({ kind: 'negative', exception: 'NEG-HELP' });
    const pr = (help.fansly.owner ?? '').replace('R20/', '');
    expect(closeOnFansly([help], [], []).get('AI-102')).toEqual({ closed: true, by: ['NEG-HELP'] });
    expect(gate([help], [], [pr, PILOT_PR])).toEqual([]);
  });

  it('a shared row is closed by a host-free test or a test on Fansly, never by a ChatSpace test', () => {
    const tones = row({ id: 'AI-002' });
    expect(gate([tones], [file('packages/host-chatspace/src/isolated/tones.test.ts', ['AI-002']), file('packages/testing/e2e/specs/suite-dock.e2e.ts', ['AI-002'])], ['P8b3'])).toHaveLength(1);
    expect(gate([tones], [file('packages/core/test/tones.test.ts', ['AI-002'])], ['P8b3'])).toEqual([]);
    expect(gate([tones], [file('packages/ui/src/hosts/fansly/tones.test.tsx', ['AI-002'])], ['P8b3'])).toEqual([]);
    // A test that marks ChatSpace alone is no longer host-free.
    expect(gate([tones], [file('packages/core/test/tones.test.ts', ['AI-002'], ['chatspace'])], ['P8b3'])).toHaveLength(1);
  });

  it('a unit row marked «метка fansly» needs the mark: a host-free test of shared code does not close it', () => {
    const metric = row({ id: 'NEW-03', fansly: { owner: 'R20/P8c', check: { kind: 'unit', where: 'метка fansly' } } });
    expect(gate([metric], [file('packages/platform/src/health.test.ts', ['NEW-03'])], ['P8c'])).toHaveLength(1);
    expect(gate([metric], [file('packages/platform/src/health.test.ts', ['NEW-03'], ['fansly'])], ['P8c'])).toEqual([]);
  });

  it('a hub row is closed only by the hub confirmation of its owner PR (§10 of the matrix), never by a test here', () => {
    const recap = row({ id: 'REC-01', fansly: { owner: 'R20/HF-10', check: { kind: 'hub', where: 'HF-10' } } });
    const here = file('packages/testing/e2e/specs/suite-fansly-ai.e2e.ts', ['REC-01']);
    expect(gate([recap], [here], ['HF-10'])).toEqual(['REC-01: HF-10 is done (✓ in plan.md), but the row is open on Fansly — needs the hub\'s confirmation in parity-matrix.md §10 (HF-10) with [REC-01]']);
    const confirmed: HubConfirmation = { id: 'REC-01', pr: 'HF-10', test: '`packages/ai/src/recap/context.test.ts` «[REC-01] one recap body for every chatter»', commit: '03012453ab' };
    expect(gate([recap], [], ['HF-10'], [confirmed])).toEqual([]);
    expect(closeOnFansly([recap], [], [{ ...confirmed, pr: 'HF-6' }]).get('REC-01')?.closed).toBe(false);
  });

  it('checks the shape of the hub confirmations: a row of kind hub, its owner, a test file with [ID], a commit', () => {
    const rows = [row({ id: 'REC-01', fansly: { owner: 'R20/HF-10', check: { kind: 'hub', where: 'HF-10' } } }), row({ id: 'AI-002' })];
    const good: HubConfirmation = { id: 'REC-01', pr: 'HF-10', test: '`apps/api/src/recap.test.ts` «[REC-01] one body»', commit: '0123abc' };
    expect(hubConfirmationProblems([good], rows)).toEqual([]);
    expect(
      hubConfirmationProblems(
        [
          { ...good, id: 'ZZ-001' },
          { ...good, id: 'AI-002' },
          { ...good, pr: 'HF-6' },
          { ...good, test: 'recap works' },
          { ...good, commit: 'main' },
        ],
        rows,
      ),
    ).toEqual([
      'parity-matrix.md §10 ZZ-001: no row of the manifest',
      'parity-matrix.md §10 AI-002: the row\'s check on Fansly is «shared», not «hub»',
      'parity-matrix.md §10 AI-002: the test must name the hub\'s test file (`….test.ts`) and a title with [AI-002]',
      'parity-matrix.md §10 REC-01: confirmed by HF-6, the owner is R20/HF-10',
      'parity-matrix.md §10 REC-01: the test must name the hub\'s test file (`….test.ts`) and a title with [REC-01]',
      'parity-matrix.md §10 REC-01: the commit must be 7–40 hex digits of the hub\'s main, not «main»',
    ]);
  });

  it('rows of PRs not done are planned, not errors; at the pilot no Fansly row is open but those after it', () => {
    const rows = [
      row({ id: 'AI-001', fansly: { owner: 'R20/P8b3', check: { kind: 'e2e', where: 'suite-fansly-tail' } } }),
      row({ id: 'HK-036', fansly: { owner: 'R20/P17', check: { kind: 'after-pilot' } } }),
      row({ id: 'UI-034', fansly: { check: { kind: 'n/a', reason: 'не касается Fansly' } } }),
    ];
    expect(gate(rows, [], [])).toEqual([]);
    expect(gate(rows, [], [PILOT_PR])).toEqual(['AI-001: open on Fansly at the pilot (P16c ✓) — P8b3 must close it: a browser test on the Fansly stand (suite-fansly-tail) with [AI-001]']);
    // After the pilot, its PR names the row's real check before it is done.
    expect(gate(rows, [], ['P17'])).toEqual(['HK-036: P17 is done (✓ in plan.md), but the row\'s check is still «после пилота» — name it in parity-matrix.md']);
  });
});
