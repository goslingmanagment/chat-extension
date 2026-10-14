// ChatSpace's text pack (R20 F9b; docs/project-unite/architecture.md §1.5,
// §3.4): the whole phrases that name the site, which the shared texts take
// instead of a name of their own (`{site}`, `{onSite}`, `{siteAccount}`,
// `{sitePlatform}`). The shared catalogs (`core/domain/i18n`) name no site;
// what a ChatSpace tab and the extension pages print is these phrases put in
// — word for word what the texts said when they named ChatSpace themselves.
//
// Who reads it: ChatSpace's profile for our interface (host-chatspace
// isolated/profile.ts — the tab's I18n port takes the profile's phrases) and
// the extension pages, which speak of every site of the build. A Fansly
// bundle never carries it; Fansly's pack is `../../fansly/i18n`.

import type { Locale } from '@cg/contracts/i18n/keys';
import type { HostPhrases } from '@cg/contracts/vm';

export const CHATSPACE_PHRASES: { readonly [L in Locale]: HostPhrases } = {
  ru: { site: 'ChatSpace', onSite: 'в ChatSpace', siteAccount: 'OnlyMonster', sitePlatform: 'OnlyFans' },
  en: { site: 'ChatSpace', onSite: 'in ChatSpace', siteAccount: 'OnlyMonster', sitePlatform: 'OnlyFans' },
};
