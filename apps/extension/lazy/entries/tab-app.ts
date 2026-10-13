// The tab's application (architecture.md §10.2, §11: ≤ 30 KiB on top of the
// dock): the AppClient router, the controllers, the tab's logger and the I18n
// port without a catalog. Loaded with the first composer, never outside a chat.
// It is ChatSpace's chunk: the shared application with the application's half
// of the ChatSpace adapter (docs/project-unite/architecture.md §1.3).

import type { ChatSpaceHostPort } from '@cg/host-chatspace/isolated';

import { startTabApp as startApp, type TabApp, type TabAppEnv } from '../../src/composition/tab/app';
import { CHATSPACE_APP } from '../../src/composition/tab/hosts/chatspace/app';

export type { TabApp, TabAppEnv };

/** The ChatSpace early bundle's runtime calls it with ChatSpace's own host port. */
export const startTabApp = (env: TabAppEnv<ChatSpaceHostPort>): Promise<TabApp> => startApp(env, CHATSPACE_APP);
