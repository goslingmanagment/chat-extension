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
  it('sleep between headers and response restores the pending confirmation, but an older completion cannot switch back accounts', async () => {
    const { service, store } = setup(); await service.setEnabled(true);
    await service.accept(request('old'));
    await service.accept(request('new', { requestHeaders: headers(other) }));
    const restored = setup(store).service; await restored.setEnabled(true);
    await restored.accept(complete(request('new'))); await restored.accept(complete(request('old')));
    expect(restored.forTab(1)?.legacyId).toBe(other);
    expect(restored.forAccount(account)).toBeNull();
  });
  it('storage failure is fail-closed and revoke clears credentials in memory and session', async () => {
    const { service, store } = setup(); await service.setEnabled(true);
    await service.accept(request('one')); await service.accept(complete(request('one')));
    store.failNext('set');
    await expect(service.accept(request('two'))).rejects.toThrow();
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
