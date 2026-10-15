// The en texts of a Fansly tab (docs/project-unite/architecture.md §3.1, §3.4;
// R20 P7d): the shared catalog with the texts of Fansly's own codes and
// Fansly's wording of the few shared texts it says its own way (R20 P8d: copy
// only — the fan does not accept messages) and the words of the marks only
// its verdict gives (R20 P8b2), one chunk of Fansly's build. A ChatSpace tab
// never loads it; its catalog stays its own.

import { EN } from '@cg/core/domain/i18n/en';
import { FANSLY_CG_EN, FANSLY_MARK_TEXTS, FANSLY_TEXTS } from '@cg/core/domain/hosts/fansly/i18n';

export const CATALOG: Readonly<Record<string, unknown>> = { ...EN, ...FANSLY_CG_EN, ...FANSLY_TEXTS.en, ...FANSLY_MARK_TEXTS.en };
