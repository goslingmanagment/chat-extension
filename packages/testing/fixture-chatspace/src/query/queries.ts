// Query definitions of the stand: the same cache keys as ChatSpace
// (metadata.ts «cache-keys»), each fetched by the page's native client from
// the loopback API. A «build» with a renamed key (?stand-break=query-key:x)
// stores the data under another name.

import { keyName } from '../env';
import { api } from '../net/http';
import type { QueryCache, QueryKey, QueryOptions } from './cache';
import { mapAccount, mapChat, mapFan, mapRestMessage, type Account, type ChatList, type FansMap, type History, type MimicChat } from './model';

const HISTORY_PAGE = 10;
const PINNED_PAGE = 20;
const LIST_PAGE = 10;
const FAN_BATCH = 20;

type Raw = Record<string, unknown>;
type Items = { readonly items: Raw[] };

/** Server-side chat-list filters (the key carries them as `filter:<name>`). */
export const CHAT_LIST_FILTERS = ['unread', 'pinned', 'who_tipped', 'priority'] as const;
export type ChatListFilter = (typeof CHAT_LIST_FILTERS)[number];

/**
 * Which list the human looks at. Key: ['chatList', acc, 'all' | 'filter:<name>' | 'list:<id>',
 * optional 'search:<q>', optional 'order:old'] — the same layout as ChatSpace's.
 */
export interface ChatListView {
  readonly scope: 'all' | `filter:${ChatListFilter}` | `list:${string}`;
  readonly search: string;
  readonly order: 'recent' | 'old';
}

export const ALL_CHATS: ChatListView = { scope: 'all', search: '', order: 'recent' };
const SEARCH_PREFIX = 'search:';
const ORDER_OLD = 'order:old';
/** Index of the scope part in a chat-list key. */
const SCOPE_INDEX = 2;

export const keys = {
  accounts: (): QueryKey => [keyName('accounts')],
  userPermissions: (): QueryKey => [keyName('userPermissions')],
  mimicSettings: (): QueryKey => [keyName('mimicSettings')],
  mimicChats: (): QueryKey => [keyName('mimicChats')],
  /** The chat's history; with an anchor (`?firstId=` on the route) a separate entry ['chatMessages', acc, fan, firstId]. */
  chatMessages: (accountId: string, fanId: string, anchor?: string | null): QueryKey =>
    anchor ? [keyName('chatMessages'), accountId, fanId, anchor] : [keyName('chatMessages'), accountId, fanId],
  /** The pinned-messages dialog: ['chatMessages', acc, fan, 'pinned']. */
  pinnedMessages: (accountId: string, fanId: string): QueryKey => [keyName('chatMessages'), accountId, fanId, 'pinned'],
  chatList: (accountId: string, view: ChatListView = ALL_CHATS): QueryKey => [
    keyName('chatList'),
    accountId,
    view.scope,
    ...(view.search !== '' ? [`${SEARCH_PREFIX}${view.search}`] : []),
    ...(view.order === 'old' ? [ORDER_OLD] : []),
  ],
  fansMap: (accountId: string): QueryKey => [keyName('fansMap'), accountId],
  buyingPowers: (): QueryKey => [keyName('onlyfansBuyingPowers')],
  lastPayments: (accountId: string): QueryKey => [keyName('onlyfansLastPayments'), accountId],
  fanInsights: (accountId: string): QueryKey => [keyName('fanInsights'), accountId],
};

/** The view a chat-list key stands for (null for another key). */
export function chatListViewOf(key: QueryKey): ChatListView | null {
  const scope = key[SCOPE_INDEX];
  if (key[0] !== keyName('chatList') || scope === undefined) return null;
  const rest = key.slice(SCOPE_INDEX + 1);
  const search = rest.find((part) => part.startsWith(SEARCH_PREFIX))?.slice(SEARCH_PREFIX.length) ?? '';
  return { scope: scope as ChatListView['scope'], search, order: rest.includes(ORDER_OLD) ? 'old' : 'recent' };
}

/** A search or old-first list: ChatSpace patches its rows in place (while active) instead of reordering it. */
export const isSearchOrOldFirst = (key: QueryKey): boolean => {
  const view = chatListViewOf(key);
  return view !== null && (view.search !== '' || view.order === 'old');
};

export const isAllChatsScope = (key: QueryKey): boolean => key[SCOPE_INDEX] === 'all';

export function accountsQuery(): QueryOptions<Account[]> {
  return {
    key: keys.accounts(),
    staleTime: 60_000,
    query: async ({ signal }) => (await api.get('api/v0/accounts', { signal }).json<Items>()).items.map(mapAccount),
  };
}

export function permissionsQuery(): QueryOptions<string[]> {
  return {
    key: keys.userPermissions(),
    staleTime: 300_000,
    query: async ({ signal }) => {
      const body = await api.get('api/user/permissions', { signal }).json<{ data?: unknown }>();
      return Array.isArray(body.data) ? body.data.filter((item): item is string => typeof item === 'string') : [];
    },
  };
}

export function mimicSettingsQuery(): QueryOptions<{ isActive: boolean }> {
  return {
    key: keys.mimicSettings(),
    staleTime: 60_000,
    query: async ({ signal }) => ({ isActive: (await api.get('api/v0/copilot/settings', { signal }).json<{ is_active?: unknown }>()).is_active === true }),
  };
}

export function mimicChatsQuery(): QueryOptions<Record<string, MimicChat>> {
  return {
    key: keys.mimicChats(),
    staleTime: 60_000,
    query: async ({ signal }) => {
      const body = await api.get('api/v0/copilot/chats', { signal, searchParams: new URLSearchParams([['status', 'enabled'], ['status', 'escalated']]) }).json<{ chats?: Raw[] }>();
      const result: Record<string, MimicChat> = {};
      for (const chat of body.chats ?? []) {
        if (chat['status'] === 'disabled') continue;
        const accountId = String(chat['account_id']);
        const fanId = String(chat['fan_id']);
        result[`${accountId}:${fanId}`] = { accountId, fanId, status: String(chat['status']) };
      }
      return result;
    },
  };
}

type HistoryParams = Record<string, string>;

async function fetchHistoryPage(accountId: string, fanId: string, cache: QueryCache, params: HistoryParams, signal?: AbortSignal): Promise<History['pages'][number]> {
  const account = cache.getQueryData<Account[]>(keys.accounts())?.find((item) => String(item.id) === accountId);
  const body = await api
    .get(`api/v0/accounts/${accountId}/chats/${fanId}/messages`, { ...(signal ? { signal } : {}), searchParams: new URLSearchParams(params) })
    .json<Items & { has_more?: unknown }>();
  const items = body.items.map((raw) => mapRestMessage(raw, 'onlyfans', { fanId, platformAccountId: account?.platformAccountId ?? '' }));
  return { items, hasMore: body.has_more === true, cursor: items.at(-1)?.id ?? null };
}

/** The open chat's history (or, with an anchor, the history around that message). */
export function chatMessagesQuery(accountId: string, fanId: string, cache: QueryCache, anchor: string | null = null): QueryOptions<History> {
  return {
    key: keys.chatMessages(accountId, fanId, anchor),
    staleTime: 60_000,
    gcTime: 600_000,
    refetchOnWindowFocus: false,
    query: async ({ signal }) => {
      const page = await fetchHistoryPage(accountId, fanId, cache, { limit: String(HISTORY_PAGE), ...(anchor !== null ? { first_id: anchor } : {}) }, signal);
      return { pages: [page], pageParams: [null] };
    },
  };
}

/** Pinned messages of the open chat (only while its dialog is open). */
export function pinnedMessagesQuery(accountId: string, fanId: string, cache: QueryCache): QueryOptions<History> {
  return {
    key: keys.pinnedMessages(accountId, fanId),
    staleTime: 60_000,
    gcTime: 600_000,
    refetchOnWindowFocus: false,
    query: async ({ signal }) => {
      const page = await fetchHistoryPage(accountId, fanId, cache, { filter: 'pinned', limit: String(PINNED_PAGE) }, signal);
      return { pages: [page], pageParams: [null] };
    },
  };
}

/** Loads one older history page into the cache (scrolling up in the open chat). */
export async function loadOlderHistory(cache: QueryCache, accountId: string, fanId: string, anchor: string | null = null): Promise<void> {
  const key = keys.chatMessages(accountId, fanId, anchor);
  const history = cache.getQueryData<History>(key);
  const last = history?.pages.at(-1);
  if (history === undefined || last === undefined || !last.hasMore || last.cursor === null) return;
  const page = await fetchHistoryPage(accountId, fanId, cache, { limit: String(HISTORY_PAGE), cursor: last.cursor });
  cache.setQueryData<History>(key, (previous) => ({
    pages: [...(previous?.pages ?? []), page],
    pageParams: [...(previous?.pageParams ?? []), last.cursor],
  }));
}

function listParams(view: ChatListView, offset: number): URLSearchParams {
  const params = new URLSearchParams({ limit: String(LIST_PAGE), offset: String(offset) });
  if (view.scope.startsWith('filter:')) params.set('filter', view.scope.slice('filter:'.length));
  if (view.scope.startsWith('list:')) params.set('list_id', view.scope.slice('list:'.length));
  if (view.search !== '') params.set('query', view.search);
  if (view.order === 'old') params.set('order', 'old');
  return params;
}

async function fetchListPage(accountId: string, view: ChatListView, offset: number, platformAccountId: string, signal?: AbortSignal): Promise<ChatList['pages'][number]> {
  const body = await api
    .get(`api/v0/accounts/${accountId}/chats`, { ...(signal ? { signal } : {}), searchParams: listParams(view, offset) })
    .json<Items & { has_more?: unknown; next_offset?: unknown }>();
  return {
    items: body.items.map((raw) => mapChat(raw, accountId, platformAccountId)),
    hasMore: body.has_more === true,
    nextOffset: typeof body.next_offset === 'number' ? body.next_offset : offset + body.items.length,
  };
}

export function chatListQuery(accountId: string, cache: QueryCache, view: ChatListView = ALL_CHATS): QueryOptions<ChatList> {
  const key = keys.chatList(accountId, view);
  return {
    key,
    staleTime: 60_000,
    gcTime: 600_000,
    query: async ({ signal }) => {
      const account = cache.getQueryData<Account[]>(keys.accounts())?.find((item) => String(item.id) === accountId);
      // An infinite query refetches every page it had loaded, in order.
      const loaded = Math.max(1, cache.getQueryData<ChatList>(key)?.pages.length ?? 1);
      const pages: ChatList['pages'][number][] = [];
      let offset = 0;
      for (let index = 0; index < loaded; index += 1) {
        const page = await fetchListPage(accountId, view, offset, account?.platformAccountId ?? '', signal);
        pages.push(page);
        offset = page.nextOffset;
        if (!page.hasMore) break;
      }
      return { pages, pageParams: pages.map((_, index) => index * LIST_PAGE) };
    },
  };
}

export async function loadNextListPage(cache: QueryCache, accountId: string, view: ChatListView = ALL_CHATS): Promise<void> {
  const key = keys.chatList(accountId, view);
  const list = cache.getQueryData<ChatList>(key);
  const last = list?.pages.at(-1);
  if (list === undefined || last === undefined || !last.hasMore) return;
  const account = cache.getQueryData<Account[]>(keys.accounts())?.find((item) => String(item.id) === accountId);
  const page = await fetchListPage(accountId, view, last.nextOffset, account?.platformAccountId ?? '');
  cache.setQueryData<ChatList>(key, (previous) => ({ pages: [...(previous?.pages ?? []), page], pageParams: [...(previous?.pageParams ?? []), last.nextOffset] }));
}

/** Ids already asked for (per cache kind and account): a second ensure while the first is in flight asks nothing. */
const requested = new Map<string, Set<string>>();
function claim(scope: string, ids: readonly string[], known: Readonly<Record<string, unknown>>): string[] {
  const asked = requested.get(scope) ?? new Set<string>();
  requested.set(scope, asked);
  const fresh = [...new Set(ids)].filter((id) => !(id in known) && !asked.has(id));
  for (const id of fresh) asked.add(id);
  return fresh;
}

/** Fetches fans the cache does not have yet, in batches of 20, and merges them into ["fansMap", acc]. */
export async function ensureFans(cache: QueryCache, accountId: string, fanIds: readonly string[]): Promise<void> {
  const key = keys.fansMap(accountId);
  const missing = claim(`fans:${accountId}`, fanIds, cache.getQueryData<FansMap>(key) ?? {});
  for (let start = 0; start < missing.length; start += FAN_BATCH) {
    const batch = missing.slice(start, start + FAN_BATCH);
    const body = await api.get(`api/v0/accounts/${accountId}/platforms/onlyfans/fans`, { searchParams: new URLSearchParams(batch.map((id) => ['fan_ids', id])) }).json<Items>();
    const merged: Record<string, ReturnType<typeof mapFan> | null> = {};
    for (const raw of body.items) {
      const fan = mapFan(raw);
      merged[fan.id] = fan;
    }
    for (const id of batch) if (!(id in merged)) merged[id] = null;
    cache.setQueryData<FansMap>(key, (previous) => ({ ...previous, ...merged }));
  }
}

/** Buying power (0..5) and last payment date of the given fans, merged into their caches. */
export async function ensureFanStats(cache: QueryCache, accountId: string, fanIds: readonly string[], canViewBuyingPower: boolean): Promise<void> {
  if (fanIds.length === 0) return;
  if (canViewBuyingPower) {
    const missing = claim('buying-power', fanIds, cache.getQueryData<Record<string, number | null>>(keys.buyingPowers()) ?? {});
    if (missing.length > 0) {
      const body = await api.get('api/stats/platforms/onlyfans/buying_power', { searchParams: new URLSearchParams(missing.map((id) => ['fan_ids', id])) }).json<Items>();
      const merged: Record<string, number | null> = Object.fromEntries(missing.map((id) => [id, null]));
      for (const item of body.items) merged[String(item['id'])] = Number(item['buying_power']);
      cache.setQueryData<Record<string, number | null>>(keys.buyingPowers(), (previous) => ({ ...previous, ...merged }));
    }
  }
  const paymentsKey = keys.lastPayments(accountId);
  const missingPayments = claim(`payments:${accountId}`, fanIds, cache.getQueryData<Record<string, string | null>>(paymentsKey) ?? {});
  if (missingPayments.length > 0) {
    const body = await api
      .get(`api/stats/accounts/${accountId}/fans/transactions/latest`, { searchParams: new URLSearchParams(missingPayments.map((id) => ['fanIds', id])) })
      .json<Record<string, string>>();
    const merged: Record<string, string | null> = Object.fromEntries(missingPayments.map((id) => [id, body[id] ?? null]));
    cache.setQueryData<Record<string, string | null>>(paymentsKey, (previous) => ({ ...previous, ...merged }));
  }
}

/** Insights of the open chat's fan, merged into ["fanInsights", acc]. */
export async function ensureInsights(cache: QueryCache, accountId: string, fanId: string): Promise<void> {
  const key = keys.fanInsights(accountId);
  if (claim(`insights:${accountId}`, [fanId], cache.getQueryData<Record<string, unknown>>(key) ?? {}).length === 0) return;
  const body = await api.get(`api/v0/accounts/${accountId}/fans/${fanId}/insights`).json<Raw>();
  cache.setQueryData<Record<string, unknown>>(key, (previous) => ({
    ...previous,
    [fanId]: { temperature: body['temperature'], reach: body['reach'], focus: body['focus'], generatedAt: body['generated_at'] },
  }));
}

/** The app's options for a key, so a test-held observer refetches like the app would. */
export function optionsForKey(key: QueryKey, cache: QueryCache): QueryOptions<unknown> | null {
  const [name, accountId, third, fourth] = key;
  if (name === keyName('chatMessages') && accountId !== undefined && third !== undefined) {
    if (fourth === 'pinned') return pinnedMessagesQuery(accountId, third, cache);
    return chatMessagesQuery(accountId, third, cache, fourth ?? null);
  }
  const view = chatListViewOf(key);
  if (view !== null && accountId !== undefined) return chatListQuery(accountId, cache, view);
  return null;
}
