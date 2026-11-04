import { describe, expect, it, vi } from 'vitest';

import { createContainerProxy, type ContainerProxyDeps, type ContainerProxyRow, type ProxyAnswer, type ProxyInfoAnswer } from './container-proxy';

const LORA: ContainerProxyRow = { pageLabel: 'lora-1', platformAccountId: '737', scheme: 'socks5', host: '203.0.113.1', port: 12324, username: 'lora-user', password: 'lora-pass' };
const ARI: ContainerProxyRow = { pageLabel: 'ari-1', platformAccountId: '890', scheme: 'socks5', host: '203.0.113.2', port: 12324, username: 'ari-user', password: 'ari-pass' };
const OWN = 'moz-extension://own/';
const API = 'https://apiv3.fansly.com/api/v1/account/me';

function world(over: Partial<ContainerProxyDeps> = {}, list: readonly ContainerProxyRow[] | null = [LORA, ARI]) {
  const kept = new Map<string, unknown>();
  const moves = vi.fn();
  const fetchRows = vi.fn(async () => list);
  const deps: ContainerProxyDeps = {
    storage: {
      get: async (keys) => ({ ok: true, value: Object.fromEntries(keys.filter((key) => kept.has(key)).map((key) => [key, kept.get(key)])) }),
      set: async (items) => {
        for (const [key, value] of Object.entries(items)) kept.set(key, JSON.parse(JSON.stringify(value)));
        return { ok: true, value: undefined };
      },
    },
    fetchRows,
    // A token here is `<legacy account>:…`.
    accountOfToken: (token) => token.split(':')[0] ?? null,
    canonicalOf: () => null,
    containerOfTab: async (tabId) => `firefox-container-${tabId}`,
    ownOrigin: OWN,
    siteAddress: (url) => new URL(url).hostname.endsWith('fansly.com'),
    siteApi: (url) => url.startsWith('https://apiv3.fansly.com/'),
    moveToLast: moves,
    now: () => 1_000_000,
    log: () => undefined,
    ...over,
  };
  return { deps, kept, moves, fetchRows, proxy: createContainerProxy(deps) };
}

const first = (answer: ProxyAnswer): ProxyInfoAnswer | null => answer?.[0] ?? null;

describe('container proxy: which proxy', () => {
  it('routes everything of a known container, a request without a tab and another host too, and never falls back to direct', async () => {
    const { proxy } = world();
    await proxy.refresh(true);
    await proxy.learnTab(6, ['737']);
    for (const request of [
      { url: 'https://fansly.com/', tabId: -1, cookieStoreId: 'firefox-container-6' },
      { url: 'wss://wsv3.fansly.com/?v=3', tabId: -1, cookieStoreId: 'firefox-container-6' },
      { url: 'https://example.com/font.woff', tabId: 12, cookieStoreId: 'firefox-container-6' },
    ]) {
      const answer = await proxy.answer(request);
      expect(first(answer)).toMatchObject({ type: 'socks', host: LORA.host, username: 'lora-user', password: 'lora-pass', proxyDNS: true });
      expect(answer?.at(-1)).toBeNull();
    }
  });

  it('keeps two containers on their own proxies', async () => {
    const { proxy } = world();
    await proxy.refresh(true);
    await proxy.learnTab(6, ['737']);
    await proxy.learnTab(7, ['890']);
    expect(first(await proxy.answer({ url: 'https://fansly.com/', tabId: -1, cookieStoreId: 'firefox-container-6' }))?.host).toBe(LORA.host);
    expect(first(await proxy.answer({ url: 'https://fansly.com/', tabId: -1, cookieStoreId: 'firefox-container-7' }))?.host).toBe(ARI.host);
  });

  it('leaves alone what is not its to route', async () => {
    const { proxy } = world();
    await proxy.refresh(true);
    await proxy.learnTab(6, ['737']);
    // Another container, the default store on another site, the hub itself from the background, a private window.
    expect(await proxy.answer({ url: 'https://fansly.com/', tabId: 3, cookieStoreId: 'firefox-container-9' })).toBeUndefined();
    expect(await proxy.answer({ url: 'https://example.com/', tabId: 3, cookieStoreId: 'firefox-default' })).toBeUndefined();
    expect(await proxy.answer({ url: 'https://gosling-agency.ru/api/v1/client/bootstrap', tabId: -1, cookieStoreId: 'firefox-default', originUrl: `${OWN}background.html` })).toBeUndefined();
    expect(await proxy.answer({ url: 'https://fansly.com/', tabId: 3, cookieStoreId: 'firefox-private' })).toBeUndefined();
  });

  it('routes a request of no container by the account its token names, on Fansly only', async () => {
    const { proxy } = world({ canonicalOf: (legacy) => (legacy === 'old-id' ? '890' : null) });
    await proxy.refresh(true);
    const headers = (value: string) => [{ name: 'Authorization', value }];
    expect(first(await proxy.answer({ url: API, tabId: -1, cookieStoreId: 'firefox-default', originUrl: `${OWN}bg`, requestHeaders: headers('737:token') }))?.host).toBe(LORA.host);
    // The token names a legacy id, whose proven creator is the page's account.
    expect(first(await proxy.answer({ url: API, tabId: -1, cookieStoreId: 'firefox-default', requestHeaders: headers('old-id:token') }))?.host).toBe(ARI.host);
    expect(await proxy.answer({ url: 'https://example.com/', tabId: -1, cookieStoreId: 'firefox-default', requestHeaders: headers('737:token') })).toBeUndefined();
  });

  it('refuses our own API request with no proxy rather than sending it from the chatter\'s line', async () => {
    const { proxy } = world();
    await proxy.refresh(true);
    const own = { url: API, tabId: -1, cookieStoreId: 'firefox-default', originUrl: `${OWN}bg`, requestHeaders: [{ name: 'authorization', value: 'unknown:token' }] };
    expect(first(await proxy.answer(own))).toMatchObject({ host: '127.0.0.1', port: 1 });
    // A relay frame has a tab: its container answers for it, and another add-on's request is not ours to refuse.
    expect(await proxy.answer({ ...own, tabId: 5 })).toBeUndefined();
    expect(await proxy.answer({ ...own, originUrl: 'moz-extension://another/bg' })).toBeUndefined();
  });

  it('goes direct as before for a person with no proxies at all', async () => {
    const { proxy } = world({}, []);
    await proxy.refresh(true);
    expect(await proxy.answer({ url: API, tabId: -1, cookieStoreId: 'firefox-default', originUrl: `${OWN}bg` })).toBeUndefined();
  });

  it('drops a scheme it cannot carry a login on', async () => {
    const { proxy } = world({}, [{ ...LORA, scheme: 'http' }]);
    await proxy.refresh(true);
    await proxy.learnTab(6, ['737']);
    expect(await proxy.answer({ url: 'https://fansly.com/', tabId: -1, cookieStoreId: 'firefox-container-6' })).toBeUndefined();
  });
});

describe('container proxy: which page a container is', () => {
  it('learns from the first navigation\'s address, before the tab can report, and the account overrides it', async () => {
    const { proxy } = world();
    await proxy.refresh(true);
    proxy.learnPage({ cookieStoreId: 'firefox-container-6', proxyInfo: { host: LORA.host, port: 12323 } });
    await proxy.refresh();
    expect(first(await proxy.answer({ url: 'https://fansly.com/', tabId: -1, cookieStoreId: 'firefox-container-6' }))?.host).toBe(LORA.host);
    await proxy.learnTab(6, ['890']);
    expect(first(await proxy.answer({ url: 'https://fansly.com/', tabId: -1, cookieStoreId: 'firefox-container-6' }))?.host).toBe(ARI.host);
  });

  it('keeps it across a restart of the background and of the browser', async () => {
    const before = world();
    await before.proxy.refresh(true);
    await before.proxy.learnTab(6, ['737']);
    const after = createContainerProxy({ ...before.deps, fetchRows: async () => { throw new Error('the hub is down'); } });
    expect(first(await after.answer({ url: 'https://fansly.com/', tabId: -1, cookieStoreId: 'firefox-container-6' }))?.host).toBe(LORA.host);
  });

  it('moves our filter to the end when a navigation went through another address, and never overwrites the account\'s proxy with it', async () => {
    const { proxy, moves } = world();
    await proxy.refresh(true);
    await proxy.learnTab(6, ['890']);
    proxy.learnPage({ cookieStoreId: 'firefox-container-6', proxyInfo: { host: '198.51.100.9', port: 12324 } });
    await proxy.refresh();
    expect(moves).toHaveBeenCalledTimes(1);
    expect(first(await proxy.answer({ url: 'https://fansly.com/', tabId: -1, cookieStoreId: 'firefox-container-6' }))?.host).toBe(ARI.host);
  });

  it('a page taken from the person stops being routed with the next list', async () => {
    let list: readonly ContainerProxyRow[] = [LORA];
    const { proxy } = world({ fetchRows: async () => list });
    await proxy.refresh(true);
    await proxy.learnTab(6, ['737']);
    list = [ARI];
    await proxy.refresh(true);
    expect(await proxy.answer({ url: 'https://fansly.com/', tabId: -1, cookieStoreId: 'firefox-container-6' })).toBeUndefined();
  });
});

describe('container proxy: our own line', () => {
  it('straight only when the router carries the account, else through the tab', async () => {
    const { proxy } = world();
    expect(await proxy.line('737', null)).toBe('tab');
    proxy.setActive(true);
    expect(await proxy.line('737', null)).toBe('proxied');
    expect(await proxy.line('old-id', '890')).toBe('proxied');
    // A page the hub has no proxy for: its tab's own proxy, never the chatter's line.
    expect(await proxy.line('999', null)).toBe('tab');
    proxy.setActive(false);
    expect(proxy.lineNow('737', null)).toBe('tab');
  });

  it('through the tab while the list is unknown, direct only when it is known to be empty', async () => {
    const down = world({ fetchRows: async () => { throw new Error('down'); } });
    expect(await down.proxy.line('737', null)).toBe('tab');
    const signedOut = world({}, null);
    expect(await signedOut.proxy.line('737', null)).toBe('tab');
    const none = world({}, []);
    expect(await none.proxy.line('737', null)).toBe('direct');
  });

  it('a sign-out takes the logins away', async () => {
    const { proxy, kept } = world();
    proxy.setActive(true);
    await proxy.refresh(true);
    await proxy.learnTab(6, ['737']);
    await proxy.forget();
    expect(JSON.stringify([...kept.values()])).not.toMatch(/lora-(user|pass)/);
    expect(proxy.lineNow('737', null)).toBe('tab');
    expect(await proxy.answer({ url: 'https://fansly.com/', tabId: -1, cookieStoreId: 'firefox-container-6' })).toBeUndefined();
  });

  it('asks for the grant only of a person with proxies', async () => {
    const some = world();
    expect(await some.proxy.needed()).toBe(true);
    some.proxy.setActive(true);
    expect(await some.proxy.needed()).toBe(false);
    expect(await world({}, []).proxy.needed()).toBe(false);
  });
});
