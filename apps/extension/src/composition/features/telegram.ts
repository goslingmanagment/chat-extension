// Telegram's slice of the feature manifest (docs/specs/2026-10-27-telegram-site.md §6.6): the common part of Reply and
// Fix with what each needs on Telegram. The application's half of Telegram's adapter (its `tab-app` chunk) and the
// extension pages take it from here; the background's core never has this file in its graph — Telegram's background
// module cuts the same slice and brings it (bg/telegram.ts).

import { FEATURES_COMMON } from '@cg/contracts/features/common';
import { TELEGRAM_FEATURES } from '@cg/contracts/features/telegram';
import { featureSlice } from '@cg/core/domain/features';

export const TELEGRAM_FEATURE_SLICE = /* @__PURE__ */ featureSlice(FEATURES_COMMON, TELEGRAM_FEATURES);
