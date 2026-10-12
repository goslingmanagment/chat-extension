// The language of an install made while «Как в системе» was the default
// (ST-135; X29 made Russian the default without a migration). Every build up
// to 0.2.0 wrote «Как в системе» to storage at its first run, whoever chose
// it, and 0.2.1 and 0.2.2 kept it for those installs: an English browser then
// showed English. The first update from a build up to 0.2.2 sets Russian once,
// through the settings owner's ordinary patch; a later update (from a build
// after 0.2.2), a fresh install, an explicit Russian or English, and a version
// that is not one leave the language alone. No new schema version: a rollback
// reads the value as it is.
//
// Pure: the caller says which version was replaced and what is stored.

import { type SettingsPatch, type UiLocale } from '@cg/contracts/settings';

import { compareVersions } from '../ops/flags';

/** The last build whose installs may hold «Как в системе» they never chose (0.2.1 and 0.2.2 kept it for earlier installs). */
export const SYSTEM_LOCALE_LAST_VERSION = '0.2.2';

/** What the rewrite writes. */
export const SYSTEM_LOCALE_REWRITE = { ui: { locale: 'ru' } } as const satisfies SettingsPatch;

/**
 * Whether the update from `previousVersion` rewrites the stored `locale` to
 * Russian: only «Как в системе», only from a dotted numeric version at or
 * below 0.2.2.
 */
export function rewritesSystemLocale(previousVersion: string | null | undefined, locale: UiLocale): boolean {
  if (locale !== 'system' || typeof previousVersion !== 'string') return false;
  const order = compareVersions(previousVersion, SYSTEM_LOCALE_LAST_VERSION);
  return order !== null && order <= 0;
}
