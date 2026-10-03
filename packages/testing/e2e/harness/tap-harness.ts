// The tap script of the R09 e2e harness: what the background would register
// through scripting.registerContentScripts({world: 'MAIN', runAt:
// 'document_start'}) while the `wsTap` flag is on, injected here by a WebDriver
// BiDi preload script into the page's own realm — before any page script, so
// the page's first socket is already constructed through the tap.

import { installWsTap } from '@cg/host-chatspace/main';

installWsTap(window);
