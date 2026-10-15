// host-fansly/isolated — the isolated-world side of the Fansly host
// (docs/project-unite/architecture.md §7): its start, its bridge registry over
// the shared mechanics of the page (@cg/host-kit/isolated: the bridge client,
// our closed hosts and their layers, the registry of their roots, the key
// probe), whose names this entry keeps exporting for the code that starts the
// Fansly host. Imports only @cg/host-kit and @cg/contracts. Never receives the
// hub token, never touches the network or page storage.
//
// Fansly's schema module is not exported here: the isolated content script is
// one classic file, a dynamic import inside it would be inlined. It is its own
// export (`@cg/host-fansly/isolated/validation`), the `bridge-validation`
// chunk of Fansly's lazy build.

export { BridgeCallError, type BridgeFailure, type BridgeStats, type FanslyBridge, type FanslyBridgeEvent, type FanslyMainBridgeClient } from './bridge-client';
export type { Validation, ValidationLoader } from './validation';
export { createFanslyMounts, type FanslyMounts } from './mount';
export { createKeyboardProbe, routeOfLocation } from './keyboard';
export { DELIVERED_KEY_MARK, KEY_PENDING_ATTRIBUTE, createKeyPendingMark, type KeyboardProbe } from '@cg/host-kit/isolated/keyboard';
export { HOST_ATTRIBUTE, removeStaleHosts, type ClosedHost, type OverlayLayer } from '@cg/host-kit/isolated/hosts';
export { startFanslyTab, type FanslyDiagnostic, type FanslyStartEnv, type FanslyTheme, type StartedFanslyTab } from './starter';
export { UNDROPPABLE_EVENTS } from './wire';
