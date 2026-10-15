// The P3b harness's browser (e2e/specs/p3b-signed-builds.e2e.ts): a Firefox of
// its own, started by the spec with a profile folder it keeps across restarts,
// the P3b world as its only way out (src/p3b/world.ts) and the test builds
// installed PERMANENTLY, as a chatter's Firefox holds them. Firefox's own side
// — the add-on manager, the update check, the permission prompts, the attention
// dot — is read and driven through WebDriver's chrome context (geckodriver
// --allow-system-access), never through our extension's code.
//
// Signed builds: a release Firefox, signatures required. Unsigned stand-ins
// (`unsigned`): the same Firefox told it is under automation —
// MOZ_DISABLE_NONLOCAL_CONNECTIONS=1 in its environment and
// `security.turn_off_all_security_so_that_viruses_can_take_over_this_computer`
// in its profile make `Cu.isInAutomation` true, and only then does a release
// build honour `xpinstall.signatures.required = false` (AddonSettings.sys.mjs).
// It proves the harness runs; what only a signed build can show is listed in
// the spec.

import { readFileSync } from 'node:fs';

import { browser } from '@wdio/globals';
import { remote } from 'webdriverio';

import { QUIET_FIREFOX_PREFS } from '../../src/stand/egress-sink';
import type { P3bWorld } from '../../src/p3b/world';
import type { ClassicDriver } from './background';

/** Same as tools/release/test-builds.ts TEST_BUILDS_GECKO_ID: the test add-on, never the real one. */
export const P3B_GECKO_ID = 'chatgoose-p3b-test@gosling.agency';
/** Fixed through `extensions.webextensions.uuids`: the spec opens the add-on's own pages. */
export const P3B_ADDON_UUID = '5d0c9a3e-7b21-4f6a-8e4d-1c2b3a4d5e6f';
export const p3bPage = (path: string): string => `moz-extension://${P3B_ADDON_UUID}/${path}`;

/** The Firefox side that makes an unsigned stand-in installable; never set for signed builds. */
export const AUTOMATION_ENV = 'MOZ_DISABLE_NONLOCAL_CONNECTIONS';
const AUTOMATION_PREFS = { 'security.turn_off_all_security_so_that_viruses_can_take_over_this_computer': true, 'xpinstall.signatures.required': false } as const;

export interface P3bBrowserOptions {
  /** The profile folder: kept across restarts (`-profile`), so a permanent install and its registrations survive. */
  readonly profile: string;
  readonly unsigned: boolean;
}

/** Starts a Firefox for the P3b world: our proxy, our update feed, the add-on's fixed UUID, session restore on. */
export async function startP3bBrowser(world: P3bWorld, options: P3bBrowserOptions): Promise<WebdriverIO.Browser> {
  const own = browser.requestedCapabilities as WebdriverIO.Capabilities;
  const firefox = own['moz:firefoxOptions'] ?? {};
  // geckodriver hands Firefox its own environment: the automation switch must be there when it starts.
  if (options.unsigned) process.env[AUTOMATION_ENV] = '1';
  else delete process.env[AUTOMATION_ENV];
  return remote({
    logLevel: 'warn',
    capabilities: {
      browserName: 'firefox',
      // Our TLS front's throwaway certificate for fansly.com and its two hosts (src/p3b/world.ts).
      acceptInsecureCerts: true,
      // The suite's own driver options (wdio.conf.ts): --allow-system-access for the chrome context, loopback only.
      'wdio:geckodriverOptions': own['wdio:geckodriverOptions'] ?? ({ allowSystemAccess: true, host: '127.0.0.1' } as WebdriverIO.GeckodriverOptions),
      'moz:firefoxOptions': {
        ...(firefox.binary === undefined ? {} : { binary: firefox.binary }),
        args: ['-headless', '-profile', options.profile],
        prefs: {
          ...QUIET_FIREFOX_PREFS,
          'network.proxy.type': 1,
          'network.proxy.http': '127.0.0.1',
          'network.proxy.http_port': world.proxyPort,
          'network.proxy.ssl': '127.0.0.1',
          'network.proxy.ssl_port': world.proxyPort,
          'network.proxy.share_proxy_settings': true,
          'network.proxy.allow_hijacking_localhost': false,
          'network.proxy.no_proxies_on': '',
          // Add-on updates on, from our feed only; the daily timer never fires in a run: the spec asks.
          'extensions.update.enabled': true,
          'extensions.update.autoUpdateDefault': true,
          'extensions.update.url': world.feedUrl,
          'extensions.update.background.url': world.feedUrl,
          'extensions.update.interval': 30 * 24 * 3600,
          'extensions.webextensions.uuids': JSON.stringify({ [P3B_GECKO_ID]: P3B_ADDON_UUID }),
          // A restart brings the tabs back, as a chatter's Firefox does.
          'browser.startup.page': 3,
          'browser.sessionstore.resume_session_once': false,
          'browser.shell.checkDefaultBrowser': false,
          // Firefox closes the add-on's own tabs when it replaces the add-on: the window stays even if that was its last tab.
          'browser.tabs.closeWindowWithLastTab': false,
          // Panels open without their animation: the popup stands where it is measured.
          'toolkit.cosmeticAnimations.enabled': false,
          'privacy.reduceTimerPrecision': false,
          'media.volume_scale': '0.0',
          ...(options.unsigned ? AUTOMATION_PREFS : {}),
        },
      },
    },
  });
}

/** Clears what startP3bBrowser put into this process's environment. */
export function clearAutomationEnv(): void {
  delete process.env[AUTOMATION_ENV];
}

async function inChromeOf<T>(instance: WebdriverIO.Browser, run: (driver: ClassicDriver) => Promise<T>): Promise<T> {
  const driver = instance as unknown as ClassicDriver;
  await driver.setMozContext('chrome');
  try {
    return await run(driver);
  } finally {
    await driver.setMozContext('content');
  }
}

/** A script in the chrome context of the browser window; `arguments` as in WebDriver. */
export function chrome<T>(instance: WebdriverIO.Browser, script: string, args: unknown[] = []): Promise<T> {
  return inChromeOf(instance, (driver) => driver.executeScript(script, args)) as Promise<T>;
}

/** The same, asynchronous: the last argument is `done`. A script that throws answers `{ error }`. */
export async function chromeAsync<T>(instance: WebdriverIO.Browser, script: string, args: unknown[] = []): Promise<T> {
  const answer = (await inChromeOf(instance, (driver) =>
    driver.executeAsyncScript(`const done = arguments[arguments.length - 1]; (async () => { ${script} })(...arguments).then((value) => done({ value }), (error) => done({ error: String(error) }));`, args),
  )) as { value?: T; error?: string };
  if (answer.error !== undefined) throw new Error(`chrome script: ${answer.error}`);
  return answer.value as T;
}

/** Installs an XPI as a chatter's Firefox holds it: permanently (geckodriver addon install, `temporary: false`). */
export async function installPermanently(instance: WebdriverIO.Browser, xpi: string): Promise<string> {
  return instance.installAddOn(readFileSync(xpi).toString('base64'), false);
}

export interface AddonView {
  readonly version: string;
  readonly active: boolean;
  /** AddonManager.SIGNEDSTATE_*: 2 signed, 3 system, 4 privileged; 0 missing, -1 broken. */
  readonly signedState: number | null;
  readonly temporary: boolean;
  readonly background: string | null;
  readonly startupReason: string | null;
  /** What the add-on may reach now, as Firefox holds it (ExtensionPermissions) and as its policy sees it. */
  readonly granted: { readonly origins: readonly string[]; readonly permissions: readonly string[] };
  readonly reaches: { readonly page: boolean; readonly api: boolean };
  /** The scripts registered in the policy now (file names). */
  readonly scripts: readonly string[];
}

/** The test add-on as Firefox holds it; null — not installed. */
export function addonView(instance: WebdriverIO.Browser, id = P3B_GECKO_ID): Promise<AddonView | null> {
  return chromeAsync<AddonView | null>(
    instance,
    `const [id] = arguments;
     const { AddonManager } = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
     const { ExtensionPermissions } = ChromeUtils.importESModule('resource://gre/modules/ExtensionPermissions.sys.mjs');
     const addon = await AddonManager.getAddonByID(id);
     if (!addon) return null;
     const policy = WebExtensionPolicy.getByID(id);
     const granted = await ExtensionPermissions.get(id);
     const uri = (url) => Services.io.newURI(url);
     return {
       version: addon.version, active: addon.isActive, signedState: addon.signedState ?? null, temporary: addon.temporarilyInstalled === true,
       background: policy?.extension?.backgroundState ?? null, startupReason: policy?.extension?.startupReason ?? null,
       granted: { origins: [...granted.origins], permissions: [...granted.permissions] },
       reaches: { page: policy ? policy.canAccessURI(uri('https://fansly.com/')) : false, api: policy ? policy.canAccessURI(uri('https://apiv3.fansly.com/api/v1/')) : false },
       scripts: policy ? policy.contentScripts.flatMap((script) => script.jsPaths.map((path) => path.slice(path.lastIndexOf('/') + 1))) : [],
     };`,
    [id],
  );
}

export interface RecordedEvent {
  readonly kind: string;
  readonly at: number;
  readonly version?: string | null;
  readonly detail?: unknown;
}

/**
 * Starts recording, in the browser itself, what Firefox does to the test add-on: the add-on manager's install events,
 * every permission prompt (install, update, optional), and — polled every 5 ms — its version, its background's state
 * and the scripts registered in its policy, each change with its time. `gapUrl`: a tab of this address is opened the
 * moment the new version is there and its scripts are not yet registered (the gap of a real update).
 */
export async function armRecorder(instance: WebdriverIO.Browser, options: { readonly gapUrl?: string } = {}, id = P3B_GECKO_ID): Promise<void> {
  await chrome(
    instance,
    `const [id, gapUrl] = arguments;
     const { AddonManager } = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
     // Every chrome script runs in a sandbox of its own: what has to outlive it lives on the browser window.
     const home = Services.wm.getMostRecentWindow('navigator:browser');
     const old = home.__cgP3b;
     if (old) old.stop();
     const rec = { events: [], gap: null, last: null };
     const push = (kind, extra = {}) => rec.events.push({ kind, at: Date.now(), ...extra });
     const ours = (install) => (install?.addon?.id ?? install?.existingAddon?.id) === id;
     const listener = {};
     for (const name of ['onNewInstall', 'onDownloadStarted', 'onDownloadEnded', 'onDownloadFailed', 'onInstallStarted', 'onInstallEnded', 'onInstallFailed', 'onInstallCancelled', 'onInstallPostponed']) {
       listener[name] = (install) => { if (ours(install)) push(name, { version: install.version ?? null, detail: install.error ? { error: install.error } : undefined }); };
     }
     AddonManager.addInstallListener(listener);
     const observer = { observe(subject, topic) {
       const data = subject?.wrappedJSObject ?? {};
       const permissions = data.permissions ? { origins: [...(data.permissions.origins ?? [])], permissions: [...(data.permissions.permissions ?? [])] } : null;
       const addonId = data.addon?.id ?? data.info?.addon?.id ?? data.id ?? null;
       push(topic, { detail: { addon: addonId, permissions } });
     } };
     const topics = ['webextension-permission-prompt', 'webextension-update-permission-prompt', 'webextension-optional-permission-prompt'];
     for (const topic of topics) Services.obs.addObserver(observer, topic);
     const timer = setInterval(() => {
       const policy = WebExtensionPolicy.getByID(id);
       const scripts = policy ? policy.contentScripts.flatMap((script) => script.jsPaths.map((path) => path.slice(path.lastIndexOf('/') + 1))) : [];
       const now = { version: policy?.extension?.version ?? null, background: policy?.extension?.backgroundState ?? null, registered: scripts.includes('fansly-main.js') && scripts.includes('fansly.js') };
       const last = rec.last;
       if (!last || last.version !== now.version) push('version', { version: now.version });
       if (!last || last.background !== now.background) push('background', { version: now.version, detail: now.background });
       if (!last || last.registered !== now.registered) push(now.registered ? 'registered' : 'unregistered', { version: now.version });
       if (gapUrl && !rec.gap && last && now.version && last.version !== now.version && !now.registered) {
         const win = Services.wm.getMostRecentWindow('navigator:browser');
         win.gBrowser.addTab(gapUrl, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
         rec.gap = { at: Date.now(), version: now.version };
         push('gap-tab', { version: now.version });
       }
       rec.last = now;
     }, 5);
     rec.stop = () => { clearInterval(timer); AddonManager.removeInstallListener(listener); for (const topic of topics) Services.obs.removeObserver(observer, topic); };
     home.__cgP3b = rec;
     return true;`,
    [id, options.gapUrl ?? null],
  );
}

export async function recorded(instance: WebdriverIO.Browser): Promise<readonly RecordedEvent[]> {
  return chrome<RecordedEvent[]>(instance, "const rec = Services.wm.getMostRecentWindow('navigator:browser').__cgP3b; return rec ? JSON.parse(JSON.stringify(rec.events)) : [];");
}

export async function stopRecorder(instance: WebdriverIO.Browser): Promise<void> {
  await chrome(instance, "const home = Services.wm.getMostRecentWindow('navigator:browser'); if (home.__cgP3b) home.__cgP3b.stop(); home.__cgP3b = null; return true;");
}

/** Firefox's own daily add-on update check, now (AddonManagerPrivate.backgroundUpdateCheck): what a chatter's browser runs. */
export async function backgroundUpdateCheck(instance: WebdriverIO.Browser): Promise<number> {
  return chromeAsync<number>(
    instance,
    `const { AddonManagerPrivate } = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
     const at = Date.now();
     await AddonManagerPrivate.backgroundUpdateCheck();
     return at;`,
  );
}

/** Pending installs of the add-on (an update held for a prompt or postponed): their states, by AddonManager.STATE_*. */
export function pendingInstalls(instance: WebdriverIO.Browser, id = P3B_GECKO_ID): Promise<Array<{ readonly version: string | null; readonly state: number }>> {
  return chromeAsync(
    instance,
    `const [id] = arguments;
     const { AddonManager } = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
     return (await AddonManager.getAllInstalls()).filter((install) => (install.addon?.id ?? install.existingAddon?.id) === id).map((install) => ({ version: install.version ?? null, state: install.state }));`,
    [id],
  );
}

/**
 * The attention dot of the extensions button for the add-on on the selected tab (OriginControls.getAttentionState,
 * what the button shows), and the button's own attribute.
 */
export function attention(instance: WebdriverIO.Browser, id = P3B_GECKO_ID): Promise<{ readonly url: string; readonly attention: boolean; readonly quarantined: boolean; readonly button: boolean }> {
  return chrome(
    instance,
    `const [id] = arguments;
     const { OriginControls } = ChromeUtils.importESModule('resource://gre/modules/ExtensionPermissions.sys.mjs');
     const win = Services.wm.getMostRecentWindow('navigator:browser');
     const policy = WebExtensionPolicy.getByID(id);
     const state = OriginControls.getAttentionState(policy, win);
     return { url: win.gBrowser.selectedBrowser.currentURI.spec, attention: state.attention, quarantined: state.quarantined, button: win.document.getElementById('unified-extensions-button')?.getAttribute('attention') === 'true' };`,
    [id],
  );
}

/** Whether the add-on asks for fansly.com and its API on request now (its optional origins), as Firefox read its manifest. */
export function declaresFansly(instance: WebdriverIO.Browser, id = P3B_GECKO_ID): Promise<boolean> {
  return chrome(
    instance,
    `const [id] = arguments;
     const policy = WebExtensionPolicy.getByID(id);
     const optional = policy?.extension?.optionalOrigins;
     return Boolean(optional && optional.matches(Services.io.newURI('https://fansly.com/')) && optional.matches(Services.io.newURI('https://apiv3.fansly.com/api/v1/')) && policy.extension.optionalPermissions.includes('webRequest'));`,
    [id],
  );
}

export interface PromptView {
  /** The tab the prompt stands on. */
  readonly url: string;
  /** What the prompt lists, as Firefox wrote it for the person. */
  readonly lines: readonly string[];
}

/** Firefox's own permission prompts of the add-on on screen now (PopupNotifications «addon-webext-permissions»). */
export function prompts(instance: WebdriverIO.Browser): Promise<readonly PromptView[]> {
  return chrome(
    instance,
    `const win = Services.wm.getMostRecentWindow('navigator:browser');
     const out = [];
     for (const tab of win.gBrowser.tabs) {
       const notification = win.PopupNotifications.getNotification('addon-webext-permissions', tab.linkedBrowser);
       if (!notification) continue;
       const strings = notification.options?.customElementOptions?.strings ?? {};
       out.push({ url: tab.linkedBrowser.currentURI.spec, lines: [strings.header ?? '', ...(strings.msgs ?? [])].map(String) });
     }
     return out;`,
  );
}

/** Answers the prompt as the person's «Allow» does: its main action. Returns how many prompts it answered. */
export function allowPrompt(instance: WebdriverIO.Browser): Promise<number> {
  return chrome(
    instance,
    `const win = Services.wm.getMostRecentWindow('navigator:browser');
     let answered = 0;
     for (const tab of win.gBrowser.tabs) {
       const notification = win.PopupNotifications.getNotification('addon-webext-permissions', tab.linkedBrowser);
       if (!notification) continue;
       notification.mainAction.callback({ source: 'button' });
       win.PopupNotifications.remove(notification);
       answered += 1;
     }
     return answered;`,
  );
}

/**
 * Opens the add-on's real toolbar popup, as a click on its button does (the browser action's own `triggerAction`).
 * Resolves with the popup browser's place in the window (CSS px) once its document is there; null — Firefox did not
 * open it (a window without focus, for one).
 */
export function openActionPopup(instance: WebdriverIO.Browser, id = P3B_GECKO_ID): Promise<{ readonly left: number; readonly top: number; readonly width: number; readonly height: number } | null> {
  return chromeAsync(
    instance,
    `const [id] = arguments;
     const { ExtensionParent } = ChromeUtils.importESModule('resource://gre/modules/ExtensionParent.sys.mjs');
     const { ViewPopup } = ChromeUtils.importESModule('resource:///modules/ExtensionPopups.sys.mjs');
     const win = Services.wm.getMostRecentWindow('navigator:browser');
     win.focus();
     const extension = WebExtensionPolicy.getByID(id).extension;
     ExtensionParent.apiManager.global.browserActionFor(extension).triggerAction(win);
     for (let i = 0; i < 200; i += 1) {
       const popup = ViewPopup.for(extension, win);
       const browser = popup?.browser;
       if (browser && browser.currentURI?.spec?.endsWith('popup.html')) {
         const rect = browser.getBoundingClientRect();
         if (rect.width > 0 && rect.height > 0) return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
       }
       await new Promise((resolve) => setTimeout(resolve, 50));
     }
     return null;`,
    [id],
  );
}

/** A real mouse click at a point of the browser window (CSS px), as the person's pointer: routed into whatever lies there. */
export function clickInWindow(instance: WebdriverIO.Browser, x: number, y: number): Promise<boolean> {
  return chrome(
    instance,
    `const [x, y] = arguments;
     const win = Services.wm.getMostRecentWindow('navigator:browser');
     // Window.synthesizeMouseEvent (chrome only), what EventUtils uses: an event as the widget would deliver it.
     const real = { isDOMEventSynthesized: false };
     win.synthesizeMouseEvent('mousemove', x, y, { button: 0, buttons: 0 }, real);
     win.synthesizeMouseEvent('mousedown', x, y, { button: 0, buttons: 1, clickCount: 1 }, real);
     win.synthesizeMouseEvent('mouseup', x, y, { button: 0, buttons: 0, clickCount: 1 }, real);
     return true;`,
    [x, y],
  );
}

/** Where the add-on's open popup stands in the window now (CSS px); null — none is open. */
export function actionPopupRect(instance: WebdriverIO.Browser, id = P3B_GECKO_ID): Promise<{ readonly left: number; readonly top: number; readonly width: number; readonly height: number } | null> {
  return chrome(
    instance,
    `const [id] = arguments;
     const { ViewPopup } = ChromeUtils.importESModule('resource:///modules/ExtensionPopups.sys.mjs');
     const win = Services.wm.getMostRecentWindow('navigator:browser');
     const browser = ViewPopup.for(WebExtensionPolicy.getByID(id).extension, win)?.browser;
     if (!browser) return null;
     const rect = browser.getBoundingClientRect();
     return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };`,
    [id],
  );
}

/** Whether the add-on's popup is open now. */
export function actionPopupOpen(instance: WebdriverIO.Browser, id = P3B_GECKO_ID): Promise<boolean> {
  return chrome(
    instance,
    `const [id] = arguments;
     const { ViewPopup } = ChromeUtils.importESModule('resource:///modules/ExtensionPopups.sys.mjs');
     const win = Services.wm.getMostRecentWindow('navigator:browser');
     return Boolean(ViewPopup.for(WebExtensionPolicy.getByID(id).extension, win));`,
    [id],
  );
}

/**
 * The tab of `instance` whose address ends with `suffix` (the onboarding a fresh install opens: options.html), the
 * session switched to it; null — none within `timeout`.
 */
export async function findTab(instance: WebdriverIO.Browser, suffix: string, timeout = 10_000): Promise<string | null> {
  const until = Date.now() + timeout;
  do {
    for (const handle of await instance.getWindowHandles()) {
      await instance.switchToWindow(handle);
      if ((await instance.getUrl()).endsWith(suffix)) return handle;
    }
    await instance.pause(200);
  } while (Date.now() < until);
  return null;
}

/** The scripts of Fansly registered in the add-on's policy now: [] — none (the manifest's ChatSpace scripts are not counted). */
export const fanslyScripts = (view: AddonView | null): string[] => (view?.scripts ?? []).filter((name) => name.startsWith('fansly'));

/** What the page's first script saw, and when the reload notice appeared (src/p3b/world.ts PROBE_SCRIPT), in the current tab. */
export async function pageProbe(instance: WebdriverIO.Browser): Promise<{ readonly start: { readonly at: number; readonly nativeWebSocket: boolean | null; readonly nativeXhr: boolean | null } | null; readonly notice: number | null }> {
  const raw = (await instance.execute(() => [document.documentElement.getAttribute('data-p3b-start'), document.documentElement.getAttribute('data-p3b-notice')])) as [string | null, string | null];
  return { start: raw[0] === null ? null : (JSON.parse(raw[0]) as { at: number; nativeWebSocket: boolean | null; nativeXhr: boolean | null }), notice: raw[1] === null ? null : Number(raw[1]) };
}
