// ChatSpace's row of the runtime table (./index.ts): its addresses, and nothing
// else. ChatSpace's own entry points import this file alone — never the table,
// never another site's row — so a MAIN-world bundle stays dependency-free
// (§4, D-06). The registry entry (../chatspace.ts) reads its addresses from here.
// The host registry (this folder) and the host contract file are the only
// places in our code allowed to name the ChatSpace origin (tools/gates).

/** ChatSpace pages the content scripts match (D-01, architecture.md §3 «Манифест»). */
export const CHATSPACE_MATCHES: readonly string[] = ['https://chat.onlymonster.ai/*'];

/**
 * Quiet mode (§2, X3): the extension never sends a request of its own to the
 * host platform. Its whole domain is therefore never a hub address, and the
 * background's `fetch` refuses it whatever the settings say.
 */
export const CHATSPACE_QUIET_DOMAINS: readonly string[] = ['onlymonster.ai'];
