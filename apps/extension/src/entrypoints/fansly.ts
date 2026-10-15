// Fansly's isolated world, document_start (docs/project-unite/architecture.md
// §2, §7.1): the early bootstrap of a Fansly tab, `fansly.js` (≤ 31 KiB gzip,
// ≤ 3 ms). Wiring lives in composition/tab.ts; this entry assembles the Fansly
// adapter for it (§1.3) from the starter of @cg/host-fansly.
//
// NOT in the manifest: the background's sync registers it right after
// `fansly-main` in one call once Fansly is switched on (§4; P9a), on
// fansly.com and, in a test build, on the stand. It starts without WXT's
// wrapper (build/isolated-entry.ts): `main` is called bare. What the page hears
// for the sound goes to the background from here, application or not (R20
// P14a).

import { createKeyPendingMark, createKeyboardProbe, routeOfLocation, startFanslyTab, type FanslyPort, type StartedFanslyTab, type Validation } from '@cg/host-fansly/isolated';
import type { UnlistedScriptDefinition } from 'wxt';
import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';

import { composeTab, type HostAdapter } from '../composition/tab';
import type { StartedHost } from '../composition/tab/adapter';
import { FANSLY_LAZY_ROOT } from '../hosts/runtime/fansly';

/** The tab's client as it takes a request of a site's own registry (as composition/tab/hosts/fansly/requests.ts does). */
type SiteRequest = (type: string, payload: unknown) => Promise<unknown>;

/**
 * The started Fansly host as the tab runs it (R20 P14a): what its page hears for the sound goes by the tab's port, a
 * request of Fansly's own registry per batch of MAIN, application or not. The shared client is typed by the shared
 * registry; its answer is not read: before the application the port checks only its own two answers.
 */
export function withSoundReports(started: StartedFanslyTab): StartedHost<FanslyPort> {
  return { ...started, attach: (rpc) => started.report({ request: (type, payload) => (rpc.request as unknown as SiteRequest)(type, payload) }) };
}

/**
 * The early half of the Fansly adapter (R20 P7c: its start brings up Fansly's HostPort — the route by signals, the
 * anchors, the identity, the freshness port; P7d: the dock's place by Fansly's composer, the page's theme). Its
 * application's half (`FANSLY_APP`, composition/tab/hosts/fansly/app.ts) comes with Fansly's `tab-app` once the dock
 * has a place or a key of ours waits: never before.
 */
export const FANSLY_ADAPTER: HostAdapter<FanslyPort> = {
  kind: 'fansly-web',
  start: (env) =>
    withSoundReports(
      startFanslyTab({
        win: env.win,
        // The bridge's schemas are a lazy chunk of Fansly's own build (§3.1): this file is one classic script.
        validation: () => env.lazy<Validation>('bridge-validation'),
        // The writes of R20 P7e: the token of the click or key, the owner's deadline of «Открыть и вставить».
        redeem: env.redeem,
        navInsertTimeoutMs: env.navInsertTimeoutMs,
        onDiagnostic: env.onDiagnostic,
      }),
    ),
  // Fansly's own rules for our keys (R20 P7i, §7.9): its message field — `textarea.message-input` under the route —,
  // and its windows — `body.modal-opened`, the focus in FBuddy's `fb-*-ui` — to which our keys yield; Enter is Fansly's.
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
