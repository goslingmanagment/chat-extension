// @cg/contracts — the shared vocabulary of every world (architecture.md §5):
// identities, the host port, the MAIN ↔ isolated bridge, the tab/pages ↔
// background protocol, operations, settings, errors and the CG registry,
// i18n keys, telemetry and logs, the UI contract (vm) and the hub facade
// with its DTOs (hub). The feature manifest (features/*) is its subpaths
// alone: the root is what the early isolated start imports, and every module
// it re-exports costs that bundle bytes whether it is used there or not.
// Types and schemas only (zod/mini, docs/protocols/README.md); depends on zod
// only (§4). Each module is also its own `exports` subpath. The package is
// side-effect free, so a bundle carries only the modules it uses: the early
// isolated start uses the light ones (bridge, tab-protocol, tab-liveness,
// limits) and leaves the per-type registries (bridge-messages, tab-messages)
// to the code that handles that traffic.

export * from './primitives';
export * from './features';
export * from './hosts';
export * from './ids';
export * from './limits';
export * from './errors';
export * from './settings';
export * from './send-rules';
export * from './send';
export * from './media';
export * from './send-media';
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

/**
 * Semver of the frozen contracts (`contracts-v1.0`, R01). A new field is a
 * minor bump, a new meaning a major one; every bump has its entry in
 * docs/contracts-changelog.md (architecture.md §5).
 */
export const CONTRACTS_VERSION = '1.31.0';
