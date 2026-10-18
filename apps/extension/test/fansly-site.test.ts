// Fansly's entry in the host registry and what it makes of the build (R20 P7a0;
// docs/project-unite/architecture.md §1.2, §3.1, §4): its two scripts, which
// the background registers and no manifest ever declares; its own lazy build,
// a web resource for its own pages alone; its optional permissions; its stand;
// its budget lines; the early half of its adapter, assembled in its entry
// point. The built manifest of both flavors: manifest.test.ts; the scripts on
// the stand in Firefox: packages/testing/e2e/specs/suite-fansly-site.e2e.ts.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { HostTheme } from '@cg/contracts/host';
import { LOCALES, type Locale } from '@cg/contracts/i18n/keys';
import { CHATSPACE_PHRASES } from '@cg/core/domain/hosts/chatspace/i18n';
import { FANSLY_MARK_TEXTS, FANSLY_PHRASES } from '@cg/core/domain/hosts/fansly/i18n';
import { createLiveI18n, type SitePhrases } from '@cg/core/domain/i18n/live';
import { HOST_PLATFORM } from '@cg/contracts/hosts';
import { fanslyProfile } from '@cg/testing/kit/profiles';
import { FANSLY_DOCK_SHEET } from '@cg/ui/hosts/fansly';
import type { SiteLazyEntryName } from '../lazy/entries/names.ts';
import { describe, expect, it } from 'vitest';

import { baseManifest, checkManifest, finalizeManifest, type BuildFlavor, type ManifestLike } from '../build/manifest.ts';
import { CATALOG as CHATSPACE_EN } from '../lazy/entries/i18n-en.ts';
import { CATALOG as CHATSPACE_RU } from '../lazy/entries/i18n-ru.ts';
import { BEFORE_THE_DOCK, LAZY_ENTRIES, LAZY_LAYERS } from '../lazy/entries/names.ts';
import { CATALOG as FANSLY_EN } from '../lazy/fansly/i18n-en.ts';
import { CATALOG as FANSLY_RU } from '../lazy/fansly/i18n-ru.ts';
import { FANSLY_APP, fanslyUi } from '../src/composition/tab/hosts/fansly/app.ts';
import { LAZY as TAB_LAZY } from '../src/composition/tab/runtime.ts';
import { lazyPath } from '../src/composition/tab/lazy.ts';
import { FANSLY_ADAPTER } from '../src/entrypoints/fansly.ts';
import { CHATSPACE } from '../src/hosts/chatspace.ts';
import { FANSLY, FANSLY_TEST } from '../src/hosts/fansly.ts';
import { HOSTS, lazySitesOf, pageMatchesOf, scriptsOf } from '../src/hosts/index.ts';
import { FANSLY_LAZY_ROOT, FANSLY_MATCHES, FANSLY_RELAY_PAGE } from '../src/hosts/runtime/fansly.ts';
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
      // R20 P9c: 36 → 38 KiB, the relay frame and its lease (hosts/fansly.ts).
      ['fansly', 38 * 1024],
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

  it('[EX-010] [FX-001] [host:fansly] its lazy build — and its relay page (P9c) — is its own web resource entry, for its own pages — the stand too in a test build; ChatSpace’s stays ChatSpace’s', () => {
    expect([FANSLY.lazy.root, FANSLY.lazy.layers, FANSLY.lazy.beforeTheDock]).toEqual(['lazy/fansly', LAZY_LAYERS, BEFORE_THE_DOCK]);
    for (const source of Object.values(FANSLY.lazy.entries)) expect(existsSync(`${lazyRoot}${source}`), source).toBe(true);
    const war = (flavor: BuildFlavor): Array<{ resources: string[]; matches: string[] }> => manifestOf(flavor)['web_accessible_resources'] as Array<{ resources: string[]; matches: string[] }>;
    for (const flavor of ['release', 'test'] as const) {
      const [chatspace, fansly] = war(flavor);
      expect(fansly).toEqual({ resources: [...Object.keys(FANSLY.lazy.entries).map((entry) => `lazy/fansly/${entry}.js`).sort(), FANSLY_RELAY_PAGE], matches: pageMatchesOf(FANSLY, flavor === 'test') });
      expect(chatspace?.matches).toEqual(pageMatchesOf(CHATSPACE, flavor === 'test'));
      expect(chatspace?.resources.every((resource) => resource.startsWith('lazy/chatspace/'))).toBe(true);
    }
    expect(war('test')[1]?.matches).toEqual(['https://fansly.com/*', 'http://localhost/*']);
  });

  it('[host:fansly] its build carries the application (R20 P7d): the tab’s two chunks, every layer, the texts — Fansly’s own `tab-app` and texts, the shared rest; nothing of ChatSpace’s alone', () => {
    const entries = FANSLY.lazy.entries;
    for (const name of [...Object.values(TAB_LAZY), ...LAZY_LAYERS, 'i18n-ru', 'i18n-en', 'ai-analysis', 'ai-coach', 'tab-health']) expect(Object.keys(entries), name).toContain(name);
    // Every entry name is one the tab asks for by name — a shared one, or one of Fansly's own (R20 P8b1: its AI
    // policy; P13b: the vault); its source is Fansly's own or the shared entry of that name. «Новые» (R20 P10a) are
    // Fansly's own under the shared names: the boards with the background's pass and its window, never the hub's list.
    const own: readonly SiteLazyEntryName[] = ['ai-fansly', 'vault', 'registration', 'notes', 'launcher'];
    for (const [name, source] of Object.entries(entries)) {
      expect([...Object.keys(LAZY_ENTRIES), ...own], name).toContain(name);
      expect([`fansly/${name}.ts`, LAZY_ENTRIES[name as keyof typeof LAZY_ENTRIES]], name).toContain(source);
    }
    expect([entries['tab-app'], entries['bridge-validation'], entries['tab-protocol'], entries['i18n-ru'], entries['i18n-en'], entries['ai-fansly'], entries['vault'], entries['boards'], entries['newcomers']]).toEqual([
      'fansly/tab-app.ts',
      'fansly/bridge-validation.ts',
      'fansly/tab-protocol.ts',
      'fansly/i18n-ru.ts',
      'fansly/i18n-en.ts',
      'fansly/ai-fansly.ts',
      'fansly/vault.ts',
      'fansly/boards.ts',
      'fansly/newcomers.ts',
    ]);
    // No other build has a file of Fansly's own entry.
    for (const name of own) expect(Object.keys(CHATSPACE.lazy.entries), name).not.toContain(name);
    for (const only of ['palette', 'preview']) expect(Object.keys(entries), only).not.toContain(only);
    expect(entries['boards-preview']).toBe('fansly/boards-preview.ts');
    expect([CHATSPACE.lazy.entries['boards'], CHATSPACE.lazy.entries['newcomers']]).toEqual(['entries/boards.ts', 'entries/newcomers.ts']);
  });

  it('[host:fansly] the application’s half of its adapter: no live configuration, its slice of the manifest, its contract, the dock’s variant `fansly` and its phrases', async () => {
    expect(FANSLY_APP.liveConfigOf(null, null)).toBeNull();
    expect(FANSLY_APP.contract.anchors).toContain('headerSubRow');
    const profile = FANSLY_APP.ui({ current: () => ({ scheme: 'dark', tokens: {}, fixedWidth: false }), onChange: () => () => undefined, dispose: () => undefined });
    expect(profile.dock.variant).toBe('fansly');
    expect(profile.phrases.ru.onSite).toBe('на Fansly');
    // Its AI policy is its own chunk (R20 P8b1), asked for by name; a chunk that does not load is no policy.
    const asked: string[] = [];
    // The deep window of a start is asked of the background (R20 P8c): its answer checked by its own schema, a wrong one is none.
    const requests: string[] = [];
    let answer: unknown = { ok: true, payload: { deep: 4000 } };
    const rpc = { request: (type: string) => (requests.push(type), Promise.resolve(answer)) } as unknown as Parameters<typeof FANSLY_APP.ai>[1];
    const policy = await FANSLY_APP.ai(<T,>(entry: string): Promise<T> => (asked.push(entry), import('../lazy/fansly/ai-fansly.ts') as Promise<T>), rpc);
    expect(asked).toEqual(['ai-fansly']);
    expect([policy.fields(null), policy.fingerprint(null), policy.preflight('hi', { chat: null, state: 'ready', loaded: 40, hasOlder: true } as never, null)]).toEqual([{}, null, null]);
    expect(requests).toEqual([]);
    expect(await policy.windows?.()).toEqual({ deep: 4000 });
    answer = { ok: true, payload: { deep: 3000 } };
    expect(await policy.windows?.()).toBeNull();
    answer = { ok: false, error: { code: 'CG-RUNTIME-UNREACHABLE' } };
    expect(await policy.windows?.()).toBeNull();
    expect(requests).toEqual(['fansly.settings.windows', 'fansly.settings.windows', 'fansly.settings.windows']);
    await expect(FANSLY_APP.ai(() => Promise.reject(new Error('nothing to load')), rpc)).rejects.toThrow('nothing to load');
  });

  it('[R20-P8d] [host:fansly] its profile (§1.5): the family’s greys and the page’s blue in the theme it shows, read anew on each switch; the variant’s sheet; the same parts the galleries draw Fansly in', () => {
    let theme: HostTheme = { scheme: 'dark', tokens: {}, fixedWidth: false };
    const listeners = new Set<(next: HostTheme) => void>();
    const source = {
      current: () => theme,
      onChange: (listener: (next: HostTheme) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      dispose: () => undefined,
    };
    // A page with Fansly's blue in each theme: `--blue-1` is «Отправить» in light and in dark (ui-design §2.1 «Fansly»).
    const blue = { light: '#fefefe', dark: '#202020' } as const;
    const page = (): Document =>
      ({ documentElement: {}, defaultView: { getComputedStyle: () => ({ getPropertyValue: (name: string) => (name === '--blue-1' ? blue[theme.scheme] : '') }) } }) as unknown as Document;
    const profile = fanslyUi(source, page);
    expect([profile.dock.variant, profile.sheet, profile.phrases.ru.onSite]).toEqual(['fansly', FANSLY_DOCK_SHEET, 'на Fansly']);
    expect(profile.palette?.value['--color-om-brand-500']).toBe('32 32 32');
    const heard: unknown[] = [];
    const off = profile.palette?.subscribe((palette) => heard.push([palette['--color-om-neutral-0'], palette['--color-om-brand-500']]));
    theme = { scheme: 'light', tokens: {}, fixedWidth: false };
    for (const listener of listeners) listener(theme);
    // Light: the card is the family's paper whatever the page says (X57); the blue is the page's.
    expect(heard).toEqual([['250 249 245', '254 254 254']]);
    off?.();
    expect(listeners.size).toBe(0);
    // The tab's adapter builds the same; the galleries' `?host=fansly` (packages/testing kit/profiles.ts) is this profile, part for part.
    expect(FANSLY_APP.ui(source)).toMatchObject({ dock: { variant: 'fansly' }, sheet: FANSLY_DOCK_SHEET, phrases: profile.phrases });
    const gallery = fanslyProfile(source, page);
    expect({ ...gallery, palette: gallery.palette?.value }).toEqual({ ...profile, palette: profile.palette?.value });
  });

  it('[UI-027] [R20-P8d] [host:fansly] copy only on Fansly says why as Fansly has it — the fan does not accept messages; ChatSpace’s tab keeps «фан заблокирован»', () => {
    const said = (catalogs: Readonly<Record<Locale, Readonly<Record<string, unknown>>>>, phrases: SitePhrases): Record<Locale, string[]> => {
      const out = { ru: [] as string[], en: [] as string[] };
      for (const language of LOCALES) {
        // As the tab speaks (tab/app.ts): the site's lazy catalog of the language, the site's phrases.
        const i18n = createLiveI18n((locale) => catalogs[locale] ?? null, { language, phrases });
        out[language] = [i18n.t('dock.reason.fanBlocked'), i18n.t('cg.gateFanBlocked.title'), i18n.t('cg.gateFanBlocked.body')];
      }
      return out;
    };
    const fansly = said({ ru: FANSLY_RU, en: FANSLY_EN }, FANSLY_PHRASES);
    expect(fansly).toEqual({
      ru: ['фан не принимает сообщения — можно только копировать', 'Фан не принимает сообщения', 'Можно только копировать.'],
      en: ['the fan doesn’t accept messages — copy only', 'The fan doesn’t accept messages', 'You can only copy.'],
    });
    const chatspace = said({ ru: CHATSPACE_RU, en: CHATSPACE_EN }, CHATSPACE_PHRASES);
    expect(chatspace).toEqual({
      ru: ['фан заблокирован, можно только копировать', 'Фан заблокирован', 'Можно только копировать.'],
      en: ['the fan is blocked, copy only', 'Fan blocked', 'You can only copy.'],
    });
  });

  it('[R20-P8b2] [host:fansly] the window check’s marks speak on Fansly’s tab, from its own catalog; ChatSpace’s tab carries none of their words and keeps «Фан написал новое»', () => {
    const marks = (['unverified', 'windowMiss', 'deletedServed'] as const).flatMap((reason) => [`result.stale.${reason}.title`, `result.stale.${reason}.body`] as const);
    for (const language of LOCALES) {
      const fansly = createLiveI18n((locale) => ({ ru: FANSLY_RU, en: FANSLY_EN })[locale] ?? null, { language, phrases: FANSLY_PHRASES });
      const chatspace = createLiveI18n((locale) => ({ ru: CHATSPACE_RU, en: CHATSPACE_EN })[locale] ?? null, { language, phrases: CHATSPACE_PHRASES });
      for (const key of marks) {
        expect(fansly.t(key as unknown as Parameters<typeof fansly.t>[0]), `${language} ${key}`).toBe(FANSLY_MARK_TEXTS[language][key]);
        expect(key in (language === 'ru' ? CHATSPACE_RU : CHATSPACE_EN), `${language} ${key}`).toBe(false);
      }
      expect(fansly.t('result.stale.title')).toBe(chatspace.t('result.stale.title'));
    }
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
