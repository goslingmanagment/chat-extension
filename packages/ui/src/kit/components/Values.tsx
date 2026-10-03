// Money, ages, times, durations and countdowns, formatted only by the I18n
// port (ui-design §1 п. 6, §2.3, §4.8): tabular digits, one money notation,
// green only for money that came in (`+$320`), and the amount in words for
// a money cell's name (§6.2). Live values schedule one timer
// for their next change and none when idle.

import { type JSX } from 'preact';

import { type IsoTimestamp, type MoneyMills } from '@cg/contracts/primitives';
import { type DurationStyle, type MoneyFormat, type MoneySign, type TimeStyle } from '@cg/contracts/vm';

import { countdownParts, useCountdown, useElapsed, useMinuteClock } from '../clock';
import { useI18n, useNowFn } from '../context';

export interface MoneyProps {
  readonly mills: MoneyMills | null;
  /** `plus` marks income: `+$320` in green (the only green, ui-design §1 п. 4). */
  readonly sign?: MoneySign;
  readonly zero?: 'blank' | 'show';
  /**
   * The amount is a table cell of its own (`role="cell"`): the cell is named
   * by the amount in words, «плюс 320 долларов» (ui-design §6.2). Off for an
   * amount inside a sentence or a bigger cell — a plain span cannot carry a
   * name; such a cell takes `useSpokenMoney` for its own `aria-label`.
   */
  readonly cell?: boolean;
  readonly class?: string;
}

/** The amount in words from the I18n port for an `aria-label`; null when there is nothing to say or the port cannot. */
export function useSpokenMoney(mills: MoneyMills | null, format: MoneyFormat = {}): string | null {
  const spoken = useI18n().formatMoneySpoken?.(mills, format);
  return spoken === undefined || spoken === '' ? null : spoken;
}

export function Money({ mills, sign = 'auto', zero = 'blank', cell = false, class: extra }: MoneyProps): JSX.Element {
  const i18n = useI18n();
  const text = i18n.formatMoneyMills(mills, { sign, zero });
  const spoken = useSpokenMoney(mills, { sign, zero });
  const income = sign === 'plus' && mills !== null && text.startsWith('+');
  return (
    <span
      class={`cg-num${income ? ' cg-money' : ''}${extra === undefined ? '' : ` ${extra}`}`}
      {...(cell ? { role: 'cell', ...(spoken === null ? {} : { 'aria-label': spoken }) } : {})}
    >
      {text}
    </span>
  );
}

/** «сейчас», «7 мин», «3 ч», «12 д»; refreshed by the shared minute ticker while shown. */
export function Age({ from, suffix = false }: { readonly from: number | IsoTimestamp | null; readonly suffix?: boolean }): JSX.Element {
  const i18n = useI18n();
  useMinuteClock(from !== null);
  if (from === null) return <span class="cg-num">{i18n.t('common.unknown')}</span>;
  const age = i18n.formatAge(from);
  return <span class="cg-num">{suffix ? i18n.t('common.agoSuffix', { age }) : age}</span>;
}

export function Time({ at, style = 'time' }: { readonly at: number | IsoTimestamp | null; readonly style?: TimeStyle }): JSX.Element {
  const i18n = useI18n();
  return <span class="cg-num">{at === null ? i18n.t('common.unknown') : i18n.formatTime(at, style)}</span>;
}

export function Duration({ ms, style }: { readonly ms: number; readonly style: DurationStyle }): JSX.Element {
  return <span class="cg-num">{useI18n().formatDuration(ms, style)}</span>;
}

/** The m:ss timer of a running generation, counted from `since` (ResultVM.startedAt). */
export function ElapsedTimer({ since, running = true }: { readonly since: number; readonly running?: boolean }): JSX.Element {
  const i18n = useI18n();
  const elapsed = useElapsed(since, useNowFn(), running);
  return <span class="cg-num">{i18n.formatDuration(Math.floor(elapsed / 1000) * 1000, 'm:ss')}</span>;
}

/** «17 ч 39 мин» from an hour up, «39 мин 12 с» below, «12 с» under a minute (ui-design §4.8). */
export function useCountdownText(until: number | null): { readonly text: string; readonly remaining: number } {
  const i18n = useI18n();
  const remaining = useCountdown(until, useNowFn());
  const { hours, minutes, seconds } = countdownParts(remaining);
  const parts: string[] = [];
  if (hours > 0) parts.push(i18n.t('common.age.hours', { n: hours }), i18n.t('common.age.minutes', { n: minutes }));
  else if (minutes > 0) parts.push(i18n.t('common.age.minutes', { n: minutes }), i18n.t('common.seconds', { n: seconds }));
  else parts.push(i18n.t('common.seconds', { n: seconds }));
  return { text: parts.join(' '), remaining };
}

/** A countdown to a fixed deadline (`retryAt` is fixed once, ER-007); nothing once it passed. */
export function Countdown({ until }: { readonly until: number }): JSX.Element | null {
  const { text, remaining } = useCountdownText(until);
  return remaining > 0 ? <span class="cg-num">{text}</span> : null;
}

export const VALUES_CSS = `
.cg-num { font-variant-numeric: tabular-nums; }
.cg-money { color: var(--cg-money); }
`;
