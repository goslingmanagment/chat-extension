// Statistics of the Spenders board (architecture.md §8.5, §8.7; hub H-8b;
// SP-044…SP-049). The client shows the hub's numbers as sent and never
// rebuilds page totals from the rows it happens to see. What the hub does
// not know stays unknown: a day missing from the series, an average check
// with no purchases, a change against an empty previous week are `null`,
// never 0. Every number carries the hub's coverage and data time.
//
// 1.44.0: one money unit — what the model keeps (`creatorNetMills`, «на руки
// модели»), the unit of the platform's own earnings page; the owner read our
// gross against Fansly's net as a miscount. What the fans paid is the 30-day
// gross alone, beside the platform's share of it.

import { type SpendersStats } from '@cg/contracts/hub';
import { type CoverageLevel } from '@cg/contracts/ops';
import { type IsoTimestamp, type MoneyMills } from '@cg/contracts/primitives';

import { OUTSIDE_SHELF_ID, shelfIdOf, type ShelfRange } from './shelves';

/** COVERAGE_LEVELS of the contracts, repeated so this module loads no schema module (a test pins them equal). */
const LEVELS = ['complete', 'partial', 'unknown'] as const satisfies readonly CoverageLevel[];

/** The hub's open coverage token → the three levels; anything else is unknown. */
export function coverageLevel(token: string | null | undefined): CoverageLevel {
  return (LEVELS as readonly string[]).includes(token ?? '') ? (token as CoverageLevel) : 'unknown';
}

export interface StatsDay {
  /** Local date YYYY-MM-DD in the stats' time zone. */
  readonly date: string;
  /** What the model keeps of the day; null — the hub sent no number for this date. */
  readonly net: MoneyMills | null;
  readonly today: boolean;
}

/** The hub's tier keys of the two remainder rows: tiers without bounds (contracts `STATS_REMAINDERS`). */
export type StatsRemainderKey = 'untiered' | 'unattributed';
const REMAINDER_KEYS: readonly StatsRemainderKey[] = ['untiered', 'unattributed'];
/** The row of money no fan is counted for: no shelf of the board stands behind it. */
export const UNATTRIBUTED_SHELF_ID = 'shelf-unattributed';

export interface StatsShelf {
  readonly id: string;
  readonly range: ShelfRange;
  /** A remainder row, told by the hub's tier key — never by the missing bounds (there are two of them). */
  readonly remainder?: StatsRemainderKey;
  readonly fans: number | null;
  /** What the model keeps of the tier's window; null — the hub gave none (a hub before #739). */
  readonly net: MoneyMills | null;
}

export interface StatsModel {
  readonly windowDays: number;
  readonly timeZone: string | null;
  readonly asOf: IsoTimestamp;
  readonly coverage: CoverageLevel;
  readonly days: readonly StatsDay[];
  /** Every sum below is the model's net. */
  readonly today: MoneyMills | null;
  readonly d7: MoneyMills | null;
  readonly prev7: MoneyMills | null;
  /** Change of the last seven days to the seven before, net; null when those were zero (§8.7). */
  readonly changePct: number | null;
  readonly d30: MoneyMills | null;
  /** What the fans paid in the 30 days. */
  readonly d30Gross: MoneyMills | null;
  /** The platform's share of what the fans paid, whole percent. */
  readonly feePct: number | null;
  readonly purchases: number | null;
  readonly payers: number | null;
  readonly avgCheck: MoneyMills | null;
  readonly shelves: readonly StatsShelf[];
  readonly awaiting: number | null;
  /** Of them, with an unknown read state («ждёт ответа; прочтение неизвестно»). */
  readonly awaitingUnknown: number | null;
  readonly silent8to21: number | null;
  readonly silentOver21: number | null;
  /** What the fans silent for more than 21 days spent in all (SP-046): not lost revenue, not a forecast (§8.7). */
  readonly silentOver21Lifetime: MoneyMills | null;
  readonly noData: number | null;
}

/** §8.7 «Изменение к прошлым 7» over the net: `(now − before) / before`, null when before is zero or either is unknown. */
export function changePct(now: MoneyMills | null, before: MoneyMills | null): number | null {
  if (now === null || before === null || before <= 0) return null;
  return ((now - before) / before) * 100;
}

/** The platform's share of what the fans paid, `round(100 − net / gross · 100)`; null without a positive gross. */
export function feePct(net: MoneyMills | null, gross: MoneyMills | null): number | null {
  if (net === null || gross === null || gross <= 0) return null;
  return Math.round(100 - (net / gross) * 100);
}

/** The hub's average check (gross / purchases) in the model's net: scaled by the window's net / gross, whole mills. */
export function netAvgCheck(avgGross: MoneyMills | null, net: MoneyMills | null, gross: MoneyMills | null): MoneyMills | null {
  if (avgGross === null || net === null || gross === null || gross <= 0) return null;
  return Math.round((avgGross * net) / gross);
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

type Tier = SpendersStats['tiers'][number];

/**
 * The tier table from the richest tier down, whatever order the hub sent it in (it sends the tiers ascending):
 * tiers with a lower bound by that bound, then a tier without one, then the remainder rows — «без тира» before
 * «не распределено» — and a remainder this build does not know last. Equal rows keep the hub's order.
 */
export function orderedTiers(tiers: readonly Tier[]): Tier[] {
  const rank = (tier: Tier): number => {
    const remainder = REMAINDER_KEYS.indexOf(tier.key as StatsRemainderKey);
    if (remainder >= 0) return 2 + remainder;
    return tier.minMills === null && tier.maxMills === null ? 2 + REMAINDER_KEYS.length : tier.minMills === null ? 1 : 0;
  };
  return tiers
    .map((tier, index) => ({ tier, index }))
    .sort((a, b) => rank(a.tier) - rank(b.tier) || (b.tier.minMills ?? 0) - (a.tier.minMills ?? 0) || a.index - b.index)
    .map((entry) => entry.tier);
}

/**
 * The statistics as the hub sent them, in the model's net. The «не распределено» remainder (money of the window no
 * fan is counted for) is a row only when it holds anything: on a page where it is always zero it was a puzzle.
 */
export function statsModel(stats: SpendersStats): StatsModel {
  const byDate = new Map(stats.days.map((day) => [day.date, day.creatorNetMills]));
  const dates = calendarDates(stats.from, stats.to);
  // The series follows the window's calendar; without a readable window, the days the hub sent.
  const series = dates.length > 0 ? dates : stats.days.map((day) => day.date);
  const shelves = orderedTiers(stats.tiers).flatMap((tier): StatsShelf[] => {
    const remainder = REMAINDER_KEYS.find((key) => key === tier.key);
    const net = tier.windowNetMills ?? null;
    if (remainder === 'unattributed' && tier.members === 0 && tier.windowGrossMills === 0 && (net ?? 0) === 0) return [];
    // «Без тира» is the board's «вне полок»: the fans no bucket takes. The other rows keep the id of their own key,
    // so two tiers without bounds are never one row.
    const id = remainder === 'untiered' ? OUTSIDE_SHELF_ID : remainder === 'unattributed' ? UNATTRIBUTED_SHELF_ID : shelfIdOf(tier.key);
    return [{ id, range: { fromMills: tier.minMills, toMills: tier.maxMills }, ...(remainder === undefined ? {} : { remainder }), fans: tier.members, net }];
  });
  const { today, d7, prev7, d30 } = stats.totals;
  return {
    windowDays: series.length > 0 ? series.length : 30,
    timeZone: stats.timeZone.length > 0 ? stats.timeZone : null,
    asOf: stats.asOf,
    coverage: coverageLevel(stats.coverage.state),
    days: series.map((date) => ({ date, net: byDate.get(date) ?? null, today: date === stats.to })),
    today: today.creatorNetMills,
    d7: d7.creatorNetMills,
    prev7: prev7.creatorNetMills,
    changePct: changePct(d7.creatorNetMills, prev7.creatorNetMills),
    d30: d30.creatorNetMills,
    d30Gross: d30.grossMills,
    feePct: feePct(d30.creatorNetMills, d30.grossMills),
    purchases: d30.purchaseCount,
    payers: d30.payerCount,
    avgCheck: netAvgCheck(stats.avgCheckMills, d30.creatorNetMills, d30.grossMills),
    shelves,
    awaiting: stats.queueSummary.total,
    awaitingUnknown: stats.queueSummary.unknown,
    silent8to21: stats.silence.d8to21.fans,
    silentOver21: stats.silence.over21.fans,
    silentOver21Lifetime: stats.silence.over21.lifetimeGrossMills,
    noData: stats.silence.unknown.fans,
  };
}
