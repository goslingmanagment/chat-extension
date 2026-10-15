// The Fansly host as a site adapter starts it (docs/project-unite/
// architecture.md §1.3, §7.1): the tab's ports in, the started host out. The
// extension's entry point assembles the Fansly adapter around this call — the
// adapter's type needs the application's TabEnv, which a package cannot
// import (apps/extension/src/entrypoints/fansly.ts).
//
// Synchronous, without WXT's wrapper, at document_start: our hosts of a dead
// instance go first (an already-open tab after an update still shows them, and
// this instance owns the page now), then the host itself (start.ts) — the
// mounts and the theme, the handshake with Fansly's MAIN, the route and the
// search for the anchors — and, behind the bridge, Fansly's HostPort (R20
// P7c) — which places the dock by Fansly's composer (R20 P7d) and reads the
// page's theme. Until the dock has a place, nothing of the application
// starts on a Fansly page; the palette of the page's variables is P8d's.

import { removeStaleHosts } from '@cg/host-kit/isolated/hosts';

import type { FanslyDiagnostic } from './host-port';
import { startFanslyHost, type StartFanslyHostOptions, type StartedFanslyHost } from './start';

export type { FanslyDiagnostic, FanslyTheme } from './host-port';

export type FanslyStartEnv = Pick<StartFanslyHostOptions, 'win' | 'validation' | 'handshakeTimeoutMs' | 'searchMs'> & {
  readonly onDiagnostic?: (diagnostic: FanslyDiagnostic) => void;
};

export interface StartedFanslyTab extends StartedFanslyHost {
  /** Our hosts of a dead instance this start took out of the page. */
  readonly staleHosts: number;
}

export function startFanslyTab(env: FanslyStartEnv): StartedFanslyTab {
  const staleHosts = removeStaleHosts(env.win.document);
  return { staleHosts, ...startFanslyHost(env) };
}
