// The extension manifest policy (architecture.md §3 «Манифест», D-01, D-32).
// Pure functions: wxt.config.ts applies them, the manifest test and
// tools/gates check the built manifest with checkManifest(). Every site's part
// — its hosts, content scripts, origins, lazy chunks and test stand — comes
// from the host registry (src/hosts, docs/project-unite/architecture.md §1.2).
//
// Relative imports carry `.ts`: this file also runs under plain Node 26
// (tools/gates), which strips types but does not guess extensions.

import type { UserManifest } from 'wxt';

import {
  CUSTOM_HUB_OPTIONAL_PERMISSION,
  HOSTS,
  HUB_HOST_PERMISSION,
  TEST_HUB_MATCHES,
  lazySitesOf,
  pageMatchesOf,
  scriptsOf,
  type HostDescriptor,
  type HostPermissions,
  type LazySite,
  type OptionalApi,
  type ScriptSpec,
} from '../src/hosts/index.ts';

export const EXTENSION_NAME = 'ChatGoose';
export const EXTENSION_DESCRIPTION = 'AI-помощник для ChatSpace и Fansly: ответы, сводки и инструменты чаттера агентства.';
export const GECKO_ID = 'chat-extension@gosling.agency';
export const TEST_GECKO_ID = 'chat-extension-test@gosling.agency';
export const UPDATE_URL = 'https://ext.gosling-agency.ru/chat-extension/firefox/updates.json';
export const STRICT_MIN_VERSION = '142.0';
export const PERMISSIONS = ['storage', 'alarms', 'scripting'] as const;
/** Firefox built-in data consent (same set as the Fansly extension; technical data only optional). */
export const DATA_COLLECTION = {
  required: [
    'authenticationInfo',
    'personallyIdentifyingInfo',
    'personalCommunications',
    'financialAndPaymentInfo',
    'websiteContent',
  ],
  optional: ['technicalAndInteraction'],
} as const;

export type BuildFlavor = 'release' | 'test';

const unique = (items: readonly string[]): string[] => [...new Set(items)];

/**
 * Granted at install: every site that is not optional, then the hub; a test build adds the fake hub and the stands of
 * those sites. An optional site's stand is optional in a test build too (optionalHostPermissions).
 */
export function hostPermissions(flavor: BuildFlavor, hosts: readonly HostDescriptor[] = HOSTS): string[] {
  const required = hosts.filter((host) => !host.permissions.optional);
  const test = flavor === 'test' ? unique([...TEST_HUB_MATCHES, ...required.flatMap((host) => host.test.pageMatches)]) : [];
  return [...required.flatMap((host) => host.permissions.origins), HUB_HOST_PERMISSION, ...test];
}

/** The stands a test build asks for on request: the optional sites' own, optional as their pages are (R20 P6a). */
function optionalStands(flavor: BuildFlavor, hosts: readonly HostDescriptor[]): HostPermissions[] {
  if (flavor !== 'test') return [];
  return hosts.filter((host) => host.permissions.optional).map((host): HostPermissions => ({ origins: host.test.pageMatches, optional: true, api: host.permissions.api ?? [] }));
}

/**
 * Asked for on a gesture: a custom hub address, then the optional sites' origins; a test build adds their stands —
 * nothing of them granted at install, so the e2e grants and revokes them as a person would (R20 P6a).
 */
export function optionalHostPermissions(flavor: BuildFlavor, hosts: readonly HostDescriptor[] = HOSTS): string[] {
  const sites = hosts.filter((host) => host.permissions.optional).flatMap((host) => host.permissions.origins);
  return [CUSTOM_HUB_OPTIONAL_PERMISSION, ...unique([...sites, ...optionalStands(flavor, hosts).flatMap((stand) => stand.origins)])];
}

/** The optional API permissions the optional sites (and, in a test build, their stands) ask for with their origins; [] — the manifest has none. */
export function optionalPermissions(flavor: BuildFlavor, hosts: readonly HostDescriptor[] = HOSTS): OptionalApi[] {
  const sites = hosts.filter((host) => host.permissions.optional).flatMap((host) => host.permissions.api ?? []);
  return [...new Set([...sites, ...optionalStands(flavor, hosts).flatMap((stand) => stand.api ?? [])])];
}

/** The lazy builds of a flavor that ship files, each with the pages that may load them (its web resource entry). */
export function lazyBuildsWithFiles(flavor: BuildFlavor, hosts: readonly HostDescriptor[] = HOSTS): LazySite[] {
  return lazySitesOf(flavor === 'test', hosts).filter((site) => Object.keys(site.build.entries).length > 0);
}

/** true — `file` (a path inside the extension) is a file of that lazy build. */
const inBuild = (file: unknown, site: LazySite): boolean => typeof file === 'string' && file.startsWith(`${site.build.root}/`);

/** The site a built script belongs to, by its file; undefined — no site declares it. */
export function hostOfFile(file: string, hosts: readonly HostDescriptor[] = HOSTS): { readonly host: HostDescriptor; readonly script: ScriptSpec } | undefined {
  for (const host of hosts) {
    const script = scriptsOf(host).find((spec) => spec.file === file);
    if (script !== undefined) return { host, script };
  }
  return undefined;
}

/** The static part handed to WXT; entry points add background, content scripts and pages. */
export function baseManifest(flavor: BuildFlavor, hosts: readonly HostDescriptor[] = HOSTS): UserManifest {
  const test = flavor === 'test';
  const optionalApi = optionalPermissions(flavor, hosts);
  return {
    name: test ? `${EXTENSION_NAME} (тест)` : EXTENSION_NAME,
    description: EXTENSION_DESCRIPTION,
    permissions: [...PERMISSIONS],
    host_permissions: hostPermissions(flavor, hosts),
    optional_host_permissions: optionalHostPermissions(flavor, hosts),
    ...(optionalApi.length > 0 ? { optional_permissions: optionalApi } : {}),
    browser_specific_settings: {
      gecko: {
        // A test build is a different add-on: it never auto-updates from the
        // release feed and never shares storage with the release install.
        id: test ? TEST_GECKO_ID : GECKO_ID,
        strict_min_version: STRICT_MIN_VERSION,
        ...(test ? {} : { update_url: UPDATE_URL }),
        data_collection_permissions: {
          required: [...DATA_COLLECTION.required],
          optional: [...DATA_COLLECTION.optional],
        },
      },
    },
  };
}

/** Minimal structural view of the generated manifest we post-process. */
export interface ManifestLike {
  [key: string]: unknown;
  content_scripts?: Array<{ matches?: string[]; js?: string[]; [key: string]: unknown }>;
  web_accessible_resources?: unknown;
}

/**
 * Applied in WXT's build:manifestGenerated hook: web_accessible_resources =
 * exactly the lazy chunks (+ their CSS) and a site's relay page (R20 P9c), one
 * entry per site's lazy build, for that site's pages alone (docs/project-unite/architecture.md §3.2: a site's
 * tab may load its own build, never another's); in a test build every content
 * script also matches its site's loopback stand. A content script no site of
 * the registry declares, or a lazy file of no build, fails the build.
 */
export function finalizeManifest(
  manifest: ManifestLike,
  options: { flavor: BuildFlavor; lazyChunks: readonly { readonly file: string; readonly site: string }[]; hosts?: readonly HostDescriptor[] },
): void {
  const test = options.flavor === 'test';
  const hosts = options.hosts ?? HOSTS;
  for (const script of manifest.content_scripts ?? []) {
    const files = script.js ?? [];
    const owner = files.map((file) => hostOfFile(file, hosts)).find((found) => found !== undefined);
    if (owner === undefined) throw new Error(`finalizeManifest: content script ${files.join(', ')} is declared by no site of the host registry (src/hosts)`);
    script.matches = unique([...(script.matches ?? []), ...pageMatchesOf(owner.host, test)]);
  }
  if (manifest.web_accessible_resources !== undefined) {
    throw new Error('finalizeManifest: unexpected web_accessible_resources from WXT; only lazy chunks may be exposed');
  }
  const sites = lazySitesOf(test, hosts);
  for (const chunk of options.lazyChunks) {
    const site = sites.find((candidate) => candidate.site === chunk.site);
    if (site === undefined || !inBuild(chunk.file, site)) throw new Error(`finalizeManifest: lazy file ${chunk.file} is of no lazy build of this flavor (${sites.map((candidate) => candidate.build.root).join(', ')})`);
  }
  // A site's relay page (R20 P9c) goes into its entry: its pages frame it, no other page may.
  const resources = sites
    .map((site) => ({ site, files: options.lazyChunks.filter((chunk) => chunk.site === site.site).map((chunk) => chunk.file) }))
    .filter(({ files }) => files.length > 0)
    .map(({ site, files }) => ({ resources: [...files.sort(), ...(site.relayPage === undefined ? [] : [site.relayPage])], matches: [...site.matches] }));
  if (resources.length > 0) manifest.web_accessible_resources = resources;
}

const LOOPBACK_RE = /(127\.0\.0\.1|localhost)/;

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function sameSet(actual: unknown, expected: readonly string[]): boolean {
  const list = asArray(actual);
  return list.length === expected.length && expected.every((item) => list.includes(item));
}

const worldOf = (script: Record<string, unknown>): unknown => (script['world'] === undefined ? 'ISOLATED' : script['world']);

/** Every rule of §3 «Манифест», each site's part from the host registry. Returns human-readable problems; [] means OK. */
export function checkManifest(manifest: Record<string, unknown>, flavor: BuildFlavor, hosts: readonly HostDescriptor[] = HOSTS): string[] {
  const problems: string[] = [];
  const fail = (message: string): void => {
    problems.push(message);
  };
  const test = flavor === 'test';

  if (manifest['manifest_version'] !== 3) fail('manifest_version must be 3');
  const expectedName = test ? `${EXTENSION_NAME} (тест)` : EXTENSION_NAME;
  if (manifest['name'] !== expectedName) fail(`name must be «${expectedName}»`);

  const gecko = (manifest['browser_specific_settings'] as { gecko?: Record<string, unknown> } | undefined)?.gecko;
  if (!gecko) fail('browser_specific_settings.gecko missing');
  else {
    if (gecko['id'] !== (test ? TEST_GECKO_ID : GECKO_ID)) fail('gecko.id mismatch');
    if (gecko['strict_min_version'] !== STRICT_MIN_VERSION) fail(`gecko.strict_min_version must be ${STRICT_MIN_VERSION}`);
    if (test ? gecko['update_url'] !== undefined : gecko['update_url'] !== UPDATE_URL) fail('gecko.update_url mismatch');
    const dcp = gecko['data_collection_permissions'] as { required?: unknown; optional?: unknown } | undefined;
    if (!dcp || !sameSet(dcp.required, DATA_COLLECTION.required) || !sameSet(dcp.optional, DATA_COLLECTION.optional)) {
      fail('gecko.data_collection_permissions must be exactly the §3 required/optional sets');
    }
  }

  if (!sameSet(manifest['permissions'], PERMISSIONS)) fail(`permissions must be exactly ${PERMISSIONS.join(', ')}`);
  const expectedHosts = hostPermissions(flavor, hosts);
  if (!sameSet(manifest['host_permissions'], expectedHosts)) fail(`host_permissions must be exactly ${expectedHosts.join(', ')}`);
  const expectedOptionalHosts = optionalHostPermissions(flavor, hosts);
  if (!sameSet(manifest['optional_host_permissions'], expectedOptionalHosts)) {
    fail(`optional_host_permissions must be exactly ${expectedOptionalHosts.join(', ')}`);
  }
  // What is optional is never granted at install: an origin in both lists could never be asked for, nor revoked.
  for (const origin of asArray(manifest['optional_host_permissions'])) {
    if (asArray(manifest['host_permissions']).includes(origin)) fail(`${String(origin)} is both granted at install and optional`);
  }
  const expectedOptionalApi = optionalPermissions(flavor, hosts);
  if (expectedOptionalApi.length === 0 ? manifest['optional_permissions'] !== undefined : !sameSet(manifest['optional_permissions'], expectedOptionalApi)) {
    fail(expectedOptionalApi.length === 0 ? 'no optional_permissions: no site asks for an optional API' : `optional_permissions must be exactly ${expectedOptionalApi.join(', ')}`);
  }

  const background = manifest['background'] as Record<string, unknown> | undefined;
  if (!background || !Array.isArray(background['scripts']) || background['scripts'].length !== 1) {
    fail('background must be an event page with exactly one background.scripts entry');
  }
  if (background && 'service_worker' in background) fail('background.service_worker is not allowed (D-01)');
  if (background && background['persistent'] === true) fail('background must not be persistent');

  const scripts = asArray(manifest['content_scripts']) as Array<Record<string, unknown>>;
  const declared = hosts.flatMap((host) => scriptsOf(host).map((script) => ({ host, script })));
  const inManifest = declared.filter(({ script }) => script.registration === 'manifest');
  const byBackground = declared.filter(({ script }) => script.registration !== 'manifest');
  if (scripts.length !== inManifest.length) {
    fail(`exactly ${inManifest.length} manifest content scripts (${inManifest.map(({ script }) => script.file).join(', ')}); the background registers or injects the others (${byBackground.map(({ script }) => script.file).join(', ')})`);
  }
  for (const { host, script: spec } of inManifest) {
    const label = `${spec.world === 'MAIN' ? 'MAIN' : 'isolated'} content script ${spec.entry}`;
    const script = scripts.find((candidate) => worldOf(candidate) === spec.world && asArray(candidate['js']).includes(spec.file));
    if (!script) {
      fail(`${label} missing (${spec.world}, ${spec.file})`);
      continue;
    }
    const origins = pageMatchesOf(host, test);
    if (!sameSet(script['js'], [spec.file])) fail(`${label} must load only ${spec.file}`);
    if (script['run_at'] !== 'document_start') fail(`${label} must run at document_start`);
    if (script['all_frames'] !== false) fail(`${label} must set all_frames: false`);
    if (!sameSet(script['matches'], origins)) fail(`${label} matches must be exactly ${origins.join(', ')}`);
    if (script['css'] !== undefined) fail(`${label} must not inject CSS (styles live in our shadow roots)`);
  }
  for (const { script: spec } of byBackground) {
    if (JSON.stringify(scripts).includes(spec.file)) fail(`${spec.file} must not be a manifest content script (registration: ${spec.registration})`);
  }

  // One entry per lazy build, for that site's pages alone (architecture.md §3.2).
  const war = asArray(manifest['web_accessible_resources']) as Array<Record<string, unknown>>;
  const builds = lazyBuildsWithFiles(flavor, hosts);
  if (war.length !== builds.length) fail(`web_accessible_resources must be one entry per lazy build (${builds.map((site) => site.build.root).join(', ')}), got ${war.length}`);
  for (const entry of war) {
    const resources = asArray(entry['resources']);
    if (resources.length === 0) fail('a web_accessible_resources entry lists no lazy chunks');
    for (const resource of resources) {
      if (typeof resource !== 'string' || (!/^lazy\/.+\.(js|css)$/.test(resource) && !builds.some((site) => site.relayPage === resource))) {
        fail(`web_accessible_resources may list only lazy chunks and their CSS, and a site's relay page, got ${String(resource)}`);
      }
    }
    if ('use_dynamic_url' in entry) fail('use_dynamic_url is Chrome-only');
    // A site's own entry: its lazy files, and its relay page (R20 P9c) — never another site's.
    const site = builds.find((candidate) => resources.some((resource) => inBuild(resource, candidate)) && resources.every((resource) => inBuild(resource, candidate) || resource === candidate.relayPage));
    if (site === undefined) {
      fail(`a web_accessible_resources entry must list the files of exactly one lazy build (${builds.map((candidate) => candidate.build.root).join(', ')}), got ${resources.slice(0, 3).map(String).join(', ')}${resources.length > 3 ? ', …' : ''}`);
      continue;
    }
    if (!sameSet(entry['matches'], site.matches)) fail(`web_accessible_resources of ${site.build.root} must match exactly ${site.matches.join(', ')}`);
  }
  for (const site of builds) {
    const entries = war.filter((entry) => asArray(entry['resources']).some((resource) => inBuild(resource, site)));
    if (entries.length !== 1) fail(`the lazy build ${site.build.root} must be exactly one web_accessible_resources entry, got ${entries.length}`);
    if (site.relayPage !== undefined && !asArray(entries[0]?.['resources']).includes(site.relayPage)) fail(`the relay page ${site.relayPage} must be in the web_accessible_resources entry of ${site.build.root}`);
  }

  const action = manifest['action'] as Record<string, unknown> | undefined;
  if (typeof action?.['default_popup'] !== 'string') fail('action.default_popup (popup page) missing');
  const options = manifest['options_ui'] as Record<string, unknown> | undefined;
  if (typeof options?.['page'] !== 'string' || options['open_in_tab'] !== true) fail('options_ui with open_in_tab: true missing');
  if (manifest['content_security_policy'] !== undefined) fail('content_security_policy must stay the MV3 default');
  if (manifest['commands'] !== undefined) fail('no manifest commands (hotkeys live in the early dispatcher, §9.1)');

  if (!test) {
    const text = JSON.stringify(manifest);
    if (LOOPBACK_RE.test(text)) fail('release manifest must not mention loopback stand/fake hub hosts');
    for (const host of hosts) {
      for (const pattern of host.test.pageMatches) if (text.includes(pattern.replace(/\/\*$/, ''))) fail(`release manifest must not carry the ${host.kind} test stand ${pattern}`);
    }
    if (text.includes(TEST_GECKO_ID)) fail('release manifest must not carry the test gecko id');
  }
  return problems;
}
