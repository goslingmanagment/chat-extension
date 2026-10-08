// The host contract in the log (LG-016) without ChatSpace's start-up in it.
// A reload of the tab starts our script while ChatSpace is still booting:
// its stores (accounts, permissions, Mimic) fill one by one, and each step is
// a new contract result — broken, broken, broken, whole within a second. On
// the third live check (2026-10-08) one reload wrote CG-HOST-CONTRACT four
// times, three of them as warnings, and the export said «errors today:
// CG-HOST-CONTRACT ×4» about a contract that was whole a second later.
//
// So the results of the start-up are written as `starting` (info, no code:
// no error of the day, no warning) until ChatSpace has kept one result for
// CONTRACT_SETTLE_MS — and never longer than CONTRACT_SETTLE_MAX_MS from the
// start, so a contract that keeps changing is still judged. The settled result
// is written as `checked`: with CG-HOST-CONTRACT when it is still broken.
// Every change after that is `changed`, as before. The health report to the
// background («Статус», client_health) is not delayed: it always carries the
// contract as it is now.

import type { HostContractFacts, HostContractLogKind } from '@cg/core/domain/logging';

/** How long ChatSpace keeps one contract result before the start-up counts as over. */
export const CONTRACT_SETTLE_MS = 5000;
/** The start-up never lasts longer than this from the first result. */
export const CONTRACT_SETTLE_MAX_MS = 30_000;

export interface ContractLogClock {
  now(): number;
  setTimer(ms: number, fn: () => void): unknown;
  clearTimer(handle: unknown): void;
}

export interface ContractLog {
  /** A contract result: the first one, then each change. */
  report(facts: HostContractFacts): void;
  dispose(): void;
}

export function createContractLog(write: (facts: HostContractFacts, kind: HostContractLogKind) => void, clock: ContractLogClock): ContractLog {
  let started: number | null = null;
  let settled = false;
  let latest: HostContractFacts | null = null;
  let timer: unknown = null;
  let disposed = false;

  const settle = (): void => {
    timer = null;
    if (disposed || settled || latest === null) return;
    settled = true;
    write(latest, 'checked');
  };

  return {
    report(facts) {
      if (disposed) return;
      latest = facts;
      if (settled) {
        write(facts, 'changed');
        return;
      }
      started ??= clock.now();
      write(facts, 'starting');
      if (timer !== null) clock.clearTimer(timer);
      const left = Math.max(0, started + CONTRACT_SETTLE_MAX_MS - clock.now());
      timer = clock.setTimer(Math.min(CONTRACT_SETTLE_MS, left), settle);
    },
    dispose() {
      disposed = true;
      if (timer !== null) clock.clearTimer(timer);
      timer = null;
    },
  };
}
