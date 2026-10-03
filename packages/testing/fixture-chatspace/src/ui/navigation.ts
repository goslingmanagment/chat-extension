// Navigation of the stand: everything goes through router.push to the `chat`
// route (/accounts/:accountId/chats/:chatId?), as ChatSpace's own chat list,
// tabs and notifications do. The route then drives the tabs (ChatView).

import type { Router } from 'vue-router';

import { isBroken } from '../env';
import { record } from '../journal';
import { useChatTabEntries, useTabEntries } from '../stores/accounts';

export interface Navigation {
  readonly router: Router;
  currentAccountId(): string | null;
  currentChatId(): string | null;
  goToChat(accountId: string, chatId: string | null, query?: Readonly<Record<string, string>>): Promise<void>;
  openChat(accountId: string, chatId: string, options?: { readonly newTab?: boolean; readonly firstId?: string }): Promise<void>;
  openAccount(accountId: string): Promise<void>;
  activateChatTab(accountId: string, entryId: string): Promise<void>;
  newChatTab(accountId: string): Promise<void>;
  closeChatTab(accountId: string, entryId: string, via: string): Promise<void>;
  closeActiveChatTab(via: string): Promise<void>;
  switchChatTab(step: 1 | -1): Promise<void>;
}

export const chatRouteName = (): string => (isBroken('router-name') ? 'conversation' : 'chat');

let navigation: Navigation | null = null;

export function useNavigation(): Navigation {
  if (navigation === null) throw new Error('navigation is not installed');
  return navigation;
}

const param = (router: Router, name: string): string | null => {
  const value = router.currentRoute.value.params[name];
  return typeof value === 'string' && value !== '' ? value : null;
};

export function installNavigation(router: Router): Navigation {
  const chatTabs = useChatTabEntries();
  const accountTabs = useTabEntries();

  const goToChat = async (accountId: string, chatId: string | null, query: Readonly<Record<string, string>> = {}): Promise<void> => {
    await router.push({ name: chatRouteName(), params: { accountId, ...(chatId !== null ? { chatId } : {}) }, query });
  };
  const activeEntryOf = (accountId: string) => {
    const state = chatTabs.stateByAccountId[accountId];
    return state?.entries.find((entry) => entry.id === state.activeEntryId);
  };

  navigation = {
    router,
    currentAccountId: () => param(router, 'accountId'),
    currentChatId: () => param(router, 'chatId'),
    goToChat,
    openChat: async (accountId, chatId, options = {}) => {
      chatTabs.ensureAccount(accountId);
      if (options.newTab === true) chatTabs.openEmptyEntry(accountId);
      // `firstId` anchors the history at a message (search hits, notifications).
      await goToChat(accountId, chatId, options.firstId !== undefined ? { firstId: options.firstId } : {});
    },
    openAccount: async (accountId) => {
      accountTabs.openAccount(accountId);
      chatTabs.ensureAccount(accountId);
      await goToChat(accountId, chatTabs.getActiveChatIdForAccount(accountId));
    },
    activateChatTab: async (accountId, entryId) => {
      chatTabs.setActiveEntry(accountId, entryId);
      await goToChat(accountId, activeEntryOf(accountId)?.chatId ?? null);
    },
    newChatTab: async (accountId) => {
      chatTabs.openEmptyEntry(accountId);
      await goToChat(accountId, null);
    },
    closeChatTab: async (accountId, entryId, via) => {
      const closing = chatTabs.stateByAccountId[accountId]?.entries.find((entry) => entry.id === entryId);
      chatTabs.closeEntry(accountId, entryId);
      record('chat-tab-closed', { accountId, chatId: closing?.chatId ?? null, via });
      await goToChat(accountId, activeEntryOf(accountId)?.chatId ?? null);
    },
    closeActiveChatTab: async (via) => {
      const accountId = param(router, 'accountId');
      const active = accountId === null ? undefined : activeEntryOf(accountId);
      if (accountId === null || active === undefined) return;
      await navigation?.closeChatTab(accountId, active.id, via);
    },
    switchChatTab: async (step) => {
      const accountId = param(router, 'accountId');
      const state = accountId === null ? undefined : chatTabs.stateByAccountId[accountId];
      if (accountId === null || state === undefined || state.entries.length < 2) return;
      const index = state.entries.findIndex((entry) => entry.id === state.activeEntryId);
      const next = state.entries[(index + step + state.entries.length) % state.entries.length];
      if (next !== undefined) await navigation?.activateChatTab(accountId, next.id);
    },
  };
  return navigation;
}
