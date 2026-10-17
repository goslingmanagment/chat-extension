import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const workflow = readFileSync(new URL('../../.github/workflows/perf.yml', import.meta.url), 'utf8');
const ci = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');

describe('pnpm perf in CI (the §11 probe and the Fansly gate P16a)', () => {
  it('runs every night and by hand, never on a PR or a push; the nightly run only while CI is on the PC', () => {
    expect(workflow).toMatch(/^ {2}schedule:\n {4}(?:#.*\n {4})*- cron: '\d+ \d+ \* \* \*'$/m);
    expect(workflow).toMatch(/^ {2}workflow_dispatch:$/m);
    expect(workflow).not.toMatch(/^ {2}(push|pull_request|pull_request_target):/m);
    expect(workflow).toContain("if: github.event_name != 'schedule' || vars.CI_POOL == 'pc'");
    expect(workflow).toContain('runs-on: [self-hosted, ci-pc]');
    expect(workflow).toMatch(/^ {2}group: perf\n {2}cancel-in-progress: false$/m);
  });

  it('runs `pnpm perf` in the e2e container, cleans it up and keeps the evidence even when red', () => {
    expect(workflow).toContain('run: exec tools/ci/e2e-docker.sh perf\n');
    expect(workflow).toContain("CG_E2E_TIMING_SLACK: '3'");
    expect(workflow).toMatch(/- name: Remove the e2e container, if one is left\n {8}if: always\(\)\n {8}run: .*tools\/ci\/e2e-docker\.sh --remove-container/);
    const upload = workflow.slice(workflow.indexOf('- name: Upload reports, profiles and logs'));
    expect(upload).toContain('if: always()');
    for (const path of ['.cache/e2e/perf.json', '.cache/e2e/perf-fansly/gate', '.cache/wdio']) expect(upload).toContain(`            ${path}\n`);
  });

  it('is not in the CI of a PR or a push: no step there runs or uploads the perf probes', () => {
    expect(ci).not.toContain('perf-fansly');
    expect(ci).not.toMatch(/e2e-docker\.sh perf|pnpm perf$/m);
  });
});
