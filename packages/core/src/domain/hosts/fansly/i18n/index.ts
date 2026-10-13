// The Fansly build's catalogs of the Fansly CG codes (1.15.0, R20 P4a3; R20
// architecture §3.4): the Fansly tab, the extension pages and `bg/fansly`
// merge them with the shared catalog; a ChatSpace bundle never imports them.

import type { CgFanslyCatalog } from '@cg/contracts/errors-fansly';
import type { Locale } from '@cg/contracts/i18n/keys';

import { FANSLY_CG_EN } from './en';
import { FANSLY_CG_RU } from './ru';

export { FANSLY_CG_EN, FANSLY_CG_RU };

export const FANSLY_CG_CATALOGS: { readonly [L in Locale]: CgFanslyCatalog } = { ru: FANSLY_CG_RU, en: FANSLY_CG_EN };
