// The sign-in guards of the pages controller (`createPagesClient`), each
// staged as the race or the failure it stands against: the password goes only
// to the hub address on screen and saved (§8.2, ST-042), a sign-in state that
// could not be read changes no address (PU-002), one submit is one sign-in.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS, type OptionsVM, type SettingsSection } from '@cg/contracts';
import { FOCUS_RECHECK_MIN_INTERVAL_MS } from '@cg/core/application/pages';

import { PAGES_NOW, pagesWorld, settle, signedOutState, workingState, type PagesWorld, type PagesWorldOptions } from './world';

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

const CUSTOM_HUB = 'https://hub.custom.example.test';

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
