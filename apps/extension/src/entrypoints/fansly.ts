// Fansly's isolated world, document_start (docs/project-unite/architecture.md
// §2, §7.1): the early bootstrap of a Fansly tab, `fansly.js` (≤ 31 KiB gzip,
// ≤ 3 ms). Wiring lives in composition/tab.ts; this entry assembles the Fansly
// adapter for it (§1.3) from the starter of @cg/host-fansly.
//
// NOT in the manifest: the background's sync registers it right after
// `fansly-main` in one call once Fansly is switched on (§4; P9a), on
// fansly.com and, in a test build, on the stand. It starts without WXT's
// wrapper (build/isolated-entry.ts): `main` is called bare.

import { createKeyPendingMark, createKeyboardProbe, routeOfLocation, startFanslyTab, type FanslyPort, type LauncherChunk, type Validation } from '@cg/host-fansly/isolated';
import type { UnlistedScriptDefinition } from 'wxt';
import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';

import { bothTransports, relayTransport } from '../composition/tab/hosts/fansly/relay';
import { soundTransport } from '../composition/tab/hosts/fansly/sound';
import { composeTab, type HostAdapter } from '../composition/tab';
import { FANSLY_LAZY_ROOT, FANSLY_RELAY_PAGE } from '../hosts/runtime/fansly';

/**
 * The early half of the Fansly adapter (R20 P7c: its start brings up Fansly's HostPort — the route by signals, the
 * anchors, the identity, the freshness port; P7d: the dock's place by Fansly's composer, the page's theme). Its
 * application's half (`FANSLY_APP`, composition/tab/hosts/fansly/app.ts) comes with Fansly's `tab-app` once the dock
 * has a place or a key of ours waits: never before.
 */
export const FANSLY_ADAPTER: HostAdapter<FanslyPort> = {
  kind: 'fansly-web',
  start: (env) => {
    const started = startFanslyTab({
      win: env.win,
      // The bridge's schemas are a lazy chunk of Fansly's own build (§3.1): this file is one classic script.
      validation: () => env.lazy<Validation>('bridge-validation'),
      // The writes of R20 P7e: the token of the click or key, the owner's deadline of «Открыть и вставить».
      redeem: env.redeem,
      navInsertTimeoutMs: env.navInsertTimeoutMs,
      // R20 P9c: the relay frame of «Fansly через вкладку», its address asked at its first mount (never at document_start).
      relayUrl: () => import('@cg/platform/runtime').then(({ extensionUrl }) => extensionUrl(FANSLY_RELAY_PAGE)),
      // X46: the floating launcher's buttons, a chunk of Fansly's build drawn once the tab is admitted.
      launcher: () => env.lazy<LauncherChunk>('launcher'),
      onDiagnostic: env.onDiagnostic,
    });
    // The site's own early transports: the socket's sounds (P14a) and the relay frame's lease (P9c).
    return { ...started, background: bothTransports(soundTransport(started.host, env.onDiagnostic), relayTransport(started.host, env.onDiagnostic)) };
  },
  // Fansly's own rules for our keys (R20 P7i, §7.9): its message field — `textarea.message-input` under the route —,
  // and its windows — `body.modal-opened`, the focus in FBuddy's `fb-*-ui` — to which our keys yield; Enter is Fansly's.
  keyProbe: createKeyboardProbe,
  keyPending: createKeyPendingMark,
  routeOfLocation,
  // The vendored scheme's rows of the Fansly extension, Notes (⌘⇧K) among them (§1.5).
  hotkeyClient: 'fansly',
  // The old Fansly extension's ways (audit 2026-10-20, regression 10): our combinations over its modals and FBuddy, AI
  // keys in any field, a generation over the «Развернуть ↗» window, ⌘⇧H as Coach. Fansly's slice has no `palette` and
  // no `navigation`: ⌘K, J/K, ⌘U and Alt+1–9 stay the page's and Firefox's, as the old extension left them.
  keyRules: { lenient: true, absent: ['palette', 'chat-next', 'chat-previous', 'next-unread', 'quick-jump'] },
  // Fansly's own lazy build (lazy/fansly/, §3.2).
  lazy: { root: FANSLY_LAZY_ROOT },
};

const definition: UnlistedScriptDefinition = defineUnlistedScript(() => {
  composeTab({ win: window }, FANSLY_ADAPTER);
});

export default definition;
