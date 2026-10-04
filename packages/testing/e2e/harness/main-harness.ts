// MAIN half of the R09 e2e harness: the MAIN bridge boot with its runtime in
// one bundle, injected into the page's own realm by a WebDriver BiDi preload
// script — it runs before any page script, like a document_start content
// script. The extension's own entry point is not involved: R09 proves the
// adapter on the stand; the integrator wires it into the extension.

import { createMainRuntime, installMainBridge } from '@cg/host-chatspace/main';

installMainBridge(window, { runtime: createMainRuntime });
