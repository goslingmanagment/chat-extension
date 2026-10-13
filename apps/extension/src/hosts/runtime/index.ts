// The runtime table of the hosts (docs/project-unite/architecture.md §1.2):
// what code that ships knows of the sites — their addresses — and nothing of
// the registry's build fields (budgets, the contract check, archive markers,
// the test config: ../index.ts). The background, the extension pages and the
// hub guard read it here; a site's own entry points read only their row
// (./<host>.ts). The registry reads its addresses from these rows, never the
// other way round: nothing that ships imports the registry
// (.dependency-cruiser.cjs `host-registry-build-only`).
//
// Relative imports carry `.ts`: the registry runs under plain Node 26 too
// (build/manifest.ts in tools/gates), which strips types but does not guess
// extensions.

import type { HostKind } from '@cg/contracts';

import { CHATSPACE_MATCHES, CHATSPACE_QUIET_DOMAINS } from './chatspace.ts';

export { CHATSPACE_MATCHES };

/**
 * true — `url` points at a host platform in quiet mode (X3): one of its quiet domains or any subdomain, whatever the
 * scheme, port or path. ChatSpace is the one quiet host (Fansly talks to its site's API, X4); a test of the table
 * holds this to every row with quiet domains.
 */
export function isQuietHost(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/\.+$/, '');
  } catch {
    return false;
  }
  return CHATSPACE_QUIET_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

/**
 * Loopback: the stand and the fake hub. Code that ships reads it ONLY under
 * `__CG_TEST_HOSTS__`, so a release bundle never carries it; the release
 * manifest test and tools/gates fail if any of these leak into one.
 */
export const LOOPBACK_MATCHES: readonly string[] = ['http://127.0.0.1/*', 'http://localhost/*'];

/** A site's row: its addresses. Its kind and platform are the contracts' (`HostKind`, `Platform`). */
export interface RuntimeHostRow {
  /** The site's pages, as match patterns: where its scripts run, which tabs the background takes as its own. */
  readonly matches: readonly string[];
  /** Quiet mode (X3): the domains the extension never sends a request of its own to; [] — it talks to the site. */
  readonly quietDomains: readonly string[];
}

/** Every site of the extension by its kind. Code that ships reads the rows' constants; the registry reads this table. */
export const RUNTIME_HOSTS = {
  chatspace: { matches: CHATSPACE_MATCHES, quietDomains: CHATSPACE_QUIET_DOMAINS },
} as const satisfies { readonly [K in HostKind]?: RuntimeHostRow };

export type RuntimeHostKind = keyof typeof RUNTIME_HOSTS;

/**
 * One value for every site of the table. A composition root writes its per-site wiring (the background's tab hosts,
 * the sound's host origins) `satisfies PerHost<…>`: a new row fails the typecheck until that wiring has its site.
 */
export type PerHost<T> = { readonly [K in RuntimeHostKind]: T };
