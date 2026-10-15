// Fansly's row of the runtime table (./index.ts): its addresses, and nothing
// else. Fansly's own entry points import this file alone — never the table,
// never another site's row — so its MAIN-world bundle stays dependency-free
// (docs/project-unite/architecture.md §1.2, §5). The registry entry
// (../fansly.ts) reads its addresses from here.
//
// The row is not in the table yet (`RUNTIME_HOSTS`): the background core and
// the extension pages, which read the whole table, learn of Fansly when its
// tabs register with the background and its scripts are registered by it
// (R20 P7i, P9a) — joining the table moves bytes both sites load.

/** Fansly's pages, where its scripts run once the person switched Fansly on (§4). */
export const FANSLY_MATCHES: readonly string[] = ['https://fansly.com/*'];

/** Quiet mode (X3) is ChatSpace's alone: the extension talks to Fansly's API (X4). */
export const FANSLY_QUIET_DOMAINS: readonly string[] = [];

/**
 * Where Fansly's own build of the lazy chunks lies in the extension (§3.2): `<root>/<entry>.js`, its shared chunks in
 * `<root>/chunks/`. The tab asks for its chunks here; the registry entry (../fansly.ts) has its build write them here.
 */
export const FANSLY_LAZY_ROOT = 'lazy/fansly';
