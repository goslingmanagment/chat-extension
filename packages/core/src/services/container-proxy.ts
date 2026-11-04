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
//   The hub is the truth: the same address its own Fansly traffic of the page leaves through.
// - Which page a container is: the account its Fansly tab reports (`learnTab`, the proof, it overrides); before that, on
//   the very first navigation of a container, the address the tab's own request went through (`learnPage`), so a
//   worker's first requests are already routed. Kept in storage.local, so a browser restart starts routed.
// - A request of no container (this background's own `fetch`, another add-on's popup) goes by the account its
//   `authorization` names, on Fansly's addresses only. This background on Fansly's API with no such proxy never leaves
//   from the chatter's line: it gets a proxy that refuses (the proxy API cannot cancel). A relay frame has a tab, and
//   its container answers for it.
// - A known proxy has no way around it: a list ending in null fails rather than falling back to Firefox's direct route
//   (measured on Firefox 159: a dead proxy, nothing reached the server).
// - Another add-on's different proxy for the same container wins if its filter runs after ours (last wins, measured). A
//   navigation that went through another address moves our filter to the end, and says so in the log once.
// - Nothing here ever logs a row or a token: no address, no login. A container of no known page is left alone.

import type { KeyValuePort } from './storage/ports';

const STORE_KEY = 'fansly.containerProxy';
/** A refresh the bootstrap asks for: at most this often (a proxy changes rarely; a new list arrives with the next). */
const REFRESH_EVERY_MS = 10 * 60 * 1000;
const CONTAINER_PREFIX = 'firefox-container-';

export interface ContainerProxyRow {
  readonly pageLabel: string;
  readonly platformAccountId: string | null;
  readonly scheme: string;
  readonly host: string;
  readonly port: number;
  readonly username: string | null;
  readonly password: string | null;
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

export interface ProxyInfoAnswer {
  readonly type: 'socks';
  readonly host: string;
  readonly port: number;
  readonly proxyDNS: true;
  readonly username?: string;
  readonly password?: string;
}

/** A list for Firefox's filter; undefined — no opinion: what the filters before ours chose stands. */
export type ProxyAnswer = readonly (ProxyInfoAnswer | null)[] | undefined;

/**
 * Where this background's own request to Fansly may leave: `proxied` — straight, the router carries it; `tab` — only
 * through the relay frame of the model's tab; `direct` — the person has no proxy at all, as before the router.
 */
export type OwnLine = 'proxied' | 'tab' | 'direct';

export interface ContainerProxyDeps {
  readonly storage: Pick<KeyValuePort, 'get' | 'set'>;
  /** Asked with the hub's sign-in; null — no sign-in now. Rejects when the hub did not answer. */
  readonly fetchRows: () => Promise<readonly ContainerProxyRow[] | null>;
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
  /** A sign-out: the logins go; which page a container is stays. */
  forget(): Promise<void>;
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

const usable = (row: ContainerProxyRow): boolean => row.scheme === 'socks5' && row.host.length > 0;

/** Nothing listens there: the request fails at once, and the list's null keeps Firefox from going direct instead. */
const REFUSED: ProxyAnswer = [{ type: 'socks', host: '127.0.0.1', port: 1, proxyDNS: true }, null];

const answerOf = (row: ContainerProxyRow): ProxyAnswer => [{
  type: 'socks',
  host: row.host,
  port: row.port,
  proxyDNS: true,
  ...(row.username === null ? {} : { username: row.username }),
  ...(row.password === null ? {} : { password: row.password }),
}, null];

export function createContainerProxy(deps: ContainerProxyDeps): ContainerProxy {
  let rows: readonly ContainerProxyRow[] = [];
  /** The hub's list was read at least once for this sign-in. */
  let known = false;
  let fetchedAt = 0;
  let active = false;
  let settled = false;
  const containers = new Map<string, string>();
  const said = new Set<string>();
  let refreshing: Promise<void> | null = null;

  const persist = async (): Promise<void> => {
    await deps.storage.set({ [STORE_KEY]: { v: 1, rows, known, fetchedAt, containers: Object.fromEntries(containers) } });
  };

  const ready: Promise<void> = (async () => {
    const kept = await deps.storage.get([STORE_KEY]).catch(() => null);
    const value = kept?.ok === true ? (kept.value[STORE_KEY] as Record<string, unknown> | undefined) : undefined;
    if (value !== undefined && value !== null && value['v'] === 1) {
      rows = Array.isArray(value['rows']) ? value['rows'].filter(validRow).filter(usable) : [];
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

  const rowOfContainer = (store: string): ContainerProxyRow | null => {
    const label = containers.get(store);
    return label === undefined ? null : rows.find((row) => row.pageLabel === label) ?? null;
  };
  const rowOfAccount = (id: string | null): ContainerProxyRow | null => (id === null ? null : rows.find((row) => row.platformAccountId === id) ?? null);
  const rowOfToken = (token: string): ContainerProxyRow | null => {
    const legacy = deps.accountOfToken(token);
    return legacy === null ? null : rowOfAccount(legacy) ?? rowOfAccount(deps.canonicalOf(legacy));
  };

  function decide(request: ProxyRequestFact): ProxyAnswer {
    const store = request.cookieStoreId;
    if (store !== undefined && store.startsWith(CONTAINER_PREFIX)) {
      const row = rowOfContainer(store);
      if (row !== null) return answerOf(row);
    }
    if (!deps.siteAddress(request.url)) return undefined;
    const token = request.requestHeaders?.find((header) => header.name.toLowerCase() === 'authorization')?.value;
    if (token !== undefined) {
      const row = rowOfToken(token);
      if (row !== null) return answerOf(row);
    }
    // Ours, without a tab, on Fansly's API, while this person has proxies: the transport chose no such route, so this is
    // a race with a change of the list; refused rather than sent from the chatter's line.
    const ours = request.tabId === -1 && request.originUrl?.startsWith(deps.ownOrigin) === true && deps.siteApi(request.url);
    return ours && (!known || rows.length > 0) ? REFUSED : undefined;
  }

  const lineNow = (legacyId: string, canonicalId: string | null): OwnLine => {
    if (!known) return 'tab';
    if (rows.length === 0) return 'direct';
    return active && (rowOfAccount(legacyId) ?? rowOfAccount(canonicalId)) !== null ? 'proxied' : 'tab';
  };

  const service: ContainerProxy = {
    answer(request) {
      return settled ? decide(request) : ready.then(() => decide(request));
    },
    learnPage(page) {
      const store = page.cookieStoreId;
      const host = page.proxyInfo?.host;
      if (store === undefined || !store.startsWith(CONTAINER_PREFIX) || host === undefined) return;
      void ready.then(() => {
        const expected = rowOfContainer(store);
        if (expected === null) {
          const row = rows.find((candidate) => candidate.host === host);
          if (row === undefined) return;
          containers.set(store, row.pageLabel);
          void persist();
          return;
        }
        if (expected.host === host) return;
        // Another add-on's filter ran after ours, with another address: ours goes to the end.
        deps.moveToLast();
        const key = `${store}|${host}`;
        if (said.has(key)) return;
        said.add(key);
        deps.log({ level: 'warn', scope: 'fansly.proxy', msg: 'a navigation went through another proxy than its page\'s: our filter moved to the end', data: { page: expected.pageLabel } });
      });
    },
    async learnTab(tabId, accounts) {
      await ready;
      const row = accounts.map((account) => rowOfAccount(account)).find((found) => found !== null);
      if (row === undefined || row === null) return;
      const store = await deps.containerOfTab(tabId).catch(() => null);
      if (store === null || !store.startsWith(CONTAINER_PREFIX) || containers.get(store) === row.pageLabel) return;
      containers.set(store, row.pageLabel);
      await persist();
    },
    setActive(value) {
      active = value;
    },
    async refresh(force = false) {
      await ready;
      if (!force && known && deps.now() - fetchedAt < REFRESH_EVERY_MS) return;
      refreshing ??= (async () => {
        try {
          const fetched = await deps.fetchRows();
          if (fetched === null) return;
          rows = fetched.filter(usable);
          known = true;
          fetchedAt = deps.now();
          await persist();
        } catch {
          deps.log({ level: 'warn', scope: 'fansly.proxy', msg: 'the hub did not answer the proxies' });
        } finally {
          refreshing = null;
        }
      })();
      await refreshing;
    },
    async forget() {
      await ready;
      rows = [];
      known = false;
      fetchedAt = 0;
      await persist();
    },
    async line(legacyId, canonicalId) {
      await service.refresh(!known);
      return lineNow(legacyId, canonicalId);
    },
    lineNow,
    async needed() {
      await service.refresh(!known);
      return rows.length > 0 && !active;
    },
  };
  return service;
}
