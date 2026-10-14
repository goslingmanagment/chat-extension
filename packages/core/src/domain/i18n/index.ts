// core/domain/i18n — the ru (default) and en catalogs, the plain translator
// and the UI's I18n port with the money, age, time and duration formatters
// (architecture.md §9.7, §10.2 п. 3).

export { EN } from './en';
export { RU } from './ru';
export { CATALOGS, createTranslator, interpolate, resolveLocale, withPhrases, type SitePhrases, type Translator } from './catalogs';
export { createI18n, formatMoneyMills, MINUS_SIGN, UNKNOWN_VALUE, type I18nOptions, type LiveI18n } from './port';
export { createLiveI18n, translatorOf, type CatalogSource } from './live';
