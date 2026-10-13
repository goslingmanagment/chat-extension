// The fictitious entry of a second site's lazy build that carries that site's slice of the feature manifest, as
// Fansly's `tab-app` chunk will (composition/features/<site>.ts): the common file with the site's own. Fixture of
// test/feature-slices.test.ts.

import { FEATURES_COMMON } from '@cg/contracts/features/common';
import { FANSLY_FEATURES } from '@cg/contracts/features/fansly';
import { admission, featureSlice, onPage } from '@cg/core/domain/features';

export const SITE_FEATURES = featureSlice(FEATURES_COMMON, FANSLY_FEATURES);

/** Whether the site has a feature at all: `absent` or not. */
export const siteHas = (id: string): boolean => admission(SITE_FEATURES, id, null, onPage(null, null)).state !== 'absent';
