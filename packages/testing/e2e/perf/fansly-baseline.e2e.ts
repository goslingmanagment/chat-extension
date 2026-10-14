// R20 P3d: the baseline of the OLD Fansly extension on the Fansly stand —
// the perf scenario of e2e/perf/fansly/scenario.ts (architecture.md §11's
// shape, FS-PERF-1's window, plan.md §4's growth rounds) for one subject and
// one neighbour setting per run, in a fresh headless Firefox. NOT part of
// `pnpm e2e`. docs/project-unite/baseline.md holds the numbers and says how
// to build the old extension's test XPI and run the matrix («Как повторить»).
//
// The run is told what to measure by its environment:
//   CG_PERF_SUBJECT    none | old                     (default none)
//   CG_PERF_NEIGHBOR   off | after                    (default off)
//   CG_PERF_NOTES      button | always — the old extension's notes placement
//   CG_PERF_OLD_XPI    the old extension's test XPI (old-build/build.ts)
//   CG_PERF_WINDOW_MIN the window in minutes (default 10); CG_PERF_IDLE_SAMPLE_MIN — readings
//                      during the idle part (default none); CG_PERF_ROUNDS (default 3)
//   CG_PERF_RUN        a label for the evidence folder (default the time)
//   CG_PERF_EVIDENCE_DIR where the evidence goes (default .cache/e2e/perf-fansly/)
// It writes <evidence>/<run>/<subject>-<notes>-<neighbour>/report.json and the profiles beside it
// (e2e/perf/fansly/docker-run.sh runs one configuration in the pinned image and copies them out).

import { mkdirSync, writeFileSync } from 'node:fs';

import { expect } from '@wdio/globals';

import { DEFAULT_SCENARIO, FANSLY_PERF_EVIDENCE_DIR, runScenario, type NeighborSetting, type PerfSubject } from './fansly/scenario';
import { noneSubject } from './fansly/subject-none';
import { oldSubject, type NotesPlacement } from './fansly/subject-old';
import { fakeFansly } from '../support/fansly-stand';
import { fakeHub } from '../support/fake-hub';
import { standServer } from '../support/stand';

const env = (name: string, fallback: string): string => {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
};

const subjectName = env('CG_PERF_SUBJECT', 'none');
const neighbor = env('CG_PERF_NEIGHBOR', 'off') as NeighborSetting;
const notes = env('CG_PERF_NOTES', 'button') as NotesPlacement;
if (!['none', 'old'].includes(subjectName)) throw new Error(`CG_PERF_SUBJECT: none | old, not ${subjectName}`);
if (!['off', 'after'].includes(neighbor)) throw new Error(`CG_PERF_NEIGHBOR: off | after, not ${neighbor}`);
if (!['button', 'always'].includes(notes)) throw new Error(`CG_PERF_NOTES: button | always, not ${notes}`);

const run = env('CG_PERF_RUN', new Date().toISOString().replaceAll(':', '-'));
const label = subjectName === 'none' ? `none-${neighbor}` : `old-${notes}-${neighbor}`;
const evidenceRoot = env('CG_PERF_EVIDENCE_DIR', FANSLY_PERF_EVIDENCE_DIR);
const evidenceDir = `${evidenceRoot.endsWith('/') ? evidenceRoot : `${evidenceRoot}/`}${run}/${label}/`;

function subject(): PerfSubject {
  if (subjectName === 'none') return noneSubject();
  const xpi = process.env['CG_PERF_OLD_XPI'];
  if (xpi === undefined || xpi === '') throw new Error('CG_PERF_OLD_XPI: the old extension’s test XPI (e2e/perf/fansly/old-build/build.ts)');
  return oldSubject({ xpi, notes });
}

const windowMs = Number(env('CG_PERF_WINDOW_MIN', '10')) * 60_000;
const rounds = Number(env('CG_PERF_ROUNDS', String(DEFAULT_SCENARIO.rounds)));

describe(`R20 P3d — the Fansly perf scenario: ${label}`, function () {
  // On the suite, not in the test: WebdriverIO's own race timer reads the test's timeout before the test body runs.
  this.timeout(windowMs + rounds * 900_000 + 900_000);

  before(async () => {
    await standServer.reset();
    await fakeFansly().command({ op: 'reset' });
    await fakeHub().command({ op: 'reset' });
  });

  it(`[FS-PERF-5] ${label}: open, ${String(DEFAULT_SCENARIO.switches)} switches, typing, the idle window, growth rounds`, async () => {
    mkdirSync(evidenceDir, { recursive: true });
    const report = await runScenario(subject(), {
      ...DEFAULT_SCENARIO,
      neighbor,
      windowMs,
      rounds,
      idleSampleMs: Number(env('CG_PERF_IDLE_SAMPLE_MIN', '0')) * 60_000,
      evidenceDir,
    });
    const text = `${JSON.stringify({ run, label, ...report }, null, 2)}\n`;
    writeFileSync(`${evidenceDir}report.json`, text);
    process.stdout.write(`perf-fansly (${evidenceDir}report.json) written\n`);
    // Talks to the stand only: nothing reached the egress sink, the browser's every way out.
    expect(report.egress).toEqual([]);
  });
});
