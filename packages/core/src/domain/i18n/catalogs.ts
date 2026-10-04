// The ru (default) and en catalogs and the plain translator
// (architecture.md §9.7). `ui.locale` is `system` / `ru` / `en` and switches
// on the fly; ChatSpace's language never decides ours. Plural forms come from
// Intl.PluralRules on the `n` parameter.

import type { I18nCatalog } from '@cg/contracts/i18n/catalog';
import type { Locale } from '@cg/contracts/i18n/keys';

import { EN } from './en';
import { interpolate, resolveLocale, type Translator } from './live';
import { RU } from './ru';

export { interpolate, resolveLocale, type Translator };

export const CATALOGS: { readonly [L in Locale]: I18nCatalog<L> } = { ru: RU, en: EN };

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
