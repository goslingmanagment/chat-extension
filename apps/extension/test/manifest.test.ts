// The FINAL manifest, as WXT builds it, against architecture.md §3 «Манифест»:
// MV3, event page, gecko id/min version/update URL, data consent, permissions,
// hosts, content scripts, web_accessible_resources = lazy chunks only, pages.
// Builds both flavors into temp dirs; the release one must carry no test hosts.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  checkManifest,
  DATA_COLLECTION,
  EXTENSION_NAME,
  GECKO_ID,
  TEST_GECKO_ID,
  UPDATE_URL,
  type BuildFlavor,
} from '../build/manifest.ts';
import { PAGE_CHUNK_GROUPS, PAGE_ENTRY_NAMES } from '../build/page-chunks.ts';
import { CHATSPACE_STAND_MATCHES, FANSLY_STAND_MATCHES, HOSTS, LOOPBACK_MATCHES, scriptsOf } from '../src/hosts/index.ts';
import { FANSLY_LAZY_ENTRIES } from '../src/hosts/fansly.ts';
import { CHATSPACE_LAZY_ROOT } from '../src/hosts/runtime/chatspace.ts';
import { FANSLY_LAZY_ROOT, FANSLY_RELAY_PAGE } from '../src/hosts/runtime/fansly.ts';
import { SITE_BASE, SITE_PAGES } from '../src/site.ts';

/** tools/archive-check takes a JS file over this for a foreign bundle (`MAX_JS_BYTES`). */
const MAX_PAGE_JS_BYTES = 400 * 1024;

const appRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

/** Every file under `dir`, paths relative to it. */
const listTree = (dir: string): string[] =>
  readdirSync(dir)
    .flatMap((name) => (statSync(join(dir, name)).isDirectory() ? listTree(join(dir, name)).map((child) => `${name}/${child}`) : [name]))
    .sort();
const wxtBin = join(appRoot, 'node_modules/.bin/wxt');

interface Built {
  readonly outDir: string;
  readonly dir: string;
  readonly manifest: Record<string, unknown>;
}

function build(flavor: BuildFlavor): Built {
  const outDir = mkdtempSync(join(tmpdir(), `cg-manifest-${flavor}-`));
  execFileSync(wxtBin, ['build', '-b', 'firefox', '--mv3'], {
    cwd: appRoot,
    env: { ...process.env, CG_WXT_OUT_DIR: outDir, CG_TEST_HOSTS: flavor === 'test' ? '1' : '0' },
    stdio: 'pipe',
  });
  const dir = join(outDir, flavor === 'test' ? 'firefox-mv3-test' : 'firefox-mv3');
  return { outDir, dir, manifest: JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as Record<string, unknown> };
}

let release: Built;
let test: Built;

beforeAll(() => {
  release = build('release');
  test = build('test');
}, 180_000);

afterAll(() => {
  for (const built of [release, test]) if (built) rmSync(built.outDir, { recursive: true, force: true });
});

type Script = { matches: string[]; js: string[]; run_at: string; all_frames: boolean; world?: string };

describe('release manifest (§3)', () => {
  it('passes every rule of the manifest policy', () => {
    expect(checkManifest(release.manifest, 'release')).toEqual([]);
  });

  it('[EX-001] is MV3 with an event-page background', () => {
    const m = release.manifest;
    expect(m['manifest_version']).toBe(3);
    expect(m['name']).toBe(EXTENSION_NAME);
    expect(m['background']).toEqual({ scripts: ['background.js'] });
  });

  it('[EX-002] [EX-006] pins the gecko id, minimum Firefox, update feed and data consent', () => {
    expect(release.manifest['browser_specific_settings']).toEqual({
      gecko: {
        id: GECKO_ID,
        strict_min_version: '142.0',
        update_url: UPDATE_URL,
        data_collection_permissions: { required: [...DATA_COLLECTION.required], optional: [...DATA_COLLECTION.optional] },
      },
    });
  });

  it('[EX-003] asks only for storage, alarms, scripting and the two hosts; Fansly’s origins and webRequest only on request', () => {
    expect(release.manifest['permissions']).toEqual(['storage', 'alarms', 'scripting']);
    expect(release.manifest['host_permissions']).toEqual(['https://chat.onlymonster.ai/*', 'https://gosling-agency.ru/*']);
    expect(release.manifest['optional_host_permissions']).toEqual(['https://*/*', 'https://fansly.com/*', 'https://apiv3.fansly.com/*']);
    expect(release.manifest['optional_permissions']).toEqual(['webRequest']);
  });

  it('declares the MAIN bridge and the isolated script at document_start, top frame only; the WS tap stays dynamic', () => {
    const scripts = release.manifest['content_scripts'] as Script[];
    expect(scripts).toHaveLength(2);
    expect(scripts.find((script) => script.world === 'MAIN')).toEqual({
      matches: ['https://chat.onlymonster.ai/*'],
      all_frames: false,
      run_at: 'document_start',
      js: ['content-scripts/chatspace-main.js'],
      world: 'MAIN',
    });
    expect(scripts.find((script) => script.world === undefined)).toEqual({
      matches: ['https://chat.onlymonster.ai/*'],
      all_frames: false,
      run_at: 'document_start',
      js: ['content-scripts/chatspace.js'],
    });
    expect(existsSync(join(release.dir, 'chatspace-ws.js'))).toBe(true);
  });

  it('builds Fansly’s two scripts and registers neither statically: the background registers them, after «Включить Fansly» (R20 P7a0, P9a)', () => {
    // Every string of the manifest: none names either script (Fansly's own lazy chunks, `lazy/fansly/ai-fansly.js`, are
    // web resources of its pages, not these scripts).
    const strings = JSON.stringify(release.manifest).match(/"(?:[^"\\]|\\.)*"/g) ?? [];
    for (const file of ['fansly-main.js', 'fansly.js']) {
      expect(existsSync(join(release.dir, file)), file).toBe(true);
      expect(strings.filter((value) => value === `"${file}"` || value.endsWith(`/${file}"`)), file).toEqual([]);
    }
    expect(JSON.stringify(release.manifest['content_scripts'])).not.toContain('fansly');
  });

  it('[EX-010] [FX-001] exposes only the lazy chunks — and Fansly’s relay page —, and they exist: each site’s own build, for its own pages', () => {
    const war = release.manifest['web_accessible_resources'] as Array<{ resources: string[]; matches: string[] }>;
    expect(war.map((entry) => entry.matches)).toEqual([['https://chat.onlymonster.ai/*'], ['https://fansly.com/*']]);
    expect(war[0]?.resources).toContain('lazy/chatspace/dock.js');
    expect(war[1]?.resources).toContain('lazy/fansly/bridge-validation.js');
    // R20 P9c: the relay page of «Fansly через вкладку», for Fansly’s pages alone; it is built, and ChatSpace’s pages may not frame it.
    expect(war[1]?.resources).toContain(FANSLY_RELAY_PAGE);
    expect(war[0]?.resources).not.toContain(FANSLY_RELAY_PAGE);
    expect(existsSync(join(release.dir, FANSLY_RELAY_PAGE))).toBe(true);
    for (const [index, root] of [CHATSPACE_LAZY_ROOT, FANSLY_LAZY_ROOT].entries()) {
      const resources = (war[index]?.resources ?? []).filter((resource) => resource !== FANSLY_RELAY_PAGE);
      for (const resource of resources) {
        expect(resource.startsWith(`${root}/`), resource).toBe(true);
        expect(resource).toMatch(/\.(js|css)$/);
        expect(existsSync(join(release.dir, resource)), resource).toBe(true);
      }
      // Every file of the build is listed: nothing under its folder the tab could not load, nothing of another build.
      expect(listTree(join(release.dir, root)).map((file) => `${root}/${file}`)).toEqual([...resources].sort());
    }
    expect(readdirSync(join(release.dir, 'lazy')).sort()).toEqual(['chatspace', 'fansly']);
  });

  it('[R20-F1] builds each site’s background chunk as one ES module next to the core; none is a web resource; the core loads it itself', () => {
    for (const built of [release, test]) {
      const war = (built.manifest['web_accessible_resources'] as Array<{ resources: string[] }>).flatMap((entry) => entry.resources);
      const chunks = HOSTS.flatMap((host) => (host.background === undefined ? [] : [host.background.file]));
      expect(chunks).toEqual(['bg/chatspace.js', 'bg/fansly.js']);
      expect(readdirSync(join(built.dir, 'bg')).map((name) => `bg/${name}`).sort()).toEqual([...chunks].sort());
      for (const chunk of chunks) {
        expect(readFileSync(join(built.dir, chunk), 'utf8')).toMatch(/\bas default\b/);
        expect(war).not.toContain(chunk);
      }
      // The classic event page keeps its dynamic import (spike P3a): no module background, no chunk of the pages.
      expect(built.manifest['background']).toEqual({ scripts: ['background.js'] });
      expect(readFileSync(join(built.dir, 'background.js'), 'utf8')).toMatch(/\bimport\(/);
    }
    // The test build's fault switch of the loader (the e2e's failed import) never ships.
    expect(readFileSync(join(release.dir, 'background.js'), 'utf8')).not.toContain('dev.hostModuleFault');
    expect(readFileSync(join(test.dir, 'background.js'), 'utf8')).toContain('dev.hostModuleFault');
  });

  it('[EX-017] has the popup, the options page in a tab, icons, and the default CSP', () => {
    expect((release.manifest['action'] as Record<string, unknown>)['default_popup']).toBe('popup.html');
    expect(release.manifest['options_ui']).toEqual({ open_in_tab: true, page: 'options.html' });
    expect(release.manifest['icons']).toEqual({ '48': 'icons/48.png', '96': 'icons/96.png', '128': 'icons/128.png' });
    expect(release.manifest['content_security_policy']).toBeUndefined();
  });

  it('[EX-016] the build ships the four pages, each loading the pages’ four chunks — the texts, the contracts, the brand, the pages — none over the size of a foreign bundle', () => {
    const chunks = readdirSync(join(release.dir, 'chunks'));
    for (const group of PAGE_CHUNK_GROUPS) expect(chunks.filter((file) => file.startsWith(`${group.name}-`)), group.name).toHaveLength(1);
    for (const file of chunks) expect(statSync(join(release.dir, 'chunks', file)).size, file).toBeLessThanOrEqual(MAX_PAGE_JS_BYTES);
    for (const page of PAGE_ENTRY_NAMES) {
      const html = readFileSync(join(release.dir, `${page}.html`), 'utf8');
      const scripts = [...html.matchAll(/(?:src|href)="\/(chunks\/[^"]+\.js)"/g)].map((match) => match[1] ?? '');
      expect(scripts.some((file) => file.startsWith(`chunks/${page}-`)), page).toBe(true);
      for (const group of PAGE_CHUNK_GROUPS) expect(scripts.some((file) => file.startsWith(`chunks/${group.name}-`)), `${page}: ${group.name}`).toBe(true);
      for (const file of scripts) expect(existsSync(join(release.dir, file)), file).toBe(true);
      // No inline script and nothing from the network: the default CSP of an extension page.
      expect(html).not.toMatch(/<script(?![^>]*\bsrc=)/);
      expect(html).not.toMatch(/https?:\/\//);
    }
  });

  it('links to the site pages next to the update feed, https only', () => {
    expect(UPDATE_URL.startsWith(SITE_BASE)).toBe(true);
    for (const url of Object.values(SITE_PAGES)) expect(url).toMatch(new RegExp(`^${SITE_BASE.replace(/[.]/g, '\\.')}[a-z-]+\\.html$`));
  });

  it('carries no loopback stand, fake hub or test id', () => {
    const text = JSON.stringify(release.manifest);
    for (const pattern of LOOPBACK_MATCHES) expect(text).not.toContain(pattern.replace('/*', ''));
    expect(text).not.toContain(TEST_GECKO_ID);
  });

  it('builds every script of every site in the host registry', () => {
    for (const script of HOSTS.flatMap(scriptsOf)) expect(existsSync(join(release.dir, script.file)), script.file).toBe(true);
  });

  it('carries no build field of the host registry in any bundle: budgets, the contract check, archive markers, MAIN-world sources (architecture §1.2)', () => {
    const fields = HOSTS.flatMap((host) => [
      ...Object.values(host.lazy.entries),
      host.contractCheck.module,
      host.contractCheck.bundlesRootEnv,
      ...host.mainWorldSources,
      ...[...host.archiveMarkers.code, ...host.archiveMarkers.libraries].map((marker) => marker.source),
    ]);
    const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? files(join(dir, name)) : [join(dir, name)]));
    const bundles = files(release.dir).filter((file) => /\.(js|html|css|json)$/.test(file));
    expect(bundles.length).toBeGreaterThan(10);
    for (const bundle of bundles) {
      const text = readFileSync(bundle, 'utf8');
      for (const field of fields) expect(text.includes(field), `${field} in ${bundle}`).toBe(false);
    }
  });
});

describe('test manifest (CG_TEST_HOSTS=1)', () => {
  it('passes the policy for the test flavor', () => {
    expect(checkManifest(test.manifest, 'test')).toEqual([]);
  });

  it('adds ChatSpace’s loopback stand to content scripts, hosts and lazy chunks, under its own id and without the feed', () => {
    const scripts = test.manifest['content_scripts'] as Script[];
    for (const script of scripts) expect(script.matches).toEqual(['https://chat.onlymonster.ai/*', ...CHATSPACE_STAND_MATCHES]);
    const war = test.manifest['web_accessible_resources'] as Array<{ resources: string[]; matches: string[] }>;
    expect(war[0]?.matches).toEqual(['https://chat.onlymonster.ai/*', ...CHATSPACE_STAND_MATCHES]);
    expect(test.manifest['host_permissions']).toEqual(['https://chat.onlymonster.ai/*', 'https://gosling-agency.ru/*', ...CHATSPACE_STAND_MATCHES]);
    const gecko = (test.manifest['browser_specific_settings'] as { gecko: Record<string, unknown> }).gecko;
    expect(gecko['id']).toBe(TEST_GECKO_ID);
    expect(gecko['update_url']).toBeUndefined();
  });

  it('lets the extension ask for the Fansly stand on its own loopback name — optional, with webRequest, never granted at install (R20 P6a)', () => {
    expect(test.manifest['optional_host_permissions']).toEqual(['https://*/*', 'https://fansly.com/*', 'https://apiv3.fansly.com/*', ...FANSLY_STAND_MATCHES]);
    expect(test.manifest['optional_permissions']).toEqual(['webRequest']);
    const granted = JSON.stringify([test.manifest['host_permissions'], test.manifest['content_scripts']]);
    for (const pattern of FANSLY_STAND_MATCHES) expect(granted).not.toContain(pattern.replace('/*', ''));
  });
});

describe('the sites’ lazy builds in the two flavors (R20 F2b)', () => {
  const tree = (dir: string): Record<string, string> => Object.fromEntries(listTree(dir).map((file) => [file, readFileSync(join(dir, file), 'utf8')]));

  it('both flavors carry Fansly’s own build beside ChatSpace’s, for Fansly’s pages — and in the test build its stand — alone', () => {
    const war = test.manifest['web_accessible_resources'] as Array<{ resources: string[]; matches: string[] }>;
    expect(war.map((entry) => entry.resources.every((resource) => resource.startsWith(`${CHATSPACE_LAZY_ROOT}/`)))).toEqual([true, false]);
    // Its application came with the dock (R20 P7d): every entry and shared chunk of its own folder, nothing else.
    expect(war[1]?.matches).toEqual(['https://fansly.com/*', ...FANSLY_STAND_MATCHES]);
    expect(war[1]?.resources.every((resource) => resource.startsWith(`${FANSLY_LAZY_ROOT}/`) || resource === FANSLY_RELAY_PAGE)).toBe(true);
    for (const entry of Object.keys(FANSLY_LAZY_ENTRIES)) expect(war[1]?.resources, entry).toContain(`${FANSLY_LAZY_ROOT}/${entry}.js`);
    // P12a: the test flavor has the operation port's stand-only probe; the release has none of its graph.
    // Public entries and site scoping stay the same; ChatSpace's bytes remain equal in the next test.
    const releaseText = Object.values(tree(join(release.dir, FANSLY_LAZY_ROOT))).join('\n');
    const testText = Object.values(tree(join(test.dir, FANSLY_LAZY_ROOT))).join('\n');
    expect(releaseText).not.toContain('data-cg-ops-command');
    expect(releaseText).not.toContain('__CG_TEST_HOSTS__');
    expect(testText).toContain('data-cg-ops-command');
  });

  it('with Fansly’s build beside it, ChatSpace’s lazy build is the release build’s byte for byte', () => {
    const chatspace = tree(join(release.dir, CHATSPACE_LAZY_ROOT));
    expect(Object.keys(chatspace).length).toBeGreaterThan(20);
    expect(tree(join(test.dir, CHATSPACE_LAZY_ROOT))).toEqual(chatspace);
  });
});

describe('manifest policy catches violations', () => {
  const mutate = (change: (m: Record<string, unknown>) => void): string[] => {
    const copy = structuredClone(release.manifest);
    change(copy);
    return checkManifest(copy, 'release');
  };

  it.each([
    ['a service worker', (m: Record<string, unknown>) => (m['background'] = { service_worker: 'background.js' })],
    ['the tabs permission', (m: Record<string, unknown>) => (m['permissions'] = ['storage', 'alarms', 'scripting', 'tabs'])],
    ['a loopback host', (m: Record<string, unknown>) => (m['host_permissions'] = [...(m['host_permissions'] as string[]), 'http://127.0.0.1/*'])],
    ['MV2', (m: Record<string, unknown>) => (m['manifest_version'] = 2)],
    ['a non-lazy web resource', (m: Record<string, unknown>) => (m['web_accessible_resources'] = [{ resources: ['background.js'], matches: ['https://chat.onlymonster.ai/*'] }])],
    ['a lazy chunk outside its site’s build', (m: Record<string, unknown>) => (m['web_accessible_resources'] = [{ resources: ['lazy/dock.js'], matches: ['https://chat.onlymonster.ai/*'] }])],
    ['Fansly’s relay page for ChatSpace’s pages', (m: Record<string, unknown>) => (m['web_accessible_resources'] as Array<{ resources: string[] }>)[0]!.resources.push(FANSLY_RELAY_PAGE)],
    ['Fansly’s chunks without its relay page', (m: Record<string, unknown>) => ((m['web_accessible_resources'] as Array<{ resources: string[] }>)[1]!.resources = (m['web_accessible_resources'] as Array<{ resources: string[] }>)[1]!.resources.filter((resource) => resource !== FANSLY_RELAY_PAGE))],
    ['ChatSpace’s chunks for every page', (m: Record<string, unknown>) => ((m['web_accessible_resources'] as Array<{ matches: string[] }>)[0]!.matches = ['<all_urls>'])],
    ['all_frames: true', (m: Record<string, unknown>) => ((m['content_scripts'] as Script[])[0]!.all_frames = true)],
    ['missing data consent', (m: Record<string, unknown>) => delete (m['browser_specific_settings'] as { gecko: Record<string, unknown> }).gecko['data_collection_permissions']],
  ])('rejects %s', (_label, change) => {
    expect(mutate(change).length).toBeGreaterThan(0);
  });
});
