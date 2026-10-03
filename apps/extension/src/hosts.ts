// Where the extension runs and which origins it may talk to (architecture.md §3
// «Манифест»). This file and build/manifest.ts are the only places in our code
// allowed to name the ChatSpace origin (tools/gates enforces the allowlist).

/** ChatSpace pages the content scripts match (D-01, §3). */
export const CHATSPACE_MATCHES: readonly string[] = ['https://chat.onlymonster.ai/*'];

/** The hub (D-13). */
export const HUB_HOST_PERMISSION = 'https://gosling-agency.ru/*';

/** A non-default hub address is requested on a user gesture when saved (§3). */
export const CUSTOM_HUB_OPTIONAL_PERMISSION = 'https://*/*';

/**
 * Loopback stand and fake hub. Present ONLY in a CG_TEST_HOSTS=1 build; the
 * release manifest test and tools/gates fail if any of these leak into it.
 */
export const LOOPBACK_MATCHES: readonly string[] = ['http://127.0.0.1/*', 'http://localhost/*'];
