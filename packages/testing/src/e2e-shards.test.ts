// The parts of the e2e suite the CI job runs side by side (src/e2e-shards.ts): every spec file in exactly one part,
// the same parts from the same files, parts of about the same weight, and the weights kept fresh from CI logs.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { listSpecs, parseShard, planShards, readWeights, refreshWeights, shardSpecs, TIME_LINE, timesFromLog } from './e2e-shards';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SPECS = listSpecs();
const WEIGHTS = readWeights();

describe('the parts of the e2e suite', () => {
  it('reads «<part>/<parts>» and nothing else', () => {
    expect(parseShard('2/5')).toEqual({ part: 2, of: 5 });
    expect(parseShard(' 1/1 ')).toEqual({ part: 1, of: 1 });
    for (const text of ['', '0/5', '6/5', '2', '2/', '/5', 'a/b', '1/33', '02/5', '2/5/1', '-1/5']) {
      expect(() => parseShard(text), text).toThrow(/CG_E2E_SHARD/);
    }
  });

  it('puts every spec file of e2e/specs in exactly one part, for any count the job may ask', () => {
    expect(SPECS.length).toBeGreaterThan(8);
    expect(SPECS).toEqual([...SPECS].sort());
    for (let of = 1; of <= 8; of += 1) {
      const parts = Array.from({ length: of }, (_, index) => shardSpecs({ part: index + 1, of }));
      const all = parts.flat();
      expect(all.length, `${of} parts`).toBe(SPECS.length);
      expect(new Set(all).size, `${of} parts`).toBe(SPECS.length);
      expect([...all].sort(), `${of} parts`).toEqual(SPECS);
      for (const part of parts) {
        expect(part.length, `${of} parts`).toBeGreaterThan(0);
        // Inside a part the files run in name order, as the whole suite does.
        expect(part, `${of} parts`).toEqual([...part].sort());
      }
    }
    // One part is the whole suite.
    expect(shardSpecs({ part: 1, of: 1 })).toEqual(SPECS);
  });

  it('cuts the same parts from the same files and weights, whatever order they come in', () => {
    const plan = planShards(SPECS, WEIGHTS, 5);
    expect(planShards([...SPECS].reverse(), WEIGHTS, 5)).toEqual(plan);
    expect(planShards(SPECS, Object.fromEntries(Object.entries(WEIGHTS).reverse()), 5)).toEqual(plan);
  });

  it('gives parts of about the same weight: the heaviest file first, each to the lightest part (the lowest on a tie)', () => {
    expect(planShards(['a', 'b', 'c', 'd', 'e'], { a: 5, b: 4, c: 3, d: 3, e: 1 }, 2)).toEqual({
      parts: [
        ['a', 'd'],
        ['b', 'c', 'e'],
      ],
      seconds: [8, 8],
      unknownWeight: 3,
    });
    // On the real files: no part is much over an even share, nor under the one file it cannot split.
    for (const of of [3, 4, 5, 6]) {
      const plan = planShards(SPECS, WEIGHTS, of);
      const total = plan.seconds.reduce((sum, seconds) => sum + seconds, 0);
      const heaviestFile = Math.max(...SPECS.map((name) => WEIGHTS[name] ?? plan.unknownWeight));
      expect(Math.max(...plan.seconds), `${of} parts`).toBeLessThanOrEqual(Math.max(heaviestFile, total / of) * 1.1);
    }
  });

  it('weighs a file with no weight yet as the median of the known ones, and refuses more parts than files', () => {
    expect(planShards(['a', 'b', 'c', 'new'], { a: 10, b: 30, c: 20, gone: 500 }, 2)).toEqual({
      parts: [
        ['a', 'b'],
        ['c', 'new'],
      ],
      seconds: [40, 40],
      unknownWeight: 20,
    });
    expect(planShards(['x', 'y'], {}, 2).unknownWeight).toBe(1);
    expect(() => planShards(['a', 'b'], {}, 3)).toThrow(/a part would run nothing/);
    expect(() => planShards(['a'], {}, 0)).toThrow(/1\.\.32/);
  });

  it('takes new weights from CI logs: the median of the passed runs; unnamed files keep theirs, gone files lose theirs', () => {
    const log = [
      `e2e 1/5\te2e (headless Firefox in the pinned image, no network)\t2026-10-15T02:10:50.4Z ${TIME_LINE} a.e2e.ts 17.4 passed`,
      `e2e 1/5\te2e (headless Firefox in the pinned image, no network)\t2026-10-15T02:11:16.2Z ${TIME_LINE} b.e2e.ts 90.0 failed`,
      `${TIME_LINE} a.e2e.ts 19.6 passed`,
      `${TIME_LINE} a.e2e.ts 30 passed`,
      `${TIME_LINE} b.e2e.ts 26.2 passed`,
      `${TIME_LINE} c.e2e.ts 0.2 passed`,
      `${TIME_LINE} new.e2e.ts 12.6 passed`,
      `${TIME_LINE} gone.e2e.ts 40 passed`,
      `${TIME_LINE} d.e2e.ts 40 failed`,
    ].join('\n');
    const times = timesFromLog(log);
    expect(Object.fromEntries(times)).toEqual({ 'a.e2e.ts': [17.4, 19.6, 30], 'b.e2e.ts': [26.2], 'c.e2e.ts': [0.2], 'new.e2e.ts': [12.6], 'gone.e2e.ts': [40] });
    expect(refreshWeights(['a.e2e.ts', 'b.e2e.ts', 'c.e2e.ts', 'd.e2e.ts', 'e.e2e.ts', 'new.e2e.ts'], { 'a.e2e.ts': 5, 'd.e2e.ts': 33, 'gone.e2e.ts': 7 }, times)).toEqual({
      'a.e2e.ts': 20,
      'b.e2e.ts': 26,
      'c.e2e.ts': 1,
      'd.e2e.ts': 33,
      'new.e2e.ts': 13,
    });
  });

  it('as a command: prints the parts, and refuses to rewrite the weights from logs with no time lines in them', () => {
    const run = (args: string[], input = ''): { status: number | null; stdout: string; stderr: string } => {
      const result = spawnSync(process.execPath, ['packages/testing/src/e2e-shards.ts', ...args], { cwd: REPO_ROOT, input, encoding: 'utf8' });
      return { status: result.status, stdout: result.stdout, stderr: result.stderr };
    };
    const plan = run(['plan', '5']);
    expect(plan.status, plan.stderr).toBe(0);
    const lines = plan.stdout.trim().split('\n');
    expect(lines).toHaveLength(5);
    expect(lines[0]).toMatch(/^part 1\/5: ~\d+ s, \d+ files: \S+\.e2e\.ts/);

    // Nothing is written when the logs carry no time line.
    const refused = run(['weights'], 'no time lines here\n');
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain(`no «${TIME_LINE} <file> <seconds> passed» line on stdin`);
    expect(readWeights()).toEqual(WEIGHTS);
    expect(run(['nonsense']).stderr).toContain('usage: node packages/testing/src/e2e-shards.ts plan <parts> | weights < CI logs');
  });
});
