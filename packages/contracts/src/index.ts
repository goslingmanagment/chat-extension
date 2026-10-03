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
export * from './telemetry';
export * from './logs';
export * from './bridge';
export * from './bridge-messages';
export * from './tab-protocol';
export * from './tab-messages';
export * from './tab-liveness';
export * from './errors/registry';
export * from './i18n/keys';
export * from './i18n/catalog';
export * from './vm/index';
export * from './hub';

/** Bumped when the integration step tags `contracts-v1.0`. */
export const CONTRACTS_VERSION = '0.0.0-r00';
