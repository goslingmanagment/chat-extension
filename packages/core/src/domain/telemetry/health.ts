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
  PerfHistogramSchema,
  SAFETY_COUNTERS,
  type ClientHealthV1,
  type PerfHistogram,
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

/** A window as the background stores it (storage.session), so an unloaded event page does not lose it. Machine values only. */
export interface HealthWindowSnapshot {
  readonly v: 1;
  readonly from: number;
  readonly perf: readonly PerfHistogram[];
  readonly counters: Readonly<Record<string, number>>;
  readonly host: HostSummary | null;
  readonly disabled: readonly string[];
  readonly domNodesMax: number;
  readonly tabCachesKB: Readonly<Record<string, number>>;
}

const TAB_KEY = /^[A-Za-z0-9-]{1,64}$/;
const TABS_KEPT = 32;
const HOST_BUILD_MAX = 80;

function readHostSummary(value: unknown): HostSummary | null {
  if (value === null || typeof value !== 'object') return null;
  const raw = value as Partial<Record<keyof HostSummary, unknown>>;
  if (raw.build !== null && (typeof raw.build !== 'string' || raw.build.length > HOST_BUILD_MAX)) return null;
  if (typeof raw.contractOk !== 'boolean' || !Array.isArray(raw.missing) || !Array.isArray(raw.degraded)) return null;
  const strings = (list: unknown[]): string[] => boundedList(list.filter((item): item is string => typeof item === 'string'));
  return { build: raw.build ?? null, contractOk: raw.contractOk, missing: strings(raw.missing as unknown[]), degraded: strings(raw.degraded as unknown[]) };
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

  /** Carries a known contract result into a new window. */
  setHostSummary(summary: HostSummary): void {
    this.host = { ...summary, missing: [...summary.missing], degraded: [...summary.degraded] };
  }

  /** Flags and features turned off (`flag:<name>`, a page feature…). */
  setDisabled(names: Iterable<string>): void {
    this.disabled = new Set(names);
  }

  private mergeHistogram(histogram: PerfHistogram): void {
    const own = this.perf.get(histogram.metric) ?? new Histogram(histogram.metric);
    if (own.merge(histogram)) {
      this.perf.set(histogram.metric, own);
      this.samples += histogram.count;
    } else this.count('perf.rejected');
  }

  /** A tab's deltas since its last report (`health.report`). */
  mergeTab(tabSessionId: string, report: TabHealthReport): void {
    for (const histogram of report.perf) this.mergeHistogram(histogram);
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

  snapshot(): HealthWindowSnapshot {
    return {
      v: 1,
      from: this.from,
      perf: PERF_METRIC_NAMES.flatMap((metric) => {
        const histogram = this.perf.get(metric);
        return histogram === undefined || histogram.count === 0 ? [] : [histogram.toWire()];
      }),
      counters: Object.fromEntries(this.counters),
      host: this.host === null ? null : { ...this.host, missing: [...this.host.missing], degraded: [...this.host.degraded] },
      disabled: [...this.disabled],
      domNodesMax: this.domNodesMax,
      tabCachesKB: Object.fromEntries(this.tabCachesKB),
    };
  }

  /**
   * Adds a stored window to this one: histograms and counters add up, the
   * host and the tabs' caches of the snapshot replace these (absorb the
   * older first). Junk is skipped or counted as from a tab. Never throws.
   */
  absorb(value: unknown): void {
    if (value === null || typeof value !== 'object') return;
    const raw = value as Partial<Record<keyof HealthWindowSnapshot, unknown>>;
    if (Array.isArray(raw.perf)) {
      for (const item of raw.perf as unknown[]) {
        const parsed = PerfHistogramSchema.safeParse(item);
        if (parsed.success) this.mergeHistogram(parsed.data);
        else this.count('perf.rejected');
      }
    }
    if (raw.counters !== null && typeof raw.counters === 'object') {
      for (const [name, count] of Object.entries(raw.counters)) if (typeof count === 'number') this.count(name, count);
    }
    const host = readHostSummary(raw.host);
    if (host !== null) this.host = host;
    if (Array.isArray(raw.disabled)) {
      for (const name of boundedList((raw.disabled as unknown[]).filter((item): item is string => typeof item === 'string'))) this.disabled.add(name);
    }
    if (typeof raw.domNodesMax === 'number' && Number.isFinite(raw.domNodesMax) && raw.domNodesMax > 0) this.domNodesMax = Math.max(this.domNodesMax, Math.floor(raw.domNodesMax));
    if (raw.tabCachesKB !== null && typeof raw.tabCachesKB === 'object') {
      for (const [tab, kb] of Object.entries(raw.tabCachesKB).slice(0, TABS_KEPT)) {
        if (TAB_KEY.test(tab) && typeof kb === 'number' && Number.isFinite(kb) && kb >= 0) this.tabCachesKB.set(tab, kb);
      }
    }
  }

  /** A stored window back as it was, or null when the value is not one. */
  static fromSnapshot(value: unknown, maxSamplesPerMetric: number = HEALTH_SAMPLES_PER_METRIC_MAX): HealthWindow | null {
    if (value === null || typeof value !== 'object') return null;
    const raw = value as { v?: unknown; from?: unknown };
    if (raw.v !== 1 || typeof raw.from !== 'number' || !Number.isFinite(raw.from) || raw.from < 0) return null;
    const window = new HealthWindow(raw.from, maxSamplesPerMetric);
    window.absorb(value);
    return window;
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

/**
 * A tab's side of client_health: measures into its own window, samples
 * synchronous handlers 1 in 20, and hands the background its deltas
 * (`health.report`) — the window starts over after each report. No timers
 * here: the tab's composition root reports every minute and on pagehide.
 */
export class TabHealthCollector {
  private window: HealthWindow;
  private readonly sampler: HandlerSampler;

  constructor(
    private readonly now: () => number,
    rate: number = TELEMETRY_LIMITS.handlerSampleRate,
  ) {
    this.window = new HealthWindow(now());
    this.sampler = new HandlerSampler(rate);
  }

  /** Any non-handler metric, every time (rare latency events are all kept). */
  record(metric: PerfMetric, ms: number): void {
    this.window.recordPerf(metric, ms);
  }

  /** Runs a synchronous handler; every 20th run is timed into `handlerMs`. Exceptions pass through untouched. */
  handler<T>(fn: () => T): T {
    if (!this.sampler.sample()) return fn();
    const start = this.now();
    try {
      return fn();
    } finally {
      this.window.recordPerf('handlerMs', Math.max(0, this.now() - start));
    }
  }

  count(name: string, by = 1): void {
    this.window.count(name, by);
  }

  countCode(code: CgCode, by = 1): void {
    this.window.countCode(code, by);
  }

  /** Nothing to report since the last one. */
  isEmpty(): boolean {
    return this.window.isEmpty();
  }

  /** The deltas since the last report; the next window starts now. */
  takeReport(host: HostContractReport | null, footprint: { readonly cachesKB: number; readonly domNodes: number }): TabHealthReport {
    const to = this.now();
    const report = this.window.toTabReport(to, host, footprint);
    this.window = new HealthWindow(to);
    return report;
  }
}
