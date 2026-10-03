// The background's readiness barrier (architecture.md §7 «Фон и выгрузка»;
// BG-004, AU-018, UP-008). Event handlers are registered synchronously, then
// the stores come up; every request waits for one promise of readiness. A
// step that fails is recorded and logged, never fatal: the interface answers
// without the hub and with a damaged store (settings fall back, journals drop
// what fails their schema). Nothing here talks to the hub: after an install
// or an update the hub is first asked when the person signs in or opens a
// surface that needs it.

import { type CgCode } from '@cg/contracts/errors';

import { NO_LOG, type LogSink } from './ports';

export interface ReadinessStep {
  /** A short stable name for the log (`settings`, `ops`, `send-journal`…). */
  readonly name: string;
  readonly run: () => Promise<void>;
  /** The code a failure of this step is counted under. */
  readonly code?: CgCode;
}

export interface StepFailure {
  readonly name: string;
  readonly code: CgCode;
}

export class Readiness {
  private resolveReady: () => void = () => undefined;
  private readonly failed: StepFailure[] = [];
  private started = false;
  private isReady = false;
  readonly ready: Promise<void>;

  constructor(private readonly log: LogSink = NO_LOG) {
    this.ready = new Promise<void>((resolve) => {
      this.resolveReady = resolve;
    });
  }

  /** Runs the restore steps in order once; readiness resolves after the last, whatever failed. */
  async start(steps: readonly ReadinessStep[]): Promise<readonly StepFailure[]> {
    if (this.started) {
      await this.ready;
      return this.failed;
    }
    this.started = true;
    for (const step of steps) {
      try {
        await step.run();
      } catch {
        const failure: StepFailure = { name: step.name, code: step.code ?? 'CG-STORAGE-READ' };
        this.failed.push(failure);
        this.log.write({ level: 'error', scope: 'bg.ready', msg: 'restore step failed', code: failure.code, fields: { step: step.name } });
      }
    }
    this.isReady = true;
    this.resolveReady();
    return this.failed;
  }

  get done(): boolean {
    return this.isReady;
  }

  failures(): readonly StepFailure[] {
    return this.failed;
  }

  /** Wraps a handler so it runs only after readiness (one promise for every request). */
  gate<A extends unknown[], R>(handler: (...args: A) => Promise<R> | R): (...args: A) => Promise<R> {
    return async (...args: A): Promise<R> => {
      await this.ready;
      return handler(...args);
    };
  }
}

/** UP-008: what the background does on install or update — it logs; the hub waits for a human. */
export function onInstalledPlan(reason: 'install' | 'update' | 'browser_update' | 'other'): { readonly log: true; readonly contactHub: false; readonly openOnboarding: boolean } {
  return { log: true, contactHub: false, openOnboarding: reason === 'install' };
}
