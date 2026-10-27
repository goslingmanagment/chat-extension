// «Отправить всем» of a batch (the owner, 2026-10-27): one click sends the ready greetings one by one, a second apart,
// never faster than the hub's minute; an unknown outcome or a refusal is never sent again; «Остановить» ends it.

import { describe, expect, it } from 'vitest';

import { type ActionReceipt } from '@cg/contracts/vm';

import { createBatch, type BatchSendState } from './batch';

class Clock {
  t = 0;
  private timers: { id: number; at: number; fn: () => void }[] = [];
  private next = 1;
  now = (): number => this.t;
  setTimer = (ms: number, fn: () => void): number => {
    const id = this.next++;
    this.timers.push({ id, at: this.t + ms, fn });
    return id;
  };
  clearTimer = (id: number): void => {
    this.timers = this.timers.filter((timer) => timer.id !== id);
  };
  async advance(ms: number): Promise<void> {
    const end = this.t + ms;
    await flush();
    for (;;) {
      const due = this.timers.filter((timer) => timer.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (due === undefined) break;
      this.timers = this.timers.filter((timer) => timer.id !== due.id);
      this.t = due.at;
      due.fn();
      await flush();
    }
    this.t = end;
    await flush();
  }
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await new Promise<void>((resolve) => setTimeout(resolve, 0));
};

const ok = (): ActionReceipt => ({ ok: true, type: 'SendNewcomerGreeting', outcome: 'done' }) as ActionReceipt;
const no = (code: string): ActionReceipt => ({ ok: false, type: 'SendNewcomerGreeting', code }) as unknown as ActionReceipt;

/** A batch of `n` ready fans; `answer` says how a send of a fan ends (default: it went). */
async function setup(n: number, perMinute = 30, answer: (handle: string) => ActionReceipt = ok) {
  const clock = new Clock();
  const states = new Map<string, BatchSendState>();
  const went = new Set<string>();
  const sends: { handle: string; at: number }[] = [];
  const batch = createBatch({
    clock,
    start: (handle) => Promise.resolve({ s: 'ready', text: `hi ${handle}` }),
    live: (handle) => ({ text: `hi ${handle}`, sent: went.has(handle) }),
    sender: {
      state: (handle) => states.get(handle) ?? 'no',
      send(handle) {
        sends.push({ handle, at: clock.now() });
        const receipt = answer(handle);
        if (receipt.ok) {
          states.set(handle, 'done');
          went.add(handle);
        }
        return Promise.resolve(receipt);
      },
      perMinute: () => perMinute,
    },
    changed: () => undefined,
  });
  const handles = Array.from({ length: n }, (_, i) => `fan${String(i)}`);
  batch.pick(handles, true);
  batch.run();
  await clock.advance(0);
  for (const handle of handles) states.set(handle, 'now');
  return { clock, batch, states, sends, handles, went };
}

describe('«Отправить всем»', () => {
  it('sends the ready greetings one by one, a second apart', async () => {
    const { clock, batch, sends } = await setup(3);
    expect(batch.vm(null).send?.ready).toBe(3);
    expect(batch.sendAll()).toBe(true);
    await clock.advance(5_000);
    expect(sends.map((send) => send.at)).toEqual([0, 1_000, 2_000]);
    expect(batch.vm(null).send?.run).toEqual({ running: false, total: 3, done: 3, sent: 3, failed: 0, held: false });
  });

  it('keeps to the hub minute', async () => {
    const { clock, batch, sends } = await setup(4, 2);
    batch.sendAll();
    await clock.advance(2_500);
    expect(sends).toHaveLength(2);
    expect(batch.vm(null).send?.run?.held).toBe(true);
    await clock.advance(70_000);
    expect(sends).toHaveLength(4);
    expect(sends[2]?.at).toBeGreaterThanOrEqual(60_000);
  });

  it('never sends a refused or unknown greeting again, nor one it may not send', async () => {
    const { clock, batch, sends, states } = await setup(3, 30, (handle) => (handle === 'fan0' ? no('CG-SEND-UNCERTAIN') : ok()));
    states.set('fan2', 'no');
    batch.sendAll();
    await clock.advance(10_000);
    expect(sends.map((send) => send.handle)).toEqual(['fan0', 'fan1']);
    expect(batch.vm(null).send?.run).toMatchObject({ running: false, total: 2, sent: 1, failed: 1 });
  });

  it('stops on «Остановить»: nothing more starts', async () => {
    const { clock, batch, sends } = await setup(5);
    batch.sendAll();
    await clock.advance(1_500);
    expect(batch.stopSend()).toBe(true);
    await clock.advance(10_000);
    expect(sends).toHaveLength(2);
    expect(batch.vm(null).send?.run?.running).toBe(false);
  });

  it('counts what the site refused after it took the send', async () => {
    const { clock, batch, states, went } = await setup(2);
    batch.sendAll();
    await clock.advance(5_000);
    went.delete('fan1');
    states.set('fan1', 'no');
    expect(batch.vm(null).send?.run).toMatchObject({ total: 2, sent: 1, failed: 1 });
  });

  it('ends when the click has no token left', async () => {
    const { clock, batch, sends } = await setup(3, 30, () => no('CG-UI-FAILED'));
    batch.sendAll();
    await clock.advance(10_000);
    expect(sends).toHaveLength(1);
    expect(batch.vm(null).send?.run).toMatchObject({ running: false, failed: 1 });
  });
});
