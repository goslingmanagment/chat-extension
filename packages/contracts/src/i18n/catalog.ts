// The shape every locale catalog must have (architecture.md §9.7): exactly
// the keys of i18n/keys.ts plus a title and a body for every CG code. The
// catalogs themselves live in core/domain/i18n.

import { CG_CODES, type I18nKey } from '../errors';
import { cgBodyKey, cgTitleKey, UI_PLURAL_KEYS, UI_TEXT_KEYS, type Locale, type PluralMessage, type UiPluralKey } from './keys';

/** Keys whose message is one string. */
export type I18nTextKey = Exclude<I18nKey, UiPluralKey>;

export type I18nMessage<L extends Locale> = string | PluralMessage<L>;

export type I18nCatalog<L extends Locale> = { readonly [K in I18nTextKey]: string } & { readonly [K in UiPluralKey]: PluralMessage<L> };

/**
 * Parameters as the catalog substitutes them into `{name}`: already text or a
 * number (a plural message takes its count as `n`). View models carry typed
 * `I18nParams` (vm/i18n.ts); the UI's I18n port formats money, ages and times
 * into these before it calls the translator.
 */
export type I18nPlainParams = Readonly<Record<string, string | number>>;

/** Every key of the catalog, the CG ones in Appendix A order. */
export const I18N_KEYS: readonly I18nKey[] = [
  ...UI_TEXT_KEYS,
  ...UI_PLURAL_KEYS,
  ...CG_CODES.flatMap((code) => [cgTitleKey(code), cgBodyKey(code)]),
];

const PLURAL_KEYS: ReadonlySet<string> = new Set(UI_PLURAL_KEYS);

export function isPluralKey(key: I18nKey): key is UiPluralKey {
  return PLURAL_KEYS.has(key);
}

/** `{name}` placeholders of a message text, in order of appearance. */
export function messageParams(text: string): string[] {
  return [...text.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)].map((match) => match[1] ?? '');
}
