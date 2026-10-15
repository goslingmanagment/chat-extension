// The host registry (docs/project-unite/architecture.md §1.2): its entries
// agree with the runtime table, every script it declares has its entry point,
// the background's own wiring of ChatSpace is the registry's, and a second
// site is an entry of the registry — the manifest grows by that site's part
// only, ChatSpace's part stays as it is.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { HOST_PLATFORM } from '@cg/contracts/hosts';
import { describe, expect, it } from 'vitest';

import { baseManifest, checkManifest, finalizeManifest, hostPermissions, lazyBuildsWithFiles, optionalHostPermissions, optionalPermissions, type BuildFlavor, type ManifestLike } from '../build/manifest.ts';
import { BEFORE_THE_DOCK, LAZY_ENTRIES, LAZY_LAYERS } from '../lazy/entries/names.ts';
import { HOST_MODULE_SPECS, HOST_REQUESTS, wsTapSpec } from '../src/composition/background.ts';
import { CHATSPACE } from '../src/hosts/chatspace.ts';
import { FANSLY } from '../src/hosts/fansly.ts';
import { HOSTS, hostOf, lazySitesOf, pageMatchesOf, scriptsOf, type HostDescriptor } from '../src/hosts/index.ts';
import { CHATSPACE_LAZY_ROOT } from '../src/hosts/runtime/chatspace.ts';
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
  lazy: { root: 'lazy/site', entries: { dock: 'site/dock.ts', notes: 'site/notes.ts' }, layers: ['dock'], beforeTheDock: [] },
  permissions: { origins: ['https://site.example.test/*', 'https://api.site.example.test/*'], optional: true, api: ['webRequest'] },
  mainWorldSources: ['packages/host-site/src/main/'],
  budgets: {
    scripts: [
      { entry: 'site-main', label: 'MAIN (site-main)', gzipBytes: 16 * 1024 },
      { entry: 'site', label: 'isolated (site)', gzipBytes: 30 * 1024 },
      { entry: 'site-notice', label: 'notice (site-notice)', gzipBytes: 2 * 1024 },
    ],
    contracts: [],
  },
  contractCheck: { module: 'packages/host-site/src/isolated/host-contract.ts', bundlesRootEnv: 'CG_SITE_BUNDLES' },
  archiveMarkers: { code: [], libraries: [] },
  test: { pageMatches: ['http://localhost/*'] },
};

/** A built file of every entry of every lazy build of the flavor, as the build's chunk list names them. */
const lazyChunksOf = (flavor: BuildFlavor, hosts: readonly HostDescriptor[]): Array<{ file: string; site: string }> =>
  lazySitesOf(flavor === 'test', hosts).flatMap((site) => Object.keys(site.build.entries).map((entry) => ({ file: `${site.build.root}/${entry}.js`, site: site.site })));

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
  finalizeManifest(manifest, { flavor, lazyChunks: lazyChunksOf(flavor, hosts), hosts });
  return manifest;
}

describe('the host registry', () => {
  it('has ChatSpace and Fansly, their addresses from their runtime rows; every row of the runtime table has its entry', () => {
    expect(HOSTS.map((host) => host.kind)).toEqual(['chatspace', 'fansly-web']);
    expect(hostOf('chatspace')).toBe(CHATSPACE);
    expect(hostOf('fansly-web')).toBe(FANSLY);
    // Fansly's row joins the table — what the background core and the pages read — with its tabs (R20 P7i).
    expect(Object.keys(RUNTIME_HOSTS)).toEqual(['chatspace']);
    for (const kind of Object.keys(RUNTIME_HOSTS)) {
      const row = RUNTIME_HOSTS[kind as keyof typeof RUNTIME_HOSTS];
      const host = hostOf(kind);
      expect({ matches: host?.matches, quietDomains: host?.quietDomains }).toEqual(row);
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

  it('ChatSpace’s lazy build is today’s plan under its own folder, the one its tab loads from (R20 F2b; the adapter: test/lazy.test.ts)', () => {
    expect(CHATSPACE.lazy).toEqual({ root: 'lazy/chatspace', entries: LAZY_ENTRIES, layers: LAZY_LAYERS, beforeTheDock: BEFORE_THE_DOCK });
    expect(CHATSPACE.lazy.root).toBe(CHATSPACE_LAZY_ROOT);
    for (const layer of CHATSPACE.lazy.layers) expect(Object.keys(CHATSPACE.lazy.entries)).toContain(layer);
    for (const layer of CHATSPACE.lazy.beforeTheDock) expect(CHATSPACE.lazy.layers).toContain(layer);
  });

  it('every flavor has every site’s lazy build, in the registry’s order, each for its own pages — in a test build its stand too (R20 F2b, P7a0)', () => {
    expect(lazySitesOf(false).map((site) => [site.site, site.build.root, site.matches])).toEqual([
      ['chatspace', 'lazy/chatspace', ['https://chat.onlymonster.ai/*']],
      ['fansly-web', 'lazy/fansly', ['https://fansly.com/*']],
    ]);
    // Each stand on a loopback name of its own: ChatSpace's stand (127.0.0.1) cannot load Fansly's files.
    expect(lazySitesOf(true).map((site) => [site.site, site.matches])).toEqual([
      ['chatspace', ['https://chat.onlymonster.ai/*', 'http://127.0.0.1/*']],
      ['fansly-web', ['https://fansly.com/*', 'http://localhost/*']],
    ]);
    // A registry of one site has one build, in a test build too.
    expect(lazySitesOf(true, [CHATSPACE]).map((site) => site.site)).toEqual(['chatspace']);
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
    expect(optionalHostPermissions('release', both)).toEqual([...optionalHostPermissions('release', [CHATSPACE]), 'https://site.example.test/*', 'https://api.site.example.test/*']);
    expect(optionalPermissions('release', [CHATSPACE])).toEqual([]);
    expect(optionalPermissions('release', both)).toEqual(['webRequest']);
    // In a test build its stand is optional too, as its pages are: nothing of it granted at install.
    expect(optionalHostPermissions('test', both)).toEqual(['https://*/*', 'https://site.example.test/*', 'https://api.site.example.test/*', 'http://localhost/*']);
    expect(hostPermissions('test', both)).not.toContain('http://localhost/*');
    expect(baseManifest('release', [CHATSPACE])).not.toHaveProperty('optional_permissions');
    // Each site's lazy build is exposed to its own pages alone.
    expect(generated('release', both)['web_accessible_resources']).toEqual([
      { resources: Object.keys(LAZY_ENTRIES).map((entry) => `lazy/chatspace/${entry}.js`).sort(), matches: ['https://chat.onlymonster.ai/*'] },
      { resources: ['lazy/site/dock.js', 'lazy/site/notes.js'], matches: ['https://site.example.test/*'] },
    ]);
    expect(lazyBuildsWithFiles('test', both).map((site) => [site.site, site.matches])).toEqual([
      // In a test build each site's stand too — a loopback name of its own each (R20 P6a).
      ['chatspace', ['https://chat.onlymonster.ai/*', 'http://127.0.0.1/*']],
      ['fansly-web', ['https://site.example.test/*', 'http://localhost/*']],
    ]);
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
    expect(() => finalizeManifest({ content_scripts: [{ matches: [], js: ['content-scripts/unknown.js'] }] }, { flavor: 'release', lazyChunks: [] })).toThrow(/declared by no site of the host registry/);
  });

  it('a site’s lazy files are its own web resource entry, for its own pages: mixed, shared or another site’s pages are refused', () => {
    const war = (manifest: Record<string, unknown>): Array<{ resources: string[]; matches: string[] }> => manifest['web_accessible_resources'] as Array<{ resources: string[]; matches: string[] }>;
    const merged = generated('release', both);
    merged['web_accessible_resources'] = [{ resources: war(merged).flatMap((entry) => entry.resources), matches: war(merged).flatMap((entry) => entry.matches) }];
    expect(checkManifest(merged, 'release', both)).toEqual(expect.arrayContaining([expect.stringMatching(/^web_accessible_resources must be one entry per lazy build/), expect.stringMatching(/^a web_accessible_resources entry must list the files of exactly one lazy build/)]));
    const swapped = generated('release', both);
    const [first, second] = war(swapped);
    if (first === undefined || second === undefined) throw new Error('two entries');
    [first.matches, second.matches] = [second.matches, first.matches];
    expect(checkManifest(swapped, 'release', both)).toEqual([
      'web_accessible_resources of lazy/chatspace must match exactly https://chat.onlymonster.ai/*',
      'web_accessible_resources of lazy/site must match exactly https://site.example.test/*',
    ]);
    const missing = generated('release', both);
    missing['web_accessible_resources'] = war(missing).slice(0, 1);
    expect(checkManifest(missing, 'release', both)).toEqual(expect.arrayContaining(['the lazy build lazy/site must be exactly one web_accessible_resources entry, got 0']));
    // A lazy file of no build of this flavor fails the build.
    expect(() => finalizeManifest({}, { flavor: 'release', lazyChunks: [{ file: 'lazy/second-site/empty.js', site: 'second-site' }] })).toThrow(/lazy file lazy\/second-site\/empty\.js is of no lazy build/);
    expect(() => finalizeManifest({}, { flavor: 'release', lazyChunks: [{ file: 'lazy/dock.js', site: 'chatspace' }] })).toThrow(/lazy file lazy\/dock\.js is of no lazy build/);
  });

  it('a release manifest carrying a site’s test stand is refused', () => {
    const manifest = generated('release', both);
    manifest['host_permissions'] = [...(manifest['host_permissions'] as string[]), 'http://localhost/*'];
    expect(checkManifest(manifest, 'release', both)).toEqual(expect.arrayContaining(['release manifest must not carry the fansly-web test stand http://localhost/*']));
  });
});

describe('the sites’ stands in a test build (R20 P6a, architecture.md §13)', () => {
  const test = generated('test', HOSTS);

  it('each has a loopback name of its own: no stand address matches two sites', () => {
    const hostname = (pattern: string): string => new URL(pattern.replace('*', '')).hostname;
    expect(HOSTS.map((host) => [host.kind, host.test.pageMatches.map(hostname)])).toEqual([
      ['chatspace', ['127.0.0.1']],
      ['fansly-web', ['localhost']],
    ]);
  });

  it('an optional site’s stand is optional too, with its API permission — nothing of it granted at install; a required site’s stand is granted', () => {
    expect(test['optional_host_permissions']).toEqual(['https://*/*', 'https://fansly.com/*', 'https://apiv3.fansly.com/*', 'http://localhost/*']);
    expect(test['optional_permissions']).toEqual(['webRequest']);
    expect(test['host_permissions']).toEqual(['https://chat.onlymonster.ai/*', 'https://gosling-agency.ru/*', 'http://127.0.0.1/*']);
    // ChatSpace's scripts run on ChatSpace's stand only, never on the Fansly stand; Fansly has none in the manifest.
    for (const script of test['content_scripts'] as Array<{ matches: string[] }>) expect(script.matches).toEqual(['https://chat.onlymonster.ai/*', 'http://127.0.0.1/*']);
    expect(checkManifest(test, 'test')).toEqual([]);
  });

  it('a release build carries none of them', () => {
    const release = generated('release', HOSTS);
    expect(release['optional_host_permissions']).toEqual(['https://*/*', 'https://fansly.com/*', 'https://apiv3.fansly.com/*']);
    expect(JSON.stringify(release)).not.toMatch(/localhost|127\.0\.0\.1/);
    expect(checkManifest(release, 'release')).toEqual([]);
  });

  it('the policy refuses an origin granted at install and optional at once', () => {
    const manifest = structuredClone(test);
    manifest['host_permissions'] = [...(manifest['host_permissions'] as string[]), 'http://localhost/*'];
    expect(checkManifest(manifest, 'test')).toEqual(expect.arrayContaining(['http://localhost/* is both granted at install and optional']));
  });
});
