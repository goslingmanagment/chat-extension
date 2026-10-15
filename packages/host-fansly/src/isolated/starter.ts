// The Fansly host as a site adapter starts it (docs/project-unite/
// architecture.md §1.3, §7.1): the tab's ports in, the started host out. The
// extension's entry point assembles the Fansly adapter around this call — the
// adapter's type needs the application's TabEnv, which a package cannot
// import (apps/extension/src/entrypoints/fansly.ts).
//
// Synchronous, without WXT's wrapper, at document_start: our hosts of a dead
// instance go first (an already-open tab after an update still shows them, and
// this instance owns the page now), then the mounts and the theme, then the
// handshake with Fansly's MAIN world over the shared client of host-kit — its
// schemas are the lazy chunk `bridge-validation` of Fansly's own build, loaded
// with MAIN's first frame. The rest of the start comes with its work packages
// (R20 P7a0 is the site on the stand): the route and the anchors, the identity
// and Fansly's HostPort with P7c, the dock's place and the theme with P7d.
// Until P7c the tab has no host port of Fansly's: it waits for none, so nothing
// of the application starts on a Fansly page.

import type { CgCode } from '@cg/contracts/errors';
import type { FanslyHostPort } from '@cg/contracts/fansly-host';
import type { HostTheme } from '@cg/contracts/host';
import { BRIDGE_LIMITS } from '@cg/contracts/limits';
import { connectMainBridge } from '@cg/host-kit/isolated/bridge-client';
import { removeStaleHosts } from '@cg/host-kit/isolated/hosts';

import type { FanslyBridge, FanslyMainBridgeClient } from './bridge-client';
import { createFanslyMounts, type FanslyMounts } from './mount';
import type { Validation, ValidationLoader } from './validation';
import { UNDROPPABLE_EVENTS } from './wire';

/** What the host tells the tab's log: an event and its code, never a text. */
export interface FanslyDiagnostic {
  readonly event: string;
  readonly code?: CgCode;
}

export interface FanslyStartEnv {
  readonly win: Window;
  /**
   * Where Fansly's schema module comes from (validation.ts): the extension's loader of its lazy chunk, or
   * `loadValidation` for a bundle that can import a module of its own. Asked once; a failed load is asked again with
   * the next frame.
   */
  readonly validation: ValidationLoader;
  /** How long the handshake waits for MAIN (the bridge's call timeout by default). */
  readonly handshakeTimeoutMs?: number;
  readonly onDiagnostic?: (diagnostic: FanslyDiagnostic) => void;
}

/** Fansly's theme as its page shows it: the light scheme until P7d reads the page's own. */
export interface FanslyTheme {
  current(): HostTheme;
  onChange(listener: (theme: HostTheme) => void): () => void;
  dispose(): void;
}

export interface StartedFanslyTab {
  /** Our hosts of a dead instance this start took out of the page. */
  readonly staleHosts: number;
  readonly mounts: FanslyMounts;
  readonly theme: FanslyTheme;
  /** The bridge client, once MAIN answered; null without MAIN. */
  readonly bridge: Promise<FanslyMainBridgeClient | null>;
  /** Fansly's HostPort: P7c's; until then it never comes. */
  readonly host: Promise<FanslyHostPort>;
}

const LIGHT: HostTheme = { scheme: 'light', tokens: {}, fixedWidth: false };

export function startFanslyTab(env: FanslyStartEnv): StartedFanslyTab {
  const doc = env.win.document;
  const staleHosts = removeStaleHosts(doc);
  const mounts = createFanslyMounts(doc);
  const theme: FanslyTheme = { current: () => LIGHT, onChange: () => () => undefined, dispose: () => undefined };
  // One module for the bridge, however often it asks; a load that failed is not kept.
  let loaded: Promise<Validation> | null = null;
  const validation: ValidationLoader = () =>
    (loaded ??= env.validation().catch((error: unknown) => {
      loaded = null;
      throw error;
    }));
  // The shared client of the page over Fansly's registry: its schemas and its frames that are never coalesced.
  const bridge = connectMainBridge<FanslyBridge>(env.win, validation, UNDROPPABLE_EVENTS, env.handshakeTimeoutMs ?? BRIDGE_LIMITS.callTimeoutMs).catch(() => {
    env.onDiagnostic?.({ event: 'main-missing', code: 'CG-HOST-NOT-READY' });
    return null;
  });
  const host = new Promise<FanslyHostPort>(() => undefined);
  return { staleHosts, mounts, theme, bridge, host };
}
