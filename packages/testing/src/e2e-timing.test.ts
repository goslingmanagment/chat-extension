import { afterEach, describe, expect, it, vi } from 'vitest';

import { budgetMs } from './e2e-timing';

afterEach(() => vi.unstubAllEnvs());

describe('e2e timing budgets', () => {
  it('keeps local budgets strict, even inside the local Docker runner with CI=true', () => {
    vi.stubEnv('CI', 'true');
    vi.stubEnv('CG_E2E_TIMING_SLACK', undefined);
    expect(budgetMs(0.1)).toBe(0.1);
    expect(budgetMs(16)).toBe(16);
  });

  it('uses the CI job’s explicit multiplier, including sub-millisecond budgets', () => {
    vi.stubEnv('CG_E2E_TIMING_SLACK', '3');
    expect(budgetMs(0.1)).toBeCloseTo(0.3);
    expect(budgetMs(16)).toBe(48);
  });

  it.each(['', 'no', 'NaN', 'Infinity', '0', '-1', '0.5'])('rejects an invalid multiplier %j instead of silently disabling the bound', (value) => {
    vi.stubEnv('CG_E2E_TIMING_SLACK', value);
    expect(() => budgetMs(1)).toThrow(/CG_E2E_TIMING_SLACK/);
  });
});
