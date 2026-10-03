// MAIN world, document_start (architecture.md §2, §5.3). Self-contained:
// the bundle carries only host-chatspace/main and no other package.

import { installMainBridge } from '@cg/host-chatspace/main';
import type { ContentScriptDefinition } from 'wxt';
import { defineContentScript } from 'wxt/utils/define-content-script';

import { CHATSPACE_MATCHES } from '../hosts';

const definition: ContentScriptDefinition = defineContentScript({
  matches: [...CHATSPACE_MATCHES],
  world: 'MAIN',
  runAt: 'document_start',
  allFrames: false,
  main() {
    installMainBridge();
  },
});

export default definition;
