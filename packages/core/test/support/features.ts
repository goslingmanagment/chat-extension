// The slices of the feature manifest for the tests (R20 §1.4), assembled the way a composition root does:
// the common file with one site's own. ChatSpace's is what every harness of this package runs on.

import type { FeatureSlice } from '@cg/contracts/features/types';
import { FEATURES_COMMON } from '@cg/contracts/features/common';
import { CHATSPACE_FEATURES } from '@cg/contracts/features/chatspace';
import { FANSLY_FEATURES } from '@cg/contracts/features/fansly';
import { type HostKind } from '@cg/contracts/hosts';
import { type Bootstrap } from '@cg/contracts/hub';

import { featureSlice, freshTextAdmitted } from '../../src/domain/features';

export const CHATSPACE = featureSlice(FEATURES_COMMON, CHATSPACE_FEATURES);
export const FANSLY = featureSlice(FEATURES_COMMON, FANSLY_FEATURES);

/** `OpsEnvironment.features` of a background that serves ChatSpace alone, as the extension does until Fansly is wired. */
export const featuresOf = (host: HostKind): FeatureSlice | null => (host === 'chatspace' ? CHATSPACE : null);

/** A background that serves both sites (R20 F6a's tests follow a Fansly chat through shared code before Fansly is wired). */
export const featuresOfBoth = (host: HostKind): FeatureSlice => (host === 'chatspace' ? CHATSPACE : FANSLY);

/** `StreamRequestContext.freshText` as the scheduler sets it: ChatSpace's `fresh-text` on the page. */
export const freshTextOn = (bootstrap: Bootstrap, pageId: number): boolean => freshTextAdmitted(CHATSPACE, bootstrap, pageId);
