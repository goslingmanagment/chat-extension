import { FANSLY_CONTRACT, FanslyContractBlockSchema, FanslyContractReportSchema } from '@cg/contracts/fansly-host';
import { siteContractReport } from '@cg/contracts/fixtures';
import { HostContractReportSchema } from '@cg/contracts/host';
import { describe, expect, it } from 'vitest';

import { contractFactsOf } from '../../host-facts';

const report = FanslyContractReportSchema.parse(siteContractReport);
const block = report.extensions['fansly-web'];

describe('[host:fansly] [DB-031] contract facts by the expected set (P7h, FS-CTR-1)', () => {
  it('a complete report is green and carries its main.<hash> into the log', () => {
    expect(FanslyContractBlockSchema.safeParse(block).success).toBe(true);
    expect(contractFactsOf(report, FANSLY_CONTRACT)).toMatchObject({ ok: true, build: report.build, missing: [] });
  });

  it('without the site block the schema refuses it and the facts name every expected anchor as missing', () => {
    const absent = { ...report, extensions: {} };
    expect(FanslyContractReportSchema.safeParse(absent).success).toBe(false);
    expect(HostContractReportSchema.safeParse(absent).success).toBe(false);
    expect(contractFactsOf(absent, FANSLY_CONTRACT)).toMatchObject({ ok: false, missing: FANSLY_CONTRACT.anchors });
    expect(FanslyContractReportSchema.safeParse({ ...report, extensions: undefined }).success).toBe(false);
  });

  it.each(FANSLY_CONTRACT.anchors)('omitting %s is not green, including the switched vault anchor', (anchor) => {
    const incomplete = { ...block, anchors: Object.fromEntries(Object.entries(block.anchors).filter(([name]) => name !== anchor)) };
    expect(FanslyContractBlockSchema.safeParse(incomplete).success).toBe(false);
    const value = { ...report, extensions: { 'fansly-web': incomplete } };
    expect(FanslyContractReportSchema.safeParse(value).success).toBe(false);
    // Shared parsing is deliberately site-neutral; its readers must still reject the omission.
    const parsed = HostContractReportSchema.parse(value);
    expect(contractFactsOf(parsed, FANSLY_CONTRACT)).toMatchObject({ ok: false, missing: [anchor] });
  });

  it('an explicit vault state outside its page is valid; a core anchor missing or changed is a break', () => {
    const explicit = (anchor: string, state: 'missing' | 'shape' | 'notYet') => ({ ...report, extensions: { 'fansly-web': { ...block, anchors: { ...block.anchors, [anchor]: state } } } });
    expect(contractFactsOf(explicit('vaultUpload', 'missing'), FANSLY_CONTRACT)).toMatchObject({ ok: true, missing: ['vaultUpload'] });
    for (const state of ['missing', 'shape'] as const) expect(contractFactsOf(explicit('textarea', state), FANSLY_CONTRACT)).toMatchObject({ ok: false, missing: ['textarea'] });
    expect(contractFactsOf(explicit('textarea', 'notYet'), FANSLY_CONTRACT)).toMatchObject({ ok: true, notYet: ['textarea'] });
  });
});
