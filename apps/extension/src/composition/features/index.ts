// The feature manifest of every site, for the roots that serve them all — the
// background's core and the extension pages (docs/project-unite/
// architecture.md §1.4). A site's own tab takes only its own slice
// (./<site>.ts): this table never reaches a tab's bundle.
//
// `satisfies PerHost<…>`: a new row of the hosts' runtime table fails the
// typecheck until its slice stands here.

import type { FeatureSlice } from '@cg/contracts/features/types';
import type { HostKind } from '@cg/contracts/hosts';

import type { PerHost } from '../../hosts/runtime';
import { CHATSPACE_FEATURE_SLICE } from './chatspace';

export const HOST_FEATURES = { chatspace: CHATSPACE_FEATURE_SLICE } as const satisfies PerHost<FeatureSlice>;

/** A site's slice; null — the extension has no such site (its features do not exist here). */
export function featuresOf(host: HostKind): FeatureSlice | null {
  return (HOST_FEATURES as { readonly [K in HostKind]?: FeatureSlice })[host] ?? null;
}
