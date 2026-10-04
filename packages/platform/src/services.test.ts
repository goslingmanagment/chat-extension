import { describe, expect, it, vi } from 'vitest';

import { alarmCreateInfo, createAlarms } from './alarms';
import { clientOsOf, extensionVersionOf, majorVersionOf, readClientEnv } from './env';
import { createConsent, createHostPermissions, originPermission, TECHNICAL_CONSENT } from './permissions';
import { createLifecycle } from './lifecycle';
import { extensionId, extensionUrl, isExtensionContextAlive } from './runtime';
import { mainScriptRegistration, syncDynamicMainScript } from './scripting';
import { TAB_MATCHES, createFakeBrowser, flush, pageSender, tabSender } from './test-support/fake-browser';

const HUB = 'https://hub.example.test';

describe('permissions (§3, §9.6)', () => {
  it('[EX-005] checks, requests on a gesture and removes the hub host access, any port', async () => {
    const fake = createFakeBrowser();
    const options = fake.context(pageSender(fake, 'options')).api;
    const hosts = createHostPermissions(options);
    const changes: unknown[] = [];
    hosts.onChange((change) => changes.push(change));
    expect(originPermission('https://hub.example.test:8443')).toBe('https://hub.example.test/*');
    expect(originPermission('ftp://hub.example.test')).toBeNull();
    expect(originPermission('not a url')).toBeNull();
    expect(await hosts.has(HUB)).toBe(false);
    fake.grantRequests = false;
    expect(await hosts.request(HUB)).toBe(false);
    fake.grantRequests = true;
    expect(await hosts.request(HUB)).toBe(true);
    expect(await hosts.has(HUB)).toBe(true);
    expect(fake.permissions.origins.has('https://hub.example.test/*')).toBe(true);
    expect(await hosts.remove(HUB)).toBe(true);
    expect(await hosts.has(HUB)).toBe(false);
    expect(await hosts.has('bogus')).toBe(false);
    expect(await hosts.request('bogus')).toBe(false);
    expect(await hosts.remove('bogus')).toBe(false);
    await flush();
    expect(changes).toEqual([
      { added: ['https://hub.example.test/*'], removed: [] },
      { added: [], removed: ['https://hub.example.test/*'] },
    ]);
  });

  it('consent: technicalAndInteraction is checked through getAll().data_collection, revoked anywhere, and fails closed', async () => {
    const fake = createFakeBrowser();
    const background = fake.startBackground().api;
    const consent = createConsent(background);
    const seen: boolean[] = [];
    const off = consent.onChange((granted) => seen.push(granted));
    expect(await consent.granted()).toBe(false);
    expect(await createConsent(fake.context(pageSender(fake, 'options')).api).request()).toBe(true);
    expect(fake.permissions.data_collection.has(TECHNICAL_CONSENT)).toBe(true);
    expect(await consent.granted()).toBe(true);
    // The person revokes it in about:addons: the listener hears it at once.
    fake.revokeFromBrowserUi({ data_collection: [TECHNICAL_CONSENT] });
    await flush();
    expect(seen).toEqual([true, false]);
    expect(await consent.granted()).toBe(false);
    // Unrelated permission changes are not consent changes.
    fake.revokeFromBrowserUi({ origins: ['https://x.test/*'] });
    await flush();
    expect(seen).toEqual([true, false]);
    expect(await consent.request()).toBe(true);
    expect(await consent.revoke()).toBe(true);
    await flush();
    expect(seen).toEqual([true, false, true, false]);
    off();
    vi.spyOn(background.permissions, 'getAll').mockRejectedValueOnce(new Error('broken'));
    expect(await consent.granted()).toBe(false);
    // check() tells a failure (null) from a "no" (false): a failed check is not a revoke.
    expect(await consent.check()).toBe(false);
    vi.spyOn(background.permissions, 'getAll').mockRejectedValueOnce(new Error('broken'));
    expect(await consent.check()).toBeNull();
  });
});

describe('alarms', () => {
  it('schedules by delay, instant and period; fires and wakes the background', async () => {
    const fake = createFakeBrowser();
    const background = fake.startBackground();
    const alarms = createAlarms(background.api);
    const fired: string[] = [];
    const off = alarms.onAlarm((name) => fired.push(name));
    expect(alarmCreateInfo({ delayMs: 30_000 })).toEqual({ delayInMinutes: 0.5 });
    expect(alarmCreateInfo({ at: 123, periodMs: 60_000 })).toEqual({ when: 123, periodInMinutes: 1 });
    expect(await alarms.set('cg.results.sweep', { delayMs: 60_000, periodMs: 300_000 })).toBe(true);
    expect(await alarms.next('cg.results.sweep')).toEqual(expect.any(Number));
    expect(await alarms.next('none')).toBeNull();
    fake.fireAlarm('cg.results.sweep');
    expect(fired).toEqual(['cg.results.sweep']);
    off();
    // The event page unloaded: the alarm wakes a new one, whose top level wires onAlarm first.
    fake.unloadBackground();
    fake.onWake((context) => createAlarms(context.api).onAlarm((name) => fired.push(`woken:${name}`)));
    fake.fireAlarm('cg.results.sweep');
    expect(fired).toEqual(['cg.results.sweep', 'woken:cg.results.sweep']);
    expect(await createAlarms(fake.background()?.api).clear('cg.results.sweep')).toBe(true);
    const broken = createAlarms({
      ...background.api,
      alarms: {
        create: () => Promise.reject(new Error('x')),
        clear: () => Promise.reject(new Error('x')),
        get: () => Promise.reject(new Error('x')),
        onAlarm: background.events.onAlarm,
      },
    });
    expect(await broken.set('a', { delayMs: 1 })).toBe(false);
    expect(await broken.clear('a')).toBe(false);
    expect(await broken.next('a')).toBeNull();
  });
});

describe('[EX-018] Firefox specifics', () => {
  it('registers the WS tap in the MAIN world at document_start, kept across restarts; resyncs only on a difference', async () => {
    const fake = createFakeBrowser();
    const api = fake.startBackground().api;
    const spec = { id: 'cg-ws-tap', js: ['chatspace-ws.js'], matches: [...TAB_MATCHES] };
    expect(await syncDynamicMainScript(spec, false, api)).toBe('unchanged');
    expect(await syncDynamicMainScript(spec, true, api)).toBe('registered');
    expect(fake.scripts.get('cg-ws-tap')).toEqual(mainScriptRegistration(spec));
    expect(fake.scripts.get('cg-ws-tap')).toMatchObject({ world: 'MAIN', runAt: 'document_start', persistAcrossSessions: true, allFrames: false });
    expect(await syncDynamicMainScript(spec, true, api)).toBe('unchanged');
    // An older registration without persistence is replaced.
    fake.scripts.set('cg-ws-tap', { ...mainScriptRegistration(spec), persistAcrossSessions: false });
    expect(await syncDynamicMainScript(spec, true, api)).toBe('registered');
    expect(await syncDynamicMainScript({ ...spec, matches: ['http://127.0.0.1/*'] }, true, api)).toBe('registered');
    expect(await syncDynamicMainScript(spec, false, api)).toBe('unregistered');
    expect(fake.scripts.size).toBe(0);
  });

  it('reads the browser major from getBrowserInfo (user agent as a fallback) and the OS', async () => {
    const fake = createFakeBrowser();
    const api = fake.startBackground().api;
    expect(await readClientEnv(api)).toEqual({ extensionVersion: '1.2.3', browser: 'firefox', browserMajor: 157, os: 'macos' });
    const noInfo = {
      ...api,
      runtime: {
        ...api.runtime,
        id: api.runtime.id,
        getManifest: () => {
          throw new Error('x');
        },
        getBrowserInfo: () => Promise.reject(new Error('x')),
        getPlatformInfo: () => Promise.reject(new Error('x')),
      },
    };
    expect(await readClientEnv(noInfo, 'Mozilla/5.0 (X11; Linux x86_64; rv:142.0) Gecko/20100101 Firefox/142.0')).toEqual({
      extensionVersion: '0.0.0',
      browser: 'firefox',
      browserMajor: 142,
      os: 'other',
    });
    // A page prints the version before anything answered: read at once, a placeholder when unreadable.
    expect(extensionVersionOf(api)).toBe('1.2.3');
    expect(extensionVersionOf(noInfo)).toBe('0.0.0');
    expect(clientOsOf('win')).toBe('windows');
    expect(clientOsOf('linux')).toBe('linux');
    expect(clientOsOf('android')).toBe('other');
    expect(clientOsOf(undefined)).toBe('other');
    expect(majorVersionOf('142.0.1')).toBe(142);
    expect(majorVersionOf('Chrome/120')).toBeNull();
    expect(majorVersionOf(undefined)).toBeNull();
  });

  it('[EX-014] every capability works on an injected API; a reloaded extension reads as gone', () => {
    const fake = createFakeBrowser();
    const tab = fake.context(tabSender(fake));
    expect(extensionUrl('lazy/dock.js', tab.api)).toBe(`${fake.base}lazy/dock.js`);
    expect(extensionId(tab.api)).toBe(fake.runtimeId);
    expect(isExtensionContextAlive(tab.api)).toBe(true);
    fake.reloadExtension();
    expect(isExtensionContextAlive(tab.api)).toBe(false);
    // No real `browser` in this process: the default reads as "not alive".
    expect(isExtensionContextAlive()).toBe(false);
  });

  it('[LG-018] lifecycle: installed, updated, browser start and suspend reach the background that wired them', () => {
    const fake = createFakeBrowser();
    const background = fake.startBackground();
    const lifecycle = createLifecycle(background.api);
    const seen: unknown[] = [];
    const offInstalled = lifecycle.onInstalled((details) => seen.push(details));
    lifecycle.onStartup(() => seen.push('startup'));
    lifecycle.onSuspend(() => seen.push('suspend'));
    lifecycle.onSuspendCanceled(() => seen.push('suspend-canceled'));
    fake.fireInstalled({ reason: 'install', temporary: true });
    fake.fireInstalled({ reason: 'update', previousVersion: '0.9.0' });
    fake.fireInstalled({ reason: 'browser_update' });
    // A reason this build does not know is «other», never passed through as is.
    fake.fireInstalled({ reason: 'shared_module_update' });
    fake.fireStartup();
    background.events.onSuspendCanceled.emit();
    offInstalled();
    fake.fireInstalled({ reason: 'install' });
    fake.suspendBackground();
    expect(seen).toEqual([
      { reason: 'install', previousVersion: null, temporary: true },
      { reason: 'update', previousVersion: '0.9.0', temporary: false },
      { reason: 'browser_update', previousVersion: null, temporary: false },
      { reason: 'other', previousVersion: null, temporary: false },
      'startup',
      'suspend-canceled',
      'suspend',
    ]);
    expect(fake.background()).toBeNull();
  });
});
