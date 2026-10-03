// Composition root of the isolated content script on a ChatSpace tab
// (architecture.md §2, §4: wiring only). Order: runtime port → MAIN bridge →
// wait for the composer → lazily load the dock chunk into a closed shadow root.
// R09/R13/R14/R17 plug their parts in here.
//
// Lifecycle is OURS, not WXT's: WXT invalidates its ContentScriptContext when
// a `<runtime id>:chatspace:wxt:content-script-started` CustomEvent reaches the
// document — and the page can dispatch that event too (spike M0). Firefox
// kills a removed or updated extension's content scripts outright, so a real
// invalidation only ever reaches an instance whose runtime is gone; while our
// runtime is alive, an invalidation is a spoof and is ignored.

import { BackgroundStatusSchema } from '@cg/contracts';
import { connectMainBridge, mountClosedHost, removeStaleHosts, waitForComposerMount, type ClosedHost } from '@cg/host-chatspace/isolated';
import { connectTabPort, extensionUrl, isExtensionContextAlive } from '@cg/platform';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';

import type * as DockChunk from '../../lazy/entries/dock';
import { createSpikeProbe, type SpikeProbe } from './spike-probe';

export interface TabEnv {
  readonly ctx: ContentScriptContext;
  readonly win: Window;
}

/** Lazy ESM chunks, loaded with import(moz-extension://…) — see lazy/vite.config.ts. */
export const LAZY_DOCK_PATH = 'lazy/dock.js';

/** How long the first composer search keeps its document-wide observer (§6.3). */
const FIRST_SEARCH_MS = 30_000;

export function composeTab(env: TabEnv): void {
  const started = performance.now();
  const { ctx, win } = env;
  const doc = win.document;
  // Spike/e2e diagnostics exist only in a CG_TEST_HOSTS build: the compile-time
  // constant lets the bundler drop the probe (and its lazy chunk) from release.
  const probe: SpikeProbe | null = __CG_TEST_HOSTS__ ? createSpikeProbe(win) : null;
  let dockHost: ClosedHost | null = null;

  const life = new AbortController();
  life.signal.addEventListener('abort', () => {
    probe?.set('runtime', 'shut-down');
    dockHost?.remove();
    dockHost = null;
  });
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
  // R09 shows the «перезагрузите вкладку» banner from this signal.
  const lateInjection = doc.readyState !== 'loading';
  probe?.set('lifecycle', { staleHosts, lateInjection });

  const port = connectTabPort();
  port.onMessage((raw) => {
    const status = BackgroundStatusSchema.safeParse(raw);
    if (status.success) probe?.set('background', status.data);
  });
  port.onDisconnect(() => {
    const alive = isExtensionContextAlive();
    probe?.set('runtime', alive ? 'port-closed' : 'reloaded');
    if (!alive) life.abort('extension-gone');
  });
  port.post({ t: 'hello', v: 1 });

  void connectMainBridge(win)
    .then(async (bridge) => {
      life.signal.addEventListener('abort', () => bridge.close());
      probe?.set('main', await bridge.probe());
    })
    .catch((error: unknown) => probe?.set('mainError', String(error)));

  void waitForComposerMount(doc, { timeoutMs: FIRST_SEARCH_MS, signal: life.signal })
    .then(async (parent) => {
      if (!parent || life.signal.aborted) return;
      const loadStarted = performance.now();
      const chunk = (await import(/* @vite-ignore */ extensionUrl(LAZY_DOCK_PATH))) as typeof DockChunk;
      const loadMs = performance.now() - loadStarted;
      if (life.signal.aborted) return;
      dockHost = mountClosedHost(parent, 'dock');
      const dock = chunk.mountDock(dockHost.root, { status: 'Каркас R00' });
      probe?.dockMounted(dockHost, { loadMs, renderMs: dock.renderMs, styleMode: dock.styleMode });
    })
    .catch((error: unknown) => probe?.set('dockError', String(error)));

  // Synchronous early bootstrap cost (§11: ≤ 3 ms on winpc).
  probe?.set('bootstrapMs', performance.now() - started);
}
