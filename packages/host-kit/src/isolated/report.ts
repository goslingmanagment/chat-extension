// The host contract report as a host's port announces it (architecture.md
// §6.2): a host recomputes its report when an input changes and tells its
// listeners only when the report itself did.

import type { HostContractReport } from '@cg/contracts/host';

/** The same report but for `checkedAt`: whether listeners must hear about it. */
export function sameReport(a: HostContractReport, b: HostContractReport): boolean {
  return JSON.stringify({ ...a, checkedAt: 0 }) === JSON.stringify({ ...b, checkedAt: 0 });
}
