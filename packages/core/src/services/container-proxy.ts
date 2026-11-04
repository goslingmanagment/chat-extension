// In the background core, not in Fansly's module (architecture §3.3): a filter must be registered synchronously at the
// event page's start to wake it, and a site's module is a lazy chunk. Only Fansly has proxies today; its addresses are
// handed in.
//
// Everything a model's Firefox container sends leaves through the page's proxy (2026-11-04, the owner: «очень важно чтобы
// все шло через прокси»). Multi-Account Containers does `if (requestInfo.tabId === -1) return {}`, so whatever has no tab
// leaves from the chatter's own line, the model's token with it: Fansly's service worker (the site itself, its scripts,
// its images), another add-on's MV2 content script (FBuddy's own socket and API calls), this extension's background.
// Firefox still names the container on those requests (`cookieStoreId`), so this router answers them.
//
// - Which proxy: the hub's, by page (`clientFanslyProxies`): Firefox shows another add-on's proxy without its password.
//   The hub is the truth: the same address its own Fansly traffic of the page leaves through. SOCKS5 with its login;
//   HTTP and HTTPS with a Basic header.
// - The model's token decides first: a request on Fansly's addresses that carries one goes through its page's proxy,
//   and a container's request that carries another model's token than its page's moves the container to that page.
// - Which page a container is, else: the account its Fansly tab reports (`learnTab`); before that, on a container's
//   first navigation, the one row whose address and port the tab's own request went through (`learnPage`; two rows on
//   one address and port prove nothing). What comes before the hub's first list waits for it. Kept in storage.local, so
//   a browser restart starts routed.
// - A container known to be a model's never leaves direct without a tab: no proxy of its page (another person signed
//   in, the hub has not answered) — its tab-less requests are refused; its tab's own are Multi-Account Containers'.
// - The proxies stay through a sign-out (the browser restarts routed, and Multi-Account Containers keeps the same
//   logins itself); another person's sign-in drops them before anything is asked. A page that left the hub's list
//   keeps routing its container through the proxy it had until the hub names a new one.
// - A request of no container (this background's own `fetch`, another add-on's popup) without a known token is left
//   alone, but this background on Fansly's API while this person has proxies: a proxy that refuses (the proxy API
//   cannot cancel). A relay frame has a tab, and its container answers for it.
// - A known proxy has no way around it: a list ending in null fails rather than falling back to Firefox's direct route
//   (measured on Firefox 159: a dead proxy, nothing reached the server).
// - Another add-on's different proxy for the same container wins if its filter runs after ours (last wins, measured). A
//   navigation that went through another address moves our filter to the end, and says so in the log once.
// - Nothing here ever logs a row or a token: no address, no login.

import type { KeyValuePort } from './storage/ports';

const STORE_KEY = 'fansly.containerProxy';
/** A refresh the bootstrap asks for: at most this often (a proxy changes rarely; a new list arrives with the next). */
const REFRESH_EVERY_MS = 10 * 60 * 1000;
const CONTAINER_PREFIX = 'firefox-container-';
const SCHEMES: ReadonlySet<string> = new Set(['socks5', 'http', 'https']);

export interface ContainerProxyRow {
  readonly pageLabel: string;
  readonly platformAccountId: string | null;
  readonly scheme: string;
  readonly host: string;
  readonly port: number;
  readonly username: string | null;
  readonly password: string | null;
}

/** The hub's list and whose it is (the hub's origin and the user). */
export interface ContainerProxyList {
  readonly owner: string;
  readonly rows: readonly ContainerProxyRow[];
}

export interface ProxyRequestFact {
  readonly url: string;
  readonly tabId: number;
  readonly cookieStoreId?: string;
  readonly originUrl?: string;
  readonly requestHeaders?: readonly { readonly name: string; readonly value?: string }[];
}

export interface PageRequestFact {
  readonly cookieStoreId?: string;
  readonly proxyInfo?: { readonly host?: string; readonly port?: number } | null;
}

export type ProxyInfoAnswer =
  | { readonly type: 'socks'; readonly host: string; readonly port: number; readonly proxyDNS: true; readonly username?: string; readonly password?: string }
  | { readonly type: 'http' | 'https'; readonly host: string; readonly port: number; readonly proxyAuthorizationHeader?: string };

/** A list for Firefox's filter; undefined — no opinion: what the filters before ours chose stands. */
export type ProxyAnswer = readonly (ProxyInfoAnswer | null)[] | undefined;

/**
 * Where this background's own request to Fansly may leave: `proxied` — straight, the router carries it; `tab` — only
 * through the relay frame of the model's tab; `direct` — the person has no proxies at all, as before the router.
 */
export type OwnLine = 'proxied' | 'tab' | 'direct';

export interface ContainerProxyDeps {
  readonly storage: Pick<KeyValuePort, 'get' | 'set'>;
  /** Asked with the hub's sign-in; null — no sign-in now. Rejects when the hub did not answer. */
  readonly fetchRows: () => Promise<ContainerProxyList | null>;
  /** The account a session token names (`legacyAccount`). */
  readonly accountOfToken: (token: string) => string | null;
  /** The proven creator of a token's account, when known. */
  readonly canonicalOf: (legacyId: string) => string | null;
  readonly sessionReady?: Promise<unknown>;
  /** The browser's grant as it stands at the start of this realm. */
  readonly grant?: () => Promise<boolean>;
  readonly containerOfTab: (tabId: number) => Promise<string | null>;
  /** The extension's own origin (`moz-extension://…/`). */
  readonly ownOrigin: string;
  /** Any of the site's own addresses (composition site-access.ts: the core names no site's data). */
  readonly siteAddress: (url: string) => boolean;
  /** The site's API. */
  readonly siteApi: (url: string) => boolean;
  readonly moveToLast: () => void;
  readonly now: () => number;
  readonly log: (entry: { readonly level: 'info' | 'warn'; readonly scope: string; readonly msg: string; readonly data?: Readonly<Record<string, unknown>> }) => void;
}

export interface ContainerProxy {
  /** The answer of Firefox's filter: at once once the kept state is read. */
  answer(request: ProxyRequestFact): ProxyAnswer | Promise<ProxyAnswer>;
  /** A Fansly page's navigation, as `webRequest` saw it: which proxy it went through. */
  learnPage(page: PageRequestFact): void;
  /** A Fansly tab reported its accounts. */
  learnTab(tabId: number, accounts: readonly string[]): Promise<void>;
  /** The browser's grant (`proxy` and every address) as it stands. */
  setActive(active: boolean): void;
  /** Reads the hub's list if it is older than `REFRESH_EVERY_MS`, or at once with `force`. */
  refresh(force?: boolean): Promise<void>;
  /** A sign-in (`<hub origin>#<user id>`): another person's proxies go before anything is asked, then the list is read. */
  signedIn(owner: string): Promise<void>;
  line(legacyId: string, canonicalId: string | null): Promise<OwnLine>;
  /** `line` as it stands, for the last check right before a send. */
  lineNow(legacyId: string, canonicalId: string | null): OwnLine;
  /** This person has proxies and the browser's grant is missing: the tab says so, once. */
  needed(): Promise<boolean>;
}

function validRow(value: unknown): value is ContainerProxyRow {
  if (value === null || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row['pageLabel'] === 'string' && typeof row['host'] === 'string' && typeof row['port'] === 'number' && typeof row['scheme'] === 'string';
}

const usable = (row: ContainerProxyRow): boolean => SCHEMES.has(row.scheme) && row.host.length > 0 && row.port > 0;

/** Nothing listens there: the request fails at once, and the list's null keeps Firefox from going direct instead. */
const REFUSED: ProxyAnswer = [{ type: 'socks', host: '127.0.0.1', port: 1, proxyDNS: true }, null];

function basic(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return `Basic ${btoa(text)}`;
}

function answerOf(row: ContainerProxyRow): ProxyAnswer {
  if (row.scheme === 'socks5') {
    return [{
      type: 'socks',
      host: row.host,
      port: row.port,
      proxyDNS: true,
      ...(row.username === null ? {} : { username: row.username }),
      ...(row.password === null ? {} : { password: row.password }),
    }, null];
  }
  const type = row.scheme === 'https' ? 'https' : 'http';
  return [{ type, host: row.host, port: row.port, ...(row.username === null ? {} : { proxyAuthorizationHeader: basic(row.username, row.password ?? '') }) }, null];
}

export function createContainerProxy(deps: ContainerProxyDeps): ContainerProxy {
  /** Whose rows these are; null — nobody's yet. */
  let owner: string | null = null;
  let rows: readonly ContainerProxyRow[] = [];
  /** The hub's last list had a row, of any scheme: this person works behind proxies. */
  let anyProxy = false;
  /** A list was read for this owner. */
  let known = false;
  let fetchedAt = 0;
  let active = false;
  let settled = false;
  const containers = new Map<string, string>();
  const said = new Set<string>();
  /** Facts from before the first list: replayed once it comes. */
  const earlyPages = new Map<string, { readonly host: string; readonly port: number | undefined }>();
  const earlyTabs = new Map<number, readonly string[]>();
  let refreshing: Promise<void> | null = null;

  const persist = async (): Promise<void> => {
    await deps.storage.set({ [STORE_KEY]: { v: 1, owner, rows, anyProxy, known, fetchedAt, containers: Object.fromEntries(containers) } });
  };

  const ready: Promise<void> = (async () => {
    const kept = await deps.storage.get([STORE_KEY]).catch(() => null);
    const value = kept?.ok === true ? (kept.value[STORE_KEY] as Record<string, unknown> | undefined) : undefined;
    if (value !== undefined && value !== null && value['v'] === 1) {
      owner = typeof value['owner'] === 'string' ? value['owner'] : null;
      rows = Array.isArray(value['rows']) ? value['rows'].filter(validRow).filter(usable) : [];
      anyProxy = value['anyProxy'] === true || rows.length > 0;
      known = value['known'] === true;
      fetchedAt = typeof value['fetchedAt'] === 'number' ? value['fetchedAt'] : 0;
      const stored = value['containers'];
      if (stored !== null && typeof stored === 'object') {
        for (const [store, label] of Object.entries(stored)) if (typeof label === 'string') containers.set(store, label);
      }
    }
    await deps.sessionReady?.catch(() => undefined);
    if (deps.grant !== undefined) active = await deps.grant().catch(() => false);
    settled = true;
  })();

  const rowOfLabel = (label: string | undefined): ContainerProxyRow | null => (label === undefined ? null : rows.find((row) => row.pageLabel === label) ?? null);
  const rowOfAccount = (id: string | null): ContainerProxyRow | null => (id === null ? null : rows.find((row) => row.platformAccountId === id) ?? null);
  const rowOfToken = (token: string): ContainerProxyRow | null => {
    const legacy = deps.accountOfToken(token);
    return legacy === null ? null : rowOfAccount(legacy) ?? rowOfAccount(deps.canonicalOf(legacy));
  };
  const container = (store: string | null | undefined): store is string => typeof store === 'string' && store.startsWith(CONTAINER_PREFIX);

  const bind = (store: string, label: string): void => {
    if (containers.get(store) === label) return;
    containers.set(store, label);
    void persist();
  };

  function decide(request: ProxyRequestFact): ProxyAnswer {
    const store = request.cookieStoreId;
    const site = deps.siteAddress(request.url);
    const token = site ? request.requestHeaders?.find((header) => header.name.toLowerCase() === 'authorization')?.value : undefined;
    const tokenRow = token === undefined ? null : rowOfToken(token);
    if (tokenRow !== null) {
      // Another model's token in a model's container: the container is that model's now.
      if (container(store)) bind(store, tokenRow.pageLabel);
      return answerOf(tokenRow);
    }
    if (container(store)) {
      const row = rowOfLabel(containers.get(store));
      if (row !== null) return answerOf(row);
      // A model's container whose proxy is not known now: nothing of it without a tab leaves from the chatter's line.
      if (containers.has(store) && request.tabId === -1) return REFUSED;
    }
    // Ours, without a tab, on the site's API, while this person has proxies: the transport chose no such route, so this
    // is a race with a change of the list; refused rather than sent from the chatter's line.
    const ours = request.tabId === -1 && request.originUrl?.startsWith(deps.ownOrigin) === true && deps.siteApi(request.url);
    return ours && (!known || anyProxy) ? REFUSED : undefined;
  }

  const lineNow = (legacyId: string, canonicalId: string | null): OwnLine => {
    if (!known) return 'tab';
    if (!anyProxy) return 'direct';
    return active && (rowOfAccount(legacyId) ?? rowOfAccount(canonicalId)) !== null ? 'proxied' : 'tab';
  };

  function placePage(store: string, host: string, port: number | undefined): void {
    const expected = rowOfLabel(containers.get(store));
    if (expected === null) {
      // Only an address and port one row of the list has proves the page.
      const matching = rows.filter((row) => row.host === host && row.port === port);
      if (matching.length === 1 && matching[0] !== undefined) bind(store, matching[0].pageLabel);
      return;
    }
    if (expected.host === host) return;
    // Another add-on's filter ran after ours, with another address: ours goes to the end.
    deps.moveToLast();
    const key = `${store}|${host}`;
    if (said.has(key)) return;
    said.add(key);
    deps.log({ level: 'warn', scope: 'fansly.proxy', msg: 'a navigation went through another proxy than its page\'s: our filter moved to the end', data: { page: expected.pageLabel } });
  }

  async function placeTab(tabId: number, accounts: readonly string[]): Promise<void> {
    const row = accounts.map((account) => rowOfAccount(account)).find((found) => found !== null) ?? null;
    const store = await deps.containerOfTab(tabId).catch(() => null);
    if (!container(store)) return;
    if (row !== null) {
      bind(store, row.pageLabel);
      return;
    }
    // The container holds a model the hub has no proxy for: it is not that page's any more.
    if (containers.has(store)) {
      containers.delete(store);
      await persist();
    }
  }

  async function replay(): Promise<void> {
    const pages = [...earlyPages];
    const tabs = [...earlyTabs];
    earlyPages.clear();
    earlyTabs.clear();
    for (const [store, page] of pages) placePage(store, page.host, page.port);
    for (const [tabId, accounts] of tabs) await placeTab(tabId, accounts);
  }

  function take(list: ContainerProxyList): void {
    const fresh = list.rows.filter(usable);
    if (list.owner !== owner) {
      owner = list.owner;
      rows = fresh;
    } else {
      // A page that left the list keeps routing the container it had, through the proxy it had.
      const labels = new Set(fresh.map((row) => row.pageLabel));
      const bound = new Set(containers.values());
      rows = [...fresh, ...rows.filter((row) => !labels.has(row.pageLabel) && bound.has(row.pageLabel))];
    }
    anyProxy = list.rows.length > 0;
    known = true;
    fetchedAt = deps.now();
  }

  const service: ContainerProxy = {
    answer(request) {
      return settled ? decide(request) : ready.then(() => decide(request));
    },
    learnPage(page) {
      const store = page.cookieStoreId;
      const host = page.proxyInfo?.host;
      if (!container(store) || host === undefined) return;
      const port = page.proxyInfo?.port;
      void ready.then(() => {
        if (!known) earlyPages.set(store, { host, port });
        else placePage(store, host, port);
      });
    },
    async learnTab(tabId, accounts) {
      await ready;
      if (!known) {
        earlyTabs.set(tabId, accounts);
        return;
      }
      await placeTab(tabId, accounts);
    },
    setActive(value) {
      active = value;
    },
    async refresh(force = false) {
      await ready;
      if (!force && known && deps.now() - fetchedAt < REFRESH_EVERY_MS) return;
      refreshing ??= (async () => {
        try {
          const list = await deps.fetchRows();
          if (list === null) return;
          take(list);
          await persist();
          await replay();
        } catch {
          deps.log({ level: 'warn', scope: 'fansly.proxy', msg: 'the hub did not answer the proxies' });
        } finally {
          refreshing = null;
        }
      })();
      await refreshing;
    },
    async signedIn(next) {
      await ready;
      if (owner !== next) {
        // Another person's logins go before anything is asked, whatever the hub answers.
        owner = next;
        rows = [];
        anyProxy = false;
        known = false;
        fetchedAt = 0;
        await persist();
      }
      await service.refresh(true);
    },
    async line(legacyId, canonicalId) {
      await service.refresh(!known);
      return lineNow(legacyId, canonicalId);
    },
    lineNow,
    async needed() {
      await service.refresh(!known);
      return anyProxy && !active;
    },
  };
  return service;
}
