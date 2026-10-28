// The feature manifest of every site, as the background's core holds it
// (docs/project-unite/architecture.md §1.4). A site's own tab takes only its
// own slice (./<site>.ts), and the extension pages, which may carry every
// site, theirs (composition/pages.ts): this table never reaches either.
//
// The core's graph never has a file of Fansly's (`background-core-graph`), so
// Fansly's slice is not here: its background module brings it
// (bg/fansly.ts, `BackgroundHostHandle.features`; R20 P7i), and the core
// reads it from the running module (composition/background.ts). Its row here
// is null: «the site's module has it».
//
// `satisfies PerHost<…>`: a new row of the hosts' runtime table fails the
// typecheck until it says where its slice comes from.

import type { FeatureSlice } from '@cg/contracts/features/types';
import type { HostKind } from '@cg/contracts/hosts';

import type { PerHost } from '../../hosts/runtime';
import { CHATSPACE_FEATURE_SLICE } from './chatspace';

export const HOST_FEATURES = { chatspace: CHATSPACE_FEATURE_SLICE, 'fansly-web': null, 'telegram-web': null } as const satisfies PerHost<FeatureSlice | null>;

/**
 * A site's slice: the core's own, else the one its running background module brought (`fromModule`); null — neither
 * (the module is not up yet or failed, or the extension has no such site): nothing of the site is admitted.
 */
export function featuresOf(host: HostKind, fromModule: (host: HostKind) => FeatureSlice | null | undefined = () => null): FeatureSlice | null {
  return (HOST_FEATURES as { readonly [K in HostKind]?: FeatureSlice | null })[host] ?? fromModule(host) ?? null;
}
