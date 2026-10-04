// The I18n port of the UI over the built-in ru and en catalogs
// (architecture.md §9.7, §10.2 п. 3): the port itself is `./live` (catalog
// free, for content scripts that load one language as a lazy chunk); this
// entry binds it to both catalogs for extension pages and tests.

import { CATALOGS } from './catalogs';
import { createLiveI18n, type I18nOptions, type LiveI18n } from './live';

export { MINUS_SIGN, UNKNOWN_VALUE, formatMoneyMills, type I18nOptions, type LiveI18n } from './live';

export function createI18n(options: I18nOptions): LiveI18n {
  return createLiveI18n((language) => CATALOGS[language], options);
}
