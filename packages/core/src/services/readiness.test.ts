import { describe, expect, it } from 'vitest';

import { createReadinessBarrier, READINESS_STEP_TIMEOUT_MS } from './readiness';
import type { ServiceLogEntry, Timers } from './storage/ports';
import { manualClock, settle } from './test-support/memory-kv';

/** Timers the test fires by hand. */
function manualTimers(): Timers & { fire(): void; pending(): number } {
  const queue = new Map<number, () => void>();
  let next = 1;
  return {
    set(callback) {
      const id = next++;
      queue.set(id, callback);
      return id;
    },
    clear(handle) {
      queue.delete(handle as number);
    },
    fire() {
      const callbacks = [...queue.values()];
      queue.clear();
      for (const callback of callbacks) callback();
    },
    pending: () => queue.size,
  };
}

describe('[BG-004] the background readiness barrier (§7 «Фон и выгрузка»)', () => {
  it('exists before any step runs; opens once, after every step, in order', async () => {
    const clock = manualClock(0);
    const logs: ServiceLogEntry[] = [];
    const barrier = createReadinessBarrier({ clock, log: (entry) => logs.push(entry) });
    const order: string[] = [];
    let opened = false;
    void barrier.ready.then(() => (opened = true));
    expect(barrier.isReady()).toBe(false);
    const report = barrier.start([
      {
        name: 'settings',
        run: () => {
          order.push('settings');
          clock.advance(5);
          return Promise.resolve();
        },
      },
      {
        name: 'results',
        run: async () => {
          await settle();
          order.push('results');
        },
      },
    ]);
    await settle(1);
    expect(opened).toBe(false);
    expect(await report).toEqual({ steps: [{ name: 'settings', outcome: 'ok', ms: 5 }, { name: 'results', outcome: 'ok', ms: 0 }], ms: 5 });
    expect(await barrier.ready).toBe(await report);
    expect(order).toEqual(['settings', 'results']);
    expect(barrier.isReady()).toBe(true);
    // A second start is the same run.
    expect(barrier.start([{ name: 'again', run: () => Promise.resolve(order.push('again')) }])).toBe(report);
    expect(order).toEqual(['settings', 'results']);
    expect(logs.at(-1)).toMatchObject({ level: 'info', msg: 'background ready', fields: { steps: 2, ms: 5 } });
  });

  it('never hangs and never rejects: a failed step and a step past its timeout are recorded, the next ones run', async () => {
    const timers = manualTimers();
    const logs: ServiceLogEntry[] = [];
    const barrier = createReadinessBarrier({ timers, log: (entry) => logs.push(entry) });
    expect(READINESS_STEP_TIMEOUT_MS).toBe(10_000);
    const ran: string[] = [];
    const report = barrier.start([
      {
        name: 'journal',
        run: () => {
          throw new Error('broken');
        },
      },
      { name: 'telemetry', run: () => new Promise(() => undefined) },
      { name: 'presence', run: () => Promise.resolve(ran.push('presence')) },
    ]);
    await settle();
    expect(timers.pending()).toBe(1);
    timers.fire();
    const result = await report;
    expect(result.steps.map((step) => [step.name, step.outcome])).toEqual([
      ['journal', 'failed'],
      ['telemetry', 'timeout'],
      ['presence', 'ok'],
    ]);
    expect(ran).toEqual(['presence']);
    expect(timers.pending()).toBe(0);
    expect(logs.filter((entry) => entry.level === 'warn').map((entry) => entry.fields?.['step'])).toEqual(['journal', 'telemetry']);
  });
});
