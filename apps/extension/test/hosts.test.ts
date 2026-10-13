// The host registry (docs/project-unite/architecture.md §1.2): its entries
// agree with the runtime table, every script it declares has its entry point,
// the background's own wiring of ChatSpace is the registry's, and a second
// site is an entry of the registry — the manifest grows by that site's part
// only, ChatSpace's part stays as it is.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { HOST_PLATFORM } from '@cg/contracts/hosts';
import { describe, expect, it } from 'vitest';

import { baseManifest, checkManifest, finalizeManifest, hostPermissions, lazyChunkMatches, optionalHostPermissions, optionalPermissions, type BuildFlavor, type ManifestLike } from '../build/manifest.ts';
import { HOST_MODULE_SPECS, HOST_REQUESTS, wsTapSpec } from '../src/composition/background.ts';
import { CHATSPACE } from '../src/hosts/chatspace.ts';
import { HOSTS, hostOf, pageMatchesOf, scriptsOf, type HostDescriptor } from '../src/hosts/index.ts';
import { RUNTIME_HOSTS, isQuietHost } from '../src/hosts/runtime/index.ts';

const entrypoints = fileURLToPath(new URL('../src/entrypoints/', import.meta.url));

/** A second site as a later PR would add it: optional permissions, scripts the background registers, its own stand. */
const SECOND: HostDescriptor = {
  kind: 'fansly-web',
  platform: 'fansly',
  matches: ['https://site.example.test/*'],
  quietDomains: [],
  scripts: {
    main: { entry: 'site-main', file: 'content-scripts/site-main.js', world: 'MAIN', registration: 'dynamic' },
    isolated: { entry: 'site', file: 'content-scripts/site.js', world: 'ISOLATED', registration: 'dynamic' },
    notice: { entry: 'site-notice', file: 'site-notice.js', world: 'ISOLATED', registration: 'execute' },
  },
  permissions: { origins: ['https://site.example.test/*', 'https://api.site.example.test/*'], optional: true, api: ['webRequest'] },
  mainWorldSources: ['packages/host-site/src/main/'],
  budgets: {
    scripts: [
      { entry: 'site-main', label: 'MAIN (site-main)', gzipBytes: 16 * 1024 },
      { entry: 'site', label: 'isolated (site)', gzipBytes: 30 * 1024 },
      { entry: 'site-notice', label: 'notice (site-notice)', gzipBytes: 2 * 1024 },
    ],
  },
  contractCheck: { module: 'packages/host-site/src/isolated/host-contract.ts', bundlesRootEnv: 'CG_SITE_BUNDLES' },
  archiveMarkers: { code: [], libraries: [] },
  test: { pageMatches: ['http://localhost/*'] },
};

/** What WXT generates from the registry's manifest scripts, then finalized as the build does. */
function generated(flavor: BuildFlavor, hosts: readonly HostDescriptor[]): Record<string, unknown> {
  const manifest: ManifestLike = {
    manifest_version: 3,
    ...baseManifest(flavor, hosts),
    background: { scripts: ['background.js'] },
    action: { default_popup: 'popup.html' },
    options_ui: { open_in_tab: true, page: 'options.html' },
    content_scripts: hosts.flatMap((host) =>
      scriptsOf(host)
        .filter((script) => script.registration === 'manifest')
        .map((script) => ({ matches: [...host.matches], all_frames: false, run_at: 'document_start', js: [script.file], ...(script.world === 'MAIN' ? { world: 'MAIN' } : {}) })),
    ),
  };
  finalizeManifest(manifest, { flavor, lazyFiles: ['lazy/dock.js'], hosts });
  return manifest;
}

describe('the host registry', () => {
  it('has ChatSpace, its addresses from its runtime row; every row of the runtime table has its entry', () => {
    expect(HOSTS.map((host) => host.kind)).toEqual(['chatspace']);
    expect(hostOf('chatspace')).toBe(CHATSPACE);
    expect(hostOf('fansly-web')).toBeUndefined();
    expect(Object.keys(RUNTIME_HOSTS).sort()).toEqual(HOSTS.map((host) => host.kind).sort());
    for (const host of HOSTS) {
      const row = RUNTIME_HOSTS[host.kind as keyof typeof RUNTIME_HOSTS];
      expect({ matches: host.matches, quietDomains: host.quietDomains }).toEqual(row);
    }
    expect(CHATSPACE.permissions).toEqual({ origins: ['https://chat.onlymonster.ai/*'], optional: false });
  });

  it('each site names the platform the contracts pair it with (HOST_PLATFORM, P4a1)', () => {
    for (const host of [...HOSTS, SECOND]) expect(host.platform).toBe(HOST_PLATFORM[host.kind]);
  });

  it('every script has its WXT entry point; entries and files are unique across the sites', () => {
    const scripts = HOSTS.flatMap(scriptsOf);
    for (const script of scripts) {
      const files = script.registration === 'manifest' ? [`${script.entry}.content.ts`] : [`${script.entry}.ts`, `${script.entry}.content.ts`];
      expect(files.some((file) => existsSync(`${entrypoints}${file}`)), script.entry).toBe(true);
    }
    expect(new Set(scripts.map((script) => script.entry)).size).toBe(scripts.length);
    expect(new Set(scripts.map((script) => script.file)).size).toBe(scripts.length);
  });

  it('quiet mode covers exactly the quiet domains of the table (X3): ChatSpace’s, subdomains included', () => {
    const quiet = Object.values(RUNTIME_HOSTS).flatMap((row) => row.quietDomains);
    expect(quiet).toEqual(['onlymonster.ai']);
    for (const domain of quiet) {
      expect(isQuietHost(`https://${domain}/x`)).toBe(true);
      expect(isQuietHost(`https://api.${domain}/x`)).toBe(true);
    }
    for (const pattern of SECOND.matches) expect(isQuietHost(pattern.replace('*', 'api/v1'))).toBe(false);
  });

  it('the background registers ChatSpace’s dynamic MAIN script of the registry (the WS tap) on its pages', () => {
    const tap = scriptsOf(CHATSPACE).filter((script) => script.registration === 'dynamic');
    expect(tap.map((script) => [script.file, script.world])).toEqual([['chatspace-ws.js', 'MAIN']]);
    // A release build here (vitest defines __CG_TEST_HOSTS__ false): ChatSpace's pages only.
    const spec = wsTapSpec();
    expect(spec.js).toEqual(tap.map((script) => script.file));
    expect(spec.matches).toEqual(pageMatchesOf(CHATSPACE, false));
  });

  it('[R20-F1] the background loads each site’s chunk of the registry, and only those; each site with a chunk routes its own requests to it', () => {
    const withChunk = HOSTS.filter((host) => host.background !== undefined);
    expect(withChunk.map((host) => host.kind)).toEqual(['chatspace']);
    expect(Object.fromEntries(Object.entries(HOST_MODULE_SPECS).map(([kind, spec]) => [kind, spec.chunk]))).toEqual(Object.fromEntries(withChunk.map((host) => [host.kind, host.background?.file])));
    for (const host of withChunk) {
      expect(host.background?.file).toMatch(/^bg\/[a-z-]+\.js$/);
      expect(existsSync(fileURLToPath(new URL(`../${host.background?.source ?? ''}`, import.meta.url)))).toBe(true);
    }
    // ChatSpace's own requests: X8 and the greeting leases of «Новые» — nothing a second site shares.
    expect([...HOST_REQUESTS.chatspace].sort()).toEqual(['newcomers.claim', 'send.begin', 'send.fuse', 'send.fuseReset', 'send.fuseState', 'send.list', 'send.report', 'send.status']);
  });
});

describe('a second site is an entry of the registry', () => {
  const both = [CHATSPACE, SECOND];

  it('ChatSpace alone: the generated manifest passes the policy in both flavors', () => {
    expect(checkManifest(generated('release', [CHATSPACE]), 'release', [CHATSPACE])).toEqual([]);
    expect(checkManifest(generated('test', [CHATSPACE]), 'test', [CHATSPACE])).toEqual([]);
  });

  it('adds only its own part: optional origins and API, nothing granted at install, no manifest script', () => {
    for (const flavor of ['release', 'test'] as const) {
      expect(hostPermissions(flavor, both)).toEqual(hostPermissions(flavor, [CHATSPACE]));
      expect(checkManifest(generated(flavor, both), flavor, both)).toEqual([]);
    }
    expect(optionalHostPermissions(both)).toEqual([...optionalHostPermissions([CHATSPACE]), 'https://site.example.test/*', 'https://api.site.example.test/*']);
    expect(optionalPermissions([CHATSPACE])).toEqual([]);
    expect(optionalPermissions(both)).toEqual(['webRequest']);
    expect(baseManifest('release', [CHATSPACE])).not.toHaveProperty('optional_permissions');
    expect(lazyChunkMatches('release', both)).toEqual(['https://chat.onlymonster.ai/*', 'https://site.example.test/*']);
    // ChatSpace's content scripts are the same in both registries.
    expect(generated('release', both)['content_scripts']).toEqual(generated('release', [CHATSPACE])['content_scripts']);
    expect(generated('test', both)['content_scripts']).toEqual(generated('test', [CHATSPACE])['content_scripts']);
  });

  it('the policy of one registry refuses the manifest of the other', () => {
    expect(checkManifest(generated('release', [CHATSPACE]), 'release', both)).toEqual(expect.arrayContaining([expect.stringMatching(/^optional_host_permissions must be exactly/), expect.stringMatching(/^optional_permissions must be exactly webRequest/)]));
    expect(checkManifest(generated('release', both), 'release', [CHATSPACE])).toEqual(expect.arrayContaining([expect.stringMatching(/^no optional_permissions/)]));
  });

  it('a site’s script in the manifest that the registry has the background register is refused; a content script of no site fails the build', () => {
    const manifest = generated('release', [CHATSPACE]);
    (manifest['content_scripts'] as Array<Record<string, unknown>>).push({ matches: ['https://chat.onlymonster.ai/*'], all_frames: false, run_at: 'document_start', js: ['chatspace-ws.js'], world: 'MAIN' });
    expect(checkManifest(manifest, 'release')).toEqual(expect.arrayContaining([expect.stringMatching(/^exactly 2 manifest content scripts/), 'chatspace-ws.js must not be a manifest content script (registration: dynamic)']));
    expect(() => finalizeManifest({ content_scripts: [{ matches: [], js: ['content-scripts/unknown.js'] }] }, { flavor: 'release', lazyFiles: [] })).toThrow(/declared by no site of the host registry/);
  });

  it('a release manifest carrying a site’s test stand is refused', () => {
    const manifest = generated('release', both);
    manifest['host_permissions'] = [...(manifest['host_permissions'] as string[]), 'http://localhost/*'];
    expect(checkManifest(manifest, 'release', both)).toEqual(expect.arrayContaining(['release manifest must not carry the fansly-web test stand http://localhost/*']));
  });
});
