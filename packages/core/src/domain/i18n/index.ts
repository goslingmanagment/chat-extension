// core/domain/i18n — the ru (default) and en catalogs and the translator
// (architecture.md §9.7). `ui.locale` is `system` / `ru` / `en` and switches
// on the fly; ChatSpace's language never decides ours. Plural forms come from
// Intl.PluralRules on the `n` parameter.

import type { I18nCatalog, I18nParams, I18nTextKey } from '@cg/contracts/i18n/catalog';
import { DEFAULT_LOCALE, type Locale, type UiPluralKey } from '@cg/contracts/i18n/keys';

import { EN } from './en';
import { RU } from './ru';

export { EN } from './en';
export { RU } from './ru';

export const CATALOGS: { readonly [L in Locale]: I18nCatalog<L> } = { ru: RU, en: EN };

/** `ui.locale` resolved against the browser's language tags (`navigator.languages`). */
export function resolveLocale(setting: 'system' | Locale, systemTags: readonly string[]): Locale {
  if (setting !== 'system') return setting;
  for (const tag of systemTags) {
    const language = tag.toLowerCase().split(/[-_]/)[0];
    if (language === 'ru' || language === 'en') return language;
  }
  return DEFAULT_LOCALE;
}

/** Replaces `{name}` with its parameter; an unknown placeholder stays visible rather than vanishing. */
export function interpolate(template: string, params: I18nParams = {}): string {
  return template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (placeholder, name: string) => {
    const value = params[name];
    return value === undefined ? placeholder : String(value);
  });
}

export interface Translator {
  readonly locale: Locale;
  /** A plain message. */
  text(key: I18nTextKey, params?: I18nParams): string;
  /** A plural message: the form is chosen by `n`, which is also its `{n}`. */
  plural(key: UiPluralKey, n: number, params?: I18nParams): string;
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
