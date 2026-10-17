// @vitest-environment happy-dom
//
// The extension pages wired whole (architecture.md §9.9, §10.2; docs/pages.md):
// the pages' composition root (src/composition/pages.ts) — the real
// controller, the real UI, the platform's ports — over the real background
// composition on the fake browser and the in-process fake hub
// (test/support/world.ts). What it proves is the wiring, not the pages
// themselves (those are R16's tests, packages/testing/src/pages):
// - a page speaks the page side of the protocol and nothing else;
// - without a sign-in the settings are the sign-in screen with the first-run
//   checklist, and neither the page nor the background asks the hub anything;
// - host access for the hub address and the measurement consent are asked of
//   the browser by the page itself, and a refusal is said with its code;
// - one settings tab; a deep link's code is the page's own address;
// - the diagnostics file leaves through a Blob;
// - the language of the settings is the language of the document.

import { DEFAULT_SETTINGS, STORAGE_KEYS, type SettingsV1 } from '@cg/contracts';
import { callsTo } from '@cg/testing/fake-hub';
import { WORLD } from '@cg/testing/hub';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BrowserApi } from '@cg/platform';
import { pageSender } from '../../../packages/platform/src/test-support/fake-browser.ts';
import { composePage, type ComposedPage, type PageName } from '../src/composition/pages.ts';
import { SITE_PAGES } from '../src/site.ts';
import { signInWithPersona, workingTab } from './support/tabs.ts';
import { PASSWORD, createWorld, settingsFor, sleep, until, type World } from './support/world.ts';

interface HappyWindow {
  readonly happyDOM: { setURL(url: string): void };
}

let world: World | null = null;
const pages: ComposedPage[] = [];

beforeEach(() => {
  for (const level of ['debug', 'info', 'warn', 'error'] as const) vi.spyOn(console, level).mockImplementation(() => undefined);
});
afterEach(async () => {
  for (const page of pages.splice(0)) page.dispose();
  document.body.replaceChildren();
  world?.dispose();
  world = null;
  await sleep(30);
  vi.restoreAllMocks();
});

function start(options?: Parameters<typeof createWorld>[0]): World {
  world = createWorld(options);
  world.start();
  return world;
}

/** Opens one of our pages as the browser would: its own document address, its own extension context. */
function open(w: World, page: PageName, address = '', tabId: number | null = 31): { readonly page: ComposedPage; readonly root: HTMLElement; readonly api: BrowserApi } {
  const url = `${w.fake.base}${page}.html${address}`;
  (window as unknown as HappyWindow).happyDOM.setURL(url);
  const root = document.createElement('div');
  root.id = 'app';
  document.body.append(root);
  const sender = pageSender(w.fake, page, tabId === null ? { url } : { url, tab: { id: tabId }, frameId: 0 });
  const api = w.fake.context(sender).api;
  const composed = composePage(page, root, { api });
  if (composed === null) throw new Error('the page was not composed');
  pages.push(composed);
  return { page: composed, root, api };
}

const text = (root: HTMLElement): string => (root.textContent ?? '').replace(/\s+/g, ' ').trim();
const storedSettings = (w: World): SettingsV1 => w.fake.areas.local.get(STORAGE_KEYS.settings) as SettingsV1;

describe('the settings page before a sign-in', () => {
  it('[ST-011] [ST-012] [UP-008] is the sign-in screen with the first-run checklist; neither the page nor the background asks the hub', async () => {
    const w = start();
    const { page, root } = open(w, 'options');
    await until(() => root.querySelector('.pg-signin') !== null, 'the sign-in screen');
    expect(root.querySelector('.pg-page')?.hasAttribute('data-pg-gate')).toBe(true);
    // X55: the chatter's three, then the team lead's four under «Ещё»; no «Установить расширение».
    expect([...root.querySelectorAll('.pg-check__item')].map((item) => item.getAttribute('data-pg-step'))).toEqual(['host-permission', 'sign-in', 'open-chatspace', 'persona', 'binding', 'consent', 'sound-hotkeys']);
    expect([...root.querySelectorAll('.pg-check__more .pg-check__item')].map((item) => item.getAttribute('data-pg-step'))).toEqual(['persona', 'binding', 'consent', 'sound-hotkeys']);
    // The version of the manifest, the address the next sign-in goes to, the help page of the site.
    expect(page.client.getSnapshot({ of: 'options', section: 'account' })).toMatchObject({ version: '1.2.3', view: { s: 'forbidden', error: { code: 'CG-AUTH-REQUIRED' } }, signIn: { hubOrigin: WORLD.hubOrigin } });
    expect(root.querySelector<HTMLAnchorElement>('a.pg-link[target="_blank"]')?.href).toBe(SITE_PAGES.start);
    // A page opened without a sign-in reads the status, and nothing of it reaches the hub — its health included.
    await until(() => page.client.getSnapshot({ of: 'options', section: 'status' }).checklist !== null, 'the first reads settled');
    await sleep(50);
    expect(w.hub.read().entries).toEqual([]);
  });

  it('[ST-135] [I18-001] a fresh install in a browser set to English is Russian from its first frame: the document, its title, the sign-in screen (1.14.0, X29)', async () => {
    // The browser of this test speaks English, as a stock Firefox or an antidetect profile does.
    expect(window.navigator.languages[0]).toMatch(/^en/);
    const w = start();
    const { root } = open(w, 'options');
    // Before the background answered anything: the default's language, not the browser's.
    expect(document.documentElement.lang).toBe('ru');
    expect(document.title).toBe('Настройки ChatGoose');
    await until(() => root.querySelector('.pg-signin') !== null, 'the sign-in screen');
    expect(document.documentElement.lang).toBe('ru');
    // The first start writes the defaults down: from then on the language is a stored value, not a default.
    expect(storedSettings(w).ui.locale).toBe('ru');
    expect(text(root)).toContain('Войти');
    expect(text(root)).not.toContain('Sign in');
  });

  it('[ST-043] [ST-046] a custom hub address asks the browser for its host inside the action; a refusal keeps the address and says «не разрешён», and the sign-in is refused with CG-HUB-HOST-PERMISSION', async () => {
    const w = start();
    const { page, root } = open(w, 'options');
    await until(() => root.querySelector('.pg-signin') !== null, 'the sign-in screen');
    w.fake.grantRequests = false;
    const saved = await page.client.dispatch({ type: 'SetPreference', key: 'hub.baseUrl', value: 'hub.custom.test/login' });
    expect(saved).toMatchObject({ ok: true });
    // Normalized, stored by the background, and the browser said no.
    expect(storedSettings(w).hub.baseUrl).toBe('https://hub.custom.test');
    expect(w.fake.permissions.origins.has('https://hub.custom.test/*')).toBe(false);
    await until(() => root.querySelector('[data-pg-access]')?.getAttribute('data-pg-access') === 'missing', '«не разрешён» on the sign-in screen');
    const refused = await page.client.dispatch({ type: 'SignIn', login: WORLD.user.username, password: PASSWORD });
    expect(refused).toMatchObject({ ok: false, code: 'CG-HUB-HOST-PERMISSION' });
    expect(w.hub.read().entries).toEqual([]);

    // «Разрешить»: the browser grants, the row follows without a reload.
    w.fake.grantRequests = true;
    expect(await page.client.dispatch({ type: 'RequestPermission', kind: 'hub-host' })).toMatchObject({ ok: true });
    expect(w.fake.permissions.origins.has('https://hub.custom.test/*')).toBe(true);
    await until(() => root.querySelector('[data-pg-access]')?.getAttribute('data-pg-access') === 'granted', '«разрешён»');
    // An address of the host platform is never a hub: refused by the background, nothing stored (quiet mode, X3).
    const quiet = await page.client.dispatch({ type: 'SetPreference', key: 'hub.baseUrl', value: 'https://chat.onlymonster.ai' });
    expect(quiet).toMatchObject({ ok: false, code: 'CG-HUB-URL' });
    expect(storedSettings(w).hub.baseUrl).toBe('https://hub.custom.test');
  });
});

describe('a sign-in through the page', () => {
  it('[AU-001] [ST-046] [ST-056] a wrong password is the hub’s code on the form and one count of today’s hub errors; the right one replaces the sign-in screen with the settings', async () => {
    const w = start();
    await workingTab(w);
    const { page, root } = open(w, 'options');
    await until(() => root.querySelector('.pg-signin') !== null, 'the sign-in screen');
    expect(await page.client.dispatch({ type: 'SignIn', login: WORLD.user.username, password: 'not-the-password' })).toMatchObject({ ok: false, code: 'CG-LOGIN-CREDENTIALS' });
    await until(() => root.querySelector('form [data-cg-code="CG-LOGIN-CREDENTIALS"]') !== null, 'the refusal on the form');
    // Host access for the hub address was asked of the browser before the request went out.
    expect(w.fake.permissions.origins.has(`${WORLD.hubOrigin}/*`)).toBe(true);
    const diagnostics = await w.page().request('diagnostics.get', {});
    expect(diagnostics.ok && diagnostics.payload.counters['CG-LOGIN-CREDENTIALS']).toBe(1);

    expect(await page.client.dispatch({ type: 'SignIn', login: WORLD.user.username, password: PASSWORD })).toMatchObject({ ok: true });
    await until(() => root.querySelector('.pg-page')?.getAttribute('data-pg-section') === 'status', '«Статус» instead of the sign-in screen');
    await until(() => root.querySelector('[data-pg-row="binding"]')?.getAttribute('data-pg-level') === 'ok', 'the open account is bound');
    expect(root.querySelector('[data-pg-row="account"]')?.textContent).toContain(WORLD.user.username);
    // Signed in, the status reads the hub's health — once.
    expect(callsTo(w.hub.read().entries, 'health').length).toBeGreaterThanOrEqual(1);
    // The password is nowhere on the page.
    expect(root.innerHTML).not.toContain(PASSWORD);
  });

  it('[ST-007] [ST-008] [ST-009] a deep link by code opens its section with the plate and highlights what the code is about; the section moves without a reload', async () => {
    const w = start();
    await signInWithPersona(w);
    const { page, root } = open(w, 'options', '#status:CG-QUOTA-DAILY');
    await until(() => root.querySelector('[data-pg-plate="CG-QUOTA-DAILY"]') !== null, 'the plate of the deep link');
    expect(root.querySelector('.pg-page')?.getAttribute('data-pg-section')).toBe('status');
    await until(() => root.querySelector('[data-pg-anchor="quota"]')?.classList.contains('is-target') === true, 'the quota row is highlighted');
    // A code alone finds its section in the error registry (an error toast's «Настройки»).
    window.location.hash = '#CG-PERSONA-UNASSIGNED';
    await until(() => root.querySelector('.pg-page')?.getAttribute('data-pg-section') === 'personas', 'the section of the code');
    expect(root.querySelector('[data-pg-plate="CG-PERSONA-UNASSIGNED"]')).not.toBeNull();
    // A section chosen on the page is this tab's address: a new history entry, so Back returns.
    expect(await page.client.dispatch({ type: 'OpenSettings', route: { section: 'generation' } })).toMatchObject({ ok: true, outcome: 'opened' });
    expect(window.location.hash).toBe('#generation');
    await until(() => root.querySelector('.pg-page')?.getAttribute('data-pg-section') === 'generation', '«Генерация»');
    expect(w.fake.tabCalls).toEqual([]);
  });
});

describe('what a page asks of the browser', () => {
  it('[ST-006] «Открыть настройки» of the popup focuses the settings tab that is open and points it at the section; without one it opens the page', async () => {
    const w = start();
    await signInWithPersona(w);
    const { page } = open(w, 'popup', '', null);
    await until(() => page.client.getSnapshot({ of: 'popup' }).view.s !== 'loading', 'the popup');
    expect(await page.client.dispatch({ type: 'OpenSettings', route: { section: 'status' } })).toMatchObject({ ok: true, outcome: 'opened' });
    expect(w.fake.tabCalls).toEqual([`create ${w.fake.base}options.html#status`]);
    w.fake.tabCalls.length = 0;
    // The settings are open in tab 41 now.
    w.fake.context(pageSender(w.fake, 'options', { url: `${w.fake.base}options.html#status`, tab: { id: 41 }, frameId: 0 }));
    expect(await page.client.dispatch({ type: 'OpenSettings', route: { section: 'account', code: 'CG-AUTH-REQUIRED' } })).toMatchObject({ ok: true });
    expect(w.fake.tabCalls).toEqual([`update 41 ${w.fake.base}options.html#account:CG-AUTH-REQUIRED`, 'focus window 1']);
  });

  it('[PU-017] [ST-005] a popup button acts in the ChatSpace tab; «Что нового» opens the site page in a new tab and takes the «нов.» mark off', async () => {
    const w = start();
    await signInWithPersona(w);
    const tab = await workingTab(w);
    const commands: unknown[] = [];
    tab.client.onEvent('tab.command', (payload) => commands.push(payload.command));
    const { page } = open(w, 'popup', '', null);
    await until(() => page.client.getSnapshot({ of: 'popup' }).account !== null, 'the popup of a signed-in person');
    expect(await page.client.dispatch({ type: 'Navigate', to: { kind: 'surface', surface: 'spenders', open: true } })).toMatchObject({ ok: true, outcome: 'opened' });
    await until(() => commands.length === 1, 'the tab got the command');
    expect(commands).toEqual([{ kind: 'surface', surface: 'spenders' }]);
    expect(w.fake.tabCalls).toEqual(['update 7', 'focus window 1']);
    w.fake.tabCalls.length = 0;

    expect(await page.client.dispatch({ type: 'Navigate', to: { kind: 'page', page: 'whats-new' } })).toMatchObject({ ok: true, outcome: 'opened' });
    expect(w.fake.tabCalls).toEqual([`create ${SITE_PAGES.whatsNew}`]);
    await until(() => storedSettings(w).onboarding.lastSeenVersion === '1.2.3', 'the notes of this version are seen');
  });

  it('[ST-108] [LG-020] «Выгрузить диагностику» leaves through a Blob: the JSON file, then the short text one — no download permission, nothing of a sign-in in them', async () => {
    const w = start();
    await signInWithPersona(w);
    const { page } = open(w, 'options', '#diagnostics');
    const blobs: Blob[] = [];
    const saved: { name: string; href: string }[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      blobs.push(blob as Blob);
      return `blob:test/${String(blobs.length)}`;
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      saved.push({ name: this.download, href: this.href });
    });
    expect(await page.client.dispatch({ type: 'ExportDiagnostics' })).toMatchObject({ ok: true });
    expect(saved.map((file) => file.name.replace(/\d{8}-\d{6}|\d{4}-\d{2}-\d{2}[T-]?[\d-]*/g, '*'))).toHaveLength(2);
    expect(saved[0]?.name).toMatch(/\.json$/);
    expect(saved[1]?.name).toMatch(/\.txt$/);
    expect(saved.map((file) => file.href)).toEqual(['blob:test/1', 'blob:test/2']);
    const json = JSON.parse(await (blobs[0] as Blob).text()) as { extension?: { version?: string } };
    expect(json.extension?.version).toBe('1.2.3');
    const all = `${await (blobs[0] as Blob).text()}\n${await (blobs[1] as Blob).text()}`;
    expect(all).not.toContain(PASSWORD);
    // The anchors that carried the files are gone from the page.
    expect(document.querySelectorAll('a[download]')).toHaveLength(0);
  });

  it('[TL-015] [ST-034] the measurement consent is asked of the browser by the page; the status row and the background follow it', async () => {
    const w = start();
    await signInWithPersona(w);
    const { page, root } = open(w, 'options', '#status');
    await until(() => root.querySelector('[data-pg-row="consent"]')?.getAttribute('data-pg-level') === 'warn', 'the consent row asks');
    expect(w.fake.permissions.data_collection.has('technicalAndInteraction')).toBe(false);
    // The person closes the browser's question: nothing is granted, nothing breaks.
    w.fake.grantRequests = false;
    expect(await page.client.dispatch({ type: 'RequestPermission', kind: 'data-collection' })).toMatchObject({ ok: true, outcome: 'noop' });
    expect(root.querySelector('[data-pg-row="consent"]')?.getAttribute('data-pg-level')).toBe('warn');
    w.fake.grantRequests = true;
    expect(await page.client.dispatch({ type: 'RequestPermission', kind: 'data-collection' })).toMatchObject({ ok: true, outcome: 'done' });
    expect(w.fake.permissions.data_collection.has('technicalAndInteraction')).toBe(true);
    await until(() => root.querySelector('[data-pg-row="consent"]')?.getAttribute('data-pg-level') === 'ok', 'the consent row says «включены»');
    await until(async () => {
      const diagnostics = await w.page().request('diagnostics.get', {});
      return diagnostics.ok && diagnostics.payload.telemetry.consent === true;
    }, 'the background heard the consent');
  });

  it('[I18-001] [ST-124] the language of the settings is the language of the document, its title included, and it changes on the fly', async () => {
    const w = start({ settings: settingsFor() });
    await signInWithPersona(w);
    const { page, root } = open(w, 'options', '#appearance');
    await until(() => page.client.getSnapshot({ of: 'options', section: 'appearance' }).body !== null, '«Вид и звук» is drawn');
    expect(await page.client.dispatch({ type: 'SetPreference', key: 'ui.locale', value: 'ru' })).toMatchObject({ ok: true });
    await until(() => document.documentElement.lang === 'ru', 'Russian');
    expect(document.title).toBe('Настройки ChatGoose');
    expect(await page.client.dispatch({ type: 'SetPreference', key: 'ui.locale', value: 'en' })).toMatchObject({ ok: true });
    await until(() => document.documentElement.lang === 'en', 'English');
    expect(document.title).toBe('ChatGoose settings');
    expect(text(root)).toContain('Look and sound');
    // «Сохранено ✓» carries the revision the background gave the write.
    const stored = await w.page().request('settings.get', {});
    expect(page.client.getSnapshot({ of: 'options', section: 'appearance' }).save).toEqual({ s: 'saved', revision: stored.ok ? stored.payload.revision : -1 });
    await until(() => root.querySelector('[data-pg-save="saved"]')?.getAttribute('data-pg-revision') === String(stored.ok ? stored.payload.revision : -1), '«Saved ✓» with the revision');
  });
});

describe('the debug pages', () => {
  it('[DB-006] [DB-007] the prompt page takes the token of its own address to the background — and nowhere else: not into the page, not into its title', async () => {
    const w = start({ settings: settingsFor(undefined, { debug: { enabled: true, renderTrace: false } }) });
    await signInWithPersona(w);
    const asked: unknown[] = [];
    w.fake.background()?.events.onMessage.addListener(((message: { type?: string; payload?: unknown }) => {
      if (message.type === 'debug.prompt') asked.push(message.payload);
      return undefined;
    }) as never);
    const { root } = open(w, 'debug-prompt', '?t=prompt-token-7');
    await until(() => asked.length === 1, 'the page asked for its snapshot');
    expect(asked).toEqual([{ token: 'prompt-token-7' }]);
    // The background holds no snapshot under this token: the page says so honestly, with nothing of a prompt.
    await until(() => root.querySelector('[data-pg-prompt]') !== null, 'the page says what it has');
    expect(root.querySelectorAll('pre')).toHaveLength(0);
    expect(document.documentElement.outerHTML).not.toContain('prompt-token-7');
    expect(document.title).not.toContain('prompt-token-7');
  });


  it('[DB-001] [NF-029] ask nothing while debug is off; with it on the journal page reads the journal of its address, and another journal in the address is read in the same page', async () => {
    const w = start({ settings: settingsFor(undefined, { ui: { ...DEFAULT_SETTINGS.ui, locale: 'ru' } }) });
    await signInWithPersona(w);
    const asked: string[] = [];
    w.fake.background()?.events.onMessage.addListener(((message: { type?: string; payload?: { journal?: string } }) => {
      if (message.type === 'journal.read') asked.push(`journal.read:${message.payload?.journal ?? '?'}`);
      else if (message.type === 'debug.prompt') asked.push('debug.prompt');
      return undefined;
    }) as never);
    const { root } = open(w, 'debug-journal', '#hub-calls');
    await until(() => text(root).length > 0, 'the journal page drew something');
    await sleep(50);
    expect(asked).toEqual([]);
    expect(root.querySelector('[data-pg-journal="debug-off"]')).not.toBeNull();
    expect(document.title).toBe('ChatGoose · Журнал');

    expect(await w.page().request('settings.patchRestricted', { patch: { debug: { enabled: true } }, baseRevision: null })).toMatchObject({ ok: true });
    // The journal the address names, and no other.
    await until(() => asked.length > 0, 'the journal is read once debug is on');
    expect([...new Set(asked)]).toEqual(['journal.read:hub-calls']);
    // «Журналы» of the settings point the open journal tab at another journal: the page follows its address.
    window.location.hash = '#operations';
    window.dispatchEvent(new Event('hashchange'));
    await until(() => asked.includes('journal.read:operations'), 'the other journal is read');
    expect(asked).not.toContain('debug.prompt');
  });
});

describe('optional-site page copy', () => {
  it('uses the Fansly status title when the site is enabled', async () => {
    const w = start(); await signInWithPersona(w);
    expect(await w.page().request('site.access', { host: 'fansly-web', enabled: true })).toMatchObject({ ok: true });
    const { page } = open(w, 'options', '#status');
    await until(() => page.client.getSnapshot({ of: 'options', section: 'status' }).body !== null, 'status');
    const snapshot = page.client.getSnapshot({ of: 'options', section: 'status' });
    if (snapshot.body === null) throw new Error('status unavailable');
    const row = snapshot.body.rows.find((entry) => entry.id === 'host' && entry.host === 'fansly-web');
    expect(row?.title).toMatchObject({ key: 'settings.status.site.title', params: { site: 'Fansly' } });
  });
  it('changes activation labels with the selected language', async () => {
    const w = start(); await signInWithPersona(w);
    const { page, root } = open(w, 'options', '#status');
    await until(() => page.client.getSnapshot({ of: 'options', section: 'status' }).body !== null, 'status');
    expect(text(root)).toContain('Включить Fansly');
    await page.client.dispatch({ type: 'SetPreference', key: 'ui.locale', value: 'en' });
    await until(() => document.documentElement.lang === 'en', 'English');
    expect(text(root)).toContain('Enable Fansly');
    expect(text(root)).not.toContain('Включить Fansly');
  });
  it('explains an activation failure instead of displaying a bare error code', async () => {
    const w = start();
    const { root, api } = open(w, 'popup');
    await until(() => text(root).includes('Включить Fansly') && root.querySelector('button[aria-busy="true"]') === null, 'activation');
    w.fake.grantRequests = true;
    // A lost RPC is explained on the activation surface.
    const request = vi.spyOn(api.runtime, 'sendMessage').mockRejectedValue(new Error('unavailable'));
    const button = [...root.querySelectorAll('button')].find((node) => node.textContent?.includes('Включить Fansly'));
    button?.click();
    await until(() => text(root).includes('CG-RUNTIME-UNREACHABLE'), 'activation error');
    expect(text(root)).toContain('Расширение не отвечает');
    expect(text(root)).toContain('Повторить');
    request.mockRestore();
  });
});
