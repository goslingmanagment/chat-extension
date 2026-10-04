// The tab's side of client_health (architecture.md §9.6, §11): what our own
// code costs on this page, measured into fixed-bound histograms and handed to
// the background as deltas (`health.report`) — once a minute while there is
// something to say, when the host contract changes, and as the page goes
// away. No text and no ids of fans, chats or operations ever leave here: a
// mark's name stays in this module, only the number goes into a histogram.
//
// A metric is a start and an end. The UI marks only ends («painted», after
// the next frame); the starts are the tab's own moments — a route change, a
// person's action, the first chunk of a stream — kept here per metric.
//
// This is its own lazy chunk (`tab-health`), loaded once the dock is on
// screen: nothing of it is needed to draw anything.

import type { HostContractReport } from '@cg/contracts/host';
import type { PerfMetric, TabHealthReport } from '@cg/contracts/telemetry';
import type { UiAction, UiPaintMetric } from '@cg/contracts/vm';
import { TabHealthCollector } from '@cg/core/domain/telemetry';

/** How often a tab hands its window to the background. */
export const HEALTH_REPORT_MS = 60_000;
/** A paint that comes later than this after its start measures something else (a hidden tab, a slow network). */
const MARK_MAX_AGE_MS = 10_000;
/** First-chunk moments kept by operation; the oldest go. */
const FIRST_CHUNKS_KEPT = 16;

export interface TabHealthEnv {
  /** `health.report`; false — the background did not take it. */
  readonly send: (report: TabHealthReport) => Promise<boolean>;
  readonly contract: () => HostContractReport;
  /** Elements in our own roots (the footprint's `owned-estimate`, §9.6). */
  readonly domNodes: () => number;
  /** Epoch ms. */
  readonly now: () => number;
  /** High resolution, for durations. */
  readonly perfNow: () => number;
  readonly setInterval: (fn: () => void, ms: number) => unknown;
  readonly clearInterval: (handle: unknown) => void;
}

export interface TabHealth {
  /** The route changed: the dock is about to follow it (`routeToDockMs`). */
  routeChanged(): void;
  /** The person did something: a click or a key (`panelOpenMs`, `boardOpenMs`, `searchMs` start here). */
  action(action: UiAction['type'] | 'key', detail?: string): void;
  /** The first text of a stream arrived at this epoch ms (`firstChunkPaintMs`). */
  firstChunk(opId: string, at: number): void;
  /** RenderMarks.painted: the UI's end of a metric. */
  painted(metric: UiPaintMetric, mark: string): void;
  record(metric: PerfMetric, ms: number): void;
  count(name: string): void;
  /** Hands the window to the background now (a contract change, the page going away). */
  report(force?: boolean): void;
  dispose(): void;
}

export function startTabHealth(env: TabHealthEnv): TabHealth {
  const collector = new TabHealthCollector(env.now);
  /** Where each paint metric started (high-resolution ms). */
  const starts: Partial<Record<UiPaintMetric, number>> = {};
  const firstChunks = new Map<string, number>();
  let sending = false;

  const report = (force = false): void => {
    if (sending || (!force && collector.isEmpty())) return;
    sending = true;
    void env
      .send(collector.takeReport(env.contract(), { cachesKB: 0, domNodes: env.domNodes() }))
      .catch(() => false)
      .then(() => {
        sending = false;
      });
  };
  const timer = env.setInterval(() => report(), HEALTH_REPORT_MS);

  const end = (metric: UiPaintMetric): void => {
    const started = starts[metric];
    if (started === undefined) return;
    delete starts[metric];
    const ms = env.perfNow() - started;
    if (ms >= 0 && ms <= MARK_MAX_AGE_MS) collector.record(metric, ms);
  };

  return {
    routeChanged() {
      starts.routeToDockMs = env.perfNow();
    },
    action(action, detail) {
      const now = env.perfNow();
      if (action === 'Search') starts.searchMs = now;
      else if (action === 'Navigate' && detail === 'spenders') starts.boardOpenMs = now;
      // Whatever opens or fills a panel: a generation, a sheet, a window, a key of ours.
      if (action === 'key' || action === 'Generate' || action === 'Regenerate' || action === 'ShowAnalysis' || action === 'ShowRecap' || action === 'RefreshRecap' || action === 'Navigate') starts.panelOpenMs = now;
    },
    firstChunk(opId, at) {
      if (firstChunks.has(opId)) return;
      firstChunks.set(opId, at);
      if (firstChunks.size > FIRST_CHUNKS_KEPT) firstChunks.delete(firstChunks.keys().next().value ?? '');
    },
    painted(metric, mark) {
      if (metric !== 'firstChunkPaintMs') return end(metric);
      const at = firstChunks.get(mark);
      if (at === undefined) return;
      firstChunks.delete(mark);
      const ms = env.now() - at;
      if (ms >= 0 && ms <= MARK_MAX_AGE_MS) collector.record(metric, ms);
    },
    record: (metric, ms) => collector.record(metric, ms),
    count: (name) => collector.count(name),
    report,
    dispose() {
      env.clearInterval(timer);
      firstChunks.clear();
    },
  };
}
