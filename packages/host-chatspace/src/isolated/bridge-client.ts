// ChatSpace's bridge to its MAIN world: the shared client of the page
// (@cg/host-kit/isolated/bridge-client.ts — the handshake, the three stages of
// checks, the timeouts, the coalescing) typed by ChatSpace's registry: its
// requests with their payloads and answers and its events, as
// @cg/contracts/bridge-messages lists them. Types only: the registry's
// schemas are validate.ts, its events that are never coalesced wire.ts, and
// start.ts hands both to the client.

import type { FromMainType, ToMainType } from '@cg/contracts/bridge';
import type { FromMainPayload, ToMainData, ToMainPayload } from '@cg/contracts/bridge-messages';
import type { BridgeEvent as EventOf, MainBridgeClient as ClientOf } from '@cg/host-kit/isolated/bridge-client';

export { BridgeCallError, type BridgeFailure, type BridgeStats } from '@cg/host-kit/isolated/bridge-client';

/** ChatSpace's bridge registry as types (contracts TO_MAIN, FROM_MAIN). */
export interface ChatSpaceBridge {
  readonly requests: { readonly [T in ToMainType]: { readonly payload: ToMainPayload<T>; readonly data: ToMainData<T> } };
  readonly events: { readonly [T in FromMainType]: FromMainPayload<T> };
}

export type BridgeEvent = EventOf<ChatSpaceBridge>;
export type MainBridgeClient = ClientOf<ChatSpaceBridge>;
