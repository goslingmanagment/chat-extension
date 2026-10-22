// The board as a table (1.44.0): the sorts of its headers, the silence filters of «Кому написать», and the
// statistics in the model's net — the logic the owner's redesign added, where a slip would show the wrong fans or
// the wrong money.

import { type SpendersStats } from '@cg/contracts/hub';
import { describe, expect, it } from 'vitest';

import { viewBoard, type BoardIndex } from './board';
import { NO_FILTERS, pressFilter, rowPasses, silentDays, sortRows } from './filters';
import { type SpenderRow } from './rows';
import { buildShelves } from './shelves';
import { changePct, feePct, netAvgCheck, statsModel } from './stats';

const NOW = Date.parse('2026-10-22T12:00:00Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = (msAgo: number | null): string | null => (msAgo === null ? null : new Date(NOW - msAgo).toISOString());

function row(fanRef: string, rank: number, patch: { lifetime?: number | null; period?: number | null; fanAgo?: number | null; weAgo?: number | null } = {}): SpenderRow {
  const fanWroteAt = at(patch.fanAgo ?? null);
  const weWroteAt = at(patch.weAgo ?? null);
  const waiting = fanWroteAt !== null && (weWroteAt === null || Date.parse(fanWroteAt) > Date.parse(weWroteAt));
  return {
    fanRef,
    conversationRef: null,
    name: `Fan ${fanRef}`,
    username: null,
    lifetime: patch.lifetime === undefined ? 100_000 : patch.lifetime,
    period: patch.period === undefined ? 0 : patch.period,
    isNew: false,
    deleted: false,
    weWroteAt,
    fanWroteAt,
    waiting,
    lastMessage: null,
    history: 'complete',
    storedMessages: 10,
    retention: null,
    rank,
    haystack: fanRef,
  };
}

const order = (rows: readonly SpenderRow[]): string[] => rows.map((item) => item.fanRef);

describe('the sorts of the table headers', () => {
  // a waits 2 h, b waits 3 d, c we answered, d never wrote; e waits 5 min.
  const rows = [
    row('a', 0, { lifetime: 900_000, period: 50_000, fanAgo: 2 * HOUR, weAgo: 5 * HOUR }),
    row('b', 1, { lifetime: 400_000, period: null, fanAgo: 3 * DAY, weAgo: 4 * DAY }),
    row('c', 2, { lifetime: 700_000, period: 120_000, fanAgo: 6 * DAY, weAgo: 10 * HOUR }),
    row('d', 3, { lifetime: 50_000, period: 10_000, fanAgo: null, weAgo: null }),
    row('e', 4, { lifetime: 200_000, period: 120_000, fanAgo: 5 * 60_000, weAgo: 30 * DAY }),
  ];

  it('«Ждёт ответа»: who waits the longest first, then the rest by «Потратил»', () => {
    expect(order(sortRows(rows, 'waiting'))).toEqual(['b', 'a', 'e', 'c', 'd']);
  });

  it('«Мы писали»: the longest since our last message first; a fan we never wrote to last', () => {
    expect(order(sortRows(rows, 'we-wrote'))).toEqual(['e', 'b', 'c', 'a', 'd']);
  });

  it('the period: the most spent first, ties by «Потратил», unknown last', () => {
    expect(order(sortRows(rows, 'period'))).toEqual(['c', 'e', 'a', 'd', 'b']);
  });

  it('«Ждёт ответа» lists two groups in place of the tiers, and each row keeps its tier', () => {
    const tiers = {
      metric: 'lifetimeGrossAmountMills',
      lists: [
        { key: '600-plus', label: '$600+', minAmountMills: 600_000, maxAmountMillsExclusive: null, entryCount: 2 },
        { key: '1-600', label: '$1–600', minAmountMills: 1_000, maxAmountMillsExclusive: 600_000, entryCount: 3 },
      ],
    } as unknown as BoardIndex['tiers'];
    const index = { rows, shelves: buildShelves(rows, tiers), tiers, period: 'lifetime', wholeScope: true, basis: 'scope' } as unknown as BoardIndex;
    const view = viewBoard(index, { query: '', filters: NO_FILTERS, sort: 'waiting', now: NOW });
    expect(view.shelves.map((shelf) => [shelf.group, order(shelf.rows)])).toEqual([
      ['waiting', ['b', 'a', 'e']],
      ['rest', ['c', 'd']],
    ]);
    expect(view.order).toEqual(['b', 'a', 'e', 'c', 'd']);
    expect(view.tierOf.get('a')).toEqual({ fromMills: 600_000, toMills: null });
    expect(view.tierOf.get('b')).toEqual({ fromMills: 1_000, toMills: 600_000 });
    // «Мы писали» is one list without a header; «Потратил» keeps the tiers.
    expect(viewBoard(index, { query: '', filters: NO_FILTERS, sort: 'we-wrote', now: NOW }).shelves.map((shelf) => shelf.group)).toEqual(['flat']);
    expect(viewBoard(index, { query: '', filters: NO_FILTERS, sort: 'sum', now: NOW }).shelves.map((shelf) => [shelf.group, order(shelf.rows)])).toEqual([
      [undefined, ['a', 'c']],
      [undefined, ['b', 'e', 'd']],
    ]);
  });
});

describe('the silence filters (§8.7: whole days since the fan last wrote)', () => {
  const silent = (days: number): SpenderRow => row(`s${days}`, 0, { fanAgo: days * DAY + HOUR, weAgo: 1 * HOUR });

  it('counts whole days to the clock', () => {
    expect(silentDays(silent(7), NOW)).toBe(7);
    expect(silentDays(row('x', 0, { fanAgo: null }), NOW)).toBeNull();
  });

  it('8–21 days and more than 21 take their own fans; one who never wrote is in neither', () => {
    const pass = (id: 'silent-8-21' | 'silent-over-21'): number[] => [7, 8, 21, 22, 40].filter((days) => rowPasses(silent(days), id, NOW));
    expect(pass('silent-8-21')).toEqual([8, 21]);
    expect(pass('silent-over-21')).toEqual([22, 40]);
    expect(rowPasses(row('x', 0, { fanAgo: null }), 'silent-over-21', NOW)).toBe(false);
  });

  it('a second press lets go; the two silences are one group', () => {
    const on = pressFilter(NO_FILTERS, 'silent-8-21');
    expect(on.silence).toBe('silent-8-21');
    expect(pressFilter(on, 'silent-over-21').silence).toBe('silent-over-21');
    expect(pressFilter(on, 'silent-8-21').silence).toBeNull();
  });
});

describe('the statistics in the model’s net', () => {
  it('the platform’s share, the week’s change and the average check are the net’s', () => {
    expect(feePct(10_862_000, 13_577_000)).toBe(20);
    expect(feePct(10_862_000, 0)).toBeNull();
    expect(changePct(2_785_000, 2_785_000)).toBe(0);
    expect(changePct(110_000, 100_000)).toBeCloseTo(10);
    expect(changePct(110_000, 0)).toBeNull();
    // $36.20 gross a purchase at 80 % net: $28.96.
    expect(netAvgCheck(36_200, 80_000, 100_000)).toBe(28_960);
    expect(netAvgCheck(36_200, 80_000, null)).toBeNull();
  });

  const money = (gross: number, net: number) => ({ grossMills: gross, purchasesGrossMills: gross, adjustmentsMills: 0, creatorNetMills: net, purchaseCount: 10, payerCount: 5 });
  const stats = (tiers: SpendersStats['tiers']): SpendersStats => ({
    pageLabel: 'p',
    metricVersion: 1,
    moneyUnit: 'USD-mills',
    basis: 'gross',
    timeZone: 'Europe/Moscow',
    from: '2026-10-21',
    to: '2026-10-22',
    asOf: '2026-10-22T09:00:00.000Z',
    projectionAsOf: null,
    includedStates: ['posted'],
    coverage: { state: 'complete', reasons: [] },
    days: [{ date: '2026-10-21', grossMills: 100_000, purchasesGrossMills: 100_000, adjustmentsMills: 0, creatorNetMills: 80_000, purchaseCount: 2, byState: {} }],
    totals: { today: money(0, 0), d7: money(100_000, 80_000), prev7: money(50_000, 40_000), d30: money(13_577_000, 10_862_000), d7DeltaPct: 100 },
    avgCheckMills: 36_200,
    tiers,
    silence: { d8to21: { fans: 34, lifetimeGrossMills: 0 }, over21: { fans: 19, lifetimeGrossMills: 0 }, unknown: { fans: 14, lifetimeGrossMills: 0 } },
    newPayers: { count: 130, firstPurchaseKnown: false },
    queueSummary: { total: 26, unknown: 0 },
  });

  it('every sum is the net; the gross is the 30 days alone', () => {
    const model = statsModel(stats([]));
    expect(model.days).toEqual([
      { date: '2026-10-21', net: 80_000, today: false },
      { date: '2026-10-22', net: null, today: true },
    ]);
    expect([model.d7, model.prev7, model.d30, model.d30Gross, model.feePct, model.changePct]).toEqual([80_000, 40_000, 10_862_000, 13_577_000, 20, 100]);
    expect(model.avgCheck).toBe(Math.round((36_200 * 10_862_000) / 13_577_000));
  });

  it('a tier carries its net, unknown without the hub’s field; «без фана» only when it holds anything', () => {
    const tier = (key: string, min: number | null, gross: number, net?: number) => ({ key, label: key, minMills: min, maxMills: null, members: 4, windowPayers: 4, windowGrossMills: gross, ...(net === undefined ? {} : { windowNetMills: net }) });
    const rows = statsModel(stats([tier('600-plus', 600_000, 2_110_000, 1_688_000), tier('350-600', 350_000, 1_642_000), tier('untiered', null, 0, 0), { ...tier('unattributed', null, 0, 0), members: 0 }])).shelves;
    expect(rows.map((shelf) => [shelf.remainder ?? shelf.id, shelf.net])).toEqual([
      ['shelf-600-plus', 1_688_000],
      ['shelf-350-600', null],
      ['untiered', 0],
    ]);
    const kept = statsModel(stats([{ ...tier('unattributed', null, 1_250_000, 1_000_000), members: 0 }])).shelves;
    expect(kept.map((shelf) => [shelf.remainder, shelf.net])).toEqual([['unattributed', 1_000_000]]);
  });
});
