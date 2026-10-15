import { describe, expect, it } from 'vitest';
import { createPermissionBundle } from './permissions';
import { syncDynamicScripts } from './scripting';
import { observeWebRequests } from './web-request';
import { createFakeBrowser, FakeEvent } from './test-support/fake-browser';
import type { WebRequestDetailsApi } from './browser-api';

const specs = [{ id: 'fansly-main', js: ['fansly-main.js'], world: 'MAIN' as const, matches: ['https://fansly.com/*'] }, { id: 'fansly', js: ['fansly.js'], world: 'ISOLATED' as const, matches: ['https://fansly.com/*'] }];

describe('[host:fansly] [EX-003] [EX-004] the optional bundle and dynamic registration', () => {
  it('requests both origins and webRequest in one synchronous call; never tabs or unlimitedStorage', async () => {
    const api = createFakeBrowser().startBackground().api;
    const calls: unknown[] = [];
    api.permissions.request = (set) => { calls.push(set); return Promise.resolve(true); };
    const set = { origins: ['https://fansly.com/*', 'https://apiv3.fansly.com/*'], permissions: ['webRequest'] };
    const bundle = createPermissionBundle(set, api);
    const result = bundle.request();
    expect(calls).toEqual([set]); expect(await result).toBe(true);
  });
  it('concurrent startup, grant, revoke, toggle and repair never duplicate an id; MAIN then ISOLATED in one call', async () => {
    const api = createFakeBrowser().startBackground().api;
    const batches: string[][] = [];
    const original = api.scripting.registerContentScripts.bind(api.scripting);
    api.scripting.registerContentScripts = async (scripts) => { batches.push(scripts.map((s) => s.id)); await original(scripts); };
    await Promise.all([syncDynamicScripts(specs, true, api), syncDynamicScripts(specs, true, api), syncDynamicScripts(specs, false, api), syncDynamicScripts(specs, true, api)]);
    expect(batches).toEqual([['fansly-main', 'fansly'], ['fansly-main', 'fansly']]);
    expect(await api.scripting.getRegisteredContentScripts()).toEqual(specs.map((spec) => ({ ...spec, runAt: 'document_start', allFrames: false, persistAcrossSessions: true })));
    await api.scripting.unregisterContentScripts({ ids: ['fansly-main'] });
    await syncDynamicScripts(specs, true, api);
    expect(batches.at(-1)).toEqual(['fansly-main', 'fansly']);
  });
  it('webRequest listeners attach synchronously at startup, can attach after first grant and detach on revoke', () => {
    const api = createFakeBrowser().startBackground().api;
    const before = new FakeEvent<(fact: WebRequestDetailsApi) => void>();
    const completed = new FakeEvent<(fact: WebRequestDetailsApi) => void>();
    const error = new FakeEvent<(fact: WebRequestDetailsApi) => void>();
    Object.defineProperty(api, 'webRequest', { value: { onBeforeSendHeaders: before, onCompleted: completed, onErrorOccurred: error }, configurable: true });
    const observer = observeWebRequests(['https://apiv3.fansly.com/*'], () => undefined, api);
    expect([before.size, completed.size, error.size]).toEqual([1, 1, 1]);
    observer.attach(); expect(before.size).toBe(1);
    observer.detach(); expect(before.size).toBe(0);
    observer.attach(); expect(before.size).toBe(1);
  });
});
