// WebSocket tap (architecture.md §6.8). NOT in manifest content_scripts: the
// background registers it with scripting.registerContentScripts({world: 'MAIN',
// runAt: 'document_start', persistAcrossSessions: true}) only while the
// `wsTap` flag is on. Self-contained like the MAIN bridge, and like it
// started without WXT's wrapper (build/main-world-entry.ts): the install keeps
// its own failure, nothing of ours throws into the page (decision X22).

import { installWsTap } from '@cg/host-chatspace/main';
import type { UnlistedScriptDefinition } from 'wxt';
import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';

const definition: UnlistedScriptDefinition = defineUnlistedScript(() => {
  try {
    installWsTap();
  } catch {
    // No tap in this document: the bridge reads it as «no tap script» (X8 and freshness stay off).
  }
});

export default definition;
