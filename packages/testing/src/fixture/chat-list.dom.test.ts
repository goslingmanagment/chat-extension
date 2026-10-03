// The fixture's chat-list keys and its socket updates per kind of list,
// without a browser (happy-dom; frames go straight into the socket bus).

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';

import { socket } from '../../fixture-chatspace/src/net/socket';
import { useQueryCache } from '../../fixture-chatspace/src/query/cache';
import type { Chat, ChatList } from '../../fixture-chatspace/src/query/model';
import { ALL_CHATS, chatListViewOf, isSearchOrOldFirst, keys } from '../../fixture-chatspace/src/query/queries';
import { useChatListStore } from '../../fixture-chatspace/src/stores/chats';

const ACCOUNT = '910101';

const chat = (id: string, unread = 0): Chat => ({ id, accountId: ACCOUNT, platform: 'onlyfans', unreadMessagesCount: unread, lastMessage: null, canSendMessage: true, isMutedNotifications: false });
const list = (...ids: string[]): ChatList => ({ pages: [{ items: ids.map((id) => chat(id)), hasMore: false, nextOffset: ids.length }], pageParams: [0] });
const idsOf = (data: unknown): string[] => (data as ChatList).pages.flatMap((page) => page.items.map((item) => item.id));

/** Hands a frame to the page's socket bus as if it arrived on the socket. */
function deliver(frame: Record<string, unknown>): void {
  (socket as unknown as { onFrame: (text: string) => void }).onFrame(JSON.stringify(frame));
}

const fanMessage = (chatId: string): Record<string, unknown> => ({
  event: 'account_new_message',
  account: { account_id: ACCOUNT, platform: 'onlyfans', platform_account_id: '830000101' },
  message: { id: `59${chatId}`, content: '<p>new</p>', sentAt: '2026-09-02T10:00:00.000Z', chatId, platform_fan_id: chatId, is_from_fan: true, platformMetadata: {} },
});

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('fixture chat-list keys', () => {
  it('builds the host layout: [chatList, acc, all | filter:<f> | list:<id>, search:<q>?, order:old?]', () => {
    expect(keys.chatList(ACCOUNT)).toEqual(['chatList', ACCOUNT, 'all']);
    expect(keys.chatList(ACCOUNT, { scope: 'filter:unread', search: '', order: 'recent' })).toEqual(['chatList', ACCOUNT, 'filter:unread']);
    expect(keys.chatList(ACCOUNT, { scope: 'list:501', search: 'fern', order: 'old' })).toEqual(['chatList', ACCOUNT, 'list:501', 'search:fern', 'order:old']);
    expect(chatListViewOf(['chatList', ACCOUNT, 'filter:priority', 'order:old'])).toEqual({ scope: 'filter:priority', search: '', order: 'old' });
    expect(isSearchOrOldFirst(keys.chatList(ACCOUNT, ALL_CHATS))).toBe(false);
    expect(keys.chatMessages(ACCOUNT, '74001001', '5100000005')).toEqual(['chatMessages', ACCOUNT, '74001001', '5100000005']);
    expect(keys.pinnedMessages(ACCOUNT, '74001001')).toEqual(['chatMessages', ACCOUNT, '74001001', 'pinned']);
  });
});

describe('fixture chat-list socket updates', () => {
  it('plain lists move the chat up or refetch; search and old-first lists are patched in place, and only while observed', () => {
    const cache = useQueryCache();
    useChatListStore();
    const all = keys.chatList(ACCOUNT);
    const unread = keys.chatList(ACCOUNT, { scope: 'filter:unread', search: '', order: 'recent' });
    const search = keys.chatList(ACCOUNT, { scope: 'all', search: 'fan', order: 'recent' });
    const oldIdle = keys.chatList(ACCOUNT, { scope: 'all', search: '', order: 'old' });
    const oldActive = keys.chatList(ACCOUNT, { scope: 'filter:pinned', search: '', order: 'old' });
    cache.setQueryData(all, list('1', '2', '3'));
    cache.setQueryData(unread, list('1'));
    cache.setQueryData(search, list('1', '3'));
    cache.setQueryData(oldIdle, list('3', '2', '1'));
    cache.setQueryData(oldActive, list('9'));
    const observer = {};
    for (const key of [search, oldActive]) {
      const entry = cache.get(key);
      if (entry !== undefined) cache.track(entry, observer);
    }
    const invalidated: string[] = [];
    cache.$onAction(({ name, args }) => {
      if (name === 'invalidate') invalidated.push(JSON.stringify((args[0] as { key: readonly string[] }).key));
    });

    deliver(fanMessage('3'));

    expect(idsOf(cache.getQueryData(all))).toEqual(['3', '1', '2']);
    expect(invalidated).toEqual([JSON.stringify(unread)]);
    expect(idsOf(cache.getQueryData(search))).toEqual(['1', '3']);
    expect((cache.getQueryData<ChatList>(search)?.pages[0]?.items[1] as Chat).unreadMessagesCount).toBe(1);
    expect(cache.getQueryData<ChatList>(oldIdle)?.pages[0]?.items.map((item) => item.unreadMessagesCount)).toEqual([0, 0, 0]);
    expect(idsOf(cache.getQueryData(oldActive))).toEqual(['9']);
  });
});
