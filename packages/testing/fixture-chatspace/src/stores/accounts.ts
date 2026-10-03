// Account tabs, chat tabs and the accounts store (metadata.ts «accounts»):
// `subscribedAccountIds` is updated BEFORE subscribe_account goes out (so
// membership alone does not prove the socket subscribed); open account tabs
// drive the subscriptions; chat tabs count new fan messages per inactive tab.

import { defineStore } from 'pinia';
import { computed, ref, watch, type Ref } from 'vue';

import { storeId } from '../env';
import { record } from '../journal';
import { currentUserId } from '../net/auth';
import { useSocket, type Frame, type SendAction } from '../net/socket';
import { useQueryCache } from '../query/cache';
import type { Account } from '../query/model';
import { keys } from '../query/queries';
import { storedRef } from './stored';

export interface AccountTab {
  readonly id: string;
  accountId: string | null;
}

export interface ChatTab {
  readonly id: string;
  chatId: string | null;
}

export interface AccountChatTabs {
  entries: ChatTab[];
  activeEntryId: string;
  newMessagesByChatId: Record<string, number>;
}

const SUPPORTED_PLATFORMS = new Set(['onlyfans', 'telegram_v2']);
/** On a fresh profile the stand opens tabs for this many accounts (the rest stay unsubscribed). */
const ACCOUNTS_OPEN_ON_FIRST_LOAD = 2;

const tabId = (): string => `tab-${Math.random().toString(36).slice(2, 9)}`;

export const useTabEntries = defineStore(storeId('tabEntries'), () => {
  const user = currentUserId();
  const openedEntries = storedRef<AccountTab[]>(`chat-space:account-tabs:${user}`, () => []);
  const activeEntryId = storedRef<string | null>(`chat-space:active-account-tab:${user}`, () => null);
  const activeEntry = computed(() => openedEntries.value.find((entry) => entry.id === activeEntryId.value));

  const setActive = (id: string): void => {
    if (openedEntries.value.some((entry) => entry.id === id)) activeEntryId.value = id;
  };
  /** The route's account gets a tab: its existing one, or a new one. */
  const openAccount = (accountId: string): void => {
    const existing = openedEntries.value.find((entry) => entry.accountId === accountId);
    if (existing !== undefined) {
      activeEntryId.value = existing.id;
      return;
    }
    const entry: AccountTab = { id: tabId(), accountId };
    openedEntries.value.push(entry);
    activeEntryId.value = entry.id;
  };
  const closeTab = (id: string): void => {
    openedEntries.value = openedEntries.value.filter((entry) => entry.id !== id);
    if (activeEntryId.value === id) activeEntryId.value = openedEntries.value[0]?.id ?? null;
  };
  const getAccountIdForTab = (id: string): string | null => openedEntries.value.find((entry) => entry.id === id)?.accountId ?? null;
  /** First load of a fresh profile: tabs for the first accounts the API lists. */
  const seed = (accountIds: readonly string[]): void => {
    if (openedEntries.value.length > 0) return;
    openedEntries.value = accountIds.slice(0, ACCOUNTS_OPEN_ON_FIRST_LOAD).map((accountId) => ({ id: tabId(), accountId }));
    activeEntryId.value = openedEntries.value[0]?.id ?? null;
  };
  return { openedEntries, activeEntryId, activeEntry, setActive, openAccount, closeTab, getAccountIdForTab, seed };
});

export const useChatTabEntries = defineStore(storeId('chatTabEntries'), () => {
  const stateByAccountId = storedRef<Record<string, AccountChatTabs>>(`chat-space:chat-tabs:${currentUserId()}`, () => ({}));
  for (const state of Object.values(stateByAccountId.value)) state.newMessagesByChatId = {};

  const activeChatOf = (state: AccountChatTabs): string | null => state.entries.find((entry) => entry.id === state.activeEntryId)?.chatId ?? null;
  const clearCounter = (state: AccountChatTabs, chatId: string | null): void => {
    if (chatId !== null) delete state.newMessagesByChatId[chatId];
  };

  useSocket({
    listeners: [
      {
        event: 'account_new_message',
        handler: (frame: Frame) => {
          const account = frame['account'] as { account_id?: string } | undefined;
          const message = frame['message'] as { chatId?: string; is_from_fan?: boolean } | undefined;
          if (message?.is_from_fan !== true || account?.account_id === undefined || message.chatId === undefined) return;
          const state = stateByAccountId.value[account.account_id];
          if (state === undefined || message.chatId === activeChatOf(state)) return;
          if (state.entries.some((entry) => entry.chatId === message.chatId)) {
            state.newMessagesByChatId[message.chatId] = (state.newMessagesByChatId[message.chatId] ?? 0) + 1;
          }
        },
      },
    ],
  });

  const getActiveChatIdForAccount = (accountId: string): string | null => {
    const state = stateByAccountId.value[accountId];
    return state ? activeChatOf(state) : null;
  };
  const ensureAccount = (accountId: string): AccountChatTabs => {
    const existing = stateByAccountId.value[accountId];
    if (existing !== undefined) return existing;
    const entry: ChatTab = { id: tabId(), chatId: null };
    stateByAccountId.value[accountId] = { entries: [entry], activeEntryId: entry.id, newMessagesByChatId: {} };
    return stateByAccountId.value[accountId];
  };
  const openEmptyEntry = (accountId: string): string | null => {
    const state = stateByAccountId.value[accountId];
    if (state === undefined) return null;
    const entry: ChatTab = { id: tabId(), chatId: null };
    state.entries.push(entry);
    state.activeEntryId = entry.id;
    return entry.id;
  };
  const setActiveEntry = (accountId: string, entryId: string): void => {
    const state = stateByAccountId.value[accountId];
    const entry = state?.entries.find((item) => item.id === entryId);
    if (state === undefined || entry === undefined) return;
    state.activeEntryId = entryId;
    clearCounter(state, entry.chatId);
  };
  /** Route → tabs: activate the tab that has the chat, else put the chat into the active tab. */
  const syncActiveEntryWithChat = (accountId: string, chatId: string | null): void => {
    const state = stateByAccountId.value[accountId];
    if (state === undefined) return;
    const active = state.entries.find((entry) => entry.id === state.activeEntryId);
    if (active === undefined || active.chatId === chatId) return;
    const other = chatId === null ? undefined : state.entries.find((entry) => entry.chatId === chatId);
    if (other !== undefined) state.activeEntryId = other.id;
    else active.chatId = chatId;
    clearCounter(state, chatId);
  };
  const closeEntry = (accountId: string, entryId: string): void => {
    const state = stateByAccountId.value[accountId];
    if (state === undefined) return;
    const index = state.entries.findIndex((entry) => entry.id === entryId);
    if (index === -1) return;
    state.entries.splice(index, 1);
    if (state.entries.length === 0) {
      const entry: ChatTab = { id: tabId(), chatId: null };
      state.entries.push(entry);
      state.activeEntryId = entry.id;
      return;
    }
    if (state.activeEntryId !== entryId) return;
    const next = state.entries[Math.min(index, state.entries.length - 1)];
    if (next !== undefined) {
      state.activeEntryId = next.id;
      clearCounter(state, next.chatId);
    }
  };
  return { stateByAccountId, getActiveChatIdForAccount, ensureAccount, openEmptyEntry, setActiveEntry, syncActiveEntryWithChat, closeEntry };
});

/** The `account` payload of subscribe/unsubscribe actions. */
const subscriptionAccount = (account: Account): Record<string, string> => ({
  account_id: String(account.id),
  platform: account.platform,
  platform_account_id: account.platformAccountId,
});

export const useAccountsStore = defineStore(storeId('accounts'), () => {
  const cache = useQueryCache();
  const tabs = useTabEntries();
  const subscribedAccountIds: Ref<Set<string>> = ref(new Set());
  const supportedAccounts = computed(() => (cache.getQueryData<Account[]>(keys.accounts()) ?? []).filter((account) => SUPPORTED_PLATFORMS.has(account.platform)));
  const openAccountIds = computed(() => tabs.openedEntries.map((entry) => entry.accountId).filter((id): id is string => id !== null));
  const findAccount = (id: string | number): Account | undefined => supportedAccounts.value.find((account) => String(account.id) === String(id));

  let deferred = false;
  const sync = async (send: SendAction): Promise<void> => {
    if (status.value !== 'OPEN') {
      deferred = true;
      record('ws-subscriptions-deferred', { status: status.value });
      return;
    }
    deferred = false;
    const open = new Set(openAccountIds.value);
    const stale = [...subscribedAccountIds.value].filter((id) => !open.has(id));
    const fresh = [...open].filter((id) => !subscribedAccountIds.value.has(id));
    for (const id of stale) {
      const next = new Set(subscribedAccountIds.value);
      next.delete(id);
      subscribedAccountIds.value = next;
      const account = findAccount(id);
      if (account !== undefined) await send('unsubscribe_account', { account: subscriptionAccount(account) });
    }
    for (const id of fresh) {
      const account = findAccount(id);
      if (account === undefined) continue;
      // Membership first, then the frame: the set says "asked", not "subscribed".
      subscribedAccountIds.value = new Set([...subscribedAccountIds.value, id]);
      await send('subscribe_account', { account: subscriptionAccount(account) });
    }
  };

  const { send, status } = useSocket({
    onConnect: (sendAction) => sync(sendAction),
    onReconnect: async (sendAction) => {
      subscribedAccountIds.value = new Set();
      await sync(sendAction);
    },
    listeners: [{ event: 'accounts_list_updated', handler: () => void cache.invalidateQueries({ key: keys.accounts() }) }],
  });
  watch(openAccountIds, () => void sync(send));
  watch(supportedAccounts, () => void sync(send));
  watch(status, (next) => {
    if (next === 'OPEN' && deferred) void sync(send);
  });

  return { subscribedAccountIds, supportedAccounts, openAccountIds, findAccount };
});
