// Isolated world, document_start (architecture.md §2): early hotkey dispatcher,
// bridge client, HostPort, dock mounting. Wiring lives in composition/tab.ts.

import type { ContentScriptDefinition } from 'wxt';
import { defineContentScript } from 'wxt/utils/define-content-script';

import { composeTab } from '../composition/tab';
import { CHATSPACE_MATCHES } from '../hosts';

const definition: ContentScriptDefinition = defineContentScript({
  matches: [...CHATSPACE_MATCHES],
  runAt: 'document_start',
  allFrames: false,
  main(ctx) {
    composeTab({ ctx, win: window });
  },
});

export default definition;
