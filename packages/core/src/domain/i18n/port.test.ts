// The UI's I18n port (architecture.md §9.7, §10.2 п. 3): live language
// switching, plural forms, and the one notation for money, ages, times and
// durations (ui-design §1 п. 6, §5).

import { describe, expect, it } from 'vitest';

import { I18N_KEYS, isPluralKey } from '@cg/contracts/i18n/catalog';
import { cgTitleKey, LOCALES, type Locale } from '@cg/contracts/i18n/keys';

import { createI18n, formatMoneyMills, MINUS_SIGN } from './index';

const NOW = Date.parse('2026-10-03T09:20:00Z');
const make = (language: Locale = 'ru') => createI18n({ language, now: () => NOW, timeZone: 'UTC' });

describe('[I18-001] languages RU / EN, switched on the fly', () => {
  it('texts follow setLanguage and every subscriber hears the switch once', () => {
    const i18n = make('ru');
    const heard: Locale[] = [];
    const off = i18n.subscribe((language) => heard.push(language));
    expect(i18n.t('common.copy')).toBe('Копировать');
    i18n.setLanguage('en');
    expect(i18n.language).toBe('en');
    expect(i18n.t('common.copy')).toBe('Copy');
    i18n.setLanguage('en');
    off();
    i18n.setLanguage('ru');
    expect(heard).toEqual(['en']);
    expect(i18n.t('common.copy')).toBe('Копировать');
  });

  it('formatters switch with the language too', () => {
    const i18n = make('ru');
    expect(i18n.formatAge(NOW - 7 * 60_000)).toBe('7 мин');
    i18n.setLanguage('en');
    expect(i18n.formatAge(NOW - 7 * 60_000)).toBe('7 min');
    expect(i18n.formatTime('2026-09-04T09:18:00Z', 'date')).toBe('4 Sep');
  });
});

describe('[I18-004] nothing untranslated: every key renders text in both languages', () => {
  it('no key falls back to itself, plural keys included', () => {
    for (const language of LOCALES) {
      const i18n = make(language);
      for (const key of I18N_KEYS) {
        const text = isPluralKey(key) ? i18n.plural(key, 2) : i18n.t(key);
        expect(text, `${language} ${key}`).not.toBe(key);
        expect(text.trim(), `${language} ${key}`).not.toBe('');
      }
    }
  });

  it('an unknown key shows itself instead of vanishing', () => {
    expect(make().t('no.such.key' as never)).toBe('no.such.key');
  });

  it('a missing key is reported once per key and language, by its name only', () => {
    const heard: Array<[string, Locale]> = [];
    const i18n = createI18n({ language: 'ru', now: () => NOW, onMissing: (key, language) => heard.push([key, language]) });
    expect(i18n.t('no.such.key' as never, { name: 'Hubert' })).toBe('no.such.key');
    expect(i18n.plural('no.such.plural' as never, 3)).toBe('no.such.plural');
    i18n.t('no.such.key' as never);
    expect(i18n.t('common.copy')).toBe('Копировать');
    i18n.setLanguage('en');
    i18n.text({ key: 'no.such.key' as never });
    expect(heard).toEqual([
      ['no.such.key', 'ru'],
      ['no.such.plural', 'ru'],
      ['no.such.key', 'en'],
    ]);
  });
});

describe('I18n port: texts and parameters', () => {
  it('substitutes plain and typed parameters', () => {
    const i18n = make('ru');
    expect(i18n.t('common.errorSource', { code: 'CG-QUOTA-DAILY' })).toBe('ChatGoose · CG-QUOTA-DAILY');
    expect(i18n.t('common.dataAsOf', { time: { time: NOW } })).toBe('данные на 09:20');
    expect(i18n.t('common.agoSuffix', { age: { age: NOW - 3 * 3_600_000 } })).toBe('3 ч назад');
    expect(i18n.t('result.stage.retry503', { n: 5 })).toBe('Сервис недоступен, повтор через 5 с…');
    expect(i18n.t('preview.moneyIn', { moneyIn: { money: 320_000, sign: 'plus' } })).toBe('+$320 за 30 дней');
    expect(i18n.t('send.sent', { time: { time: '2026-10-03T09:21:00Z' } })).toBe('Отправлено 09:21');
    expect(i18n.t('common.dataAsOfCap', { time: { duration: 84_000 } })).toBe('Данные на 1:24');
  });

  it('chooses plural forms by count, by `n`, and `other` without a number', () => {
    const ru = make('ru');
    expect(ru.plural('result.meta.parts', 1)).toBe('1 часть');
    expect(ru.plural('result.meta.parts', 3)).toBe('3 части');
    expect(ru.plural('result.meta.parts', 5)).toBe('5 частей');
    expect(ru.t('result.meta.parts', { n: 21 })).toBe('21 часть');
    expect(ru.text({ key: 'result.meta.parts', params: { n: 2 } })).toBe('2 части');
    expect(ru.text({ key: 'common.copy' })).toBe('Копировать');
    expect(ru.t('result.meta.parts')).toBe('{n} части');
    expect(make('en').plural('common.fans', 1)).toBe('1 fan');
  });

  it('reads registry titles of CG codes', () => {
    expect(make('ru').t(cgTitleKey('CG-UI-FAILED'))).toBe('Сбой интерфейса');
    expect(make('en').t(cgTitleKey('CG-UI-FAILED'))).toBe('Interface failure');
  });
});

describe('I18n port: one money notation (ui-design §1 п. 6)', () => {
  it('whole dollars with a thousands comma, plus and minus, blank zero, unknown dash', () => {
    expect(formatMoneyMills(12_480_000)).toBe('$12,480');
    expect(formatMoneyMills(1_234_567_890)).toBe('$1,234,568');
    expect(formatMoneyMills(320_000, { sign: 'plus' })).toBe('+$320');
    expect(formatMoneyMills(-45_000)).toBe(`${MINUS_SIGN}$45`);
    expect(formatMoneyMills(-45_000, { sign: 'plus' })).toBe(`${MINUS_SIGN}$45`);
    expect(formatMoneyMills(0)).toBe('');
    expect(formatMoneyMills(0, { zero: 'show' })).toBe('$0');
    expect(formatMoneyMills(0, { sign: 'plus', zero: 'show' })).toBe('$0');
    expect(formatMoneyMills(null)).toBe('—');
    expect(formatMoneyMills(Number.NaN)).toBe('—');
    expect(formatMoneyMills(499)).toBe('$0');
    expect(formatMoneyMills(500)).toBe('$1');
    expect(formatMoneyMills(-400)).toBe('$0');
  });

  it('[SP-013] prints cents on request: two digits, three when the mills need them', () => {
    expect(formatMoneyMills(599_600, { cents: true })).toBe('$599.60');
    expect(formatMoneyMills(599_600)).toBe('$600');
    expect(formatMoneyMills(400, { cents: true })).toBe('$0.40');
    expect(formatMoneyMills(405, { cents: true })).toBe('$0.405');
    expect(formatMoneyMills(1_234_500, { cents: true })).toBe('$1,234.50');
    expect(formatMoneyMills(25_000, { cents: true, sign: 'plus' })).toBe('+$25.00');
    expect(formatMoneyMills(-45_500, { cents: true })).toBe(`${MINUS_SIGN}$45.50`);
    expect(formatMoneyMills(0, { cents: true })).toBe('');
    expect(formatMoneyMills(0, { cents: true, zero: 'show' })).toBe('$0.00');
    expect(formatMoneyMills(null, { cents: true })).toBe('—');
  });

  it('is the same in both languages', () => {
    expect(make('ru').formatMoneyMills(4_670_000)).toBe(make('en').formatMoneyMills(4_670_000));
  });

  it('says the amount in words for screen readers: «+$320» is «плюс 320 долларов» (ui-design §6.2)', () => {
    const ru = make('ru');
    const say = (mills: number | null, format?: Parameters<typeof ru.formatMoneyMills>[1]): string => ru.formatMoneySpoken?.(mills, format) ?? 'missing';
    expect(say(320_000, { sign: 'plus' })).toBe('плюс 320 долларов');
    expect(say(-45_000)).toBe('минус 45 долларов');
    expect(say(-45_000, { sign: 'plus' })).toBe('минус 45 долларов');
    expect(say(12_480_000)).toBe('12480 долларов');
    expect(say(1_000)).toBe('1 доллар');
    expect(say(21_000)).toBe('21 доллар');
    expect(say(3_000)).toBe('3 доллара');
    expect(say(0)).toBe('');
    expect(say(0, { zero: 'show', sign: 'plus' })).toBe('0 долларов');
    expect(say(-400)).toBe('0 долларов');
    expect(say(null)).toBe('неизвестно');
    expect(say(Number.NaN)).toBe('неизвестно');
    const en = make('en');
    expect(en.formatMoneySpoken?.(320_000, { sign: 'plus' })).toBe('plus 320 dollars');
    expect(en.formatMoneySpoken?.(1_000)).toBe('1 dollar');
    expect(en.formatMoneySpoken?.(-45_000)).toBe('minus 45 dollars');
  });
});

describe('I18n port: ages, times and durations', () => {
  it('ages: now, minutes, hours, days; future and unknown', () => {
    const ru = make('ru');
    expect(ru.formatAge(NOW - 30_000)).toBe('сейчас');
    expect(ru.formatAge(NOW + 60_000)).toBe('сейчас');
    expect(ru.formatAge(NOW - 59 * 60_000)).toBe('59 мин');
    expect(ru.formatAge(new Date(NOW - 3 * 3_600_000).toISOString())).toBe('3 ч');
    expect(ru.formatAge(NOW - 12 * 86_400_000)).toBe('12 д');
    expect(ru.formatAge(NOW - 90_000, NOW + 60_000)).toBe('2 мин');
    expect(ru.formatAge('not a date')).toBe('—');
  });

  it('times: 24 h clock, short dates with the year only when it is not this year', () => {
    const ru = make('ru');
    expect(ru.formatTime('2026-10-03T09:18:00Z')).toBe('09:18');
    expect(ru.formatTime(Date.parse('2026-09-04T21:05:00Z'), 'time')).toBe('21:05');
    expect(ru.formatTime('2026-09-04T09:18:00Z', 'date')).toBe('4 сен');
    expect(ru.formatTime('2026-09-30T09:18:00Z', 'day')).toBe('30 сен');
    expect(ru.formatTime('2026-05-09T09:18:00Z', 'date')).toBe('9 мая');
    expect(ru.formatTime('2024-03-14T09:18:00Z', 'date')).toBe('14 мар 2024');
    expect(ru.formatTime('2026-09-04T09:18:00Z', 'datetime')).toBe('4 сен, 09:18');
    expect(make('en').formatTime('2026-10-03T09:18:00Z', 'datetime')).toBe('3 Oct, 09:18');
    expect(ru.formatTime('garbage')).toBe('—');
  });

  it('honours the time zone it was given', () => {
    const moscow = createI18n({ language: 'ru', now: () => NOW, timeZone: 'Europe/Moscow' });
    expect(moscow.formatTime('2026-10-03T00:00:00Z')).toBe('03:00');
  });

  it('prints a time in a named zone whatever its own zone is: the quota resets «в 03:00 по Москве» (ui-design §4.1)', () => {
    const reset = '2026-10-04T00:00:00Z';
    for (const timeZone of ['UTC', 'Asia/Novosibirsk', 'America/New_York']) {
      const port = createI18n({ language: 'ru', now: () => NOW, timeZone });
      expect(port.formatTimeIn?.(reset, 'Europe/Moscow'), timeZone).toBe('03:00');
    }
    const ru = make('ru');
    expect(ru.formatTime(reset)).toBe('00:00');
    // The day is the zone's own: 21:30 UTC is already the next day in Moscow.
    expect(ru.formatTimeIn?.('2026-10-03T21:30:00Z', 'Europe/Moscow', 'datetime')).toBe('4 окт, 00:30');
    expect(ru.formatTimeIn?.(Date.parse(reset), 'Europe/Moscow', 'time')).toBe('03:00');
    expect(ru.formatTimeIn?.('garbage', 'Europe/Moscow')).toBe('—');
    // A zone the runtime does not know is unknown, never the port's own zone under a false name.
    expect(ru.formatTimeIn?.(reset, 'Mars/Olympus')).toBe('—');
    expect(ru.formatTimeIn?.(reset, 'Mars/Olympus')).toBe('—');
  });

  it('durations: m:ss timers, h:mm:ss countdowns, seconds; fractions round up, negatives are zero', () => {
    const ru = make('ru');
    expect(ru.formatDuration(3_000, 'm:ss')).toBe('0:03');
    expect(ru.formatDuration(84_000, 'm:ss')).toBe('1:24');
    expect(ru.formatDuration(3_725_000, 'm:ss')).toBe('62:05');
    expect(ru.formatDuration(63_599_400, 'h:mm:ss')).toBe('17:40:00');
    expect(ru.formatDuration(23_100, 'seconds')).toBe('24 с');
    expect(make('en').formatDuration(23_100, 'seconds')).toBe('24 s');
    expect(ru.formatDuration(-5, 'm:ss')).toBe('0:00');
    expect(ru.formatDuration(Number.POSITIVE_INFINITY, 'm:ss')).toBe('0:00');
  });
});
