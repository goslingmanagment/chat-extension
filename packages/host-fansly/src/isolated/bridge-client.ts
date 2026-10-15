// Fansly's bridge to its MAIN world: the shared client of the page
// (@cg/host-kit/isolated/bridge-client.ts — the handshake, the three stages of
// checks, the timeouts) typed by Fansly's registry (docs/project-unite/
// architecture.md §6): its requests with their payloads and answers, as
// @cg/contracts/bridge-messages-fansly lists them, and the event frames on its
// port — `fx.batch` with the events of one listener call inside, `fx.gap`,
// `fault`. Types only: the schemas are validate.ts, the frames that are never
// coalesced wire.ts, and the starter hands both to the client.

import type { FanslyWireEventType, ToMainFanslyType } from '@cg/contracts/bridge-fansly';
import type { FanslyWireEventPayload, ToMainFanslyData, ToMainFanslyPayload } from '@cg/contracts/bridge-messages-fansly';
import type { BridgeEvent as EventOf, MainBridgeClient as ClientOf } from '@cg/host-kit/isolated/bridge-client';

export { BridgeCallError, type BridgeFailure, type BridgeStats } from '@cg/host-kit/isolated/bridge-client';

/** Fansly's bridge registry as types (contracts TO_MAIN_FANSLY, FANSLY_WIRE_EVENTS). */
export interface FanslyBridge {
  readonly requests: { readonly [T in ToMainFanslyType]: { readonly payload: ToMainFanslyPayload<T>; readonly data: ToMainFanslyData<T> } };
  readonly events: { readonly [T in FanslyWireEventType]: FanslyWireEventPayload<T> };
}

export type FanslyBridgeEvent = EventOf<FanslyBridge>;
export type FanslyMainBridgeClient = ClientOf<FanslyBridge>;
