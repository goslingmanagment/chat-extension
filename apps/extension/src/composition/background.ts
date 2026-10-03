// Composition root of the background event page (architecture.md §4: only
// dependency wiring here). R07/R08/R10 plug their services in through this file.

import { BackgroundStatusSchema, TabHelloSchema, type BackgroundStatus } from '@cg/contracts';
import { onTabPortConnect, syncDynamicMainScript, type DynamicMainScriptSpec } from '@cg/platform';

import { CHATSPACE_MATCHES, LOOPBACK_MATCHES } from '../hosts';

/** id of the dynamically registered WS tap (§6.8 п. 10). */
export const WS_TAP_SCRIPT_ID = 'cg-ws-tap';

export function wsTapSpec(): DynamicMainScriptSpec {
  // A test build taps only the loopback stand (spike M0, gate d); release taps
  // ChatSpace, and only when the bootstrap flag `wsTap` is on (R08). The
  // compile-time constant keeps loopback hosts out of the release bundle.
  return { id: WS_TAP_SCRIPT_ID, js: ['chatspace-ws.js'], matches: __CG_TEST_HOSTS__ ? LOOPBACK_MATCHES : CHATSPACE_MATCHES };
}

export function composeBackground(): void {
  // Until bootstrap flags exist (R08) the release flag `wsTap` is off.
  const wsTapEnabled = __CG_TEST_HOSTS__;
  const wsTapReady: Promise<boolean> = syncDynamicMainScript(wsTapSpec(), wsTapEnabled).then(
    () => wsTapEnabled,
    () => false,
  );

  // Registered synchronously so a port can wake the event page.
  onTabPortConnect((port) => {
    port.onMessage((raw) => {
      if (!TabHelloSchema.safeParse(raw).success) return;
      void wsTapReady.then((wsTapRegistered) => {
        const status: BackgroundStatus = { t: 'status', v: 1, wsTapRegistered, testBuild: __CG_TEST_HOSTS__ };
        port.post(BackgroundStatusSchema.parse(status));
      });
    });
  });
}
