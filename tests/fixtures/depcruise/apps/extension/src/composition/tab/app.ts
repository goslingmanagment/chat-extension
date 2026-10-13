// The shared tab composition importing sites' own code: Fansly's slice of the feature manifest, Fansly's adapter and
// ChatSpace's adapter. It works with the common HostPort and the adapter its site's entry point hands it.
import { FANSLY_FEATURES } from '../../../../../packages/contracts/src/features/fansly.ts';
import { I } from '../../../../../packages/host-chatspace/src/isolated/index.ts';
import { FANSLY_ISOLATED } from '../../../../../packages/host-fansly/src/isolated/index.ts';
export const APP = [FANSLY_FEATURES, I, FANSLY_ISOLATED];
