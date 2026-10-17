import { describe, expect, it } from 'vitest';

import { BATCH_LIMITS } from '@cg/contracts/vm';

import { createBatch, type BatchOutcome } from './batch';

function setup() {
  let now = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let next = 1;
  const clock = {
    now: () => now,
    setTimer(ms: number, fn: () => void) {
      timers.set(next, { at: now + ms, fn });
      return next++;
    },
    clearTimer(handle: number) {
      timers.delete(handle);
    },
  };
  const pending = new Map<string, (outcome: BatchOutcome) => void>();
  const started: string[] = [];
  const batch = createBatch({
    clock,
    start(handle) {
      started.push(handle);
      return new Promise((resolve) => pending.set(handle, resolve));
    },
    changed: () => undefined,
  });
  const end = async (handle: string, outcome: BatchOutcome): Promise<void> => {
    pending.get(handle)?.(outcome);
    pending.delete(handle);
    await Promise.resolve();
    await Promise.resolve();
  };
  const advance = (ms: number): void => {
    now += ms;
    for (const [id, timer] of [...timers]) {
      if (timer.at > now) continue;
      timers.delete(id);
      timer.fn();
    }
  };
  return { batch, started, end, advance };
}

describe('a batch of a list', () => {
  it('starts three at a time, the next as one ends, and never more than the limit of fans', async () => {
    const { batch, started, end } = setup();
    const fans = Array.from({ length: 25 }, (_, n) => `f${n}`);
    batch.pick(fans, true);
    expect(batch.vm(null).picked).toBe(BATCH_LIMITS.picks);
    expect(batch.run()).toBe(true);
    expect(started).toEqual(['f0', 'f1', 'f2']);
    await end('f1', { s: 'ready', text: 'hey' });
    expect(started).toEqual(['f0', 'f1', 'f2', 'f3']);
    expect(batch.row('f1')).toMatchObject({ state: 'ready', text: 'hey' });
    await end('f0', { s: 'failed', code: 'CG-OP-CHAT-BUSY' });
    expect(batch.row('f0')).toMatchObject({ state: 'failed', failure: { code: 'CG-OP-CHAT-BUSY' } });
    expect(batch.vm(null)).toMatchObject({ queued: 15, generating: 3, ready: 1, failed: 1 });
  });

  it('a fan the tab limit refused waits its turn again; a spent grant ticks the rest again', async () => {
    const { batch, started, end, advance } = setup();
    batch.pick(['a', 'b', 'c', 'd', 'e'], true);
    batch.run();
    await end('a', { s: 'busy' });
    expect(batch.row('a').state).toBe('queued');
    expect(started).toEqual(['a', 'b', 'c']);
    advance(5_000);
    // The refused fan goes first: it stands first in the queue.
    expect(started).toEqual(['a', 'b', 'c', 'a']);
    await end('b', { s: 'spent', code: 'CG-UI-FAILED' });
    expect(batch.row('d')).toMatchObject({ picked: true, state: null });
    expect(batch.row('e')).toMatchObject({ picked: true, state: null });
    expect(batch.row('a').state).toBe('generating');
    expect(batch.stop()).toBe(false);
  });
});
