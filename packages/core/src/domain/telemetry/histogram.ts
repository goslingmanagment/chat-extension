// Fixed-bound histograms of `client_health` (architecture.md §9.6, §11;
// NEW-03). Bounds and schemaVersion are the frozen PERF_METRICS ones; bucket
// i counts values ≤ bounds[i] (and > bounds[i-1]), the last bucket the values
// above the last bound. count/sum/max travel with the buckets; percentiles
// are the server's job (a mean of partial p95s means nothing). Histograms
// from tabs are merged bucket by bucket only when their bounds and version
// are exactly the fixed ones.

import { PERF_METRICS, type PerfHistogram, type PerfMetric } from '@cg/contracts/telemetry';

/** The bucket of `value` for these ascending bounds (binary search). */
export function bucketIndex(bounds: readonly number[], value: number): number {
  let low = 0;
  let high = bounds.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (value <= (bounds[mid] ?? Number.POSITIVE_INFINITY)) high = mid;
    else low = mid + 1;
  }
  return low;
}

export class Histogram {
  readonly bounds: readonly number[];
  readonly schemaVersion: number;
  private readonly counts: number[];
  private total = 0;
  private sumValue = 0;
  private maxValue = 0;

  constructor(readonly metric: PerfMetric) {
    const fixed = PERF_METRICS[metric];
    this.bounds = fixed.bounds;
    this.schemaVersion = fixed.schemaVersion;
    this.counts = new Array<number>(fixed.bounds.length + 1).fill(0);
  }

  /** Adds one measurement in ms; a negative or non-finite value is refused. */
  add(value: number): boolean {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return false;
    const index = bucketIndex(this.bounds, value);
    this.counts[index] = (this.counts[index] ?? 0) + 1;
    this.total += 1;
    this.sumValue += value;
    if (value > this.maxValue) this.maxValue = value;
    return true;
  }

  /** Merges a histogram of the same metric with the same fixed bounds and version; refuses anything else. */
  merge(other: PerfHistogram): boolean {
    if (other.metric !== this.metric || other.schemaVersion !== this.schemaVersion) return false;
    if (other.bounds.length !== this.bounds.length || other.bounds.some((bound, i) => bound !== this.bounds[i])) return false;
    if (other.counts.length !== this.counts.length) return false;
    if (other.counts.some((count) => !Number.isInteger(count) || count < 0)) return false;
    const sum = other.counts.reduce((a, b) => a + b, 0);
    if (sum !== other.count || !Number.isFinite(other.sum) || other.sum < 0 || !Number.isFinite(other.max) || other.max < 0) return false;
    other.counts.forEach((count, i) => {
      this.counts[i] = (this.counts[i] ?? 0) + count;
    });
    this.total += other.count;
    this.sumValue += other.sum;
    if (other.max > this.maxValue) this.maxValue = other.max;
    return true;
  }

  get count(): number {
    return this.total;
  }

  toWire(): PerfHistogram {
    return {
      metric: this.metric,
      unit: 'ms',
      schemaVersion: this.schemaVersion,
      bounds: [...this.bounds],
      counts: [...this.counts],
      count: this.total,
      // Rounded to µs: a long sum of floats must not drift into noise.
      sum: Math.round(this.sumValue * 1000) / 1000,
      max: this.maxValue,
    };
  }
}
