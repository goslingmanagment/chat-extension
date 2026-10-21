// The switch from the old Fansly extension (audit №9): «Включить Fansly» — the popup's quiet word in its foot (the
// verdict stays as it is: Fansly chatters stay on the old extension until the switch conditions) — and one press brings
// the open Fansly tab up by itself; a direct request without an answer points to «Fansly через вкладку»; the old
// extension's marks on a tab — the notice that says which ChatGoose to switch off; «Персоны» — the old extension's
// personas carried over from its export.

import { pageRpc } from '../../support/extension';
import { neighborUrl } from '../../support/fansly-neighbor';
import { fakeFansly } from '../../support/fansly-stand';
import { openOptions, openPopup, press, waitForOptions, waitForPopup } from '../../support/pages';
import { scenario } from '../kit';

type Page = { readonly pageId: number; readonly platform: string; readonly platformAccountId: string | null };
type Persona = { readonly key: string; readonly status: string; readonly displayName: string };

scenario(
  'fansly-switch',
  async (s) => {
    await s.ready();
    const path = new URL(await s.browser.getUrl()).pathname;
    // A mark on the open Fansly document: gone after the switch-on means the tab reloaded by itself.
    await s.browser.execute(() => { (window as unknown as { cgSeeMark?: number }).cgSeeMark = 1; });

    // 1. Fansly switched off in this browser: «Включить Fansly» in the popup's foot, one press, the tab comes up by itself.
    await s.toPages();
    // `site.access` is the popup's and the settings' own request.
    await openOptions('accounts');
    const off = await pageRpc('site.access', { host: 'fansly-web', enabled: false });
    if (!off.ok) throw new Error(`site.access: ${off.error.code}`);
    await openPopup();
    await waitForPopup((state) => /Включить Fansly/.test(state.text), 'the popup offers «Включить Fansly»');
    await s.shot('popup-fansly-off');
    await press('Включить Fansly');
    await waitForPopup((state) => /Выключить Fansly/.test(state.text), 'Fansly on, its tab reloaded');
    await s.toChat();
    await s.browser.waitUntil(async () => (await s.browser.execute(() => (window as unknown as { cgSeeMark?: number }).cgSeeMark)) === undefined, { timeout: 15_000, timeoutMsg: 'the Fansly tab did not reload by itself' });
    await s.ready(30_000);
    await s.shot('fansly-on-in-one-step');

    // 2. Our direct request to Fansly gets no answer (the stand holds it past the client's 30 s; a dropped GET Firefox
    // resends by itself), as for a chatter whose Fansly opens only through a VPN or proxy: the failure points to
    // «Fansly через вкладку».
    await fakeFansly().command({ op: 'api', rules: [{ route: 'account.byIds', caller: 'ours', times: 1, outcome: { kind: 'hang' } }] });
    await s.keys(s.MOD, s.Key.Shift, 'k');
    await s.see('panel', /CG-FAN-NETWORK/, 45_000);
    await s.shot('notes-no-direct-connection');

    // 3. The old extension's marks on the tab: the new one stands aside and says which ChatGoose to switch off.
    await s.browser.url(`${neighborUrl(path, { mode: 'off' })}&stand-old=1`);
    await s.wait(2500);
    await s.shot('old-extension-notice');

    // 4. «Персоны»: the Fansly page without a persona gets the one its account had in the old extension.
    await s.toPages();
    await openOptions('personas');
    const boot = await pageRpc<{ pages: readonly Page[] }>('bootstrap.get', {});
    const catalog = await pageRpc<{ personas: readonly Persona[] }>('catalog.get', {});
    if (!boot.ok || !catalog.ok) throw new Error('bootstrap or catalog');
    const page = boot.payload.pages.find((entry) => entry.platform === 'fansly' && entry.platformAccountId !== null);
    const persona = catalog.payload.personas.find((entry) => entry.status === 'active');
    if (page === undefined || persona === undefined) throw new Error('no Fansly page or no active persona');
    const cleared = await pageRpc('settings.patch', { patch: { personas: { byPageId: { [String(page.pageId)]: null } } }, baseRevision: null });
    if (!cleared.ok) throw new Error(`settings.patch: ${cleared.error.code}`);
    await openOptions('personas');
    await waitForOptions((state) => state.section === 'personas' && !state.loading, 'Персоны');
    const exported = JSON.stringify(
      { schemaVersion: 1, origin: { client: 'chatgoose-firefox-extension', extensionVersion: '2.13.0' }, currentLegacyData: { personalities: [], accountMappings: { [page.platformAccountId ?? '']: persona.key }, accountAliases: {} } },
      null,
      2,
    );
    const field = await s.browser.$('[data-pg-anchor="legacy-personas"] textarea');
    await field.setValue(exported);
    await s.shot('personas-pasted');
    await press('Перенести', '[data-pg-anchor="legacy-personas"]');
    await s.browser.waitUntil(async () => (await s.browser.$('[data-pg-legacy-import]').isExisting()), { timeout: 10_000, timeoutMsg: 'the import said nothing' });
    await s.shot('personas-carried-over');
    await s.toChat();
  },
  { sites: ['fansly'] },
);
