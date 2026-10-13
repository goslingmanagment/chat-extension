// The host registry (docs/project-unite/architecture.md §1.2): every site the
// extension runs on, one entry each (./<host>.ts). Build data, read at build
// time: the manifest and its check (build/manifest.ts), the WXT entries
// (wxt.config.ts), the sites' lazy builds and their web resources
// (lazy/vite.config.ts), the gates, the budget lines, archive-check and
// host-contract-check (tools/). Code that ships reads the runtime table
// (./runtime/index.ts) instead, so no build field reaches a bundle
// (.dependency-cruiser.cjs `host-registry-build-only`). A new site is an entry
// here plus its own files.
//
// Relative imports carry `.ts`: this file also runs under plain Node 26
// (tools/gates), which strips types but does not guess extensions.

import { CHATSPACE } from './chatspace.ts';
import { FANSLY_STAND_PERMISSIONS } from './fansly.ts';
import { CHATSPACE_STAND_MATCHES, FANSLY_STAND_MATCHES, LOOPBACK_MATCHES } from './runtime/index.ts';
import type { HostDescriptor, HostPermissions, LazySite, ScriptSpec } from './types.ts';

export type * from './types.ts';
export { CHATSPACE_STAND_MATCHES, FANSLY_STAND_MATCHES, LOOPBACK_MATCHES };

export const HOSTS: readonly HostDescriptor[] = [CHATSPACE];

/** The registry entry of a host kind; undefined — the extension does not run there. */
export function hostOf(kind: string, hosts: readonly HostDescriptor[] = HOSTS): HostDescriptor | undefined {
  return hosts.find((host) => host.kind === kind);
}

/** Every script of a site: the MAIN one, the isolated one, then the notice and the others. */
export function scriptsOf(host: HostDescriptor): ScriptSpec[] {
  return [host.scripts.main, host.scripts.isolated, ...(host.scripts.notice === undefined ? [] : [host.scripts.notice]), ...(host.scripts.extra ?? [])];
}

/** Where a site's scripts run: its pages, and in a test build its loopback stand too. */
export function pageMatchesOf(host: HostDescriptor, test: boolean): string[] {
  return [...host.matches, ...(test ? host.test.pageMatches : [])];
}

/**
 * The test build's second lazy build (R20 F2b): an empty build of a second site, in place of the one the registry does
 * not have yet. It keeps the per-site path — two builds side by side, a web resource entry each — running in the test
 * build and its e2e; a release build never carries it, and the registry's own second site (Fansly, P7a0) takes its
 * place. Its pages are the Fansly stand's (`localhost`, FANSLY_STAND_MATCHES), where ChatSpace's stand is `127.0.0.1`
 * (architecture.md §13), so ChatSpace's stand cannot load its file.
 */
export const SECOND_LAZY_BUILD: LazySite = {
  site: 'second-site',
  build: { root: 'lazy/second-site', entries: { empty: 'second-site/empty.js' }, layers: [], beforeTheDock: [] },
  matches: FANSLY_STAND_MATCHES,
};

/** The lazy builds of an extension build: every site's of the registry, in its order; a test build of one site gets the second. */
export function lazySitesOf(test: boolean, hosts: readonly HostDescriptor[] = HOSTS): LazySite[] {
  const sites = hosts.map((host): LazySite => ({ site: host.kind, build: host.lazy, matches: pageMatchesOf(host, test) }));
  return test && sites.length === 1 ? [...sites, SECOND_LAZY_BUILD] : sites;
}

/**
 * The stands a test build carries for sites the registry has no entry for yet: their permissions alone — no script,
 * no lazy build. Fansly's (R20 P6a: its stand's optional origins and `webRequest`, which the e2e grants and revokes)
 * until its entry (P7a0) carries the stand as its own `test`.
 */
export function pendingStandsOf(hosts: readonly HostDescriptor[] = HOSTS): HostPermissions[] {
  return hosts.some((host) => host.kind === 'fansly-web') ? [] : [FANSLY_STAND_PERMISSIONS];
}

/** The hub (D-13). */
export const HUB_HOST_PERMISSION = 'https://gosling-agency.ru/*';

/** A non-default hub address is requested on a user gesture when saved (§3). */
export const CUSTOM_HUB_OPTIONAL_PERMISSION = 'https://*/*';

/** What a test build adds to the host permissions for the fake hub (packages/testing/src/fake-hub, on `127.0.0.1`). */
export const TEST_HUB_MATCHES: readonly string[] = ['http://127.0.0.1/*'];
