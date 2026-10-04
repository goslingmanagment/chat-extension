// Retry deadlines and their countdown (ER-006; ui-design §4.8). A deadline
// is fixed ONCE as an absolute moment (`retryAt`) when the error arrives and
// the countdown is recomputed from it on every tick, never decremented:
// a sleeping laptop or a throttled tab never shows a wrong number. The text
// cannot be taken for a time of day: from an hour up «17 ч 39 мин» (changes
// once a minute), under an hour «39 мин 12 с», under a minute «24 с». The
// surface ticks every 250 ms; `nextChangeMs` lets it sleep until the text
// actually changes. Retrying stays manual.

import { type Translator } from '../i18n';

export const COUNTDOWN_TICK_MS = 250;

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export type CountdownStyle = 'hours' | 'minutes' | 'seconds' | 'done';

export interface Countdown {
  readonly expired: boolean;
  readonly remainingMs: number;
  readonly style: CountdownStyle;
  readonly hours: number;
  readonly minutes: number;
  readonly seconds: number;
  /** Whole seconds left, rounded up (what «через N с» shows). */
  readonly totalSeconds: number;
  /** Milliseconds until the shown text changes; 0 when expired. */
  readonly nextChangeMs: number;
}

export function countdown(retryAt: number, now: number): Countdown {
  const remaining = Number.isFinite(retryAt) && Number.isFinite(now) ? Math.max(0, retryAt - now) : 0;
  if (remaining === 0) {
    return { expired: true, remainingMs: 0, style: 'done', hours: 0, minutes: 0, seconds: 0, totalSeconds: 0, nextChangeMs: 0 };
  }
  const totalSeconds = Math.ceil(remaining / SECOND);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  let style: CountdownStyle;
  let nextChangeMs: number;
  if (totalSeconds >= 3600) {
    style = 'hours';
    // The text changes when the whole minutes shown drop by one.
    const shownMinutes = Math.floor(totalSeconds / 60);
    nextChangeMs = remaining - (shownMinutes * 60 - 1) * SECOND;
  } else {
    style = totalSeconds >= 60 ? 'minutes' : 'seconds';
    nextChangeMs = remaining - (totalSeconds - 1) * SECOND;
  }
  return { expired: false, remainingMs: remaining, style, hours, minutes, seconds, totalSeconds, nextChangeMs: Math.max(1, nextChangeMs) };
}

/** «17 ч 39 мин» / «39 мин 12 с» / «24 с»; empty once expired. */
export function formatCountdown(value: Countdown, t: Translator): string {
  switch (value.style) {
    case 'hours':
      return `${t.text('common.age.hours', { n: value.hours })} ${t.text('common.age.minutes', { n: value.minutes })}`;
    case 'minutes':
      return `${t.text('common.age.minutes', { n: value.minutes })} ${t.text('common.seconds', { n: value.seconds })}`;
    case 'seconds':
      return t.text('common.seconds', { n: value.seconds });
    case 'done':
      return '';
  }
}

/** «через 24 с» next to a disabled «Повторить» (provider rate limit); null once it may be retried. */
export function retryInText(value: Countdown, t: Translator): string | null {
  if (value.expired) return null;
  if (value.style === 'seconds') return t.text('cg.retryIn', { n: value.totalSeconds });
  return formatCountdown(value, t);
}

/** «До обновления 17 ч 39 мин» on the CG-QUOTA-DAILY card; null once the quota day is over. */
export function quotaCountdownText(value: Countdown, t: Translator): string | null {
  return value.expired ? null : t.text('cg.quotaDaily.countdown', { hms: formatCountdown(value, t) });
}

/** The AI quota's day boundary: the next 00:00 UTC strictly after `now` (CG-QUOTA-DAILY). */
export function nextUtcMidnight(now: number): number {
  return Math.floor(now / DAY) * DAY + DAY;
}

/** A relative wait turned into the absolute deadline, once (`retryAfterMs` of a 429 or an SSE error). */
export function deadlineFrom(now: number, retryAfterMs: number | null | undefined): number | null {
  if (typeof retryAfterMs !== 'number' || !Number.isFinite(retryAfterMs) || retryAfterMs < 0) return null;
  return Math.round(now + retryAfterMs);
}
