// P16a. Limits and the P3d comparison live together; no bundle byte inventory here.
// Historical numbers: docs/project-unite/baseline.md, §4 table (2.12.0, Firefox 156).
// CPU/typing compare overhead against a fresh base on THIS runner: the old absolute
// Mac CPU numbers are not a calibration of the PC. Memory and counts never get slack.
import type { ScenarioReport, NeighborSetting } from '../../e2e/perf/fansly/scenario';
import type { MemoryReading } from '../../e2e/perf/fansly/memory';
import type { Shard } from '../e2e-shards';
import { budgetMs } from '../e2e-timing';
import type { ThreadSummary } from './gecko-profile';

export const FANSLY_PERF_SPEC = './perf/fansly-perf-probe.e2e.ts';
export const FANSLY_PERF_LIMITS = { tabMB: 15, backgroundMB: 30, growthMB: 5, typingDeltaMs: 5, backgroundCpuMs: 500 } as const;
export const P3D = {
  // Worst of the two notes placements. The typing base varied by 1.5 ms in P3d.
  after: { tabMB: 6.4, backgroundMB: 50.8, tabTimers: 328, backgroundTimers: 7, tabCpuDeltaMs: 260 - 167, backgroundCpuMs: 1018, typingDeltaMs: 1.9, awakeDelta: 886 - 343, backgroundAwake: 10_532 },
  off: { tabMB: 6.7, backgroundMB: 50.7, tabTimers: 328, backgroundTimers: 7, tabCpuDeltaMs: 238 - 65, backgroundCpuMs: 2063, typingDeltaMs: 2.5, awakeDelta: 724 - 237, backgroundAwake: 10_521 },
} as const;

/** Only the first part runs the probe, with both neighbours, as does pnpm perf. */
export function perfNeighbors(shard: Shard | null): NeighborSetting[] {
  return shard === null || shard.part === 1 ? ['off', 'after'] : [];
}

export interface PerfCheck { readonly name: string; readonly actual: number; readonly limit: number; readonly pass: boolean }
export function ceiling(name: string, actual: number, limit: number): PerfCheck {
  return { name, actual, limit, pass: Number.isFinite(actual) && actual <= limit };
}
export const tabMB = (shot: MemoryReading | undefined): number => (shot?.tab?.explicit ?? NaN) / 1024 ** 2;
/** Count every site's processes once, including multiple processes of the same site. */
export function contentProfileMB(readings: readonly MemoryReading[]): number {
  const byPid = new Map<number, number>();
  for (const shot of readings) {
    const processes = shot.siteProcesses ?? (shot.tab === null ? [] : [shot.tab]);
    if (processes.length === 0) return NaN;
    for (const proc of processes) {
      if (!(proc.pid > 0 && proc.explicit > 0 && Number.isFinite(proc.explicit))) return NaN;
      byPid.set(proc.pid, Math.max(byPid.get(proc.pid) ?? 0, proc.explicit));
    }
  }
  return [...byPid.values()].reduce((a, b) => a + b, 0) / 1024 ** 2;
}
export function backgroundMB(shot: MemoryReading | undefined): number {
  const documents = Object.entries(shot?.extension?.documents ?? {}).filter(([page]) => page.includes('background'));
  return documents.length === 0 ? NaN : documents.reduce((sum, [, bytes]) => sum + bytes, 0) / 1024 ** 2;
}

/** Only the shared 10 s keepalive, its 200 ms presence coalescer and 60 s health report.
 * Require both the file and interval: a new 500 ms DOM poll in tab-app must fail.
 * Firefox prints intervals as e.g. 9999 ms, one below the requested value.
 */
export function unexpectedTabTimers(thread: ThreadSummary | null): Readonly<Record<string, number>> {
  return Object.fromEntries(Object.entries(thread?.addonTimers ?? {}).filter(([handler]) => {
    const interval = Number(/interval (\d+)ms/.exec(handler)?.[1]);
    const runtime = /(?:fansly\.js|lazy\/fansly\/tab-app\.js):/.test(handler);
    const health = /lazy\/fansly\/tab-health\.js:/.test(handler);
    return !((runtime && ((interval >= 9990 && interval <= 10_010) || (interval >= 190 && interval <= 210))) || (health && interval >= 59_990 && interval <= 60_010));
  }));
}

const sum = (counts: Readonly<Record<string, number>>): number => Object.values(counts).reduce((a, b) => a + b, 0);
export function idleChecks(thread: ThreadSummary | null, label: string): PerfCheck[] {
  return [ceiling(`${label}: profiler main thread present`, thread !== null && thread.samples > 0 ? 0 : NaN, 0), ceiling(`${label}: undocumented observation timers`, sum(unexpectedTabTimers(thread)), 0)];
}

export function scenarioChecks(base: ScenarioReport, current: ScenarioReport): PerfCheck[] {
  const old = P3D[current.neighbor];
  const checks: PerfCheck[] = [ceiling('same neighbour as the base', base.neighbor === current.neighbor ? 0 : NaN, 0)];
  for (const label of ['opened', 'worked', 'window']) {
    checks.push(ceiling(`${label}: tab overhead MB`, tabMB(current.readings[label]) - tabMB(base.readings[label]), FANSLY_PERF_LIMITS.tabMB));
    checks.push(ceiling(`${label}: background document MB`, backgroundMB(current.readings[label]), FANSLY_PERF_LIMITS.backgroundMB));
  }
  checks.push(ceiling('window: at least 10 minutes', 600_000 - (current.readings['window']?.at ?? NaN), 0));
  checks.push(ceiling('three complete growth rounds', current.roundReadings.length === 3 && base.roundReadings.length === 3 ? 0 : NaN, 0));
  for (const [index, shot] of current.roundReadings.entries()) {
    checks.push(ceiling(`round ${index + 1}: background document MB`, backgroundMB(shot), FANSLY_PERF_LIMITS.backgroundMB));
    // Round one loads the overlays and warms the caches, just as in P3d.
    if (index === 0) continue;
    const growth = tabMB(shot) - tabMB(current.roundReadings[index - 1]);
    const baseGrowth = tabMB(base.roundReadings[index]) - tabMB(base.roundReadings[index - 1]);
    checks.push(ceiling(`round ${index + 1}: growth over the same base MB`, growth - baseGrowth, FANSLY_PERF_LIMITS.growthMB));
  }
  checks.push(ceiling('growth workload', current.options.roundSwitches === 100 && current.options.roundOverlays === 20 ? 0 : NaN, 0));
  checks.push(ceiling('typing: every key measured', current.typing.plain.keys >= current.options.textLength && base.typing.plain.keys >= base.options.textLength ? 0 : NaN, 0));
  // P3d's noise allowance is still tighter than the owner's base + 5 ms bound.
  checks.push(ceiling('typing: p95 overhead ms vs P3d', current.typing.plain.handled.p95 - base.typing.plain.handled.p95, budgetMs(Math.min(FANSLY_PERF_LIMITS.typingDeltaMs, old.typingDeltaMs + 1.5))));
  checks.push(ceiling('idle: full minute', current.idle.ms === 60_000 && base.idle.ms === 60_000 ? 0 : NaN, 0));
  checks.push(ceiling('idle: CPU readings present', [current.idle.tabCpuMs, current.idle.extensionCpuMs, base.idle.tabCpuMs].every((ms) => Number.isFinite(ms) && ms >= 0) ? 0 : NaN, 0));
  checks.push(ceiling('idle: tab CPU overhead ms vs P3d', current.idle.tabCpuMs - base.idle.tabCpuMs, budgetMs(old.tabCpuDeltaMs)));
  checks.push(ceiling('idle: background CPU ms (P3d was > 800)', current.idle.extensionCpuMs, budgetMs(FANSLY_PERF_LIMITS.backgroundCpuMs)));
  const tab = current.idle.profile?.tab ?? null;
  const extension = current.idle.profile?.extension ?? null;
  checks.push(...idleChecks(tab, 'idle tab'));
  checks.push(ceiling('idle: fewer tab timers than P3d', tab === null ? NaN : sum(tab.addonTimers), old.tabTimers - 1));
  checks.push(ceiling('idle: background profile present', extension !== null && extension.samples > 0 ? 0 : NaN, 0));
  const baseThread = base.idle.profile?.tab ?? null;
  checks.push(ceiling('idle: tab wakeups over base vs P3d', tab === null || baseThread === null ? NaN : (tab.markers['Awake'] ?? 0) - (baseThread.markers['Awake'] ?? 0), old.awakeDelta));
  checks.push(ceiling('idle: fewer background wakeups than P3d', extension === null ? NaN : (extension.markers['Awake'] ?? 0), old.backgroundAwake - 1));
  checks.push(ceiling('idle: traffic delivered', current.idle.traffic.failed, 0));
  checks.push(ceiling('idle: traffic exercised', current.idle.traffic.messages > 0 ? 0 : NaN, 0));
  checks.push(ceiling('Fansly request violations', current.calls.fanslyViolations, 0));
  checks.push(ceiling('non-loopback requests', current.egress.length + base.egress.length, 0));
  const samples = current.subjectStateWindow['routeToDockMs'];
  const times = Array.isArray(samples) ? samples.filter((n): n is number => typeof n === 'number' && Number.isFinite(n)) : [];
  checks.push(ceiling('route to dock: at least 20 samples', times.length >= 20 ? 0 : NaN, 0));
  const sorted = [...times].sort((a, b) => a - b);
  checks.push(ceiling('route to dock: p95 ms', sorted[Math.ceil(sorted.length * 0.95) - 1] ?? NaN, budgetMs(process.platform === 'darwin' ? 30 : 50)));
  return checks;
}
