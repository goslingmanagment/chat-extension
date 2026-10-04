// The I18n port of the UI (architecture.md §9.7, §10.2 п. 3). Every string
// the UI shows goes through a key; data (names, handles, message text) comes
// as plain strings, our own words as `Msg`. Money, ages and times stay raw in
// the view models and are formatted only here, so there is one money
// notation everywhere (ui-design §1 п. 6).

import { type I18nKey } from '../errors';
import { type Locale } from '../i18n/keys';
import { type IsoTimestamp, type MoneyMills } from '../primitives';

/**
 * A typed parameter. Plain strings and numbers are inserted as they are;
 * money, ages, times and durations are formatted by the I18n port in the
 * current language, so a view model never carries a preformatted amount.
 */
export type I18nParam =
  | string
  | number
  | { readonly money: MoneyMills | null; readonly sign?: MoneySign }
  | { readonly age: number | IsoTimestamp }
  | { readonly time: number | IsoTimestamp; readonly style?: TimeStyle }
  | { readonly duration: number; readonly style?: DurationStyle };

export type I18nParams = Readonly<Record<string, I18nParam>>;

/** Our own words in a view model: a catalog key and its parameters. */
export interface Msg {
  readonly key: I18nKey;
  readonly params?: I18nParams;
}

/**
 * `auto` — `$12,480`, a negative `−$45`; `plus` — an income `+$320`.
 * A known zero is blank unless `zero: 'show'`; null (unknown) is `—`.
 */
export type MoneySign = 'auto' | 'plus';

export interface MoneyFormat {
  readonly sign?: MoneySign;
  readonly zero?: 'blank' | 'show';
}

/** `time` 09:18, `date` 4 сен, `datetime` 4 сен, 09:18, `day` «30 сен» day separators. */
export type TimeStyle = 'time' | 'date' | 'datetime' | 'day';

/** `m:ss` timers and leases (0:03, 1:24), `h:mm:ss` the quota countdown, `seconds` «24 с». */
export type DurationStyle = 'm:ss' | 'h:mm:ss' | 'seconds';

export interface I18n {
  /** The resolved language (`ui.locale: 'system'` resolves to one); changes on the fly (I18-001). */
  readonly language: Locale;
  /** Plain text, never markup. A missing key renders the key itself and is logged. */
  t(key: I18nKey, params?: I18nParams): string;
  /** `Intl.PluralRules` forms one/few/many/other of the key («1 часть / 2 части / 5 частей»). */
  plural(key: I18nKey, count: number, params?: I18nParams): string;
  /** Shorthand for `t(msg.key, msg.params)`. */
  text(msg: Msg): string;
  /** `$12,480`; income `+$320`; `−$45`; zero blank by default; null `—`. Whole dollars. */
  formatMoneyMills(mills: MoneyMills | null, format?: MoneyFormat): string;
  /**
   * The same amount in words for screen readers (ui-design §6.2): `+$320` →
   * «плюс 320 долларов», `−$45` → «минус 45 долларов», null → «неизвестно»,
   * a blank zero → ''. The `aria-label` of a money cell. Optional (1.1.0):
   * a port without it leaves the amount to be read as printed.
   */
  formatMoneySpoken?(mills: MoneyMills | null, format?: MoneyFormat): string;
  /** «сейчас», «7 мин», «3 ч», «12 д»; `now` defaults to the clock of the port. */
  formatAge(from: number | IsoTimestamp, now?: number): string;
  formatTime(at: number | IsoTimestamp, style?: TimeStyle): string;
  /**
   * The same in a named IANA zone (1.2.0). The daily quota resets at 00:00 UTC
   * and its tooltip says «Обновится в 03:00 по Москве» whatever zone the viewer
   * is in (ui-design §4.1): that one time is printed in `Europe/Moscow`. A zone
   * the runtime does not know gives `—`. Optional: a port without it can only
   * print its own zone.
   */
  formatTimeIn?(at: number | IsoTimestamp, timeZone: string, style?: TimeStyle): string;
  formatDuration(ms: number, style: DurationStyle): string;
  /** Called after a language switch; the views re-render with new texts. */
  subscribe(listener: (language: Locale) => void): () => void;
}
