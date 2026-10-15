// Composition root of the extension pages: the popup, the settings, the two
// debug pages (architecture.md §9.9, §10.2; docs/pages.md). Only dependency
// wiring: the pages' controller of core (`createPagesClient`) over the page
// side of the protocol and the browser's own ports from `@cg/platform`, and
// one of the mount functions of `@cg/ui/pages`.
//
// A page knows nothing of the hub or of ChatSpace: everything goes to the
// background as a request (`TAB_REQUESTS`, sender `page`). No conversation
// text, draft, prompt or secret is logged here — a failure is reported by its
// class and code only.
//
// - one settings tab (ST-006): «Настройки» from the popup goes through
//   `createExtensionPages`, which focuses the open tab and points it at the
//   section; on the settings page itself a section is a hash of this tab;
// - deep links `options.html#<раздел>:<КОД>` (ST-007…ST-010) are the page's
//   own address: the controller reads the hash and hears `hashchange`;
// - host access and the measurement consent are asked by the controller
//   inside the click, through the platform's ports (§3, §9.6);
// - the diagnostics file is saved through a Blob (§9.2), a link of the site
//   opens in a new tab on a click and only when it is https.

import { FANSLY_CONTRACT } from '@cg/contracts/fansly-host';
import type { ExtensionPage } from '@cg/contracts/tab-protocol';
import { CHATSPACE_CONTRACT } from '@cg/contracts/host';
import { HOST_PLATFORM, type HostKind } from '@cg/contracts/hosts';
import { LOG_LIMITS } from '@cg/contracts/limits';
import { DEFAULT_SETTINGS } from '@cg/contracts/settings';
import { parseTabPayload } from '@cg/contracts/tab-messages';
import type { I18nKey } from '@cg/contracts/errors';
import { CHATSPACE_STATUS_TEXTS, type JournalKind, type Unmount } from '@cg/contracts/vm';
import { createSiteAccessControl, createPagesClient, type PageEnv, type PagePorts, type PageSite, type PagesClient } from '@cg/core/application/pages';
import { createActionCatalog, hotkeyPlatformOf } from '@cg/core/domain/hotkeys';
import { CHATSPACE_PHRASES } from '@cg/core/domain/hosts/chatspace/i18n';
import { FANSLY_PHRASES } from '@cg/core/domain/hosts/fansly/i18n';
import { createI18n, resolveLocale, type SitePhrases } from '@cg/core/domain/i18n';
import { createLogForwarder, createLogger } from '@cg/core/domain/logging';
import {
  createConsent,
  createPermissionBundle,
  createKeyValueStore,
  createExtensionPages,
  createHostPermissions,
  createLinkOpener,
  createPageRpcClient,
  defaultBrowser,
  downloadFile,
  extensionVersionOf,
  writeClipboardText,
  type BrowserApi,
} from '@cg/platform';
import { mediaSchemeSignal, type KitFailure } from '@cg/ui/kit';
import { journalOfHash, mountDebugJournal, mountDebugPrompt, mountOptions, mountPopup, type PageDeps } from '@cg/ui/pages';

import { FANSLY_MATCHES } from '../hosts/runtime/fansly';
import { CHATSPACE_MATCHES, FANSLY_STAND_MATCHES, type PerHost } from '../hosts/runtime';
import { featuresOf } from './features';
import { SITE_PAGES } from '../site';

export type PageName = ExtensionPage;

/** What a test hands in: a fake browser context and its own window. The extension passes nothing. */
export interface PageCompositionDeps {
  readonly api?: BrowserApi;
  readonly win?: Window;
}

export interface ComposedPage {
  readonly client: PagesClient;
  /** Takes the page down: the tree, the controller, the listeners, the port. */
  dispose(): void;
}

/** The tab's title in the page's language (the popup has no tab). */
const TITLES: Readonly<Record<Exclude<PageName, 'popup'>, I18nKey>> = {
  options: 'settings.label',
  'debug-prompt': 'debugPage.prompt.title',
  'debug-journal': 'debugPage.journal.title',
};

/** How soon a page's own log records go to the background (`log.write`). */
const LOG_FORWARD_DELAY_MS = 250;

/**
 * The sites as the pages speak of them (R20 F7), one per row of the hosts' runtime table and in its order: a new row
 * does not typecheck until its site is here — its expected anchors (its contract module's) and the words of its
 * «Статус» row.
 */
const PAGE_SITES = {
  chatspace: { kind: 'chatspace', contract: CHATSPACE_CONTRACT, texts: CHATSPACE_STATUS_TEXTS },
  'fansly-web': { kind: 'fansly-web', contract: FANSLY_CONTRACT, texts: CHATSPACE_STATUS_TEXTS },
} as const satisfies PerHost<PageSite>;

/**
 * Every site's phrases (R20 F9b), from its own text pack: the shared texts name no site and take these instead. The
 * pages carry every site's pack (docs/project-unite/architecture.md §3.4) — a hub page on a platform whose site this
 * build does not run on yet is still named by it. A new host kind does not typecheck until its pack is here.
 */
const SITE_PHRASES = { chatspace: CHATSPACE_PHRASES, 'fansly-web': FANSLY_PHRASES } as const satisfies { readonly [K in HostKind]: SitePhrases };

/** The same by the platform each site serves: what a hub page's platform is called. */
const PLATFORM_PHRASES: ReadonlyMap<string, SitePhrases> = new Map(Object.entries(SITE_PHRASES).map(([kind, phrases]) => [HOST_PLATFORM[kind as HostKind], phrases]));

/**
 * What the pages' texts say for a site's name: the phrases of the site of this build — the one row of the hosts'
 * runtime table. With a second site a row of «Статус» about it takes its own (P14b).
 */
const PAGE_PHRASES: SitePhrases = SITE_PHRASES[PAGE_SITES.chatspace.kind];

/** The ChatSpace origin of the manifest: the onboarding checks the host access to it (the hosts' runtime table names it, nothing here does). */
function chatSpaceOrigin(): string {
  return new URL((CHATSPACE_MATCHES[0] ?? '').replace(/\*$/, '')).origin;
}

/** The opaque token of `debug-prompt.html?t=…` (DB-007): handed to the controller, never drawn and never logged. */
function promptTokenOf(win: Window): string {
  return new URLSearchParams(win.location.search).get('t') ?? '';
}

export function composePage(page: PageName, container: HTMLElement | null, deps: PageCompositionDeps = {}): ComposedPage | null {
  if (container === null) return null;
  const api = deps.api ?? defaultBrowser();
  const win = deps.win ?? window;
  const doc = win.document;
  const offs: (() => void)[] = [];

  // ── the protocol and the page's own log ────────────────────────────────────
  const rpc = createPageRpcClient({ api, validate: parseTabPayload });
  const forwarder = createLogForwarder({
    async send(records) {
      const answer = await rpc.request('log.write', { records: [...records] });
      if (!answer.ok) throw new Error(answer.error.code);
      return answer.payload;
    },
    schedule: (fn) => void win.setTimeout(fn, LOG_FORWARD_DELAY_MS),
  });
  // Debug records are the background's and the tab's; a page logs only what failed.
  const logger = createLogger({ now: () => Date.now(), debugEnabled: () => false, sinks: [forwarder.push], maxRecordBytes: LOG_LIMITS.maxRecordBytesFromUi });
  /** ER-020, ER-021: the surface and the error's class name — never its message. */
  const reportSurface = (failure: KitFailure): void => {
    logger.error(`page.${page}`, 'surface failed', { code: failure.code, fields: { kind: failure.kind, surface: failure.surface, name: failure.name } });
  };

  // ── texts and the scheme ───────────────────────────────────────────────────
  // Until the settings are read the page speaks the default's language (Russian), not the browser's.
  const i18n = createI18n({ language: resolveLocale(DEFAULT_SETTINGS.ui.locale, win.navigator.languages), now: () => Date.now(), phrases: PAGE_PHRASES });
  const systemScheme = mediaSchemeSignal(win.matchMedia('(prefers-color-scheme: dark)'));
  offs.push(() => systemScheme.dispose());
  const catalog = createActionCatalog(hotkeyPlatformOf(win.navigator.platform));
  const applyLanguage = (): void => {
    doc.documentElement.lang = i18n.language;
    if (page !== 'popup') doc.title = page === 'options' ? i18n.t(TITLES[page]) : `ChatGoose · ${i18n.t(TITLES[page])}`;
  };
  applyLanguage();
  offs.push(i18n.subscribe(applyLanguage));

  // ── the browser, as the controller's ports ─────────────────────────────────
  const links = createLinkOpener(api);
  const on = (target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>, type: string, listener: () => void): (() => void) => {
    target.addEventListener(type, listener);
    return () => target.removeEventListener(type, listener);
  };
  const env: PageEnv = {
    page,
    version: extensionVersionOf(api),
    hotkeyPlatform: catalog.platform,
    hostOrigin: chatSpaceOrigin(),
    links: { whatsNew: SITE_PAGES.whatsNew, changelog: SITE_PAGES.changelog },
    systemLanguages: () => win.navigator.languages,
    features: featuresOf,
    sites: Object.values(PAGE_SITES),
    phrases: PAGE_PHRASES,
    platformPhrases: (platform) => PLATFORM_PHRASES.get(platform) ?? null,
  };
  const ports: PagePorts = {
    rpc,
    clock: { now: () => Date.now() },
    timers: { set: (callback, ms) => win.setTimeout(callback, ms), clear: (handle) => win.clearTimeout(handle as number) },
    permissions: createHostPermissions(api),
    consent: createConsent(api),
    window: {
      hash: () => win.location.hash,
      // A new history entry and no `hashchange` of our own making: the controller moves itself, Back still works.
      setHash(hash) {
        const next = `#${hash.replace(/^#/, '')}`;
        if (win.location.hash !== next) win.history.pushState(null, '', next);
      },
      onHashChange: (listener) => on(win, 'hashchange', listener),
      onFocus(listener) {
        // Back on screen or in focus: the events' port, parked while the background slept, is opened first —
        // what the page then reads and what is announced after it both arrive (platform rpc-page.ts).
        const focused = (): void => {
          rpc.resume();
          listener();
        };
        const visible = (): void => {
          if (doc.visibilityState === 'visible') focused();
        };
        const offFocus = on(win, 'focus', focused);
        const offVisible = on(doc, 'visibilitychange', visible);
        return () => {
          offFocus();
          offVisible();
        };
      },
      visible: () => doc.visibilityState === 'visible',
      onPageHide: (listener) => on(win, 'pagehide', listener),
      // Only the popup gets out of the way after it handed a click to a tab.
      ...(page === 'popup' ? { close: () => win.close() } : {}),
    },
    pages: createExtensionPages(api),
    openLink: (url) => links.open(url),
    download: (file) => downloadFile(file, { document: doc, createObjectURL: (blob) => URL.createObjectURL(blob), revokeObjectURL: (url) => URL.revokeObjectURL(url), setTimeout: (callback, ms) => win.setTimeout(callback, ms) }),
    clipboard: { writeText: async (text) => ((await writeClipboardText(text, win.navigator)).ok ? { ok: true } : { ok: false, code: 'CG-CLIPBOARD' }) },
    systemScheme,
    language: i18n,
    catalog,
    report: (failure) => logger.warn(`page.${page}`, 'controller failed', { fields: { scope: failure.scope, code: failure.code, name: failure.name } }),
  };

  const client = createPagesClient(env, ports);
  client.start();

  // ── the page itself ────────────────────────────────────────────────────────
  const sitePermissions = createPermissionBundle({ origins: __CG_TEST_HOSTS__ ? [...FANSLY_STAND_MATCHES] : [...FANSLY_MATCHES, 'https://apiv3.fansly.com/*'], permissions: ['webRequest'] }, api);
  const access = createSiteAccessControl('fansly-web', rpc, sitePermissions);
  if (page === 'popup' || page === 'options') {
    const refresh = (): void => { if (doc.visibilityState === 'visible') void access.refresh(); };
    offs.push(sitePermissions.onChange(refresh), ports.window.onFocus(refresh),
      createKeyValueStore('session', { api }).onChanged((changes) => { if ('fansly.waitingReload' in changes) refresh(); }),
      createKeyValueStore('local', { api }).onChanged((changes) => { if ('settings.ext' in changes) refresh(); }));
    void access.refresh();
  }
  const shared: PageDeps = { client, i18n, catalog, clipboard: ports.clipboard, theme: client.theme, systemScheme, hints: client.hints, report: reportSurface, ...((page === 'popup' || page === 'options') ? { siteAccess: { control: access, title: 'Fansly', enable: 'Включить Fansly', disable: 'Выключить Fansly', reload: 'Перезагрузить вкладки', waiting: (count: number) => `Ждут перезагрузки: ${count}` } } : {}) };
  let unmount: Unmount;
  if (page === 'popup') unmount = mountPopup(container, shared);
  else if (page === 'options') unmount = mountOptions(container, { ...shared, location: client.location, helpUrl: SITE_PAGES.start });
  else if (page === 'debug-prompt') unmount = mountDebugPrompt(container, { ...shared, token: promptTokenOf(win) });
  else {
    const mountJournal = (journal: JournalKind): Unmount => mountDebugJournal(container, { ...shared, journal });
    let journal = journalOfHash(win.location.hash);
    let current = mountJournal(journal);
    // «Журналы» of the settings point the open journal tab at another journal (ST-006: the tab is reused).
    offs.push(
      on(win, 'hashchange', () => {
        const next = journalOfHash(win.location.hash);
        if (next === journal) return;
        journal = next;
        current();
        current = mountJournal(journal);
      }),
    );
    unmount = () => current();
  }
  // What the page logged about itself goes out with the page («по возможности», like the last settings write).
  offs.push(on(win, 'pagehide', () => void forwarder.flush()));

  let disposed = false;
  return {
    client,
    dispose() {
      if (disposed) return;
      disposed = true;
      unmount();
      client.dispose();
      for (const off of offs.splice(0)) off();
      rpc.close();
    },
  };
}
