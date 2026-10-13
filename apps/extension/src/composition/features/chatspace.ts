// ChatSpace's slice of the feature manifest (docs/project-unite/architecture.md
// §1.4): the common part of each feature with what it needs on ChatSpace, and
// the features only ChatSpace has. Every root that serves ChatSpace takes it
// from here: the application's half of ChatSpace's adapter (its `tab-app`
// chunk), the background's core and the extension pages (./index.ts).
//
// The slice is cut by the module graph: this module imports the common file
// and ChatSpace's own, never another site's — so no ChatSpace bundle carries
// an entry of Fansly (test/feature-slices.test.ts builds it both ways).

import { CHATSPACE_FEATURES } from '@cg/contracts/features/chatspace';
import { FEATURES_COMMON } from '@cg/contracts/features/common';
import { featureSlice } from '@cg/core/domain/features';

export const CHATSPACE_FEATURE_SLICE = /* @__PURE__ */ featureSlice(FEATURES_COMMON, CHATSPACE_FEATURES);
