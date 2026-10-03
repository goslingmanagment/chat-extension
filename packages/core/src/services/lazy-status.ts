// The status of a lazily loaded surface (UP-016; architecture.md §10.1, §11):
// a chunk that has not arrived after a short grace shows «ChatGoose
// загружается…»; one that failed (or did not arrive within its deadline)
// shows «не загрузился. Повторить», and only the person's click retries.
// Nothing reloads by itself. Pure over a clock port.

import { type CgCode } from '@cg/contracts/errors';

import { type Clock, type TimerHandle } from './ports';

export type LazyStatus =
  | { readonly s: 'idle' }
  /** Loading, nothing shown yet (a fast chunk never flashes a label). */
  | { readonly s: 'pending' }
  /** «ChatGoose загружается…». */
  | { readonly s: 'loading' }
  | { readonly s: 'loaded' }
  /** «не загрузился. Повторить». */
  | { readonly s: 'failed'; readonly code: CgCode; readonly attempts: number };

export const LAZY_TIMING = { showLabelAfterMs: 300, giveUpAfterMs: 15_000 } as const;

export class LazyLoadStatus {
  private status: LazyStatus = { s: 'idle' };
  private attempts = 0;
  private generation = 0;
  private timers: TimerHandle[] = [];
  private readonly listeners = new Set<(status: LazyStatus) => void>();

  constructor(
    private readonly clock: Clock,
    private readonly load: () => Promise<void>,
  ) {}

  get current(): LazyStatus {
    return this.status;
  }

  onChange(listener: (status: LazyStatus) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** The first load (the surface was asked for). A second call while loading or loaded does nothing. */
  start(): void {
    if (this.status.s !== 'idle') return;
    this.run();
  }

  /** «Повторить»: only from `failed`, only by the person. */
  retry(): boolean {
    if (this.status.s !== 'failed') return false;
    this.run();
    return true;
  }

  private run(): void {
    this.attempts += 1;
    const generation = ++this.generation;
    this.clearTimers();
    this.set({ s: 'pending' });
    this.timers.push(
      this.clock.setTimer(LAZY_TIMING.showLabelAfterMs, () => {
        if (generation === this.generation && this.status.s === 'pending') this.set({ s: 'loading' });
      }),
      this.clock.setTimer(LAZY_TIMING.giveUpAfterMs, () => this.end(generation, false)),
    );
    this.load().then(
      () => this.end(generation, true),
      () => this.end(generation, false),
    );
  }

  private end(generation: number, ok: boolean): void {
    if (generation !== this.generation || this.status.s === 'loaded' || this.status.s === 'failed') return;
    this.clearTimers();
    this.set(ok ? { s: 'loaded' } : { s: 'failed', code: 'CG-UI-FAILED', attempts: this.attempts });
  }

  private clearTimers(): void {
    for (const timer of this.timers) this.clock.clearTimer(timer);
    this.timers = [];
  }

  private set(status: LazyStatus): void {
    this.status = status;
    for (const listener of this.listeners) listener(status);
  }
}
