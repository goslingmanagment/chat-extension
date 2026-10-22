// Read-only access to ChatSpace's page memory (architecture.md §6.1): the Vue
// app on #app, its router, the Pinia stores and the Colada query cache. Every
// read is guarded — a new ChatSpace build may change any of it, and a getter
// may throw. Nothing here creates stores, calls ensure*/refresh*/fetch/
// invalidate*, or writes to a store or the cache (§6.10).

import { idOf, isId, isPlain, type Plain } from '@cg/host-kit/main/check';
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
  FRAME_DATA_BUDGET,
  LIVE_TEXT_MAX_CHARS,
  MAX_ACCOUNTS,
  ROUTE_CHAT,
  ROUTE_OVERVIEW,
  STORE_CACHE,
  STORE_CHATS,
  STORE_QUEUE,
  STORE_TABS,
  STORE_TRANSLATOR,
} from './protocol';
import { type Entry, type PageStore, type Route } from './live';
import { queueShape } from './send-port';

export type { ActionListener, Entry, PageStore, Route } from './live';

type Fn = (...args: unknown[]) => unknown;

export interface PageRouter {
  readonly currentRoute: { readonly value: { readonly name?: unknown; readonly params?: Plain } };
  readonly afterEach: (guard: (to: unknown, from: unknown, failure?: unknown) => void) => unknown;
  readonly push: (to: unknown) => Promise<unknown>;
  readonly hasRoute?: (name: string) => boolean;
}
export interface PagePinia {
  readonly _s: Map<string, PageStore>;
  readonly use: (plugin: (context: { store: PageStore }) => void) => unknown;
}

const isFn = (value: unknown): value is Fn => typeof value === 'function';
const list = (value: unknown): unknown[] => (Array.isArray(value) ? (value as unknown[]) : []);
const text = (value: unknown, max: number): string | null => (typeof value === 'string' ? value.slice(0, max) : null);
const flag = (value: unknown): boolean | null => (typeof value === 'boolean' ? value : null);
/** UTF-8 bytes of a text (a frame's limit counts the bytes of its JSON). */
export const utf8Bytes = (text: string): number => {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    bytes += code < 0x80 ? 1 : code < 0x800 || (code >= 0xd800 && code < 0xe000) ? 2 : 3;
  }
  return bytes;
};
/** Any date string → ISO 8601 UTC; null when unparseable. */
export const iso = (value: unknown): string | null => {
  const time = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isNaN(time) ? null : new Date(time).toISOString();
};
export const chatRef = (acc: string, fan: string) => ({ host: 'chatspace', hostAccountId: acc, platformFanId: fan });

let parser: DOMParser | null = null;
/** HTML of a message → plain text; nothing of it is ever attached to a live document. */
export const plain = (html: unknown): string => {
  if (typeof html !== 'string') return '';
  parser ??= new DOMParser();
  const marked = html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>\s*<p[^>]*>/gi, '\n');
  return (parser.parseFromString(marked, 'text/html').body.textContent ?? '').trim().slice(0, LIVE_TEXT_MAX_CHARS);
};

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
  /** ChatSpace's own online rule: its presence map, else the fan's lastSeen (its callers pass it too). */
  const online = (fan: string, raw: unknown): boolean | null => flag(call(STORE_CHATS, 'isFanOnline', fan, (isPlain(raw) ? raw['lastSeen'] : null) ?? null));
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

  return {
    store,
    data,
    entry,
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
        isOnline: online(fan, raw),
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
    /** The newest `max` confirmed text messages of the open chat, oldest first (D-14), within one frame's byte budget. */
    tail(acc: string, fan: string, max: number) {
      const out = [];
      let bytes = 0;
      for (const item of messages(acc, fan)?.items ?? []) {
        if (out.length >= max) break;
        const value = plain(item.html);
        if (value === '') continue;
        const message = { platformMessageId: item.id, direction: item.fromFan ? 'fan' : 'model', sentAt: item.at, text: value };
        bytes += utf8Bytes(JSON.stringify(message));
        if (bytes > FRAME_DATA_BUDGET) break;
        out.unshift(message);
      }
      return out.length === 0 ? null : { capturedAt: new Date().toISOString(), messages: out };
    },
    /**
     * Whether the page itself already forbids reading the fan's history for the read mark (`chatReadState`): the fan
     * is typing (ChatSpace's own five-second flag), or the freshest row of the fan in any chat list the page holds has
     * the fan's message last or something unread. The page's list may only forbid: it zeroes a row's count on our own
     * outgoing message, so a «nothing unread» there allows nothing — the live search decides.
     */
    chatReadVetoed(acc: string, fan: string): boolean {
      if (call(STORE_CHATS, 'isFanTyping', acc, fan) === true) return true;
      let row: Plain | null = null;
      let at = -1;
      for (const item of list(call(STORE_CACHE, 'getEntries', { key: [KEY_CHAT_LIST, acc] }))) {
        const entry = isPlain(item) ? (item as Entry) : null;
        if (entry === null || (entry.when ?? 0) <= at) continue;
        const found = rows(entry.state?.value?.data).find((chat): chat is Plain => isPlain(chat) && idOf(chat['id']) === fan);
        if (found !== undefined) [row, at] = [found, entry.when ?? 0];
      }
      if (row === null) return false;
      const unread = row['unreadMessagesCount'];
      const last = row['lastMessage'];
      return (typeof unread === 'number' && unread > 0) || (isPlain(last) && last['isOutgoing'] === false);
    },
    /** The list the person looks at: the observed `["chatList", acc, …]` entry, newest; nothing is loaded for it. */
    chatList(acc: string, limit: number) {
      let best: Entry | null = null;
      for (const item of list(call(STORE_CACHE, 'getEntries', { key: [KEY_CHAT_LIST, acc] }))) {
        const found = isPlain(item) ? (item as Entry) : null;
        if (found?.active === true && (best === null || (found.when ?? 0) > (best.when ?? 0))) best = found;
      }
      const fans = record(KEY_FANS, acc);
      const out: Plain[] = [];
      let bytes = 0;
      for (const chat of rows(best?.state?.value?.data)) {
        const fan = isPlain(chat) ? idOf(chat['id']) : null;
        if (fan === null) continue;
        if (out.length >= limit) break;
        const raw = fans?.[fan];
        const unread = (chat as Plain)['unreadMessagesCount'];
        const row = {
          chat: chatRef(acc, fan),
          position: out.length,
          displayName: name(isPlain(raw) ? raw : null),
          username: text(isPlain(raw) ? raw['username'] : null, 128),
          unreadCount: Number.isSafeInteger(unread) && (unread as number) >= 0 ? (unread as number) : null,
          isOnline: online(fan, raw),
        };
        bytes += utf8Bytes(JSON.stringify(row));
        if (bytes > FRAME_DATA_BUDGET) break;
        out.push(row);
      }
      return out;
    },
    /**
     * The chat ChatSpace renders the visible composer for: the active chat tab
     * of `acc` in `chatTabEntries` (`stateByAccountId[acc] = {entries: [{id,
     * chatId}], activeEntryId}`). Each composer's `chatId` comes from its tab,
     * and the active tab is the one shown (v-show). null — no chat in the
     * active tab (or no tabs for the account yet); undefined — not readable
     * as expected (a new build).
     */
    tabChat(acc: string): string | null | undefined {
      try {
        const byAccount = store(STORE_TABS)?.['stateByAccountId'];
        if (!isPlain(byAccount)) return undefined;
        const state = byAccount[acc];
        if (state === undefined) return null;
        if (!isPlain(state) || !Array.isArray(state['entries'])) return undefined;
        const active = (state['entries'] as unknown[]).find((entry) => isPlain(entry) && entry['id'] === state['activeEntryId']);
        if (!isPlain(active) || active['chatId'] === null || active['chatId'] === undefined) return null;
        return idOf(active['chatId']) ?? undefined;
      } catch {
        return undefined;
      }
    },
    /** The hashed name of ChatSpace's entry module, e.g. `index-0000fake` (NEW-09): diagnostics only. */
    build: (): string | null => BUILD_PATTERN.exec(doc.querySelector(BUILD_SELECTOR)?.getAttribute('src') ?? '')?.[1] ?? null,
    /**
     * Store and cache anchors of §6.2 that MAIN sees (the DOM ones are the
     * isolated side's): `missing` — not there (yet), `shape` — not as
     * expected. Per-chat anchors only for the open account and chat.
     * `composerTranslator` — ChatSpace creates that store in a chat composer's
     * setup and keeps it until the page reloads: before the document's first
     * composer it is `notYet` (`composerSeen` — one has been there), after it a
     * store that is not there is `missing`.
     */
    anchors(acc: string | null, fan: string | null, composerSeen: () => boolean): Record<string, string> {
      const state = (value: unknown, ok: boolean): string => (value === undefined ? 'missing' : ok ? 'ok' : 'shape');
      const accounts = data(KEY_ACCOUNTS);
      const queue = store(STORE_QUEUE);
      const permissions = data(KEY_PERMISSIONS);
      // One odd account (no or a numeric platformAccountId, another platform) leaves only that account unbound; the anchor is
      // broken when the list is not a list of accounts with ids, or when no OnlyFans account has a usable platformAccountId.
      const onlyfans = list(accounts).filter((item) => isPlain(item) && (item['platform'] ?? 'onlyfans') === 'onlyfans') as Plain[];
      const result: Record<string, string> = {
        accounts: state(
          accounts,
          Array.isArray(accounts) &&
            list(accounts).every((item) => isPlain(item) && idOf(item['id']) !== null) &&
            (onlyfans.length === 0 || onlyfans.some((item) => idOf(item['platformAccountId']) !== null)),
        ),
        pendingMessages: queue === undefined ? 'missing' : queueShape(queue),
        composerTranslator: store(STORE_TRANSLATOR) !== undefined ? 'ok' : composerSeen() ? 'missing' : 'notYet',
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
