// Fansly's own wording of shared texts (R20 P8d; docs/project-unite/architecture.md §3.4, §7.17): where a shared
// text says what does not happen on Fansly. The Fansly tab's catalog lays them over the shared one
// (apps/extension/lazy/fansly/i18n-*.ts); ChatSpace's catalog keeps its own words, and no ChatSpace bundle carries
// these.
//
// Copy only (FS-DOCK-3): on ChatSpace the fan is blocked; on Fansly the fan does not accept messages from this
// creator — their DM rules (`no-dm-allowed`, `dmPermissionFlags`) — so the dock's reason and the banner's title say
// that. The banner's body («Можно только копировать.») is right on both.

import type { I18nTextKey } from '@cg/contracts/i18n/catalog';
import type { Locale } from '@cg/contracts/i18n/keys';

/** The shared texts Fansly words its own way. */
export type FanslyTextKey = Extract<I18nTextKey, 'dock.reason.fanBlocked' | 'cg.gateFanBlocked.title'>;

export const FANSLY_TEXTS: { readonly [L in Locale]: Readonly<Record<FanslyTextKey, string>> } = {
  ru: {
    'dock.reason.fanBlocked': 'фан не принимает сообщения — можно только копировать',
    'cg.gateFanBlocked.title': 'Фан не принимает сообщения',
  },
  en: {
    'dock.reason.fanBlocked': 'the fan doesn’t accept messages — copy only',
    'cg.gateFanBlocked.title': 'The fan doesn’t accept messages',
  },
};
