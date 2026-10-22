// Spenders statistics (ui-design §4.15; SP-044…SP-049; 1.44.0 — the owner's
// «Таблица»): three states — a 40 px rail at the window's right edge (every
// opening of the board starts there), the column beside the list, and the full
// view in place of the list. One money unit everywhere: what the model keeps
// («на руки модели»), the unit of the platform's own earnings page; what the
// fans paid is one muted line with the platform's share. Every number is the
// hub's, with its coverage and time (SpendersStatsVM); unknown is `—`, never 0.
// A known zero of money is the words «трат нет» in muted ink (decision X55).
// «Кому написать» opens those fans in the list: «Ждут ответа» sorts it, the
// silences and «Нет переписки» filter it. A failed statistics read is its own
// error card — the board next to it keeps working.

import { type JSX, type RefObject } from 'preact';

import { type CountStat, type DataStamp, type I18n, type MoneyStat, type SpendersStatsVM } from '@cg/contracts/vm';

import { Button, Icon, ViewState, useDispatch, useI18n, useNowFn, useTooltip } from '../kit';
import { shelfLabel, shelfTier, statsShelfLabel } from './rows';
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

/** «как прошлые 7» / «+12% к прошлым 7»; null — no change is known. */
export function d7Change(i18n: I18n, pct: number | null): string | null {
  if (pct === null) return null;
  return Math.round(pct) === 0 ? i18n.t('stats.d7Same') : i18n.t('stats.d7Change', { pct: formatPct(pct) });
}

/** What «Кому написать» opens in the list (SpendersWindow does it). */
export type StatsShow = 'waiting' | 'silent-8-21' | 'silent-over-21' | 'no-history';

/** What «Обновить» of the expanded statistics reads again. */
const STATS_REFRESH: readonly RefreshableView[] = ['spenders.stats'];

function stampText(i18n: I18n, stamp: DataStamp): string {
  return i18n.t('stats.footer', { time: timeOrUnknown(i18n, stamp.asOf), coverage: coverageWord(i18n, stamp.coverage) });
}

/** A known zero of the period (X55): said in words, never «$0»; unknown stays `—`. */
const noSpend = (stat: MoneyStat): boolean => stat.mills === 0;

function moneyText(i18n: I18n, stat: MoneyStat): string {
  return noSpend(stat) ? i18n.t('stats.none') : i18n.formatMoneyMills(stat.mills, { zero: 'show' });
}

function fansText(i18n: I18n, stat: CountStat): string {
  return stat.count === null ? unknownMark(i18n) : i18n.plural('common.fans', stat.count);
}

/** «фаны заплатили $13,577 · 20% — комиссия Fansly»; null — the hub gave no gross. */
function paidText(i18n: I18n, stats: SpendersStatsVM): string | null {
  if (stats.d30.gross === null) return null;
  const paid = i18n.t('stats.paid', { money: i18n.formatMoneyMills(stats.d30.gross, { zero: 'show' }) });
  return stats.d30.feePct === null ? paid : `${paid} · ${i18n.t('stats.fee', { pct: stats.d30.feePct })}`;
}

/** The footnote: our 30 days are not the platform's calendar month the owner compares them with. */
function MonthNote({ stats }: { readonly stats: SpendersStatsVM }): JSX.Element {
  const i18n = useI18n();
  const now = useNowFn()();
  const today = new Date(now);
  const first = new Date(today.getFullYear(), today.getMonth(), 1, 12).getTime();
  return <>{i18n.t('stats.monthNote', { date: i18n.formatTime(first, 'day'), period: i18n.plural('common.days', stats.windowDays) })}</>;
}

/** One line of a key and its value; the value's tooltip says how fresh and how complete that very number is. */
function Kv({ label, note = null, value, stamp, none = false }: { readonly label: string; readonly note?: string | null; readonly value: string; readonly stamp: DataStamp; readonly none?: boolean }): JSX.Element {
  const i18n = useI18n();
  const tip = useTooltip(stampText(i18n, stamp));
  return (
    <div class="cg-st__kv">
      <span class="cg-st__k">
        {label}
        {note === null ? null : <span class="cg-st__f"> · {note}</span>}
      </span>
      <b class={`cg-st__v cg-num${none ? ' is-none' : ''}`} {...tip.props}>
        {value}
        {tip.description}
      </b>
    </div>
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

/** The model's net by day; a day of refunds over its income (a negative net) stands as the lowest bar. */
function Chart({ stats, axisMiddle }: { readonly stats: SpendersStatsVM; readonly axisMiddle: boolean }): JSX.Element | null {
  const i18n = useI18n();
  const days = stats.days;
  if (days.length === 0) return null;
  const max = days.reduce((top, day) => Math.max(top, day.net ?? 0), 0);
  const first = days[0];
  const middle = days[Math.floor((days.length - 1) / 2)];
  const dayName = (date: string): string => statsDayName(i18n, date);
  // A day without money is «трат нет» in its tooltip and its row for a screen reader, as everywhere (X55).
  const dayMoney = (net: number | null): string => (net === 0 ? i18n.t('stats.none') : i18n.formatMoneyMills(net, { zero: 'show' }));
  return (
    <>
      <div class="cg-spark" role="img" aria-label={i18n.t('stats.chart.title')}>
        {days.map((day) => (
          <Bar
            key={day.date}
            share={day.net === null ? null : max > 0 ? Math.max(0, day.net) / max : 0}
            today={day.today}
            tip={i18n.t('stats.chart.dayTip', { date: dayName(day.date), money: dayMoney(day.net) })}
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
              <td>{dayMoney(day.net)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/** «Тир · фанов · на руки»: the tiers from the richest down, the remainders muted under a hairline. */
function Tiers({ stats, period }: { readonly stats: SpendersStatsVM; readonly period: string }): JSX.Element | null {
  const i18n = useI18n();
  if (stats.shelves.length === 0) return null;
  const tiers = stats.shelves.filter((shelf) => shelf.remainder === undefined);
  const rest = stats.shelves.filter((shelf) => shelf.remainder !== undefined);
  const row = (shelf: SpendersStatsVM['shelves'][number]): JSX.Element => {
    const named = shelf.remainder === undefined ? shelfTier(i18n, shelf.range) : null;
    return (
      <tr key={shelf.id} data-cg-tier={shelf.remainder ?? shelf.id}>
        <td>
          {named ?? statsShelfLabel(i18n, shelf)}
          {named === null ? null : <span class="cg-st__f"> {shelfLabel(i18n, shelf.range)}</span>}
        </td>
        <td class="cg-num">{shelf.fans === null ? unknownMark(i18n) : shelf.fans}</td>
        <td class="cg-num is-main">{i18n.formatMoneyMills(shelf.net, { zero: 'show' })}</td>
      </tr>
    );
  };
  return (
    <div class="cg-st__sec">
      <div class="cg-st__sh">{i18n.t('stats.byTier', { period })}</div>
      <table class="cg-st__tiers">
        <thead>
          <tr>
            <th scope="col">{i18n.t('stats.table.shelf')}</th>
            <th scope="col">{i18n.t('stats.colFans')}</th>
            <th scope="col">{i18n.t('stats.colNet')}</th>
          </tr>
        </thead>
        <tbody>{tiers.map(row)}</tbody>
        {rest.length === 0 ? null : <tbody class="is-rest">{rest.map(row)}</tbody>}
      </table>
    </div>
  );
}

/** «Кому написать»: who waits and who has gone quiet, each a way into the list («показать ›»). */
function WhoToWrite({ stats, onShow }: { readonly stats: SpendersStatsVM; readonly onShow: (what: StatsShow) => void }): JSX.Element {
  const i18n = useI18n();
  const a = stats.attention;
  const links: readonly { readonly id: StatsShow; readonly label: string; readonly stat: CountStat }[] = [
    { id: 'waiting', label: i18n.t('stats.awaiting'), stat: a.awaiting },
    { id: 'silent-8-21', label: i18n.t('stats.silent8to21'), stat: a.silent8to21 },
    { id: 'silent-over-21', label: i18n.t('stats.silentOver21'), stat: a.silentOver21 },
    { id: 'no-history', label: i18n.t('stats.noData'), stat: a.noData },
  ];
  return (
    <div class="cg-st__sec">
      <div class="cg-st__sh">{i18n.t('stats.attention')}</div>
      {links.map((link) => (
        <button key={link.id} type="button" class={`cg-st__lk${link.id === 'waiting' ? ' is-waiting' : ''}`} data-cg-show={link.id} onClick={() => onShow(link.id)}>
          <span class="cg-st__lt">
            {link.id === 'waiting' ? <span class="cg-st__dot" aria-hidden="true" /> : null}
            {link.label}
          </span>
          <span class="cg-st__go" aria-hidden="true">
            {i18n.t('stats.show')} ›
          </span>
          <span class="cg-st__lv cg-num">{link.stat.count === null ? unknownMark(i18n) : link.stat.count}</span>
        </button>
      ))}
    </div>
  );
}

function hasNumbers(stats: SpendersStatsVM): boolean {
  return stats.view.s === 'ready' || stats.view.s === 'partial' || stats.view.s === 'offline';
}

export interface StatsProps {
  readonly stats: SpendersStatsVM;
  /** «Кому написать»: the list shows those fans. */
  readonly onShow: (what: StatsShow) => void;
}

/** The collapsed statistics: a rail at the window's right edge — ‹, «Статистика» upright, the S key. */
export function StatsRail({ stats, buttonRef = null }: { readonly stats: SpendersStatsVM; readonly buttonRef?: RefObject<HTMLButtonElement | null> | null }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  return (
    <aside class="cg-st is-rail" aria-label={i18n.t('stats.regionLabel')} data-cg-stats={stats.view.s} data-cg-stats-open="false">
      <button
        type="button"
        class="cg-st__rail"
        ref={buttonRef}
        aria-label={i18n.t('stats.open')}
        aria-expanded="false"
        aria-keyshortcuts="S"
        onClick={() => void dispatch({ type: 'SetStatsOpen', open: true })}
      >
        <span class="cg-st__chev">
          <Icon name="chevronLeft" size={12} />
        </span>
        <span class="cg-st__raillabel" aria-hidden="true">
          {i18n.t('stats.title')}
        </span>
        <kbd aria-hidden="true">S</kbd>
      </button>
    </aside>
  );
}

/** The column beside the list: the model's net of 30 days with its chart, the week, the tiers, «Кому написать». */
export function StatsColumn({ stats, onShow, collapseRef = null }: StatsProps & { readonly collapseRef?: RefObject<HTMLButtonElement | null> | null }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const period = i18n.plural('common.days', stats.windowDays);
  const paid = paidText(i18n, stats);
  const bigTip = useTooltip(stampText(i18n, stats.d30.stamp));
  return (
    <aside class="cg-st" aria-label={i18n.t('stats.regionLabel')} data-cg-stats={stats.view.s} data-cg-stats-open="true">
      <div class="cg-st__head">
        <h3 class="cg-st__title">{i18n.t('stats.title')}</h3>
        <Button label={i18n.t('stats.expand')} variant="line" size="sm" class="cg-st__btn" onClick={() => void dispatch({ type: 'SetStatsExpanded', expanded: true })} />
        <Button
          label={i18n.t('stats.close')}
          icon="chevronRight"
          iconOnly
          variant="line"
          size="sm"
          class="cg-st__btn"
          buttonRef={collapseRef}
          tooltip={`${i18n.t('stats.close')}  S`}
          onClick={() => void dispatch({ type: 'SetStatsOpen', open: false })}
        />
      </div>
      {hasNumbers(stats) ? (
        <div class="cg-st__body">
          {stats.view.s === 'offline' ? <ViewState view={stats.view} /> : null}
          <div class="cg-st__kpi">
            <div class="cg-st__cap">{i18n.t('stats.netCap', { period })}</div>
            <div class={`cg-st__big cg-num${noSpend(stats.d30) ? ' is-none' : ''}`} {...bigTip.props}>
              {moneyText(i18n, stats.d30)}
              {bigTip.description}
            </div>
            {paid === null ? null : <div class="cg-st__sub">{paid}</div>}
            <Chart stats={stats} axisMiddle={false} />
          </div>
          <div class="cg-st__sec">
            <Kv label={i18n.t('stats.today')} value={moneyText(i18n, stats.today)} none={noSpend(stats.today)} stamp={stats.today.stamp} />
            <Kv label={i18n.t('stats.d7')} note={d7Change(i18n, stats.d7.changePct)} value={moneyText(i18n, stats.d7)} none={noSpend(stats.d7)} stamp={stats.d7.stamp} />
            <Kv label={i18n.t('stats.payers')} value={fansText(i18n, stats.payers)} stamp={stats.payers.stamp} />
            <Kv label={i18n.t('stats.avgCheck')} value={moneyText(i18n, stats.avgCheck)} none={noSpend(stats.avgCheck)} stamp={stats.avgCheck.stamp} />
          </div>
          <Tiers stats={stats} period={period} />
          <WhoToWrite stats={stats} onShow={onShow} />
          <div class="cg-st__foot">
            <MonthNote stats={stats} />
            {stats.stamp.coverage === 'complete' ? null : <div>{stampText(i18n, stats.stamp)}</div>}
          </div>
        </div>
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
      <div class="cg-st__cap">{caption}</div>
      <div class={`cg-st__big cg-num${none ? ' is-none' : ''}`}>{value}</div>
      {sub === null ? null : <div class="cg-stx__sub cg-num">{sub}</div>}
    </div>
  );
}

/** The expanded view: the same numbers and words, room for the chart, the tiers and «Кому написать» side by side. */
export function StatsExpanded({ stats, onShow }: StatsProps): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const period = i18n.plural('common.days', stats.windowDays);
  const max = stats.days.reduce((top, day) => Math.max(top, day.net ?? 0), 0);
  const coverage = coverageWord(i18n, stats.stamp.coverage);
  const time = timeOrUnknown(i18n, stats.stamp.asOf);
  const change = d7Change(i18n, stats.d7.changePct);
  return (
    <section class="cg-stx" aria-label={i18n.t('stats.regionLabel')} data-cg-stats={stats.view.s} data-cg-stats-open="expanded">
      <div class="cg-st__head cg-stx__head">
        <h3 class="cg-st__title">{i18n.t('stats.titleFull', { period })}</h3>
        <Button label={i18n.t('stats.collapse')} icon="collapse" size="sm" onClick={() => void dispatch({ type: 'SetStatsExpanded', expanded: false })} />
      </div>
      {hasNumbers(stats) ? (
        <>
          {stats.view.s === 'offline' ? <ViewState view={stats.view} /> : null}
          <div class="cg-stx__grid">
            <Tile caption={i18n.t('stats.netCap', { period })} value={moneyText(i18n, stats.d30)} none={noSpend(stats.d30)} sub={paidText(i18n, stats)} />
            <Tile caption={i18n.t('stats.today')} value={moneyText(i18n, stats.today)} none={noSpend(stats.today)} sub={i18n.t('stats.tile.todaySub')} />
            <Tile
              caption={i18n.t('stats.d7')}
              value={moneyText(i18n, stats.d7)}
              none={noSpend(stats.d7)}
              sub={change}
            />
            <Tile
              caption={i18n.t('stats.payers')}
              value={fansText(i18n, stats.payers)}
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
              <Tiers stats={stats} period={period} />
            </div>
            <div>
              <WhoToWrite stats={stats} onShow={onShow} />
              <div class="cg-stx__foot">
                <span>{stats.timeZone === null ? i18n.t('stats.footer', { time, coverage }) : i18n.t('stats.footerFull', { time, coverage, tz: zoneLabel(stats.timeZone, stats.stamp.asOf) })}</span>
                {/* SP-024: with the statistics expanded the board's footer is not on screen. */}
                <RefreshButton views={STATS_REFRESH} />
              </div>
              <div class="cg-stx__note">
                <MonthNote stats={stats} />
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

// The column (336 px) and its rail (40 px), the mockup's: a 40 px head with «Развернуть» and ›, the net in 30 px over
// one muted line, the bars of the days, hairlines between the sections, rows of 24 px; «Кому написать» rows of 28 px
// with «показать ›» on hover, the count of who waits in terracotta — the colour the board keeps for «ждёт».
export const STATS_CSS = `
.cg-st { position: relative; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.cg-st.is-rail { overflow: hidden; }
.cg-st__rail {
  flex: 1; display: flex; flex-direction: column; align-items: center; gap: 12px; padding-top: 8px; width: 100%;
  color: var(--cg-ink-muted); cursor: pointer;
}
.cg-st__rail:hover, .cg-st .cg-st__rail:focus-visible { background: var(--cg-sunk); color: var(--cg-ink-strong); outline: none; border-radius: 0; }
.cg-st__chev {
  display: grid; place-items: center; width: 24px; height: 24px; border-radius: var(--cg-r-sm);
  box-shadow: inset 0 0 0 1px var(--cg-rule-3); background: var(--cg-surface); color: var(--cg-ink);
}
.cg-st__rail:hover .cg-st__chev, .cg-st__rail:focus-visible .cg-st__chev { box-shadow: inset 0 0 0 1px var(--cg-ink-muted); color: var(--cg-ink-strong); }
.cg-st__raillabel { writing-mode: vertical-rl; transform: rotate(180deg); font-size: var(--cg-text-sm); letter-spacing: 0.02em; }
.cg-st__rail kbd, .cg-st__kv kbd {
  display: inline-flex; align-items: center; justify-content: center; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 4px;
  box-shadow: inset 0 0 0 1px var(--cg-rule-2); font: 500 var(--cg-text-2xs)/16px var(--cg-font); color: var(--cg-ink-muted);
}
.cg-st__rail:hover kbd { color: var(--cg-ink); box-shadow: inset 0 0 0 1px var(--cg-rule-3); }
.cg-st__head { flex: none; display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 16px; }
.cg-st__title { flex: 1; min-width: 0; margin: 0; font-size: var(--cg-text-base); font-weight: 600; color: var(--cg-ink-strong); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cg-spw .cg-st__btn.cg-btn--line { height: 24px; background: none; box-shadow: inset 0 0 0 1px var(--cg-rule-2); color: var(--cg-ink-2); font-size: var(--cg-text-sm); }
.cg-spw .cg-st__btn.cg-btn--line:hover { background: var(--cg-sunk); box-shadow: inset 0 0 0 1px var(--cg-rule-3); color: var(--cg-ink-strong); }
.cg-spw .cg-st__btn.cg-btn--icon { width: 24px; }
.cg-st__body { flex: 1; min-height: 0; overflow-y: auto; padding: 0 16px 8px; scrollbar-width: thin; scrollbar-color: var(--cg-rule-2) transparent; }
.cg-st__kpi { padding-top: 8px; }
.cg-st__cap { display: flex; justify-content: space-between; gap: 8px; font-size: var(--cg-text-sm); font-weight: 500; color: var(--cg-ink-2); }
.cg-st__big { margin-top: 4px; font-size: 30px; line-height: 32px; font-weight: 600; color: var(--cg-ink-strong); letter-spacing: -0.01em; font-variant-numeric: tabular-nums; }
/* A known zero (X55): the words in muted ink on the number's line, so the tiles keep their height. */
.cg-st__big.is-none { font-size: var(--cg-text-xl); font-weight: 500; color: var(--cg-ink-muted); letter-spacing: 0; }
.cg-st__sub { margin-top: 4px; font-size: var(--cg-text-sm); color: var(--cg-ink-muted); }
.cg-st__sec { margin-top: 12px; padding-top: 8px; border-top: 1px solid var(--cg-rule); }
.cg-st__sh { display: flex; align-items: center; height: 24px; font-size: var(--cg-text-xs); font-weight: 500; color: var(--cg-ink-muted); }
.cg-st__kv { display: flex; align-items: center; justify-content: space-between; gap: 8px; height: 24px; font-size: var(--cg-text-sm2); color: var(--cg-ink-2); white-space: nowrap; }
.cg-st__k { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.cg-st__f { color: var(--cg-ink-faint); }
.cg-st__v { flex: none; font-weight: 500; color: var(--cg-ink-strong); }
.cg-st__v.is-none { color: var(--cg-ink-muted); font-weight: 400; }
.cg-st__tiers { width: 100%; border-collapse: collapse; font-size: var(--cg-text-sm2); line-height: 16px; font-variant-numeric: tabular-nums; }
.cg-st__tiers th { height: 24px; padding: 0; font-size: var(--cg-text-xs); font-weight: 500; color: var(--cg-ink-faint); text-align: right; white-space: nowrap; }
.cg-st__tiers th:first-child { text-align: left; }
.cg-st__tiers td { height: 24px; padding: 0; text-align: right; color: var(--cg-ink-muted); white-space: nowrap; }
.cg-st__tiers td:first-child { text-align: left; color: var(--cg-ink-2); }
.cg-st__tiers :is(td, th) + :is(td, th) { padding-left: 16px; }
.cg-st__tiers td.is-main { color: var(--cg-ink-strong); font-weight: 500; }
.cg-st__tiers tbody.is-rest td, .cg-st__tiers tbody.is-rest td:first-child, .cg-st__tiers tbody.is-rest td.is-main { color: var(--cg-ink-faint); font-weight: 400; }
.cg-st__tiers tbody.is-rest tr:first-child td { height: 32px; padding-top: 4px; border-top: 1px solid var(--cg-rule); }
.cg-st__lk {
  display: flex; align-items: center; gap: 8px; width: calc(100% + 16px); height: 28px; margin: 0 -8px; padding: 0 8px; border-radius: var(--cg-r-sm);
  font-size: var(--cg-text-sm2); color: var(--cg-ink-2); text-align: left; white-space: nowrap;
}
.cg-st__lt { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.cg-st__go { visibility: hidden; font-size: var(--cg-text-sm); color: var(--cg-ink-muted); }
.cg-st__lv { min-width: 24px; text-align: right; font-weight: 500; color: var(--cg-ink-strong); }
.cg-st__lk.is-waiting .cg-st__lv { color: var(--cg-clay-ink); font-weight: 600; }
.cg-st__lk:hover, .cg-st .cg-st__lk:focus-visible { background: var(--cg-sunk); color: var(--cg-ink-strong); outline: none; }
.cg-st__lk:hover .cg-st__go, .cg-st__lk:focus-visible .cg-st__go { visibility: visible; }
.cg-st__dot { display: inline-block; width: 6px; height: 6px; margin: 0 8px 1px 0; border-radius: 50%; background: var(--cg-clay-ink); }
.cg-st__foot { margin-top: 12px; padding-top: 8px; border-top: 1px solid var(--cg-rule); font-size: var(--cg-text-xs); line-height: 16px; color: var(--cg-ink-faint); }
.cg-st__state { border-top: 1px solid var(--cg-rule); }
.cg-st .cg-card, .cg-stx .cg-card { border-top: 1px solid var(--cg-rule); }
.cg-spark { position: relative; display: flex; align-items: flex-end; gap: 2px; height: 44px; margin-top: 12px; border-bottom: 1px solid var(--cg-rule-2); }
.cg-spark__bar { flex: 1; min-width: 0; min-height: 1px; border-radius: var(--cg-r-xs) var(--cg-r-xs) 0 0; background: var(--cg-bar); }
.cg-spark__bar.is-today { background: var(--cg-ink); }
.cg-spark__bar.is-unknown { min-height: 0; }
.cg-spark__bar:hover { background: var(--cg-ink-2); }
.cg-spark__ax { display: flex; justify-content: space-between; margin-top: 4px; font-size: var(--cg-text-xs); line-height: 16px; color: var(--cg-ink-faint); }

.cg-stx { overflow-y: auto; padding: 0 0 24px; min-width: 0; scrollbar-width: thin; }
.cg-st__head.cg-stx__head { height: 44px; padding: 0 12px 0 20px; }
.cg-stx__grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border-top: 1px solid var(--cg-rule); border-bottom: 1px solid var(--cg-rule); }
.cg-stx__cell { padding: 14px 20px 16px; min-width: 0; }
.cg-stx__cell + .cg-stx__cell { border-left: 1px solid var(--cg-rule); }
.cg-stx__sub { margin-top: 4px; font-size: var(--cg-text-sm); color: var(--cg-ink-muted); }
.cg-stx__chart { padding: 16px 20px 8px; border-bottom: 1px solid var(--cg-rule); }
.cg-stx__chart .cg-spark { height: 160px; gap: 4px; margin-top: 8px; }
.cg-stx__chart .cg-spark__bar { border-radius: 3px 3px 0 0; }
.cg-stx__two { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
.cg-stx__two > * { padding: 2px 20px 14px; min-width: 0; }
.cg-stx__two > * + * { border-left: 1px solid var(--cg-rule); }
.cg-stx__two .cg-st__sec { border-top: 0; }
.cg-stx__foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 4px 12px; padding: 12px 0 0; margin-top: 12px; border-top: 1px solid var(--cg-rule); font-size: var(--cg-text-sm); color: var(--cg-ink-muted); }
.cg-stx__foot .cg-sp__refresh { margin: 0 -8px 0 0; }
.cg-stx__note { margin-top: 8px; font-size: var(--cg-text-xs); line-height: 16px; color: var(--cg-ink-faint); }
@media (max-width: 760px) {
  .cg-stx__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .cg-stx__cell:nth-child(3) { border-left: 0; }
  .cg-stx__cell:nth-child(n + 3) { border-top: 1px solid var(--cg-rule); }
  .cg-stx__two { grid-template-columns: minmax(0, 1fr); }
  .cg-stx__two > * + * { border-left: 0; border-top: 1px solid var(--cg-rule); }
}
`;
