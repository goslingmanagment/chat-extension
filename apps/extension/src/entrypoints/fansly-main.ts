// Fansly's MAIN world, document_start (docs/project-unite/architecture.md §5,
// §3.1): one self-contained bundle, `fansly-main.js`, that carries only
// host-fansly/main — the shared boot of host-kit and Fansly's traps and
// observation. ≤ 16 KiB gzip, ≤ 1 ms at document_start.
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
//
// Which socket and which API are the page's comes from Fansly's runtime row; a
// TEST build also watches the stand's loopback ones, and only it carries them.

import { installFanslyMain } from '@cg/host-fansly/main';
import type { UnlistedScriptDefinition } from 'wxt';
import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';

import { FANSLY_NETWORK, FANSLY_STAND_NETWORK } from '../hosts/runtime/fansly';

const definition: UnlistedScriptDefinition = defineUnlistedScript(() => {
  try {
    installFanslyMain(
      window,
      __CG_TEST_HOSTS__
        ? { socketHosts: [...FANSLY_NETWORK.socketHosts, ...FANSLY_STAND_NETWORK.socketHosts], apiOrigins: [...FANSLY_NETWORK.apiOrigins, ...FANSLY_STAND_NETWORK.apiOrigins] }
        : FANSLY_NETWORK,
    );
  } catch {
    // No bridge in this document: the tab says «not ready» (CG-HOST-NOT-READY).
  }
});

export default definition;
