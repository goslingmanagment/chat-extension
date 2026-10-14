// Fansly's phrases (R20 F9b; docs/project-unite/architecture.md §1.5, §3.4):
// what the shared texts say instead of a site's name (`{site}`, `{onSite}`,
// `{siteAccount}`, `{sitePlatform}`) on Fansly — «на Fansly», not «в Fansly».
// A part of Fansly's text pack: the extension pages read it today (a hub page
// on Fansly is named «Fansly»), Fansly's profile for our interface with it
// (P8d). A ChatSpace bundle never carries it.

import type { Locale } from '@cg/contracts/i18n/keys';
import type { HostPhrases } from '@cg/contracts/vm';

export const FANSLY_PHRASES: { readonly [L in Locale]: HostPhrases } = {
  ru: { site: 'Fansly', onSite: 'на Fansly', siteAccount: 'Fansly', sitePlatform: 'Fansly' },
  en: { site: 'Fansly', onSite: 'on Fansly', siteAccount: 'Fansly', sitePlatform: 'Fansly' },
};
