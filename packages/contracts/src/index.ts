// @cg/contracts — the shared vocabulary of every world (architecture.md §5):
// identities, the host port, the MAIN ↔ isolated bridge, the tab/pages ↔
// background protocol, operations, settings, errors, telemetry and logs.
// Types and schemas only (zod/mini, docs/protocols/README.md); depends on zod
// only (§4). Each module is also its own `exports` subpath. The package is
// side-effect free, so a bundle carries only the modules it uses: the early
// isolated start uses the light ones (bridge, tab-protocol, tab-liveness,
// limits) and leaves the per-type registries (bridge-messages, tab-messages)
// to the code that handles that traffic.

export * from './primitives';
export * from './features';
export * from './ids';
export * from './limits';
export * from './errors';
export * from './settings';
export * from './send';
export * from './host';
export * from './ops';
export * from './bridge';
export * from './tab-protocol';

// TODO(R01-2a): export vm/* — view models, AppClient, UiAction, ActionReceipt (§10.2).
// TODO(R01-2b): export hub.ts — HubFacade and the hub DTOs (§5.8, hub-pr-plan.md §4).
// TODO(R01-2c): export cg-registry.ts and the i18n key catalog (Appendix A, §9.7).

/** Bumped when the integration step tags `contracts-v1.0`. */
export const CONTRACTS_VERSION = '0.0.0-r00';
