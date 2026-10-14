// One call that brings the ChatSpace host up on the isolated side — for the
// tab composition root (R00's tab.ts, wired by the integrator) and the e2e
// harness alike. Synchronous part (document_start): the mount manager (the
// dock host with its closed root exists from the start, so the UI can mount
// into it once) and the theme reader. Asynchronous part: the MAIN handshake
// and the first snapshot; without MAIN the port still answers, reporting the
// host as not ready (CG-HOST-NOT-READY).

import { BRIDGE_LIMITS } from '@cg/contracts/limits';
import { connectMainBridge } from '@cg/host-kit/isolated/bridge-client';

import type { ChatSpaceBridge, MainBridgeClient } from './bridge-client';
import type { DraftStorage } from './draft-store';
import { createChatSpaceHostPort, type ChatSpaceHostPort, type HostDiagnostic, type TokenRedeemer } from './host-port';
import { createMountManager, type MountDiagnostic, type MountManager } from './mount';
import { createThemeReader, type ThemeReader } from './theme';
import type { Validation, ValidationLoader } from './validation';
import { UNDROPPABLE_EVENTS } from './wire';

export interface StartChatSpaceHostOptions {
  readonly win: Window;
  readonly redeem: TokenRedeemer;
  /**
   * Where the schema module comes from (validation.ts): `loadValidation` for a
   * bundle that can import a module of its own, a loader of its lazy chunk for
   * the extension's content script. Asked once; a failed load is asked again
   * with the next frame.
   */
  readonly validation: ValidationLoader;
  readonly drafts?: DraftStorage | null;
  /** Bootstrap `limits.navInsertTimeoutSec` × 1000; a function is read at each «Открыть и вставить» (the bootstrap arrives after the start). */
  readonly navInsertTimeoutMs?: number | (() => number | undefined);
  /** How long the handshake waits for MAIN. */
  readonly handshakeTimeoutMs?: number;
  /** The document-wide observer of the first composer search, ms (§6.3). */
  readonly firstSearchMs?: number;
  readonly onDiagnostic?: (diagnostic: HostDiagnostic | MountDiagnostic) => void;
}

export interface StartedChatSpaceHost {
  readonly mounts: MountManager;
  readonly theme: ThemeReader;
  /** The bridge client, once MAIN answered; null without MAIN. */
  readonly bridge: Promise<MainBridgeClient | null>;
  /** The HostPort, once the bridge is up (or known to be missing) and the first snapshot was taken. */
  readonly host: Promise<ChatSpaceHostPort>;
}

export function startChatSpaceHost(options: StartChatSpaceHostOptions): StartedChatSpaceHost {
  const doc = options.win.document;
  const mounts = createMountManager(doc, {
    ...(options.firstSearchMs !== undefined ? { firstSearchMs: options.firstSearchMs } : {}),
    ...(options.onDiagnostic ? { onDiagnostic: options.onDiagnostic } : {}),
  });
  const theme = createThemeReader(doc);
  // One module for the bridge and the port, however often they ask; a load that failed is not kept.
  let loaded: Promise<Validation> | null = null;
  const validation: ValidationLoader = () =>
    (loaded ??= options.validation().catch((error: unknown) => {
      loaded = null;
      throw error;
    }));
  // The shared client of the page over ChatSpace's registry: its schemas (`validation`) and its events that are never coalesced.
  const bridge = connectMainBridge<ChatSpaceBridge>(options.win, validation, UNDROPPABLE_EVENTS, options.handshakeTimeoutMs ?? BRIDGE_LIMITS.callTimeoutMs).catch(() => {
    options.onDiagnostic?.({ event: 'main-missing', code: 'CG-HOST-NOT-READY' });
    return null;
  });
  const host = bridge.then(async (client) => {
    const port = createChatSpaceHostPort({
      win: options.win,
      bridge: client,
      redeem: options.redeem,
      mounts,
      theme,
      validation,
      drafts: options.drafts ?? null,
      ...(options.navInsertTimeoutMs !== undefined ? { navInsertTimeoutMs: options.navInsertTimeoutMs } : {}),
      ...(options.onDiagnostic ? { onDiagnostic: options.onDiagnostic } : {}),
    });
    await port.ready;
    return port;
  });
  return { mounts, theme, bridge, host };
}
