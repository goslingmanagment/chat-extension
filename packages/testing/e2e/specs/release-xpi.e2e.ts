// R00 acceptance «XPI ставится временным дополнением в текущий Firefox» on the
// RELEASE XPI itself (the other specs install only the test build, which has
// another gecko id, no update_url, extra hosts and the e2e probe). No
// ChatSpace page is opened: the release build matches only the real origin.
// And no status surface is opened either: the popup and the options page ask
// for the hub's health when they open, and a release build's hub is the real
// one — this spec makes no request at all.

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
    await expect($('#app')).toHaveText(expect.stringContaining('Отладка'));
    // From our own extension page (sender id = ours, top frame); the event page wakes up and answers after its start steps.
    expect(await pageRpc('session.get')).toEqual({ ok: true, payload: { session: null } });
    const settings = await pageRpc<{ settings: { hub: { baseUrl: string }; debug: { enabled: boolean } }; readOnly: boolean }>('settings.get');
    expect(settings).toMatchObject({ ok: true, payload: { settings: { hub: { baseUrl: 'https://gosling-agency.ru' }, debug: { enabled: false } }, readOnly: false } });
    // A request only a ChatSpace tab may send is refused to a page.
    await expect(pageRpc('token.issue', { kind: 'insert', surface: 'dock' })).rejects.toThrow(/no answer/);
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
