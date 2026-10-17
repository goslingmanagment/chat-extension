// «Аккаунт → Дополнительно» of the options page in debug mode (DB-027; 1.20.0, decision X47): what the background
// answers `account.advanced` with. Background only: it reads the hub's token metadata and the tabs' contract reports.

import { type AccountAdvanced } from '@cg/contracts/diagnostics';
import { type HostContractReport } from '@cg/contracts/host';
import { type HostKind } from '@cg/contracts/hosts';

import { hostSummary } from '../../domain/telemetry/health';

/**
 * DB-027 «Аккаунт → Дополнительно» (1.20.0, decision X47): the sign-in of this device by the hub's display prefix of its
 * key — never a part of the secret: the tail stays inside the hub layer —, «Поток» (each site with a tab: its build
 * and whether its contract is whole, the first report of the site) and «Приложение» (version · browser · OS).
 */
export function advancedAccountInfo(facts: {
  readonly token: { readonly keyPrefix: string; readonly issuedAt: string | null; readonly expiresAt: string | null } | null;
  readonly hosts: readonly { readonly host: HostKind; readonly report: HostContractReport | null }[];
  readonly version: string;
  readonly browserMajor: number | null;
  readonly os: string;
}): AccountAdvanced {
  const hosts: { host: HostKind; build: string | null; contractOk: boolean | null }[] = [];
  for (const { host, report } of facts.hosts) {
    const known = hosts.find((entry) => entry.host === host);
    // A tab of the site that has reported wins over one that has not yet.
    if (known !== undefined && (known.build !== null || report === null)) continue;
    const summary = report === null ? null : hostSummary(report);
    const entry = { host, build: summary?.build ?? null, contractOk: summary === null ? null : summary.contractOk };
    if (known === undefined) hosts.push(entry);
    else hosts.splice(hosts.indexOf(known), 1, entry);
  }
  const key = facts.token === null || facts.token.keyPrefix.trim() === '' ? null : `${facts.token.keyPrefix.slice(0, 79)}…`;
  return {
    signIn: facts.token === null ? null : { key, issuedAt: facts.token.issuedAt, expiresAt: facts.token.expiresAt },
    hosts: hosts.slice(0, 8),
    app: [facts.version, facts.browserMajor === null ? 'Firefox' : `Firefox ${facts.browserMajor}`, facts.os].join(' · ').slice(0, 160),
  };
}
