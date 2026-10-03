// The extension manifest policy (architecture.md §3 «Манифест», D-01, D-32).
// Pure functions: wxt.config.ts applies them, the manifest test and
// tools/gates check the built manifest with checkManifest().
//
// Relative imports carry `.ts`: this file also runs under plain Node 26
// (tools/gates), which strips types but does not guess extensions.

import type { UserManifest } from 'wxt';

import { CHATSPACE_MATCHES, CUSTOM_HUB_OPTIONAL_PERMISSION, HUB_HOST_PERMISSION, LOOPBACK_MATCHES } from '../src/hosts.ts';

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

/** The static part handed to WXT; entry points add background, content scripts and pages. */
export function baseManifest(flavor: BuildFlavor): UserManifest {
  const test = flavor === 'test';
  return {
    name: test ? `${EXTENSION_NAME} (тест)` : EXTENSION_NAME,
    description: EXTENSION_DESCRIPTION,
    permissions: [...PERMISSIONS],
    host_permissions: [...CHATSPACE_MATCHES, HUB_HOST_PERMISSION, ...(test ? LOOPBACK_MATCHES : [])],
    optional_host_permissions: [CUSTOM_HUB_OPTIONAL_PERMISSION],
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
  content_scripts?: Array<{ matches?: string[]; [key: string]: unknown }>;
  web_accessible_resources?: unknown;
}

/**
 * Applied in WXT's build:manifestGenerated hook: web_accessible_resources =
 * exactly the lazy chunks (+ their CSS) for the content-script origins; in a
 * test build the content scripts also match the loopback stand.
 */
export function finalizeManifest(manifest: ManifestLike, options: { flavor: BuildFlavor; lazyFiles: readonly string[] }): void {
  const test = options.flavor === 'test';
  const origins = [...CHATSPACE_MATCHES, ...(test ? LOOPBACK_MATCHES : [])];
  for (const script of manifest.content_scripts ?? []) {
    script.matches = [...new Set([...(script.matches ?? []), ...origins])];
  }
  if (manifest.web_accessible_resources !== undefined) {
    throw new Error('finalizeManifest: unexpected web_accessible_resources from WXT; only lazy chunks may be exposed');
  }
  if (options.lazyFiles.length > 0) {
    manifest.web_accessible_resources = [{ resources: [...options.lazyFiles].sort(), matches: origins }];
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

/** Every rule of §3 «Манифест». Returns human-readable problems; [] means OK. */
export function checkManifest(manifest: Record<string, unknown>, flavor: BuildFlavor): string[] {
  const problems: string[] = [];
  const fail = (message: string): void => {
    problems.push(message);
  };
  const test = flavor === 'test';
  const origins = [...CHATSPACE_MATCHES, ...(test ? LOOPBACK_MATCHES : [])];

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
  const hostPermissions = [...CHATSPACE_MATCHES, HUB_HOST_PERMISSION, ...(test ? LOOPBACK_MATCHES : [])];
  if (!sameSet(manifest['host_permissions'], hostPermissions)) fail(`host_permissions must be exactly ${hostPermissions.join(', ')}`);
  if (!sameSet(manifest['optional_host_permissions'], [CUSTOM_HUB_OPTIONAL_PERMISSION])) {
    fail(`optional_host_permissions must be exactly ${CUSTOM_HUB_OPTIONAL_PERMISSION}`);
  }

  const background = manifest['background'] as Record<string, unknown> | undefined;
  if (!background || !Array.isArray(background['scripts']) || background['scripts'].length !== 1) {
    fail('background must be an event page with exactly one background.scripts entry');
  }
  if (background && 'service_worker' in background) fail('background.service_worker is not allowed (D-01)');
  if (background && background['persistent'] === true) fail('background must not be persistent');

  const scripts = asArray(manifest['content_scripts']) as Array<Record<string, unknown>>;
  if (scripts.length !== 2) fail('exactly two manifest content scripts (MAIN bridge + isolated); the WS tap is dynamic');
  const mainScript = scripts.find((script) => script['world'] === 'MAIN');
  const isolatedScript = scripts.find((script) => script['world'] === undefined || script['world'] === 'ISOLATED');
  for (const [label, script, file] of [
    ['MAIN', mainScript, 'content-scripts/chatspace-main.js'],
    ['isolated', isolatedScript, 'content-scripts/chatspace.js'],
  ] as const) {
    if (!script) {
      fail(`${label} content script missing`);
      continue;
    }
    if (!sameSet(script['js'], [file])) fail(`${label} content script must load only ${file}`);
    if (script['run_at'] !== 'document_start') fail(`${label} content script must run at document_start`);
    if (script['all_frames'] !== false) fail(`${label} content script must set all_frames: false`);
    if (!sameSet(script['matches'], origins)) fail(`${label} content script matches must be exactly ${origins.join(', ')}`);
    if (script['css'] !== undefined) fail(`${label} content script must not inject CSS (styles live in our shadow roots)`);
  }
  if (JSON.stringify(scripts).includes('chatspace-ws')) fail('the WS tap must not be a manifest content script');

  const war = asArray(manifest['web_accessible_resources']) as Array<Record<string, unknown>>;
  if (war.length !== 1) fail('web_accessible_resources must be one entry with the lazy chunks');
  for (const entry of war) {
    const resources = asArray(entry['resources']);
    if (resources.length === 0) fail('web_accessible_resources lists no lazy chunks');
    for (const resource of resources) {
      if (typeof resource !== 'string' || !/^lazy\/.+\.(js|css)$/.test(resource)) {
        fail(`web_accessible_resources may list only lazy chunks and their CSS, got ${String(resource)}`);
      }
    }
    if (!sameSet(entry['matches'], origins)) fail(`web_accessible_resources matches must be exactly ${origins.join(', ')}`);
    if ('use_dynamic_url' in entry) fail('use_dynamic_url is Chrome-only');
  }

  const action = manifest['action'] as Record<string, unknown> | undefined;
  if (typeof action?.['default_popup'] !== 'string') fail('action.default_popup (popup page) missing');
  const options = manifest['options_ui'] as Record<string, unknown> | undefined;
  if (typeof options?.['page'] !== 'string' || options['open_in_tab'] !== true) fail('options_ui with open_in_tab: true missing');
  if (manifest['content_security_policy'] !== undefined) fail('content_security_policy must stay the MV3 default');
  if (manifest['commands'] !== undefined) fail('no manifest commands (hotkeys live in the early dispatcher, §9.1)');

  if (!test && LOOPBACK_RE.test(JSON.stringify(manifest))) fail('release manifest must not mention loopback stand/fake hub hosts');
  if (!test && JSON.stringify(manifest).includes(TEST_GECKO_ID)) fail('release manifest must not carry the test gecko id');
  return problems;
}
