import { type Locale } from '@cg/contracts/i18n/keys';
import { describe, expect, it } from 'vitest';

import { EN } from './en';
import { createLiveI18n, resolveLocale, translatorOf } from './live';
import { createI18n } from './port';
import { RU } from './ru';

describe('createLiveI18n — the I18n port over a catalog source', () => {
  it('[I18-001] renders from whatever catalog the source has for the language, and switches on the fly', () => {
    const loaded: Partial<Record<Locale, Readonly<Record<string, unknown>>>> = { ru: RU };
    const i18n = createLiveI18n((language) => loaded[language] ?? null, { language: 'ru' });
    expect(i18n.t('common.copy')).toBe(RU['common.copy']);
    expect(i18n.plural('common.days', 5)).toBe('5 дней');
    const heard: Locale[] = [];
    i18n.subscribe((language) => heard.push(language));
    // The en catalog arrives later (its own lazy chunk), then the language moves.
    loaded.en = EN;
    i18n.setLanguage('en');
    expect(heard).toEqual(['en']);
    expect(i18n.t('common.copy')).toBe(EN['common.copy']);
  });

  it('[I18-004] a language whose catalog is not loaded renders keys as themselves and reports each once', () => {
    const missing: string[] = [];
    const i18n = createLiveI18n(() => null, { language: 'en', onMissing: (key, language) => missing.push(`${language}:${key}`) });
    expect(i18n.t('common.copy')).toBe('common.copy');
    expect(i18n.t('common.copy')).toBe('common.copy');
    expect(missing).toEqual(['en:common.copy']);
  });

  it('is the same port as createI18n over both built-in catalogs', () => {
    const live = createLiveI18n((language) => (language === 'ru' ? RU : EN), { language: 'ru', now: () => 0, timeZone: 'UTC' });
    const both = createI18n({ language: 'ru', now: () => 0, timeZone: 'UTC' });
    expect(live.t('dock.reason.notSignedIn')).toBe(both.t('dock.reason.notSignedIn'));
    expect(live.formatMoneyMills(12_480_000)).toBe(both.formatMoneyMills(12_480_000));
    expect(live.formatAge(0, 7 * 60_000)).toBe(both.formatAge(0, 7 * 60_000));
  });

  it('translatorOf follows the port’s language (the error renderer reads through it)', () => {
    const i18n = createI18n({ language: 'ru' });
    const t = translatorOf(i18n);
    expect([t.locale, t.text('common.copy')]).toEqual(['ru', RU['common.copy']]);
    i18n.setLanguage('en');
    expect([t.locale, t.text('common.copy'), t.plural('common.days', 1)]).toEqual(['en', EN['common.copy'], '1 day']);
  });

  it('resolveLocale needs no catalog: system tags pick ru or en, anything else is ru', () => {
    expect(resolveLocale('system', ['en-US', 'ru'])).toBe('en');
    expect(resolveLocale('system', ['de-DE'])).toBe('ru');
    expect(resolveLocale('en', ['ru-RU'])).toBe('en');
  });
});
