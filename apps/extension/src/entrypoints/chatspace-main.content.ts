// MAIN world, document_start (architecture.md §2, §5.3). Self-contained:
// the bundle carries only host-chatspace/main and no other package.
//
// ONE bundle: the boot and the runtime that reads and writes ChatSpace
// (decision X11, docs/decisions.md). A second MAIN script would have to pick
// the runtime hook up from `window`, where the page could take it first. The
// runtime does nothing before DOMContentLoaded, so the work at document_start
// stays the boot's (≤ 1 ms, §11; the e2e measures the whole bundle).
//
// The page's own world: nothing of ours may throw into it (decision X22). The
// bundle starts without WXT's wrapper (build/main-world-entry.ts), and the
// install keeps its own failure: without the boot there is no channel to
// report it on.

import { createMainRuntime, installMainBridge } from '@cg/host-chatspace/main';
import type { ContentScriptDefinition } from 'wxt';
import { defineContentScript } from 'wxt/utils/define-content-script';

import { CHATSPACE_MATCHES } from '../hosts/runtime/chatspace';

const definition: ContentScriptDefinition = defineContentScript({
  matches: [...CHATSPACE_MATCHES],
  world: 'MAIN',
  runAt: 'document_start',
  allFrames: false,
  main() {
    try {
      installMainBridge(window, { runtime: createMainRuntime });
    } catch {
      // No bridge in this document: the tab says «not ready» (CG-HOST-NOT-READY).
    }
  },
});

export default definition;
