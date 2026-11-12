import type { CgErrorWire } from '@cg/contracts/errors';
import { FanslyApiError, type FanslyCall, type FanslyClient } from '@cg/fansly-api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FanBadgesReport } from '@cg/contracts/hub';

import { createFanBadges, FAN_BADGES_READ, FAN_BADGES_REPORT } from '../bg/fansly/badges';
import type { BackgroundKit, HostSiteSender } from '../src/composition/background/host-module';

const CREATOR = '700000000000000017';
const PAGE_ID = 13;
const FANS = { a: '920000000000000003', b: '920000000000000032', c: '930000000000000007', d: '930000000000000038' } as const;
const T0 = Date.UTC(2026, 10, 12, 10);
/** The pacer's `/account*` spacing, as `poll` keeps it (fansly-api pacer/rules.ts). */
const SPACING = 5_000;
const sender = (tab: number): HostSiteSender => ({ kind: 'tab', host: 'fansly-web', tabId: tab, tabSessionId: `tab-${tab}`, url: 'https://fansly.com/messages' });
const request = (fanRefs: readonly string[]) => ({ pageId: PAGE_ID, hostAccountId: CREATOR, fanRefs: [...fanRefs] });

/** Fansly's `GET /account?ids=` answer: every asked fan but the `gone` ones, the blue card on `a`. */
const accounts = (ids: readonly string[], gone: ReadonlySet<string> = new Set()): unknown => ids.filter((id) => !gone.has(id)).map((id) => ({ id, userFlags: id === FANS.a ? 2 : 0, flags: 0 }));

/**
 * The background's badges over a client that answers as the pacer's `poll` does: a read within the `/account*` spacing
 * of the last one is refused `early`, with the moment it may start, and sends nothing.
 */
function world(options: { readonly early?: (now: number) => number | null; readonly gone?: ReadonlySet<string>; readonly capabilities?: readonly string[] } = {}) {
  const starts: Array<{ readonly at: number; readonly ids: string }> = [];
  const refusals: number[] = [];
  let last = -Infinity;
  const call = vi.fn((asked: FanslyCall) => {
    const now = Date.now();
    const until = options.early?.(now) ?? (now < last + SPACING ? last + SPACING : null);
    if (until !== null) {
      refusals.push(now);
      return Promise.reject(new FanslyApiError('early', { sent: false, retryAt: until }));
    }
    last = now;
    const ids = asked.query?.['ids'] ?? '';
    starts.push({ at: now, ids });
    return Promise.resolve({ response: accounts(ids.split(','), options.gone), status: 200 });
  });
  const warn = vi.fn();
  const fanBadges = vi.fn((_report: FanBadgesReport) => Promise.resolve({}));
  const kit = {
    hub: {
      page: (pageId: number) => Promise.resolve(pageId === PAGE_ID ? { ok: true, page: { pageId, pageLabel: 'model-fansly', platform: 'fansly' } } : { ok: false, code: 'CG-BINDING-NOT-GRANTED' }),
      bootstrap: () => ({ capabilities: options.capabilities ?? [], pages: [{ pageId: PAGE_ID, pageLabel: 'model-fansly', platform: 'fansly', platformAccountId: CREATOR }] }),
      facade: { fanBadges },
      errorWire: (): CgErrorWire => ({ code: 'CG-HUB-UNKNOWN' }),
    },
    clock: { now: () => Date.now(), setTimer: (ms: number, fn: () => void) => setTimeout(fn, ms) as unknown as number, clearTimer: (handle: number) => clearTimeout(handle) },
    networkSession: { aliases: () => [] },
    log: { service: warn },
  } as unknown as BackgroundKit;
  const client: Pick<FanslyClient, 'call'> = { call };
  const badges = createFanBadges(kit, () => Promise.resolve(client), null, () => 0);
  return { badges, call, starts, refusals, warn, fanBadges };
}

/** The fans of each report that went to the hub, as sent. */
const reported = (w: ReturnType<typeof world>): FanBadgesReport['fans'][] => w.fanBadges.mock.calls.map(([report]) => report.fans);

const cardOf = (answer: Awaited<ReturnType<ReturnType<typeof world>['badges']['badges']>>, fan: string): boolean | null | undefined =>
  answer.ok ? answer.fans.find((entry) => entry.fanRef === fan)?.recentSpender : undefined;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('[host:fansly] the fans\' badges: Fansly\'s `/account?ids=` reads of a creator one after another', () => {
  it('two tabs at once: one read, then the next at the pacer\'s moment, 5 s apart; the second reads only the fans the first did not', async () => {
    const w = world();
    const first = w.badges.badges(request([FANS.a, FANS.b]), sender(1));
    const second = w.badges.badges(request([FANS.b, FANS.c, FANS.d]), sender(2));
    await vi.advanceTimersByTimeAsync(SPACING + 1_000);
    const [one, two] = await Promise.all([first, second]);
    expect(w.starts).toEqual([
      { at: T0, ids: `${FANS.a},${FANS.b}` },
      { at: T0 + SPACING, ids: `${FANS.c},${FANS.d}` },
    ]);
    // The second's first try came too early: refused before anything left, asked again at the moment named.
    expect(w.refusals).toEqual([T0]);
    expect(cardOf(one, FANS.a)).toBe(true);
    expect(cardOf(one, FANS.b)).toBe(false);
    expect(cardOf(two, FANS.b)).toBe(false);
    expect(cardOf(two, FANS.c)).toBe(false);
    // Kept thirty minutes: asked again within them, nothing is read.
    await vi.advanceTimersByTimeAsync(FAN_BADGES_READ.keepMs - SPACING - 2_000);
    expect(cardOf(await w.badges.badges(request([FANS.a, FANS.d]), sender(1)), FANS.a)).toBe(true);
    expect(w.call).toHaveBeenCalledTimes(3);
    expect(w.warn).not.toHaveBeenCalled();
  });

  it('`clear()` stops a read waiting for its moment: it asks nothing more and its fans stay unknown', async () => {
    const w = world();
    await w.badges.badges(request([FANS.a]), sender(1));
    const waiting = w.badges.badges(request([FANS.c]), sender(2));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(w.refusals).toEqual([T0]);
    w.badges.clear();
    expect(cardOf(await waiting, FANS.c)).toBeNull();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(w.call).toHaveBeenCalledTimes(2);
    expect(w.starts).toHaveLength(1);
  });

  it('a read that cannot start within the wait is not made: its fans unknown this time, said once in the log', async () => {
    // The pacer names a moment past the request's wait (another poll keeps taking the spacing).
    const w = world({ early: (now) => now + FAN_BADGES_READ.waitMs + 1_000 });
    const answer = w.badges.badges(request([FANS.a]), sender(1));
    await vi.advanceTimersByTimeAsync(FAN_BADGES_READ.waitMs);
    expect(cardOf(await answer, FANS.a)).toBeNull();
    expect(w.call).toHaveBeenCalledTimes(1);
    expect(w.warn).toHaveBeenCalledTimes(1);
    expect(w.warn.mock.calls[0]?.[0]).toMatchObject({ scope: 'fansly.badges', msg: 'accounts not read', fields: { code: 'CG-DATA-NOT-READY' } });
  });
});

describe('[host:fansly] the fans\' badges: whether Fansly returned each fan\'s account (fan-account-state-v1)', () => {
  const REPORTING = ['fan-badges-v1', 'fan-account-state-v1'];

  it('the tab hears seen / not seen with the read\'s time; the hub gets `accountSeen` only for the fans read in this request', async () => {
    const w = world({ gone: new Set([FANS.b]), capabilities: REPORTING });
    const one = await w.badges.badges(request([FANS.a, FANS.b]), sender(1));
    expect(one.ok && one.fans).toEqual([
      { fanRef: FANS.a, recentSpender: true, tier: null, seen: true, seenAt: T0 },
      { fanRef: FANS.b, recentSpender: null, tier: null, seen: false, seenAt: T0 },
    ]);
    await vi.advanceTimersByTimeAsync(0);
    // `b` has no badge at all: his account's word alone goes.
    expect(reported(w)).toEqual([[{ fanRef: FANS.a, recentSpender: true, accountSeen: true }, { fanRef: FANS.b, accountSeen: false }]]);
    // A second request answered from what is kept, `c` read anew: only `c`'s account goes; the kept answer is not fresh.
    await vi.advanceTimersByTimeAsync(SPACING + 1_000);
    const two = await w.badges.badges(request([FANS.a, FANS.b, FANS.c]), sender(2));
    expect(two.ok && two.fans.find((fan) => fan.fanRef === FANS.b)).toEqual({ fanRef: FANS.b, recentSpender: null, tier: null, seen: false, seenAt: T0 });
    await vi.advanceTimersByTimeAsync(0);
    expect(reported(w).at(-1)).toEqual([{ fanRef: FANS.c, recentSpender: false, accountSeen: true }]);
  });

  it('a hub without the capability is never sent `accountSeen`', async () => {
    const w = world({ gone: new Set([FANS.b]), capabilities: ['fan-badges-v1'] });
    await w.badges.badges(request([FANS.a, FANS.b]), sender(1));
    await vi.advanceTimersByTimeAsync(0);
    expect(reported(w)).toEqual([[{ fanRef: FANS.a, recentSpender: true }]]);
  });

  it('the six hours\' memory compares `accountSeen`: the same word does not go again, a changed one does', async () => {
    const gone = new Set<string>([FANS.b]);
    const w = world({ gone, capabilities: REPORTING });
    await w.badges.badges(request([FANS.b]), sender(1));
    await vi.advanceTimersByTimeAsync(0);
    expect(reported(w)).toEqual([[{ fanRef: FANS.b, accountSeen: false }]]);
    // Read again after the kept card expired: the same word within six hours goes nowhere.
    await vi.advanceTimersByTimeAsync(FAN_BADGES_READ.keepMs);
    await w.badges.badges(request([FANS.b]), sender(1));
    await vi.advanceTimersByTimeAsync(0);
    expect(w.call).toHaveBeenCalledTimes(2);
    expect(reported(w)).toHaveLength(1);
    // He is back: the new word goes at once, with his card.
    gone.delete(FANS.b);
    await vi.advanceTimersByTimeAsync(FAN_BADGES_READ.keepMs);
    await w.badges.badges(request([FANS.b]), sender(1));
    await vi.advanceTimersByTimeAsync(0);
    expect(reported(w).at(-1)).toEqual([{ fanRef: FANS.b, recentSpender: false, accountSeen: true }]);
    expect(FAN_BADGES_REPORT.againMs).toBeGreaterThan(2 * FAN_BADGES_READ.keepMs);
  });

  it('«Заметки»\' read of one fan goes into the memory: kept for the boards, answered from it, nothing to the hub', async () => {
    const w = world({ capabilities: REPORTING });
    w.badges.observe(CREATOR, FANS.d, []);
    expect(w.badges.accountRead(CREATOR, FANS.d)).toEqual({ seen: false, at: T0 });
    const answer = await w.badges.badges(request([FANS.d]), sender(1));
    expect(answer.ok && answer.fans).toEqual([{ fanRef: FANS.d, recentSpender: null, tier: null, seen: false, seenAt: T0 }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(w.call).not.toHaveBeenCalled();
    expect(w.fanBadges).not.toHaveBeenCalled();
    // A malformed answer says nothing.
    w.badges.observe(CREATOR, FANS.c, [{ id: 7 }]);
    expect(w.badges.accountRead(CREATOR, FANS.c)).toBeNull();
  });
});
