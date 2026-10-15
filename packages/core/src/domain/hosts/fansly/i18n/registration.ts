import type { RegistrationI18n } from '@cg/contracts/registration-fansly';

export const REGISTRATION_TEXTS = {
  ru: { label: 'Регистрация', hint: 'Показать дату регистрации фана', failed: 'Дата недоступна', loading: 'Регистрация…' },
  en: { label: 'Registered', hint: 'Show when this fan registered', failed: 'Date unavailable', loading: 'Loading…' },
} as const;

/** Whole calendar units, as the old header showed them; no 30-day months. */
export function registrationAge(ms: number, now: number, locale: string): string {
  const then = new Date(ms), today = new Date(now);
  const days = Math.max(0, Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() - new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime()) / 86_400_000));
  const months = (today.getFullYear() - then.getFullYear()) * 12 + today.getMonth() - then.getMonth() - (today.getDate() < then.getDate() ? 1 : 0);
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: days <= 1 ? 'auto' : 'always' });
  return months < 1 ? relative.format(-days, 'day') : months < 12 ? relative.format(-months, 'month') : relative.format(-Math.floor(months / 12), 'year');
}

export const REGISTRATION_I18N: RegistrationI18n = {
  date: (at, locale) => new Date(at).toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' }),
  time: (at, locale) => new Date(at).toLocaleString(locale),
  age: registrationAge,
};
