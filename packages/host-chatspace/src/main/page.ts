// Read-only access to ChatSpace's page memory (architecture.md §6.1): the Vue
// app on #app, its router, the Pinia stores and the Colada query cache. Every
// read is guarded — a new ChatSpace build may change any of it, and a getter
// may throw. Nothing here creates stores, calls ensure*/refresh*/fetch/
// invalidate*, or writes to a store or the cache (§6.10).

import { isId, isPlain, type Plain } from './check';
import {
  APP_SELECTOR,
  BUILD_PATTERN,
  BUILD_SELECTOR,
  KEY_ACCOUNTS,
  KEY_BUYING_POWERS,
  KEY_CHAT_LIST,
  KEY_FANS,
  KEY_INSIGHTS,
  KEY_MESSAGES,
  KEY_MIMIC_CHATS,
  KEY_MIMIC_SETTINGS,
  KEY_PERMISSIONS,
  LIVE_TEXT_MAX_CHARS,
  MAX_ACCOUNTS,
  ROUTE_CHAT,
  ROUTE_OVERVIEW,
  STORE_CACHE,
  STORE_CHATS,
  STORE_QUEUE,
  STORE_TRANSLATOR,
} from './protocol';
import { queueShape } from './send-port';

type Fn = (...args: unknown[]) => unknown;
// Page objects are described with function-valued properties: they are
// ChatSpace's, and we only ever call them on their own object.
export type ActionListener = (context: { name: string; args: unknown[]; after: (cb: () => void) => void }) => void;

export interface PageRouter {
  readonly currentRoute: { readonly value: { readonly name?: unknown; readonly params?: Plain } };
  readonly afterEach: (guard: (to: unknown, from: unknown, failure?: unknown) => void) => unknown;
  readonly push: (to: unknown) => Promise<unknown>;
  readonly hasRoute?: (name: string) => boolean;
}
export interface PageStore {
  readonly $id: string;
  readonly $onAction: (listener: ActionListener, detached?: boolean) => unknown;
  readonly [member: string]: unknown;
}
export interface PagePinia {
  readonly _s: Map<string, PageStore>;
  readonly use: (plugin: (context: { store: PageStore }) => void) => unknown;
}
interface Entry {
  readonly state?: { readonly value?: { readonly data?: unknown } };
  readonly asyncStatus?: { readonly value?: unknown };
  readonly active?: boolean;
  readonly when?: number;
}

const isFn = (value: unknown): value is Fn => typeof value === 'function';
const list = (value: unknown): unknown[] => (Array.isArray(value) ? (value as unknown[]) : []);
const text = (value: unknown, max: number): string | null => (typeof value === 'string' ? value.slice(0, max) : null);
const flag = (value: unknown): boolean | null => (typeof value === 'boolean' ? value : null);
/** Numeric ids of the host may come as numbers (the account's `id`); the wire wants the string form. */
const idOf = (value: unknown): string | null => {
  const id = typeof value === 'number' ? String(value) : value;
  return isId(id) ? id : null;
};
/** Any date string → ISO 8601 UTC; null when unparseable. */
export const iso = (value: unknown): string | null => {
  const time = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isNaN(time) ? null : new Date(time).toISOString();
};
export const chatRef = (acc: string, fan: string) => ({ host: 'chatspace', hostAccountId: acc, platformFanId: fan });

export interface App {
  readonly app: object;
  readonly router: PageRouter | null;
  readonly pinia: PagePinia | null;
}

/** `#app.__vue_app__` with its router and Pinia; null while ChatSpace has not mounted. */
export function findApp(doc: Document): App | null {
  try {
    const app = doc.querySelector<Element & { __vue_app__?: { config?: { globalProperties?: Plain } } }>(APP_SELECTOR)?.__vue_app__;
    const props = app?.config?.globalProperties;
    if (!app || !props) return null;
    const router = props['$router'] as PageRouter | undefined;
    const pinia = props['$pinia'] as PagePinia | undefined;
    return {
      app,
      router: router?.currentRoute && isFn(router.afterEach) && isFn(router.push) ? router : null,
      pinia: pinia && pinia._s instanceof Map && isFn(pinia.use) ? pinia : null,
    };
  } catch {
    return null;
  }
}

export interface Route {
  readonly name: 'chat' | 'accounts-overview' | 'other';
  readonly acc: string | null;
  /** The open chat's fan; only on the `chat` route. */
  readonly fan: string | null;
}

export function readRoute(router: PageRouter | null): Route {
  try {
    const route = router?.currentRoute.value;
    const name = route?.name === ROUTE_CHAT ? 'chat' : route?.name === ROUTE_OVERVIEW ? 'accounts-overview' : 'other';
    const acc = route?.params?.['accountId'];
    const fan = route?.params?.['chatId'];
    return { name, acc: isId(acc) ? acc : null, fan: name === 'chat' && isId(fan) ? fan : null };
  } catch {
    return { name: 'other', acc: null, fan: null };
  }
}

/** True when the router knows a route named `chat` (§6.2 router anchor). */
export function hasChatRoute(router: PageRouter): boolean {
  try {
    return router.hasRoute?.(ROUTE_CHAT) === true;
  } catch {
    return false;
  }
}

interface Message {
  readonly id: string;
  readonly fromFan: boolean;
  readonly at: string;
  readonly html: unknown;
}

export type Reader = ReturnType<typeof createReader>;

/** Everything the bridge reads from the stores and the cache of one Pinia. */
export function createReader(doc: Document, pinia: PagePinia | null) {
  const store = (id: string): PageStore | undefined => {
    try {
      return pinia?._s.get(id);
    } catch {
      return undefined;
    }
  };
  const call = (storeId: string, method: string, ...args: unknown[]): unknown => {
    try {
      const member = store(storeId)?.[method];
      return isFn(member) ? member(...args) : undefined;
    } catch {
      return undefined;
    }
  };
  /** `getQueryData(key)` of the Colada cache: a read, no fetch. */
  const data = (...key: string[]): unknown => call(STORE_CACHE, 'getQueryData', key);
  const record = (...key: string[]): Plain | null => {
    const value = data(...key);
    return isPlain(value) ? value : null;
  };
  /** The cache entry itself (`get(key)`), never created. */
  const entry = (...key: string[]): Entry | null => {
    const value = call(STORE_CACHE, 'get', key);
    return isPlain(value) ? value : null;
  };
  const rows = (value: unknown): unknown[] => list(isPlain(value) ? value['pages'] : null).flatMap((page) => list(isPlain(page) ? page['items'] : null));
  const rawFan = (acc: string, fan: string): Plain | null => {
    const raw = record(KEY_FANS, acc)?.[fan];
    return isPlain(raw) ? raw : null;
  };
  const online = (fan: string): boolean | null => flag(call(STORE_CHATS, 'isFanOnline', fan));
  const name = (raw: Plain | null): string | null => text(raw?.['customName'] ?? raw?.['name'], 256);

  /** Messages of a chat's cache, newest first: only confirmed ones — a numeric id, not from the queue (D-14). */
  const messages = (acc: string, fan: string) => {
    const found = entry(KEY_MESSAGES, acc, fan);
    const value = found?.state?.value?.data ?? data(KEY_MESSAGES, acc, fan);
    if (found === null && value === undefined) return null;
    const items: Message[] = [];
    for (const item of rows(value)) {
      const at = isPlain(item) ? iso(item['createdAt']) : null;
      const meta = isPlain(item) ? item['platformMetadata'] : null;
      if (at === null || !isId((item as Plain)['id']) || typeof (item as Plain)['isOutgoing'] !== 'boolean' || (isPlain(meta) && meta['isFromQueue'] === true)) continue;
      items.push({ id: (item as Plain)['id'] as string, fromFan: (item as Plain)['isOutgoing'] === false, at, html: (item as Plain)['text'] });
    }
    items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    const last = list(isPlain(value) ? value['pages'] : null).at(-1);
    return { items, loading: value === undefined || found?.asyncStatus?.value === 'loading', hasOlder: isPlain(last) ? flag(last['hasMore']) : null };
  };

  let parser: DOMParser | null = null;
  /** HTML of a message → plain text; nothing of it is ever attached to a live document. */
  const plain = (html: unknown): string => {
    if (typeof html !== 'string') return '';
    parser ??= new DOMParser();
    const marked = html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>\s*<p[^>]*>/gi, '\n');
    return (parser.parseFromString(marked, 'text/html').body.textContent ?? '').trim().slice(0, LIVE_TEXT_MAX_CHARS);
  };

  return {
    store,
    rawFan,
    accounts() {
      const accounts = [];
      for (const item of list(data(KEY_ACCOUNTS))) {
        const id = isPlain(item) ? idOf(item['id']) : null;
        if (id === null || accounts.length >= MAX_ACCOUNTS || ((item as Plain)['platform'] ?? 'onlyfans') !== 'onlyfans') continue;
        const raw = item as Plain;
        accounts.push({
          host: 'chatspace',
          hostAccountId: id,
          platform: 'onlyfans',
          platformAccountId: idOf(raw['platformAccountId']),
          username: text(raw['username'], 128),
          displayName: text(raw['customLabel'] ?? raw['name'], 256),
        });
      }
      return accounts;
    },
    fan(acc: string, fan: string) {
      const raw = rawFan(acc, fan);
      if (raw === null) return null;
      const power = record(KEY_BUYING_POWERS)?.[fan];
      const insights = record(KEY_INSIGHTS, acc)?.[fan];
      return {
        chat: chatRef(acc, fan),
        username: text(raw['username'], 128),
        displayName: name(raw),
        isBlocked: flag(raw['isBlocked']),
        canReceiveMessages: flag(raw['canReceiveMessages']),
        isRestricted: flag(raw['isRestricted']),
        isOnline: online(fan),
        lastSeenAt: iso(raw['lastSeen']),
        buyingPowerLabel: typeof power === 'number' || typeof power === 'string' ? String(power).slice(0, 64) : null,
        insights: isPlain(insights)
          ? Object.entries(insights)
              .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value))
              .slice(0, 16)
              .map(([label, value]) => ({ label: label.slice(0, 64), value: String(value).slice(0, 64) }))
          : null,
        bio: text(raw['about'], 2000),
        lists: null,
      };
    },
    chatWindow(acc: string, fan: string, max: number) {
      const read = messages(acc, fan);
      if (read === null) return null;
      const items = read.items.slice(0, max);
      const fans = items.filter((item) => item.fromFan);
      return {
        chat: chatRef(acc, fan),
        state: read.loading && items.length === 0 ? 'loading' : 'ready',
        loaded: items.length,
        fanMessages: fans.length,
        modelMessages: items.length - fans.length,
        lastFanMessageId: fans[0]?.id ?? null,
        lastFanMessageAt: fans[0]?.at ?? null,
        lastModelMessageAt: items.find((item) => !item.fromFan)?.at ?? null,
        hasOlder: read.hasOlder,
      };
    },
    /** The newest `max` confirmed text messages of the open chat, oldest first (D-14). */
    tail(acc: string, fan: string, max: number) {
      const out = [];
      for (const item of messages(acc, fan)?.items ?? []) {
        if (out.length >= max) break;
        const value = plain(item.html);
        if (value !== '') out.unshift({ platformMessageId: item.id, direction: item.fromFan ? 'fan' : 'model', sentAt: item.at, text: value });
      }
      return out.length === 0 ? null : { capturedAt: new Date().toISOString(), messages: out };
    },
    /** The list the person looks at: the observed `["chatList", acc, …]` entry, newest; nothing is loaded for it. */
    chatList(acc: string, limit: number) {
      let best: Entry | null = null;
      for (const item of list(call(STORE_CACHE, 'getEntries', { key: [KEY_CHAT_LIST, acc] }))) {
        const found = isPlain(item) ? (item as Entry) : null;
        if (found?.active === true && (best === null || (found.when ?? 0) > (best.when ?? 0))) best = found;
      }
      const fans = record(KEY_FANS, acc);
      const out = [];
      for (const chat of rows(best?.state?.value?.data)) {
        const fan = isPlain(chat) ? idOf(chat['id']) : null;
        if (fan === null || out.length >= limit) continue;
        const raw = fans?.[fan];
        const unread = (chat as Plain)['unreadMessagesCount'];
        out.push({
          chat: chatRef(acc, fan),
          position: out.length,
          displayName: name(isPlain(raw) ? raw : null),
          username: text(isPlain(raw) ? raw['username'] : null, 128),
          unreadCount: Number.isSafeInteger(unread) && (unread as number) >= 0 ? (unread as number) : null,
          isOnline: online(fan),
        });
      }
      return out;
    },
    /** The hashed name of ChatSpace's entry module, e.g. `index-DEVowLko` (NEW-09): diagnostics only. */
    build: (): string | null => BUILD_PATTERN.exec(doc.querySelector(BUILD_SELECTOR)?.getAttribute('src') ?? '')?.[1] ?? null,
    /**
     * Store and cache anchors of §6.2 that MAIN sees (the DOM ones are the
     * isolated side's): `missing` — not there (yet), `shape` — not as
     * expected. Per-chat anchors only for the open account and chat.
     */
    anchors(acc: string | null, fan: string | null): Record<string, string> {
      const state = (value: unknown, ok: boolean): string => (value === undefined ? 'missing' : ok ? 'ok' : 'shape');
      const accounts = data(KEY_ACCOUNTS);
      const queue = store(STORE_QUEUE);
      const permissions = data(KEY_PERMISSIONS);
      const result: Record<string, string> = {
        accounts: state(accounts, Array.isArray(accounts) && list(accounts).every((item) => isPlain(item) && idOf(item['id']) !== null && isId(item['platformAccountId']))),
        pendingMessages: queue === undefined ? 'missing' : queueShape(queue),
        composerTranslator: state(store(STORE_TRANSLATOR), true),
        mimic: state(data(KEY_MIMIC_SETTINGS) === undefined ? undefined : data(KEY_MIMIC_CHATS), true),
        userPermissions: state(permissions, Array.isArray(permissions)),
      };
      if (acc !== null) {
        const fans = data(KEY_FANS, acc);
        result['fansMap'] = state(fans, isPlain(fans));
        result['chatList'] = list(call(STORE_CACHE, 'getEntries', { key: [KEY_CHAT_LIST, acc] })).length > 0 ? 'ok' : 'missing';
      }
      if (acc !== null && fan !== null) {
        const found = entry(KEY_MESSAGES, acc, fan);
        const value = found?.state?.value?.data;
        result['chatMessages'] = found === null ? 'missing' : value === undefined || (isPlain(value) && Array.isArray(value['pages'])) ? 'ok' : 'shape';
      }
      return result;
    },
  };
}
