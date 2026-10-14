// Fansly's text pack (R20 architecture §3.4): the catalogs of the Fansly CG
// codes (1.15.0, R20 P4a3) — the Fansly tab, the extension pages and
// `bg/fansly` merge them with the shared catalog — and the phrases the shared
// texts take on Fansly (R20 F9b, ./phrases.ts). A ChatSpace bundle never
// imports it.

import type { CgFanslyCatalog } from '@cg/contracts/errors-fansly';
import type { Locale } from '@cg/contracts/i18n/keys';

import { FANSLY_CG_EN } from './en';
import { FANSLY_CG_RU } from './ru';

export { FANSLY_CG_EN, FANSLY_CG_RU };
export { FANSLY_PHRASES } from './phrases';

export const FANSLY_CG_CATALOGS: { readonly [L in Locale]: CgFanslyCatalog } = { ru: FANSLY_CG_RU, en: FANSLY_CG_EN };
