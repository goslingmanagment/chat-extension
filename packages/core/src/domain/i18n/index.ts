// core/domain/i18n — the ru (default) and en catalogs and the translator
// (architecture.md §9.7). `ui.locale` is `system` / `ru` / `en` and switches
// on the fly; ChatSpace's language never decides ours. Plural forms come from
// Intl.PluralRules on the `n` parameter.

import type { I18nCatalog, I18nPlainParams, I18nTextKey } from '@cg/contracts/i18n/catalog';
import { DEFAULT_LOCALE, LOCALES, type Locale, type UiPluralKey } from '@cg/contracts/i18n/keys';
import type { UiLocale } from '@cg/contracts/settings';

import { EN } from './en';
import { RU } from './ru';

export { EN } from './en';
export { RU } from './ru';

export const CATALOGS: { readonly [L in Locale]: I18nCatalog<L> } = { ru: RU, en: EN };

/** `ui.locale` resolved against the browser's language tags (`navigator.languages`). */
export function resolveLocale(setting: UiLocale, systemTags: readonly string[]): Locale {
  if (setting !== 'system') return setting;
  for (const tag of systemTags) {
    const language = tag.toLowerCase().split(/[-_]/)[0];
    const match = LOCALES.find((locale) => locale === language);
    if (match !== undefined) return match;
  }
  return DEFAULT_LOCALE;
}

/** Replaces `{name}` with its parameter; an unknown placeholder stays visible rather than vanishing. */
export function interpolate(template: string, params: I18nPlainParams = {}): string {
  return template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (placeholder, name: string) => {
    const value = params[name];
    return value === undefined ? placeholder : String(value);
  });
}

export interface Translator {
  readonly locale: Locale;
  /** A plain message. */
  text(key: I18nTextKey, params?: I18nPlainParams): string;
  /** A plural message: the form is chosen by `n`, which is also its `{n}`. */
  plural(key: UiPluralKey, n: number, params?: I18nPlainParams): string;
}

type PluralForms = Readonly<Partial<Record<Intl.LDMLPluralRule, string>>> & { readonly other: string };

export function createTranslator(locale: Locale): Translator {
  const catalog: I18nCatalog<'ru'> | I18nCatalog<'en'> = CATALOGS[locale];
  const rules = new Intl.PluralRules(locale);
  return {
    locale,
    text(key, params) {
      return interpolate(catalog[key], params);
    },
    plural(key, n, params) {
      const forms: PluralForms = catalog[key];
      return interpolate(forms[rules.select(n)] ?? forms.other, { ...params, n });
    },
  };
}
