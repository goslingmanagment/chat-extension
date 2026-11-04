import { describe, expect, it, vi } from 'vitest';

import { createContainerProxy, type ContainerProxyDeps, type ContainerProxyList, type ContainerProxyRow, type ProxyAnswer, type ProxyInfoAnswer } from './container-proxy';

const LORA: ContainerProxyRow = { pageLabel: 'lora-1', platformAccountId: '737', scheme: 'socks5', host: '203.0.113.1', port: 12324, username: 'lora-user', password: 'lora-pass' };
const ARI: ContainerProxyRow = { pageLabel: 'ari-1', platformAccountId: '890', scheme: 'socks5', host: '203.0.113.2', port: 12324, username: 'ari-user', password: 'ari-pass' };
const OWN = 'moz-extension://own/';
const API = 'https://apiv3.fansly.com/api/v1/account/me';
const SITE = 'https://fansly.com/';
const ME = 'https://hub#1';

function world(over: Partial<ContainerProxyDeps> = {}, list: readonly ContainerProxyRow[] | null = [LORA, ARI]) {
  const kept = new Map<string, unknown>();
  const moves = vi.fn();
  let answer: ContainerProxyList | null | Error = list === null ? null : { owner: ME, rows: list };
  const deps: ContainerProxyDeps = {
    storage: {
      get: async (keys) => ({ ok: true, value: Object.fromEntries(keys.filter((key) => kept.has(key)).map((key) => [key, kept.get(key)])) }),
      set: async (items) => {
        for (const [key, value] of Object.entries(items)) kept.set(key, JSON.parse(JSON.stringify(value)));
        return { ok: true, value: undefined };
      },
    },
    fetchRows: async () => {
      if (answer instanceof Error) throw answer;
      return answer;
    },
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
  const hub = (next: ContainerProxyList | null | Error): void => { answer = next; };
  return { deps, kept, moves, hub, proxy: createContainerProxy(deps) };
}

const first = (answer: ProxyAnswer): ProxyInfoAnswer | null => answer?.[0] ?? null;
const refused = (answer: ProxyAnswer): boolean => first(answer)?.host === '127.0.0.1' && first(answer)?.port === 1;
const tabless = (store: string, url = SITE) => ({ url, tabId: -1, cookieStoreId: store });
const bearer = (value: string) => [{ name: 'Authorization', value }];

describe('container proxy: which proxy', () => {
  it('routes everything of a known container, a request without a tab and another host too, and never falls back to direct', async () => {
    const { proxy } = world();
    await proxy.refresh(true);
    await proxy.learnTab(6, ['737']);
    for (const request of [tabless('firefox-container-6'), tabless('firefox-container-6', 'wss://wsv3.fansly.com/?v=3'), { url: 'https://example.com/font.woff', tabId: 12, cookieStoreId: 'firefox-container-6' }]) {
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
    expect(first(await proxy.answer(tabless('firefox-container-6')))?.host).toBe(LORA.host);
    expect(first(await proxy.answer(tabless('firefox-container-7')))?.host).toBe(ARI.host);
  });

  it('leaves alone what is not its to route', async () => {
    const { proxy } = world();
    await proxy.refresh(true);
    await proxy.learnTab(6, ['737']);
    expect(await proxy.answer({ url: SITE, tabId: 3, cookieStoreId: 'firefox-container-9' })).toBeUndefined();
    expect(await proxy.answer(tabless('firefox-container-9'))).toBeUndefined();
    expect(await proxy.answer({ url: 'https://example.com/', tabId: 3, cookieStoreId: 'firefox-default' })).toBeUndefined();
    expect(await proxy.answer({ url: 'https://gosling-agency.ru/api/v1/client/bootstrap', tabId: -1, cookieStoreId: 'firefox-default', originUrl: `${OWN}background.html` })).toBeUndefined();
    expect(await proxy.answer({ url: SITE, tabId: 3, cookieStoreId: 'firefox-private' })).toBeUndefined();
  });

  it('routes a request by the account its token names, on Fansly only', async () => {
    const { proxy } = world({ canonicalOf: (legacy) => (legacy === 'old-id' ? '890' : null) });
    await proxy.refresh(true);
    expect(first(await proxy.answer({ url: API, tabId: -1, cookieStoreId: 'firefox-default', originUrl: `${OWN}bg`, requestHeaders: bearer('737:token') }))?.host).toBe(LORA.host);
    // The token names a legacy id, whose proven creator is the page's account.
    expect(first(await proxy.answer({ url: API, tabId: -1, cookieStoreId: 'firefox-default', requestHeaders: bearer('old-id:token') }))?.host).toBe(ARI.host);
    expect(await proxy.answer({ url: 'https://example.com/', tabId: -1, cookieStoreId: 'firefox-default', requestHeaders: bearer('737:token') })).toBeUndefined();
  });

  it('another model\'s token in a container goes through its own proxy, and the container is that model\'s from then on', async () => {
    const { proxy } = world();
    await proxy.refresh(true);
    await proxy.learnTab(6, ['737']);
    expect(first(await proxy.answer({ url: API, tabId: 4, cookieStoreId: 'firefox-container-6', requestHeaders: bearer('890:token') }))?.host).toBe(ARI.host);
    expect(first(await proxy.answer(tabless('firefox-container-6')))?.host).toBe(ARI.host);
  });

  it('refuses our own API request with no proxy rather than sending it from the chatter\'s line', async () => {
    const { proxy } = world();
    await proxy.refresh(true);
    const own = { url: API, tabId: -1, cookieStoreId: 'firefox-default', originUrl: `${OWN}bg`, requestHeaders: bearer('unknown:token') };
    expect(refused(await proxy.answer(own))).toBe(true);
    // A relay frame has a tab: its container answers for it, and another add-on's request is not ours to refuse.
    expect(await proxy.answer({ ...own, tabId: 5 })).toBeUndefined();
    expect(await proxy.answer({ ...own, originUrl: 'moz-extension://another/bg' })).toBeUndefined();
  });

  it('goes direct as before for a person with no proxies at all', async () => {
    const { proxy } = world({}, []);
    await proxy.refresh(true);
    expect(await proxy.answer({ url: API, tabId: -1, cookieStoreId: 'firefox-default', originUrl: `${OWN}bg` })).toBeUndefined();
    expect(await proxy.line('737', null)).toBe('direct');
  });

});

describe('container proxy: which page a container is', () => {
  it('learns from the first navigation\'s address and port, before the tab can report, and the account overrides it', async () => {
    const { proxy } = world();
    await proxy.refresh(true);
    proxy.learnPage({ cookieStoreId: 'firefox-container-6', proxyInfo: { host: LORA.host, port: LORA.port } });
    await proxy.refresh();
    expect(first(await proxy.answer(tabless('firefox-container-6')))?.host).toBe(LORA.host);
    await proxy.learnTab(6, ['890']);
    expect(first(await proxy.answer(tabless('firefox-container-6')))?.host).toBe(ARI.host);
  });

  it('two pages on one address: the port tells them apart, and an address and port two rows share prove nothing', async () => {
    const B = { ...ARI, host: LORA.host, port: 12325 };
    const { proxy } = world({}, [LORA, B]);
    await proxy.refresh(true);
    proxy.learnPage({ cookieStoreId: 'firefox-container-6', proxyInfo: { host: LORA.host, port: 12325 } });
    await proxy.refresh();
    expect(first(await proxy.answer(tabless('firefox-container-6')))?.port).toBe(12325);
    const twin = world({}, [LORA, { ...ARI, host: LORA.host, port: LORA.port }]);
    await twin.proxy.refresh(true);
    twin.proxy.learnPage({ cookieStoreId: 'firefox-container-7', proxyInfo: { host: LORA.host, port: LORA.port } });
    await twin.proxy.refresh();
    expect(await twin.proxy.answer(tabless('firefox-container-7'))).toBeUndefined();
  });

  it('what came before the hub\'s first list is placed once it comes', async () => {
    const { proxy, hub } = world();
    hub(new Error('the hub is slow'));
    await proxy.refresh(true);
    proxy.learnPage({ cookieStoreId: 'firefox-container-6', proxyInfo: { host: LORA.host, port: LORA.port } });
    await proxy.learnTab(7, ['890']);
    hub({ owner: ME, rows: [LORA, ARI] });
    await proxy.refresh(true);
    expect(first(await proxy.answer(tabless('firefox-container-6')))?.host).toBe(LORA.host);
    expect(first(await proxy.answer(tabless('firefox-container-7')))?.host).toBe(ARI.host);
  });

  it('keeps it across a restart of the background and of the browser, the hub down', async () => {
    const before = world();
    await before.proxy.refresh(true);
    await before.proxy.learnTab(6, ['737']);
    const after = createContainerProxy({ ...before.deps, fetchRows: async () => { throw new Error('the hub is down'); } });
    expect(first(await after.answer(tabless('firefox-container-6')))?.host).toBe(LORA.host);
  });

  it('moves our filter to the end when a navigation went through another address, and never overwrites the account\'s proxy with it', async () => {
    const { proxy, moves } = world();
    await proxy.refresh(true);
    await proxy.learnTab(6, ['890']);
    proxy.learnPage({ cookieStoreId: 'firefox-container-6', proxyInfo: { host: '198.51.100.9', port: 12324 } });
    await proxy.refresh();
    expect(moves).toHaveBeenCalledTimes(1);
    expect(first(await proxy.answer(tabless('firefox-container-6')))?.host).toBe(ARI.host);
  });

  it('a page that left the list keeps routing its container through the proxy it had', async () => {
    const { proxy, hub } = world();
    await proxy.refresh(true);
    await proxy.learnTab(6, ['737']);
    hub({ owner: ME, rows: [ARI] });
    await proxy.refresh(true);
    expect(first(await proxy.answer(tabless('firefox-container-6')))?.host).toBe(LORA.host);
    // A tab of that container now on a model the hub has no proxy for: refused without a tab, never direct.
    await proxy.learnTab(6, ['999']);
    expect(refused(await proxy.answer(tabless('firefox-container-6')))).toBe(true);
    expect(await proxy.answer({ url: SITE, tabId: 4, cookieStoreId: 'firefox-container-6' })).toBeUndefined();
  });
});

describe('container proxy: sign-in', () => {
  it('a sign-out keeps the proxies: a known container never goes direct', async () => {
    const { proxy, hub } = world();
    await proxy.refresh(true);
    await proxy.learnTab(6, ['737']);
    hub(null);
    await proxy.refresh(true);
    expect(first(await proxy.answer(tabless('firefox-container-6')))?.host).toBe(LORA.host);
  });

  it('another person\'s sign-in drops the proxies at once, the hub down: a known container\'s tab-less requests are refused', async () => {
    const { proxy, hub, kept } = world();
    proxy.setActive(true);
    await proxy.refresh(true);
    await proxy.learnTab(6, ['737']);
    hub(new Error('the hub is down'));
    await proxy.signedIn('https://hub#2');
    expect(JSON.stringify([...kept.values()])).not.toMatch(/lora-(user|pass)|ari-(user|pass)/);
    expect(refused(await proxy.answer(tabless('firefox-container-6')))).toBe(true);
    // The tab's own requests stay Multi-Account Containers'.
    expect(await proxy.answer({ url: SITE, tabId: 4, cookieStoreId: 'firefox-container-6' })).toBeUndefined();
    expect(proxy.lineNow('737', null)).toBe('tab');
  });

  it('the same person signing in again keeps the proxies while the hub answers', async () => {
    const { proxy } = world();
    await proxy.refresh(true);
    await proxy.learnTab(6, ['737']);
    await proxy.signedIn(ME);
    expect(first(await proxy.answer(tabless('firefox-container-6')))?.host).toBe(LORA.host);
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

  it('through the tab while the list is unknown', async () => {
    const down = world();
    down.hub(new Error('down'));
    expect(await down.proxy.line('737', null)).toBe('tab');
    expect(await world({}, null).proxy.line('737', null)).toBe('tab');
  });

  it('asks for the grant only of a person with proxies', async () => {
    const some = world();
    expect(await some.proxy.needed()).toBe(true);
    some.proxy.setActive(true);
    expect(await some.proxy.needed()).toBe(false);
    expect(await world({}, []).proxy.needed()).toBe(false);
  });
});

describe('container proxy: the second review', () => {
  it('a container switched to a model with no proxy: never the old model\'s proxy once proven, never direct', async () => {
    const { proxy } = world({ canonicalOf: (legacy) => (legacy === 'b-legacy' ? '999' : null) });
    await proxy.refresh(true);
    await proxy.learnTab(6, ['737']);
    // A token whose proven creator is not the container's page: refused without a tab, the tab's own left to the containers add-on.
    expect(refused(await proxy.answer({ url: SITE, tabId: -1, cookieStoreId: 'firefox-container-6', requestHeaders: bearer('b-legacy:token') }))).toBe(true);
    expect(await proxy.answer({ url: SITE, tabId: 4, cookieStoreId: 'firefox-container-6', requestHeaders: bearer('b-legacy:token') })).toBeUndefined();
    expect(refused(await proxy.answer(tabless('firefox-container-6')))).toBe(true);
  });

  it('a token of an unproven creator keeps the container\'s proxy rather than breaking the page', async () => {
    const { proxy } = world();
    await proxy.refresh(true);
    await proxy.learnTab(6, ['737']);
    expect(first(await proxy.answer({ url: SITE, tabId: -1, cookieStoreId: 'firefox-container-6', requestHeaders: bearer('unknown:token') }))?.host).toBe(LORA.host);
  });

  it('before the first list a container\'s tab-less request waits for it, then goes as the list says', async () => {
    let open: (list: ContainerProxyList) => void = () => undefined;
    const { proxy } = world({ fetchRows: () => new Promise((resolve) => { open = resolve; }) });
    proxy.learnPage({ cookieStoreId: 'firefox-container-6', proxyInfo: { host: LORA.host, port: LORA.port } });
    const pending = proxy.answer(tabless('firefox-container-6'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    open({ owner: ME, rows: [LORA, ARI] });
    expect(first(await pending)?.host).toBe(LORA.host);
  });

  it('no list at all: the site\'s requests are refused, other sites left alone', async () => {
    const { proxy, hub } = world();
    hub(new Error('the hub is down'));
    expect(refused(await proxy.answer(tabless('firefox-container-6')))).toBe(true);
    expect(await proxy.answer(tabless('firefox-container-6', 'https://apiv2.fbuddy.net/x'))).toBeUndefined();
    // The tab's own requests, with no token, never wait.
    expect(await proxy.answer({ url: SITE, tabId: 4, cookieStoreId: 'firefox-container-6' })).toBeUndefined();
  });

  it('an older tab report never undoes a binding a token made meanwhile', async () => {
    let release: () => void = () => undefined;
    const slow = new Promise<void>((resolve) => { release = resolve; });
    const { proxy } = world({ containerOfTab: async (tabId) => { await slow; return `firefox-container-${tabId}`; } });
    await proxy.refresh(true);
    const report = proxy.learnTab(6, ['737']);
    await proxy.answer({ url: API, tabId: 4, cookieStoreId: 'firefox-container-6', requestHeaders: bearer('890:token') });
    release();
    await report;
    expect(first(await proxy.answer(tabless('firefox-container-6')))?.host).toBe(ARI.host);
  });

  it('two rows on one proxy address with other logins never share a connection', async () => {
    const twin = { ...ARI, host: LORA.host, port: LORA.port };
    const { proxy } = world({}, [LORA, twin]);
    await proxy.refresh(true);
    const a = first(await proxy.answer({ url: API, tabId: -1, requestHeaders: bearer('737:token') }));
    const b = first(await proxy.answer({ url: API, tabId: -1, requestHeaders: bearer('890:token') }));
    expect(a?.connectionIsolationKey).toBeDefined();
    expect(a?.connectionIsolationKey).not.toBe(b?.connectionIsolationKey);
    expect(JSON.stringify([a?.connectionIsolationKey, b?.connectionIsolationKey])).not.toMatch(/lora|ari|203\.0/);
  });



  it('another person\'s sign-in, the hub down: a model\'s container refuses every tab-less request, Fansly or not', async () => {
    const { proxy, hub } = world();
    await proxy.refresh(true);
    await proxy.learnTab(6, ['737']);
    hub(new Error('the hub is down'));
    await proxy.signedIn('https://hub#2');
    expect(refused(await proxy.answer(tabless('firefox-container-6', 'https://apiv2.fbuddy.net/x')))).toBe(true);
  });

  it('before the first list a tab\'s report outranks an earlier navigation\'s address', async () => {
    const { proxy, hub } = world();
    hub(new Error('slow'));
    await proxy.refresh(true);
    proxy.learnPage({ cookieStoreId: 'firefox-container-6', proxyInfo: { host: LORA.host, port: LORA.port } });
    await proxy.learnTab(6, ['890']);
    hub({ owner: ME, rows: [LORA, ARI] });
    await proxy.refresh(true);
    expect(first(await proxy.answer(tabless('firefox-container-6')))?.host).toBe(ARI.host);
  });

  it('a container a tab placed is never moved by a navigation\'s address', async () => {
    const { proxy } = world();
    await proxy.refresh(true);
    await proxy.learnTab(6, ['737']);
    await proxy.learnTab(6, ['999']);
    proxy.learnPage({ cookieStoreId: 'firefox-container-6', proxyInfo: { host: ARI.host, port: ARI.port } });
    await proxy.refresh();
    expect(refused(await proxy.answer(tabless('firefox-container-6')))).toBe(true);
  });

  it('a container of no model never waits for the list with another site', async () => {
    let started = 0;
    const { proxy } = world({ fetchRows: () => { started += 1; return new Promise(() => undefined); } });
    expect(await proxy.answer(tabless('firefox-container-9', 'https://example.com/sw.js'))).toBeUndefined();
    expect(started).toBe(0);
  });

  it('a page whose proxy is HTTP is known by its account but never carried: refused without a tab, its login not kept', async () => {
    const { proxy, kept } = world({}, [{ ...LORA, scheme: 'http' }, { ...ARI, scheme: 'http', host: LORA.host, port: LORA.port }]);
    proxy.setActive(true);
    await proxy.refresh(true);
    await proxy.learnTab(6, ['737']);
    expect(refused(await proxy.answer(tabless('firefox-container-6')))).toBe(true);
    expect(refused(await proxy.answer({ url: API, tabId: -1, cookieStoreId: 'firefox-default', requestHeaders: bearer('890:token') }))).toBe(true);
    expect(await proxy.answer({ url: SITE, tabId: 4, cookieStoreId: 'firefox-container-6' })).toBeUndefined();
    expect(await proxy.line('737', null)).toBe('tab');
    expect(JSON.stringify([...kept.values()])).not.toMatch(/lora-(user|pass)|ari-(user|pass)/);
  });

  it('a token binding made while the first list is being kept outranks an older replayed tab report', async () => {
    const holder: { proxy?: ReturnType<typeof createContainerProxy>; armed: boolean } = { armed: false };
    const base = world();
    const deps: ContainerProxyDeps = {
      ...base.deps,
      storage: {
        get: base.deps.storage.get,
        set: async (items) => {
          if (holder.armed && holder.proxy !== undefined) {
            holder.armed = false;
            await holder.proxy.answer({ url: API, tabId: 4, cookieStoreId: 'firefox-container-6', requestHeaders: bearer('890:token') });
          }
          return base.deps.storage.set(items);
        },
      },
      fetchRows: async () => { throw new Error('slow'); },
    };
    holder.proxy = createContainerProxy(deps);
    await holder.proxy.refresh(true);
    await holder.proxy.learnTab(6, ['737']);
    const late = createContainerProxy({ ...deps, fetchRows: async () => ({ owner: ME, rows: [LORA, ARI] }) });
    holder.proxy = late;
    await late.learnTab(6, ['737']);
    holder.armed = true;
    await late.refresh(true);
    expect(first(await late.answer(tabless('firefox-container-6')))?.host).toBe(ARI.host);
  });

  it('two reports of one container before the first list: the later wins, whichever tab', async () => {
    const { proxy, hub } = world({ containerOfTab: async () => 'firefox-container-6' });
    hub(new Error('slow'));
    await proxy.refresh(true);
    await proxy.learnTab(11, ['737']);
    await proxy.learnTab(12, ['890']);
    hub({ owner: ME, rows: [LORA, ARI] });
    await proxy.refresh(true);
    expect(first(await proxy.answer(tabless('firefox-container-6')))?.host).toBe(ARI.host);
  });

  it('two reports of one tab answered out of order: the later still wins', async () => {
    const gates: Array<() => void> = [];
    const { proxy } = world({ containerOfTab: () => new Promise((resolve) => { gates.push(() => resolve('firefox-container-6')); }) });
    await proxy.refresh(true);
    const a = proxy.learnTab(6, ['737']);
    const b = proxy.learnTab(6, ['890']);
    await new Promise((resolve) => setTimeout(resolve, 0));
    gates[1]?.();
    await b;
    gates[0]?.();
    await a;
    expect(first(await proxy.answer(tabless('firefox-container-6')))?.host).toBe(ARI.host);
  });
});

describe('container proxy: a tab carried by its page’s proxy (the vault’s upload of a set starts only then)', () => {
  it('ok only with the grant, the hub’s list, a container and its creator’s page proxy; the container is that page’s then', async () => {
    const { proxy } = world();
    expect(await proxy.tabRoute(6, '737')).toBe('no-grant');
    proxy.setActive(true);
    expect(await proxy.tabRoute(6, '737')).toBe('ok');
    expect(first(await proxy.answer(tabless('firefox-container-6')))?.host).toBe(LORA.host);
  });

  it('says why not: no list, no proxies of this person, no container, no proxy this router carries for the page', async () => {
    const down = world({}, null);
    down.proxy.setActive(true);
    expect(await down.proxy.tabRoute(6, '737')).toBe('no-list');
    const none = world({}, []);
    none.proxy.setActive(true);
    expect(await none.proxy.tabRoute(6, '737')).toBe('no-proxies');
    const plain = world({ containerOfTab: async () => 'firefox-default' });
    plain.proxy.setActive(true);
    expect(await plain.proxy.tabRoute(6, '737')).toBe('no-container');
    const http = world({}, [{ ...LORA, scheme: 'http' }, ARI]);
    http.proxy.setActive(true);
    expect(await http.proxy.tabRoute(6, '737')).toBe('no-page-proxy');
    expect(await http.proxy.tabRoute(7, '999')).toBe('no-page-proxy');
  });

  it('a creator nobody proved moves no container', async () => {
    const { proxy } = world();
    proxy.setActive(true);
    expect(await proxy.tabRoute(6, null)).toBe('no-page-proxy');
    expect(await proxy.answer(tabless('firefox-container-6'))).toBeUndefined();
  });
});
