// Fansly's text pack (R20 architecture §3.4): the catalogs of the Fansly CG
// codes (1.15.0, R20 P4a3) — the Fansly tab, the extension pages and
// `bg/fansly` merge them with the shared catalog —, the phrases the shared
// texts take on Fansly (R20 F9b, ./phrases.ts) and Fansly's own wording of a
// few shared texts, which its tab's catalog lays over the shared one (R20 P8d,
// ./texts.ts), the words of the window check's marks over a result, which only
// its verdict gives (R20 P8b2, ./marks.ts), and the texts of Fansly's own
// surfaces — the vault panel's `fansly.vault.*` (R20 P13b, ./vault.ts), which
// come with the surface's own chunk, and «Заметки» (R20 P11b, ./notes.ts). A ChatSpace bundle never imports it.

import type { CgFanslyCatalog } from '@cg/contracts/errors-fansly';
import type { Locale } from '@cg/contracts/i18n/keys';

import { FANSLY_CG_EN } from './en';
import { FANSLY_CG_RU } from './ru';

export { FANSLY_CG_EN, FANSLY_CG_RU };
export { FANSLY_MARK_TEXTS } from './marks';
export { FANSLY_PHRASES } from './phrases';
export { FANSLY_TEXTS, type FanslyTextKey } from './texts';
export { FANSLY_VAULT_TEXTS, type FanslyVaultCatalog } from './vault';

export const FANSLY_CG_CATALOGS: { readonly [L in Locale]: CgFanslyCatalog } = { ru: FANSLY_CG_RU, en: FANSLY_CG_EN };

export { REGISTRATION_TEXTS, REGISTRATION_I18N } from './registration';
export { NOTES_TEXTS } from './notes';
