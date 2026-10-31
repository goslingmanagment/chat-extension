// The OnlyFans feed's light reads of ChatSpace (hub #955): a lent poll reads each list back to the newest item the hub
// holds and no further; a page ChatSpace refused ends it; a poll not lent reads nothing.

import { type OnlyfansPollResult } from '@cg/contracts/hub';
import type { FeedPollPort, FeedPollRead } from '@cg/contracts/host';
import { FEED_POLL_BACKOFF_MS, pollAccount, startChatSpaceFeedPoll } from '@cg/core/application/hosts/chatspace/feed-poll';
import { describe, expect, it } from 'vitest';

const lent = (over: Partial<OnlyfansPollResult> = {}): OnlyfansPollResult => ({
  pageLabel: 'lora-of', granted: true, holder: 'tab', nextAt: '2026-11-01T00:10:00.000Z',
  cursors: { subscribers: null, ledger: null }, maxPages: 5, serverNow: '2026-11-01T00:00:00.000Z', ...over,
});

/** ChatSpace's two lists, paged as OnlyMonster pages them. */
function chatspace(pages: Record<'subscribers' | 'ledger', FeedPollRead[]>): FeedPollPort & { readonly asked: string[] } {
  const asked: string[] = [];
  const left = { subscribers: [...pages.subscribers], ledger: [...pages.ledger] };
  return {
    asked,
    read(_acc, list, cursor) {
      asked.push(`${list}:${cursor ?? '-'}`);
      return Promise.resolve(left[list].shift() ?? { ok: true, refs: [], hasMore: false, next: null });
    },
  };
}
const page = (refs: string[], next: string | null): FeedPollRead => ({ ok: true, refs, hasMore: next !== null, next });
const now = (ms: number, fn: () => void) => {
  fn();
  return ms;
};

describe('a lent poll', () => {
  it('reads each list back to the hub’s newest item and no further', async () => {
    const port = chatspace({ subscribers: [page(['9', '8'], '8'), page(['7', '6'], '6'), page(['5'], null)], ledger: [page(['t3', 't2'], 't2')] });
    expect(await pollAccount({ port, setTimer: now }, '910101', lent({ cursors: { subscribers: '7', ledger: 't2' } }))).toBe(true);
    expect(port.asked).toEqual(['subscribers:-', 'subscribers:8', 'ledger:-']);
  });

  it('never reads more than the hub’s pages, the first time too', async () => {
    const port = chatspace({ subscribers: Array.from({ length: 9 }, (_, n) => page([String(100 - n)], String(100 - n))), ledger: [] });
    await pollAccount({ port, setTimer: now }, '910101', lent({ maxPages: 3 }));
    expect(port.asked.filter((ask) => ask.startsWith('subscribers'))).toHaveLength(3);
  });

  it('stops at a page ChatSpace refused: nothing is asked again', async () => {
    const port = chatspace({ subscribers: [{ ok: false, reason: 'http', status: 429 }], ledger: [page(['t1'], null)] });
    expect(await pollAccount({ port, setTimer: now }, '910101', lent())).toBe(false);
    expect(port.asked).toEqual(['subscribers:-']);
  });
});

describe('the tab’s poller', () => {
  it('reads nothing when the hub lends the poll to another tab, and backs off after a refused page', async () => {
    let clock = 0;
    const timers: Array<{ at: number; fn: () => void }> = [];
    const port = chatspace({ subscribers: [{ ok: false, reason: 'http', status: 503 }], ledger: [] });
    const answers: (OnlyfansPollResult | null)[] = [lent({ granted: false }), lent()];
    const stop = startChatSpaceFeedPoll({
      port,
      accounts: () => [{ host: 'chatspace', hostAccountId: '910101', platform: 'onlyfans', platformAccountId: '830000101', username: null, displayName: null }],
      lend: () => Promise.resolve(answers.shift() ?? null),
      clock: { now: () => clock },
      random: () => 0,
      setTimer: (ms, fn) => timers.push({ at: clock + ms, fn }),
      clearTimer: () => undefined,
    });
    const run = async (until: number): Promise<void> => {
      while (true) {
        timers.sort((a, b) => a.at - b.at);
        const next = timers[0];
        if (next === undefined || next.at > until) break;
        timers.shift();
        clock = next.at;
        next.fn();
        await new Promise((resolve) => setImmediate(resolve));
      }
      clock = until;
    };
    await run(5 * 60_000);
    expect(port.asked).toEqual([]);
    await run(20 * 60_000);
    expect(port.asked).toEqual(['subscribers:-']);
    // Refused: no read again within the back-off.
    await run(20 * 60_000 + FEED_POLL_BACKOFF_MS - 60_000);
    expect(port.asked).toEqual(['subscribers:-']);
    stop();
  });
});
