// Fansly's MAIN world, document_start (docs/project-unite/architecture.md §5,
// §3.1): one self-contained bundle, `fansly-main.js`, that carries only
// host-fansly/main — the shared boot of host-kit and, from P7a on, Fansly's
// traps and observation. ≤ 16 KiB gzip, ≤ 1 ms at document_start.
//
// NOT in the manifest: the background registers it together with `fansly.js`,
// MAIN first, in one call (`[fansly-main, fansly]`, §4), once Fansly is
// switched on and its origins are granted (P9a). On the stand the e2e makes
// that call itself.
//
// The page's own world: nothing of ours may throw into it (decision X22). The
// bundle starts without WXT's wrapper (build/main-world-entry.ts), and the
// install keeps its own failure: without the boot there is no channel to
// report it on.

import { installFanslyMain } from '@cg/host-fansly/main';
import type { UnlistedScriptDefinition } from 'wxt';
import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';

const definition: UnlistedScriptDefinition = defineUnlistedScript(() => {
  try {
    installFanslyMain(window);
  } catch {
    // No bridge in this document: the tab says «not ready» (CG-HOST-NOT-READY).
  }
});

export default definition;
