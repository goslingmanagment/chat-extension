// Fansly's entry in the host registry and what it makes of the build (R20 P7a0;
// docs/project-unite/architecture.md §1.2, §3.1, §4): its two scripts, which
// the background registers and no manifest ever declares; its own lazy build,
// a web resource for its own pages alone; its optional permissions; its stand;
// its budget lines; the early half of its adapter, assembled in its entry
// point. The built manifest of both flavors: manifest.test.ts; the scripts on
// the stand in Firefox: packages/testing/e2e/specs/suite-fansly-site.e2e.ts.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { HOST_PLATFORM } from '@cg/contracts/hosts';
import type { LazyEntryName } from '../lazy/entries/names.ts';
import { describe, expect, it } from 'vitest';

import { baseManifest, checkManifest, finalizeManifest, type BuildFlavor, type ManifestLike } from '../build/manifest.ts';
import { BEFORE_THE_DOCK, LAZY_ENTRIES, LAZY_LAYERS } from '../lazy/entries/names.ts';
import { FANSLY_APP, FANSLY_UI } from '../src/composition/tab/hosts/fansly/app.ts';
import { LAZY as TAB_LAZY } from '../src/composition/tab/runtime.ts';
import { lazyPath } from '../src/composition/tab/lazy.ts';
import { FANSLY_ADAPTER } from '../src/entrypoints/fansly.ts';
import { CHATSPACE } from '../src/hosts/chatspace.ts';
import { FANSLY, FANSLY_TEST } from '../src/hosts/fansly.ts';
import { HOSTS, lazySitesOf, pageMatchesOf, scriptsOf } from '../src/hosts/index.ts';
import { FANSLY_LAZY_ROOT, FANSLY_MATCHES } from '../src/hosts/runtime/fansly.ts';
import { FANSLY_STAND_MATCHES, RUNTIME_HOSTS } from '../src/hosts/runtime/index.ts';

const entrypoints = fileURLToPath(new URL('../src/entrypoints/', import.meta.url));
const lazyRoot = fileURLToPath(new URL('../lazy/', import.meta.url));

/** The manifest of a flavor as the build makes it from the registry (build/manifest.ts), with every lazy entry built. */
function manifestOf(flavor: BuildFlavor): Record<string, unknown> {
  const manifest: ManifestLike = {
    manifest_version: 3,
    ...baseManifest(flavor),
    background: { scripts: ['background.js'] },
    action: { default_popup: 'popup.html' },
    options_ui: { open_in_tab: true, page: 'options.html' },
    content_scripts: HOSTS.flatMap((host) =>
      scriptsOf(host)
        .filter((script) => script.registration === 'manifest')
        .map((script) => ({ matches: [...host.matches], all_frames: false, run_at: 'document_start', js: [script.file], ...(script.world === 'MAIN' ? { world: 'MAIN' } : {}) })),
    ),
  };
  const lazyChunks = lazySitesOf(flavor === 'test').flatMap((site) => Object.keys(site.build.entries).map((entry) => ({ file: `${site.build.root}/${entry}.js`, site: site.site })));
  finalizeManifest(manifest, { flavor, lazyChunks });
  return manifest;
}

describe('[host:fansly] Fansly in the host registry (R20 P7a0)', () => {
  it('[host:fansly] is the second site: fansly-web on fansly, its pages from its runtime row, not quiet; the row joins the table for the permission handshake (P9a)', () => {
    expect([FANSLY.kind, FANSLY.platform]).toEqual(['fansly-web', HOST_PLATFORM['fansly-web']]);
    expect(FANSLY.matches).toBe(FANSLY_MATCHES);
    expect(FANSLY.matches).toEqual(['https://fansly.com/*']);
    expect(FANSLY.quietDomains).toEqual([]);
    expect(Object.keys(RUNTIME_HOSTS)).toContain('fansly-web');
    expect(FANSLY.test).toBe(FANSLY_TEST);
    expect(FANSLY_TEST.pageMatches).toEqual(FANSLY_STAND_MATCHES);
    expect(FANSLY.background?.file).toBe('bg/fansly.js');
  });

  it('[host:fansly] has MAIN and ISOLATED registrations plus the injected notice, all with their budget lines (§3.1)', () => {
    expect(scriptsOf(FANSLY).map((script) => [script.entry, script.file, script.world, script.registration])).toEqual([
      ['fansly-main', 'fansly-main.js', 'MAIN', 'dynamic'],
      ['fansly', 'fansly.js', 'ISOLATED', 'dynamic'],
      ['fansly-notice', 'fansly-notice.js', 'ISOLATED', 'execute'],
    ]);
    for (const script of scriptsOf(FANSLY)) expect(existsSync(`${entrypoints}${script.entry}.ts`), script.entry).toBe(true);
    expect(FANSLY.budgets.scripts.map((line) => [line.entry, line.gzipBytes])).toEqual([
      ['fansly-main', 16 * 1024],
      ['fansly', 31 * 1024],
      ['fansly-notice', 2 * 1024],
    ]);
    expect(FANSLY.mainWorldSources).toEqual(['packages/host-fansly/src/main/']);
  });

  it('[host:fansly] asks for its pages, its API and webRequest on request only — granted at install never, in either flavor (§4, А12)', () => {
    expect(FANSLY.permissions).toEqual({ origins: ['https://fansly.com/*', 'https://apiv3.fansly.com/*'], optional: true, api: ['webRequest'] });
    for (const flavor of ['release', 'test'] as const) {
      const manifest = manifestOf(flavor);
      expect(checkManifest(manifest, flavor)).toEqual([]);
      const granted = JSON.stringify([manifest['host_permissions'], manifest['content_scripts']]);
      for (const pattern of [...FANSLY.permissions.origins, ...FANSLY_STAND_MATCHES]) expect(granted, `${flavor}: ${pattern}`).not.toContain(pattern.replace('/*', ''));
      expect(manifest['optional_host_permissions']).toEqual(expect.arrayContaining(FANSLY.permissions.origins as string[]));
      expect(manifest['optional_permissions']).toEqual(['webRequest']);
    }
    expect(manifestOf('test')['optional_host_permissions']).toEqual(expect.arrayContaining(['http://localhost/*']));
    expect(manifestOf('release')['optional_host_permissions']).not.toEqual(expect.arrayContaining(['http://localhost/*']));
  });

  it('[EX-010] [host:fansly] its lazy build is its own web resource entry, for its own pages — the stand too in a test build; ChatSpace’s stays ChatSpace’s', () => {
    expect([FANSLY.lazy.root, FANSLY.lazy.layers, FANSLY.lazy.beforeTheDock]).toEqual(['lazy/fansly', LAZY_LAYERS, BEFORE_THE_DOCK]);
    for (const source of Object.values(FANSLY.lazy.entries)) expect(existsSync(`${lazyRoot}${source}`), source).toBe(true);
    const war = (flavor: BuildFlavor): Array<{ resources: string[]; matches: string[] }> => manifestOf(flavor)['web_accessible_resources'] as Array<{ resources: string[]; matches: string[] }>;
    for (const flavor of ['release', 'test'] as const) {
      const [chatspace, fansly] = war(flavor);
      expect(fansly).toEqual({ resources: Object.keys(FANSLY.lazy.entries).map((entry) => `lazy/fansly/${entry}.js`).sort(), matches: pageMatchesOf(FANSLY, flavor === 'test') });
      expect(chatspace?.matches).toEqual(pageMatchesOf(CHATSPACE, flavor === 'test'));
      expect(chatspace?.resources.every((resource) => resource.startsWith('lazy/chatspace/'))).toBe(true);
    }
    expect(war('test')[1]?.matches).toEqual(['https://fansly.com/*', 'http://localhost/*']);
  });

  it('[host:fansly] its build carries the application (R20 P7d): the tab’s two chunks, every layer, the texts — Fansly’s own `tab-app` and texts, the shared rest; nothing of ChatSpace’s alone', () => {
    const entries = FANSLY.lazy.entries;
    for (const name of [...Object.values(TAB_LAZY), ...LAZY_LAYERS, 'i18n-ru', 'i18n-en', 'ai-analysis', 'ai-coach', 'tab-health']) expect(Object.keys(entries), name).toContain(name);
    // Every entry name is one the tab asks for by name; its source is Fansly's own or the shared entry of that name.
    for (const [name, source] of Object.entries(entries)) {
      expect(Object.keys(LAZY_ENTRIES), name).toContain(name);
      expect([`fansly/${name}.ts`, LAZY_ENTRIES[name as LazyEntryName]], name).toContain(source);
    }
    expect([entries['tab-app'], entries['bridge-validation'], entries['i18n-ru'], entries['i18n-en']]).toEqual(['fansly/tab-app.ts', 'fansly/bridge-validation.ts', 'fansly/i18n-ru.ts', 'fansly/i18n-en.ts']);
    for (const only of ['palette', 'preview', 'newcomers']) expect(Object.keys(entries), only).not.toContain(only);
  });

  it('[host:fansly] the application’s half of its adapter: no live configuration, its slice of the manifest, its contract, the dock’s variant `fansly` and its phrases', async () => {
    expect(FANSLY_APP.liveConfigOf(null, null)).toBeNull();
    expect(FANSLY_APP.contract.anchors).toContain('headerSubRow');
    expect(FANSLY_UI.dock.variant).toBe('fansly');
    expect(FANSLY_UI.phrases.ru.onSite).toBe('на Fansly');
    expect(FANSLY_APP.ui({ current: () => ({ scheme: 'dark', tokens: {}, fixedWidth: false }), onChange: () => () => undefined, dispose: () => undefined })).toBe(FANSLY_UI);
    const policy = await FANSLY_APP.ai(() => Promise.reject(new Error('nothing to load')));
    expect([policy.proof({} as never, {} as never), policy.fields(null), policy.fingerprint(null)]).toEqual([null, {}, null]);
  });

  it('[host:fansly] the early half of its adapter is assembled in its entry point: its kind, its client of the key scheme, its own lazy build', () => {
    expect(FANSLY_ADAPTER.kind).toBe(FANSLY.kind);
    expect(FANSLY_ADAPTER.hotkeyClient).toBe('fansly');
    expect(FANSLY_ADAPTER.lazy.root).toBe(FANSLY_LAZY_ROOT);
    expect(FANSLY_ADAPTER.lazy.root).toBe(FANSLY.lazy.root);
    expect(lazyPath(FANSLY_ADAPTER.lazy.root, 'bridge-validation')).toBe('lazy/fansly/bridge-validation.js');
    expect(FANSLY_ADAPTER.routeOfLocation({ pathname: '/messages' })).toEqual({ kind: 'other', epoch: '/messages' });
  });
});
