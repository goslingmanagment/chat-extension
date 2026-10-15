import { describe, expect, it } from 'vitest';
import { createNetworkSession, legacyAccount, type RequestFact } from './network-session';
import { createMemoryKv } from './test-support/memory-kv';

declare function btoa(value: string): string;

const PAGE = 'https://fansly.com/messages/9';
const API = 'https://apiv3.fansly.com/api/v1/message';
const OWN = 'moz-extension://our-id/';
const account = '123456789012345678';
const other = '123456789012345679';
const headers = (id = account, token = 'fresh', check = 'message-check') => [
  { name: 'Authorization', value: btoa(`${id}:${token}`) },
  { name: 'fansly-client-id', value: 'client' }, { name: 'fansly-session-id', value: 'session' },
  { name: 'fansly-client-ts', value: '100' }, { name: 'fansly-client-check', value: check },
];
const request = (requestId: string, change: Partial<RequestFact> = {}): RequestFact => ({ phase: 'headers', requestId, url: API, tabId: 1, frameId: 0, documentUrl: PAGE, originUrl: PAGE, requestHeaders: headers(), ...change });
const complete = (fact: RequestFact, statusCode = 200): RequestFact => ({ ...fact, phase: 'completed', statusCode });
function setup(store = createMemoryKv()) {
  let now = 10_000;
  const service = createNetworkSession({ storage: store.open(), key: 'session', now: () => now,
    ownOrigin: OWN, pageRequest: (fact) => fact.tabId >= 0 && fact.frameId === 0 && fact.documentUrl?.startsWith('https://fansly.com/') === true && fact.originUrl?.startsWith('https://fansly.com/') === true,
    apiRequest: (url) => url.startsWith('https://apiv3.fansly.com/api/v1/'),
    requiredHeaders: ['authorization', 'fansly-client-id', 'fansly-client-ts', 'fansly-session-id'], materialHeaders: ['authorization', 'fansly-client-id', 'fansly-session-id'], checkHeader: 'fansly-client-check', accountOf: legacyAccount,
    familyOf: (url) => url.includes('/account') ? 'account' : 'message',
  });
  return { service, store, advance: (ms: number) => { now += ms; } };
}

// Firefox cannot identify an MV3 neighbour which repeats a page's headers.
// A rejected replay must not replace the template; an accepted one may.
describe('[host:fansly] [BG-007] [AU-031] FS-NET-2 passive session observation', () => {
  it('commits only after the matching 2xx, and survives sleep with route checks and precise ids', async () => {
    const { service, store } = setup();
    await service.setEnabled(true);
    const first = request('one');
    await service.accept(first);
    expect(service.forTab(1)).toBeNull();
    await service.accept(complete(first));
    await service.accept(request('account', { url: `${API}/account`, requestHeaders: headers(account, 'fresh', 'account-check') }));
    await service.accept(complete(request('account', { url: `${API}/account` })));
    expect(service.forTab(1)?.checks).toEqual({ message: 'message-check', account: 'account-check' });
    const restored = setup(store).service;
    await restored.setEnabled(true);
    expect(restored.forTab(1)).toEqual(service.forTab(1));
    expect(restored.forAccount(other)).toBeNull();
  });
  it('a failed neighbour request from the same tab does not rewrite or disconnect the page template', async () => {
    const { service } = setup(); await service.setEnabled(true);
    await service.accept(request('page')); await service.accept(complete(request('page')));
    const kept = service.forTab(1);
    for (const status of [401, 403, 429, 500]) {
      const replay = request(`neighbor-${status}`, { requestHeaders: headers(other, 'expired') });
      await service.accept(replay); await service.accept(complete(replay, status));
      expect(service.forTab(1)).toEqual(kept);
    }
    const accepted = request('neighbor-valid', { requestHeaders: headers(account, 'accepted') });
    await service.accept(accepted); await service.accept(complete(accepted));
    expect(service.forTab(1)?.headers['authorization']).toBe(btoa(`${account}:accepted`));
  });
  it('relay, background, foreign/unknown origin and child frames never supply a template', async () => {
    const { service } = setup(); await service.setEnabled(true);
    for (const change of [{ originUrl: OWN }, { originUrl: 'moz-extension://foreign/' }, { documentUrl: OWN }, { tabId: -1 }, { frameId: 2 }, { documentUrl: 'https://foreign.example/' }, { documentUrl: '' }]) {
      const fact = request('bad', change); await service.accept(fact); await service.accept(complete(fact));
      expect(service.forTab(1)).toBeNull();
    }
  });
  it('an unmatched completion, error, missing header or expired in-flight request cannot supply a session', async () => {
    const { service, advance } = setup(); await service.setEnabled(true);
    await service.accept(complete(request('unknown')));
    await service.accept(request('missing', { requestHeaders: headers().slice(0, 2) })); await service.accept(complete(request('missing')));
    await service.accept(request('error')); await service.accept({ ...request('error'), phase: 'error' }); await service.accept(complete(request('error')));
    await service.accept(request('late')); advance(121_000); await service.accept(complete(request('late')));
    expect(service.forTab(1)).toBeNull();
  });
  it('an older completion cannot switch back accounts', async () => {
    const { service, store } = setup(); await service.setEnabled(true);
    await service.accept(request('old'));
    await service.accept(request('new', { requestHeaders: headers(other) }));
    await service.accept(complete(request('new'))); await service.accept(complete(request('old')));
    expect(service.forTab(1)?.legacyId).toBe(other);
    const restored = setup(store).service; await restored.setEnabled(true);
    expect(restored.forTab(1)?.legacyId).toBe(other);
    expect(restored.forAccount(account)).toBeNull();
  });
  it('orders each tab binding independently of fresher templates from another tab, including after sleep', async () => {
    const { service, store } = setup(); await service.setEnabled(true);
    for (const tabId of [1, 2]) {
      const fact = request(`initial-${tabId}`, { tabId });
      await service.accept(fact); await service.accept(complete(fact));
    }
    const switched = request('switch', { requestHeaders: headers(other) });
    const fresher = request('fresher', { tabId: 2 });
    await service.accept(switched); await service.accept(fresher);
    await service.accept(complete(fresher)); await service.accept(complete(switched));
    expect(service.forTab(1)?.legacyId).toBe(other);
    expect(service.forTab(2)?.legacyId).toBe(account);
    const restored = setup(store).service; await restored.setEnabled(true);
    expect(restored.forTab(1)?.legacyId).toBe(other);
    expect(restored.forTab(2)?.legacyId).toBe(account);
  });
  it('binds a tab even when another tab confirmed a newer template for its destination account', async () => {
    const { service } = setup(); await service.setEnabled(true);
    const first = request('first');
    const second = request('second', { tabId: 2, requestHeaders: headers(account, 'newer') });
    await service.accept(first); await service.accept(second);
    await service.accept(complete(second)); await service.accept(complete(first));
    expect(service.forTab(1)?.headers['authorization']).toBe(btoa(`${account}:newer`));
    expect(service.forTab(2)?.headers['authorization']).toBe(btoa(`${account}:newer`));
  });
  it('writes no unconfirmed requests or unchanged facts, and coalesces a burst of confirmed changes', async () => {
    const { service, store } = setup(); await service.setEnabled(true);
    const baseline = store.calls.set;
    await service.accept(request('first'));
    expect(store.calls.set).toBe(baseline);
    await service.accept(complete(request('first')));
    const saved = store.calls.set;
    for (let i = 0; i < 5; i++) {
      const fact = request(`same-${i}`);
      await service.accept(fact); await service.accept(complete(fact));
    }
    await service.setEnabled(true);
    expect(store.calls.set).toBe(saved);
    const burst = [1, 2, 3].map((n) => request(`burst-${n}`, { requestHeaders: headers(account, `token-${n}`) }));
    await Promise.all(burst.map((fact) => service.accept(fact)));
    expect(store.calls.set).toBe(saved);
    await Promise.all(burst.map((fact) => service.accept(complete(fact))));
    expect(store.calls.set).toBe(saved + 1);
    expect(store.read<{ templates: { headers: Record<string, string> }[] }>('session')?.templates[0]?.headers['authorization']).toBe(btoa(`${account}:token-3`));
    const writes = store.calls.set;
    await service.resolveIdentity(1, account, other);
    await service.resolveIdentity(1, account, other);
    const limited = complete(request('limited'), 429);
    await service.accept(limited); await service.accept(limited);
    expect(store.calls.set).toBe(writes + 2);
  });
  it('storage failure is fail-closed and revoke clears credentials in memory and session', async () => {
    const { service, store } = setup(); await service.setEnabled(true);
    await service.accept(request('one')); await service.accept(complete(request('one')));
    store.failNext('set');
    const next = request('two', { requestHeaders: headers(account, 'changed') });
    await service.accept(next);
    await expect(service.accept(complete(next))).rejects.toThrow();
    expect(service.forTab(1)).toBeNull();
    await service.setEnabled(false);
    expect(store.read<{ templates: unknown[] }>('session')?.templates).toEqual([]);
  });
  it('[AU-032] resolves legacy to canonical only for the captured tab/session, survives sleep, and prunes a closed last tab', async () => {
    const { service, store } = setup(); await service.setEnabled(true);
    await service.accept(request('one')); await service.accept(complete(request('one')));
    await service.resolveIdentity(2, account, other); expect(service.forAccount(other)).toBeNull();
    await service.resolveIdentity(1, account, other);
    expect(service.forAccount(other)?.legacyId).toBe(account);
    const restored = setup(store).service; await restored.setEnabled(true);
    expect(restored.forAccount(other)?.canonicalId).toBe(other);
    await restored.forget(1); expect(restored.forAccount(other)).toBeNull();
  });
  it('[ER-050] expired sessions are unavailable until a new successful capture, without fallback', async () => {
    const { service } = setup(); await service.setEnabled(true);
    await service.accept(request('one')); await service.accept(complete(request('one')));
    await service.disconnect(account); expect(service.forTab(1)).toBeNull();
    await service.accept(request('two')); await service.accept(complete(request('two')));
    expect(service.forTab(1)?.connected).toBe(true);
  });
  it('legacy ids remain strings and malformed authorization is rejected', () => {
    expect(legacyAccount(btoa(`${account}:key`))).toBe(account);
    for (const value of ['', 'Bearer token', btoa('0:key'), btoa('x:key'), btoa(`${account}`)]) expect(legacyAccount(value)).toBeNull();
  });
});

describe('[host:fansly] FS-NET-3 all visible 429 facts, persisted before a future API/pacer runs', () => {
  it('page, neighbour and relay cool the registered creator; foreign tab -1 and unregistered tabs cool the whole profile', async () => {
    const { service, store } = setup(); await service.setEnabled(true);
    await service.register(1); await service.accept(request('page')); await service.accept(complete(request('page')));
    for (const [name, change, accountId] of [
      ['page', {}, account], ['neighbor', {}, account], ['relay', { originUrl: OWN, frameId: 2 }, account],
      ['unregistered', { tabId: 2 }, null], ['foreign', { tabId: -1, originUrl: 'moz-extension://foreign/' }, null], ['unknown', { tabId: -1, originUrl: '' }, null],
    ] as const) {
      const fact = complete(request(name, change), 429);
      await service.accept(fact); await service.accept(fact);
      expect(service.rateLimits().filter((entry) => entry.requestId === name)).toHaveLength(1);
      expect(service.rateLimits().find((entry) => entry.requestId === name)?.accountId).toBe(accountId);
    }
    const restored = setup(store).service; await restored.setEnabled(true);
    expect(restored.rateLimits()).toEqual(service.rateLimits());
  });
  it('our direct request is attributed by its captured authorization, without replacing a page template', async () => {
    const { service } = setup(); await service.setEnabled(true);
    await service.accept(request('page')); await service.accept(complete(request('page')));
    const own = request('own', { tabId: -1, originUrl: `${OWN}background.html`, requestHeaders: headers(account, 'own-old') });
    await service.accept(own); await service.accept(complete(own, 429));
    expect(service.rateLimits()).toEqual([{ requestId: 'own', at: 10_000, accountId: account, source: 'own' }]);
    expect(service.forTab(1)?.headers['authorization']).toBe(btoa(`${account}:fresh`));
  });
});

  it('[host:fansly] a completion after losing its unconfirmed headers cannot create a session', async () => {
    const { service, store } = setup(); await service.setEnabled(true);
    await service.accept(request('pending'));
    const restored = setup(store).service; await restored.setEnabled(true);
    await restored.accept(complete(request('pending')));
    expect(restored.forTab(1)).toBeNull();
    await restored.accept(request('fresh')); await restored.accept(complete(request('fresh')));
    expect(restored.forTab(1)?.legacyId).toBe(account);
  });
