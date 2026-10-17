import { ANCHOR_IDS, HOST_CAPABILITIES, type HostContractReport } from '@cg/contracts/host';
import { AccountAdvancedSchema } from '@cg/contracts/diagnostics';
import { describe, expect, it } from 'vitest';

import { advancedAccountInfo } from './advanced';

function report(missing: readonly (typeof ANCHOR_IDS)[number][] = [], build: string | null = 'index-DEVowLko'): HostContractReport {
  return {
    build,
    adapterVersion: '1.0.0',
    checkedAt: Date.UTC(2026, 9, 17),
    anchors: Object.fromEntries(ANCHOR_IDS.map((id) => [id, missing.includes(id) ? 'missing' : 'ok'])),
    capabilities: Object.fromEntries(HOST_CAPABILITIES.map((c) => [c, { state: 'on' }])),
  } as HostContractReport;
}

describe('[DB-027] «Аккаунт → Дополнительно» (1.20.0)', () => {
  it('[DB-027] the key\'s display prefix (never the secret), each site\'s build and contract, the app line', () => {
    const info = advancedAccountInfo({
      token: { keyPrefix: 'agh_dev_Zx81kQ', issuedAt: '2026-10-01T10:00:00.000Z', expiresAt: null },
      hosts: [
        { host: 'chatspace', report: null },
        { host: 'chatspace', report: report() },
        { host: 'chatspace', report: report(['fansMap'], 'index-other') },
      ],
      version: '0.3.1',
      browserMajor: 158,
      os: 'macos',
    });
    expect(info).toEqual({
      signIn: { key: 'agh_dev_Zx81kQ…', issuedAt: '2026-10-01T10:00:00.000Z', expiresAt: null },
      hosts: [{ host: 'chatspace', build: 'index-DEVowLko', contractOk: true }],
      app: '0.3.1 · Firefox 158 · macos',
    });
    expect(AccountAdvancedSchema.safeParse(info).success).toBe(true);
  });

  it('[DB-027] signed in without a prefix, a broken contract, a site whose tab has not reported, an unknown browser', () => {
    const info = advancedAccountInfo({
      token: { keyPrefix: ' ', issuedAt: null, expiresAt: null },
      hosts: [
        { host: 'chatspace', report: report(['fansMap']) },
        { host: 'fansly-web', report: null },
      ],
      version: '0.3.1',
      browserMajor: null,
      os: 'other',
    });
    expect(info.signIn).toEqual({ key: null, issuedAt: null, expiresAt: null });
    expect(info.hosts).toEqual([
      { host: 'chatspace', build: 'index-DEVowLko', contractOk: false },
      { host: 'fansly-web', build: null, contractOk: null },
    ]);
    expect(info.app).toBe('0.3.1 · Firefox · other');
    expect(advancedAccountInfo({ token: null, hosts: [], version: '0.3.1', browserMajor: null, os: 'other' }).signIn).toBeNull();
  });
});
