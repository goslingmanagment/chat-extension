// The extension manifest policy (architecture.md §3 «Манифест», D-01, D-32).
// Pure functions: wxt.config.ts applies them, the manifest test and
// tools/gates check the built manifest with checkManifest(). Every site's part
// — its hosts, content scripts, origins and test stand — comes from the host
// registry (src/hosts, docs/project-unite/architecture.md §1.2).
//
// Relative imports carry `.ts`: this file also runs under plain Node 26
// (tools/gates), which strips types but does not guess extensions.

import type { UserManifest } from 'wxt';

import {
  CUSTOM_HUB_OPTIONAL_PERMISSION,
  HOSTS,
  HUB_HOST_PERMISSION,
  TEST_HUB_MATCHES,
  pageMatchesOf,
  scriptsOf,
  type HostDescriptor,
  type OptionalApi,
  type ScriptSpec,
} from '../src/hosts/index.ts';

export const EXTENSION_NAME = 'ChatGoose для ChatSpace';
export const EXTENSION_DESCRIPTION = 'AI-помощник ChatGoose для чаттеров агентства поверх OnlyMonster ChatSpace.';
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

/** Granted at install: every site that is not optional, then the hub; a test build adds the fake hub and the sites' stands. */
export function hostPermissions(flavor: BuildFlavor, hosts: readonly HostDescriptor[] = HOSTS): string[] {
  const required = hosts.filter((host) => !host.permissions.optional).flatMap((host) => host.permissions.origins);
  const test = flavor === 'test' ? unique([...TEST_HUB_MATCHES, ...hosts.flatMap((host) => host.test.pageMatches)]) : [];
  return [...required, HUB_HOST_PERMISSION, ...test];
}

/** Asked for on a gesture: a custom hub address, then the optional sites' origins. */
export function optionalHostPermissions(hosts: readonly HostDescriptor[] = HOSTS): string[] {
  return [CUSTOM_HUB_OPTIONAL_PERMISSION, ...hosts.filter((host) => host.permissions.optional).flatMap((host) => host.permissions.origins)];
}

/** The optional API permissions the optional sites ask for with their origins; [] — the manifest has none. */
export function optionalPermissions(hosts: readonly HostDescriptor[] = HOSTS): OptionalApi[] {
  return [...new Set(hosts.filter((host) => host.permissions.optional).flatMap((host) => host.permissions.api ?? []))];
}

/** Where the lazy chunks may be loaded from: every site's pages (and stands, in a test build). */
export function lazyChunkMatches(flavor: BuildFlavor, hosts: readonly HostDescriptor[] = HOSTS): string[] {
  return unique(hosts.flatMap((host) => pageMatchesOf(host, flavor === 'test')));
}

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
  const optionalApi = optionalPermissions(hosts);
  return {
    name: test ? `${EXTENSION_NAME} (тест)` : EXTENSION_NAME,
    description: EXTENSION_DESCRIPTION,
    permissions: [...PERMISSIONS],
    host_permissions: hostPermissions(flavor, hosts),
    optional_host_permissions: optionalHostPermissions(hosts),
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
 * exactly the lazy chunks (+ their CSS) for the sites' pages; in a test build
 * every content script also matches its site's loopback stand. A content
 * script no site of the registry declares fails the build.
 */
export function finalizeManifest(manifest: ManifestLike, options: { flavor: BuildFlavor; lazyFiles: readonly string[]; hosts?: readonly HostDescriptor[] }): void {
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
  if (options.lazyFiles.length > 0) {
    manifest.web_accessible_resources = [{ resources: [...options.lazyFiles].sort(), matches: lazyChunkMatches(options.flavor, hosts) }];
  }
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
  const expectedOptionalHosts = optionalHostPermissions(hosts);
  if (!sameSet(manifest['optional_host_permissions'], expectedOptionalHosts)) {
    fail(`optional_host_permissions must be exactly ${expectedOptionalHosts.join(', ')}`);
  }
  const expectedOptionalApi = optionalPermissions(hosts);
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

  const war = asArray(manifest['web_accessible_resources']) as Array<Record<string, unknown>>;
  const warMatches = lazyChunkMatches(flavor, hosts);
  if (war.length !== 1) fail('web_accessible_resources must be one entry with the lazy chunks');
  for (const entry of war) {
    const resources = asArray(entry['resources']);
    if (resources.length === 0) fail('web_accessible_resources lists no lazy chunks');
    for (const resource of resources) {
      if (typeof resource !== 'string' || !/^lazy\/.+\.(js|css)$/.test(resource)) {
        fail(`web_accessible_resources may list only lazy chunks and their CSS, got ${String(resource)}`);
      }
    }
    if (!sameSet(entry['matches'], warMatches)) fail(`web_accessible_resources matches must be exactly ${warMatches.join(', ')}`);
    if ('use_dynamic_url' in entry) fail('use_dynamic_url is Chrome-only');
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
