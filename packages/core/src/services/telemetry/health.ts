// `client_health` in the background (architecture.md §9.6, H-11; NEW-03,
// DB-031). One 15-minute window: the background's own measurements and
// counters plus the tabs' deltas (`health.report`). Every 15 minutes while
// ChatSpace is open — the composition root drives `tick()` from an alarm,
// because an event page loses its timers — the window becomes a report in
// the telemetry queue and a new window starts. A change of the host
// contract sends the window early, at most once per 60 s. Nothing is
// measured or kept without consent, and nothing is built at all until
// bootstrap advertises `client-health-perf-v1`.

import { type CgCode } from '@cg/contracts/errors';
import { type HostContractReport } from '@cg/contracts/host';
import { TELEMETRY_LIMITS } from '@cg/contracts/limits';
import { type PerfMetric, type TabHealthReport } from '@cg/contracts/telemetry';

import { HealthWindow, hostSignature, hostSummary, type HealthClient, type HealthFootprint } from '../../domain/telemetry';
import { type Scheduler } from '../ports';
import { type QueueOutcome, type TelemetryEvent } from './queue';

export interface HealthReporterDeps {
  readonly scheduler: Scheduler;
  /** TelemetryQueue.add. */
  readonly submit: (event: TelemetryEvent) => QueueOutcome;
  readonly consent: () => boolean;
  /** Bootstrap advertises `client-health-perf-v1`. */
  readonly supported: () => boolean;
  /** At least one ChatSpace tab is registered. */
  readonly chatSpaceOpen: () => boolean;
  readonly client: () => HealthClient;
  /** Our caches and logs in the background (KiB, owned estimate). */
  readonly footprint: () => HealthFootprint;
  /** Flags and page features that are off. */
  readonly disabled: () => Iterable<string>;
}

export interface HealthReporterStats {
  readonly windowFrom: number;
  readonly lastSentAt: number | null;
  readonly sent: number;
  /** Windows that ended without a report (consent, support, no ChatSpace, nothing measured). */
  readonly skipped: number;
  readonly earlyPending: boolean;
}

export type HealthSendReason = 'window' | 'contract';

export class HealthReporter {
  private window: HealthWindow;
  private lastSentAt: number | null = null;
  private lastSignature: string | null = null;
  private sent = 0;
  private skipped = 0;
  private cancelEarly: (() => void) | null = null;

  constructor(private readonly deps: HealthReporterDeps) {
    this.window = new HealthWindow(deps.scheduler.now());
  }

  private on(): boolean {
    try {
      return this.deps.consent();
    } catch {
      return false;
    }
  }

  /** A background measurement (handlers only when sampled by the caller). */
  recordPerf(metric: PerfMetric, ms: number): void {
    if (this.on()) this.window.recordPerf(metric, ms);
  }

  count(name: string, by = 1): void {
    if (this.on()) this.window.count(name, by);
  }

  countCode(code: CgCode, by = 1): void {
    if (this.on()) this.window.countCode(code, by);
  }

  /** `health.report` from a tab: its deltas join the window; a changed contract sends early. */
  mergeTab(tabSessionId: string, report: TabHealthReport): void {
    if (!this.on()) return;
    this.window.mergeTab(tabSessionId, report);
    if (report.host !== null) this.onHost(report.host);
  }

  /** The host contract as a tab saw it (also without a report). */
  onHost(report: HostContractReport | null): void {
    if (!this.on()) return;
    this.window.setHost(report);
    const signature = hostSignature(hostSummary(report));
    if (this.lastSignature !== null && signature !== this.lastSignature) this.sendEarly();
    this.lastSignature ??= signature;
  }

  private sendEarly(): void {
    if (this.cancelEarly !== null) return;
    const now = this.deps.scheduler.now();
    const wait = this.lastSentAt === null ? 0 : Math.max(0, this.lastSentAt + TELEMETRY_LIMITS.healthMinIntervalMs - now);
    this.cancelEarly = this.deps.scheduler.after(wait, () => {
      this.cancelEarly = null;
      this.close('contract');
    });
  }

  /** The 15-minute alarm. Returns whether a report was queued. */
  tick(): boolean {
    return this.close('window');
  }

  private close(reason: HealthSendReason): boolean {
    const now = this.deps.scheduler.now();
    const window = this.window;
    this.window = new HealthWindow(now);
    const host = window.hostSummary;
    try {
      // A report names the contract even when nothing was measured; an empty window with no host says nothing.
      const ready = this.on() && this.deps.supported() && this.deps.chatSpaceOpen() && (!window.isEmpty() || host !== null || reason === 'contract');
      if (!ready) {
        this.skipped += 1;
        return false;
      }
      window.setDisabled(this.deps.disabled());
      const report = window.build(now, this.deps.client(), this.deps.footprint());
      const outcome = this.deps.submit(report);
      if (outcome !== 'queued') {
        this.skipped += 1;
        return false;
      }
      this.sent += 1;
      this.lastSentAt = now;
      if (host !== null) this.lastSignature = hostSignature(host);
      // The host stays known in the next window: the report always names the contract.
      if (host !== null) this.window.setHostSummary(host);
      return true;
    } catch {
      this.skipped += 1;
      return false;
    }
  }

  /** Consent revoked or signed out: what was measured goes at once. */
  reset(): void {
    if (this.cancelEarly !== null) {
      try {
        this.cancelEarly();
      } catch {
        // Already fired.
      }
      this.cancelEarly = null;
    }
    this.window = new HealthWindow(this.deps.scheduler.now());
  }

  stats(): HealthReporterStats {
    return { windowFrom: this.window.from, lastSentAt: this.lastSentAt, sent: this.sent, skipped: this.skipped, earlyPending: this.cancelEarly !== null };
  }

  /** The window as it stands, for the export (no ids, no text). */
  currentWindow(): HealthWindow {
    return this.window;
  }
}

/** The interval of the alarm that drives `tick()`. */
export const HEALTH_TICK_MS = TELEMETRY_LIMITS.healthWindowMs;
