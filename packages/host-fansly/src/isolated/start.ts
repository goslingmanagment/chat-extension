// One call that brings the Fansly host up in the isolated world
// (docs/project-unite/architecture.md §7.1) — for the adapter's start
// (starter.ts) and the e2e harness alike. Synchronous, at document_start, in
// the order of §7.1: the mount layers and the theme, the handshake with
// Fansly's MAIN over the shared client of host-kit, then the route and the
// search for the anchors — both watch the page from its first moment.
// Asynchronous: Fansly's HostPort, once MAIN answered (or is known to be
// missing) and its first state was taken; without MAIN the port still
// answers, and its report says CG-HOST-NOT-READY.
//
// Nothing here touches an element's `style` (§3.1: ≤ 3 ms) or runs on a timer
// but the search's own time limit.

import type { HostTheme } from '@cg/contracts/host';
import { BRIDGE_LIMITS } from '@cg/contracts/limits';
import { connectMainBridge } from '@cg/host-kit/isolated/bridge-client';

import { createAnchorWatcher, type AnchorWatcher } from './anchors';
import type { FanslyBridge, FanslyMainBridgeClient } from './bridge-client';
import { createFanslyHostPort, type FanslyDiagnostic, type FanslyPort, type FanslyTheme } from './host-port';
import { createFanslyMounts, type FanslyMounts } from './mount';
import { createRouteWatcher, type RouteWatcher } from './route';
import type { Validation, ValidationLoader } from './validation';
import { UNDROPPABLE_EVENTS } from './wire';

export interface StartFanslyHostOptions {
  readonly win: Window;
  /**
   * Where Fansly's schema module comes from (validation.ts): the extension's loader of its lazy chunk, or
   * `loadValidation` for a bundle that can import a module of its own. Asked once; a failed load is asked again with
   * the next frame.
   */
  readonly validation: ValidationLoader;
  /** How long the handshake waits for MAIN (the bridge's call timeout by default). */
  readonly handshakeTimeoutMs?: number;
  /** A search's time limit (anchors.ts SEARCH_MS by default). */
  readonly searchMs?: number;
  readonly onDiagnostic?: (diagnostic: FanslyDiagnostic) => void;
}

export interface StartedFanslyHost {
  readonly mounts: FanslyMounts;
  readonly theme: FanslyTheme;
  readonly route: RouteWatcher;
  readonly anchors: AnchorWatcher;
  /** The bridge client, once MAIN answered; null without MAIN. */
  readonly bridge: Promise<FanslyMainBridgeClient | null>;
  /** Fansly's HostPort, once the bridge is up (or known to be missing) and MAIN's first state was taken. */
  readonly host: Promise<FanslyPort>;
}

const LIGHT: HostTheme = { scheme: 'light', tokens: {}, fixedWidth: false };

/** Fansly's theme until P8d reads the page's own: the light scheme. */
const lightTheme = (): FanslyTheme => ({ current: () => LIGHT, onChange: () => () => undefined, dispose: () => undefined });

/**
 * The handshake with Fansly's MAIN: the shared client of the page over Fansly's registry — its schemas, loaded once
 * (a load that failed is asked again with the next frame), and its frames that are never coalesced. Rejects without
 * MAIN after `timeoutMs`.
 */
export function connectFanslyMain(win: Window, load: ValidationLoader, timeoutMs: number = BRIDGE_LIMITS.callTimeoutMs): Promise<FanslyMainBridgeClient> {
  let loaded: Promise<Validation> | null = null;
  const validation: ValidationLoader = () =>
    (loaded ??= load().catch((error: unknown) => {
      loaded = null;
      throw error;
    }));
  return connectMainBridge<FanslyBridge>(win, validation, UNDROPPABLE_EVENTS, timeoutMs);
}

export function startFanslyHost(options: StartFanslyHostOptions): StartedFanslyHost {
  const { win } = options;
  const doc = win.document;
  const mounts = createFanslyMounts(doc);
  const theme = lightTheme();
  const bridge = connectFanslyMain(win, options.validation, options.handshakeTimeoutMs).catch(() => {
    options.onDiagnostic?.({ event: 'main-missing', code: 'CG-HOST-NOT-READY' });
    return null;
  });
  const route = createRouteWatcher(win, options.onDiagnostic);
  const anchors = createAnchorWatcher(doc, route, options.searchMs === undefined ? {} : { searchMs: options.searchMs });
  const host = bridge.then(async (client) => {
    const port = createFanslyHostPort({ win, bridge: client, mounts, theme, route, anchors, ...(options.onDiagnostic ? { onDiagnostic: options.onDiagnostic } : {}) });
    await port.ready;
    return port;
  });
  return { mounts, theme, route, anchors, bridge, host };
}
