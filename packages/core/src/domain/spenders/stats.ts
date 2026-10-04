// Statistics of the Spenders board (architecture.md §8.5, §8.7; hub H-8b;
// SP-044…SP-049). The client shows the hub's numbers as sent and never
// rebuilds page totals from the rows it happens to see. What the hub does
// not know stays unknown: a day missing from the series, an average check
// with no purchases, a change against an empty previous week are `null`,
// never 0. Every number carries the hub's coverage and data time.

import { type SpendersStats } from '@cg/contracts/hub';
import { type CoverageLevel } from '@cg/contracts/ops';
import { type IsoTimestamp, type MoneyMills } from '@cg/contracts/primitives';

import { OUTSIDE_SHELF_ID, shelfIdOf, type ShelfRange } from './shelves';

/** Shortest bar of a shelf with any revenue (ui-design §4.15). */
export const SHELF_BAR_MIN_SHARE = 0.04;

/** COVERAGE_LEVELS of the contracts, repeated so this module loads no schema module (a test pins them equal). */
const LEVELS = ['complete', 'partial', 'unknown'] as const satisfies readonly CoverageLevel[];

/** The hub's open coverage token → the three levels; anything else is unknown. */
export function coverageLevel(token: string | null | undefined): CoverageLevel {
  return (LEVELS as readonly string[]).includes(token ?? '') ? (token as CoverageLevel) : 'unknown';
}

export interface StatsDay {
  /** Local date YYYY-MM-DD in the stats' time zone. */
  readonly date: string;
  /** null — the hub sent no number for this date. */
  readonly gross: MoneyMills | null;
  readonly today: boolean;
}

export interface StatsShelf {
  readonly id: string;
  readonly range: ShelfRange;
  readonly fans: number | null;
  /** The stats carry no lifetime sum of a shelf; the board's own, when it holds the whole shelf. */
  readonly lifetime: MoneyMills | null;
  readonly period: MoneyMills | null;
  /** Bar length 0–1 by the period sum. */
  readonly share: number;
}

export interface StatsModel {
  readonly windowDays: number;
  readonly timeZone: string | null;
  readonly asOf: IsoTimestamp;
  readonly coverage: CoverageLevel;
  readonly days: readonly StatsDay[];
  readonly today: MoneyMills | null;
  readonly d7: MoneyMills | null;
  readonly prev7: MoneyMills | null;
  /** Change of the last seven days to the seven before; null when those were zero (§8.7). */
  readonly changePct: number | null;
  readonly d30: MoneyMills | null;
  readonly purchases: number | null;
  readonly payers: number | null;
  readonly avgCheck: MoneyMills | null;
  readonly shelves: readonly StatsShelf[];
  readonly awaiting: number | null;
  /** Of them, with an unknown read state («ждёт ответа; прочтение неизвестно»). */
  readonly awaitingUnknown: number | null;
  readonly newPayers: number | null;
  /** The history is incomplete: «первая наблюдённая» покупка, not a known first one. */
  readonly newPayersFirstObserved: boolean;
  readonly silent8to21: number | null;
  readonly silentOver21: number | null;
  /** What the fans silent for more than 21 days spent in all (SP-046): not lost revenue, not a forecast (§8.7). */
  readonly silentOver21Lifetime: MoneyMills | null;
  readonly noData: number | null;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Every calendar date from `from` to `to` inclusive; empty when either is not a date or the span is absurd. */
export function calendarDates(from: string, to: string): string[] {
  const a = DATE.exec(from);
  const b = DATE.exec(to);
  if (a === null || b === null) return [];
  const start = Date.UTC(Number(a[1]), Number(a[2]) - 1, Number(a[3]));
  const end = Date.UTC(Number(b[1]), Number(b[2]) - 1, Number(b[3]));
  const days = Math.round((end - start) / 86_400_000);
  if (!Number.isFinite(days) || days < 0 || days > 400) return [];
  return Array.from({ length: days + 1 }, (_, i) => new Date(start + i * 86_400_000).toISOString().slice(0, 10));
}

function shelfShares(period: readonly (MoneyMills | null)[]): number[] {
  const total = period.reduce<number>((acc, value) => acc + Math.max(0, value ?? 0), 0);
  return period.map((value) => {
    if (value === null || value <= 0 || total <= 0) return 0;
    return Math.max(SHELF_BAR_MIN_SHARE, Math.min(1, value / total));
  });
}

/**
 * The statistics as the hub sent them. `lifetimeByShelf` — lifetime sums the
 * board can vouch for (a shelf it holds whole); a shelf it cannot is null.
 */
export function statsModel(stats: SpendersStats, lifetimeByShelf: ReadonlyMap<string, MoneyMills | null> = new Map()): StatsModel {
  const byDate = new Map(stats.days.map((day) => [day.date, day.grossMills]));
  const dates = calendarDates(stats.from, stats.to);
  // The series follows the window's calendar; without a readable window, the days the hub sent.
  const series = dates.length > 0 ? dates : stats.days.map((day) => day.date);
  const tiers = stats.tiers.map((tier) => {
    const outside = tier.minMills === null && tier.maxMills === null;
    const id = outside ? OUTSIDE_SHELF_ID : shelfIdOf(tier.key);
    return { id, range: { fromMills: tier.minMills, toMills: tier.maxMills }, fans: tier.members, period: tier.windowGrossMills };
  });
  const shares = shelfShares(tiers.map((tier) => tier.period));
  return {
    windowDays: series.length > 0 ? series.length : 30,
    timeZone: stats.timeZone.length > 0 ? stats.timeZone : null,
    asOf: stats.asOf,
    coverage: coverageLevel(stats.coverage.state),
    days: series.map((date) => ({ date, gross: byDate.get(date) ?? null, today: date === stats.to })),
    today: stats.totals.today.grossMills,
    d7: stats.totals.d7.grossMills,
    prev7: stats.totals.prev7.grossMills,
    changePct: stats.totals.d7DeltaPct,
    d30: stats.totals.d30.grossMills,
    purchases: stats.totals.d30.purchaseCount,
    payers: stats.totals.d30.payerCount,
    avgCheck: stats.avgCheckMills,
    shelves: tiers.map((tier, i) => ({ ...tier, lifetime: lifetimeByShelf.get(tier.id) ?? null, share: shares[i] ?? 0 })),
    awaiting: stats.queueSummary.total,
    awaitingUnknown: stats.queueSummary.unknown,
    newPayers: stats.newPayers.count,
    newPayersFirstObserved: !stats.newPayers.firstPurchaseKnown,
    silent8to21: stats.silence.d8to21.fans,
    silentOver21: stats.silence.over21.fans,
    silentOver21Lifetime: stats.silence.over21.lifetimeGrossMills,
    noData: stats.silence.unknown.fans,
  };
}
