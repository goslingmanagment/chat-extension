// The tab's application on a Fansly page (docs/project-unite/architecture.md
// §1.3, §3.1; R20 P7d): the shared application with the application's half of
// the Fansly adapter, in Fansly's own lazy build. Loaded with the first place
// of the dock (the open chat's anchors) or the first key of ours, never
// before; a ChatSpace page never loads it (its build is ChatSpace's own).

import type { FanslyPort } from '@cg/host-fansly/isolated';

import { startTabApp as startApp, type TabApp, type TabAppEnv } from '../../src/composition/tab/app';
import { FANSLY_APP } from '../../src/composition/tab/hosts/fansly/app';

export type { TabApp, TabAppEnv };

/** The Fansly early bundle's runtime calls it with Fansly's own host port. */
export const startTabApp = (env: TabAppEnv<FanslyPort>): Promise<TabApp> => startApp(env, FANSLY_APP);
