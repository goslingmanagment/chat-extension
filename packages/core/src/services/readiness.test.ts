import { describe, expect, it } from 'vitest';

import { createReadinessBarrier, READINESS_DEADLINE_MS, READINESS_STEP_TIMEOUT_MS } from './readiness';
import type { ServiceLogEntry } from './storage/ports';
import { manualClock, settle } from './test-support/memory-kv';
import { manualTimers } from './test-support/timers';

describe('[BG-004] the background readiness barrier (§7 «Фон и выгрузка»)', () => {
  it('exists before any step runs; opens once, after every step, in order', async () => {
    const clock = manualClock(0);
    const timers = manualTimers();
    const logs: ServiceLogEntry[] = [];
    const barrier = createReadinessBarrier({ timers, clock, log: (entry) => logs.push(entry) });
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
    expect(await report).toEqual({ steps: [{ name: 'settings', outcome: 'ok', ms: 5 }, { name: 'results', outcome: 'ok', ms: 0 }], ms: 5, deadline: false });
    expect(await barrier.ready).toBe(await report);
    expect(order).toEqual(['settings', 'results']);
    expect(barrier.isReady()).toBe(true);
    // Every timer of the run is cleared.
    expect(timers.pending()).toBe(0);
    // A second start is the same run.
    expect(barrier.start([{ name: 'again', run: () => Promise.resolve(order.push('again')) }])).toBe(report);
    expect(order).toEqual(['settings', 'results']);
    expect(logs.at(-1)).toMatchObject({ level: 'info', msg: 'background ready', fields: { steps: 2, ms: 5 } });
  });

  it('never hangs and never rejects: a failed step and a step past its timeout are recorded, the next ones run', async () => {
    const timers = manualTimers();
    const logs: ServiceLogEntry[] = [];
    const barrier = createReadinessBarrier({ timers, log: (entry) => logs.push(entry) });
    expect(READINESS_STEP_TIMEOUT_MS).toBe(5_000);
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
    timers.advance(READINESS_STEP_TIMEOUT_MS);
    const result = await report;
    expect(result.steps.map((step) => [step.name, step.outcome])).toEqual([
      ['journal', 'failed'],
      ['telemetry', 'timeout'],
      ['presence', 'ok'],
    ]);
    expect(result.deadline).toBe(false);
    expect(ran).toEqual(['presence']);
    expect(timers.pending()).toBe(0);
    expect(logs.filter((entry) => entry.level === 'warn').map((entry) => entry.fields?.['step'])).toEqual(['journal', 'telemetry']);
  });

  it('a slow cold start opens by the deadline at the latest; the later steps still run after it', async () => {
    const timers = manualTimers();
    const logs: ServiceLogEntry[] = [];
    const barrier = createReadinessBarrier({ timers, log: (entry) => logs.push(entry) });
    expect(READINESS_DEADLINE_MS).toBe(10_000);
    const ran: string[] = [];
    // Five steps, each slow but under its own timeout: in sequence they would take 20 s.
    const slow = (name: string) => ({
      name,
      run: () =>
        new Promise<void>((resolve) =>
          timers.set(() => {
            ran.push(name);
            resolve();
          }, 4_000),
        ),
    });
    let opened = false;
    void barrier.ready.then(() => (opened = true));
    const report = barrier.start(['settings', 'results', 'sendJournal', 'presence', 'consent'].map(slow));
    await settle(10);
    for (let ms = 0; ms < READINESS_DEADLINE_MS; ms += 1_000) {
      expect(opened).toBe(false);
      timers.advance(1_000);
      await settle(20);
    }
    expect(opened).toBe(true);
    const result = await report;
    expect(result.deadline).toBe(true);
    expect(result.steps.map((step) => step.outcome)).toEqual(['ok', 'ok', 'late', 'late', 'late']);
    expect(logs.find((entry) => entry.msg.startsWith('readiness deadline passed'))?.fields).toMatchObject({ late: 3 });
    // The rest keeps running in order after the barrier opened.
    for (let i = 0; i < 12; i += 1) {
      timers.advance(1_000);
      await settle(20);
    }
    expect(ran).toEqual(['settings', 'results', 'sendJournal', 'presence', 'consent']);
  });
});
