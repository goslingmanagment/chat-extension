// Isolated world, document_start (architecture.md §2): early hotkey dispatcher,
// bridge client, HostPort, dock mounting. Wiring lives in composition/tab.ts;
// this entry assembles the ChatSpace adapter for it (docs/project-unite/
// architecture.md §1.3) from the starter of @cg/host-chatspace.
//
// The bundle starts without WXT's wrapper and its ContentScriptContext
// (build/isolated-entry.ts): `main` is called bare and gets no context.

import type { ContentScriptDefinition } from 'wxt';
import { defineContentScript } from 'wxt/utils/define-content-script';

import { createKeyPendingMark, createKeyboardProbe, routeOfLocation, startChatSpaceTab, type ChatSpaceHostPort, type Validation } from '@cg/host-chatspace/isolated';

import { composeTab, type HostAdapter } from '../composition/tab';
import { CHATSPACE_MATCHES } from '../hosts/runtime/chatspace';

/** The early half of the ChatSpace adapter; the application's half is in ChatSpace's `tab-app` chunk. */
export const CHATSPACE_ADAPTER: HostAdapter<ChatSpaceHostPort> = {
  kind: 'chatspace',
  start: (env) =>
    startChatSpaceTab({
      ...env,
      // The bridge's schemas are a lazy chunk (§11): this file is one classic script and would carry them whole.
      validation: () => env.lazy<Validation>('bridge-validation'),
      // ChatSpace's own draft key, read only (§6.1): the isolated world shares the page's localStorage.
      drafts: { getItem: (key) => env.win.localStorage.getItem(key) },
    }),
  keyProbe: createKeyboardProbe,
  keyPending: createKeyPendingMark,
  routeOfLocation,
  // ChatSpace's lazy build.
  lazy: { root: 'lazy' },
};

const definition: ContentScriptDefinition = defineContentScript({
  matches: [...CHATSPACE_MATCHES],
  runAt: 'document_start',
  allFrames: false,
  main() {
    composeTab({ win: window }, CHATSPACE_ADAPTER);
  },
});

export default definition;
