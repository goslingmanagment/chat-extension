// `client_health` aggregation (architecture.md §9.6, §11; H-11; NEW-03):
// one 15-minute window of fixed-bound histograms, counters by CG code, P1
// and safety counters, the host contract result and what is turned off,
// plus our own footprint as an estimate (never heap). Tabs measure and send
// deltas (`health.report`); the background merges them into its window. No
// text and no fan, chat or operation ids anywhere in it.
//
// The cost of measuring is bounded: handlers are sampled 1 in 20 (rare
// latency events are all kept by the caller), and each metric takes at most
// HEALTH_SAMPLES_PER_METRIC_MAX samples per window — the rest is counted in
// `perf.capped`, not recorded.

import { type CgCode } from '@cg/contracts/errors';
import { CG_P1_CODES } from '@cg/contracts/errors/registry';
import { ANCHOR_IDS, HOST_CAPABILITIES, type HostContractReport } from '@cg/contracts/host';
import { TELEMETRY_LIMITS } from '@cg/contracts/limits';
import {
  HEALTH_CODE_PATTERN,
  P1_COUNTERS,
  PERF_METRIC_NAMES,
  SAFETY_COUNTERS,
  type ClientHealthV1,
  type PerfMetric,
  type TabHealthReport,
} from '@cg/contracts/telemetry';

import { Histogram } from './histogram';

export const HEALTH_SAMPLES_PER_METRIC_MAX = 20_000;

/** P1 counters by the CG code that proves them (§0.4). */
const P1_BY_CODE: Readonly<Partial<Record<CgCode, (typeof P1_COUNTERS)[number]>>> = {
  'CG-INSERT-MISPLACED': 'p1.insert-misplaced',
};

export interface HealthClient {
  readonly version: string;
  readonly browserMajor: number;
  readonly os: ClientHealthV1['client']['os'];
}

export interface HealthFootprint {
  readonly cachesKB: number;
  readonly logsKB: number;
}

/** What the host contract says, in machine tokens. */
export interface HostSummary {
  readonly build: string | null;
  readonly contractOk: boolean;
  readonly missing: readonly string[];
  /** Capabilities not `on`: `<capability>:<state>`. */
  readonly degraded: readonly string[];
}

export function hostSummary(report: HostContractReport | null): HostSummary {
  if (report === null) return { build: null, contractOk: false, missing: ['no-report'], degraded: [] };
  const missing = ANCHOR_IDS.flatMap((anchor) => {
    const state = report.anchors[anchor];
    if (state === undefined || state === 'ok') return [];
    return [state === 'shape' ? `${anchor}:shape` : anchor];
  });
  const degraded = HOST_CAPABILITIES.flatMap((capability) => {
    const state = report.capabilities[capability];
    return state === undefined || state.state === 'on' ? [] : [`${capability}:${state.state}`];
  });
  return { build: report.build, contractOk: missing.length === 0, missing, degraded };
}

/** A stable fingerprint of the contract result: a change sends client_health early (≤ 1 per 60 s). */
export function hostSignature(summary: HostSummary): string {
  return [summary.build ?? '-', summary.contractOk ? 'ok' : 'broken', [...summary.missing].sort().join(','), [...summary.degraded].sort().join(',')].join('|');
}

function isHealthCode(name: string): boolean {
  return HEALTH_CODE_PATTERN.test(name);
}

function clampCounter(value: number): number {
  return Math.min(TELEMETRY_LIMITS.healthMaxCounterValue, Math.max(0, Math.floor(value)));
}

function boundedList(values: Iterable<string>): string[] {
  const out: string[] = [];
  for (const value of values) {
    if (!isHealthCode(value) || out.includes(value)) continue;
    out.push(value);
    if (out.length >= TELEMETRY_LIMITS.healthMaxListItems) break;
  }
  return out;
}

export class HealthWindow {
  private readonly perf = new Map<PerfMetric, Histogram>();
  private readonly counters = new Map<string, number>();
  private host: HostSummary | null = null;
  private disabled = new Set<string>();
  private domNodesMax = 0;
  private tabCachesKB = new Map<string, number>();
  private samples = 0;

  constructor(
    readonly from: number,
    private readonly maxSamplesPerMetric: number = HEALTH_SAMPLES_PER_METRIC_MAX,
  ) {}

  /** One measurement in ms (handlers: only the sampled ones). */
  recordPerf(metric: PerfMetric, ms: number): void {
    let histogram = this.perf.get(metric);
    if (histogram === undefined) {
      histogram = new Histogram(metric);
      this.perf.set(metric, histogram);
    }
    if (histogram.count >= this.maxSamplesPerMetric) {
      this.count('perf.capped');
      return;
    }
    if (histogram.add(ms)) this.samples += 1;
    else this.count('perf.invalid');
  }

  /** A named counter (`insert.prevented`, `p1.read-without-human`…); a name outside the health vocabulary is dropped and counted. */
  count(name: string, by = 1): void {
    if (!Number.isFinite(by) || by <= 0) return;
    const key = isHealthCode(name) ? name : 'health.bad-counter';
    this.counters.set(key, clampCounter((this.counters.get(key) ?? 0) + by));
  }

  /** An error by its code; a P1 code also moves its P1 counter. */
  countCode(code: CgCode, by = 1): void {
    this.count(code, by);
    const p1 = P1_BY_CODE[code];
    if (p1 !== undefined) this.count(p1, by);
    else if (CG_P1_CODES.includes(code)) this.count('p1.other', by);
  }

  setHost(report: HostContractReport | null): void {
    this.host = hostSummary(report);
  }

  /** Flags and features turned off (`flag:<name>`, a page feature…). */
  setDisabled(names: Iterable<string>): void {
    this.disabled = new Set(names);
  }

  /** A tab's deltas since its last report (`health.report`). */
  mergeTab(tabSessionId: string, report: TabHealthReport): void {
    for (const histogram of report.perf) {
      const own = this.perf.get(histogram.metric) ?? new Histogram(histogram.metric);
      if (own.merge(histogram)) {
        this.perf.set(histogram.metric, own);
        this.samples += histogram.count;
      } else this.count('perf.rejected');
    }
    for (const [name, value] of Object.entries(report.counters)) this.count(name, value);
    if (report.host !== null) this.setHost(report.host);
    this.domNodesMax = Math.max(this.domNodesMax, report.footprint.domNodes);
    this.tabCachesKB.set(tabSessionId, report.footprint.cachesKB);
  }

  get hostSummary(): HostSummary | null {
    return this.host;
  }

  /** Nothing measured and nothing counted. */
  isEmpty(): boolean {
    return this.samples === 0 && this.counters.size === 0;
  }

  /** Our caches in the tabs, as they last reported them. */
  get tabsCachesKB(): number {
    let sum = 0;
    for (const value of this.tabCachesKB.values()) sum += value;
    return sum;
  }

  build(to: number, client: HealthClient, footprint: HealthFootprint): ClientHealthV1 {
    const host = this.host ?? hostSummary(null);
    const counters: Record<string, number> = {};
    for (const name of [...P1_COUNTERS, ...SAFETY_COUNTERS]) counters[name] = this.counters.get(name) ?? 0;
    const all = new Map(this.counters);
    if (this.domNodesMax > 0) all.set('footprint.dom-nodes-max', clampCounter(this.domNodesMax));
    const rest = [...all.entries()]
      .filter(([name]) => !(name in counters))
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, TELEMETRY_LIMITS.healthMaxCounters - Object.keys(counters).length);
    for (const [name, value] of rest) counters[name] = value;
    const perf = PERF_METRIC_NAMES.flatMap((metric) => {
      const histogram = this.perf.get(metric);
      return histogram === undefined || histogram.count === 0 ? [] : [histogram.toWire()];
    }).slice(0, TELEMETRY_LIMITS.healthMaxPerf);
    return {
      kind: 'client_health',
      v: 1,
      window: { from: new Date(this.from).toISOString(), to: new Date(Math.max(to, this.from)).toISOString() },
      client: {
        name: 'chat-extension',
        version: client.version.slice(0, 32) || '0.0.0',
        browser: 'firefox',
        browserMajor: Math.max(1, Math.floor(client.browserMajor)),
        os: client.os,
      },
      host: { kind: 'chatspace', build: host.build === null ? null : host.build.slice(0, 80), contractOk: host.contractOk, missing: boundedList(host.missing) },
      disabled: boundedList([...host.degraded, ...this.disabled]),
      perf,
      counters,
      footprint: { kind: 'owned-estimate', cachesKB: Math.max(0, Math.round(footprint.cachesKB + this.tabsCachesKB)), logsKB: Math.max(0, Math.round(footprint.logsKB)) },
    };
  }

  /** A tab's report of this window's deltas (`health.report`). */
  toTabReport(to: number, host: HostContractReport | null, footprint: { readonly cachesKB: number; readonly domNodes: number }): TabHealthReport {
    const counters: Record<string, number> = {};
    for (const [name, value] of [...this.counters.entries()].slice(0, TELEMETRY_LIMITS.healthMaxCounters)) counters[name] = value;
    return {
      windowFrom: Math.max(0, Math.round(this.from)),
      windowTo: Math.max(0, Math.round(Math.max(to, this.from))),
      host,
      perf: PERF_METRIC_NAMES.flatMap((metric) => {
        const histogram = this.perf.get(metric);
        return histogram === undefined || histogram.count === 0 ? [] : [histogram.toWire()];
      }),
      counters,
      footprint: { cachesKB: Math.max(0, Math.round(footprint.cachesKB)), domNodes: Math.max(0, Math.round(footprint.domNodes)) },
    };
  }
}

/** Handlers are measured 1 in 20 (§9.6): every 20th call, the first one included. */
export class HandlerSampler {
  private calls = 0;

  constructor(private readonly rate: number = TELEMETRY_LIMITS.handlerSampleRate) {}

  sample(): boolean {
    const take = this.calls % Math.max(1, this.rate) === 0;
    this.calls += 1;
    return take;
  }
}
