// The guards of the pages controller (`createPagesClient`), each staged as
// the race or the failure it stands against: the hub address and the sign-in
// (§8.2, ST-042), a sign-in state that could not be read (PU-002), what one
// sign-in was told never shown under another, late and out-of-order answers,
// writes the background refused, and what a page still does once it is gone.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS, hostBindingKey, type OptionsVM, type SessionIdentity, type SettingsSection, type StatusRowVM } from '@cg/contracts';
import { BINDING_RESOLVE_CONCURRENCY, FOCUS_RECHECK_MIN_INTERVAL_MS, RECHECK_MIN_INTERVAL_MS, SOUND_STATE_POLL_MS } from '@cg/core/application/pages';

import { type BackgroundState } from './background';
import { PAGES_HOST_ORIGIN, PAGES_NOW, pagesWorld, settle, signedOutState, workingState, type PagesWorld, type PagesWorldOptions } from './world';

let world: PagesWorld | null = null;
let clock = PAGES_NOW;

/** A page that is created but not started: the test parks or fails requests first. */
function prepare(options: PagesWorldOptions = {}): PagesWorld {
  world = pagesWorld({ now: () => clock, ...options });
  return world;
}

async function open(options: PagesWorldOptions = {}): Promise<PagesWorld> {
  const w = prepare(options);
  w.client.start();
  await settle();
  return w;
}

const options = <S extends SettingsSection>(w: PagesWorld, section: S): Readonly<OptionsVM<S>> => w.client.getSnapshot({ of: 'options', section });
const row = (w: PagesWorld, id: StatusRowVM['id']): StatusRowVM | undefined => options(w, 'status').body?.rows.find((entry) => entry.id === id);
const step = (w: PagesWorld, id: string) => options(w, 'status').checklist?.steps.find((entry) => entry.id === id);

const CUSTOM_HUB = 'https://hub.custom.example.test';
const SECOND: SessionIdentity = { hubOrigin: DEFAULT_SETTINGS.hub.baseUrl, userId: 8, login: 'chatter2', role: 'chatter', epoch: 4 };

/** Another person signs in on this browser: the hub answers for them from now on. */
function switchToSecond(w: PagesWorld): void {
  const { state } = w.background;
  state.bootstrap = {
    ...state.bootstrap,
    identity: { ...state.bootstrap.identity, userId: SECOND.userId, username: SECOND.login },
    pages: [{ pageId: 21, pageLabel: 'second-page', title: 'Second Page', platform: 'onlyfans', platformAccountId: '4004', bindingRevision: 1, features: {} }],
  };
  state.catalog = { personas: [] };
  state.quotas = {};
  w.background.setSession(SECOND, 'sign-in');
}

/** The first run with the checklist still on, signed in. */
function firstRunState(): BackgroundState {
  const state = workingState();
  state.settings = { ...state.settings, onboarding: { ...state.settings.onboarding, checklistDismissed: false } };
  return state;
}

beforeEach(() => {
  clock = PAGES_NOW;
  vi.useFakeTimers({ now: PAGES_NOW });
});
afterEach(() => {
  world?.client.dispose();
  world = null;
  vi.useRealTimers();
});

describe('the hub address and the sign-in (§8.2, ST-042)', () => {
  it('[ST-042] a refused hub address is not shown as saved, the sign-in goes to the stored hub, and no later change carries the address', async () => {
    const w = await open({ state: signedOutState() });
    w.background.failNext('settings.patchRestricted', { code: 'CG-STORAGE-WRITE' });
    expect(await w.client.dispatch({ type: 'SetPreference', key: 'hub.baseUrl', value: CUSTOM_HUB })).toMatchObject({ ok: false, code: 'CG-STORAGE-WRITE' });
    // The form shows the address that is stored and says the other one was not saved.
    expect(options(w, 'account').signIn).toMatchObject({ hubOrigin: DEFAULT_SETTINGS.hub.baseUrl, error: { code: 'CG-STORAGE-WRITE' } });
    expect(options(w, 'account').body?.hub.origin).toBe(DEFAULT_SETTINGS.hub.baseUrl);
    // Nothing is kept for «Повторить»: a refused address is saved again by the person, never by a retry.
    expect(options(w, 'account').save.s).not.toBe('failed');
    expect(await w.client.dispatch({ type: 'RetrySettingsWrite' })).toMatchObject({ ok: true, outcome: 'noop' });

    expect(await w.client.dispatch({ type: 'SignIn', login: 'chatter1', password: 'synthetic-pass' })).toMatchObject({ ok: true });
    await settle();
    expect(w.state.session?.hubOrigin).toBe(DEFAULT_SETTINGS.hub.baseUrl);

    // Signed in: an unrelated switch is saved alone — the address does not ride along.
    expect(await w.client.dispatch({ type: 'SetPreference', key: 'ui.hints', value: false })).toMatchObject({ ok: true });
    expect(w.background.requests('settings.patch')).toEqual([{ patch: { ui: { hints: false } }, baseRevision: 7 }]);
    expect(w.background.requests('settings.patchRestricted')).toHaveLength(1);
    expect(w.state.settings.hub.baseUrl).toBe(DEFAULT_SETTINGS.hub.baseUrl);
    expect(w.state.session?.login).toBe('chatter1');
  });

  it('[ST-042] [ST-046] the sign-in waits for an address still being saved and goes to that address', async () => {
    const w = await open({ state: signedOutState() });
    const release = w.background.hold('settings.patchRestricted');
    const saving = w.client.dispatch({ type: 'SetPreference', key: 'hub.baseUrl', value: CUSTOM_HUB });
    const signing = w.client.dispatch({ type: 'SignIn', login: 'chatter1', password: 'synthetic-pass' });
    await settle();
    // Host access is asked inside the click for the address on screen; the sign-in itself waits.
    expect(w.browser.record.permissionRequests.every((origin) => origin === CUSTOM_HUB)).toBe(true);
    expect(w.browser.record.permissionRequests.length).toBeGreaterThan(0);
    expect(w.background.requests('session.signIn')).toEqual([]);
    expect(options(w, 'account').signIn).toMatchObject({ busy: true, hubOrigin: CUSTOM_HUB });

    release();
    expect(await saving).toMatchObject({ ok: true });
    expect(await signing).toMatchObject({ ok: true });
    expect(w.background.requests('session.signIn')).toHaveLength(1);
    expect(w.state.settings.hub.baseUrl).toBe(CUSTOM_HUB);
    expect(w.state.session?.hubOrigin).toBe(CUSTOM_HUB);
  });

  it('[ST-042] [ST-046] the sign-in is refused when the address on screen was not saved: never another hub than the one shown', async () => {
    const w = await open({ state: signedOutState() });
    const release = w.background.hold('settings.patchRestricted');
    w.background.failNext('settings.patchRestricted', { code: 'CG-STORAGE-WRITE' });
    const saving = w.client.dispatch({ type: 'SetPreference', key: 'hub.baseUrl', value: CUSTOM_HUB });
    const signing = w.client.dispatch({ type: 'SignIn', login: 'chatter1', password: 'synthetic-pass' });
    await settle();
    release();
    expect(await saving).toMatchObject({ ok: false, code: 'CG-STORAGE-WRITE' });
    // The sign-in says why the address was not saved, not «неверный адрес».
    expect(await signing).toMatchObject({ ok: false, code: 'CG-STORAGE-WRITE' });
    await settle();
    expect(w.background.requests('session.signIn')).toEqual([]);
    expect(w.state.session).toBeNull();
    // The form is free again, with the stored address and the reason.
    expect(options(w, 'account').signIn).toMatchObject({ busy: false, hubOrigin: DEFAULT_SETTINGS.hub.baseUrl, error: { code: 'CG-STORAGE-WRITE' } });
  });

  it('[ST-042] [ST-046] the address changes in another tab while the sign-in waits: the sign-in is refused, not sent to the other hub', async () => {
    const w = await open({ state: signedOutState() });
    const release = w.background.hold('settings.patch');
    // A change still being saved keeps the sign-in waiting…
    const sound = w.client.dispatch({ type: 'SetPreference', key: 'sound.messages.on', value: false });
    const signing = w.client.dispatch({ type: 'SignIn', login: 'chatter1', password: 'synthetic-pass' });
    await settle();
    expect(w.background.requests('session.signIn')).toEqual([]);
    // …and meanwhile another settings tab saves another hub address.
    w.background.changeSettings({ hub: { baseUrl: CUSTOM_HUB } });
    release();
    expect(await sound).toMatchObject({ ok: true });
    expect(await signing).toMatchObject({ ok: false, code: 'CG-HUB-URL' });
    expect(w.background.requests('session.signIn')).toEqual([]);
    expect(w.state.session).toBeNull();
    expect(options(w, 'account').signIn).toMatchObject({ busy: false, hubOrigin: CUSTOM_HUB, error: { code: 'CG-HUB-URL' } });
  });

  it('[ST-042] an address waiting behind another write is refused when it is sent, once somebody has signed in', async () => {
    const w = await open({ state: signedOutState() });
    const release = w.background.hold('settings.patch');
    const sound = w.client.dispatch({ type: 'SetPreference', key: 'sound.messages.on', value: false });
    const address = w.client.dispatch({ type: 'SetPreference', key: 'hub.baseUrl', value: CUSTOM_HUB });
    await settle();
    // Signed in from another page while the address still waits for its turn.
    w.background.setSession(workingState().session, 'sign-in');
    release();
    expect(await sound).toMatchObject({ ok: true });
    expect(await address).toMatchObject({ ok: false, code: 'CG-HUB-URL' });
    await settle();
    expect(w.background.requests('settings.patchRestricted')).toEqual([]);
    expect(w.state.settings.hub.baseUrl).toBe(DEFAULT_SETTINGS.hub.baseUrl);
  });

  it('[ST-042] [PU-002] with the sign-in state unknown the options page shows no sign-in screen and changes no hub address', async () => {
    const w = prepare();
    w.background.failNext('session.get', { code: 'CG-STORAGE-READ' });
    w.client.start();
    await settle();
    for (const section of ['status', 'account', 'appearance'] as const) {
      const vm = options(w, section);
      expect(vm.view, section).toMatchObject({ s: 'error', error: { code: 'CG-STORAGE-READ' }, retry: { type: 'ReloadView', selector: { of: 'options', section } } });
      expect(vm.signIn, section).toBeNull();
      expect(vm.body, section).toBeNull();
      expect(vm.checklist, section).toBeNull();
    }
    // The background is still signed in: the address must not move — refused with the code of the read that failed.
    expect(await w.client.dispatch({ type: 'SetPreference', key: 'hub.baseUrl', value: 'https://evil.example.test' })).toMatchObject({ ok: false, code: 'CG-STORAGE-READ' });
    expect(w.background.requests('settings.patchRestricted')).toEqual([]);
    expect(w.browser.record.permissionRequests).toEqual([]);
    expect(w.state.settings.hub.baseUrl).toBe(DEFAULT_SETTINGS.hub.baseUrl);
    expect(w.state.settings.personas.byPageId).toHaveProperty('11');

    await w.client.dispatch({ type: 'ReloadView', selector: { of: 'options', section: 'status' } });
    await settle();
    expect(options(w, 'status').view.s).toBe('ready');
  });

  it('[ST-042] a sign-in state whose refresh failed is not «signed out» for the hub address either', async () => {
    const w = await open({ state: signedOutState() });
    w.background.failNext('session.get', { code: 'CG-TIMEOUT' });
    clock += FOCUS_RECHECK_MIN_INTERVAL_MS;
    w.browser.focus();
    await settle();
    // What was known stays on the page: the sign-in screen, not an error.
    expect(options(w, 'account').view.s).toBe('forbidden');
    expect(await w.client.dispatch({ type: 'SetPreference', key: 'hub.baseUrl', value: CUSTOM_HUB })).toMatchObject({ ok: false, code: 'CG-TIMEOUT' });
    expect(w.background.requests('settings.patchRestricted')).toEqual([]);
    expect(w.browser.record.permissionRequests).toEqual([]);
    // The form says why the address stays as it is.
    expect(options(w, 'account').signIn).toMatchObject({ hubOrigin: DEFAULT_SETTINGS.hub.baseUrl, error: { code: 'CG-TIMEOUT' } });
    // Once the state is read again as «nobody signed in», the address can be changed.
    clock += FOCUS_RECHECK_MIN_INTERVAL_MS;
    w.browser.focus();
    await settle();
    expect(await w.client.dispatch({ type: 'SetPreference', key: 'hub.baseUrl', value: CUSTOM_HUB })).toMatchObject({ ok: true });
    expect(w.state.settings.hub.baseUrl).toBe(CUSTOM_HUB);
    expect(options(w, 'account').signIn).toMatchObject({ hubOrigin: CUSTOM_HUB, error: null });
  });

  it('[ST-042] signed in: the hub address is refused with CG-HUB-URL before anything is asked or sent', async () => {
    const w = await open();
    expect(await w.client.dispatch({ type: 'SetPreference', key: 'hub.baseUrl', value: CUSTOM_HUB })).toMatchObject({ ok: false, code: 'CG-HUB-URL' });
    expect(w.background.requests('settings.patchRestricted')).toEqual([]);
    expect(w.browser.record.permissionRequests).toEqual([]);
    expect(w.state.settings.hub.baseUrl).toBe(DEFAULT_SETTINGS.hub.baseUrl);
    // Nothing is written under «Войти заново»: that form did not ask for it.
    expect(options(w, 'account').signIn).toMatchObject({ error: null });
  });

  it('[AU-009] a second submit while the sign-in is on its way sends nothing; one sign-in loads the page once', async () => {
    const w = await open({ state: signedOutState() });
    const first = w.client.dispatch({ type: 'SignIn', login: 'chatter1', password: 'synthetic-pass' });
    const second = w.client.dispatch({ type: 'SignIn', login: 'chatter1', password: 'synthetic-pass' });
    expect(await second).toMatchObject({ ok: true, outcome: 'noop' });
    expect(await first).toMatchObject({ ok: true, outcome: 'done' });
    await settle();
    expect(w.background.requests('session.signIn')).toHaveLength(1);
    expect(w.state.session?.epoch).toBe(1);
    // The event and the answer both say «signed in»: the hub is read once, not twice.
    expect(w.background.requests('bootstrap.get')).toHaveLength(1);
    expect(w.background.requests('binding.resolve')).toHaveLength(w.state.accounts.length);
    expect(options(w, 'status').view.s).toBe('ready');
  });
});

describe('host access to the hub address (ST-043)', () => {
  it('[ST-043] until the browser answers the access is «неизвестно» with the way to ask — never «разрешён» by default', async () => {
    const w = prepare();
    const parked = w.browser.parkPermissions();
    w.client.start();
    await settle();
    expect(options(w, 'account').body?.hub).toMatchObject({ hostPermission: 'unknown', requestPermission: { action: { type: 'RequestPermission', kind: 'hub-host' } } });
    parked.stop();
    for (const release of parked.releases) release();
    await settle();
    expect(options(w, 'account').body?.hub).toEqual({ origin: DEFAULT_SETTINGS.hub.baseUrl, hostPermission: 'granted', requestPermission: null });
  });

  it('[ST-043] a browser that could not tell is «неизвестно», not «не разрешён»', async () => {
    const w = prepare();
    w.browser.permissionsFail = true;
    w.client.start();
    await settle();
    expect(options(w, 'account').body?.hub.hostPermission).toBe('unknown');
    expect(row(w, 'hub')?.action).toBeNull();
  });

  it('[ST-043] the access reacts to a grant and a revoke without a reload', async () => {
    const w = prepare();
    w.browser.granted.delete(DEFAULT_SETTINGS.hub.baseUrl);
    w.client.start();
    await settle();
    expect(options(w, 'account').body?.hub.hostPermission).toBe('missing');
    expect(await w.client.dispatch({ type: 'RequestPermission', kind: 'hub-host' })).toMatchObject({ ok: true });
    expect(options(w, 'account').body?.hub).toMatchObject({ hostPermission: 'granted', requestPermission: null });
    // Refused in the browser's prompt: said with its code, and the row stays «не разрешён».
    w.browser.granted.delete(DEFAULT_SETTINGS.hub.baseUrl);
    w.browser.grantOnRequest = false;
    expect(await w.client.dispatch({ type: 'RequestPermission', kind: 'hub-host' })).toMatchObject({ ok: false, code: 'CG-HUB-HOST-PERMISSION' });
    expect(options(w, 'account').body?.hub.hostPermission).toBe('missing');
  });

  it('[ST-043] an answer about another address says nothing about the one on screen', async () => {
    const w = await open({ state: signedOutState() });
    const parked = w.browser.parkPermissions();
    clock += FOCUS_RECHECK_MIN_INTERVAL_MS;
    w.browser.focus();
    await settle();
    // Asked for the stock address (and ChatSpace); the answer is still on its way.
    expect(parked.releases).toHaveLength(2);
    // The address changes in another tab meanwhile; the new one has no access.
    w.background.changeSettings({ hub: { baseUrl: CUSTOM_HUB } });
    await settle();
    expect(parked.releases).toHaveLength(4);
    // The «yes» the page holds is about the stock address: for the new one nothing is known yet.
    expect(options(w, 'account').body?.hub).toMatchObject({ origin: CUSTOM_HUB, hostPermission: 'unknown' });
    parked.stop();
    parked.releases[2]?.();
    parked.releases[3]?.();
    await settle();
    expect(options(w, 'account').body?.hub).toMatchObject({ origin: CUSTOM_HUB, hostPermission: 'missing' });
    // The late «yes» for the old address must not turn into access to the new one.
    parked.releases[0]?.();
    parked.releases[1]?.();
    await settle();
    expect(options(w, 'account').body?.hub).toMatchObject({ origin: CUSTOM_HUB, hostPermission: 'missing' });
    expect(w.browser.granted.has(PAGES_HOST_ORIGIN)).toBe(true);
  });
});

describe('what one sign-in was told is never shown under another', () => {
  it('a sign-out resets what the hub said: no pages, no bindings, no persona of the previous person', async () => {
    const w = await open({ state: firstRunState() });
    expect(options(w, 'account').body?.pages).toHaveLength(4);
    expect(step(w, 'binding')?.done).toBe(true);
    w.background.setSession(null, 'sign-out');
    await settle();
    expect(options(w, 'account').body).toMatchObject({ user: null, pages: [] });
    expect(step(w, 'binding')?.done).toBe(false);
    expect(step(w, 'persona')?.done).toBe(false);
  });

  it('a hub answer for a sign-in that ended comes late: it is dropped, not shown on the sign-in screen', async () => {
    const w = prepare({ state: firstRunState() });
    const parked = w.background.park('bootstrap.get');
    w.client.start();
    await settle();
    expect(parked.releases).toHaveLength(1);
    w.background.setSession(null, 'sign-out');
    await settle();
    parked.stop();
    parked.releases[0]?.();
    await settle();
    expect(options(w, 'account').body).toMatchObject({ user: null, pages: [] });
  });

  it('bindings resolved for a sign-in that ended come late: they are dropped', async () => {
    const w = prepare({ state: firstRunState() });
    const parked = w.background.park('binding.resolve');
    w.client.start();
    await settle();
    expect(parked.releases).toHaveLength(4);
    w.background.setSession(null, 'sign-out');
    await settle();
    parked.stop();
    for (const release of parked.releases) release();
    await settle();
    expect(step(w, 'binding')?.done).toBe(false);
  });

  it('another person signs in while the first one\'s hub answers are still on their way: nothing of the first appears', async () => {
    const w = prepare();
    const bootstraps = w.background.park('bootstrap.get');
    w.client.start();
    await settle();
    expect(bootstraps.releases).toHaveLength(1);

    switchToSecond(w);
    await settle();
    // Before any answer for the second person: the first person's pages are gone already.
    expect(options(w, 'account').body).toMatchObject({ user: { login: 'chatter2' }, pages: [] });
    expect(bootstraps.releases).toHaveLength(2);

    bootstraps.stop();
    bootstraps.releases[1]?.();
    await settle();
    expect(options(w, 'account').body?.pages.map((page) => page.pageName)).toEqual(['Second Page']);
    // The first person's answer arrives last.
    bootstraps.releases[0]?.();
    await settle();
    expect(options(w, 'account').body).toMatchObject({ user: { login: 'chatter2' } });
    expect(options(w, 'account').body?.pages.map((page) => page.pageName)).toEqual(['Second Page']);
    expect(options(w, 'personas').body?.pages.map((page) => page.pageName)).toEqual(['Second Page']);
  });

  it('bindings of the first person resolve after the second one signed in: the accounts show the second person\'s', async () => {
    const w = prepare();
    const parked = w.background.park('binding.resolve');
    w.client.start();
    await settle();
    expect(parked.releases).toHaveLength(4);
    switchToSecond(w);
    await settle();
    expect(parked.releases).toHaveLength(8);
    parked.stop();
    for (const release of parked.releases.slice(4)) release();
    await settle();
    const bound = (): (string | null)[] => (options(w, 'accounts').body?.rows ?? []).filter((entry) => entry.status !== 'no-sessions').map((entry) => entry.pageName);
    // The second person has none of these accounts.
    expect(bound()).toEqual([null, null, null, null]);
    for (const release of parked.releases.slice(0, 4)) release();
    await settle();
    expect(bound()).toEqual([null, null, null, null]);
  });
  it('another person signs in: the persona catalog of the first one is gone before the hub answers for the second', async () => {
    const w = await open();
    expect(options(w, 'personas').body?.catalog.length).toBeGreaterThan(0);
    const parked = w.background.park('catalog.get');
    switchToSecond(w);
    await settle();
    expect(parked.releases).toHaveLength(1);
    // Still waiting for the second person's catalog: nothing of the first one's is offered meanwhile.
    expect(options(w, 'personas').body?.catalog ?? []).toEqual([]);
    parked.stop();
    parked.releases[0]?.();
    await settle();
    expect(options(w, 'personas').body?.catalog).toEqual([]);
  });

  it('quotas read for a sign-in that ended come late: the new sign-in keeps its own', async () => {
    const w = prepare();
    const parked = w.background.park('quota.get');
    w.client.start();
    await settle();
    // Asked under the first sign-in; each answer was made then («осталось 12») and is still on its way.
    const first = parked.releases.length;
    expect(first).toBeGreaterThan(0);
    const before = w.state.quotas[11];
    if (before === null || before === undefined) throw new Error('the working state has a quota for page 11');
    w.state.quotas[11] = { ...before, remainingRequestsToday: 5 };
    // The same person signs in again: a new sign-in, asked anew.
    w.background.setSession({ ...SECOND, userId: 7, login: 'chatter1', epoch: 9 }, 'sign-in');
    await settle();
    expect(parked.releases.length).toBeGreaterThan(first);
    parked.stop();
    for (const release of parked.releases.slice(first)) release();
    await settle();
    expect(row(w, 'quota')?.value).toEqual({ key: 'settings.status.row.quotaLeft', params: { n: 5 } });
    for (const release of parked.releases.slice(0, first)) release();
    await settle();
    expect(row(w, 'quota')?.value).toEqual({ key: 'settings.status.row.quotaLeft', params: { n: 5 } });
  });

  it('another person with the same pages signs in: the quota read for the first one is not shown while theirs is read', async () => {
    const w = await open();
    expect(row(w, 'quota')?.value).toEqual({ key: 'settings.status.row.quotaLeft', params: { n: 12 } });
    const parked = w.background.park('quota.get');
    // The hub keeps the same pages for this person too; what is left of the day is theirs to be read.
    w.background.setSession(SECOND, 'sign-in');
    await settle();
    expect(parked.releases.length).toBeGreaterThan(0);
    expect(row(w, 'quota')).toMatchObject({ level: 'unknown', value: { key: 'settings.status.row.quotaUnknown' } });
    parked.stop();
    for (const release of parked.releases) release();
    await settle();
    expect(row(w, 'quota')?.value).toEqual({ key: 'settings.status.row.quotaLeft', params: { n: 12 } });
  });

  it('[DB-007] another person signs in on a debug page: the prompt read for the first one is off the page and asked anew', async () => {
    const state = workingState();
    state.settings = { ...state.settings, debug: { ...state.settings.debug, enabled: true } };
    const w = await open({ page: 'debug-prompt', state });
    const selector = { of: 'debug-prompt', token: 'prompt-token-1' } as const;
    w.client.subscribe(selector, () => undefined);
    await settle();
    expect(w.client.getSnapshot(selector).blocks.length).toBeGreaterThan(0);
    const asked = w.background.requests('debug.prompt').length;
    const parked = w.background.park('debug.prompt');
    w.background.setSession(SECOND, 'sign-in');
    await settle();
    // Debug is still on and somebody is signed in — but not the person the prompt was read for.
    expect(w.client.getSnapshot(selector)).toMatchObject({ view: { s: 'loading' }, blocks: [], manifest: null, copyHandle: null });
    expect(await w.client.dispatch({ type: 'Copy', artifactHandle: 'prompt' })).toMatchObject({ ok: false, code: 'CG-CLIPBOARD' });
    expect(w.browser.record.clipboard).toEqual([]);
    expect(w.background.requests('debug.prompt')).toHaveLength(asked + 1);
    parked.stop();
    parked.releases[0]?.();
    await settle();
    expect(w.client.getSnapshot(selector).blocks.length).toBeGreaterThan(0);
  });
});

describe('late and repeated answers', () => {
  it('an older settings state seen after a confirmed write does not take the page back', async () => {
    const w = await open();
    const older = w.background.settingsState();
    expect(await w.client.dispatch({ type: 'SetPreference', key: 'ui.hints', value: false })).toMatchObject({ ok: true, revision: 8 });
    // The broadcast of an earlier revision arrives after the answer to the write.
    w.background.emit('settings.changed', older);
    expect(options(w, 'appearance').body?.hints).toBe(false);
    expect(w.client.hints.value).toBe(false);
    // The next write stands on the newer revision.
    await w.client.dispatch({ type: 'SetPreference', key: 'generation.split', value: true });
    expect(w.background.requests('settings.patch')[1]).toEqual({ patch: { generation: { split: true } }, baseRevision: 8 });
  });

  it('an older answer of the same read that comes late does not overwrite the newer one', async () => {
    const w = await open();
    expect(options(w, 'diagnostics').body?.logsKB).toBe(1280);
    const parked = w.background.park('diagnostics.get');
    clock += FOCUS_RECHECK_MIN_INTERVAL_MS;
    w.browser.focus();
    await settle();
    expect(parked.releases).toHaveLength(1);
    // «Очистить локальные данные» reads the sizes again while the focus re-check is still waiting.
    const cleared = w.client.dispatch({ type: 'ClearLocalData', confirmed: true });
    await settle();
    expect(parked.releases).toHaveLength(2);
    parked.stop();
    parked.releases[1]?.();
    expect(await cleared).toMatchObject({ ok: true });
    expect(options(w, 'diagnostics').body).toMatchObject({ logsKB: 0, cachesKB: 0 });
    parked.releases[0]?.();
    await settle();
    expect(options(w, 'diagnostics').body).toMatchObject({ logsKB: 0, cachesKB: 0 });
  });

  it('two resolves of the bindings overlap: the answers of the earlier one never replace the later one\'s', async () => {
    const w = await open();
    const pageOf = (handle: string): string | null | undefined => options(w, 'accounts').body?.rows.find((entry) => entry.accountHandle === handle)?.pageName;
    expect(pageOf('chatspace:1001')).toBe('LoraVie VIP');
    const parked = w.background.park('binding.resolve');
    const changed = (): void => w.background.emit('bootstrap.changed', { configRevision: 5, issuedAt: new Date(clock).toISOString() });
    changed();
    await settle();
    expect(parked.releases).toHaveLength(4);
    // The owner rebinds the account to another page; the hub says so while the first resolve is still on its way.
    w.state.bootstrap = { ...w.state.bootstrap, configRevision: 5, bindingsByHost: { [hostBindingKey('chatspace', '1001')]: 12 } };
    changed();
    await settle();
    expect(parked.releases).toHaveLength(8);
    parked.stop();
    for (const release of parked.releases.slice(4)) release();
    await settle();
    expect(pageOf('chatspace:1001')).toBe('LoraVie Free');
    for (const release of parked.releases.slice(0, 4)) release();
    await settle();
    expect(pageOf('chatspace:1001')).toBe('LoraVie Free');
  });

  it('a late `session.get` answer does not undo a sign-out that was announced meanwhile', async () => {
    const w = await open();
    const parked = w.background.park('session.get');
    clock += FOCUS_RECHECK_MIN_INTERVAL_MS;
    w.browser.focus();
    await settle();
    expect(parked.releases).toHaveLength(1);
    w.background.setSession(null, 'revoked');
    await settle();
    parked.stop();
    // The answer was made while the person was still signed in.
    parked.releases[0]?.();
    await settle();
    expect(options(w, 'status').view).toMatchObject({ s: 'forbidden', error: { code: 'CG-AUTH-REVOKED' } });
    expect(options(w, 'account').body?.user).toBeNull();
  });

  it('[ST-038] coming back to the page asks no binding and no quota again while nothing they depend on changed', async () => {
    const w = await open();
    const count = (type: 'binding.resolve' | 'quota.get' | 'diagnostics.get'): number => w.background.requests(type).length;
    expect(count('binding.resolve')).toBe(4);
    expect(count('quota.get')).toBe(4);
    const diagnostics = count('diagnostics.get');
    for (let focus = 0; focus < 10; focus += 1) {
      clock += FOCUS_RECHECK_MIN_INTERVAL_MS;
      w.browser.focus();
      await settle();
    }
    // The re-check itself runs every time…
    expect(count('diagnostics.get')).toBe(diagnostics + 10);
    // …the bindings come from the same sign-in, hub config and accounts: not asked again.
    expect(count('binding.resolve')).toBe(4);
    expect(count('quota.get')).toBe(4);

    // The hub config changed, the person asked, or a new account was seen: asked again.
    w.background.emit('bootstrap.changed', { configRevision: 5, issuedAt: new Date(clock).toISOString() });
    await settle();
    expect(count('binding.resolve')).toBe(8);
    clock += RECHECK_MIN_INTERVAL_MS;
    await w.client.dispatch({ type: 'RecheckStatus' });
    await settle();
    expect(count('binding.resolve')).toBe(12);
    const first = w.state.accounts[0];
    if (first !== undefined) w.state.accounts = [...w.state.accounts, { ...first, account: { ...first.account, hostAccountId: '1009', platformAccountId: '3999', username: 'new_account', displayName: 'New' } }];
    clock += FOCUS_RECHECK_MIN_INTERVAL_MS;
    w.browser.focus();
    await settle();
    expect(count('binding.resolve')).toBe(17);
  });

  it('a binding that failed for a passing reason is asked again on the next re-check', async () => {
    const w = prepare();
    w.background.failNext('binding.resolve', { code: 'CG-RUNTIME-UNREACHABLE' });
    w.client.start();
    await settle();
    expect(w.background.requests('binding.resolve')).toHaveLength(4);
    clock += FOCUS_RECHECK_MIN_INTERVAL_MS;
    w.browser.focus();
    await settle();
    expect(w.background.requests('binding.resolve')).toHaveLength(8);
    expect((options(w, 'accounts').body?.rows ?? []).filter((entry) => entry.pageName !== null)).toHaveLength(4);
  });

  it('many seen accounts are resolved a few at a time, never all at once', async () => {
    const state = workingState();
    const first = state.accounts[0];
    if (first === undefined) throw new Error('the working state has accounts');
    state.accounts = Array.from({ length: 30 }, (_, index) => ({ ...first, openTabs: 0, routeTabs: 0, account: { ...first.account, hostAccountId: String(5000 + index), platformAccountId: String(9000 + index), username: `account_${String(index)}`, displayName: null } }));
    const w = prepare({ state });
    const parked = w.background.park('binding.resolve');
    w.client.start();
    await settle();
    expect(parked.releases).toHaveLength(BINDING_RESOLVE_CONCURRENCY);
    let released = 0;
    while (released < parked.releases.length) {
      parked.releases[released]?.();
      released += 1;
      await settle();
      expect(parked.releases.length - released).toBeLessThanOrEqual(BINDING_RESOLVE_CONCURRENCY);
    }
    expect(parked.releases).toHaveLength(30);
  });
});

describe('writes the background refused (§9.4)', () => {
  it('a change refused for good is not sent again inside the next one: the saves after it go through', async () => {
    const w = await open();
    w.background.failNext('settings.patch', { code: 'CG-UNKNOWN', detail: 'invalid settings' });
    expect(await w.client.dispatch({ type: 'SetAccountMuted', accountHandle: 'chatspace:1001', muted: true })).toMatchObject({ ok: false, code: 'CG-UNKNOWN' });
    expect(options(w, 'appearance').save).toMatchObject({ s: 'failed', error: { code: 'CG-UNKNOWN' } });

    expect(await w.client.dispatch({ type: 'SetPreference', key: 'ui.hints', value: false })).toMatchObject({ ok: true, revision: 8 });
    expect(w.background.requests('settings.patch')[1]).toEqual({ patch: { ui: { hints: false } }, baseRevision: 7 });
    expect(options(w, 'appearance').save).toEqual({ s: 'saved', revision: 8 });
    // The refused change is gone from the page too: it shows what is stored.
    expect(options(w, 'accounts').body?.rows.find((entry) => entry.accountHandle === 'chatspace:1001')?.muted).toBe(false);
    expect(await w.client.dispatch({ type: 'RetrySettingsWrite' })).toMatchObject({ ok: true, outcome: 'noop' });
  });

  it('a change that failed for a passing reason goes with the next one', async () => {
    const w = await open();
    w.background.failNext('settings.patch', { code: 'CG-STORAGE-WRITE' });
    expect(await w.client.dispatch({ type: 'SetAccountMuted', accountHandle: 'chatspace:1001', muted: true })).toMatchObject({ ok: false, code: 'CG-STORAGE-WRITE' });
    expect(await w.client.dispatch({ type: 'SetPreference', key: 'ui.hints', value: false })).toMatchObject({ ok: true });
    expect(w.background.requests('settings.patch')[1]).toEqual({ patch: { sound: { mutedAccounts: ['chatspace:1001'] }, ui: { hints: false } }, baseRevision: 7 });
    expect(w.state.settings.sound.mutedAccounts).toEqual(['chatspace:1001']);
  });

  it('[ST-073] a persona that is archived or not in the catalog is refused before anything is written', async () => {
    const w = await open();
    expect(await w.client.dispatch({ type: 'ChoosePersona', pageHandle: 'page-11', personaKey: 'lora-old' })).toMatchObject({ ok: false, code: 'CG-PERSONA-UNAVAILABLE' });
    expect(await w.client.dispatch({ type: 'ChoosePersona', pageHandle: 'page-11', personaKey: 'no-such-persona' })).toMatchObject({ ok: false, code: 'CG-PERSONA-UNAVAILABLE' });
    expect(await w.client.dispatch({ type: 'ChoosePersona', pageHandle: 'not-a-page', personaKey: 'lora-free' })).toMatchObject({ ok: false, code: 'CG-PERSONA-UNAVAILABLE' });
    expect(w.background.requests('settings.patch')).toEqual([]);
    expect(w.state.settings.personas.byPageId['11']?.key).toBe('lora-vip');
  });
});

describe('a page that is gone, a section that is closed', () => {
  it('a disposed page holds no listener and asks nothing more', async () => {
    const w = await open();
    w.client.subscribe({ of: 'options', section: 'status' }, () => undefined);
    expect(w.background.listenerCount()).toBeGreaterThan(0);
    expect(w.browser.listenerCount()).toBeGreaterThan(0);
    w.client.dispose();
    expect(w.background.listenerCount()).toBe(0);
    expect(w.browser.listenerCount()).toBe(0);
    const calls = w.background.calls.length;
    w.background.emit('bootstrap.changed', { configRevision: 5, issuedAt: new Date(clock).toISOString() });
    w.background.setSession(null, 'sign-out');
    w.background.changeSettings({ ui: { hints: false } });
    clock += FOCUS_RECHECK_MIN_INTERVAL_MS;
    w.browser.focus();
    w.browser.pageHide();
    await vi.advanceTimersByTimeAsync(SOUND_STATE_POLL_MS * 3);
    await settle();
    expect(w.background.calls).toHaveLength(calls);
  });

  it('[ST-133] the live state is read every 10 s only while «Статус» or «Вид и звук» is on screen', async () => {
    const w = await open();
    const reads = (): number => w.background.requests('diagnostics.get').length;
    const quiet = reads();
    // No section that shows live state is subscribed: nothing is polled.
    await vi.advanceTimersByTimeAsync(SOUND_STATE_POLL_MS * 2);
    expect(reads()).toBe(quiet);

    const off = w.client.subscribe({ of: 'options', section: 'appearance' }, () => undefined);
    await vi.advanceTimersByTimeAsync(SOUND_STATE_POLL_MS);
    await settle();
    expect(reads()).toBe(quiet + 1);
    await vi.advanceTimersByTimeAsync(SOUND_STATE_POLL_MS);
    await settle();
    expect(reads()).toBe(quiet + 2);

    // The section is closed (another one without live state is on screen): the polling stops.
    off();
    w.client.subscribe({ of: 'options', section: 'hotkeys' }, () => undefined);
    await vi.advanceTimersByTimeAsync(SOUND_STATE_POLL_MS * 3);
    await settle();
    expect(reads()).toBe(quiet + 2);
  });

  it('[DB-007] the events’ channel was parked while the background slept: when it is open again the page reads the sign-in and the settings anew — a sign-out or «отладка выключена» it never heard of still clears a debug page', async () => {
    const debugState = workingState();
    debugState.settings = { ...debugState.settings, debug: { enabled: true, renderTrace: false } };
    const w = await open({ page: 'debug-prompt', state: debugState });
    w.client.subscribe({ of: 'debug-prompt', token: 'prompt-token-1' }, () => undefined);
    await settle();
    expect(w.client.getSnapshot({ of: 'debug-prompt', token: 'prompt-token-1' }).blocks.length).toBeGreaterThan(0);
    // The background sleeps; meanwhile the person signs out from the popup. No event reaches this page.
    w.background.eventsState('parked');
    w.background.changeUnheard({ session: null });
    await settle();
    expect(w.client.getSnapshot({ of: 'debug-prompt', token: 'prompt-token-1' }).blocks.length).toBeGreaterThan(0);
    // The page is back on screen: the channel opens, and what it missed is read.
    w.background.eventsState('open');
    await settle();
    const after = w.client.getSnapshot({ of: 'debug-prompt', token: 'prompt-token-1' });
    expect(after.view).toMatchObject({ s: 'forbidden', error: { code: 'CG-AUTH-REQUIRED' } });
    expect(after.blocks).toEqual([]);
    expect(after.copyHandle).toBeNull();

    // An `open` that follows no `parked` (the first connection) reads nothing extra.
    world?.client.dispose();
    const fresh = await open();
    const reads = fresh.background.requests('session.get').length;
    fresh.background.eventsState('open');
    await settle();
    expect(fresh.background.requests('session.get')).toHaveLength(reads);
  });

  it('[ST-133] a settings tab left open on «Статус» behind another tab reads nothing: the polling stops while it is hidden and starts again when it is back on screen', async () => {
    const w = await open();
    const reads = (): number => w.background.requests('diagnostics.get').length;
    w.client.subscribe({ of: 'options', section: 'status' }, () => undefined);
    await vi.advanceTimersByTimeAsync(SOUND_STATE_POLL_MS);
    await settle();
    const shown = reads();
    // The person went to the ChatSpace tab: this one is hidden.
    w.browser.visible = false;
    await vi.advanceTimersByTimeAsync(SOUND_STATE_POLL_MS * 6);
    await settle();
    expect(reads()).toBe(shown);
    // Back on screen (visibilitychange → the page's focus listener): one re-check now, then the poll again.
    w.browser.visible = true;
    clock += FOCUS_RECHECK_MIN_INTERVAL_MS;
    w.browser.focus();
    await settle();
    const back = reads();
    expect(back).toBeGreaterThan(shown);
    await vi.advanceTimersByTimeAsync(SOUND_STATE_POLL_MS);
    await settle();
    expect(reads()).toBe(back + 1);
  });
});

describe('the first run (ST-012)', () => {
  it('[ST-012] the checklist stands on the sign-in screen: the hosts, the sign-in and the consent are still to do', async () => {
    const state = signedOutState();
    state.diagnostics = { ...state.diagnostics, tabs: [], telemetry: { ...state.diagnostics.telemetry, consent: false } };
    state.accounts = [];
    const w = prepare({ state });
    w.browser.granted.clear();
    w.client.start();
    await settle();
    for (const section of ['status', 'account', 'generation'] as const) expect(options(w, section).checklist, section).not.toBeNull();
    expect(options(w, 'status').view.s).toBe('forbidden');
    const checklist = options(w, 'status').checklist;
    expect(checklist?.steps.map((entry) => [entry.id, entry.done])).toEqual([
      ['install', true],
      ['host-permission', false],
      ['sign-in', false],
      ['persona', false],
      ['open-chatspace', false],
      ['binding', false],
      ['consent', false],
      ['sound-hotkeys', false],
    ]);
    // What can be done before the sign-in has its action; what needs the sign-in has none yet.
    expect(step(w, 'host-permission')?.action?.action).toEqual({ type: 'RequestPermission', kind: 'chatspace-host' });
    expect(step(w, 'sign-in')?.action?.action).toEqual({ type: 'OpenSettings', route: { section: 'account', code: 'CG-AUTH-REQUIRED' } });
    expect(step(w, 'consent')?.action?.action).toEqual({ type: 'RequestPermission', kind: 'data-collection' });
    for (const id of ['persona', 'binding', 'sound-hotkeys']) expect(step(w, id)?.action, id).toBeNull();

    // The steps work from this screen.
    await w.client.dispatch({ type: 'RequestPermission', kind: 'chatspace-host' });
    await w.client.dispatch({ type: 'RequestPermission', kind: 'hub-host' });
    await w.client.dispatch({ type: 'RequestPermission', kind: 'data-collection' });
    expect(step(w, 'host-permission')?.done).toBe(true);
    expect(step(w, 'consent')?.done).toBe(true);
    await w.client.dispatch({ type: 'OpenSettings', route: { section: 'account', code: 'CG-AUTH-REQUIRED' } });
    expect(w.client.location.value).toMatchObject({ section: 'account', code: 'CG-AUTH-REQUIRED' });

    expect(await w.client.dispatch({ type: 'SignIn', login: 'chatter1', password: 'synthetic-pass' })).toMatchObject({ ok: true });
    await settle();
    expect(step(w, 'sign-in')).toMatchObject({ done: true, action: null });
    expect(step(w, 'persona')?.action?.action).toEqual({ type: 'OpenSettings', route: { section: 'personas' } });
  });

  it('[ST-012] hidden for good on the sign-in screen too', async () => {
    const w = await open({ state: signedOutState() });
    const checklist = options(w, 'status').checklist;
    expect(checklist).not.toBeNull();
    if (checklist !== null) await w.client.dispatch(checklist.dismiss);
    expect(w.state.settings.onboarding.checklistDismissed).toBe(true);
    expect(options(w, 'status').checklist).toBeNull();
  });
});
