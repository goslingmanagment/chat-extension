// The TEMPORARY pages of integration step M1 (R16's pages replace them when
// the pages are wired): the minimal options page and popup over a fake page
// port. What the live smoke reads is checked here in the DOM: who is signed
// in, the pages of the bootstrap, each binding with its page or its
// CG-BINDING-* code, the host contract.

import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it } from 'vitest';

import { type CgCode, type CgErrorView } from '@cg/contracts/errors';
import { viewOfCode } from '@cg/core/domain/errors';
import { createTranslator } from '@cg/core/domain/i18n';
import { mountTempPage, type TempPagePort, type TempPageStatus } from '@cg/ui';
import { SettableSignal, type KitMount } from '@cg/ui/kit';

import { flush, kitWorld } from './harness';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  document.body.replaceChildren();
});

// ── pages ──────────────────────────────────────────────────────────────────

const error = (code: CgCode): CgErrorView => viewOfCode(code, createTranslator('ru'));

const SIGNED_OUT: TempPageStatus = {
  version: '0.1.0',
  testBuild: false,
  reachable: true,
  error: null,
  session: null,
  hubUrl: 'https://hub.example.test',
  hub: { ok: true, error: null },
  bootstrap: null,
  bindings: [],
  contracts: [],
};
const SIGNED_IN: TempPageStatus = {
  ...SIGNED_OUT,
  session: { login: 'chatter1', role: 'chatter' },
  bootstrap: { ok: true, pages: ['model-one', 'model-one-vip'], configRevision: 5, error: null },
  bindings: [
    { account: '910101', page: 'model-one', code: null, openTabs: 1 },
    { account: '910202', page: null, code: 'CG-BINDING-MISSING', openTabs: 0 },
  ],
  contracts: [{ build: 'index-Synthetic1', state: 'ok' }],
};

interface FakePort extends TempPagePort {
  readonly status: SettableSignal<TempPageStatus | null>;
  readonly calls: string[];
  signInAnswer: CgErrorView | null;
}

function fakePort(initial: TempPageStatus | null): FakePort {
  const calls: string[] = [];
  const port: FakePort = {
    status: new SettableSignal<TempPageStatus | null>(initial),
    calls,
    signInAnswer: null,
    refresh: () => void calls.push('refresh'),
    signIn(login, password) {
      // What was typed reaches the port; the test never prints the password elsewhere.
      calls.push(`signIn:${login}:${password.length}`);
      return Promise.resolve(port.signInAnswer);
    },
    signOut() {
      calls.push('signOut');
      return Promise.resolve(null);
    },
    saveHubUrl(url) {
      calls.push(`saveHubUrl:${url}`);
      return Promise.resolve(null);
    },
    openOptions: () => void calls.push('openOptions'),
  };
  return port;
}

async function mountPage(page: 'options' | 'popup', port: TempPagePort): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.append(container);
  const world = kitWorld('gallery-ready', 'ru');
  let mount: KitMount | null = null;
  await act(() => {
    mount = mountTempPage(page, container, world.deps, port);
  });
  cleanups.push(() => (mount as unknown as KitMount).unmount());
  return container;
}

const rows = (container: HTMLElement, name: string): { state: string | null; value: string }[] =>
  [...container.querySelectorAll(`[data-cg-temp-row="${name}"]`)].map((row) => ({ state: row.getAttribute('data-cg-temp-state'), value: row.querySelector('.cg-temp__value')?.textContent ?? '' }));

async function type(input: HTMLInputElement, value: string): Promise<void> {
  await flush(() => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('TEMPORARY options page (M1): sign-in, sign-out, the hub address, status rows', () => {
  it('shows «loading» until the background answered', async () => {
    const container = await mountPage('options', fakePort(null));
    const root = container.querySelector('[data-cg-temp="options"]');
    expect(root?.getAttribute('data-cg-temp-ready')).toBe('no');
    expect(container.querySelector('[data-cg-temp="sign-in"]')).toBeNull();
  });

  it('[AU-001] signed out: the form sends the login and the password to the port once, clears the password, and shows the refusal with its code', async () => {
    const port = fakePort(SIGNED_OUT);
    port.signInAnswer = error('CG-LOGIN-CREDENTIALS');
    const container = await mountPage('options', port);
    expect(container.querySelector('[data-cg-temp="options"]')?.getAttribute('data-cg-temp-signed-in')).toBe('no');
    const form = container.querySelector('[data-cg-temp="sign-in"]') as HTMLElement;
    const login = form.querySelector('input:not([type="password"])') as HTMLInputElement;
    const password = form.querySelector('input[type="password"]') as HTMLInputElement;
    const submit = form.querySelector('button') as HTMLButtonElement;

    // Nothing is sent with an empty field.
    await flush(() => submit.click());
    expect(port.calls).toEqual([]);

    await type(login, 'chatter1');
    await type(password, 'synthetic-password');
    await flush(() => submit.click());
    await flush();
    expect(port.calls).toEqual(['signIn:chatter1:18']);
    expect(password.value).toBe('');
    expect(form.querySelector('[data-cg-code]')?.getAttribute('data-cg-code')).toBe('CG-LOGIN-CREDENTIALS');
    expect(rows(container, 'account')).toEqual([{ state: 'bad', value: 'вход не выполнен' }]);
    expect(rows(container, 'bootstrap')[0]?.state).toBe('none');
  });

  it('signed in: who, the pages of the bootstrap, each binding with its page or its code, the host contract; «Выйти» asks the port', async () => {
    const port = fakePort(SIGNED_IN);
    const container = await mountPage('options', port);
    expect(container.querySelector('[data-cg-temp="options"]')?.getAttribute('data-cg-temp-signed-in')).toBe('yes');
    expect(container.querySelector('[data-cg-temp="sign-in"]')).toBeNull();
    const signedIn = container.querySelector('[data-cg-temp="signed-in"]') as HTMLElement;
    expect(signedIn.getAttribute('data-cg-temp-login')).toBe('chatter1');
    expect(rows(container, 'hub')).toEqual([{ state: 'ok', value: expect.stringContaining('https://hub.example.test') as string }]);
    expect(rows(container, 'account')).toEqual([{ state: 'ok', value: 'chatter1 · chatter' }]);
    expect(rows(container, 'bootstrap')).toEqual([{ state: 'ok', value: 'model-one, model-one-vip' }]);
    const bindings = rows(container, 'binding');
    expect(bindings.map((row) => row.state)).toEqual(['ok', 'bad']);
    expect(bindings[0]?.value).toContain('910101');
    expect(bindings[0]?.value).toContain('model-one');
    expect(bindings[1]?.value).toContain('CG-BINDING-MISSING');
    expect(rows(container, 'contract')).toEqual([{ state: 'ok', value: expect.stringContaining('index-Synthetic1') as string }]);

    await flush(() => (signedIn.querySelector('button') as HTMLButtonElement).click());
    expect(port.calls).toEqual(['signOut']);
    // The page follows the status the port publishes.
    await flush(() => port.status.set(SIGNED_OUT));
    expect(container.querySelector('[data-cg-temp="sign-in"]')).not.toBeNull();
  });

  it('[ST-042] the hub address is saved while signed out and locked while signed in', async () => {
    const port = fakePort(SIGNED_OUT);
    const container = await mountPage('options', port);
    const advanced = container.querySelector('[data-cg-temp="advanced"]') as HTMLElement;
    const field = advanced.querySelector('input') as HTMLInputElement;
    expect(field.value).toBe('https://hub.example.test');
    expect(field.readOnly).toBe(false);
    await type(field, ' https://other.example.test ');
    await flush(() => (advanced.querySelector('button') as HTMLButtonElement).click());
    await flush();
    expect(port.calls).toEqual(['saveHubUrl:https://other.example.test']);

    await flush(() => port.status.set(SIGNED_IN));
    const locked = (container.querySelector('[data-cg-temp="advanced"]') as HTMLElement).querySelector('input') as HTMLInputElement;
    expect(locked.readOnly).toBe(true);
    expect(locked.getAttribute('aria-disabled')).toBe('true');
    await flush(() => (container.querySelector('[data-cg-temp="advanced"] button') as HTMLButtonElement).click());
    expect(port.calls).toEqual(['saveHubUrl:https://other.example.test']);
  });

  it('a background that does not answer: the error card with its code instead of an endless «loading»', async () => {
    const container = await mountPage('options', fakePort({ ...SIGNED_OUT, reachable: false, error: error('CG-RUNTIME-UNREACHABLE'), hub: null }));
    expect(container.querySelector('[data-cg-code]')?.getAttribute('data-cg-code')).toBe('CG-RUNTIME-UNREACHABLE');
    expect(rows(container, 'hub')[0]?.state).toBe('none');
  });
});

describe('TEMPORARY popup (M1): status only', () => {
  it('shows the same rows, no sign-in form and no hub address; its buttons open the settings and read the status again', async () => {
    const port = fakePort(SIGNED_IN);
    const container = await mountPage('popup', port);
    expect(container.querySelector('[data-cg-temp="popup"]')?.getAttribute('data-cg-temp-signed-in')).toBe('yes');
    expect(container.querySelectorAll('input, [data-cg-temp="sign-in"], [data-cg-temp="advanced"]')).toHaveLength(0);
    expect(rows(container, 'account')).toEqual([{ state: 'ok', value: 'chatter1 · chatter' }]);
    expect(rows(container, 'binding')).toHaveLength(2);
    const buttons = [...container.querySelectorAll('button')];
    expect(buttons).toHaveLength(2);
    await flush(() => buttons[0]?.click());
    await flush(() => buttons[1]?.click());
    expect(port.calls).toEqual(['openOptions', 'refresh']);
  });
});
