import type { HostContractReport } from '@cg/contracts/host';
import { SAMPLE_CONTRACT_REPORT, siteContractReport } from '@cg/contracts/fixtures';
import { describe, expect, it } from 'vitest';

import { sameReport } from './report';

describe('the host contract report as a port announces it (§6.2)', () => {
  it('a report equal but for the time is the same report — whatever the site’s shape of it', () => {
    for (const report of [SAMPLE_CONTRACT_REPORT, siteContractReport] as readonly HostContractReport[]) {
      expect(sameReport(report, { ...report, checkedAt: report.checkedAt + 99 })).toBe(true);
      expect(sameReport(report, { ...report, capabilities: { ...report.capabilities, identity: { state: 'off', reason: 'platformAccountId' } } })).toBe(false);
      expect(sameReport(report, { ...report, build: null })).toBe(false);
    }
    expect(sameReport(SAMPLE_CONTRACT_REPORT, { ...SAMPLE_CONTRACT_REPORT, anchors: { ...SAMPLE_CONTRACT_REPORT.anchors, theme: 'missing' } })).toBe(false);
    expect(sameReport(SAMPLE_CONTRACT_REPORT, siteContractReport)).toBe(false);
  });
});
