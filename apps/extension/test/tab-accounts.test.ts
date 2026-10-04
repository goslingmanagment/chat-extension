// When the accounts of a tab are known (composition/background/tab-accounts.ts).

import { describe, expect, it } from 'vitest';

import { TAB_ACCOUNTS_WAIT_MS, createTabAccountsGate } from '../src/composition/background/tab-accounts.ts';

function gate(waitMs?: number) {
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const made = createTabAccountsGate({ setTimer: (fn, ms) => timers.push({ fn, ms }), ...(waitMs === undefined ? {} : { waitMs }) });
  return { made, timers };
}
/** Whether a promise has settled by the next macrotask. */
async function settled(promise: Promise<void>): Promise<boolean> {
  let done = false;
  void promise.then(() => {
    done = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  return done;
}

describe('the accounts of a tab', () => {
  it('a tab that reported is known at once, and nothing is timed', async () => {
    const { made, timers } = gate();
    made.reported('tab-a');
    expect(made.has('tab-a')).toBe(true);
    expect(await settled(made.known('tab-a'))).toBe(true);
    expect(timers).toEqual([]);
  });

  it('a request waits for the report: every waiter of that tab is released by it, no other tab’s', async () => {
    const { made } = gate();
    const first = made.known('tab-a');
    const second = made.known('tab-a');
    const other = made.known('tab-b');
    expect(await settled(first)).toBe(false);
    made.reported('tab-a');
    expect(await settled(first)).toBe(true);
    expect(await settled(second)).toBe(true);
    expect(await settled(other)).toBe(false);
    expect(made.has('tab-b')).toBe(false);
  });

  it('a tab that never reports is waited for a bounded time, and stays unknown', async () => {
    const { made, timers } = gate();
    const waiting = made.known('tab-a');
    expect(timers.map((timer) => timer.ms)).toEqual([TAB_ACCOUNTS_WAIT_MS]);
    expect(await settled(waiting)).toBe(false);
    timers[0]?.fn();
    expect(await settled(waiting)).toBe(true);
    expect(made.has('tab-a')).toBe(false);
    // The timer of a wait that already ended by a report does nothing.
    const again = made.known('tab-a');
    made.reported('tab-a');
    expect(await settled(again)).toBe(true);
    timers[1]?.fn();
    expect(made.has('tab-a')).toBe(true);
  });

  it('a closed tab releases its waiters and is forgotten: its next session reports anew', async () => {
    const { made } = gate(50);
    made.reported('tab-a');
    const waiting = made.known('tab-b');
    made.gone('tab-b');
    made.gone('tab-a');
    expect(await settled(waiting)).toBe(true);
    expect(made.has('tab-a')).toBe(false);
  });
});
