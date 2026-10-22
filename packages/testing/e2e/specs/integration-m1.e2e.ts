// Integration step M1 (architecture.md §2, §5.4, §8, §12 п. 4): the TEST build
// as a whole — background, isolated and MAIN content scripts, lazy chunks,
// the real settings page and popup, the real dock — on the ChatSpace-like
// stand, against the fake hub on loopback. What it proves end to end:
// - the background is ready and answers the page protocol before any sign-in;
//   the settings page is the sign-in screen with the first-run checklist, and
//   nothing asks the hub while nobody is signed in;
// - the hub address changes in «Дополнительно» only while signed out (ST-042);
// - a sign-in through the settings page reaches the fake hub, the bootstrap
//   arrives, and an already open ChatSpace tab learns it without a reload;
// - the tab registers; outside a chat nothing of the application is loaded
//   (EX-011); with a composer the lazy chunks come by import() (EX-009) and
//   the dock sits above the active composer in a closed shadow root with its
//   own sheets, nothing global (EX-012), and follows chat switches;
// - the dock follows what the hub says about the open account: nobody signed
//   in → signed in without a persona → the page's persona and its name — or
//   the CG-BINDING-* code of an account no page is linked to;
// - the WS tap is registered only by the bootstrap flag;
// - a sign-out revokes the token, clears the session and every tab hears it;
// - a hub without `client/bootstrap` (404) runs on the DEV-ONLY synthesized
//   bootstrap with debug mode on (docs/hub-layer.md);
// - not one request left loopback (network trap), and the fake hub saw no
//   call the client must never make.
// Test titles carry the parity rows they prove.

import { CONTRACTS_VERSION, DEFAULT_SETTINGS, STORAGE_KEYS, type SettingsV1 } from '@cg/contracts';
import { browser, expect } from '@wdio/globals';

import { pilotPageFlags } from '../../src/fake-hub/config';
import { callsTo } from '../../src/fake-hub/journal';
import { PAGE, WORLD } from '../../src/scenarios/hub';
import { DEV_COMPAT_PAGES_KEY } from '../support/constants';
import { installTestBuild, pageRpc, readLocalStorage, readReport, waitForReport, writeLocalStorage, type DockReport, type SpikeReport } from '../support/extension';
import { fakeHubOrigin, testBuildPage, useFakeHub } from '../support/fake-hub';
import { useNetworkTrap } from '../support/network-trap';
import { capturePage, choosePersona, openOptions, openPopup, readOptions, saveHubAddress, signOutFromAccount, submitSignIn, waitForOptions, waitForPopup } from '../support/pages';
import { callStand, chatPath, composerRoots, dockPlacement, foreignCalls, openStand, STAND_IDS, standServer, waitForChatReady, waitForStandReady } from '../support/stand';

const { a: accountA, b: accountB } = STAND_IDS.accounts;
const { a1, a2, b1 } = STAND_IDS.fans;
const PASSWORD = 'synthetic-password';
/** A loopback address nothing listens on (the discard port): «the hub does not answer» without leaving the machine. */
const DEAD_HUB = 'http://127.0.0.1:9';

interface Diagnostics {
  readonly extension: { readonly version: string; readonly contractsVersion: string; readonly testBuild: boolean };
  readonly session: { readonly signedIn: boolean; readonly hubOrigin: string | null; readonly role: string | null };
  readonly hub: { readonly reachable: boolean | null; readonly flags: Readonly<Record<string, boolean>> };
  readonly tabs: ReadonlyArray<{ readonly tabSessionId: string; readonly host: { readonly build: string | null } | null; readonly chatKey: string | null }>;
}

/** Ids of the dynamically registered content scripts, read from the extension page the browser is on. */
async function registeredScripts(): Promise<string[]> {
  return browser.execute(async () => {
    const api = (globalThis as unknown as { browser: { scripting: { getRegisteredContentScripts(): Promise<Array<{ id: string }>> } } }).browser;
    return (await api.scripting.getRegisteredContentScripts()).map((script) => script.id);
  });
}

/** Where a dynamically registered content script runs: its match patterns and its world. */
async function registeredScript(id: string): Promise<{ readonly matches: string[]; readonly world: string | null; readonly runAt: string | null } | null> {
  return browser.execute(async (wanted: string) => {
    const api = (globalThis as unknown as { browser: { scripting: { getRegisteredContentScripts(): Promise<Array<{ id: string; matches?: string[]; world?: string; runAt?: string }>> } } }).browser;
    const script = (await api.scripting.getRegisteredContentScripts()).find((item) => item.id === wanted);
    return script === undefined ? null : { matches: [...(script.matches ?? [])].sort(), world: script.world ?? null, runAt: script.runAt ?? null };
  }, id);
}

/** The style elements and sheets of the page, by what they are (never their text). */
async function pageSheets(): Promise<{ readonly nodes: string[]; readonly adopted: number; readonly ours: number }> {
  return browser.execute(() => {
    const nodes = [...document.querySelectorAll<HTMLElement>('style, link[rel="stylesheet"]')];
    const textOf = (node: HTMLElement): string => (node instanceof HTMLStyleElement ? (node.textContent ?? '') : '');
    return {
      nodes: nodes.map((node) => (node instanceof HTMLLinkElement ? `link:${new URL(node.href).protocol}` : `style:${[...node.attributes].map((attribute) => attribute.name).join(',')}`)),
      adopted: document.adoptedStyleSheets.length,
      // A sheet of ours would come from the extension or carry the kit's names.
      ours: nodes.filter((node) => (node instanceof HTMLLinkElement ? node.href.startsWith('moz-extension:') : /\.cg-|--cg-|data-cg/.test(textOf(node)))).length,
    };
  });
}

describe('integration M1 — the test build on the stand against the fake hub', () => {
  useNetworkTrap();
  const { hub } = useFakeHub();
  let journalStart = 0;
  /** The fake hub is one for the whole run: its journal is read from here on. */
  let hubStart = 0;
  let standTab = '';
  let pagesTab = '';

  const toStand = async (): Promise<void> => browser.switchToWindow(standTab);
  const toPages = async (): Promise<void> => browser.switchToWindow(pagesTab);
  const dockIs = (predicate: (dock: DockReport, report: SpikeReport) => boolean, message: string): Promise<SpikeReport> =>
    waitForReport((report) => report.appError !== undefined || (report.dock !== undefined && predicate(report.dock, report)), message).then((report) => {
      if (report.appError !== undefined) throw new Error(`${message}: the tab application failed to start: ${report.appError}`);
      return report;
    });

  before(async () => {
    await standServer.reset();
    journalStart = await standServer.mark();
    // The owner linked the hub page to the creator account ChatSpace shows as account A of the stand.
    await hub().command({ op: 'pageAccount', pageLabel: PAGE, platformAccountId: STAND_IDS.platformAccounts.a });
    hubStart = await hub().mark();
    await installTestBuild();
    // The build's default hub is the real one. Before any status surface asks for its health, the address
    // goes to a dead loopback port — from the journal page, which asks the background for no status.
    await browser.url(testBuildPage('debug-journal.html'));
    const settings: SettingsV1 = { ...DEFAULT_SETTINGS, hub: { baseUrl: DEAD_HUB } };
    await writeLocalStorage({ [STORAGE_KEYS.settings]: settings });
    await browser.waitUntil(async () => (await pageRpc<{ settings: SettingsV1 }>('settings.get')).ok, { timeout: 15_000, timeoutMsg: 'the background did not answer settings.get' });
    await browser.waitUntil(
      async () => {
        const state = await pageRpc<{ settings: SettingsV1 }>('settings.get');
        return state.ok && state.payload.settings.hub.baseUrl === DEAD_HUB;
      },
      { timeout: 5000, timeoutMsg: 'the settings owner did not pick the hub address up' },
    );
    standTab = await browser.getWindowHandle();
    pagesTab = (await browser.createWindow('tab')).handle;
  });

  after(async () => {
    // §12 «Гейт безопасности»: nothing but the page's own client and the harness talked to the stand.
    expect(foreignCalls((await standServer.journal(journalStart)).entries)).toEqual([]);
  });

  it('[ST-011] [ST-012] the background is ready before any sign-in: the page protocol answers, the settings page is the sign-in screen with the first-run checklist, and nothing asks a hub', async () => {
    await toPages();
    const page = await openOptions();
    // Nobody is signed in: the sign-in screen stands instead of the settings, whatever the address says.
    expect(page).toMatchObject({ gate: true, section: null, hubAddress: DEAD_HUB, lang: 'ru' });
    expect(page.documentTitle).toBe('Настройки ChatGoose');
    // The first run starts here: the chatter's three steps, then the team lead's under «Ещё» (X55); the sign-in still to do.
    expect(page.checklist.map((step) => step.id)).toEqual(['host-permission', 'sign-in', 'open-chatspace', 'persona', 'binding', 'consent', 'sound-hotkeys']);
    expect(page.checklist.find((step) => step.id === 'sign-in')?.done).toBe(false);
    const diagnostics = await pageRpc<Diagnostics>('diagnostics.get');
    expect(diagnostics).toMatchObject({ ok: true, payload: { extension: { testBuild: true, contractsVersion: CONTRACTS_VERSION }, session: { signedIn: false, hubOrigin: null }, hub: { reachable: null }, tabs: [] } });
    await capturePage('ext-options-sign-in');
    // Nobody is signed in, so no hub was asked anything — not the fake one, not the dead address (the network
    // trap would have seen any other). The hub's health is read for a sign-in only.
    expect((await hub().journal(hubStart)).entries).toEqual([]);
  });

  it('[EX-011] a ChatSpace tab outside a chat registers and loads nothing of the application: no lazy chunk, no dock', async () => {
    await toStand();
    await openStand(chatPath(accountA), { waitForChat: false });
    const report = await waitForReport((r) => r.rpc?.registered === true && r.main !== undefined, 'the tab registered with the background');
    expect(report.main?.readyStateAtStart).toBe('loading');
    expect(report.lifecycle).toEqual({ staleHosts: 0, lateInjection: false });
    // Give a wrongly eager loader the time to show itself.
    await browser.pause(700);
    const later = await readReport();
    expect(later?.app).toBeUndefined();
    expect(later?.appError).toBeUndefined();
    expect(later?.dock).toBeUndefined();
    expect((await dockPlacement()).visible).toBe(false);
    // The background knows the tab (and the creator accounts ChatSpace showed in it).
    await toPages();
    await openOptions();
    const diagnostics = await pageRpc<Diagnostics>('diagnostics.get');
    expect(diagnostics.ok && diagnostics.payload.tabs).toHaveLength(1);
    const seen = await pageRpc<{ accounts: ReadonlyArray<{ account: { hostAccountId: string; platformAccountId: string | null }; openTabs: number }> }>('accounts.seen');
    expect(seen.ok && seen.payload.accounts.map((item) => item.account.hostAccountId).sort()).toEqual(expect.arrayContaining([accountA, accountB]));
  });

  it('[EX-009] [EX-012] opening a chat loads the lazy chunks by import() and mounts the dock above the active composer: a closed root with its own sheets, nothing global', async () => {
    await toStand();
    await callStand('openChat', accountA, a1);
    await waitForChatReady(accountA, a1);
    const report = await dockIs((dock) => dock.status === 'not-signed-in', 'the dock says «not signed in»');
    expect(report.app?.loadMs).toBeGreaterThan(0);
    expect(report.dock).toMatchObject({ kind: 'in-flow', inFlowFirstChild: true, styleMode: 'adopted', visible: true, login: '', banner: 'CG-AUTH-REQUIRED', contract: 'ok', strip: true });
    // The strip is drawn with its seven actions, all off: nobody is signed in.
    expect(Object.keys(report.dock?.actions ?? {})).toEqual(['reply', 'fix', 'hi', 'ping', 'review', 'recap', 'coach']);
    expect(Object.values(report.dock?.actions ?? {}).some(Boolean)).toBe(false);
    expect(report.dock?.surfaces).toEqual(['dock', 'toasts']);
    expect(report.dock?.height).toBeGreaterThan(30);

    const roots = await composerRoots();
    expect(roots.active).toHaveLength(1);
    expect(await dockPlacement()).toEqual({ hosts: 1, parentKey: roots.active[0], firstChild: true, visible: true });
    const host = await browser.execute(() => {
      const node = document.querySelector('[data-host="dock"]');
      return {
        shadowRootVisibleToPage: node?.shadowRoot !== null,
        lightChildren: node?.childElementCount ?? -1,
        // Every element of ours in the page's tree is a host element: nothing is rendered outside a root.
        ours: [...document.querySelectorAll('[data-host]')].map((element) => element.getAttribute('data-host')).sort(),
        classesOfOursInPage: document.querySelectorAll('[class*="cg-"]').length,
      };
    });
    expect(host.shadowRootVisibleToPage).toBe(false);
    expect(host.lightChildren).toBe(0);
    expect(host.classesOfOursInPage).toBe(0);
    for (const kind of host.ours) expect(['dock', 'overlay', 'rail', 'panel', 'preview']).toContain(kind);
    // No stylesheet of ours in the page: the sheets live in the closed roots (adoptedStyleSheets);
    // what the page has is the fixture's own (its bundle's link, the editor's injected <style>).
    const sheets = await pageSheets();
    expect(sheets.ours).toBe(0);
    expect(sheets.adopted).toBe(0);
    expect(sheets.nodes.filter((node) => node.startsWith('link:') && node !== 'link:http:')).toEqual([]);
  });

  it('[ST-006] [ST-007] [ST-009] «Войти» in the dock’s banner leads to the settings: the one settings tab is pointed at «Аккаунт» with the code, the sign-in form is highlighted, no second tab opens', async () => {
    await toStand();
    const report = await dockIs((dock) => dock.status === 'not-signed-in' && dock.hits['banner'] !== undefined, 'the banner shows its button');
    const point = report.dock?.hits['banner'];
    if (point === undefined) throw new Error('the banner shows no button to press');
    const before = await browser.getWindowHandles();
    // A real pointer press: a content script cannot open our pages, the background does (`settings.open`).
    await browser.action('pointer', { parameters: { pointerType: 'mouse' } }).move({ x: point.x, y: point.y, origin: 'viewport' }).down().up().perform();
    await toPages();
    await browser.waitUntil(async () => (await browser.getUrl()).endsWith('options.html#account:CG-AUTH-REQUIRED'), { timeout: 10_000, timeoutMsg: 'the settings tab was not pointed at the account section' });
    expect(await browser.getWindowHandles()).toEqual(before);
    // The page heard the new address without a reload: what the code is about — the sign-in form — carries the
    // highlight (for two seconds).
    const shown = await waitForOptions((state) => state.targets.includes('sign-in'), 'the sign-in form is highlighted', 5000);
    expect(shown.gate).toBe(true);
    await browser.waitUntil(async () => (await readOptions()).targets.length === 0, { timeout: 5000, timeoutMsg: 'the highlight did not fade' });
  });

  it('[ST-042] the hub address is saved in «Дополнительно» while signed out, and the fake hub answers', async () => {
    await toPages();
    await openOptions();
    const mark = await hub().mark();
    await saveHubAddress(fakeHubOrigin());
    // The page asked the browser for the host's access inside the click, and the background confirmed the write.
    const page = await waitForOptions((state) => state.hubAddress === fakeHubOrigin() && state.access === 'granted', 'the address is saved and the host access is there');
    expect(page.codes).toEqual([]);
    await browser.waitUntil(async () => ((await readLocalStorage([STORAGE_KEYS.settings]))[STORAGE_KEYS.settings] as SettingsV1).hub.baseUrl === fakeHubOrigin(), { timeout: 5000, timeoutMsg: 'the address did not reach the settings' });
    // Saving an address asks the hub nothing: nobody is signed in yet.
    expect((await hub().journal(mark)).entries).toEqual([]);
  });

  it('a wrong password is refused with the hub’s code and nothing is stored', async () => {
    await submitSignIn(WORLD.user.username, 'not-the-password');
    const page = await waitForOptions((state) => state.codes.length > 0, 'the sign-in error card');
    expect(page.gate).toBe(true);
    expect(page.codes).toEqual(['CG-LOGIN-CREDENTIALS']);
    // The password left the form with the attempt.
    expect(await browser.execute(() => document.querySelector<HTMLInputElement>('form.pg-form input[type="password"]')?.value)).toBe('');
    expect(await readLocalStorage([STORAGE_KEYS.authToken, STORAGE_KEYS.authMeta])).toEqual({});
  });

  it('[ST-046] [AU-001] sign-in through the settings page reaches the fake hub; the settings replace the sign-in screen, and the bootstrap arrives with the page linked to the stand account', async () => {
    const mark = await hub().mark();
    await submitSignIn(WORLD.user.username, PASSWORD);
    // The sign-in screen gives way to «Статус»: the hub answers, the person is named, the open account is bound.
    const page = await waitForOptions((state) => !state.gate && state.rows['hub']?.level === 'ok' && state.rows['account']?.level === 'ok' && state.rows['binding']?.level === 'ok', 'signed in: «Статус» with the hub, the account and the binding');
    expect(page.section).toBe('status');
    expect(page.rows['account']?.text).toContain(WORLD.user.username);
    expect(page.rows['binding']?.text).toContain(WORLD.pages.one.title);
    // The page has no persona yet: one thing left to do before a shift.
    expect(page.rows['persona']?.level).toBe('error');
    expect(page.readiness).toBe('actions-needed');
    expect(page.codes).toEqual([]);
    await capturePage('ext-options-status-no-persona');

    const entries = (await hub().journal(mark)).entries;
    expect(callsTo(entries, 'authIssueDeviceTokenWithPassword').map((entry) => entry.status)).toEqual([200]);
    const bootstraps = callsTo(entries, 'clientBootstrap');
    expect(bootstraps.length).toBeGreaterThanOrEqual(1);
    // H-3: the token the extension keeps is the narrow one.
    expect(bootstraps.every((entry) => entry.status === 200 && entry.token?.client === 'chat-extension')).toBe(true);
    const session = await pageRpc<{ session: { login: string; hubOrigin: string; epoch: number } | null }>('session.get');
    expect(session).toMatchObject({ ok: true, payload: { session: { login: WORLD.user.username, hubOrigin: fakeHubOrigin() } } });
    const bootstrap = await pageRpc<{ pages: ReadonlyArray<{ pageLabel: string; platformAccountId: string | null }>; identity: { tokenClient: string | null } }>('bootstrap.get');
    expect(bootstrap.ok && bootstrap.payload.pages.find((item) => item.pageLabel === PAGE)?.platformAccountId).toBe(STAND_IDS.platformAccounts.a);
    expect(bootstrap.ok && bootstrap.payload.identity.tokenClient).toBe('chat-extension');
    // The sign-in record is in storage.local; the password is nowhere.
    const stored = await readLocalStorage([STORAGE_KEYS.authToken, STORAGE_KEYS.authMeta, STORAGE_KEYS.settings]);
    expect(Object.keys(stored).sort()).toEqual([STORAGE_KEYS.authMeta, STORAGE_KEYS.authToken, STORAGE_KEYS.settings].sort());
    expect(JSON.stringify(stored)).not.toContain(PASSWORD);
  });

  it('[ST-042] while signed in the hub address does not change: «Аккаунт» shows it as text, and the background refuses the request', async () => {
    await openOptions('account');
    const account = await waitForOptions((state) => state.section === 'account' && state.hubAddress !== null, '«Аккаунт» of a signed-in person');
    expect(account.hubAddress).toBe(fakeHubOrigin());
    expect(account.text).toContain('Перед сменой адреса выйдите');
    // No field to type another address into.
    expect(await browser.execute(() => document.querySelectorAll('[data-pg-anchor="hub-address"] input').length)).toBe(0);
    const refused = await pageRpc('settings.patchRestricted', { patch: { hub: { baseUrl: DEAD_HUB } }, baseRevision: null });
    expect(refused).toEqual({ ok: false, error: { code: 'CG-HUB-URL', detail: 'signed in' } });
    const state = await pageRpc<{ settings: SettingsV1 }>('settings.get');
    expect(state.ok && state.payload.settings.hub.baseUrl).toBe(fakeHubOrigin());
  });

  it('the open ChatSpace tab hears the sign-in without a reload: the account is bound, and the dock asks for the page’s persona', async () => {
    await toStand();
    const report = await dockIs((dock) => dock.status === 'no-persona', 'the dock after the sign-in: bound, no persona yet');
    expect(report.dock).toMatchObject({ login: WORLD.user.username, persona: '', contract: 'ok', banner: 'CG-PERSONA-UNASSIGNED' });
    expect(Object.values(report.dock?.actions ?? {}).some(Boolean)).toBe(false);
    const roots = await composerRoots();
    expect(await dockPlacement()).toEqual({ hosts: 1, parentKey: roots.active[0], firstChild: true, visible: true });
  });

  it('[ST-061] the page gets its persona on «Персоны» of the settings: «Сохранено ✓», the dock is ready, with the persona’s name and the actions of the open chat', async () => {
    await toPages();
    await openOptions('personas');
    const catalog = await pageRpc<{ personas: ReadonlyArray<{ key: string; displayName: string; status: string }> }>('catalog.get');
    const persona = catalog.ok ? catalog.payload.personas.find((item) => item.status === 'active') : undefined;
    if (persona === undefined) throw new Error('the fake hub has no active persona');
    await choosePersona(WORLD.pages.one.title, persona.displayName);
    // The choice is a settings write: the page says «Сохранено ✓» with the revision the background gave it.
    const saved = await waitForOptions((state) => state.save?.state === 'saved', 'the persona choice is confirmed');
    const stored = await pageRpc<{ revision: number; settings: SettingsV1 }>('settings.get');
    expect(stored.ok && saved.save?.revision).toBe(stored.ok ? stored.payload.revision : -1);
    expect(stored.ok && stored.payload.settings.personas.byPageId[String(WORLD.pages.one.pageId)]?.key).toBe(persona.key);
    await toStand();
    const report = await dockIs((dock) => dock.status === 'ready', 'the dock is ready once the page has a persona');
    expect(report.dock).toMatchObject({ login: WORLD.user.username, page: PAGE, persona: persona.displayName, contract: 'ok', banner: null, mode: 'insert' });
    expect(report.dock?.text).toContain(persona.displayName);
    expect(report.dock?.target).not.toBeNull();
    // Recap and Coach (Review is a turn of Coach since 1.51.0) came in behind the dock: their views are served.
    await dockIs((dock) => ['recap.picker', 'recap.view', 'coach'].every((view) => dock.views.includes(view)), 'the analysis controllers are in');
  });

  it('the dock follows chat switches: one host, always the first child of the active composer', async () => {
    /**
     * The dock stands in this composer, and stays there. On a switch the adapter moves the host, takes it out
     * for a moment (about 25 ms on the stand: it sees no active composer in the middle of the switch) and puts
     * it back; a single read can land in that gap, so the placement is read once it holds for two reads.
     */
    const standsIn = async (parentKey: string | undefined, message: string): Promise<void> => {
      const wanted = { hosts: 1, parentKey: parentKey ?? null, firstChild: true, visible: true };
      await browser.waitUntil(
        async () => {
          if (JSON.stringify(await dockPlacement()) !== JSON.stringify(wanted)) return false;
          await browser.pause(120);
          return JSON.stringify(await dockPlacement()) === JSON.stringify(wanted);
        },
        { timeout: 5000, timeoutMsg: message },
      );
    };
    const first = (await composerRoots()).active[0] ?? '';
    expect(first.endsWith(`:${accountA}:${a1}`)).toBe(true);
    await callStand('openChat', accountA, a2, { newTab: true });
    await browser.waitUntil(async () => (await composerRoots()).active[0]?.endsWith(`:${accountA}:${a2}`) === true, { timeout: 5000, timeoutMsg: 'the second chat tab' });
    const second = await composerRoots();
    expect(second.all).toHaveLength(2);
    await standsIn(second.active[0], 'the dock did not move to the second composer');
    await dockIs((dock) => dock.status === 'ready' && dock.page === PAGE, 'still bound after the switch');

    await callStand('openChat', accountA, a1);
    await standsIn(first, 'the dock did not come back to the first composer');
  });

  it('an account no hub page is linked to shows its CG-BINDING-* code, and the bound one comes back', async () => {
    await callStand('openChat', accountB, b1, { newTab: true });
    await waitForChatReady(accountB, b1);
    const refused = await dockIs((dock) => dock.status === 'no-binding', 'the unbound account');
    expect(refused.dock?.banner).toMatch(/^CG-BINDING-/);
    expect(refused.dock?.page).toBe('');
    expect(refused.dock?.persona).toBe('');
    expect(refused.dock?.login).toBe(WORLD.user.username);
    await callStand('openChat', accountA, a1);
    await dockIs((dock) => dock.status === 'ready' && dock.page === PAGE, 'back on the bound account');
  });

  it('[ST-020] [ST-067] [PU-005] the settings say «Готово к смене» and list the accounts with their hub pages; the popup shows the same shift', async () => {
    await toPages();
    await openOptions('status');
    const status = await waitForOptions((state) => state.readiness === 'ready', '«Статус» of a ready shift');
    expect(status.rows['chatspace']).toMatchObject({ level: 'ok' });
    expect(status.rows['hub']?.level).toBe('ok');
    expect(status.rows['binding']).toMatchObject({ level: 'ok' });
    expect(status.rows['binding']?.text).toContain(WORLD.pages.one.title);
    expect(status.rows['persona']?.level).toBe('ok');
    // Signed in, the first-run checklist stands over «Статус» with the steps already done.
    expect(status.checklist.filter((step) => step.done).map((step) => step.id)).toEqual(expect.arrayContaining(['host-permission', 'sign-in', 'persona', 'open-chatspace', 'binding']));
    await capturePage('ext-options-status-ready');

    await openOptions('accounts');
    await waitForOptions((state) => state.section === 'accounts' && state.text.includes(WORLD.pages.one.title), '«Аккаунты» with the bound account');
    // A fresh page resolves the bindings after it drew the accounts: the title above is on screen before that (as a
    // part of «Model One VIP»), so wait for the bound account's own page tag before reading the rows.
    await browser.waitUntil(async () => browser.execute((handle: string) => document.querySelector(`[data-pg-account="${handle}"] .pg-pagetag`) !== null, `chatspace:${accountA}`), {
      timeout: 15_000,
      timeoutMsg: 'the bound account never showed its hub page',
    });
    const accounts = await browser.execute(() =>
      [...document.querySelectorAll('[data-pg-account]')].map((row) => {
        const cell = row.querySelector('.pg-acc__grid dd.pg-value, .pg-acc__grid dd.pg-muted');
        return {
          handle: row.getAttribute('data-pg-account') ?? '',
          // The title is the cell's own text; the tag next to it tells pages of one title apart.
          page: (cell?.firstChild?.textContent ?? '').trim(),
          tag: cell?.querySelector('.pg-pagetag')?.textContent ?? null,
        };
      }),
    );
    // The account ChatSpace shows is bound to its hub page — named by its title, its platform and the hub's page
    // label; the other one has no page (nothing is matched by name).
    expect(accounts.find((row) => row.handle === `chatspace:${accountA}`)).toMatchObject({ page: WORLD.pages.one.title, tag: `OnlyFans · ${PAGE}` });
    expect(accounts.find((row) => row.handle === `chatspace:${accountB}`)).toMatchObject({ page: 'не привязан', tag: null });

    const popup = await openPopup();
    const settled = await waitForPopup((state) => state.view === 'ready' && state.login === WORLD.user.username && state.verdict === 'ready', 'the popup of a working shift');
    expect(popup.drawn).toBe(true);
    expect(settled.stage).toBe('Готово к смене ChatSpace и хаб на связи');
    expect(settled.codes).toEqual([]);
    expect(settled.spinners).toBe(0);
    // No sign-in form and no hub address on the popup.
    expect(await browser.execute(() => document.querySelectorAll('input').length)).toBe(0);
    await capturePage('ext-popup-working');
  });

  it('the WS tap is registered by the bootstrap flag `wsTap`: documents loaded after the sign-in get it at document_start', async () => {
    const diagnostics = await pageRpc<Diagnostics>('diagnostics.get');
    expect(diagnostics.ok && diagnostics.payload.hub.flags['wsTap']).toBe(true);
    expect(await registeredScripts()).toEqual(['cg-ws-tap']);
    // A TEST build taps wherever its content scripts run — the real ChatSpace (the owner's dev profile, X9) and
    // its loopback stand (`127.0.0.1`; the Fansly stand's `localhost` is never ChatSpace's): the same match patterns
    // as the manifest's own content scripts. The release build's tap is ChatSpace alone (the manifest test and
    // `pnpm gates`).
    const manifestMatches = await browser.execute(() => {
      const api = (globalThis as unknown as { browser: { runtime: { getManifest(): { content_scripts?: Array<{ matches?: string[] }> } } } }).browser;
      return [...(api.runtime.getManifest().content_scripts?.[0]?.matches ?? [])].sort();
    });
    expect(manifestMatches.filter((pattern) => pattern.startsWith('http://'))).toEqual(['http://127.0.0.1/*']);
    expect(manifestMatches.filter((pattern) => pattern.startsWith('https://'))).toHaveLength(1);
    expect(await registeredScript('cg-ws-tap')).toEqual({ matches: manifestMatches, world: 'MAIN', runAt: 'document_start' });
    await toStand();
    await browser.refresh();
    await waitForStandReady();
    await waitForChatReady(accountA, a1);
    const report = await waitForReport((r) => r.main !== undefined, 'MAIN probe after the reload');
    expect(report.main).toMatchObject({ readyStateAtStart: 'loading', wsTap: true });
    const sockets = await browser.execute(() => {
      const tap = (window as unknown as Record<symbol, { socketCount(): number } | undefined>)[Symbol.for('wsTap')];
      return tap?.socketCount() ?? -1;
    });
    expect(sockets).toBeGreaterThanOrEqual(1);
    // A restored sign-in: the reloaded tab is bound again without anyone signing in.
    await dockIs((dock) => dock.status === 'ready' && dock.login === WORLD.user.username && dock.page === PAGE, 'the reloaded tab is signed in and bound');
  });

  it('the owner switches the tap off page by page: it stays registered while one page still has it, and the next bootstrap unregisters it when none does', async () => {
    type Boot = { flags: Readonly<Record<string, boolean>>; pages: readonly { pageLabel: string; platform: string; features: Readonly<Record<string, { available: boolean; reason?: string }>> }[] };
    const tapOn = (boot: Boot): string[] => boot.pages.filter((page) => page.features['wsTap']?.available === true).map((page) => page.pageLabel);
    await toPages();
    await openOptions();
    // The pilot is switched on page by page: the owner's `"*"` row is empty, so the top-level flag is FALSE — and
    // the tap is registered all the same (the page's own feature decides, never the top-level flag).
    const before = await pageRpc<Boot>('bootstrap.get', { force: true });
    if (!before.ok) throw new Error('bootstrap.get');
    expect(before.payload.flags['wsTap']).toBe(false);
    expect(tapOn(before.payload)).toEqual([PAGE, WORLD.pages.vip.pageLabel]);
    expect(await registeredScripts()).toContain('cg-ws-tap');

    // Off on the page this tab works in, on on the other pilot page: the script is not bound to one page, it stays.
    await hub().command({ op: 'config', patch: { pageFlags: { [PAGE]: { wsTap: false } } } });
    const one = await pageRpc<Boot>('bootstrap.get', { force: true });
    expect(one.ok && tapOn(one.payload)).toEqual([WORLD.pages.vip.pageLabel]);
    await browser.pause(300);
    expect(await registeredScripts()).toContain('cg-ws-tap');

    // Off on every page: nothing is left to listen for.
    await hub().command({ op: 'config', patch: pilotPageFlags({ wsTap: false }) });
    const refreshed = await pageRpc<Boot>('bootstrap.get', { force: true });
    expect(refreshed.ok && tapOn(refreshed.payload)).toEqual([]);
    await browser.waitUntil(async () => (await registeredScripts()).length === 0, { timeout: 5000, timeoutMsg: 'the WS tap stayed registered after the switch went off on every page' });
    await toStand();
    await browser.refresh();
    await waitForStandReady();
    const report = await waitForReport((r) => r.main !== undefined, 'MAIN probe without the tap');
    expect(report.main?.wsTap).toBe(false);
    expect(await browser.execute(() => Object.prototype.hasOwnProperty.call(window, Symbol.for('wsTap')))).toBe(false);

    // And on again: the switch is the owner's in both directions.
    await hub().command({ op: 'config', patch: pilotPageFlags({ wsTap: true }) });
    await toPages();
    expect(await pageRpc('bootstrap.get', { force: true })).toMatchObject({ ok: true });
    await browser.waitUntil(async () => (await registeredScripts()).includes('cg-ws-tap'), { timeout: 5000, timeoutMsg: 'the WS tap was not registered again' });
  });

  it('sign-out revokes the token, clears the session, and the open tab hears it', async () => {
    await toStand();
    await waitForChatReady(accountA, a1);
    await dockIs((dock) => dock.status === 'ready', 'signed in before the sign-out');
    const mark = await hub().mark();
    await toPages();
    await signOutFromAccount();
    // The sign-in screen is back, and it says nothing went wrong: the hub confirmed the revoke.
    const page = await waitForOptions((state) => state.gate, 'signed out: the sign-in screen');
    expect(page.codes).toEqual([]);
    expect(callsTo((await hub().journal(mark)).entries, 'authRevokeCurrentDeviceToken').map((entry) => entry.status)).toEqual([200]);
    expect(await pageRpc('session.get')).toEqual({ ok: true, payload: { session: null } });
    expect(await pageRpc('bootstrap.get')).toMatchObject({ ok: false, error: { code: 'CG-AUTH-REQUIRED' } });
    // The token and the caches of the person are gone from storage.local; what stays of the sign-in is how it ended.
    const stored = await readLocalStorage([STORAGE_KEYS.authToken, STORAGE_KEYS.authMeta, STORAGE_KEYS.cacheBootstrap, STORAGE_KEYS.cacheCatalog]);
    expect(Object.keys(stored)).toEqual([STORAGE_KEYS.authMeta]);
    expect(stored[STORAGE_KEYS.authMeta]).toMatchObject({ token: null, lastEnd: { reason: 'sign-out', code: null } });
    // The tap goes with the sign-in.
    expect(await registeredScripts()).toEqual([]);
    await toStand();
    const report = await dockIs((dock) => dock.status === 'not-signed-in', 'the open tab shows «not signed in» after the sign-out');
    expect(report.dock).toMatchObject({ login: '', page: '', banner: 'CG-AUTH-REQUIRED' });
  });

  it('a hub without client/bootstrap (404): with debug mode on the DEV-ONLY synthesized bootstrap binds the page from the dev map', async () => {
    // A hub before H-2 and H-3: no `client/bootstrap`, no narrow token.
    await hub().command({ op: 'config', patch: { clientBootstrap: false, narrowTokens: false } });
    await toPages();
    await openOptions();
    expect(await pageRpc('settings.patchRestricted', { patch: { debug: { enabled: true } }, baseRevision: null })).toMatchObject({ ok: true });
    // The dev map of a test build: the prod hub's pages carry no creator id, and nothing is matched by name.
    await writeLocalStorage({ [DEV_COMPAT_PAGES_KEY]: { [PAGE]: STAND_IDS.platformAccounts.a } });
    const mark = await hub().mark();
    await submitSignIn(WORLD.user.username, PASSWORD);
    const page = await waitForOptions((state) => !state.gate && state.rows['account']?.level === 'ok' && state.rows['binding']?.level === 'ok', 'signed in on the compat bootstrap');
    expect(page.codes).toEqual([]);

    const entries = (await hub().journal(mark)).entries;
    expect(callsTo(entries, 'clientBootstrap').map((entry) => entry.status)).toContain(404);
    expect(entries.filter((entry) => entry.kind === 'legacy').map((entry) => [entry.path, entry.status])).toContainEqual(['/api/v1/pages', 200]);
    expect(callsTo(entries, 'me').length).toBeGreaterThanOrEqual(1);
    const bootstrap = await pageRpc<{ configRevision: number; capabilities: readonly string[]; identity: { tokenClient: string | null }; pages: ReadonlyArray<{ pageLabel: string; platformAccountId: string | null }> }>('bootstrap.get');
    expect(bootstrap).toMatchObject({ ok: true, payload: { configRevision: 0, capabilities: [], identity: { tokenClient: null } } });
    expect(bootstrap.ok && bootstrap.payload.pages.map((item) => [item.pageLabel, item.platformAccountId])).toEqual([
      [PAGE, STAND_IDS.platformAccounts.a],
      [WORLD.pages.vip.pageLabel, null],
      [WORLD.pages.fansly.pageLabel, null],
    ]);

    await toStand();
    const report = await dockIs((dock) => dock.status === 'ready' && dock.login === WORLD.user.username, 'the dock on the compat bootstrap');
    expect(report.dock).toMatchObject({ page: PAGE, banner: null });

    // Leave as found: signed out, debug off, the hub as deployed.
    await toPages();
    await signOutFromAccount();
    await waitForOptions((state) => state.gate, 'signed out of the compat hub');
    expect(await pageRpc('settings.patchRestricted', { patch: { debug: { enabled: false } }, baseRevision: null })).toMatchObject({ ok: true });
    await hub().command({ op: 'config', patch: { clientBootstrap: true, narrowTokens: true } });
  });
});
