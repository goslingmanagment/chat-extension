// Fansly's row of the runtime table (./index.ts): its addresses, and nothing
// else. Fansly's own entry points import this file alone — never the table,
// never another site's row — so its MAIN-world bundle stays dependency-free
// (docs/project-unite/architecture.md §1.2, §5). The registry entry
// (../fansly.ts) reads its addresses from here.
//
// P9a joined this row to RUNTIME_HOSTS for the grant/reload handshake; with
// R20 P7i the background admits a Fansly tab's requests by Fansly's slice of
// the feature manifest, which Fansly's background module brings.

/** Fansly's pages, where its scripts run once the person switched Fansly on (§4). */
export const FANSLY_MATCHES: readonly string[] = ['https://fansly.com/*'];

/** Fansly's API: optional permission and passive observation (§8.2–§8.3). */
export const FANSLY_API_MATCHES: readonly string[] = ['https://apiv3.fansly.com/*'];

/** Quiet mode (X3) is ChatSpace's alone: the extension talks to Fansly's API (X4). */
export const FANSLY_QUIET_DOMAINS: readonly string[] = [];

/**
 * Where Fansly's own build of the lazy chunks lies in the extension (§3.2): `<root>/<entry>.js`, its shared chunks in
 * `<root>/chunks/`. The tab asks for its chunks here; the registry entry (../fansly.ts) has its build write them here.
 */
export const FANSLY_LAZY_ROOT = 'lazy/fansly';

/**
 * The relay frame of «Fansly через вкладку» (§8.5, R20 P9c): an extension page at the extension's own base, framed by
 * a Fansly tab in a closed root; web-accessible to Fansly's pages alone (build/manifest.ts), its port `cg-relay`.
 */
export const FANSLY_RELAY_PAGE = 'fansly-relay.html';

/**
 * The page's own socket and API, which Fansly's MAIN observes (§5.2, §5.4; FS-WS-1): the host name of its socket
 * (`wss://wsv3.fansly.com?v=3`) and the origin of its API (`/api/v1/…`). Its entry point hands them in.
 */
export const FANSLY_NETWORK = { socketHosts: ['wsv3.fansly.com'], apiOrigins: ['https://apiv3.fansly.com'] } as const;

/**
 * The Fansly stand's (packages/testing/src/fake-fansly): its socket and API on the loopback name `localhost`, on
 * ports of their own. Read ONLY under `__CG_TEST_HOSTS__`, so a release bundle never carries it (tools/gates
 * `release-bundle`).
 */
export const FANSLY_STAND_NETWORK = { socketHosts: ['localhost'], apiOrigins: ['http://localhost'] } as const;
