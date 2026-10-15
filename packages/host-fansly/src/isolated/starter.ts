// The Fansly host as a site adapter starts it (docs/project-unite/
// architecture.md §1.3, §7.1): the tab's ports in, the started host out. The
// extension's entry point assembles the Fansly adapter around this call — the
// adapter's type needs the application's TabEnv, which a package cannot
// import (apps/extension/src/entrypoints/fansly.ts).
//
// Synchronous, without WXT's wrapper, at document_start: our hosts of a dead
// instance go first (an already-open tab after an update still shows them, and
// a reload notice takes their place), then the host itself (start.ts) — the
// mounts and the theme, the handshake with Fansly's MAIN, the route and the
// search for the anchors — and, behind the bridge, Fansly's HostPort (R20
// P7c) — which places the dock by Fansly's composer (R20 P7d) and reads the
// page's theme. Until the dock has a place, nothing of the application
// starts on a Fansly page — but on `/creator/vault`, where the vault's entry
// has its place (P13b); the palette of the page's variables is P8d's.
// P7g waits for coexistence admission before the shared tab registers or
// starts background work. A retired copy stays off until reload.

import { removeStaleHosts } from '@cg/host-kit/isolated/hosts';

import { watchCoexistence } from './legacy';
import type { FanslyDiagnostic } from './host-port';
import { startFanslyHost, type StartFanslyHostOptions, type StartedFanslyHost } from './start';

export type { FanslyDiagnostic, FanslyTheme } from './host-port';

export type FanslyStartEnv = Pick<StartFanslyHostOptions, 'win' | 'validation' | 'redeem' | 'navInsertTimeoutMs' | 'handshakeTimeoutMs' | 'searchMs'> & {
  readonly onDiagnostic?: (diagnostic: FanslyDiagnostic) => void;
};

export interface StartedFanslyTab extends StartedFanslyHost {
  /** Our hosts of a dead instance this start took out of the page. */
  readonly staleHosts: number;
  readonly activation: { readonly ready: Promise<boolean>; readonly stopped: AbortSignal };
  /**
   * The application is wanted without a composer (R20 P13b): on `/creator/vault` the vault's entry has its place, so
   * the application loads as for the dock's — and with it, if the page's owner switched the vault on, the entry.
   */
  readonly wantsApp: { current(): boolean; onChange(listener: () => void): () => void };
}

/** The vault's page (isolated/vault/dom.ts `isVaultPath`, which this early bundle does not carry). */
const onVault = (path: string): boolean => path === '/creator/vault' || path === '/creator/vault/';

export function startFanslyTab(env: FanslyStartEnv): StartedFanslyTab {
  const staleHosts = removeStaleHosts(env.win.document);
  const coexistence = watchCoexistence(env.win, staleHosts);
  const started = startFanslyHost({ ...env, coexistence });
  const ready = Promise.all([coexistence.ready, started.host]).then(async ([, port]) => {
    if (coexistence.stopped.aborted) return false;
    // MAIN's identity event and our DOM-ready timer have different task sources.
    // Ask again after all DOMContentLoaded listeners before admitting the tab.
    await port.recheck();
    return !coexistence.stopped.aborted;
  });
  const wantsApp = {
    current: () => onVault(started.route.current().path),
    onChange: (listener: () => void) => started.route.onChange((change) => {
      if (onVault(change.route.path) !== onVault(change.previous.path)) listener();
    }),
  };
  return { staleHosts, ...started, activation: { ready, stopped: coexistence.stopped }, wantsApp };
}
