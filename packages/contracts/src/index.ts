// @cg/contracts — the shared vocabulary of every world (architecture.md §5).
//
// R00 only fixes what the scaffold already needs on both sides of a boundary:
// the MAIN ↔ isolated handshake constants and the tab ↔ background port name.
// R01 freezes the full interfaces (identities, HostPort, bridge protocol, op
// model, AppClient, HubFacade, CG registry, settings v1) on top of this file.
// Depends on zod only (§4).

export * from './bridge';
export * from './tab-protocol';

/** Bumped by R01 when it tags `contracts-v1.0`. */
export const CONTRACTS_VERSION = '0.0.0-r00';
