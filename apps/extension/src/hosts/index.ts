// The host registry (docs/project-unite/architecture.md §1.2): every site the
// extension runs on, one entry each (./<host>.ts). Build data, read at build
// time: the manifest and its check (build/manifest.ts), the WXT entries
// (wxt.config.ts), the gates, the budget lines, archive-check and
// host-contract-check (tools/). Code that ships reads the runtime table
// (./runtime/index.ts) instead, so no build field reaches a bundle
// (.dependency-cruiser.cjs `host-registry-build-only`). A new site is an entry
// here plus its own files.
//
// Relative imports carry `.ts`: this file also runs under plain Node 26
// (tools/gates), which strips types but does not guess extensions.

import { CHATSPACE } from './chatspace.ts';
import { LOOPBACK_MATCHES } from './runtime/index.ts';
import type { HostDescriptor, ScriptSpec } from './types.ts';

export type * from './types.ts';
export { LOOPBACK_MATCHES };

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

/** The hub (D-13). */
export const HUB_HOST_PERMISSION = 'https://gosling-agency.ru/*';

/** A non-default hub address is requested on a user gesture when saved (§3). */
export const CUSTOM_HUB_OPTIONAL_PERMISSION = 'https://*/*';

/** What a test build adds to the host permissions for the fake hub (packages/testing, on loopback). */
export const TEST_HUB_MATCHES: readonly string[] = LOOPBACK_MATCHES;
