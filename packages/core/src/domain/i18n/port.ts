// The I18n port of the UI (architecture.md §9.7, §10.2 п. 3; contract
// `@cg/contracts/vm` I18n): texts from the ru/en catalogs, plural forms by
// Intl.PluralRules, and the one place that formats money (printed and
// spoken), ages, times and durations, so every surface prints them the same
// way (ui-design §1 п. 6, §5, §6.2). The language switches on the fly (I18-001): `setLanguage` notifies
// the subscribers and the views re-render with the new texts.
//
// Pure: the clock and the time zone come from the caller; no DOM, no
// storage, no timers. Plain text only, never markup.

import { isPluralKey, type I18nPlainParams } from '@cg/contracts/i18n/catalog';
import { type Locale } from '@cg/contracts/i18n/keys';
import {
  type DurationStyle,
  type I18n,
  type I18nParam,
  type I18nParams,
  type MoneyFormat,
  type Msg,
  type TimeStyle,
} from '@cg/contracts/vm';
import { type I18nKey } from '@cg/contracts/errors';

import { CATALOGS, interpolate } from './catalogs';

/** U+2212, the minus of `−$45` (ui-design §1 п. 6). */
export const MINUS_SIGN = '−';
/** `null` — unknown, never 0 (architecture.md §10.2 п. 1). */
export const UNKNOWN_VALUE = '—';

export interface I18nOptions {
  readonly language: Locale;
  /** Epoch ms; defaults to Date.now. Ages without an explicit `now` count from here. */
  readonly now?: () => number;
  /** IANA zone for times and dates; defaults to the runtime's own (the chatter's clock). */
  readonly timeZone?: string;
  /**
   * A key the catalog of `language` does not have (it renders as the key
   * itself): the composition root logs it (I18-004). Once per key and
   * language; the key name only, never a text.
   */
  readonly onMissing?: (key: string, language: Locale) => void;
}

/** The port plus the switch the composition root calls when `ui.locale` (or the system language) changes. */
export interface LiveI18n extends I18n {
  setLanguage(language: Locale): void;
}

/**
 * `$12,480`; income `+$320`; a loss `−$45`; a known zero is blank unless
 * `zero: 'show'`; null is `—`. Whole dollars (mills / 1000, rounded half away
 * from zero), a comma between thousands in every language: one notation.
 */
export function formatMoneyMills(mills: number | null, format: MoneyFormat = {}): string {
  if (mills === null || !Number.isFinite(mills)) return UNKNOWN_VALUE;
  const dollars = Math.round(Math.abs(mills) / 1000);
  if (mills === 0 && format.zero !== 'show') return '';
  const digits = groupThousands(dollars);
  if (mills < 0 && dollars > 0) return `${MINUS_SIGN}$${digits}`;
  return `${format.sign === 'plus' && dollars > 0 ? '+' : ''}$${digits}`;
}

function groupThousands(value: number): string {
  return Math.trunc(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

const toEpoch = (at: number | string): number => (typeof at === 'number' ? at : Date.parse(at));

/**
 * `m:ss` for timers and leases, `h:mm:ss` for long countdowns, `seconds` as
 * «24 с». Fractions of a second round up: a countdown never shows 0 while
 * time is left; an elapsed timer passes whole seconds.
 */
function durationParts(ms: number): { h: number; m: number; s: number; total: number } {
  const total = Number.isFinite(ms) ? Math.max(0, Math.ceil(ms / 1000)) : 0;
  return { h: Math.floor(total / 3600), m: Math.floor((total % 3600) / 60), s: total % 60, total };
}

const pad2 = (n: number): string => n.toString().padStart(2, '0');

/**
 * Month abbreviations as the copy deck writes them («4 сен», «3 окт», «14 мар
 * 2024»; «4 Sep»). Fixed lists, not Intl: ICU versions disagree («сент.»,
 * «Sept») and one notation must not depend on the browser build.
 */
const MONTHS: Record<Locale, readonly string[]> = {
  ru: ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};

interface DateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: string;
  readonly minute: string;
}

export function createI18n(options: I18nOptions): LiveI18n {
  let language = options.language;
  const clock = options.now ?? Date.now;
  const listeners = new Set<(language: Locale) => void>();
  const partsFormat = new Intl.DateTimeFormat('en-GB', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    ...(options.timeZone === undefined ? {} : { timeZone: options.timeZone }),
  });
  const pluralRules = new Map<Locale, Intl.PluralRules>();
  const reported = new Set<string>();
  const missing = (key: string): string => {
    const id = `${language}\u0000${key}`;
    if (options.onMissing !== undefined && !reported.has(id)) {
      reported.add(id);
      options.onMissing(key, language);
    }
    return key;
  };

  const rulesFor = (locale: Locale): Intl.PluralRules => {
    let rules = pluralRules.get(locale);
    if (rules === undefined) {
      rules = new Intl.PluralRules(locale);
      pluralRules.set(locale, rules);
    }
    return rules;
  };

  const dateParts = (at: number): DateParts => {
    const parts = partsFormat.formatToParts(new Date(at));
    const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? '';
    return { year: Number(part('year')), month: Number(part('month')), day: Number(part('day')), hour: part('hour'), minute: part('minute') };
  };

  const monthName = (month: number): string => MONTHS[language][month - 1] ?? '';

  const formatTime = (at: number | string, style: TimeStyle = 'time'): string => {
    const epoch = toEpoch(at);
    if (!Number.isFinite(epoch)) return UNKNOWN_VALUE;
    const parts = dateParts(epoch);
    const time = `${parts.hour}:${parts.minute}`;
    if (style === 'time') return time;
    const thisYear = dateParts(clock()).year;
    const day = `${parts.day} ${monthName(parts.month)}${parts.year === thisYear ? '' : ` ${parts.year}`}`;
    if (style === 'datetime') return `${day}, ${time}`;
    return day;
  };

  const catalogText = (key: I18nKey, params: I18nPlainParams | undefined, count: number | null): string => {
    const message: unknown = (CATALOGS[language] as Readonly<Record<string, unknown>>)[key];
    if (typeof message === 'string') return interpolate(message, params);
    if (message !== null && typeof message === 'object') {
      const forms = message as Readonly<Record<string, string>>;
      const n = count ?? (typeof params?.['n'] === 'number' ? params['n'] : null);
      const form = n === null ? forms['other'] : (forms[rulesFor(language).select(n)] ?? forms['other']);
      return form === undefined ? missing(key) : interpolate(form, n === null ? params : { ...params, n });
    }
    // A key the catalog does not have shows itself: visible in review, never blank (§9.7), and reported.
    return missing(key);
  };

  // «плюс 320 долларов» for screen readers (ui-design §6.2): the same rounding and blanks as the printed form.
  const formatMoneySpoken = (mills: number | null, format: MoneyFormat = {}): string => {
    if (mills === null || !Number.isFinite(mills)) return catalogText('common.unknown', undefined, null);
    if (mills === 0 && format.zero !== 'show') return '';
    const dollars = Math.round(Math.abs(mills) / 1000);
    const amount = catalogText('common.money.dollars', undefined, dollars);
    if (mills < 0 && dollars > 0) return catalogText('common.money.minus', { amount }, null);
    if (format.sign === 'plus' && dollars > 0) return catalogText('common.money.plus', { amount }, null);
    return amount;
  };

  const formatAge = (from: number | string, now: number = clock()): string => {
    const start = toEpoch(from);
    if (!Number.isFinite(start)) return UNKNOWN_VALUE;
    const minutes = Math.floor(Math.max(0, now - start) / 60_000);
    if (minutes < 1) return catalogText('common.age.now', undefined, null);
    if (minutes < 60) return catalogText('common.age.minutes', { n: minutes }, null);
    if (minutes < 24 * 60) return catalogText('common.age.hours', { n: Math.floor(minutes / 60) }, null);
    return catalogText('common.age.days', { n: Math.floor(minutes / (24 * 60)) }, null);
  };

  const formatDuration = (ms: number, style: DurationStyle): string => {
    const { h, m, s, total } = durationParts(ms);
    if (style === 'seconds') return catalogText('common.seconds', { n: total }, null);
    if (style === 'm:ss') return `${Math.floor(total / 60)}:${pad2(s)}`;
    return `${h}:${pad2(m)}:${pad2(s)}`;
  };

  const plainParam = (value: I18nParam): string | number => {
    if (typeof value === 'string' || typeof value === 'number') return value;
    if ('money' in value) return formatMoneyMills(value.money, value.sign === undefined ? {} : { sign: value.sign });
    if ('age' in value) return formatAge(value.age);
    if ('time' in value) return formatTime(value.time, value.style);
    return formatDuration(value.duration, value.style ?? 'm:ss');
  };

  const plainParams = (params: I18nParams | undefined): I18nPlainParams | undefined => {
    if (params === undefined) return undefined;
    const out: Record<string, string | number> = {};
    for (const [name, value] of Object.entries(params)) out[name] = plainParam(value);
    return out;
  };

  const t = (key: I18nKey, params?: I18nParams): string => catalogText(key, plainParams(params), null);

  return {
    get language() {
      return language;
    },
    t,
    plural: (key, count, params) => catalogText(key, plainParams(params), count),
    text: (msg: Msg) => (isPluralKey(msg.key) ? catalogText(msg.key, plainParams(msg.params), null) : t(msg.key, msg.params)),
    formatMoneyMills,
    formatMoneySpoken,
    formatAge,
    formatTime,
    formatDuration,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setLanguage(next) {
      if (next === language) return;
      language = next;
      for (const listener of [...listeners]) listener(next);
    },
  };
}
