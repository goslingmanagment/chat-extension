// Query definitions of the stand: the same cache keys as ChatSpace
// (metadata.ts «cache-keys»), each fetched by the page's native client from
// the loopback API. A «build» with a renamed key (?stand-break=query-key:x)
// stores the data under another name.

import { keyName } from '../env';
import { api } from '../net/http';
import type { QueryCache, QueryKey, QueryOptions } from './cache';
import { mapAccount, mapChat, mapFan, mapRestMessage, type Account, type ChatList, type FansMap, type History, type MimicChat } from './model';

const HISTORY_PAGE = 10;
const LIST_PAGE = 10;
const FAN_BATCH = 20;

type Raw = Record<string, unknown>;
type Items = { readonly items: Raw[] };

export const keys = {
  accounts: (): QueryKey => [keyName('accounts')],
  userPermissions: (): QueryKey => [keyName('userPermissions')],
  mimicSettings: (): QueryKey => [keyName('mimicSettings')],
  mimicChats: (): QueryKey => [keyName('mimicChats')],
  chatMessages: (accountId: string, fanId: string): QueryKey => [keyName('chatMessages'), accountId, fanId],
  chatList: (accountId: string, filter = 'all'): QueryKey => [keyName('chatList'), accountId, filter],
  fansMap: (accountId: string): QueryKey => [keyName('fansMap'), accountId],
  buyingPowers: (): QueryKey => [keyName('onlyfansBuyingPowers')],
  lastPayments: (accountId: string): QueryKey => [keyName('onlyfansLastPayments'), accountId],
  fanInsights: (accountId: string): QueryKey => [keyName('fanInsights'), accountId],
};

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

export function chatMessagesQuery(accountId: string, fanId: string, cache: QueryCache): QueryOptions<History> {
  return {
    key: keys.chatMessages(accountId, fanId),
    staleTime: 60_000,
    gcTime: 600_000,
    query: async ({ signal }) => {
      const account = cache.getQueryData<Account[]>(keys.accounts())?.find((item) => String(item.id) === accountId);
      const body = await api
        .get(`api/v0/accounts/${accountId}/chats/${fanId}/messages`, { signal, searchParams: new URLSearchParams({ limit: String(HISTORY_PAGE) }) })
        .json<Items & { has_more?: unknown }>();
      const items = body.items.map((raw) => mapRestMessage(raw, 'onlyfans', { fanId, platformAccountId: account?.platformAccountId ?? '' }));
      return { pages: [{ items, hasMore: body.has_more === true, cursor: items.at(-1)?.id ?? null }], pageParams: [null] };
    },
  };
}

/** Loads one older history page into the cache (scrolling up in the open chat). */
export async function loadOlderHistory(cache: QueryCache, accountId: string, fanId: string): Promise<void> {
  const key = keys.chatMessages(accountId, fanId);
  const history = cache.getQueryData<History>(key);
  const last = history?.pages.at(-1);
  if (history === undefined || last === undefined || !last.hasMore || last.cursor === null) return;
  const account = cache.getQueryData<Account[]>(keys.accounts())?.find((item) => String(item.id) === accountId);
  const body = await api
    .get(`api/v0/accounts/${accountId}/chats/${fanId}/messages`, { searchParams: new URLSearchParams({ limit: String(HISTORY_PAGE), cursor: last.cursor }) })
    .json<Items & { has_more?: unknown }>();
  const items = body.items.map((raw) => mapRestMessage(raw, 'onlyfans', { fanId, platformAccountId: account?.platformAccountId ?? '' }));
  cache.setQueryData<History>(key, (previous) => ({
    pages: [...(previous?.pages ?? []), { items, hasMore: body.has_more === true, cursor: items.at(-1)?.id ?? null }],
    pageParams: [...(previous?.pageParams ?? []), last.cursor],
  }));
}

async function fetchListPage(accountId: string, filter: string, offset: number, platformAccountId: string, signal?: AbortSignal): Promise<ChatList['pages'][number]> {
  const params = new URLSearchParams({ limit: String(LIST_PAGE), offset: String(offset) });
  if (filter !== 'all') params.set('filter', filter);
  const body = await api.get(`api/v0/accounts/${accountId}/chats`, { ...(signal ? { signal } : {}), searchParams: params }).json<Items & { has_more?: unknown; next_offset?: unknown }>();
  return {
    items: body.items.map((raw) => mapChat(raw, accountId, platformAccountId)),
    hasMore: body.has_more === true,
    nextOffset: typeof body.next_offset === 'number' ? body.next_offset : offset + body.items.length,
  };
}

export function chatListQuery(accountId: string, cache: QueryCache, filter = 'all'): QueryOptions<ChatList> {
  return {
    key: keys.chatList(accountId, filter),
    staleTime: 60_000,
    gcTime: 600_000,
    query: async ({ signal }) => {
      const account = cache.getQueryData<Account[]>(keys.accounts())?.find((item) => String(item.id) === accountId);
      // An infinite query refetches every page it had loaded, in order.
      const loaded = Math.max(1, cache.getQueryData<ChatList>(keys.chatList(accountId, filter))?.pages.length ?? 1);
      const pages: ChatList['pages'][number][] = [];
      let offset = 0;
      for (let index = 0; index < loaded; index += 1) {
        const page = await fetchListPage(accountId, filter, offset, account?.platformAccountId ?? '', signal);
        pages.push(page);
        offset = page.nextOffset;
        if (!page.hasMore) break;
      }
      return { pages, pageParams: pages.map((_, index) => index * LIST_PAGE) };
    },
  };
}

export async function loadNextListPage(cache: QueryCache, accountId: string, filter = 'all'): Promise<void> {
  const key = keys.chatList(accountId, filter);
  const list = cache.getQueryData<ChatList>(key);
  const last = list?.pages.at(-1);
  if (list === undefined || last === undefined || !last.hasMore) return;
  const account = cache.getQueryData<Account[]>(keys.accounts())?.find((item) => String(item.id) === accountId);
  const page = await fetchListPage(accountId, filter, last.nextOffset, account?.platformAccountId ?? '');
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
  const [name, accountId, third] = key;
  if (name === keys.chatMessages('', '')[0] && accountId !== undefined && third !== undefined) return chatMessagesQuery(accountId, third, cache);
  if (name === keys.chatList('')[0] && accountId !== undefined) return chatListQuery(accountId, cache, third ?? 'all');
  return null;
}
