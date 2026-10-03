// Test support: timers the test fires by hand (core has no timer globals).

import type { Timers } from '../storage/ports';

export interface ManualTimers extends Timers {
  /** Fires every pending timer whose time has come (all of them without `ms`). */
  fire(): void;
  /** Moves the time on and fires what is due, in order. */
  advance(ms: number): void;
  pending(): number;
}

export function manualTimers(): ManualTimers {
  const queue = new Map<number, { readonly at: number; readonly callback: () => void }>();
  let next = 1;
  let now = 0;
  const run = (due: (at: number) => boolean): void => {
    const ready = [...queue.entries()].filter(([, timer]) => due(timer.at)).sort((a, b) => a[1].at - b[1].at || a[0] - b[0]);
    for (const [id, timer] of ready) {
      if (!queue.delete(id)) continue;
      timer.callback();
    }
  };
  return {
    set(callback, ms) {
      const id = next++;
      queue.set(id, { at: now + ms, callback });
      return id;
    },
    clear(handle) {
      queue.delete(handle as number);
    },
    fire() {
      run(() => true);
    },
    advance(ms) {
      now += ms;
      run((at) => at <= now);
    },
    pending: () => queue.size,
  };
}
