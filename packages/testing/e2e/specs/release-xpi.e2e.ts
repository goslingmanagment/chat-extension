// R00 acceptance «XPI ставится временным дополнением в текущий Firefox» on the
// RELEASE XPI itself (the other specs install only the test build, which has
// another gecko id, no update_url, extra hosts and the e2e probe). No
// ChatSpace page is opened: the release build matches only the real origin.
// A release build's hub is the real one, and this spec makes no request at
// all: nobody signs in, and without a sign-in neither the settings page nor
// the popup asks the hub anything — the network trap fails the spec if one
// of them does.

import { browser, expect } from '@wdio/globals';

import { E2E_RELEASE_ADDON_UUID, RELEASE_GECKO_ID } from '../support/constants';
import { installBuild, pageRpc } from '../support/extension';
import { useNetworkTrap } from '../support/network-trap';

describe('release XPI', () => {
  useNetworkTrap();

  it('installs as a temporary add-on under the release gecko id', async () => {
    expect(await installBuild('release')).toBe(RELEASE_GECKO_ID);
  });

  it('its page renders and its background answers the page protocol: ready, nobody signed in, default settings', async () => {
    await browser.url(`moz-extension://${E2E_RELEASE_ADDON_UUID}/debug-journal.html`);
    // The journal page of a build nobody switched debug mode on in: it says so and reads no journal.
    await expect($('#app')).toHaveText(expect.stringContaining('Режим отладки выключен'));
    // From our own extension page (sender id = ours, top frame); the event page wakes up and answers after its start steps.
    expect(await pageRpc('session.get')).toEqual({ ok: true, payload: { session: null } });
    const settings = await pageRpc<{ settings: { hub: { baseUrl: string }; debug: { enabled: boolean } }; readOnly: boolean }>('settings.get');
    expect(settings).toMatchObject({ ok: true, payload: { settings: { hub: { baseUrl: 'https://gosling-agency.ru' }, debug: { enabled: false } }, readOnly: false } });
    // A request only a ChatSpace tab may send is refused to a page.
    await expect(pageRpc('token.issue', { kind: 'insert', surface: 'dock' })).rejects.toThrow(/no answer/);
  });

  it('[ST-011] [PU-002] [UP-008] its settings page is the sign-in screen and its popup says «Нужно войти» — with the stock hub address, and without one request to it', async () => {
    await browser.url(`moz-extension://${E2E_RELEASE_ADDON_UUID}/options.html`);
    await browser.waitUntil(async () => (await browser.execute(() => document.querySelector('.pg-page[data-pg-gate] .pg-signin') !== null)) === true, { timeout: 15_000, timeoutMsg: 'the release build did not draw its sign-in screen' });
    const screen = await browser.execute(() => ({
      chatter: [...document.querySelectorAll('.pg-check > .pg-check__list > .pg-check__item')].map((item) => item.getAttribute('data-pg-step')),
      lead: [...document.querySelectorAll('.pg-check__more:not([open]) .pg-check__item')].map((item) => item.getAttribute('data-pg-step')),
      address: document.querySelector<HTMLInputElement>('details[data-pg-anchor="hub-address"] input')?.value ?? null,
      access: document.querySelector('[data-pg-access]')?.getAttribute('data-pg-access') ?? null,
      title: document.title,
    }));
    // The first run (X55): the chatter's three steps in sight, the team lead's folded under «Ещё»; no «install» step —
    // a page of the extension is open.
    expect(screen).toMatchObject({ chatter: ['host-permission', 'sign-in', 'open-chatspace'], address: 'https://gosling-agency.ru', access: 'granted', title: 'Настройки ChatGoose' });
    expect(screen.lead).toHaveLength(4);
    expect(screen.lead).not.toContain('install');
    expect(screen.lead.filter((step) => screen.chatter.includes(step))).toEqual([]);
    // The hub of the manifest: its host access comes with the install, nothing is asked of the person.
    await browser.url(`moz-extension://${E2E_RELEASE_ADDON_UUID}/popup.html`);
    await browser.waitUntil(async () => (await browser.execute(() => document.querySelector('.pg-popup [data-cg-code="CG-AUTH-REQUIRED"]') !== null)) === true, { timeout: 15_000, timeoutMsg: 'the release build’s popup did not say that nobody is signed in' });
    // The status was read (the background answered), and the hub was not: the background knows nothing of its health.
    const diagnostics = await pageRpc<{ hub: { reachable: boolean | null }; extension: { testBuild: boolean } }>('diagnostics.get');
    expect(diagnostics).toMatchObject({ ok: true, payload: { hub: { reachable: null }, extension: { testBuild: false } } });
  });

  it('is a release build: no loopback host in its manifest, no e2e probe', async () => {
    const manifest = await browser.execute(() => {
      const api = (globalThis as unknown as { browser: { runtime: { getManifest(): { host_permissions?: string[]; content_scripts?: Array<{ matches: string[] }> } } } }).browser;
      const { host_permissions: hosts = [], content_scripts: scripts = [] } = api.runtime.getManifest();
      return { hosts, matches: scripts.flatMap((script) => script.matches) };
    });
    expect([...manifest.hosts, ...manifest.matches].filter((pattern) => /127\.0\.0\.1|localhost/.test(pattern))).toEqual([]);
    expect(manifest.matches.length).toBeGreaterThan(0);
    // The probe of the test build writes its report to <html data-cg-spike>; a release page has none of it.
    expect(await browser.execute(() => document.documentElement.hasAttribute('data-cg-spike'))).toBe(false);
  });
});
