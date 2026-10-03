// host-chatspace/isolated — the isolated-world side of the ChatSpace host
// (architecture.md §4, §6): bridge client, HostPort, contract check, mounting,
// guarded insertion, navigation. Imports only @cg/contracts and
// @cg/core/domain/text. Never receives the hub token, never touches the network.

export { connectMainBridge, type MainBridgeClient } from './bridge-client';
export { findComposerMount, mountClosedHost, removeStaleHosts, waitForComposerMount, type ClosedHost, type WaitForComposerOptions } from './mount';
