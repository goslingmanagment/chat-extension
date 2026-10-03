// Chat stores (metadata.ts «chats», «chat-list», «chat-messages»):
// - chats: chatsById, online statuses (isFanOnline by fan id), typing;
// - chatList: socket updates of every loaded ["chatList", acc, …] entry by
//   kind: a plain list (all, a filter, a fan list) moves the chat to the top
//   (unread +1 from the fan, 0 on outgoing), or is invalidated when it does not
//   hold the chat; a search or old-first list is patched in place, and only
//   while someone observes it; markChatAsRead touches only the cache;
// - chatMessages: socket upsert into ["chatMessages", acc, fan] — no cache →
//   nothing (an existing but empty entry is invalidated); outgoing echoes go
//   to pendingMessages.confirmEchoedMessage first.

import { defineStore } from 'pinia';
import { ref } from 'vue';

import { keyName, storeId } from '../env';
import { record } from '../journal';
import { useSocket, type Frame } from '../net/socket';
import { useQueryCache } from '../query/cache';
import { hasMessage, mapSocketMessage, upsertMessage, type Chat, type ChatList, type History } from '../query/model';
import { isAllChatsScope, isSearchOrOldFirst, keys } from '../query/queries';
import { usePendingMessages } from './pending-messages';

const TYPING_MS = 5000;

interface NewMessageFrame {
  readonly account: Record<string, unknown> & { readonly account_id: string };
  readonly message: Record<string, unknown> & { readonly id: string; readonly chatId: string; readonly content: string; readonly is_from_fan: boolean };
}

function asNewMessage(frame: Frame): NewMessageFrame | null {
  const account = frame['account'] as NewMessageFrame['account'] | undefined;
  const message = frame['message'] as NewMessageFrame['message'] | undefined;
  if (typeof account?.account_id !== 'string' || typeof message?.chatId !== 'string' || typeof message.id !== 'string') return null;
  return { account, message };
}

export const useChatsStore = defineStore(storeId('chats'), () => {
  const chatsById = ref<Record<string, Chat>>({});
  const onlineStatuses = ref<Record<string, boolean>>({});
  const onlineFetchedAt = ref<Record<string, number>>({});
  const typing = ref<Record<string, boolean>>({});
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const stopTyping = (key: string): void => {
    clearTimeout(timers.get(key));
    timers.delete(key);
    delete typing.value[key];
  };

  useSocket({
    listeners: [
      {
        event: 'account_fan_typing',
        handler: (frame) => {
          const account = frame['account'] as { account_id?: string } | undefined;
          const event = frame['typing'] as { platform_fan_id?: string } | undefined;
          if (account?.account_id === undefined || event?.platform_fan_id === undefined) return;
          const key = `${account.account_id}:${event.platform_fan_id}`;
          stopTyping(key);
          typing.value[key] = true;
          timers.set(key, setTimeout(() => stopTyping(key), TYPING_MS));
        },
      },
      {
        event: 'account_new_message',
        handler: (frame) => {
          const parsed = asNewMessage(frame);
          if (parsed?.message.is_from_fan === true) stopTyping(`${parsed.account.account_id}:${parsed.message.chatId}`);
        },
      },
    ],
  });

  const getChat = (id: string): Chat | undefined => chatsById.value[id];
  const isFanOnline = (fanId: string, fallback: boolean | null = null): boolean | null => onlineStatuses.value[fanId] ?? fallback;
  const isFanTyping = (accountId: string, fanId: string): boolean => typing.value[`${accountId}:${fanId}`] ?? false;
  const getFanOnlineFetchedAt = (accountId: string, fanId: string): number | null => onlineFetchedAt.value[`${accountId}:${fanId}`] ?? null;
  const upsertChats = (chats: readonly Chat[]): void => {
    for (const chat of chats) chatsById.value[chat.id] = chat;
  };
  const removeChats = (ids: readonly string[]): void => {
    for (const id of ids) delete chatsById.value[id];
  };
  const updateOnlineStatuses = (accountId: string, statuses: Readonly<Record<string, boolean>>): void => {
    const now = Date.now();
    onlineStatuses.value = { ...onlineStatuses.value, ...statuses };
    for (const fanId of Object.keys(statuses)) onlineFetchedAt.value[`${accountId}:${fanId}`] = now;
  };
  return { chatsById, getChat, isFanOnline, isFanTyping, getFanOnlineFetchedAt, upsertChats, removeChats, updateOnlineStatuses };
});

const mapList = (list: ChatList, update: (chat: Chat) => Chat): ChatList => ({ ...list, pages: list.pages.map((page) => ({ ...page, items: page.items.map(update) })) });
const findChat = (list: ChatList, chatId: string): Chat | undefined => list.pages.flatMap((page) => page.items).find((chat) => chat.id === chatId);
const moveToTop = (list: ChatList, chat: Chat): ChatList => ({
  ...list,
  pages: list.pages.map((page, index) => {
    const rest = page.items.filter((item) => item.id !== chat.id);
    return index === 0 ? { ...page, items: [chat, ...rest] } : { ...page, items: rest };
  }),
});
const replaceInPlace = (list: ChatList, chat: Chat): ChatList => mapList(list, (item) => (item.id === chat.id ? chat : item));

export const useChatListStore = defineStore(storeId('chatList'), () => {
  const cache = useQueryCache();
  const chats = useChatsStore();
  const listEntries = (accountId: string) => cache.getEntries({ key: [keyName('chatList'), accountId] });

  useSocket({
    onReconnect: () => void cache.invalidateQueries({ key: [keyName('chatList')] }),
    listeners: [
      {
        event: 'account_new_message',
        handler: (frame) => {
          const parsed = asNewMessage(frame);
          if (parsed === null) return;
          const { account, message } = parsed;
          const touched = (chat: Chat): Chat => ({
            ...chat,
            lastMessage: mapSocketMessage(message, account, 'onlyfans'),
            unreadMessagesCount: message.is_from_fan ? chat.unreadMessagesCount + 1 : 0,
            ...(message.is_from_fan ? {} : { isMarkedAsUnread: undefined }),
          });
          let updated: Chat | null = null;
          for (const entry of listEntries(account.account_id)) {
            const data = entry.state.value.data as ChatList | undefined;
            if (data === undefined) continue;
            if (isSearchOrOldFirst(entry.key)) {
              const known = entry.active ? findChat(data, message.chatId) : undefined;
              if (known === undefined) continue;
              const next = touched(known);
              cache.setQueryData<ChatList>(entry.key, (previous) => replaceInPlace(previous ?? data, next));
              updated = next;
              continue;
            }
            const known = findChat(data, message.chatId) ?? (isAllChatsScope(entry.key) ? chats.getChat(message.chatId) : undefined);
            if (known === undefined) {
              void cache.invalidateQueries({ key: entry.key, exact: true });
              continue;
            }
            const next = touched(known);
            cache.setQueryData<ChatList>(entry.key, (previous) => moveToTop(previous ?? data, next));
            updated = next;
          }
          if (updated !== null) chats.upsertChats([updated]);
        },
      },
    ],
  });

  /** Opening a chat: unread → 0 in the cache only (no request; the history load is what the platform sees). */
  const markChatAsRead = (accountId: string, chatId: string): void => {
    for (const entry of listEntries(accountId)) {
      if (entry.state.value.data === undefined) continue;
      cache.setQueryData<ChatList>(entry.key, (list) => mapList(list ?? (entry.state.value.data as ChatList), (chat) => (chat.id === chatId ? { ...chat, unreadMessagesCount: 0 } : chat)));
    }
    const chat = chats.getChat(chatId);
    if (chat !== undefined) chats.upsertChats([{ ...chat, unreadMessagesCount: 0 }]);
    record('chat-marked-read-locally', { accountId, chatId });
  };
  return { markChatAsRead };
});

export const useChatMessagesStore = defineStore(storeId('chatMessages'), () => {
  const cache = useQueryCache();
  const pending = usePendingMessages();

  useSocket({
    onReconnect: () => void cache.invalidateQueries({ key: [keyName('chatMessages')] }),
    listeners: [
      {
        event: 'account_new_message',
        handler: (frame) => {
          const parsed = asNewMessage(frame);
          if (parsed === null) return;
          const { account, message } = parsed;
          const key = keys.chatMessages(account.account_id, message.chatId);
          const data = cache.getQueryData<History>(key);
          const [entry] = cache.getEntries({ key, exact: true });
          if (data === undefined) {
            if (entry !== undefined) void cache.invalidateQueries({ key, exact: true });
            return;
          }
          if (!message.is_from_fan) pending.confirmEchoedMessage(account.account_id, message.chatId, message.content, hasMessage(data, message.id));
          const mapped = mapSocketMessage(message, account, 'onlyfans');
          cache.setQueryData<History>(key, (previous) => upsertMessage(previous ?? data, mapped));
          if (entry?.asyncStatus.value === 'loading') void cache.invalidateQueries({ key, exact: true });
        },
      },
    ],
  });
  return {};
});
