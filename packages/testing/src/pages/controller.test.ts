// The page controllers of core (`createPagesClient`) over the scripted
// background: what the sign-in sends and keeps (§8.2), and that no secret
// reaches a page or the report for the team lead.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS, type OptionsVM, type SettingsSection } from '@cg/contracts';

import { PAGES_NOW, pagesWorld, settle, signedOutState, type PagesWorld, type PagesWorldOptions } from './world';

let world: PagesWorld | null = null;
let clock = PAGES_NOW;

async function open(options: PagesWorldOptions = {}): Promise<PagesWorld> {
  world = pagesWorld({ now: () => clock, ...options });
  world.client.start();
  await settle();
  return world;
}

const options = <S extends SettingsSection>(w: PagesWorld, section: S): Readonly<OptionsVM<S>> => w.client.getSnapshot({ of: 'options', section });

beforeEach(() => {
  clock = PAGES_NOW;
  vi.useFakeTimers({ now: PAGES_NOW });
});
afterEach(() => {
  world?.client.dispose();
  world = null;
  vi.useRealTimers();
});

describe('options: «Статус»', () => {
  it('[ST-036] the report for the team lead: versions, rows, codes and times — no secret, no fan name', async () => {
    const w = await open();
    const receipt = await w.client.dispatch({ type: 'CopyReport', scope: 'status' });
    expect(receipt.ok).toBe(true);
    const report = w.browser.record.clipboard[0] ?? '';
    expect(report).toContain('ChatGoose 0.4.3');
    expect(report).not.toMatch(/synthetic-pass|password|token/i);
  });
});

describe('options: the sign-in screen and «Аккаунт» (§8.2)', () => {
  it('[ST-046] signing in asks host access inside the click, sends the password once and keeps none of it', async () => {
    const w = pagesWorld({ state: signedOutState(), now: () => clock });
    world = w;
    w.browser.granted.delete(DEFAULT_SETTINGS.hub.baseUrl);
    w.client.start();
    await settle();
    const pending = w.client.dispatch({ type: 'SignIn', login: 'chatter1', password: 'synthetic-pass' });
    // Before anything was awaited: the permission prompt is already asked for.
    expect(w.browser.record.permissionRequests).toEqual([DEFAULT_SETTINGS.hub.baseUrl]);
    expect(options(w, 'account').signIn).toMatchObject({ busy: true, login: 'chatter1' });
    expect(await pending).toMatchObject({ ok: true });
    await settle();
    expect(w.background.requests('session.signIn')).toEqual([{ login: 'chatter1', password: '[14]' }]);
    expect(options(w, 'status').view.s).toBe('ready');
    expect(JSON.stringify(options(w, 'account'))).not.toContain('synthetic-pass');
  });

  it('[ST-046] wrong credentials stay on the form as CG-LOGIN-CREDENTIALS; refused host access never sends the sign-in', async () => {
    const w = await open({ state: signedOutState() });
    expect(await w.client.dispatch({ type: 'SignIn', login: 'chatter1', password: 'wrong' })).toMatchObject({ ok: false, code: 'CG-LOGIN-CREDENTIALS' });
    expect(options(w, 'account').signIn).toMatchObject({ busy: false, login: 'chatter1', error: { code: 'CG-LOGIN-CREDENTIALS' } });

    w.browser.granted.clear();
    w.browser.grantOnRequest = false;
    await w.client.dispatch({ type: 'RequestPermission', kind: 'hub-host' });
    const calls = w.background.requests('session.signIn').length;
    expect(await w.client.dispatch({ type: 'SignIn', login: 'chatter1', password: 'synthetic-pass' })).toMatchObject({ ok: false, code: 'CG-HUB-HOST-PERMISSION' });
    expect(w.background.requests('session.signIn')).toHaveLength(calls);
  });

  it('[ST-051] signing out clears the sign-in here; a revoke the hub did not confirm is said, not hidden', async () => {
    const w = await open();
    w.state.serverRevoked = null;
    const receipt = await w.client.dispatch({ type: 'SignOut' });
    expect(receipt).toMatchObject({ ok: false, code: 'CG-HUB-UNAVAILABLE' });
    const vm = options(w, 'status');
    expect(vm.view).toMatchObject({ s: 'forbidden', error: { code: 'CG-AUTH-REQUIRED' } });
    expect(vm.view.s === 'forbidden' ? vm.view.error.detail : undefined).toBeDefined();
    expect(vm.signIn).not.toBeNull();
  });
});

describe('options: what the mockup does not draw (parity rows)', () => {
  it('[ST-047] «Это устройство»: signed in or not, and a re-sign-in in place; nothing of the device secret reaches the page', async () => {
    const w = await open();
    const body = options(w, 'account').body;
    expect(body?.user).toEqual({ login: 'chatter1', role: 'chatter', deviceSince: null });
    expect(body?.signInAgain?.action).toEqual({ type: 'OpenSettings', route: { section: 'account', code: 'CG-AUTH-REQUIRED' } });
    // The page never asks for more than the identity: the session answer has no credential in it.
    expect(JSON.stringify(w.background.calls.filter((call) => call.type === 'session.get'))).not.toMatch(/secret|credential|password/i);
    expect(Object.keys(w.state.session ?? {}).sort()).toEqual(['epoch', 'hubOrigin', 'login', 'role', 'userId']);
  });
});
