// Fansly's isolated world, document_start (docs/project-unite/architecture.md
// §2, §7.1): the early bootstrap of a Fansly tab, `fansly.js` (≤ 30 KiB gzip,
// ≤ 3 ms). Wiring lives in composition/tab.ts; this entry assembles the Fansly
// adapter for it (§1.3) from the starter of @cg/host-fansly.
//
// NOT in the manifest: the background registers it right after `fansly-main`
// in one call (§4; P9a), on the stand the e2e does. It starts without WXT's
// wrapper (build/isolated-entry.ts): `main` is called bare.

import type { FanslyHostPort } from '@cg/contracts/fansly-host';
import { createKeyPendingMark, createKeyboardProbe, routeOfLocation, startFanslyTab, type Validation } from '@cg/host-fansly/isolated';
import type { UnlistedScriptDefinition } from 'wxt';
import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';

import { composeTab, type HostAdapter } from '../composition/tab';
import { FANSLY_LAZY_ROOT } from '../hosts/runtime/fansly';

/** The early half of the Fansly adapter; its application's half comes with Fansly's `tab-app` (P7c). */
export const FANSLY_ADAPTER: HostAdapter<FanslyHostPort> = {
  kind: 'fansly-web',
  start: (env) =>
    startFanslyTab({
      win: env.win,
      // The bridge's schemas are a lazy chunk of Fansly's own build (§3.1): this file is one classic script.
      validation: () => env.lazy<Validation>('bridge-validation'),
      onDiagnostic: env.onDiagnostic,
    }),
  keyProbe: createKeyboardProbe,
  keyPending: createKeyPendingMark,
  routeOfLocation,
  // The vendored scheme's rows of the Fansly extension, Notes (⌘⇧K) among them (§1.5).
  hotkeyClient: 'fansly',
  // Fansly's own lazy build (lazy/fansly/, §3.2).
  lazy: { root: FANSLY_LAZY_ROOT },
};

const definition: UnlistedScriptDefinition = defineUnlistedScript(() => {
  composeTab({ win: window }, FANSLY_ADAPTER);
});

export default definition;
