import { describe, expect, it } from 'vitest';
import { createNetworkSession, legacyAccount, type OwnRequestObservation, type RequestFact } from './network-session';
import { createMemoryKv } from './test-support/memory-kv';

declare function btoa(value: string): string;

const PAGE = 'https://fansly.com/messages/9';
const API = 'https://apiv3.fansly.com/api/v1/message';
const OWN = 'moz-extension://our-id/';
const account = '123456789012345678';
const other = '123456789012345679';
let clientTimestamp = 100;
const headers = (id = account, token = 'fresh', check = 'message-check') => [
  { name: 'Authorization', value: btoa(`${id}:${token}`) },
  { name: 'fansly-client-id', value: 'client' }, { name: 'fansly-session-id', value: 'session' },
  { name: 'fansly-client-ts', value: String(++clientTimestamp) }, { name: 'fansly-client-check', value: check },
];
const request = (requestId: string, change: Partial<RequestFact> = {}): RequestFact => ({ phase: 'headers', requestId, url: API, tabId: 1, frameId: 0, documentUrl: PAGE, originUrl: PAGE, requestHeaders: headers(), ...change });
const complete = (fact: RequestFact, statusCode = 200): RequestFact => ({ ...fact, phase: 'completed', statusCode });
function setup(store = createMemoryKv()) {
  let now = 10_000;
  const service = createNetworkSession({ storage: store.open(), key: 'session', now: () => now,
    requestIdHeader: 'x-cg-request-id', ownOrigin: OWN, pageRequest: (fact) => fact.tabId >= 0 && fact.frameId === 0 && fact.documentUrl?.startsWith('https://fansly.com/') === true && fact.originUrl?.startsWith('https://fansly.com/') === true,
    apiRequest: (url) => url.startsWith('https://apiv3.fansly.com/api/v1/'),
    requiredHeaders: ['authorization', 'fansly-client-id', 'fansly-client-ts', 'fansly-session-id'], materialHeaders: ['authorization', 'fansly-client-id', 'fansly-session-id'], checkHeader: 'fansly-client-check', accountOf: legacyAccount,
    familyOf: (url) => url.includes('/account') ? 'account' : 'message',
  });
  return { service, store, advance: (ms: number) => { now += ms; } };
}

// Firefox cannot identify an MV3 neighbour which repeats a page's headers.
// A rejected replay must not replace the template; an accepted one may.
describe('[host:fansly] [BG-007] [AU-031] FS-NET-2 passive session observation', () => {
  it('observes our lost request and its late answer under the client id, without exposing headers or accepting a neighbour', async () => {
    const { service } = setup();
    await service.setEnabled(true);
    const seen: OwnRequestObservation[] = [];
    const off = service.onOwnRequest((fact) => seen.push(fact));
    const own = request('browser-id', { originUrl: OWN, tabId: -1, requestHeaders: [...headers(), { name: 'x-cg-request-id', value: 'client-id' }] });
    const neighbour = { ...own, requestId: 'neighbour', originUrl: 'moz-extension://neighbour/' };
    await service.accept(neighbour);
    await service.accept(complete(neighbour));
    await service.accept(own);
    await service.accept({ ...own, phase: 'error' });
    await service.accept(complete(own));
    expect(seen).toEqual([
      { clientRequestId: 'client-id', phase: 'headers' },
      { clientRequestId: 'client-id', phase: 'error' },
      { clientRequestId: 'client-id', phase: 'completed', statusCode: 200 },
    ]);
    off();
    await service.accept(own);
    expect(seen).toHaveLength(3);
  });
  it('relay, background, foreign/unknown origin and child frames never supply a template', async () => {
    const { service } = setup(); await service.setEnabled(true);
    for (const change of [{ originUrl: OWN }, { originUrl: 'moz-extension://foreign/' }, { documentUrl: OWN }, { tabId: -1 }, { frameId: 2 }, { documentUrl: 'https://foreign.example/' }, { documentUrl: '' }]) {
      const fact = request('bad', change); await service.accept(fact); await service.accept(complete(fact));
      expect(service.forTab(1)).toBeNull();
    }
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
  it('a failed write keeps the session usable and the next write carries it; revoke clears credentials in memory and session', async () => {
    const { service, store } = setup(); await service.setEnabled(true);
    await service.accept(request('one')); await service.accept(complete(request('one')));
    store.failNext('set');
    const next = request('two', { requestHeaders: headers(account, 'changed') });
    await service.accept(next);
    await expect(service.accept(complete(next))).rejects.toThrow();
    expect(service.forTab(1)?.headers['authorization']).toBe(btoa(`${account}:changed`));
    await service.register(2);
    expect(store.read<{ templates: { headers: Record<string, string> }[] }>('session')?.templates[0]?.headers['authorization']).toBe(btoa(`${account}:changed`));
    await service.setEnabled(false);
    expect(store.read<{ templates: unknown[] }>('session')?.templates).toEqual([]);
  });
});

it('[host:fansly] [LG-026] [FS-PRIV-2] page snapshot keeps only header names, ownership and age across switching and revoke', async () => {
  const { service, advance } = setup();
  await service.setEnabled(true);
  const captured = request('diagnostics', { requestHeaders: [...headers(account, 'unique-token-material', 'unique-check-material').map((header) => header.name === 'Authorization' ? header : { ...header, value: `unique-${header.name}-material` }), { name: 'cookie', value: 'unique-cookie-material' }] });
  await service.accept(captured); await service.accept(complete(captured));
  await service.resolveIdentity(account, other, service.forTab(1) ?? { headers: {} });
  advance(1500);
  const snapshot = service.diagnostics(1);
  expect(snapshot).toEqual({ present: true, ageMs: 1500, accountId: other, headerNames: ['authorization', 'fansly-client-check', 'fansly-client-id', 'fansly-client-ts', 'fansly-session-id'] });
  const wire = JSON.stringify(snapshot);
  for (const header of captured.requestHeaders ?? []) if ((header.value?.length ?? 0) > 3) expect(wire).not.toContain(header.value);
  expect(wire).not.toContain('unique-');
  expect(service.diagnostics(2)).toEqual({ present: false, ageMs: null, accountId: null, headerNames: [] });
  await service.disconnect(other);
  expect(service.diagnostics(1).present).toBe(false);
  await service.setEnabled(false);
  expect(service.diagnostics(1)).toEqual({ present: false, ageMs: null, accountId: null, headerNames: [] });
});

describe('review regression: session response identity', () => {
  it('a late 401/403 cannot disconnect a recaptured session, including an identical token', async () => {
    const { service } = setup();
    await service.setEnabled(true);
    await service.accept(request('first')); await service.accept(complete(request('first')));
    const used = service.forAccount(account)!;
    await service.accept(request('recaptured'));
    // Queue the successful recapture before the old request's disconnect.
    const accepted = service.accept(complete(request('recaptured')));
    const disconnected = service.disconnect(account, used);
    await accepted; await disconnected;
    expect(service.forAccount(account)?.connected).toBe(true);
    await service.disconnect(account, service.forAccount(account)!);
    expect(service.forAccount(account)).toBeNull();
  });
});

