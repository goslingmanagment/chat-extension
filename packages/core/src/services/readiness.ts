// The background readiness barrier (architecture.md §7 «Фон и выгрузка»,
// §12 п. 5; BG-004): the composition root registers every event handler
// synchronously at the top level of the event page, then starts the stores;
// all requests wait for ONE promise that settles when the start steps did.
//
// The barrier never hangs and never rejects:
// - each step runs at most `stepTimeoutMs` before the next one starts (a
//   failed or slow step is recorded; the slow one keeps running);
// - the whole barrier opens by `deadlineMs` at the latest, even when steps
//   are still running — they keep running in order after it opened, and each
//   service answers from its own state meanwhile (settings unreadable →
//   CG-STORAGE-READ, journal unreadable → sends refused), which is better
//   than a background that answers nothing. A tab's `tab.register` waits for
//   this barrier, so its timeout must exceed the deadline.
// Timers are required (core has no timer globals of its own): without them
// nothing would bound a hung step.

import { NO_LOG, SYSTEM_CLOCK, type Clock, type ServiceLog, type Timers } from './storage/ports';

export interface ReadinessStep {
  readonly name: string;
  run(): Promise<unknown>;
}

export interface ReadinessStepReport {
  readonly name: string;
  /** `late`: still running when the deadline opened the barrier (it keeps running). */
  readonly outcome: 'ok' | 'failed' | 'timeout' | 'late';
  readonly ms: number;
}

export interface ReadinessReport {
  readonly steps: readonly ReadinessStepReport[];
  readonly ms: number;
  /** The deadline opened the barrier before every step settled. */
  readonly deadline: boolean;
}

export interface ReadinessBarrier {
  /** Created with the barrier, so the RPC can take it synchronously. */
  readonly ready: Promise<ReadinessReport>;
  isReady(): boolean;
  /** Runs the steps in order once; a second call returns the same promise. */
  start(steps: readonly ReadinessStep[]): Promise<ReadinessReport>;
}

export interface ReadinessOptions {
  /** The composition root's timers: they bound every step and the whole barrier. */
  readonly timers: Timers;
  readonly clock?: Clock;
  /** Per step; a step past it is recorded as `timeout` and the next one starts. */
  readonly stepTimeoutMs?: number;
  /** The whole barrier opens by then at the latest. */
  readonly deadlineMs?: number;
  readonly log?: ServiceLog;
}

export const READINESS_STEP_TIMEOUT_MS = 5_000;
export const READINESS_DEADLINE_MS = 10_000;

export function createReadinessBarrier(options: ReadinessOptions): ReadinessBarrier {
  const clock = options.clock ?? SYSTEM_CLOCK;
  const stepTimeoutMs = options.stepTimeoutMs ?? READINESS_STEP_TIMEOUT_MS;
  const deadlineMs = options.deadlineMs ?? READINESS_DEADLINE_MS;
  const log = options.log ?? NO_LOG;
  const timers = options.timers;
  let open!: (report: ReadinessReport) => void;
  const ready = new Promise<ReadinessReport>((resolve) => (open = resolve));
  let started: Promise<ReadinessReport> | null = null;
  let isOpen = false;

  /** Resolves after `ms` on the composition root's timers; `cancel` clears it. */
  function after(ms: number): { readonly fired: Promise<void>; cancel(): void } {
    let handle: unknown = null;
    const fired = new Promise<void>((resolve) => (handle = timers.set(resolve, ms)));
    return { fired, cancel: () => timers.clear(handle) };
  }

  async function runStep(step: ReadinessStep): Promise<ReadinessStepReport> {
    const begin = clock.now();
    const timeout = after(stepTimeoutMs);
    let outcome: ReadinessStepReport['outcome'];
    try {
      outcome = await Promise.race([Promise.resolve().then(() => step.run()).then(() => 'ok' as const), timeout.fired.then(() => 'timeout' as const)]);
    } catch {
      outcome = 'failed';
    } finally {
      timeout.cancel();
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
        const reports: (ReadinessStepReport | null)[] = steps.map(() => null);
        // In order; keeps going after the deadline opened the barrier.
        const all = (async () => {
          for (const [index, step] of steps.entries()) reports[index] = await runStep(step);
        })();
        const deadline = after(deadlineMs);
        const passed = await Promise.race([all.then(() => false), deadline.fired.then(() => true)]);
        deadline.cancel();
        const ms = clock.now() - begin;
        const report: ReadinessReport = {
          steps: steps.map((step, index) => reports[index] ?? { name: step.name, outcome: 'late', ms }),
          ms,
          deadline: passed,
        };
        isOpen = true;
        if (passed) log({ level: 'warn', scope: 'bg.ready', msg: 'readiness deadline passed: open, later steps keep running', fields: { late: reports.filter((item) => item === null).length, ms } });
        else log({ level: 'info', scope: 'bg.ready', msg: 'background ready', fields: { steps: reports.length, ms } });
        open(report);
        return report;
      })();
      return started;
    },
  };
}
