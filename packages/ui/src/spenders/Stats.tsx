// Spenders statistics (ui-design §4.15; SP-044…SP-049): the compact column on
// the right of the board (240–272 px) with «Развернуть», and the expanded
// view that takes the place of the list and the preview. Every number is the
// hub's, with its coverage and time (SpendersStatsVM); unknown is `—`, never
// 0. A known zero of money is the words «трат нет» in muted ink, as the board's
// rows and the fan panel say it (decision X55; ui-design §1 п. 6). Sums are plain
// ink: green belongs only to `+$N`. A failed statistics read is its own error
// card — the board next to it keeps working.

import { type JSX } from 'preact';

import { type CountStat, type DataStamp, type I18n, type MoneyStat, type SpendersStatsVM } from '@cg/contracts/vm';

import { Button, Money, ViewState, useDispatch, useHints, useI18n, useTooltip } from '../kit';
import { statsShelfLabel } from './rows';
import { RefreshButton, coverageWord, timeOrUnknown, unknownMark, type RefreshableView } from './window';

/**
 * A calendar date of the statistics window («2026-09-04») as the I18n port
 * prints a day («4 сен»). The port prints moments, in its own time zone, so
 * the moment is taken inside that date there: noon UTC is the same date
 * everywhere west of UTC+12, midnight UTC from UTC+12 to UTC+14 (Tongatapu,
 * Kiritimati). The one whose text carries the date's day number is the day.
 */
export function statsDayName(i18n: I18n, date: string): string {
  const day = Number(date.slice(8, 10));
  const noon = i18n.formatTime(Date.parse(`${date}T12:00:00Z`), 'day');
  const hasDay = (text: string): boolean => new RegExp(`(^|\\D)${day}(\\D|$)`).test(text);
  if (!Number.isInteger(day) || hasDay(noon)) return noon;
  const midnight = i18n.formatTime(Date.parse(`${date}T00:00:00Z`), 'day');
  return hasDay(midnight) ? midnight : noon;
}

/** «+4%», «−12%», «0%»: a share, no words in it. */
export function formatPct(pct: number): string {
  const value = Math.round(pct);
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value)}%`;
}

/**
 * A time zone as a person reads it: its offset from UTC at the moment of the
 * data («UTC+3», «UTC−5:30», «UTC») — the same in every language, and never
 * the raw zone id («Europe/Moscow») the hub names it by. A zone this browser
 * does not know keeps its last word («Moscow»).
 */
export function zoneLabel(timeZone: string, at: string | number | null): string {
  try {
    const moment = at === null ? new Date() : new Date(at);
    const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' }).formatToParts(moment).find((part) => part.type === 'timeZoneName')?.value ?? '';
    if (name === 'GMT' || name === 'UTC') return 'UTC';
    const offset = /^(?:GMT|UTC)([+-])(\d{1,2})(?::(\d{2}))?$/.exec(name);
    if (offset !== null) {
      const zero = Number(offset[2]) === 0 && (offset[3] === undefined || Number(offset[3]) === 0);
      return zero ? 'UTC' : `UTC${offset[1] === '-' ? '−' : '+'}${offset[2] ?? ''}${offset[3] === undefined ? '' : `:${offset[3]}`}`;
    }
  } catch {
    // Not a zone Intl knows: named by its last word below.
  }
  return (timeZone.split('/').pop() ?? timeZone).replaceAll('_', ' ');
}

/** What «Обновить» of the expanded statistics reads again. */
const STATS_REFRESH: readonly RefreshableView[] = ['spenders.stats'];

function stampText(i18n: I18n, stamp: DataStamp): string {
  return i18n.t('stats.footer', { time: timeOrUnknown(i18n, stamp.asOf), coverage: coverageWord(i18n, stamp.coverage) });
}

function countText(i18n: I18n, stat: CountStat): string {
  return stat.count === null ? unknownMark(i18n) : String(stat.count);
}

/** A known zero of the period (X55): said in words, never «$0»; unknown stays `—`. */
const noSpend = (stat: MoneyStat): boolean => stat.mills === 0;

function moneyText(i18n: I18n, stat: MoneyStat): string {
  return noSpend(stat) ? i18n.t('stats.none') : i18n.formatMoneyMills(stat.mills, { zero: 'show' });
}

/** One key–value row; the value's tooltip says how fresh and how complete that very number is. */
function Kv({
  label,
  value,
  stamp,
  delta,
  hint,
  none = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly stamp: DataStamp;
  readonly delta?: string | null;
  readonly hint?: string | null;
  /** The value is «трат нет»: muted words, not a sum. */
  readonly none?: boolean;
}): JSX.Element {
  const i18n = useI18n();
  const tip = useTooltip(stampText(i18n, stamp));
  const labelTip = useTooltip(hint ?? null);
  return (
    <>
      <span class="cg-st__k" {...labelTip.props}>
        {label}
        {labelTip.description}
      </span>
      <span class={`cg-st__v cg-num${none ? ' is-none' : ''}`} {...tip.props}>
        {value}
        {tip.description}
      </span>
      <span class="cg-st__d cg-num">{delta ?? ''}</span>
    </>
  );
}

function Bar({ share, today, tip }: { readonly share: number | null; readonly today: boolean; readonly tip: string }): JSX.Element {
  const tooltip = useTooltip(tip);
  return (
    <>
      <i
        class={`cg-spark__bar${today ? ' is-today' : ''}${share === null ? ' is-unknown' : ''}`}
        style={{ height: `${share === null ? 0 : Math.max(2, Math.round(share * 100))}%` }}
        {...tooltip.props}
      />
      {tooltip.description}
    </>
  );
}

function Chart({ stats, axisMiddle }: { readonly stats: SpendersStatsVM; readonly axisMiddle: boolean }): JSX.Element | null {
  const i18n = useI18n();
  const days = stats.days;
  if (days.length === 0) return null;
  const max = days.reduce((top, day) => Math.max(top, day.gross ?? 0), 0);
  const first = days[0];
  const middle = days[Math.floor((days.length - 1) / 2)];
  const dayName = (date: string): string => statsDayName(i18n, date);
  // A day without money is «трат нет» in its tooltip and its row for a screen reader, as everywhere (X55).
  const dayMoney = (gross: number | null): string => (gross === 0 ? i18n.t('stats.none') : i18n.formatMoneyMills(gross, { zero: 'show' }));
  return (
    <>
      <div class="cg-spark" role="img" aria-label={i18n.t('stats.chart.title')}>
        {days.map((day) => (
          <Bar
            key={day.date}
            share={day.gross === null ? null : max > 0 ? day.gross / max : 0}
            today={day.today}
            tip={i18n.t('stats.chart.dayTip', { date: dayName(day.date), money: dayMoney(day.gross) })}
          />
        ))}
      </div>
      <div class="cg-spark__ax" aria-hidden="true">
        <span>{first === undefined ? '' : dayName(first.date)}</span>
        {axisMiddle && middle !== undefined ? <span>{dayName(middle.date)}</span> : null}
        <span>{i18n.t('stats.chart.axisToday')}</span>
      </div>
      {/* The same series for a screen reader (ui-design §6.1). */}
      <table class="cg-sr">
        <caption>{i18n.t('stats.chart.title')}</caption>
        <tbody>
          {days.map((day) => (
            <tr key={day.date}>
              <th scope="row">{dayName(day.date)}</th>
              <td>{dayMoney(day.gross)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function Attention({ stats, full }: { readonly stats: SpendersStatsVM; readonly full: boolean }): JSX.Element {
  const i18n = useI18n();
  const a = stats.attention;
  const observed = a.newPayers.firstObserved;
  return (
    <div class="cg-st__kv">
      <Kv label={i18n.t('stats.awaiting')} value={countText(i18n, a.awaiting)} stamp={a.awaiting.stamp} />
      <Kv
        label={i18n.t(observed ? 'stats.newPayersObserved' : 'stats.newPayers')}
        value={countText(i18n, a.newPayers)}
        stamp={a.newPayers.stamp}
        hint={observed ? i18n.t('stats.newPayersObserved') : null}
      />
      <Kv label={i18n.t('stats.silent8to21')} value={countText(i18n, a.silent8to21)} stamp={a.silent8to21.stamp} />
      <Kv label={i18n.t('stats.silentOver21')} value={countText(i18n, a.silentOver21)} stamp={a.silentOver21.stamp} />
      <Kv label={i18n.t(full ? 'stats.noSilenceData' : 'stats.noData')} value={countText(i18n, a.noData)} stamp={a.noData.stamp} />
    </div>
  );
}

function hasNumbers(stats: SpendersStatsVM): boolean {
  return stats.view.s === 'ready' || stats.view.s === 'partial' || stats.view.s === 'offline';
}

export interface StatsProps {
  readonly stats: SpendersStatsVM;
  /** A click on a shelf: the list scrolls to it (SP-045). */
  readonly onShelf: (shelfId: string) => void;
}

/** The compact column, always on the right. */
export function StatsColumn({ stats, onShelf }: StatsProps): JSX.Element {
  const i18n = useI18n();
  const hints = useHints();
  const dispatch = useDispatch();
  const period = i18n.plural('common.days', stats.windowDays);
  return (
    <aside class="cg-st" aria-label={i18n.t('stats.regionLabel')} data-cg-stats={stats.view.s}>
      <div class="cg-st__head">
        <h3 class="cg-st__title">{i18n.t('stats.title')}</h3>
        <Button
          label={i18n.t('stats.expand')}
          icon="expand"
          size="sm"
          tooltip={hints ? i18n.t('stats.expandTooltip') : null}
          onClick={() => void dispatch({ type: 'SetStatsExpanded', expanded: true })}
        />
      </div>
      {hasNumbers(stats) ? (
        <>
          {stats.view.s === 'offline' ? <ViewState view={stats.view} /> : null}
          <div class="cg-st__sec">
            <div class="cg-st__cap">
              <span>{period}</span>
            </div>
            {noSpend(stats.d30) ? <span class="cg-st__big is-none">{i18n.t('stats.none')}</span> : <Money mills={stats.d30.mills} zero="show" class="cg-st__big" />}
            <Chart stats={stats} axisMiddle={false} />
          </div>
          <div class="cg-st__sec">
            <div class="cg-st__kv">
              <Kv label={i18n.t('stats.today')} value={moneyText(i18n, stats.today)} none={noSpend(stats.today)} stamp={stats.today.stamp} />
              <Kv
                label={i18n.t('stats.d7')}
                value={moneyText(i18n, stats.d7)}
                none={noSpend(stats.d7)}
                stamp={stats.d7.stamp}
                delta={stats.d7.changePct === null ? null : formatPct(stats.d7.changePct)}
              />
              <Kv label={i18n.t('stats.payers')} value={countText(i18n, stats.payers)} stamp={stats.payers.stamp} />
              <Kv label={i18n.t('stats.avgCheck')} value={moneyText(i18n, stats.avgCheck)} none={noSpend(stats.avgCheck)} stamp={stats.avgCheck.stamp} />
            </div>
          </div>
          {stats.shelves.length === 0 ? null : (
            <div class="cg-st__sec">
              {/* One grid for every row, so the names, the bars and the numbers line up in columns. */}
              <div class="cg-st__tiers">
                <div class="cg-st__tierrow cg-st__tiershead" aria-hidden="true">
                  <span class="cg-st__cap">{i18n.t('stats.shelves')}</span>
                  <span />
                  <span class="cg-st__th">{i18n.t('stats.colFans')}</span>
                  <span class="cg-st__th">{period}</span>
                </div>
                {stats.shelves.map((shelf) => (
                  <button key={shelf.id} type="button" class="cg-st__tierrow cg-st__tier" onClick={() => onShelf(shelf.id)}>
                    <span class="cg-st__k">{statsShelfLabel(i18n, shelf)}</span>
                    <span class="cg-st__barbox" aria-hidden="true">
                      <i class="cg-st__bar" style={{ width: `${shelf.share <= 0 ? 0 : Math.max(4, Math.round(shelf.share * 100))}%` }} />
                    </span>
                    <span class="cg-st__d cg-num">{shelf.fans === null ? unknownMark(i18n) : shelf.fans}</span>
                    <span class="cg-st__v cg-num">{i18n.formatMoneyMills(shelf.period)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div class="cg-st__sec">
            <Attention stats={stats} full={false} />
          </div>
          <div class="cg-st__foot">{stampText(i18n, stats.stamp)}</div>
        </>
      ) : (
        <div class="cg-st__state">
          <ViewState view={stats.view} />
        </div>
      )}
    </aside>
  );
}

function Tile({ caption, value, sub, none = false }: { readonly caption: string; readonly value: string; readonly sub: string | null; readonly none?: boolean }): JSX.Element {
  return (
    <div class="cg-stx__cell">
      <div class="cg-st__cap">
        <span>{caption}</span>
      </div>
      <div class={`cg-st__big cg-num${none ? ' is-none' : ''}`}>{value}</div>
      {sub === null ? null : <div class="cg-stx__sub cg-num">{sub}</div>}
    </div>
  );
}

/** The expanded view: tiles, the chart, the shelf table and «Внимание». */
export function StatsExpanded({ stats }: { readonly stats: SpendersStatsVM }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const period = i18n.plural('common.days', stats.windowDays);
  const max = stats.days.reduce((top, day) => Math.max(top, day.gross ?? 0), 0);
  const coverage = coverageWord(i18n, stats.stamp.coverage);
  const time = timeOrUnknown(i18n, stats.stamp.asOf);
  return (
    <section class="cg-stx" aria-label={i18n.t('stats.regionLabel')} data-cg-stats={stats.view.s}>
      <div class="cg-st__head cg-stx__head">
        <h3 class="cg-st__title">{i18n.t('stats.titleFull', { period })}</h3>
        <Button label={i18n.t('stats.collapse')} icon="collapse" size="sm" onClick={() => void dispatch({ type: 'SetStatsExpanded', expanded: false })} />
      </div>
      {hasNumbers(stats) ? (
        <>
          {stats.view.s === 'offline' ? <ViewState view={stats.view} /> : null}
          <div class="cg-stx__grid">
            <Tile caption={i18n.t('stats.today')} value={moneyText(i18n, stats.today)} none={noSpend(stats.today)} sub={i18n.t('stats.tile.todaySub')} />
            <Tile
              caption={i18n.t('stats.d7')}
              value={moneyText(i18n, stats.d7)}
              none={noSpend(stats.d7)}
              sub={
                stats.d7.changePct === null || stats.d7.prev7 === null
                  ? null
                  : i18n.t('stats.tile.d7Sub', { pct: formatPct(stats.d7.changePct), money: i18n.formatMoneyMills(stats.d7.prev7, { zero: 'show' }) })
              }
            />
            {/* «трат нет» says the purchases too: no «0 покупок» under it. */}
            <Tile
              caption={period}
              value={moneyText(i18n, stats.d30)}
              none={noSpend(stats.d30)}
              sub={stats.d30.purchases === null || (noSpend(stats.d30) && stats.d30.purchases === 0) ? null : i18n.plural('stats.tile.d30Sub', stats.d30.purchases)}
            />
            <Tile
              caption={i18n.t('stats.payers')}
              value={countText(i18n, stats.payers)}
              sub={stats.avgCheck.mills === null ? null : i18n.t('stats.tile.payersSub', { money: i18n.formatMoneyMills(stats.avgCheck.mills, { zero: 'show' }) })}
            />
          </div>
          <div class="cg-stx__chart">
            <div class="cg-st__cap">
              <span>{i18n.t('stats.chart.title')}</span>
              {/* No day with money: the chart's bars say it, «максимум $0» would not. */}
              {max > 0 ? <span class="cg-num">{i18n.t('stats.chart.max', { money: i18n.formatMoneyMills(max, { zero: 'show' }) })}</span> : null}
            </div>
            <Chart stats={stats} axisMiddle />
          </div>
          <div class="cg-stx__two">
            <div>
              <div class="cg-st__cap">
                <span>{i18n.t('stats.shelves')}</span>
              </div>
              <table class="cg-stx__table">
                <thead>
                  <tr>
                    <th scope="col">{i18n.t('stats.table.shelf')}</th>
                    <th scope="col">{i18n.t('stats.table.fans')}</th>
                    <th scope="col">{i18n.t('stats.table.lifetime')}</th>
                    <th scope="col">{period}</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.shelves.map((shelf) => (
                    <tr key={shelf.id}>
                      <td>{statsShelfLabel(i18n, shelf)}</td>
                      <td>{shelf.fans === null ? unknownMark(i18n) : shelf.fans}</td>
                      {/* A known zero is not drawn (ui-design §1 п. 6, §4.15): an empty cell, as in the period column. */}
                      <td>{i18n.formatMoneyMills(shelf.lifetime)}</td>
                      <td>{i18n.formatMoneyMills(shelf.period)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <div class="cg-st__cap">
                <span>{i18n.t('stats.attention')}</span>
              </div>
              <Attention stats={stats} full />
              <div class="cg-stx__foot">
                <span>{stats.timeZone === null ? i18n.t('stats.footer', { time, coverage }) : i18n.t('stats.footerFull', { time, coverage, tz: zoneLabel(stats.timeZone, stats.stamp.asOf) })}</span>
                {/* SP-024: with the statistics expanded the board's footer is not on screen. */}
                <RefreshButton views={STATS_REFRESH} />
              </div>
            </div>
          </div>
        </>
      ) : (
        <div class="cg-st__state">
          <ViewState view={stats.view} />
        </div>
      )}
    </section>
  );
}

export const STATS_CSS = `
.cg-st { overflow-y: auto; padding: 0 0 16px; scrollbar-width: thin; min-width: 0; }
.cg-st__head { display: flex; align-items: center; justify-content: space-between; gap: 8px; height: 44px; padding: 0 8px 0 16px; }
.cg-st__head .cg-btn .cg-ico { width: 16px; height: 16px; }
.cg-st__title { font-size: inherit; font-weight: 600; color: var(--cg-ink-strong); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cg-st__sec { padding: 10px 16px 12px; border-top: 1px solid var(--cg-rule); }
.cg-st__cap { font-size: var(--cg-text-sm); color: var(--cg-ink-muted); margin-bottom: 6px; display: flex; justify-content: space-between; gap: 8px; }
.cg-st__big { display: block; font-size: var(--cg-text-3xl); line-height: 28px; font-weight: 600; color: var(--cg-ink-strong); letter-spacing: -0.01em; font-variant-numeric: tabular-nums; }
/* A known zero (X55): the words in muted ink on the number's line, so the tiles keep their height. */
.cg-st__big.is-none { font-size: var(--cg-text-xl); font-weight: 500; color: var(--cg-ink-muted); letter-spacing: 0; }
.cg-st__kv { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; column-gap: 10px; align-items: baseline; }
.cg-st__kv > * { line-height: 24px; }
.cg-st__k { color: var(--cg-ink-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cg-st__v { color: var(--cg-ink); font-weight: 500; text-align: right; white-space: nowrap; }
.cg-st__v.is-none { color: var(--cg-ink-muted); font-weight: 400; }
.cg-st__d { color: var(--cg-ink-muted); font-size: var(--cg-text-sm); text-align: right; min-width: 30px; }
.cg-st__foot { padding: 10px 16px 0; font-size: var(--cg-text-sm); color: var(--cg-ink-muted); border-top: 1px solid var(--cg-rule); }
.cg-st__state { border-top: 1px solid var(--cg-rule); }
.cg-st .cg-card, .cg-stx .cg-card { border-top: 1px solid var(--cg-rule); }
.cg-spark { position: relative; display: flex; align-items: flex-end; gap: 2px; height: 48px; margin-top: 10px; border-bottom: 1px solid var(--cg-rule-2); }
.cg-spark__bar { flex: 1; min-height: 1px; border-radius: var(--cg-r-xs) var(--cg-r-xs) 0 0; background: var(--cg-bar); }
.cg-spark__bar.is-today { background: var(--cg-bar-strong); }
.cg-spark__bar.is-unknown { min-height: 0; }
.cg-spark__bar:hover { background: var(--cg-ink-2); }
.cg-spark__ax { display: flex; justify-content: space-between; margin-top: 4px; font-size: var(--cg-text-xs); line-height: 18px; color: var(--cg-ink-muted); }
.cg-st__tiers { display: grid; grid-template-columns: auto minmax(0, 1fr) auto minmax(56px, auto); column-gap: 8px; }
.cg-st__tierrow { display: grid; grid-template-columns: subgrid; grid-column: 1 / -1; align-items: center; }
.cg-st__tierrow > * { line-height: 24px; }
.cg-st__tiers .cg-st__k { min-width: 56px; }
.cg-st__tiershead .cg-st__cap { margin: 0; }
.cg-st__th { font-size: var(--cg-text-xs); line-height: 18px; color: var(--cg-ink-muted); text-align: right; white-space: nowrap; }
.cg-st__tier { border-radius: var(--cg-r-sm); text-align: left; }
.cg-st__tier:hover { background: var(--cg-sunk); }
.cg-st__tier .cg-st__d { min-width: 0; }
.cg-st__barbox { display: flex; align-items: center; height: 24px; }
.cg-st__bar { display: block; height: 4px; border-radius: var(--cg-r-xs); background: var(--cg-bar); }

.cg-stx { overflow-y: auto; padding: 0 0 24px; min-width: 0; scrollbar-width: thin; }
.cg-st__head.cg-stx__head { padding-left: 20px; }
.cg-stx__grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border-top: 1px solid var(--cg-rule); border-bottom: 1px solid var(--cg-rule); }
.cg-stx__cell { padding: 14px 20px 16px; min-width: 0; }
.cg-stx__cell + .cg-stx__cell { border-left: 1px solid var(--cg-rule); }
.cg-stx__sub { margin-top: 2px; font-size: var(--cg-text-sm); color: var(--cg-ink-muted); }
.cg-stx__chart { padding: 16px 20px 8px; border-bottom: 1px solid var(--cg-rule); }
.cg-stx__chart .cg-spark { height: 160px; gap: 4px; margin-top: 0; }
.cg-stx__chart .cg-spark__bar { border-radius: 3px 3px 0 0; }
.cg-stx__two { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); }
.cg-stx__two > * { padding: 14px 20px; min-width: 0; }
.cg-stx__two > * + * { border-left: 1px solid var(--cg-rule); }
.cg-stx__table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
.cg-stx__table th { font-weight: 400; font-size: var(--cg-text-sm); color: var(--cg-ink-muted); text-align: right; padding: 0 0 6px; }
.cg-stx__table th:first-child, .cg-stx__table td:first-child { text-align: left; }
.cg-stx__table td { padding: 0; height: 32px; border-top: 1px solid var(--cg-rule); text-align: right; color: var(--cg-ink); }
.cg-stx__foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 4px 12px; padding: 12px 0 0; font-size: var(--cg-text-sm); color: var(--cg-ink-muted); }
.cg-stx__foot .cg-sp__refresh { margin: 0 -8px 0 0; }
@media (max-width: 1360px) {
  .cg-st__head { padding-left: 14px; }
  .cg-st__sec, .cg-st__foot { padding-left: 14px; padding-right: 14px; }
}
@media (max-width: 760px) {
  .cg-stx__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .cg-stx__cell:nth-child(3) { border-left: 0; }
  .cg-stx__cell:nth-child(n + 3) { border-top: 1px solid var(--cg-rule); }
  .cg-stx__two { grid-template-columns: minmax(0, 1fr); }
  .cg-stx__two > * + * { border-left: 0; border-top: 1px solid var(--cg-rule); }
}
`;
