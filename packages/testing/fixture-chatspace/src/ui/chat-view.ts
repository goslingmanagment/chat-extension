// The `chat` route: chat list, conversation (header, message list, composers).
// - The chat list observes ["chatList", acc, 'all']; its rows are links with
//   data-testid="chat-list-item" and data-chat-id.
// - The message list observes ["chatMessages", acc, fan] of the OPEN chat only
//   (opening a chat loads its history; nothing else does) and keeps the bottom
//   on resize, or the anchor message when scrolled up (metadata.ts «message-list»).
// - Opening a chat marks it read in the cache only, once the first load settled.

import { computed, defineComponent, h, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch, type PropType, type VNode } from 'vue';
import { useRoute } from 'vue-router';

import { record } from '../journal';
import { api } from '../net/http';
import { useQueryCache } from '../query/cache';
import type { Account, FansMap, Message } from '../query/model';
import { chatListQuery, chatMessagesQuery, ensureFans, ensureFanStats, ensureInsights, keys, loadNextListPage, loadOlderHistory } from '../query/queries';
import { useQuery } from '../query/use-query';
import { useChatTabEntries, useTabEntries } from '../stores/accounts';
import { useChatListStore, useChatMessagesStore, useChatsStore } from '../stores/chats';
import { usePendingMessages, type PendingEntry } from '../stores/pending-messages';
import { ConversationComposers } from './composer';
import { useNavigation } from './navigation';
import { registerMessageList } from './registry';

const BOTTOM_SLACK_PX = 2;
const LOAD_OLDER_AT_PX = 40;

const fanName = (fans: FansMap | undefined, fanId: string): string => fans?.[fanId]?.name ?? `Fan ${fanId.slice(-4)}`;
const preview = (message: Message | null): string =>
  message === null
    ? ''
    : message.text
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<[^>]*>/g, '')
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll('&amp;', '&');

const ChatsPanel = defineComponent({
  name: 'ChatsPanel',
  props: { accountId: { type: String, required: true }, chatId: { type: String as PropType<string | null>, default: null } },
  setup(props) {
    const cache = useQueryCache();
    const chats = useChatsStore();
    const nav = useNavigation();
    const list = useQuery(() => chatListQuery(props.accountId, cache));
    useQuery(() => ({ key: keys.fansMap(props.accountId), staleTime: Number.POSITIVE_INFINITY, query: () => Promise.resolve(cache.getQueryData<FansMap>(keys.fansMap(props.accountId)) ?? {}) }));
    const rows = computed(() => (list.data.value)?.pages.flatMap((page) => page.items) ?? []);
    const fans = computed(() => cache.getQueryData<FansMap>(keys.fansMap(props.accountId)));
    watch(
      rows,
      (items) => {
        const ids = items.map((chat) => chat.id);
        chats.upsertChats(items);
        const canViewBuyingPower = (cache.getQueryData<string[]>(keys.userPermissions()) ?? []).includes('om_buying_power');
        void ensureFans(cache, props.accountId, ids).catch(() => undefined);
        void ensureFanStats(cache, props.accountId, ids, canViewBuyingPower).catch(() => undefined);
      },
      { immediate: true },
    );
    return (): VNode => {
      const hasMore = (list.data.value)?.pages.at(-1)?.hasMore === true;
      return h('aside', { class: 'chats-panel', 'data-testid': 'chats-panel' }, [
        h('div', { class: 'chats-panel__title' }, list.loading.value && rows.value.length === 0 ? 'Loading chats…' : 'Chats'),
        h(
          'nav',
          { class: 'chats-panel__list' },
          rows.value.map((chat) => {
            const href = `/accounts/${props.accountId}/chats/${chat.id}`;
            const online = chats.isFanOnline(chat.id) === true;
            const typing = chats.isFanTyping(props.accountId, chat.id);
            return h(
              'a',
              {
                key: chat.id,
                href,
                class: ['chat-row', chat.id === props.chatId ? 'chat-row--active' : ''],
                'data-testid': 'chat-list-item',
                'data-chat-id': chat.id,
                onClick: (event: MouseEvent) => {
                  event.preventDefault();
                  void (event.ctrlKey || event.metaKey ? nav.openChat(props.accountId, chat.id, { newTab: true }) : nav.goToChat(props.accountId, chat.id));
                },
              },
              [
                h('span', { class: ['avatar', online ? 'avatar--online' : ''] }, fanName(fans.value, chat.id).slice(4, 5)),
                h('span', { class: 'chat-row__text' }, [
                  h('span', { class: 'chat-row__name' }, fanName(fans.value, chat.id)),
                  h('span', { class: 'chat-row__preview' }, typing ? 'typing…' : preview(chat.lastMessage)),
                ]),
                chat.unreadMessagesCount > 0 ? h('span', { class: 'badge' }, String(chat.unreadMessagesCount)) : null,
              ],
            );
          }),
        ),
        hasMore ? h('button', { type: 'button', class: 'chip chats-panel__more', onClick: () => void loadNextListPage(cache, props.accountId) }, 'Load more') : null,
      ]);
    };
  },
});

const MessagesList = defineComponent({
  name: 'MessagesList',
  props: { accountId: { type: String, required: true }, chatId: { type: String, required: true } },
  setup(props) {
    const cache = useQueryCache();
    const chatList = useChatListStore();
    const pending = usePendingMessages();
    const history = useQuery(() => chatMessagesQuery(props.accountId, props.chatId, cache));
    const scroller = ref<HTMLElement | null>(null);
    const content = ref<HTMLElement | null>(null);
    const view = reactive({ atBottom: true, anchorId: null as string | null, anchorOffset: 0 });
    let loadingOlder = false;

    const messages = computed(() => [...((history.data.value)?.pages.flatMap((page) => page.items) ?? [])].reverse());
    const queued = computed<PendingEntry[]>(() => (pending.messagesByAccountId[props.accountId] ?? []).filter((entry) => entry.chatId === props.chatId && entry.status !== 'confirmed'));

    const scrollToBottom = (): void => {
      const element = scroller.value;
      if (element !== null) element.scrollTop = element.scrollHeight;
    };
    const rememberAnchor = (): void => {
      const element = scroller.value;
      if (element === null) return;
      view.atBottom = element.scrollHeight - element.scrollTop - element.clientHeight <= BOTTOM_SLACK_PX;
      const first = [...element.querySelectorAll<HTMLElement>('[data-message-id]')].find((node) => node.offsetTop + node.offsetHeight > element.scrollTop);
      view.anchorId = first?.dataset['messageId'] ?? null;
      view.anchorOffset = first === undefined ? 0 : first.offsetTop - element.scrollTop;
    };
    const keepPosition = (): void => {
      const element = scroller.value;
      if (element === null) return;
      if (view.atBottom) {
        scrollToBottom();
        return;
      }
      const anchor = view.anchorId === null ? null : element.querySelector<HTMLElement>(`[data-message-id="${view.anchorId}"]`);
      if (anchor !== null) element.scrollTop = anchor.offsetTop - view.anchorOffset;
    };
    const onScroll = (): void => {
      rememberAnchor();
      const element = scroller.value;
      const last = (history.data.value)?.pages.at(-1);
      if (element !== null && element.scrollTop < LOAD_OLDER_AT_PX && last?.hasMore === true && !loadingOlder) {
        loadingOlder = true;
        void loadOlderHistory(cache, props.accountId, props.chatId).finally(() => {
          loadingOlder = false;
        });
      }
    };

    // Keeps the bottom (or the anchor) when the list's box or its content changes size — e.g. a dock above the composer.
    const observer = new ResizeObserver(() => keepPosition());
    onMounted(() => {
      if (scroller.value !== null) observer.observe(scroller.value);
      if (content.value !== null) observer.observe(content.value);
      registerMessageList(() => {
        const element = scroller.value;
        return {
          atBottom: element === null ? true : element.scrollHeight - element.scrollTop - element.clientHeight <= BOTTOM_SLACK_PX,
          scrollTop: element?.scrollTop ?? 0,
          scrollHeight: element?.scrollHeight ?? 0,
          clientHeight: element?.clientHeight ?? 0,
        };
      });
    });
    onBeforeUnmount(() => {
      observer.disconnect();
      registerMessageList(null);
    });
    watch([() => messages.value.length, () => queued.value.length], () => void nextTick(keepPosition));
    watch(
      () => [props.accountId, props.chatId] as const,
      () => {
        view.atBottom = true;
        void nextTick(scrollToBottom);
      },
    );
    // Opening a chat: the local unread goes to 0 once the first load settled without error.
    watch(
      () => [props.accountId, props.chatId, history.settled.value, history.entry.value?.state.value.status] as const,
      ([accountId, chatId, settled, status]) => {
        if (settled && status === 'success') chatList.markChatAsRead(accountId, chatId);
      },
      { immediate: true },
    );

    return (): VNode =>
      h('div', { ref: scroller, class: 'messages-scroll', onScroll }, [
        h('div', { ref: content, class: 'messages' }, [
          history.loading.value && messages.value.length === 0 ? h('p', { class: 'messages__state' }, 'Loading messages…') : null,
          ...messages.value.map((message) =>
            h('div', { key: message.id, class: ['message', message.isOutgoing ? 'message--out' : 'message--in'], 'data-message-id': message.id }, [
              h('span', { class: 'message__text' }, preview(message)),
            ]),
          ),
          ...queued.value.map((entry) =>
            h('div', { key: entry.id, class: ['message', 'message--out', 'message--pending', `message--${entry.status}`], 'data-pending-id': entry.id }, [
              h('span', { class: 'message__text' }, preview({ text: entry.payload.text } as Message)),
              h('span', { class: 'message__status' }, entry.status === 'failed' ? `failed: ${entry.error?.kind ?? ''}` : entry.status),
              entry.status === 'failed'
                ? h('button', { type: 'button', class: 'chip', onClick: () => pending.resend(props.accountId, entry.id) }, 'Resend')
                : h('button', { type: 'button', class: 'chip', onClick: () => pending.cancel(props.accountId, entry.id) }, 'Cancel'),
            ]),
          ),
        ]),
      ]);
  },
});

const ConversationHeader = defineComponent({
  name: 'ConversationHeader',
  props: { accountId: { type: String, required: true }, chatId: { type: String, required: true } },
  setup(props) {
    const cache = useQueryCache();
    const chats = useChatsStore();
    const fan = computed(() => cache.getQueryData<FansMap>(keys.fansMap(props.accountId))?.[props.chatId] ?? null);
    const setBlocked = async (blocked: boolean): Promise<void> => {
      const path = `api/v0/accounts/${props.accountId}/platforms/onlyfans/users/${props.chatId}/block`;
      await (blocked ? api.post(path) : api.delete(path));
      cache.setQueryData<FansMap>(keys.fansMap(props.accountId), (previous) => {
        const current = previous?.[props.chatId];
        return current ? { ...previous, [props.chatId]: { ...current, isBlocked: blocked } } : (previous ?? {});
      });
    };
    return (): VNode => {
      const online = chats.isFanOnline(props.chatId) === true;
      const typing = chats.isFanTyping(props.accountId, props.chatId);
      return h('header', { class: 'conversation-header', 'data-testid': 'conversation-header' }, [
        h('span', { class: ['avatar', online ? 'avatar--online' : ''] }, fanName(cache.getQueryData<FansMap>(keys.fansMap(props.accountId)), props.chatId).slice(4, 5)),
        h('div', { class: 'conversation-header__text' }, [
          h('strong', fanName(cache.getQueryData<FansMap>(keys.fansMap(props.accountId)), props.chatId)),
          h('span', { class: 'conversation-header__status' }, typing ? 'typing…' : online ? 'online' : 'offline'),
        ]),
        fan.value !== null
          ? h(
              'button',
              { type: 'button', class: 'chip', 'data-testid': 'conversation-header-block-button', onClick: () => void setBlocked(!fan.value?.isBlocked).catch(() => undefined) },
              fan.value.isBlocked ? 'Unblock' : 'Block',
            )
          : null,
      ]);
    };
  },
});

export const ChatView = defineComponent({
  name: 'ChatView',
  setup() {
    const route = useRoute();
    const cache = useQueryCache();
    const accountTabs = useTabEntries();
    const chatTabs = useChatTabEntries();
    useChatMessagesStore();
    const accountId = computed(() => (typeof route.params['accountId'] === 'string' ? route.params['accountId'] : ''));
    const chatId = computed(() => (typeof route.params['chatId'] === 'string' && route.params['chatId'] !== '' ? route.params['chatId'] : null));
    const accountKnown = computed(() => (cache.getQueryData<Account[]>(keys.accounts()) ?? []).some((account) => String(account.id) === accountId.value));
    const visited = ref<{ key: string; tabId: string; accountId: string; chatId: string }[]>([]);

    const activeTabId = computed(() => chatTabs.stateByAccountId[accountId.value]?.activeEntryId ?? null);
    // Route → tabs, and every visited (tab, chat) keeps a composer.
    watch(
      () => [accountId.value, chatId.value] as const,
      ([account, chat]) => {
        if (account === '') return;
        accountTabs.openAccount(account);
        chatTabs.ensureAccount(account);
        chatTabs.syncActiveEntryWithChat(account, chat);
        if (chat !== null) {
          void ensureFans(cache, account, [chat]).catch(() => undefined);
          void ensureInsights(cache, account, chat).catch(() => undefined);
        }
      },
      { immediate: true },
    );
    watch(
      () => [accountId.value, chatId.value, activeTabId.value] as const,
      ([account, chat, tab]) => {
        // Only a settled pair: mid-transition the active tab and the route may disagree.
        const tabChat = chatTabs.stateByAccountId[account]?.entries.find((entry) => entry.id === tab)?.chatId ?? null;
        if (chat === null || tab === null || tabChat !== chat) return;
        const key = `${tab}:${account}:${chat}`;
        if (!visited.value.some((slot) => slot.key === key)) {
          visited.value = [...visited.value, { key, tabId: tab, accountId: account, chatId: chat }];
          record('composer-slot-visited', { key });
        }
      },
      { immediate: true },
    );
    // A tab that no longer holds that chat drops its composer (a new key mounts a new one).
    watch(
      () => JSON.stringify(chatTabs.stateByAccountId),
      () => {
        visited.value = visited.value.filter((slot) => chatTabs.stateByAccountId[slot.accountId]?.entries.some((entry) => entry.id === slot.tabId && entry.chatId === slot.chatId) === true);
      },
    );

    // The conversation waits for its fan: unknown → loading, not found → notice, blocked → notice (no history load).
    const conversation = (): VNode => {
      const fan = chatId.value === null ? undefined : cache.getQueryData<FansMap>(keys.fansMap(accountId.value))?.[chatId.value];
      if (chatId.value === null || !accountKnown.value) return h('div', { class: 'conversation-empty' }, 'Pick a chat');
      if (fan === undefined) return h('div', { class: 'conversation-empty' }, 'Loading…');
      if (fan === null) return h('div', { class: 'conversation-empty' }, 'Chat not found');
      if (fan.isBlocked) return h('div', { class: 'conversation-empty conversation-blocked' }, 'You blocked this fan');
      return h(MessagesList, { key: `${accountId.value}:${chatId.value}`, accountId: accountId.value, chatId: chatId.value });
    };

    return (): VNode => {
      return h('div', { class: 'chat-view' }, [
        accountKnown.value ? h(ChatsPanel, { accountId: accountId.value, chatId: chatId.value }) : h('aside', { class: 'chats-panel' }, 'Unknown account'),
        h('section', { class: 'conversation-panel' }, [
          chatId.value !== null && accountKnown.value ? h(ConversationHeader, { key: `${accountId.value}:${chatId.value}`, accountId: accountId.value, chatId: chatId.value }) : null,
          conversation(),
          h(ConversationComposers, { accountId: accountId.value, chatId: chatId.value, activeTabId: activeTabId.value, visited: visited.value }),
        ]),
      ]);
    };
  },
});
