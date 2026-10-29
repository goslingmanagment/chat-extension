import { CONTRACTS_VERSION } from '@cg/contracts';
import { parseTabPayload } from '@cg/contracts/tab-messages';
import { createTabRpcClient, type TabRpcClient } from '@cg/platform';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PermissionsSetApi } from '../../../packages/platform/src/browser-api.ts';
import { tabSender } from '../../../packages/platform/src/test-support/fake-browser.ts';
import { permissionSet, RELOAD_KEY, scriptSet, telegramPermissionSet, TELEGRAM_RELOAD_KEY, telegramScriptSet } from '../src/composition/site-access.ts';
import { createWorld, sleep, until, type World } from './support/world.ts';

const worlds: World[] = [];
const clients: TabRpcClient[] = [];
beforeEach(() => {
  for (const level of ['debug', 'info', 'warn', 'error'] as const) vi.spyOn(console, level).mockImplementation(() => undefined);
});
afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  for (const w of worlds.splice(0)) w.dispose();
  await sleep(30);
  vi.restoreAllMocks();
});

describe.each([
  { host: 'fansly-web', url: 'https://fansly.com/messages', permissions: permissionSet, scripts: scriptSet, reloadKey: RELOAD_KEY },
  { host: 'telegram-web', url: 'https://web.telegram.org/a/', permissions: telegramPermissionSet, scripts: telegramScriptSet, reloadKey: TELEGRAM_RELOAD_KEY },
] as const)('$host startup reads', (site) => {
  it.each(['settings', 'reload list'] as const)('keeps scripts and the tab alive when reading the %s fails, then reconnects in the same background', async (source) => {
    let blocked = true;
    const key = source === 'settings' ? 'settings.ext' : site.reloadKey;
    const w = createWorld({
      configureApi(api) {
        const area = source === 'settings' ? api.storage.local : api.storage.session;
        const get = area.get.bind(area);
        vi.spyOn(area, 'get').mockImplementation((keys) => blocked && (keys === key || Array.isArray(keys) && keys.includes(key))
          ? Promise.reject(new Error('storage read unavailable'))
          : get(keys));
      },
    });
    worlds.push(w);
    const permissions: PermissionsSetApi = site.permissions();
    for (const origin of permissions.origins ?? []) w.fake.permissions.origins.add(origin);
    for (const permission of permissions.permissions ?? []) w.fake.permissions.permissions.add(permission);
    w.fake.areas.local.set('settings.ext', { v: 1, hosts: { [site.host]: { enabled: true } } });
    w.fake.areas.session.set(site.reloadKey, [21, 22]);
    const scripts = site.scripts().map((script) => ({ ...script, runAt: 'document_start' as const, allFrames: false, persistAcrossSessions: true }));
    for (const script of scripts) w.fake.scripts.set(script.id, script);
    const background = w.start();
    const page = w.page();
    await page.request('site.access', { host: site.host });
    expect(scripts.map((script) => w.fake.scripts.get(script.id))).toEqual(scripts);

    const context = w.fake.context(tabSender(w.fake, { url: site.url, origin: new URL(site.url).origin, tab: { id: 21, url: site.url } }));
    const siteOff = vi.fn();
    const client = createTabRpcClient({
      api: context.api, validate: parseTabPayload,
      register: { host: site.host, lateInjection: false, contractsVersion: CONTRACTS_VERSION },
      reconnectDelaysMs: [5, 10, 20],
      onSiteOff: siteOff,
    });
    clients.push(client);
    await until(() => client.state() === 'lost' || client.state() === 'closed', 'the unreadable access answered registration');
    expect(client.state()).toBe('lost');
    const responses = [...context.ports].flatMap((port) => port.peer?.posted ?? []);
    expect(responses).toContainEqual(expect.objectContaining({ type: 'tab.register', ok: false, error: { code: 'CG-RUNTIME-UNREACHABLE', detail: 'site access unavailable' } }));
    expect(siteOff).not.toHaveBeenCalled();
    expect(scripts.map((script) => w.fake.scripts.get(script.id))).toEqual(scripts);

    blocked = false;
    client.reconnect();
    await until(() => client.state() === 'ready', 'the same tab registered after storage recovered');
    expect(w.fake.background()).toBe(background);
    expect(w.starts()).toBe(1);
    expect(await page.request('site.access', { host: site.host })).toMatchObject({ ok: true, payload: { enabled: true, registered: true, waitingReload: 1 } });
    expect(w.fake.areas.session.get(site.reloadKey)).toEqual([22]);
    expect(siteOff).not.toHaveBeenCalled();

    expect(await page.request('site.access', { host: site.host, enabled: false })).toMatchObject({ ok: true, payload: { enabled: false, registered: false } });
    await until(() => client.state() === 'closed', 'a confirmed off switch closed the tab');
    expect(siteOff).toHaveBeenCalledOnce();
    expect(scripts.map((script) => w.fake.scripts.has(script.id))).toEqual(scripts.map(() => false));
  });
});
