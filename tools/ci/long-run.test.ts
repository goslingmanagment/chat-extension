import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const workflow = readFileSync(new URL('../../.github/workflows/long-run.yml', import.meta.url), 'utf8');

describe('P16b accelerated soak job', () => {
  it('is manual on the PC, defaults to one hour and budgets at most 150 minutes including setup', () => {
    expect(workflow).toMatch(/^ {2}workflow_dispatch:$/m);
    expect(workflow).not.toMatch(/^ {2}(push|pull_request|schedule):/m);
    expect(workflow).toContain('runs-on: [self-hosted, ci-pc]');
    const minutes = / {6}minutes:\n[\s\S]*? {8}default: (\d+)/.exec(workflow)?.[1];
    expect(Number(minutes)).toBe(60);
    const timeout = Number(/ {4}timeout-minutes: (\d+)/.exec(workflow)?.[1]);
    expect(timeout).toBeGreaterThanOrEqual(120);
    expect(timeout).toBeLessThanOrEqual(150);
  });

  it('runs the workflow validation without a browser and refuses durations above 120 minutes', () => {
    const validation = / {6}- name: Validate duration\n {8}run: \|\n([\s\S]*?)\n {6}- name:/.exec(workflow)?.[1]?.replace(/^ {10}/gm, '');
    expect(validation).toBeDefined();
    for (const [input, accepted] of [
      ['5', true], ['60', true], ['060', true], ['120', true],
      ['0', false], ['4', false], ['121', false], ['480', false], ['481', false], ['-1', false],
      ['', false], ['NaN', false], ['5.5', false], ['1e2', false], ['5; exit 0', false],
    ] as const) {
      const result = spawnSync('bash', ['-e', '-c', validation ?? 'exit 99'], {
        env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin', CG_LONG_RUN_MINUTES: input }, encoding: 'utf8',
      });
      expect(result.status, input).toBe(accepted ? 0 : 1);
    }
  });
});
