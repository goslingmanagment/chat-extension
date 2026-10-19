// core/domain/spenders against the fake hub's scenario scripts
// (architecture.md §8.5, §8.7): the 1000-row board with its tier buckets,
// shelves and their honest sums, search, filters and sorting, statistics
// with unknowns, the «ждут ответа» queue pages, the archive feed pages and
// the board's keys.

import { describe, expect, it } from 'vitest';

import {
  COVERAGE_LEVELS,
  FEED_SENDERS,
  FeedPageSchema,
  PING_SEGMENTS,
  QueuePageSchema,
  SPENDERS_FILTERS,
  STORAGE_LIMITS,
  SpendersBoardSchema,
  SpendersStatsSchema,
  type AutoLists,
  type FeedPage,
  type QueuePage,
  type SpenderListItem,
  type SpendersBoard,
  type SpendersPage,
  type SpendersStats,
} from '@cg/contracts';
import {
  EMPTY_QUEUE,
  NO_FILTERS,
  OUTSIDE_SHELF_ID,
  UNATTRIBUTED_SHELF_ID,
  appendQueuePage,
  archiveLag,
  boardCommand,
  boardFilterCounts,
  buildShelves,
  calendarDates,
  coverageLevel,
  feedBytes,
  feedRows,
  feedSender,
  filterPressed,
  firstFeedPage,
  indexBoard,
  isNewSpender,
  keepFeed,
  moveRow,
  needsCents,
  neighbours,
  olderFeedPage,
  pingSegment,
  pressFilter,
  queueHasMore,
  queueRow,
  searchNeedle,
  shelfIdOf,
  shelfTotals,
  spenderRow,
  spenderRows,
  orderedTiers,
  statsModel,
  viewBoard,
  withPeriod,
  type BoardKey,
  type BoardQuery,
  type KeptFeed,
} from '@cg/core/domain/spenders';
import { HTTP_SCENARIOS, NOW, spenderRow as scenarioRow } from '@cg/testing/hub';

const scenario = (name: string) => {
  const found = HTTP_SCENARIOS.find((s) => s.name === name);
  if (found === undefined) throw new Error(name);
  return found;
};
const bodies = <T>(name: string, route: string): T[] =>
  scenario(name)
    .exchanges.filter((exchange) => exchange.route === route && exchange.response.status === 200)
    .map((exchange) => exchange.response.body as T);

/** The board the background assembles from the scenario's five pages of 200 and its tier buckets. */
function scenarioBoard(): SpendersBoard {
  const pages = bodies<SpendersPage>('spenders-board-1000', 'spenders');
  const tiers = bodies<AutoLists>('spenders-board-1000', 'pageSpenderAutoLists')[0] ?? null;
  const first = pages[0] as SpendersPage;
  const board: SpendersBoard = {
    pageLabel: 'model-one',
    period: '30d',
    scope: first.scope,
    periodMeta: first.period,
    diagnostics: first.diagnostics,
    items: pages.flatMap((page) => page.items),
    total: first.total,
    complete: true,
    fetchedAt: NOW,
    tiers,
  };
  expect(SpendersBoardSchema.safeParse(board).success).toBe(true);
  return board;
}

/** The hub's standard buckets (SP-007): $600+, $350–600, $150–350, $50–150, $25–50, $1–25. */
const BUCKETS: AutoLists['lists'] = [
  { key: '1-25', label: '$1–25', minAmountMills: 1_000, maxAmountMillsExclusive: 25_000, entryCount: 0 },
  { key: '25-50', label: '$25–50', minAmountMills: 25_000, maxAmountMillsExclusive: 50_000, entryCount: 0 },
  { key: '50-150', label: '$50–150', minAmountMills: 50_000, maxAmountMillsExclusive: 150_000, entryCount: 0 },
  { key: '150-350', label: '$150–350', minAmountMills: 150_000, maxAmountMillsExclusive: 350_000, entryCount: 0 },
  { key: '350-600', label: '$350–600', minAmountMills: 350_000, maxAmountMillsExclusive: 600_000, entryCount: 0 },
  { key: '600-plus', label: '$600+', minAmountMills: 600_000, maxAmountMillsExclusive: null, entryCount: 0 },
];

function tiersOf(counts: Readonly<Record<string, number>>, board: SpendersBoard): AutoLists {
  const base = board.tiers as AutoLists;
  return { ...base, metric: 'lifetimeGrossAmountMills', lists: BUCKETS.map((bucket) => ({ ...bucket, entryCount: counts[bucket.key] ?? 0 })) };
}

interface FanSpec {
  readonly id: string;
  readonly lifetime: number;
  readonly period?: number | null;
  readonly name?: string | null;
  readonly username?: string | null;
  readonly alias?: string | null;
  readonly fanAt?: string | null;
  readonly weAt?: string | null;
  readonly preview?: string | null;
  readonly stored?: number;
}

const at = (seconds: number): string => new Date(Date.parse(NOW) + seconds * 1000).toISOString();

function item(spec: FanSpec): SpenderListItem {
  const base = scenarioRow(0);
  const period = spec.period === undefined ? 0 : spec.period;
  return {
    ...base,
    fan: { ...base.fan, platformUserId: spec.id, username: spec.username === undefined ? `u${spec.id}` : spec.username, displayName: spec.name === undefined ? `Fan ${spec.id}` : spec.name, pageAlias: spec.alias ?? null },
    metrics: {
      ...base.metrics,
      window: period === null || base.metrics.window === null ? null : { ...base.metrics.window, grossAmountMills: period },
      lifetime: { ...base.metrics.lifetime, scopeGrossAmountMills: spec.lifetime },
    },
    lastFanMessageAt: spec.fanAt ?? null,
    conversation: {
      ...base.conversation,
      lastFanMessageAt: spec.fanAt ?? null,
      lastModelMessageAt: spec.weAt === undefined ? at(-3600) : spec.weAt,
      lastMessagePreview: spec.preview ?? null,
      storedMessageCount: spec.stored ?? 12,
      messageCoverageStatus: 'complete',
      messageBackfillComplete: true,
    },
  };
}

function smallBoard(specs: readonly FanSpec[], over: Partial<SpendersBoard> = {}, counts: Readonly<Record<string, number>> = {}): SpendersBoard {
  const base = scenarioBoard();
  const board: SpendersBoard = { ...base, items: specs.map(item), total: specs.length, tiers: tiersOf(counts, base), ...over };
  expect(SpendersBoardSchema.safeParse(board).success).toBe(true);
  return board;
}

const query = (over: Partial<BoardQuery> = {}): BoardQuery => ({ query: '', filters: NO_FILTERS, sort: 'sum', ...over });
const usd = (dollars: number): number => Math.round(dollars * 1000);

describe('the lists repeated from the contracts stay equal to them', () => {
  it('coverage levels, feed senders and Ping segments are narrowed exactly as the contracts list them', () => {
    for (const level of COVERAGE_LEVELS) expect(coverageLevel(level)).toBe(level);
    expect(coverageLevel('exotic')).toBe('unknown');
    expect(coverageLevel(null)).toBe('unknown');
    for (const sender of FEED_SENDERS) expect(feedSender(sender)).toBe(sender);
    expect(feedSender('bot')).toBe('unknown');
    for (const segment of PING_SEGMENTS) expect(pingSegment(segment)).toBe(segment);
    expect(pingSegment('segment-z')).toBe('unknown');
  });
});

describe('[SP-004] [SP-021] the 1000-row board of the hub scenario', () => {
  it('[SP-021] indexes 1000 rows of 1240, says it is cut, and never passes the cut list for the whole scope', () => {
    const index = indexBoard(scenarioBoard());
    expect(index.loaded).toBe(1000);
    expect(index.total).toBe(1240);
    expect(index.truncated).toBe(true);
    expect(index.wholeScope).toBe(false);
    expect(index.coverage).toBe('partial');
    expect(index.rows).toHaveLength(STORAGE_LIMITS.listVisibleRows);
    expect(index.asOf).toBe(NOW);
    expect(index.timeZone).toBe('Europe/Moscow');
  });

  it('[SP-021] a board longer than the visible limit is cut at it', () => {
    const board = scenarioBoard();
    const longer = { ...board, items: [...board.items, ...board.items.slice(0, 5).map((row, i) => ({ ...row, fan: { ...row.fan, platformUserId: String(9000 + i) } }))] };
    const index = indexBoard(longer);
    expect(index.loaded).toBe(1000);
    expect(index.truncated).toBe(true);
  });

  it('[SP-019] a search over 1000 rows finds by handle and by id, well inside its budget', () => {
    const index = indexBoard(scenarioBoard());
    const started = performance.now();
    const byHandle = viewBoard(index, query({ query: 'FAN_42' }));
    const elapsed = performance.now() - started;
    // fan_42, fan_420…fan_429
    expect(byHandle.shown).toBe(11);
    expect(viewBoard(index, query({ query: '5999' })).order).toEqual(['5999']);
    expect(viewBoard(index, query({ query: '@fan_7' })).shown).toBe(111);
    expect(viewBoard(index, query({ query: 'nobody-here' })).shelves).toEqual([]);
    expect(elapsed).toBeLessThan(50);
  });

  it('[SP-006] the period column is the hub window of the board period, the lifetime column the page lifetime', () => {
    const board = scenarioBoard();
    const [top] = spenderRows(board.items, board.period);
    expect(top?.fanRef).toBe('5000');
    expect(top?.period).toBe(1_240_000);
    expect(top?.lifetime).toBe(3_720_000);
    // rank 0 has no display name: the @handle stands in (SP-012).
    expect(top?.name).toBe('fan_0');
  });
});

describe('[SP-007] [SP-008] [SP-011] shelves are the hub buckets', () => {
  const specs: FanSpec[] = [
    { id: '101', lifetime: usd(1200) },
    { id: '102', lifetime: usd(600) },
    { id: '103', lifetime: usd(599.6) },
    { id: '104', lifetime: usd(350) },
    { id: '105', lifetime: usd(149.99) },
    { id: '106', lifetime: usd(25) },
    { id: '107', lifetime: usd(24.99) },
    { id: '108', lifetime: usd(1) },
    { id: '109', lifetime: 400 },
  ];

  it('[SP-007] rows land on the six shelves by the bucket bounds, richest first; the upper bound is exclusive', () => {
    const board = smallBoard(specs);
    const shelves = buildShelves(spenderRows(board.items, board.period), board.tiers);
    expect(shelves.map((shelf) => [shelf.id, shelf.rows.map((row) => row.fanRef)])).toEqual([
      ['shelf-600-plus', ['101', '102']],
      ['shelf-350-600', ['103', '104']],
      ['shelf-150-350', []],
      ['shelf-50-150', ['105']],
      ['shelf-25-50', ['106']],
      ['shelf-1-25', ['107', '108']],
      [OUTSIDE_SHELF_ID, ['109']],
    ]);
    expect(shelves[0]?.range).toEqual({ fromMills: 600_000, toMills: null });
    expect(shelves[1]?.range).toEqual({ fromMills: 350_000, toMills: 600_000 });
  });

  it('[SP-008] a fan below every bucket, or with no known amount, is «вне полок», last', () => {
    const board = smallBoard(specs);
    const view = viewBoard(indexBoard(board), query());
    const last = view.shelves.at(-1);
    expect(last?.id).toBe(OUTSIDE_SHELF_ID);
    expect(last?.range).toEqual({ fromMills: null, toMills: null });
    expect(last?.rows.map((row) => row.fanRef)).toEqual(['109']);
  });

  it('[SP-011] a shelf sum is shown only when every member is loaded; a part is never summed as the whole', () => {
    // The hub says the $600+ shelf has 3 members and the $350–600 shelf 2; the board holds 2 and 2.
    const cut = smallBoard(specs, { total: 12 }, { '600-plus': 3, '350-600': 2 });
    const index = indexBoard(cut);
    expect(index.wholeScope).toBe(false);
    const [whale, top] = index.shelves;
    expect(shelfTotals(whale!, index)).toEqual({ fans: 3, lifetime: null, period: null });
    expect(shelfTotals(top!, index)).toEqual({ fans: 2, lifetime: 949_600, period: 0 });
  });

  it('[SP-011] the hub counts a bucket over the whole page: on a board of a period its count never stands next to the lifetime sum of the period payers', () => {
    // A 30-day board, whole: two of the five fans the hub counts on $600+ paid in the period.
    const board = smallBoard(
      [
        { id: '101', lifetime: usd(1200), period: usd(300) },
        { id: '102', lifetime: usd(600), period: usd(20) },
      ],
      {},
      { '600-plus': 5 },
    );
    const index = indexBoard(board);
    expect(index).toMatchObject({ period: '30d', wholeScope: true, basis: 'page' });
    // The count is the bucket's; the lifetime of two fans is not the bucket's sum; the three not listed paid nothing in the period.
    expect(shelfTotals(index.shelves[0]!, index)).toEqual({ fans: 5, lifetime: null, period: usd(320) });
    expect(viewBoard(index, query()).shelves[0]?.totals).toEqual({ fans: 5, lifetime: null, period: usd(320) });
    // Every member paid in the period: the listed rows are the bucket, and its lifetime sum is theirs.
    const all = indexBoard(smallBoard([{ id: '101', lifetime: usd(1200), period: usd(300) }], {}, { '600-plus': 1 }));
    expect(shelfTotals(all.shelves[0]!, all)).toEqual({ fans: 1, lifetime: usd(1200), period: usd(300) });
    // «Вне полок» has no hub count: its listed rows are not known to be all of it.
    const outside = indexBoard(smallBoard([{ id: '109', lifetime: 400, period: 400 }]));
    expect(shelfTotals(outside.shelves.at(-1)!, outside)).toEqual({ fans: null, lifetime: null, period: 400 });
  });

  it('[SP-011] a narrowed list — a filter, a search, the «ждут ответа» queue — counts the fans it shows on a shelf and sums over them (third live check: «$600+ 31» over five rows)', () => {
    // A 30-day board, whole: the hub counts 31 fans on $600+ over the page; three paid in the period, two of them wait.
    const board = smallBoard(
      [
        { id: '101', lifetime: usd(3208), period: usd(5), fanAt: at(-86_400 * 8), weAt: at(-86_400 * 8 + 60) },
        { id: '102', lifetime: usd(2475), period: usd(1316), fanAt: at(-8 * 3600), weAt: at(-11 * 3600) },
        { id: '103', lifetime: usd(1298), period: usd(55), fanAt: at(-2 * 86_400), weAt: at(-3 * 86_400) },
        { id: '104', lifetime: usd(391), period: usd(10), fanAt: at(-86_400 * 11), weAt: at(-86_400 * 14) },
      ],
      {},
      { '600-plus': 31, '350-600': 25 },
    );
    const index = indexBoard(board);
    expect(index).toMatchObject({ period: '30d', wholeScope: true, basis: 'page' });
    // The plain view keeps the shelf's own numbers: the bucket's count, the period sum of its payers.
    expect(viewBoard(index, query()).shelves.map((shelf) => [shelf.id, shelf.totals])).toEqual([
      ['shelf-600-plus', { fans: 31, lifetime: null, period: usd(1376) }],
      ['shelf-350-600', { fans: 25, lifetime: null, period: usd(10) }],
    ]);
    // «Ждут ответа» (a filter of the loaded rows): two on $600+, one on $350–600 — and the sums are theirs.
    const waiting = viewBoard(index, query({ filters: pressFilter(NO_FILTERS, 'waiting') }));
    expect(waiting.shelves.map((shelf) => [shelf.id, shelf.rows.length, shelf.totals])).toEqual([
      ['shelf-600-plus', 2, { fans: 2, lifetime: usd(2475 + 1298), period: usd(1316 + 55) }],
      ['shelf-350-600', 1, { fans: 1, lifetime: usd(391), period: usd(10) }],
    ]);
    // A search narrows the same way.
    expect(viewBoard(index, query({ query: '101' })).shelves.map((shelf) => shelf.totals)).toEqual([{ fans: 1, lifetime: usd(3208), period: usd(5) }]);
    // The server's queue placed on the shelves: a fan the board does not hold has no period spend — the sum is unknown, not smaller.
    const [queued] = board.items.slice(1, 2).map((entry) => spenderRows([entry], '30d')[0]!);
    const late = { ...queued!, fanRef: '7777', name: 'late_fan', period: null };
    const sourced = viewBoard(index, query({ filters: pressFilter(NO_FILTERS, 'waiting') }), [queued!, late]);
    expect(sourced.shelves.map((shelf) => [shelf.id, shelf.totals])).toEqual([['shelf-600-plus', { fans: 2, lifetime: usd(2475 * 2), period: null }]]);
  });

  it('[SP-011] the whole lifetime board is its own shelves: the count and the sums are of the very rows listed', () => {
    // The hub's bucket counts were read apart from the ranking and say 0 and 7: the header never pairs them with the rows' sums.
    const whole = indexBoard(smallBoard(specs, { period: 'lifetime' }, { '350-600': 7 }));
    expect(whole).toMatchObject({ wholeScope: true, basis: 'scope' });
    expect(shelfTotals(whole.shelves[0]!, whole)).toEqual({ fans: 2, lifetime: 1_800_000, period: 1_800_000 });
    expect(shelfTotals(whole.shelves[1]!, whole)).toEqual({ fans: 2, lifetime: 949_600, period: 949_600 });
    expect(shelfTotals(whole.shelves.at(-1)!, whole)).toEqual({ fans: 1, lifetime: 400, period: 400 });
  });

  it('[SP-011] rows that outnumber the hub count disprove it: the count is unknown and nothing is summed', () => {
    // The fake hub's own board: 1000 rows of 1240 on a shelf the buckets count 31 fans on.
    const index = indexBoard(scenarioBoard());
    const whale = index.shelves.find((shelf) => shelf.id === 'shelf-600-plus');
    expect(whale?.hubCount).toBe(31);
    expect(whale?.rows.length).toBeGreaterThan(31);
    expect(shelfTotals(whale!, index)).toEqual({ fans: null, lifetime: null, period: null });
  });

  it('[SP-011] buckets by the spend of other dates say nothing about the rows of this board', () => {
    const base = smallBoard(specs, {}, { '600-plus': 2, '350-600': 2 });
    const tiers = base.tiers as AutoLists;
    const byPeriod: AutoLists = { ...tiers, metric: 'grossAmountMills' };
    // The board's own dates: the buckets are the board's own.
    expect(indexBoard({ ...base, tiers: byPeriod }).basis).toBe('scope');
    // A lifetime board, or other dates: the hub's counts are of other fans.
    expect(indexBoard({ ...base, period: 'lifetime', tiers: byPeriod }).basis).toBe('foreign');
    const other: AutoLists = { ...byPeriod, period: { ...byPeriod.period, fromBusinessDate: '2026-01-01', toBusinessDateInclusive: '2026-01-31' } };
    const cut = indexBoard({ ...base, total: 12, tiers: other });
    expect(cut).toMatchObject({ basis: 'foreign', wholeScope: false });
    // Shelved by the period's spend (0 here): everyone is «вне полок», and a cut board vouches for nothing.
    expect(cut.shelves.map((shelf) => shelfTotals(shelf, cut))).toEqual(cut.shelves.map(() => ({ fans: null, lifetime: null, period: null })));
    // The whole scope on the board: a shelf is the board's own rows in the range, counted and summed as listed.
    const whole = indexBoard({ ...base, tiers: other });
    expect(shelfTotals(whole.shelves.at(-1)!, whole)).toEqual({ fans: specs.length, lifetime: specs.reduce((total, spec) => total + spec.lifetime, 0), period: 0 });
    expect(shelfTotals(whole.shelves[0]!, whole)).toEqual({ fans: 0, lifetime: 0, period: 0 });
    // No buckets at all: the one shelf is the scope.
    expect(indexBoard({ ...base, tiers: null }).basis).toBe('scope');
  });

  it('[SP-011] an unknown amount makes the shelf sum unknown, not smaller', () => {
    const board = smallBoard([
      { id: '201', lifetime: usd(700), period: 5_000 },
      { id: '202', lifetime: usd(650), period: null },
    ]);
    const index = indexBoard(board);
    expect(shelfTotals(index.shelves[0]!, { wholeScope: true, basis: 'scope' })).toMatchObject({ fans: 2, lifetime: 1_350_000, period: null });
  });

  it('[SP-007] without the buckets (their read failed) the ranking still shows, as one shelf without bounds', () => {
    const board = smallBoard(specs, { tiers: null });
    const index = indexBoard(board);
    expect(index.tiers).toBeNull();
    expect(index.shelves).toHaveLength(1);
    expect(index.shelves[0]?.rows).toHaveLength(specs.length);
  });

  it('a shelf id is a handle the UI can pass back', () => {
    expect(shelfIdOf('600-plus')).toBe('shelf-600-plus');
    expect(shelfIdOf('$600+ / whales')).toBe('shelf-600-whales');
    expect(shelfIdOf('')).toBe('shelf-x');
  });
});

describe('[SP-013] money stays mills; cents only where whole dollars would cross a shelf bound', () => {
  it('asks for cents for $599.60 on the $350–600 shelf and below a dollar, and for nothing else', () => {
    const top = { fromMills: 350_000, toMills: 600_000 };
    expect(needsCents(599_600, top)).toBe(true);
    expect(needsCents(599_400, top)).toBe(false);
    expect(needsCents(400_000, top)).toBe(false);
    expect(needsCents(400, { fromMills: null, toMills: null })).toBe(true);
    expect(needsCents(1_240_500, { fromMills: 600_000, toMills: null })).toBe(false);
    expect(needsCents(null, top)).toBe(false);
    expect(needsCents(0, top)).toBe(false);
  });

  it('the visible list marks exactly those rows', () => {
    const board = smallBoard([
      { id: '301', lifetime: 599_600 },
      { id: '302', lifetime: 450_000 },
      { id: '303', lifetime: 400 },
    ]);
    const view = viewBoard(indexBoard(board), query());
    expect(view.shelves.map((shelf) => [...shelf.cents])).toEqual([['301'], ['303']]);
  });

  it('the bound is the one the row was shelved by: under buckets by a period spend the lifetime has no bound to cross', () => {
    const base = smallBoard([
      { id: '301', lifetime: 599_600, period: 400_000 },
      { id: '302', lifetime: 400, period: 400_000 },
    ]);
    const byPeriod: AutoLists = { ...(base.tiers as AutoLists), metric: 'grossAmountMills' };
    const view = viewBoard(indexBoard({ ...base, tiers: byPeriod }), query());
    // Both sit on $350–600 by their period spend; $599.60 of a lifetime is not on that shelf's bound, 40 cents still print as cents.
    expect(view.shelves.map((shelf) => [shelf.id, shelf.rows.map((row) => row.fanRef), [...shelf.cents]])).toEqual([['shelf-350-600', ['301', '302'], ['302']]]);
    // On a lifetime board the period spend IS the lifetime: the bound applies again.
    const lifetime = viewBoard(indexBoard({ ...base, period: 'lifetime', tiers: byPeriod }), query());
    expect(lifetime.shelves.map((shelf) => [shelf.id, [...shelf.cents]])).toEqual([
      ['shelf-350-600', ['301']],
      [OUTSIDE_SHELF_ID, ['302']],
    ]);
  });
});

describe('[SP-012] [SP-014] [SP-016] [SP-017] a row', () => {
  it('[SP-012] the name is the alias, then the display name, then the handle, then the id', () => {
    expect(spenderRow(item({ id: '401', lifetime: 1, alias: 'Whale Tom', name: 'Tom' }), 0, '30d').name).toBe('Whale Tom');
    expect(spenderRow(item({ id: '401', lifetime: 1, name: 'Tom' }), 0, '30d').name).toBe('Tom');
    expect(spenderRow(item({ id: '401', lifetime: 1, name: null, username: '@tom_k' }), 0, '30d')).toMatchObject({ name: '@tom_k', username: 'tom_k' });
    expect(spenderRow(item({ id: '401', lifetime: 1, name: '  ', username: null }), 0, '30d')).toMatchObject({ name: '401', username: null });
  });

  it('[SP-014] «новый»: the lifetime is the period spend within a dollar; a lifetime board cannot tell', () => {
    expect(isNewSpender(50_000, 50_000, '30d')).toBe(true);
    expect(isNewSpender(50_900, 50_000, 'mtd')).toBe(true);
    expect(isNewSpender(51_000, 50_000, '30d')).toBe(false);
    expect(isNewSpender(50_000, 0, '30d')).toBe(false);
    expect(isNewSpender(50_000, null, '30d')).toBe(false);
    expect(isNewSpender(null, 50_000, '30d')).toBe(false);
    expect(isNewSpender(50_000, 50_000, 'lifetime')).toBe(false);
  });

  it('[SP-015] the ranked board carries no deletion mark, so no row is called «удалён»', () => {
    const board = scenarioBoard();
    expect(spenderRows(board.items, board.period).some((row) => row.deleted)).toBe(false);
  });

  it('[SP-016] the last message shows with «Мы:» only when ours is the later one; no preview is no line', () => {
    expect(spenderRow(item({ id: '1', lifetime: 1, preview: 'hello', fanAt: at(-60), weAt: at(-600) }), 0, '30d').lastMessage).toEqual({ fromUs: false, text: 'hello' });
    expect(spenderRow(item({ id: '1', lifetime: 1, preview: 'look', fanAt: at(-600), weAt: at(-60) }), 0, '30d').lastMessage).toEqual({ fromUs: true, text: 'look' });
    expect(spenderRow(item({ id: '1', lifetime: 1, preview: null }), 0, '30d').lastMessage).toBeNull();
  });

  it('[SP-017] «Фан писал» / «Мы писали»: the fan waits when theirs is the later message; unknown times stay unknown', () => {
    const waiting = spenderRow(item({ id: '1', lifetime: 1, fanAt: at(-60), weAt: at(-600) }), 0, '30d');
    expect(waiting).toMatchObject({ waiting: true, fanWroteAt: at(-60), weWroteAt: at(-600) });
    expect(spenderRow(item({ id: '1', lifetime: 1, fanAt: at(-600), weAt: at(-60) }), 0, '30d').waiting).toBe(false);
    expect(spenderRow(item({ id: '1', lifetime: 1, fanAt: at(-60), weAt: null }), 0, '30d').waiting).toBe(true);
    expect(spenderRow(item({ id: '1', lifetime: 1, fanAt: null, weAt: null }), 0, '30d')).toMatchObject({ waiting: false, fanWroteAt: null, weWroteAt: null });
  });

  it('a lifetime board has no separate window: its period column is the lifetime itself', () => {
    expect(spenderRow(item({ id: '1', lifetime: 700_000, period: null }), 0, 'lifetime').period).toBe(700_000);
    expect(spenderRow(item({ id: '1', lifetime: 700_000, period: null }), 0, '7d').period).toBeNull();
  });
});

describe('[X66] [SP-018] [SP-019] [SP-020] the visible list', () => {
  const specs: FanSpec[] = [
    { id: '501', lifetime: usd(900), period: usd(900), name: 'Anna', fanAt: at(-86_400 * 3), weAt: at(-86_400) },
    { id: '502', lifetime: usd(800), name: 'Boris', fanAt: at(-60), weAt: at(-3600) },
    { id: '503', lifetime: usd(700), name: 'Clara', fanAt: null, weAt: null, stored: 0 },
    { id: '504', lifetime: usd(650), name: 'Dmitri', fanAt: at(-600), weAt: at(-300) },
    { id: '505', lifetime: usd(620), name: 'Eva', fanAt: at(-7200), weAt: at(-86_400 * 2) },
    { id: '506', lifetime: usd(400), name: 'Fedor' },
    { id: '507', lifetime: usd(380), name: 'Ｇｌｅｂ' },
    { id: '508', lifetime: usd(360), name: 'Hanna' },
  ];
  const index = indexBoard(smallBoard(specs));

  it('[X66] the plain view shows every fan of every shelf: no preview of four and two rows', () => {
    const plain = viewBoard(index, query());
    expect(plain.shelves.map((shelf) => [shelf.id, shelf.rows.length])).toEqual([
      ['shelf-600-plus', 5],
      ['shelf-350-600', 3],
    ]);
    expect(plain.shown).toBeNull();
    expect(plain.order).toEqual(['501', '502', '503', '504', '505', '506', '507', '508']);
  });

  it('[X66] the list is the lifetime board; the second sum is the period board\'s, zero for a fan a whole period board does not list', () => {
    const list = indexBoard(smallBoard([{ id: '601', lifetime: usd(900) }, { id: '602', lifetime: usd(700) }, { id: '603', lifetime: usd(40) }], { period: 'lifetime' }));
    const d30 = indexBoard(smallBoard([{ id: '601', lifetime: usd(900), period: usd(120) }, { id: '603', lifetime: usd(40), period: usd(40) }]));
    const merged = withPeriod(list, '30d', d30);
    expect(merged.rows.map((row) => [row.fanRef, row.period, row.isNew])).toEqual([
      ['601', usd(120), false],
      ['602', 0, false],
      ['603', usd(40), true],
    ]);
    expect(merged.period).toBe('30d');
    expect([merged.loaded, merged.total, merged.basis]).toEqual([list.loaded, list.total, list.basis]);
    expect(merged.shelves.map((shelf) => shelf.rows.map((row) => row.fanRef))).toEqual(list.shelves.map((shelf) => shelf.rows.map((row) => row.fanRef)));
    // Not read yet, or its read failed: unknown — never the lifetime again, never a zero.
    expect(withPeriod(list, '30d', null).rows.map((row) => row.period)).toEqual([null, null, null]);
    // A period board cut at its limit cannot prove a zero.
    const cut = indexBoard(smallBoard([{ id: '601', lifetime: usd(900), period: usd(120) }], { total: 5 }));
    expect(withPeriod(list, '30d', cut).rows.map((row) => row.period)).toEqual([usd(120), null, null]);
  });

  it('[SP-018] inside a shelf: by the sum, or by how recently the fan wrote with never-wrote last', () => {
    const bySum = viewBoard(index, query());
    expect(bySum.shelves[0]?.rows.map((row) => row.fanRef)).toEqual(['501', '502', '503', '504', '505']);
    const byFan = viewBoard(index, query({ sort: 'fan-age' }));
    expect(byFan.shelves[0]?.rows.map((row) => row.fanRef)).toEqual(['502', '504', '505', '501', '503']);
  });

  it('[SP-019] the search normalizes case, a leading «@» and full-width letters an IME leaves', () => {
    expect(searchNeedle('  @Boris ')).toBe('boris');
    expect(viewBoard(index, query({ query: 'BORIS' })).order).toEqual(['502']);
    expect(viewBoard(index, query({ query: 'gleb' })).order).toEqual(['507']);
    expect(viewBoard(index, query({ query: 'ｇｌｅ' })).order).toEqual(['507']);
    expect(viewBoard(index, query({ query: '508' })).order).toEqual(['508']);
    const found = viewBoard(index, query({ query: 'a' }));
    expect(found.narrowed).toBe(true);
    expect(found.shown).toBe(found.order.length);
  });

  it('[SP-020] filters: one pressed at a time in each of the three groups; «Все» lifts them all', () => {
    let filters = pressFilter(NO_FILTERS, 'waiting');
    expect(filters).toEqual({ main: 'waiting', lastMessage: null, history: null });
    filters = pressFilter(filters, 'new');
    expect(filters.main).toBe('new');
    filters = pressFilter(filters, 'we-wrote');
    filters = pressFilter(filters, 'fan-wrote');
    expect(filters.lastMessage).toBe('fan-wrote');
    filters = pressFilter(filters, 'fan-wrote');
    expect(filters.lastMessage).toBeNull();
    filters = pressFilter(filters, 'no-history');
    expect(filterPressed(filters, 'no-history')).toBe(true);
    expect(filterPressed(filters, 'all')).toBe(false);
    expect(pressFilter(filters, 'all')).toEqual(NO_FILTERS);
    expect(filterPressed(NO_FILTERS, 'all')).toBe(true);
  });

  it('[SP-020] each filter shows its rows; the counters count loaded rows', () => {
    const show = (filter: (typeof SPENDERS_FILTERS)[number]): readonly string[] => viewBoard(index, query({ filters: pressFilter(NO_FILTERS, filter) })).order;
    expect(show('waiting')).toEqual(['502', '505']);
    expect(show('fan-wrote')).toEqual(['502', '505']);
    expect(show('we-wrote')).toEqual(['501', '504', '506', '507', '508']);
    expect(show('new')).toEqual(['501']);
    expect(show('no-history')).toEqual(['503']);
    expect(show('history')).toHaveLength(7);
    expect(boardFilterCounts(index, SPENDERS_FILTERS)).toEqual({ all: 8, waiting: 2, new: 1, 'we-wrote': 5, 'fan-wrote': 2, history: 7, 'no-history': 1 });
  });

  it('[SP-056] the neighbours of a fan follow the visible order and stop at its ends', () => {
    const order = viewBoard(index, query()).order;
    expect(neighbours(order, '502')).toEqual({ previous: '501', next: '503' });
    expect(neighbours(order, '501')).toEqual({ previous: null, next: '502' });
    expect(neighbours(order, '507')).toEqual({ previous: '506', next: '508' });
    expect(neighbours(order, '508')).toEqual({ previous: '507', next: null });
    expect(neighbours(order, '999')).toEqual({ previous: null, next: null });
  });
});

describe('[SP-044] [SP-045] [SP-046] [SP-048] statistics are the hub numbers, with honest unknowns', () => {
  const stats = bodies<SpendersStats>('spenders-stats-and-queue', 'clientSpenderStats')[0] as SpendersStats;

  it('[SP-044] shows the hub totals as sent: today, 7 days against the previous 7, 30 days, payers, average check', () => {
    expect(SpendersStatsSchema.safeParse(stats).success).toBe(true);
    const model = statsModel(stats);
    expect(model).toMatchObject({
      windowDays: 30,
      timeZone: 'Europe/Moscow',
      asOf: NOW,
      coverage: 'complete',
      today: 3_290_000,
      d7: 22_820_000,
      prev7: 22_330_000,
      changePct: 2.19,
      d30: 94_350_000,
      purchases: 1635,
      payers: 640,
      avgCheck: 58_623,
    });
    expect(model.days).toHaveLength(30);
    expect(model.days.at(-1)).toEqual({ date: '2026-10-03', gross: 3_290_000, today: true });
    expect(model.days.filter((day) => day.today)).toHaveLength(1);
  });

  it('[SP-044] stats nulls are unknown, never zero: no average check, no change against an empty week, a day the hub left out, an unknown coverage word', () => {
    const sparse: SpendersStats = {
      ...stats,
      avgCheckMills: null,
      totals: { ...stats.totals, d7DeltaPct: null },
      days: stats.days.filter((day) => day.date !== '2026-09-20'),
      coverage: { state: 'backfilling', reasons: ['history_incomplete'] },
    };
    const model = statsModel(sparse);
    expect(model.avgCheck).toBeNull();
    expect(model.changePct).toBeNull();
    expect(model.coverage).toBe('unknown');
    expect(model.days).toHaveLength(30);
    expect(model.days.find((day) => day.date === '2026-09-20')).toEqual({ date: '2026-09-20', gross: null, today: false });
    expect(model.days.filter((day) => day.gross === null)).toHaveLength(1);
  });

  it('[SP-045] shelves: bars by the share of the period sum (never shorter than 4 %, empty at zero); lifetime only what the board can vouch for', () => {
    const model = statsModel(stats, new Map([['shelf-600-plus', 31_480_000]]));
    expect(model.shelves.map((shelf) => [shelf.id, shelf.fans, shelf.period, shelf.lifetime])).toEqual([
      ['shelf-600-plus', 31, 40_000_000, 31_480_000],
      ['shelf-0-25', 1100, 53_100_000, null],
      [OUTSIDE_SHELF_ID, 109, 0, null],
      [UNATTRIBUTED_SHELF_ID, 0, 1_250_000, null],
    ]);
    const [whale, micro, outside, unattributed] = model.shelves.map((shelf) => shelf.share);
    expect(whale).toBeCloseTo(40 / 94.35, 5);
    expect(micro).toBeCloseTo(53.1 / 94.35, 5);
    expect(outside).toBe(0);
    // A sliver of the window's money is still a bar one can see.
    expect(unattributed).toBe(0.04);
    const tiny = statsModel({ ...stats, tiers: [{ ...stats.tiers[0]!, windowGrossMills: 1_000 }, { ...stats.tiers[1]!, windowGrossMills: 99_000_000 }] });
    expect(tiny.shelves.find((shelf) => shelf.id === 'shelf-0-25')?.share).toBe(0.04);
  });

  it('[SP-045] the hub’s two remainder tiers — both without bounds — are two rows, told by their keys; the table runs from the richest tier down whatever order the hub sent', () => {
    // As the hub sends them: tiers ascending, then `untiered` and `unattributed`.
    expect(stats.tiers.map((tier) => [tier.key, tier.minMills, tier.maxMills])).toEqual([
      ['0-25', 10, 25_000],
      ['600-plus', 600_000, null],
      ['untiered', null, null],
      ['unattributed', null, null],
    ]);
    const model = statsModel(stats);
    expect(model.shelves.map((shelf) => [shelf.id, shelf.remainder ?? null])).toEqual([
      ['shelf-600-plus', null],
      ['shelf-0-25', null],
      [OUTSIDE_SHELF_ID, 'untiered'],
      [UNATTRIBUTED_SHELF_ID, 'unattributed'],
    ]);
    // No two rows share an id (a list key), though two of them share their — missing — bounds.
    expect(new Set(model.shelves.map((shelf) => shelf.id)).size).toBe(model.shelves.length);
    expect(model.shelves.filter((shelf) => shelf.range.fromMills === null && shelf.range.toMills === null)).toHaveLength(2);

    const tier = (key: string, minMills: number | null, maxMills: number | null = null) => ({ key, label: key, minMills, maxMills, members: 1, windowPayers: 1, windowGrossMills: 1_000 });
    const shuffled = [tier('unattributed', null), tier('25-50', 25_000, 50_000), tier('someday', null), tier('untiered', null), tier('600-plus', 600_000), tier('below', null, 10), tier('0-25', 10, 25_000), tier('150-350', 150_000, 350_000)];
    expect(orderedTiers(shuffled).map((item) => item.key)).toEqual(['600-plus', '150-350', '25-50', '0-25', 'below', 'untiered', 'unattributed', 'someday']);
    // A remainder is told by its key alone: a tier that merely lacks bounds is a row of its own key, never «без тира».
    const unknown = statsModel({ ...stats, tiers: [tier('someday', null), tier('untiered', null)] });
    expect(unknown.shelves.map((shelf) => [shelf.id, shelf.remainder ?? null])).toEqual([
      [OUTSIDE_SHELF_ID, 'untiered'],
      ['shelf-someday', null],
    ]);
    // An older hub that sends one remainder, or none: nothing is invented.
    expect(statsModel({ ...stats, tiers: stats.tiers.slice(0, 3) }).shelves.map((shelf) => shelf.id)).toEqual(['shelf-600-plus', 'shelf-0-25', OUTSIDE_SHELF_ID]);
    expect(statsModel({ ...stats, tiers: [] }).shelves).toEqual([]);
  });

  it('[SP-046] [SP-048] silence buckets, «нет данных» and new payers come from the hub; an incomplete past says «первая наблюдённая»', () => {
    const model = statsModel(stats);
    expect(model).toMatchObject({ silent8to21: 120, silentOver21: 300, noData: 12, newPayers: 57, newPayersFirstObserved: false, awaiting: 3, awaitingUnknown: 1 });
    // SP-046: «сумма трат молчащих >21 д» is the hub's own sum over the whole page, never one over the rows of the board.
    expect(model.silentOver21Lifetime).toBe(15_000_000);
    expect(statsModel({ ...stats, newPayers: { count: 9, firstPurchaseKnown: false } })).toMatchObject({ newPayers: 9, newPayersFirstObserved: true });
  });

  it('the calendar of a window is every date from its first to its last day', () => {
    expect(calendarDates('2026-09-29', '2026-10-02')).toEqual(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
    expect(calendarDates('2026-10-03', '2026-10-01')).toEqual([]);
    expect(calendarDates('nope', '2026-10-01')).toEqual([]);
  });
});

describe('[SP-047] «ждут ответа» comes in cursor pages from the hub', () => {
  const pages = bodies<QueuePage>('spenders-stats-and-queue', 'clientSpenderAwaitingReply');
  const [first, second] = pages as [QueuePage, QueuePage];

  it('appends the pages in cursor order with the hub total, loaded and unknown', () => {
    expect(pages.every((page) => QueuePageSchema.safeParse(page).success)).toBe(true);
    let state = appendQueuePage(EMPTY_QUEUE, null, first);
    expect(state.items.map((item) => item.fanRef)).toEqual(['5000', '5003']);
    expect(state).toMatchObject({ total: 3, unknown: 1, nextCursor: 'queue-2', asOf: NOW });
    expect(queueHasMore(state)).toBe(true);
    state = appendQueuePage(state, 'queue-2', second);
    expect(state.items.map((item) => item.fanRef)).toEqual(['5000', '5003', '5006']);
    expect(queueHasMore(state)).toBe(false);
  });

  it('a page that answers another cursor (a late answer of an older walk) changes nothing; a fan is listed once', () => {
    const state = appendQueuePage(EMPTY_QUEUE, null, first);
    expect(appendQueuePage(state, 'queue-9', second)).toBe(state);
    expect(appendQueuePage(state, null, second)).toBe(state);
    const again = appendQueuePage(state, 'queue-2', { ...second, items: [...first.items, ...second.items] });
    expect(again.items.map((item) => item.fanRef)).toEqual(['5000', '5003', '5006']);
  });

  it('a queue fan takes the board row when it has one, otherwise what the queue knows — the period spend stays unknown', () => {
    const board = scenarioBoard();
    const index = indexBoard(board);
    const item = first.items[0]!;
    const known = queueRow(item, 0, index.byFan.get(item.fanRef), '30d');
    expect(known).toMatchObject({ fanRef: '5000', waiting: true, period: 1_240_000, fanWroteAt: item.lastFanMessageAt });
    const unknown = queueRow({ ...item, fanRef: '7777', username: 'late_fan' }, 1, undefined, '30d');
    expect(unknown).toMatchObject({ fanRef: '7777', name: 'late_fan', period: null, lifetime: item.lifetimeGrossMills, retention: null, waiting: true });
    // The queue's rows sit on the board's own shelves.
    const view = viewBoard(index, query({ filters: pressFilter(NO_FILTERS, 'waiting') }), [known, unknown]);
    expect(view.order).toEqual(['5000', '7777']);
    expect(view.shown).toBe(2);
  });
});

describe('[SP-050] [SP-053] [AI-038] [DB-026] the archive feed of a preview', () => {
  const pages = bodies<FeedPage>('feed-pages', 'clientConversationFeed');
  const [first, second, third] = pages as [FeedPage, FeedPage, FeedPage];

  it('[SP-053] three pages newest → oldest by cursor: 50 + 50 + 12, no message twice, then nothing older', () => {
    expect(pages.every((page) => FeedPageSchema.safeParse(page).success)).toBe(true);
    let feed = firstFeedPage(first);
    expect(feed.items).toHaveLength(50);
    expect(feed.nextOlderCursor).toBe('feed-2');
    const two = olderFeedPage(feed, 'feed-2', second);
    expect(two.kind).toBe('appended');
    if (two.kind !== 'appended') return;
    feed = two.state;
    const three = olderFeedPage(feed, 'feed-3', third);
    if (three.kind !== 'appended') throw new Error('third page');
    feed = three.state;
    expect(feed.items).toHaveLength(112);
    expect(new Set(feed.items.map((item) => item.messageId)).size).toBe(112);
    expect(feed.nextOlderCursor).toBeNull();
    expect(feed.truncated).toBe(false);
  });

  it('[SP-053] a page for another cursor, or of another snapshot, is not spliced in', () => {
    const feed = firstFeedPage(first);
    expect(olderFeedPage(feed, 'feed-3', third)).toEqual({ kind: 'ignored', reason: 'cursor' });
    expect(olderFeedPage(feed, 'feed-2', { ...second, snapshotRevision: 'snap-0043' })).toEqual({ kind: 'ignored', reason: 'snapshot' });
    const done = { ...feed, nextOlderCursor: null };
    expect(olderFeedPage(done, 'feed-2', second)).toEqual({ kind: 'ignored', reason: 'cursor' });
  });

  it('[AI-038] the Ping segment and the fan silence are the hub summary of the first page, never derived from rows', () => {
    expect(firstFeedPage(first).ping).toEqual({ segment: 'active', fanSilenceDays: 0 });
    expect(firstFeedPage({ ...first, summary: { ...first.summary!, pingSegment: 'segment-b', fanSilenceDays: 9 } }).ping).toEqual({ segment: 'segment-b', fanSilenceDays: 9 });
    expect(firstFeedPage({ ...first, summary: { ...first.summary!, pingSegment: 'segment-q', fanSilenceDays: null } }).ping).toEqual({ segment: 'unknown', fanSilenceDays: null });
    expect(firstFeedPage({ ...first, summary: null }).ping).toBeNull();
  });

  it('[DB-026] coverage and lag: an archive behind the chat says by how much; an unknown coverage word is unknown', () => {
    expect(archiveLag(firstFeedPage(first))).toBeNull();
    const behind = firstFeedPage({ ...first, newestKnownAt: at(130), head: { messageRef: '6000', at: at(0), sender: 'fan' } });
    expect(archiveLag(behind)).toEqual({ minutes: 3 });
    const noHead = firstFeedPage({ ...first, items: [], head: null, newestKnownAt: at(0) });
    expect(archiveLag(noHead)).toEqual({ minutes: null });
    expect(firstFeedPage({ ...first, coverage: 'partial' }).coverage).toBe('partial');
    expect(firstFeedPage({ ...first, coverage: 'backfilling' }).coverage).toBe('unknown');
  });

  it('[SP-050] rows read oldest first with a day separator at each new day; tips and prices stay mills, a message without time breaks no day', () => {
    const feed = firstFeedPage(first);
    const rows = feedRows(feed, (iso) => iso.slice(0, 10));
    expect(rows).toHaveLength(50);
    expect(rows[0]?.id).toBe('6049');
    expect(rows.at(-1)?.id).toBe('6000');
    expect(rows[0]?.dayBreak).toBe(true);
    expect(rows.filter((row) => row.dayBreak).length).toBe(new Set(feed.items.map((item) => item.at?.slice(0, 10))).size);
    expect(rows.find((row) => row.id === '6013')).toMatchObject({ tip: 10_000, price: null });
    expect(rows.find((row) => row.id === '6011')).toMatchObject({ price: { mills: 15_000, purchased: null }, attachments: ['[Photo]'], text: '' });
    expect(rows.find((row) => row.id === '6007')?.deleted).toBe(true);
    const timeless = feedRows({ ...feed, items: feed.items.slice(0, 2).map((item) => ({ ...item, at: null })) }, (iso) => iso.slice(0, 10));
    expect(timeless.every((row) => !row.dayBreak && row.at === null)).toBe(true);
  });

  it('[SP-050] a deleted message is a tombstone without its text: a bubble keeps its row (the UI says «сообщение удалено» under it), a deleted system line gets those words as its text, and a system line with nothing to say is not a row', () => {
    const feed = firstFeedPage(first);
    type FeedItem = (typeof feed.items)[number];
    const item = (messageId: string, patch: Partial<FeedItem>): FeedItem => ({ messageId, at: `2026-10-0${messageId.slice(1)}T09:00:00.000Z`, sender: 'fan', text: 'hello', automatic: null, deleted: false, tipMills: null, priceMills: null, attachmentLabels: [], ...patch });
    // Newest first, as the hub sends a page.
    const items = [
      item('m6', { text: 'still here' }),
      item('m5', { sender: 'system', text: 'renewed', deleted: true }),
      item('m4', { sender: 'system', text: '' }),
      item('m3', { sender: 'system', text: '', deleted: true }),
      item('m2', { sender: 'model', text: '', deleted: true }),
      item('m1', { text: '', deleted: true }),
    ];
    const rows = feedRows({ ...feed, items }, (iso) => iso.slice(0, 10), 'сообщение удалено');
    expect(rows.map((row) => [row.id, row.sender, row.text, row.deleted])).toEqual([
      ['m1', 'fan', '', true],
      ['m2', 'model', '', true],
      ['m3', 'system', 'сообщение удалено', true],
      ['m5', 'system', 'renewed', true],
      ['m6', 'fan', 'still here', false],
    ]);
    // No system row is ever empty, and the row that was dropped starts no day of its own.
    expect(rows.some((row) => row.sender === 'system' && row.text === '')).toBe(false);
    expect(rows.filter((row) => row.dayBreak).map((row) => row.id)).toEqual(['m1', 'm2', 'm3', 'm5', 'm6']);
    // Without the words (a caller that has none) a deleted system line has nothing to say either.
    expect(feedRows({ ...feed, items }, (iso) => iso.slice(0, 10)).map((row) => row.id)).toEqual(['m1', 'm2', 'm5', 'm6']);
  });

  it('kept feeds: the newest page of the ten most recent previews, a hundred messages each, two MiB together', () => {
    const page = firstFeedPage(first);
    let kept: KeptFeed[] = [];
    for (let i = 0; i < 12; i += 1) kept = keepFeed(kept, { key: `fan-${i}`, conversationRef: `fan-${i}`, first: page, keptAt: i });
    expect(kept).toHaveLength(STORAGE_LIMITS.previewFeeds);
    expect(kept[0]?.key).toBe('fan-11');
    expect(kept.some((entry) => entry.key === 'fan-0')).toBe(false);
    // Keeping one again moves it to the front without a second copy.
    kept = keepFeed(kept, { key: 'fan-5', conversationRef: 'fan-5', first: page, keptAt: 99 });
    expect(kept.filter((entry) => entry.key === 'fan-5')).toHaveLength(1);
    expect(kept[0]?.key).toBe('fan-5');
    // A page longer than a kept feed may be is cut, and loses the cursor that pointed behind its end.
    const long = { ...page, items: Array.from({ length: 130 }, (_, i) => ({ ...page.items[0]!, messageId: String(8000 + i) })) };
    const cut = keepFeed([], { key: 'long', conversationRef: 'long', first: long, keptAt: 1 })[0]!;
    expect(cut.first.items).toHaveLength(STORAGE_LIMITS.previewFeedMessages);
    expect(cut.first.nextOlderCursor).toBeNull();
    // Bytes: huge feeds push the oldest out before the count does.
    const huge = { ...page, items: page.items.map((item) => ({ ...item, text: 'x'.repeat(8000) })) };
    expect(feedBytes(huge)).toBeGreaterThan(700_000);
    let heavy: KeptFeed[] = [];
    for (let i = 0; i < 6; i += 1) heavy = keepFeed(heavy, { key: `h-${i}`, conversationRef: `h-${i}`, first: huge, keptAt: i });
    expect(heavy.length).toBeLessThan(6);
    expect(heavy.reduce((sum, entry) => sum + feedBytes(entry.first), 0)).toBeLessThanOrEqual(STORAGE_LIMITS.previewFeedsTotalBytes);
  });
});

describe('[SP-033] the board keys are read by code, not by the printed letter', () => {
  const key = (code: string, over: Partial<BoardKey> = {}): BoardKey => ({ code, ctrl: false, meta: false, alt: false, shift: false, composing: false, ...over });
  const idle = { typing: false, searching: false, previewOpen: false, inPreview: false };

  it('J/K and the arrows move, Enter and O open, Space previews, S toggles the statistics, / focuses the search', () => {
    expect(boardCommand(key('KeyJ'), idle)).toBe('row-next');
    expect(boardCommand(key('ArrowDown'), idle)).toBe('row-next');
    expect(boardCommand(key('KeyK'), idle)).toBe('row-previous');
    expect(boardCommand(key('ArrowUp'), idle)).toBe('row-previous');
    expect(boardCommand(key('Enter'), idle)).toBe('open-chat');
    expect(boardCommand(key('KeyO'), idle)).toBe('open-chat');
    expect(boardCommand(key('Space'), idle)).toBe('preview');
    expect(boardCommand(key('KeyS'), idle)).toBe('toggle-stats');
    expect(boardCommand(key('Slash'), idle)).toBe('focus-search');
    expect(boardCommand(key('KeyQ'), idle)).toBeNull();
  });

  it('Esc goes in order: clear the search → close the preview → close the board', () => {
    expect(boardCommand(key('Escape'), { ...idle, searching: true, previewOpen: true, typing: true })).toBe('clear-search');
    expect(boardCommand(key('Escape'), { ...idle, previewOpen: true })).toBe('close-preview');
    expect(boardCommand(key('Escape'), idle)).toBe('close-board');
  });

  it('letters are text while the person types; a modifier, Shift+/ and an IME composition are never ours', () => {
    const typing = { ...idle, typing: true };
    expect(boardCommand(key('KeyJ'), typing)).toBeNull();
    expect(boardCommand(key('Space'), typing)).toBeNull();
    expect(boardCommand(key('Slash'), typing)).toBeNull();
    expect(boardCommand(key('KeyJ', { meta: true }), idle)).toBeNull();
    expect(boardCommand(key('KeyS', { ctrl: true }), idle)).toBeNull();
    expect(boardCommand(key('Slash', { shift: true }), idle)).toBeNull();
    expect(boardCommand(key('KeyJ', { composing: true }), idle)).toBeNull();
    expect(boardCommand(key('Escape', { composing: true }), { ...idle, searching: true })).toBeNull();
  });

  it('[SP-056] inside the preview the same keys move between fans', () => {
    const inside = { ...idle, previewOpen: true, inPreview: true };
    expect(boardCommand(key('ArrowRight'), inside)).toBe('fan-next');
    expect(boardCommand(key('KeyJ'), inside)).toBe('fan-next');
    expect(boardCommand(key('ArrowLeft'), inside)).toBe('fan-previous');
    expect(boardCommand(key('KeyK'), inside)).toBe('fan-previous');
    expect(boardCommand(key('Space'), inside)).toBeNull();
  });

  it('movement stays at either end and starts from the first row', () => {
    const order = ['a', 'b', 'c'];
    expect(moveRow(order, null, 'next')).toBe('a');
    expect(moveRow(order, 'a', 'next')).toBe('b');
    expect(moveRow(order, 'c', 'next')).toBe('c');
    expect(moveRow(order, 'a', 'previous')).toBe('a');
    expect(moveRow(order, 'gone', 'previous')).toBe('a');
    expect(moveRow([], null, 'next')).toBeNull();
  });
});
