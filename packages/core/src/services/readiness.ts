// The background readiness barrier (architecture.md §7 «Фон и выгрузка»,
// §12 п. 5; BG-004): the composition root registers every event handler
// synchronously at the top level of the event page, then starts the stores;
// all requests wait for ONE promise that settles when the start steps did.
//
// The barrier never hangs and never rejects: a failed or slow step is
// recorded and the barrier opens anyway — each service answers from its own
// degraded state (settings unreadable → read-only, journal unreadable →
// sends refused), which is better than a background that answers nothing.

import { NO_LOG, SYSTEM_CLOCK, type Clock, type ServiceLog, type Timers } from './storage/ports';

export interface ReadinessStep {
  readonly name: string;
  run(): Promise<unknown>;
}

export interface ReadinessStepReport {
  readonly name: string;
  readonly outcome: 'ok' | 'failed' | 'timeout';
  readonly ms: number;
}

export interface ReadinessReport {
  readonly steps: readonly ReadinessStepReport[];
  readonly ms: number;
}

export interface ReadinessBarrier {
  /** Created with the barrier, so the RPC can take it synchronously. */
  readonly ready: Promise<ReadinessReport>;
  isReady(): boolean;
  /** Runs the steps in order once; a second call returns the same promise. */
  start(steps: readonly ReadinessStep[]): Promise<ReadinessReport>;
}

export interface ReadinessOptions {
  readonly clock?: Clock;
  /** Per step; a step past it is recorded as `timeout` and the next one starts. */
  readonly stepTimeoutMs?: number;
  readonly log?: ServiceLog;
  /** Without timers there is no per-step timeout (core has no timer globals of its own). */
  readonly timers?: Timers;
}

export const READINESS_STEP_TIMEOUT_MS = 10_000;

export function createReadinessBarrier(options: ReadinessOptions = {}): ReadinessBarrier {
  const clock = options.clock ?? SYSTEM_CLOCK;
  const timeoutMs = options.stepTimeoutMs ?? READINESS_STEP_TIMEOUT_MS;
  const log = options.log ?? NO_LOG;
  const timers = options.timers;
  let open!: (report: ReadinessReport) => void;
  const ready = new Promise<ReadinessReport>((resolve) => (open = resolve));
  let started: Promise<ReadinessReport> | null = null;
  let isOpen = false;

  async function runStep(step: ReadinessStep): Promise<ReadinessStepReport> {
    const begin = clock.now();
    let timer: unknown = null;
    const racers: Promise<'ok' | 'timeout'>[] = [Promise.resolve().then(() => step.run()).then(() => 'ok' as const)];
    if (timers) racers.push(new Promise<'timeout'>((resolve) => (timer = timers.set(() => resolve('timeout'), timeoutMs))));
    let outcome: ReadinessStepReport['outcome'];
    try {
      outcome = await Promise.race(racers);
    } catch {
      outcome = 'failed';
    } finally {
      if (timer !== null) timers?.clear(timer);
    }
    const report = { name: step.name, outcome, ms: clock.now() - begin };
    if (outcome !== 'ok') log({ level: 'warn', scope: 'bg.ready', msg: 'start step did not finish', fields: { step: step.name, outcome, ms: report.ms } });
    return report;
  }

  return {
    ready,
    isReady: () => isOpen,
    start(steps) {
      started ??= (async () => {
        const begin = clock.now();
        const reports: ReadinessStepReport[] = [];
        for (const step of steps) reports.push(await runStep(step));
        const report: ReadinessReport = { steps: reports, ms: clock.now() - begin };
        isOpen = true;
        log({ level: 'info', scope: 'bg.ready', msg: 'background ready', fields: { steps: reports.length, ms: report.ms } });
        open(report);
        return report;
      })();
      return started;
    },
  };
}
