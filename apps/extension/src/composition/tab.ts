// Composition root of the isolated content script on a site's tab
// (architecture.md §2, §4: wiring only), over the site's host adapter
// (docs/project-unite/architecture.md §1.3; tab/adapter.ts): the site's entry
// point assembles its adapter and calls `composeTab(env, adapter)`.
//
// What runs synchronously at document_start is as little as the page allows
// (§11: ≤ 3 ms): the site's host starts — stale hosts of a dead instance go,
// its mount manager and theme reader at once, the MAIN handshake behind them
// — and the early key dispatcher takes `window` before the site's own
// listeners exist (§9.1; tab/keys.ts). That is all: neither the extension API
// nor an element's `style` is touched there — the first touch of each in a
// page's content-script global costs ~0.3 ms, and both wait until they are
// needed (the port, a placed dock, a theme read). One task later the rest
// of the early bundle wakes up (tab/runtime.ts): the port to the background,
// the tab's registration and presence. The application itself — the protocol
// registry, the controllers, the texts, the UI — is lazy chunks of the site's
// own build, loaded when the site shows a composer or a key of ours waits for
// it (HK-024), and never before either (EX-011).
//
// Lifecycle is OURS, not WXT's: the script starts without WXT's
// ContentScriptContext (build/isolated-entry.ts). Its invalidation was an
// event the page could dispatch too (spike M0), and Firefox kills a removed or
// updated extension's content scripts outright; the extension going away is
// seen through the background port (tab/runtime.ts).

import type { HostPort } from '@cg/contracts/host';

import type { HostAdapter, HostDiagnostic, TabEnv } from './tab/adapter';
import { startTabKeys } from './tab/keys';
import { lazyLoader } from './tab/lazy';
import { tabProbeFor, type TabProbe } from './tab/probe';
import type { TabRuntime } from './tab/runtime';

export type { HostAdapter, TabEnv } from './tab/adapter';

/** What the host told us before the logger of the tab existed (events and codes only). */
const DIAGNOSTICS_KEPT = 50;

export function composeTab<P extends HostPort>(env: TabEnv, adapter: HostAdapter<P>): void {
  const started = performance.now();
  const { win } = env;
  const doc = win.document;
  // e2e diagnostics exist only in a CG_TEST_HOSTS build: the compile-time
  // constant lets the bundler drop the probe from release.
  const probe: TabProbe | null = __CG_TEST_HOSTS__ ? tabProbeFor(win) : null;

  const life = new AbortController();

  // A tab that predates this instance got us late (not at document_start):
  // the dock shows «перезагрузите вкладку» from this signal.
  const lateInjection = doc.readyState !== 'loading';

  let runtime: Promise<TabRuntime> | null = null;
  let navInsertTimeoutMs: number | undefined;
  const diagnostics: HostDiagnostic[] = [];
  let onDiagnostic: ((diagnostic: HostDiagnostic) => void) | null = null;
  // The site's own lazy build (§3.2): the host's bridge schemas, the application and everything it loads.
  const lazy = lazyLoader(adapter.lazy.root);

  const host = adapter.start({
    win,
    lazy,
    // A write spends the action token of its click before anything reaches MAIN (§14); no runtime — no write.
    redeem(request) {
      if (runtime === null) return Promise.resolve(false);
      const spend = (): Promise<boolean> => (runtime === null ? Promise.resolve(false) : runtime.then((ready) => ready.redeem(request)).catch(() => false));
      // A TEST build on the loopback stand may hold the write here, between our check of the chat and MAIN's (the probe; release has none).
      return probe === null ? spend() : probe.holdWrite().then(spend);
    },
    // Bootstrap `limits.navInsertTimeoutSec`, once it arrived (the host starts before any bootstrap).
    navInsertTimeoutMs: () => navInsertTimeoutMs,
    onDiagnostic(diagnostic) {
      if (onDiagnostic !== null) onDiagnostic(diagnostic);
      else if (diagnostics.length < DIAGNOSTICS_KEPT) diagnostics.push(diagnostic);
    },
  });
  const { staleHosts } = host;
  probe?.set('lifecycle', { staleHosts, lateInjection });
  // The keys of the tab, in the same synchronous step: a key pressed in the first moments of the page is ours.
  let wakeAsked = false;
  const keys = startTabKeys({
    win,
    mounts: host.mounts,
    site: adapter,
    onWaiting() {
      wakeAsked = true;
      void runtime?.then((ready) => ready.wake()).catch(() => undefined);
    },
  });
  life.signal.addEventListener('abort', () => {
    probe?.set('runtime', 'shut-down');
    keys.dispose();
    host.mounts.dispose();
    host.theme.dispose();
    void host.bridge.then((bridge) => bridge?.close());
    void host.host.then((port) => port.dispose());
  });

  host.activation?.stopped.addEventListener('abort', () => life.abort('host-retired'), { once: true });
  if (host.activation?.stopped.aborted) life.abort('host-retired');

  if (probe !== null && !life.signal.aborted) {
    void host.bridge.then(async (bridge) => {
      if (bridge === null) probe.set('mainError', 'no MAIN bridge');
      else probe.set('main', await bridge.probe());
    }).catch(() => undefined);
  }

  // Everything else of the early bundle, one task later. A host's admission
  // waits for its coexistence checks before any background registration.
  setTimeout(() => {
    void (host.activation?.ready ?? Promise.resolve(true)).then((admitted) => {
      if (!admitted || life.signal.aborted) return;
      runtime = import('./tab/runtime').then(({ startTabRuntime }) => {
        if (life.signal.aborted) throw new Error('host-retired');
        return startTabRuntime({
          win,
          kind: adapter.kind,
          lazy,
          life: life.signal,
          abort: (reason) => life.abort(reason),
          host,
          keys,
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
        });
      });
      runtime.then(
        (ready) => (wakeAsked ? ready.wake() : undefined),
        (error: unknown) => { if (!life.signal.aborted) probe?.set('runtimeError', String(error)); },
      );
    });
  }, 0);

  // The body of composeTab only; the probe adds the whole synchronous start of
  // the bundle (§11: ≤ 3 ms on winpc) once the bundle's last statement ran.
  probe?.bootstrapped(performance.now() - started);
}
