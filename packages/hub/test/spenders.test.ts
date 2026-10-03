// Spenders (architecture.md §8.5, §8.7; H-8): the board of up to 1000 rows
// from five hub pages two at a time inside 120 s, its 10-minute shared
// cache, one build per key, progress, the error/empty/timeout states and
// preconditions; detail, batch and buckets with coalescing; statistics and
// «ждут ответа» (parity SP-004…SP-032, SP-007, CS-031…CS-034).

import { getEventListeners } from 'node:events';

import { SPENDERS_BOARD, isHubCallError, isHubCheckError, type CgCode, type SpendersBoard } from '@cg/contracts';
import { BOARD_TOTAL, BOOTSTRAP_ALL_OFF, BOOTSTRAP_PILOT_ON, HTTP_SCENARIOS, HUB_ROUTE_PATHS, NOW, NOW_MS, PAGE, WORLD } from '@cg/testing/hub';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BOARD_SESSION_KEY, errorWireOf } from '../src/index';
import { hubError, json, type RecordedRequest } from './support/fake-hub';
import { flush, makeHarness, signIn, until, type Harness } from './support/harness';
import { okBody, scenarioNamed, signInWorld } from './support/world';

const SIGN_IN = scenarioNamed(HTTP_SCENARIOS, 'sign-in-and-bootstrap-all-off');
const WORLD_PILOT = signInWorld(SIGN_IN, BOOTSTRAP_PILOT_ON, WORLD.user.username);
const BOARD = scenarioNamed(HTTP_SCENARIOS, 'spenders-board-1000');
const STATS = scenarioNamed(HTTP_SCENARIOS, 'spenders-stats-and-queue');
const pageOf = (offset: number) => BOARD.exchanges.find((exchange) => exchange.route === 'spenders' && (exchange.request as { offset: number }).offset === offset)?.response.body;
const TIERS = okBody(BOARD, 'pageSpenderAutoLists');

async function codeOf(promise: Promise<unknown>): Promise<CgCode | null> {
  const error = await promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (reason: unknown) => reason,
  );
  if (!isHubCallError(error) && !isHubCheckError(error)) throw error as Error;
  return errorWireOf(error)?.code ?? null;
}

/** Answers after `ms` of the (fake) clock. */
const later = (ms: number, response: () => Response) => () => new Promise<Response>((resolve) => setTimeout(() => resolve(response()), ms));

let h: Harness;
let open = 0;
let maxOpen = 0;
/** The spenders pages answer after 100 ms each; the open count shows the parallelism. */
function serveBoard(harness: Harness, page: (request: RecordedRequest) => Response | 'hang' = (request) => json(200, pageOf(Number(request.query['offset'])))): void {
  harness.hub
    .on('spenders', (request) => {
      open += 1;
      maxOpen = Math.max(maxOpen, open);
      const answer = page(request);
      if (answer === 'hang') return 'hang';
      return later(100, () => {
        open -= 1;
        return answer;
      })();
    })
    .on('pageSpenderAutoLists', () => json(200, TIERS));
}

beforeEach(async () => {
  vi.useFakeTimers({ now: NOW_MS, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  open = 0;
  maxOpen = 0;
  h = makeHarness({ paths: HUB_ROUTE_PATHS });
  await signIn(h, WORLD_PILOT);
});
afterEach(() => {
  h.facade.dispose();
  vi.useRealTimers();
});

async function board(harness: Harness, request: Parameters<Harness['facade']['spendersBoard']>[0], options?: Parameters<Harness['facade']['spendersBoard']>[1]): Promise<SpendersBoard> {
  const settled = harness.facade.spendersBoard(request, options).then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  await vi.advanceTimersByTimeAsync(1_000);
  const result = await settled;
  if (!result.ok) throw result.error;
  return result.value;
}

describe('[SP-004] [SP-006] [SP-022] [SP-007] the board: hub ranking, up to 1000 rows, tier shelves', () => {
  it('[SP-004] five pages of 200 (two at a time) fill the 1000-row cap of 1240 payers; the shelves are the hub buckets', async () => {
    const left = h.hub.serve(BOARD.exchanges);
    const result = await board(h, { pageLabel: PAGE, period: '30d' });
    expect(left.left()).toEqual([]);
    expect(result.items).toHaveLength(SPENDERS_BOARD.maxRows);
    expect(result.items[0]?.fan.platformUserId).toBe('5000');
    expect(result.items[999]?.fan.platformUserId).toBe('5999');
    expect(result).toMatchObject({ pageLabel: PAGE, period: '30d', total: BOARD_TOTAL, complete: true, fetchedAt: NOW, tiers: TIERS });
    expect(h.hub.unexpected).toEqual([]);
  });

  it('[SP-004] never more than two pages in flight', async () => {
    serveBoard(h);
    await board(h, { pageLabel: PAGE, period: '30d' });
    expect(h.hub.of('spenders')).toHaveLength(5);
    expect(maxOpen).toBe(2);
  });

  it('[SP-006] [SP-022] the period goes to the hub as asked; the board carries the hub\'s period and «as of»', async () => {
    serveBoard(h);
    const result = await board(h, { pageLabel: PAGE, period: '7d' });
    expect(h.hub.of('spenders').map((request) => request.query)).toContainEqual({ scope: 'page', pageLabel: PAGE, period: '7d', limit: '200', offset: '0' });
    expect(result.periodMeta).toMatchObject({ asOf: NOW, timeZone: 'Europe/Moscow' });
    // Five pages of 100 ms, two at a time: the last lands at +300 ms.
    expect(result.fetchedAt).toBe(new Date(NOW_MS + 300).toISOString());
  });

  it('[SP-007] a failed bucket read leaves the board without shelves, not without rows', async () => {
    serveBoard(h);
    h.hub.on('pageSpenderAutoLists', () => hubError(500, 'internal_error'));
    const result = await board(h, { pageLabel: PAGE, period: '30d' });
    expect(result.tiers).toBeNull();
    expect(result.items).toHaveLength(1000);
  });
});

describe('[SP-026] [SP-024] [SP-027] [SP-028] cache, refresh, one build, progress', () => {
  it('[SP-026] 10 minutes in memory and storage.session; then read again', async () => {
    serveBoard(h);
    await board(h, { pageLabel: PAGE, period: '30d' });
    await board(h, { pageLabel: PAGE, period: '30d' });
    expect(h.hub.of('spenders')).toHaveLength(5);
    expect(h.session.data.get(BOARD_SESSION_KEY)).toMatchObject({ v: 1, entries: [{ board: { total: BOARD_TOTAL } }] });
    await vi.advanceTimersByTimeAsync(SPENDERS_BOARD.cacheMs);
    await board(h, { pageLabel: PAGE, period: '30d' });
    expect(h.hub.of('spenders')).toHaveLength(10);
  });

  it('[SP-026] another tab or a background restart gets the cached board from storage.session', async () => {
    serveBoard(h);
    await board(h, { pageLabel: PAGE, period: '30d' });
    const restarted = makeHarness({ paths: HUB_ROUTE_PATHS, local: h.local, session: h.session, hub: h.hub });
    await restarted.facade.ready;
    const cached = await board(restarted, { pageLabel: PAGE, period: '30d' });
    expect(cached.items).toHaveLength(1000);
    expect(h.hub.of('spenders')).toHaveLength(5);
    restarted.facade.dispose();
  });

  it('[SP-024] Refresh skips the cache', async () => {
    serveBoard(h);
    await board(h, { pageLabel: PAGE, period: '30d' });
    await board(h, { pageLabel: PAGE, period: '30d', force: true });
    expect(h.hub.of('spenders')).toHaveLength(10);
  });

  it('[SP-027] one build per key for every tab; it is cancelled when the last waiter leaves', async () => {
    serveBoard(h);
    const [a, b] = await Promise.all([h.facade.spendersBoard({ pageLabel: PAGE, period: '30d' }), h.facade.spendersBoard({ pageLabel: PAGE, period: '30d' }), vi.advanceTimersByTimeAsync(1_000)]);
    expect(a).toBe(b);
    expect(h.hub.of('spenders')).toHaveLength(5);
    // Both waiters leave: the build stops asking the hub.
    const first = new AbortController();
    const second = new AbortController();
    const one = h.facade.spendersBoard({ pageLabel: PAGE, period: 'today' }, { signal: first.signal }).catch((error: unknown) => error);
    const two = h.facade.spendersBoard({ pageLabel: PAGE, period: 'today' }, { signal: second.signal }).catch((error: unknown) => error);
    await until(() => h.hub.of('spenders').length > 5);
    first.abort();
    await flush();
    expect(h.hub.of('spenders').at(-1)?.signal?.aborted).toBe(false);
    second.abort();
    await flush();
    expect(h.hub.of('spenders').at(-1)?.signal?.aborted).toBe(true);
    expect(errorWireOf(await one)).toBeNull();
    expect(errorWireOf(await two)).toBeNull();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.hub.of('spenders').filter((request) => request.query['period'] === 'today')).toHaveLength(1);
  });

  it('[SP-027] a tab asking right after the last waiter left starts a new build, never joins the cancelled one', async () => {
    let hang = true;
    serveBoard(h, (request) => (hang ? 'hang' : json(200, pageOf(Number(request.query['offset'])))));
    const tabA = new AbortController();
    const first = h.facade.spendersBoard({ pageLabel: PAGE, period: '30d' }, { signal: tabA.signal }).catch((error: unknown) => error);
    await until(() => h.hub.of('spenders').length === 1);
    hang = false;
    tabA.abort();
    // Tab B in the same tick: the cancelled build is gone, a new one serves it.
    const second = h.facade.spendersBoard({ pageLabel: PAGE, period: '30d' });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(errorWireOf(await first)).toBeNull();
    await expect(second).resolves.toMatchObject({ complete: true, total: BOARD_TOTAL });
    expect(h.hub.of('spenders')[0]?.signal?.aborted).toBe(true);
    expect(h.hub.of('spenders')).toHaveLength(6);
  });

  it('[SP-027] a settled board leaves no listener on the caller\'s signal', async () => {
    serveBoard(h);
    const tab = new AbortController();
    await board(h, { pageLabel: PAGE, period: '30d' }, { signal: tab.signal });
    await board(h, { pageLabel: PAGE, period: '30d' }, { signal: tab.signal });
    expect(getEventListeners(tab.signal, 'abort')).toHaveLength(0);
  });

  it('[SP-028] the ranking shows after the first page, the rest extends it', async () => {
    serveBoard(h);
    const snapshots: SpendersBoard[] = [];
    await board(h, { pageLabel: PAGE, period: '30d' }, { onProgress: (snapshot) => snapshots.push(snapshot) });
    expect(snapshots[0]).toMatchObject({ complete: false, tiers: null });
    expect(snapshots[0]?.items).toHaveLength(200);
    expect(snapshots.map((snapshot) => snapshot.items.length)).toEqual([200, 400, 600, 800, 1000]);
  });
});

describe('[SP-029] [SP-030] [SP-031] errors are not empty boards', () => {
  it('[SP-029] a failed first page is an error, never an empty board', async () => {
    serveBoard(h, () => hubError(500, 'internal_error'));
    expect(await codeOf(board(h, { pageLabel: PAGE, period: '30d' }))).toBe('CG-HUB-UNAVAILABLE');
  });

  it('[SP-029] a failed later page gives a board marked incomplete, never cached', async () => {
    serveBoard(h, (request) => (request.query['offset'] === '600' ? hubError(503, 'service_unavailable') : json(200, pageOf(Number(request.query['offset'])))));
    const result = await board(h, { pageLabel: PAGE, period: '30d' });
    expect(result.complete).toBe(false);
    expect(result.items).toHaveLength(800);
    await board(h, { pageLabel: PAGE, period: '30d' });
    expect(h.hub.of('spenders').length).toBeGreaterThan(5);
  });

  it('[SP-030] an empty scope is an empty board, not cached for 10 minutes', async () => {
    const empty = { ...(pageOf(0) as object), items: [], total: 0 };
    serveBoard(h, () => json(200, empty));
    const result = await board(h, { pageLabel: PAGE, period: 'today' });
    expect(result).toMatchObject({ items: [], total: 0, complete: true });
    await board(h, { pageLabel: PAGE, period: 'today' });
    expect(h.hub.of('spenders')).toHaveLength(2);
  });

  it('[SP-031] no page inside 120 s is CG-DATA-TIMEOUT; a later page past the budget gives an incomplete board', async () => {
    serveBoard(h, () => 'hang');
    const timedOut = h.facade.spendersBoard({ pageLabel: PAGE, period: '30d' }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(SPENDERS_BOARD.budgetMs);
    expect(errorWireOf(await timedOut)?.code).toBe('CG-DATA-TIMEOUT');
    serveBoard(h, (request) => (request.query['offset'] === '0' ? json(200, pageOf(0)) : 'hang'));
    const partial = h.facade.spendersBoard({ pageLabel: PAGE, period: '7d' });
    await vi.advanceTimersByTimeAsync(SPENDERS_BOARD.budgetMs);
    expect(await partial).toMatchObject({ complete: false, total: BOARD_TOTAL });
  });
});

describe('[SP-032] [SP-023] the board\'s preconditions', () => {
  it('[SP-032] signed in, the page granted; [SP-023] the spenders switch usable, with its reason', async () => {
    expect(await codeOf(h.facade.spendersBoard({ pageLabel: 'not-my-page', period: '30d' }))).toBe('CG-BINDING-NOT-GRANTED');
    await h.facade.signOut();
    expect(await codeOf(h.facade.spendersBoard({ pageLabel: PAGE, period: '30d' }))).toBe('CG-AUTH-REQUIRED');
    await signIn(h, { ...WORLD_PILOT, bootstrap: BOOTSTRAP_ALL_OFF });
    const error = await h.facade.spendersBoard({ pageLabel: PAGE, period: '30d' }).catch((reason: unknown) => reason);
    expect(errorWireOf(error)).toEqual({ code: 'CG-FEATURE-DISABLED', detail: 'flag_off' });
    expect(h.hub.of('spenders')).toEqual([]);
  });

  it('[SP-026] a sign-out forgets the boards of that sign-in', async () => {
    serveBoard(h);
    await board(h, { pageLabel: PAGE, period: '30d' });
    await h.facade.signOut();
    expect(h.session.data.has(BOARD_SESSION_KEY)).toBe(false);
  });
});

describe('[CS-031] [CS-033] detail, batch and buckets: identical reads share one request', () => {
  it('[CS-033] two identical detail reads of one sign-in make one request; another fan makes another', async () => {
    const detail = { scope: (pageOf(0) as { scope: unknown }).scope, fan: (pageOf(0) as { items: { fan: unknown }[] }).items[0]?.fan };
    h.hub.on('spenderDetail', later(50, () => json(200, detail)));
    const query = { platform: 'onlyfans' as const, platformUserId: '5000', scope: 'page' as const, pageLabel: PAGE, period: '30d' as const };
    const both = Promise.all([h.facade.spenderDetail(query), h.facade.spenderDetail(query), h.facade.spenderDetail({ ...query, platformUserId: '5001' })]).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(100);
    await both;
    const requests = h.hub.of('spenderDetail');
    expect(requests.map((request) => request.path)).toEqual(['/api/v2/spenders/onlyfans/5000', '/api/v2/spenders/onlyfans/5001']);
    expect(requests[0]?.query).toEqual({ scope: 'page', pageLabel: PAGE, period: '30d' });
  });

  it('[SP-007] buckets and batch go through the SDK routes with the page checked first', async () => {
    h.hub.on('pageSpenderAutoLists', () => json(200, TIERS));
    await expect(h.facade.autoLists(PAGE)).resolves.toEqual(TIERS);
    expect(h.hub.of('pageSpenderAutoLists')[0]?.path).toBe(`/api/v1/pages/${PAGE}/spender-autolists`);
    expect(await codeOf(h.facade.autoLists('not-my-page'))).toBe('CG-BINDING-NOT-GRANTED');
    h.hub.on('spenderBatch', () => json(500, { error: 'internal_error', message: 'x', statusCode: 500 }));
    const batch = { scope: 'page' as const, pageLabel: PAGE, fans: [{ platform: 'onlyfans' as const, platformUserId: '5000' }] };
    expect(await codeOf(h.facade.spenderBatch(batch))).toBe('CG-HUB-UNAVAILABLE');
    expect(h.hub.of('spenderBatch')[0]).toMatchObject({ method: 'POST', body: batch });
    h.hub.on('spenders', () => json(200, pageOf(0)));
    await expect(h.facade.spenders({ scope: 'page', pageLabel: PAGE, period: '30d', limit: 200, offset: 0 })).resolves.toMatchObject({ total: BOARD_TOTAL });
  });

  it('[HB-006] a request outside its contract is never sent', async () => {
    expect(await codeOf(h.facade.spenders({ scope: 'page', pageLabel: PAGE, period: '30d', limit: 500, offset: 0 }))).toBe('CG-HUB-REQUEST');
    expect(h.hub.of('spenders')).toEqual([]);
  });
});

describe('[SP-023] statistics and «ждут ответа» (H-8b, H-8c)', () => {
  it('[SP-023] the scenario: 30-day stats, two cursor pages of the queue, a page with the switch off on the hub', async () => {
    const left = h.hub.serve(STATS.exchanges);
    const stats = await h.facade.spendersStats({ pageLabel: PAGE, windowDays: 30, timeZone: 'Europe/Moscow' });
    expect(stats).toMatchObject({ pageLabel: PAGE, moneyUnit: 'USD-mills', totals: { d30: { grossMills: 94_350_000 } } });
    const first = await h.facade.awaitingReply({ pageLabel: PAGE, limit: 2 });
    expect(first).toMatchObject({ total: 3, nextCursor: 'queue-2' });
    const second = await h.facade.awaitingReply({ pageLabel: PAGE, cursor: 'queue-2', limit: 2 });
    expect(second.nextCursor).toBeNull();
    await h.facade.autoLists(PAGE);
    const reads = h.hub.of('clientBootstrap').length;
    const error = await h.facade.spendersStats({ pageLabel: WORLD.pages.vip.pageLabel, windowDays: 30, timeZone: 'Europe/Moscow' }).catch((reason: unknown) => reason);
    expect(isHubCallError(error) && error.resolution).toMatchObject({ code: 'CG-FEATURE-DISABLED', disposition: 'refresh-bootstrap' });
    await flush(20);
    expect(h.hub.of('clientBootstrap').length).toBe(reads + 1);
    expect(left.left()).toEqual([]);
    expect(h.hub.of('clientSpenderStats')[0]?.path).toBe(`/api/v1/client/pages/${PAGE}/spenders/stats`);
    expect(h.hub.of('clientSpenderStats')[0]?.query).toEqual({ windowDays: '30', timeZone: 'Europe/Moscow' });
  });

  it('[SP-023] a hub that has not declared the capability is never asked (CG-HUB-CAPABILITY)', async () => {
    await signIn(h, { ...WORLD_PILOT, bootstrap: { ...BOOTSTRAP_PILOT_ON, capabilities: [] } });
    const error = await h.facade.spendersStats({ pageLabel: PAGE, windowDays: 30, timeZone: 'Europe/Moscow' }).catch((reason: unknown) => reason);
    expect(errorWireOf(error)).toEqual({ code: 'CG-HUB-CAPABILITY', detail: 'spenders-stats-v1' });
    expect(h.hub.of('clientSpenderStats')).toEqual([]);
  });
});
