// Where the extension runs and which origins it may talk to (architecture.md §3
// «Манифест»). This file and build/manifest.ts are the only places in our code
// allowed to name the ChatSpace origin (tools/gates enforces the allowlist).

/** ChatSpace pages the content scripts match (D-01, §3). */
export const CHATSPACE_MATCHES: readonly string[] = ['https://chat.onlymonster.ai/*'];

/**
 * Quiet mode (§2, X3): the extension never sends a request of its own to the
 * host platform. Its whole domain is therefore never a hub address, and the
 * background's `fetch` refuses it whatever the settings say.
 */
export const QUIET_DOMAINS: readonly string[] = ['onlymonster.ai'];

/** true — `url` points at the host platform: one of the quiet domains or any subdomain, whatever the scheme, port or path. */
export function isQuietHost(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/\.+$/, '');
  } catch {
    return false;
  }
  return QUIET_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

/** The hub (D-13). */
export const HUB_HOST_PERMISSION = 'https://gosling-agency.ru/*';

/** A non-default hub address is requested on a user gesture when saved (§3). */
export const CUSTOM_HUB_OPTIONAL_PERMISSION = 'https://*/*';

/**
 * Loopback stand and fake hub. Present ONLY in a CG_TEST_HOSTS=1 build; the
 * release manifest test and tools/gates fail if any of these leak into it.
 */
export const LOOPBACK_MATCHES: readonly string[] = ['http://127.0.0.1/*', 'http://localhost/*'];
