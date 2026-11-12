// The rounds of a board's fans (2026-11-12): one round at a time per store, a board's wants during it only collected and
// asked when it ends; a call not answered asked again after the hold, not the whole freshness.

import { describe, expect, it } from 'vitest';

import { createFanRounds, type FanRoundLimits } from './fan-rounds';

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

const LIMITS: FanRoundLimits = { batch: 2, round: 6, freshMs: 30 * 60_000, holdMs: 30_000, settleMs: 250 };
const fans = (...ids: number[]): string[] => ids.map((id) => `fan-${id}`);

/** A store's rounds over a read the test answers by hand: each call waits until `answer` (null — not read). */
function setup() {
  const clock = new Clock();
  const calls: { readonly fans: readonly string[]; readonly at: number; answer: (value: string | null) => void }[] = [];
  let inFlight = 0;
  let most = 0;
  const answered: string[][] = [];
  const rounds = createFanRounds<string>({
    read: (_pageId, _account, fanRefs) =>
      new Promise<string | null>((resolve) => {
        inFlight += 1;
        most = Math.max(most, inFlight);
        calls.push({
          fans: fanRefs,
          at: clock.now(),
          answer: (value) => {
            inFlight -= 1;
            resolve(value);
          },
        });
      }),
    clock,
    limits: LIMITS,
    answered: (_answer, fanRefs) => answered.push([...fanRefs]),
    forgotten: () => undefined,
  });
  return { clock, calls, answered, rounds, most: () => most };
}

describe('the rounds of a board\'s fans', () => {
  it('one round at a time: a want during a round only collects; the next round goes when the running one ends', async () => {
    const s = setup();
    s.rounds.want(1, 'creator', fans(1, 2, 3, 4));
    await s.clock.advance(250);
    expect(s.calls.map((call) => call.fans)).toEqual([fans(1, 2)]);
    // The board re-renders after its first answer and shows two more fans: collected, not a second round beside it.
    s.calls[0]?.answer('ok');
    await flush();
    s.rounds.want(1, 'creator', fans(1, 2, 3, 4, 5, 6));
    await s.clock.advance(1000);
    expect(s.calls.map((call) => call.fans)).toEqual([fans(1, 2), fans(3, 4)]);
    s.calls[1]?.answer('ok');
    await s.clock.advance(100);
    // The running round has ended: the collected fans go a moment later.
    expect(s.calls).toHaveLength(2);
    await s.clock.advance(250);
    expect(s.calls.map((call) => call.fans)).toEqual([fans(1, 2), fans(3, 4), fans(5, 6)]);
    s.calls[2]?.answer('ok');
    await flush();
    expect(s.most()).toBe(1);
    expect(s.answered).toEqual([fans(1, 2), fans(3, 4), fans(5, 6)]);
  });

  it('a call not answered is asked again when the board wants it after the hold, not after the whole freshness; an answered one is not', async () => {
    const s = setup();
    s.rounds.want(1, 'creator', fans(1, 2, 3, 4));
    await s.clock.advance(250);
    s.calls[0]?.answer(null);
    await flush();
    s.calls[1]?.answer('ok');
    await flush();
    expect(s.answered).toEqual([fans(3, 4)]);
    // Within the hold: nothing asked again.
    await s.clock.advance(29_000);
    s.rounds.want(1, 'creator', fans(1, 2, 3, 4));
    await s.clock.advance(1000);
    expect(s.calls).toHaveLength(2);
    // After it: only the fans whose call failed.
    s.rounds.want(1, 'creator', fans(1, 2, 3, 4));
    await s.clock.advance(250);
    expect(s.calls.map((call) => call.fans)).toEqual([fans(1, 2), fans(3, 4), fans(1, 2)]);
    s.calls[2]?.answer('ok');
    await flush();
    // Answered now: fresh for the whole freshness.
    await s.clock.advance(10 * 60_000);
    s.rounds.want(1, 'creator', fans(1, 2, 3, 4));
    await s.clock.advance(250);
    expect(s.calls).toHaveLength(3);
  });

  it('another page forgets the round in flight: the new page\'s fans do not wait for it, its late answer is dropped', async () => {
    const s = setup();
    s.rounds.want(1, 'creator', fans(1, 2));
    await s.clock.advance(250);
    s.rounds.want(2, 'creator', fans(7, 8));
    await s.clock.advance(250);
    expect(s.calls.map((call) => call.fans)).toEqual([fans(1, 2), fans(7, 8)]);
    s.calls[0]?.answer('late');
    s.calls[1]?.answer('ok');
    await flush();
    expect(s.answered).toEqual([fans(7, 8)]);
  });
});
