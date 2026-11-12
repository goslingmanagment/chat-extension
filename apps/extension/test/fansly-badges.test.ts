import type { CgErrorWire } from '@cg/contracts/errors';
import { FanslyApiError, type FanslyCall, type FanslyClient } from '@cg/fansly-api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFanBadges, FAN_BADGES_READ } from '../bg/fansly/badges';
import type { BackgroundKit, HostSiteSender } from '../src/composition/background/host-module';

const CREATOR = '700000000000000017';
const PAGE_ID = 13;
const FANS = { a: '920000000000000003', b: '920000000000000032', c: '930000000000000007', d: '930000000000000038' } as const;
const T0 = Date.UTC(2026, 10, 12, 10);
/** The pacer's `/account*` spacing, as `poll` keeps it (fansly-api pacer/rules.ts). */
const SPACING = 5_000;
const sender = (tab: number): HostSiteSender => ({ kind: 'tab', host: 'fansly-web', tabId: tab, tabSessionId: `tab-${tab}`, url: 'https://fansly.com/messages' });
const request = (fanRefs: readonly string[]) => ({ pageId: PAGE_ID, hostAccountId: CREATOR, fanRefs: [...fanRefs] });

/** Fansly's `GET /account?ids=` answer: every asked fan, the blue card on `a`. */
const accounts = (ids: readonly string[]): unknown => ids.map((id) => ({ id, userFlags: id === FANS.a ? 2 : 0, flags: 0 }));

/**
 * The background's badges over a client that answers as the pacer's `poll` does: a read within the `/account*` spacing
 * of the last one is refused `early`, with the moment it may start, and sends nothing.
 */
function world(options: { readonly early?: (now: number) => number | null } = {}) {
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
    return Promise.resolve({ response: accounts(ids.split(',')), status: 200 });
  });
  const warn = vi.fn();
  const kit = {
    hub: {
      page: (pageId: number) => Promise.resolve(pageId === PAGE_ID ? { ok: true, page: { pageId, pageLabel: 'model-fansly', platform: 'fansly' } } : { ok: false, code: 'CG-BINDING-NOT-GRANTED' }),
      bootstrap: () => ({ capabilities: [], pages: [{ pageId: PAGE_ID, pageLabel: 'model-fansly', platform: 'fansly', platformAccountId: CREATOR }] }),
      facade: { fanBadges: vi.fn(() => Promise.resolve({})) },
      errorWire: (): CgErrorWire => ({ code: 'CG-HUB-UNKNOWN' }),
    },
    clock: { now: () => Date.now(), setTimer: (ms: number, fn: () => void) => setTimeout(fn, ms) as unknown as number, clearTimer: (handle: number) => clearTimeout(handle) },
    networkSession: { aliases: () => [] },
    log: { service: warn },
  } as unknown as BackgroundKit;
  const client: Pick<FanslyClient, 'call'> = { call };
  const badges = createFanBadges(kit, () => Promise.resolve(client), null, () => 0);
  return { badges, call, starts, refusals, warn };
}

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
