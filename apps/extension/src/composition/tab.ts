// Composition root of the isolated content script on a ChatSpace tab
// (architecture.md §2, §4: wiring only).
//
// What runs synchronously at document_start is as little as the page allows
// (§11: ≤ 3 ms): stale hosts of a dead instance go, the ChatSpace host starts
// — its mount manager and theme reader at once, the MAIN handshake behind
// them — and that is all. One task later the rest of the early bundle wakes
// up (tab/runtime.ts): the port to the background, the tab's registration and
// presence. The application itself — the protocol registry, the controllers,
// the texts, the UI — is lazy chunks, loaded when ChatSpace shows a composer
// and never outside a chat (EX-011).
//
// Lifecycle is OURS, not WXT's: WXT invalidates its ContentScriptContext when
// a `<runtime id>:chatspace:wxt:content-script-started` CustomEvent reaches the
// document — and the page can dispatch that event too (spike M0). Firefox
// kills a removed or updated extension's content scripts outright, so a real
// invalidation only ever reaches an instance whose runtime is gone; while our
// runtime is alive, an invalidation is a spoof and is ignored.

import { removeStaleHosts, startChatSpaceHost, type HostDiagnostic, type MountDiagnostic } from '@cg/host-chatspace/isolated';
// The light entry of the platform: its index would evaluate the RPC client and the protocol schemas at document_start (§11).
import { isExtensionContextAlive } from '@cg/platform/runtime';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';

import { tabProbeFor, type TabProbe } from './tab/probe';
import type { TabRuntime } from './tab/runtime';

export interface TabEnv {
  readonly ctx: ContentScriptContext;
  readonly win: Window;
}

/** What the host told us before the logger of the tab existed (events and codes only). */
const DIAGNOSTICS_KEPT = 50;

export function composeTab(env: TabEnv): void {
  const started = performance.now();
  const { ctx, win } = env;
  const doc = win.document;
  // e2e diagnostics exist only in a CG_TEST_HOSTS build: the compile-time
  // constant lets the bundler drop the probe from release.
  const probe: TabProbe | null = __CG_TEST_HOSTS__ ? tabProbeFor(win) : null;

  const life = new AbortController();
  let spoofedInvalidations = 0;
  ctx.onInvalidated(() => {
    if (!isExtensionContextAlive()) {
      life.abort('extension-gone');
      return;
    }
    spoofedInvalidations += 1;
    probe?.set('ignoredInvalidations', spoofedInvalidations);
  });

  // An already-open tab after an update/reinstall still shows the dead
  // instance's hosts; this instance owns the page now (§6.8 п. 8, UP-009).
  const staleHosts = removeStaleHosts(doc);
  // A tab that predates this instance got us late (not at document_start):
  // the dock shows «перезагрузите вкладку» from this signal.
  const lateInjection = doc.readyState !== 'loading';
  probe?.set('lifecycle', { staleHosts, lateInjection });

  let runtime: Promise<TabRuntime> | null = null;
  let navInsertTimeoutMs: number | undefined;
  const diagnostics: (HostDiagnostic | MountDiagnostic)[] = [];
  let onDiagnostic: ((diagnostic: HostDiagnostic | MountDiagnostic) => void) | null = null;

  const host = startChatSpaceHost({
    win,
    // A write spends the action token of its click before anything reaches MAIN (§14); no runtime — no write.
    redeem: (request) => (runtime === null ? Promise.resolve(false) : runtime.then((ready) => ready.redeem(request)).catch(() => false)),
    // ChatSpace's own draft key, read only (§6.1): the isolated world shares the page's localStorage.
    drafts: { getItem: (key) => win.localStorage.getItem(key) },
    // Bootstrap `limits.navInsertTimeoutSec`, once it arrived (the host starts before any bootstrap).
    navInsertTimeoutMs: () => navInsertTimeoutMs,
    onDiagnostic(diagnostic) {
      if (onDiagnostic !== null) onDiagnostic(diagnostic);
      else if (diagnostics.length < DIAGNOSTICS_KEPT) diagnostics.push(diagnostic);
    },
  });
  life.signal.addEventListener('abort', () => {
    probe?.set('runtime', 'shut-down');
    host.mounts.dispose();
    host.theme.dispose();
    void host.bridge.then((bridge) => bridge?.close());
    void host.host.then((port) => port.dispose());
  });

  if (probe !== null) {
    void host.bridge.then(async (bridge) => {
      if (bridge === null) probe.set('mainError', 'no MAIN bridge');
      else probe.set('main', await bridge.probe());
    });
  }

  // Everything else of the early bundle, one task later: outside the synchronous start (§11).
  setTimeout(() => {
    if (life.signal.aborted) return;
    runtime = import('./tab/runtime').then(({ startTabRuntime }) =>
      startTabRuntime({
        win,
        life: life.signal,
        abort: (reason) => life.abort(reason),
        host,
        lateInjection,
        staleHosts,
        probe,
        setNavInsertTimeoutMs(ms) {
          navInsertTimeoutMs = ms;
        },
        takeDiagnostics(listener) {
          onDiagnostic = listener;
          return diagnostics.splice(0);
        },
      }),
    );
    runtime.catch((error: unknown) => probe?.set('runtimeError', String(error)));
  }, 0);

  // The body of composeTab only; the probe adds the whole synchronous start of
  // the bundle (§11: ≤ 3 ms on winpc) once the bundle's last statement ran.
  probe?.bootstrapped(performance.now() - started);
}
