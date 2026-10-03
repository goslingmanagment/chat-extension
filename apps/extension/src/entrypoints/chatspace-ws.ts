// WebSocket tap (architecture.md §6.8). NOT in manifest content_scripts: the
// background registers it with scripting.registerContentScripts({world: 'MAIN',
// runAt: 'document_start', persistAcrossSessions: true}) only while the
// `wsTap` flag is on. Self-contained like the MAIN bridge.

import { installWsTap } from '@cg/host-chatspace/main';
import type { UnlistedScriptDefinition } from 'wxt';
import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';

const definition: UnlistedScriptDefinition = defineUnlistedScript(() => {
  installWsTap();
});

export default definition;
