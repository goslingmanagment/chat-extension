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
import { LOOPBACK_MATCHES } from '../src/hosts.ts';
import { SITE_BASE, SITE_PAGES } from '../src/site.ts';

/** tools/archive-check takes a JS file over this for a foreign bundle (`MAX_JS_BYTES`). */
const MAX_PAGE_JS_BYTES = 400 * 1024;

const appRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
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

  it('is MV3 with an event-page background', () => {
    const m = release.manifest;
    expect(m['manifest_version']).toBe(3);
    expect(m['name']).toBe(EXTENSION_NAME);
    expect(m['background']).toEqual({ scripts: ['background.js'] });
  });

  it('pins the gecko id, minimum Firefox, update feed and data consent', () => {
    expect(release.manifest['browser_specific_settings']).toEqual({
      gecko: {
        id: GECKO_ID,
        strict_min_version: '142.0',
        update_url: UPDATE_URL,
        data_collection_permissions: { required: [...DATA_COLLECTION.required], optional: [...DATA_COLLECTION.optional] },
      },
    });
  });

  it('asks only for storage, alarms, scripting and the two hosts', () => {
    expect(release.manifest['permissions']).toEqual(['storage', 'alarms', 'scripting']);
    expect(release.manifest['host_permissions']).toEqual(['https://chat.onlymonster.ai/*', 'https://gosling-agency.ru/*']);
    expect(release.manifest['optional_host_permissions']).toEqual(['https://*/*']);
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

  it('exposes only the lazy chunks, and they exist', () => {
    const war = release.manifest['web_accessible_resources'] as Array<{ resources: string[]; matches: string[] }>;
    expect(war).toHaveLength(1);
    expect(war[0]?.matches).toEqual(['https://chat.onlymonster.ai/*']);
    expect(war[0]?.resources).toContain('lazy/dock.js');
    for (const resource of war[0]?.resources ?? []) {
      expect(resource).toMatch(/^lazy\/.+\.(js|css)$/);
      expect(existsSync(join(release.dir, resource)), resource).toBe(true);
    }
    expect(war[0]?.resources).not.toContain('lazy/spike.js');
  });

  it('has the popup, the options page in a tab, icons, and the default CSP', () => {
    expect((release.manifest['action'] as Record<string, unknown>)['default_popup']).toBe('popup.html');
    expect(release.manifest['options_ui']).toEqual({ open_in_tab: true, page: 'options.html' });
    expect(release.manifest['icons']).toEqual({ '48': 'icons/48.png', '96': 'icons/96.png', '128': 'icons/128.png' });
    expect(release.manifest['content_security_policy']).toBeUndefined();
  });

  it('ships the four pages, each loading the pages’ three chunks — the texts, the contracts, the pages — none over the size of a foreign bundle', () => {
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
});

describe('test manifest (CG_TEST_HOSTS=1)', () => {
  it('passes the policy for the test flavor', () => {
    expect(checkManifest(test.manifest, 'test')).toEqual([]);
  });

  it('adds the loopback stand to content scripts, hosts and lazy chunks, under its own id and without the feed', () => {
    const scripts = test.manifest['content_scripts'] as Script[];
    for (const script of scripts) expect(script.matches).toEqual(['https://chat.onlymonster.ai/*', ...LOOPBACK_MATCHES]);
    expect(test.manifest['host_permissions']).toEqual(['https://chat.onlymonster.ai/*', 'https://gosling-agency.ru/*', ...LOOPBACK_MATCHES]);
    const gecko = (test.manifest['browser_specific_settings'] as { gecko: Record<string, unknown> }).gecko;
    expect(gecko['id']).toBe(TEST_GECKO_ID);
    expect(gecko['update_url']).toBeUndefined();
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
    ['all_frames: true', (m: Record<string, unknown>) => ((m['content_scripts'] as Script[])[0]!.all_frames = true)],
    ['missing data consent', (m: Record<string, unknown>) => delete (m['browser_specific_settings'] as { gecko: Record<string, unknown> }).gecko['data_collection_permissions']],
  ])('rejects %s', (_label, change) => {
    expect(mutate(change).length).toBeGreaterThan(0);
  });
});
