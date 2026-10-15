// Fansly's slice of the feature manifest (docs/project-unite/architecture.md
// §1.4): the common part of each feature with what it needs on Fansly, and the
// features only Fansly has. The application's half of Fansly's adapter (its
// `tab-app` chunk, R20 P7d) and the extension pages (composition/pages.ts,
// R20 P7i) take it from here. The background's core never has this file in
// its graph: Fansly's background module cuts the same slice and brings it
// (bg/fansly.ts, `BackgroundHostHandle.features`).
//
// The slice is cut by the module graph: this module imports the common file
// and Fansly's own, never ChatSpace's — and no ChatSpace bundle imports it.

import { FANSLY_FEATURES } from '@cg/contracts/features/fansly';
import { FEATURES_COMMON } from '@cg/contracts/features/common';
import { featureSlice } from '@cg/core/domain/features';

export const FANSLY_FEATURE_SLICE = /* @__PURE__ */ featureSlice(FEATURES_COMMON, FANSLY_FEATURES);
