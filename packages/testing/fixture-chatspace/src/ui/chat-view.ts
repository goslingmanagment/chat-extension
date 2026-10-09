// The `chat` route: chat list, conversation (header, message list, composers).
// - The chat list observes the key of the list the human picked in its toolbar:
//   ["chatList", acc, all | filter:<f> | list:<id>, search:<q>?, order:old?].
//   Rows are links with data-testid="chat-list-item" and data-chat-id; the
//   fans on screen are polled for presence (fans-online.ts), and a row's
//   green dot is `isFanOnline(chat.id, fan.lastSeen)`, as ChatSpace's is.
// - The conversation observes the ROUTE chat's history whenever the account,
//   the chat and the account's platform id are known — whatever the fan's
//   state, as ChatSpace's conversation panel does: opening a blocked or unknown
//   fan's chat loads its history (and so reads it on the platform). «Not found»
//   comes from that load's error; a blocked fan gets a notice instead of the
//   list. `?firstId=<id>` anchors the history (its own cache entry); the
//   pinned-messages dialog observes the pinned entry while it is open.
// - Opening a chat marks it read in the cache only, once the first load
//   settled without an error.
// - The list keeps the bottom on resize, or the anchor message when scrolled
//   up (metadata.ts «message-list»).
// - Composers: one per visited chat tab of the ROUTE's account (composer.ts).

import { computed, defineComponent, h, nextTick, onBeforeUnmount, onMounted, ref, watch, type PropType, type VNode } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { record } from '../journal';
import { api, HTTPError } from '../net/http';
import { useQueryCache } from '../query/cache';
import type { Account, FansMap, History, Message } from '../query/model';
import {
  ALL_CHATS,
  CHAT_LIST_FILTERS,
  chatListQuery,
  chatMessagesQuery,
  ensureFans,
  ensureFanStats,
  ensureInsights,
  keys,
  loadNextListPage,
  loadOlderHistory,
  pinnedMessagesQuery,
  type ChatListView,
} from '../query/queries';
import { useQuery } from '../query/use-query';
import { useChatTabEntries, useTabEntries } from '../stores/accounts';
import { useChatListStore, useChatMessagesStore, useChatsStore } from '../stores/chats';
import { usePendingMessages, type PendingEntry } from '../stores/pending-messages';
import { ConversationComposers, type ComposerSlot } from './composer';
import { useFansOnline } from './fans-online';
import { useNavigation } from './navigation';
import { registerMessageList } from './registry';
import { ChatDetailsPanel, SidePanelRail, sidePanel } from './side-panel';

const BOTTOM_SLACK_PX = 2;
const LOAD_OLDER_AT_PX = 40;
/** The anchor query parameter of the chat route (a message id). */
export const ANCHOR_PARAM = 'firstId';
const STAND_FAN_LIST = '501';

const fanName = (fans: FansMap | undefined, fanId: string): string => fans?.[fanId]?.name ?? `Fan ${fanId.slice(-4)}`;
const preview = (message: Pick<Message, 'text'> | null): string =>
  message === null
    ? ''
    : message.text
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<[^>]*>/g, '')
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll('&amp;', '&');
const isNotFound = (error: unknown): boolean => error instanceof HTTPError && error.response.status === 404;

const SCOPES: ReadonlyArray<{ readonly value: ChatListView['scope']; readonly label: string }> = [
  { value: 'all', label: 'All chats' },
  ...CHAT_LIST_FILTERS.map((filter) => ({ value: `filter:${filter}` as const, label: `Filter: ${filter}` })),
  { value: `list:${STAND_FAN_LIST}`, label: 'Stand fan list' },
];

const ChatsPanel = defineComponent({
  name: 'ChatsPanel',
  props: { accountId: { type: String, required: true }, chatId: { type: String as PropType<string | null>, default: null } },
  setup(props) {
    const cache = useQueryCache();
    const chats = useChatsStore();
    const nav = useNavigation();
    const view = ref<ChatListView>(ALL_CHATS);
    const list = useQuery(() => chatListQuery(props.accountId, cache, view.value));
    useQuery(() => ({ key: keys.fansMap(props.accountId), staleTime: Number.POSITIVE_INFINITY, query: () => Promise.resolve(cache.getQueryData<FansMap>(keys.fansMap(props.accountId)) ?? {}) }));
    const rows = computed(() => list.data.value?.pages.flatMap((page) => page.items) ?? []);
    const fans = computed(() => cache.getQueryData<FansMap>(keys.fansMap(props.accountId)));
    const listRoot = ref<HTMLElement | null>(null);
    useFansOnline(() => props.accountId, listRoot);
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
    const setView = (patch: Partial<ChatListView>): void => {
      view.value = { ...view.value, ...patch };
      record('chat-list-view', { accountId: props.accountId, ...view.value });
    };

    const toolbar = (): VNode =>
      h('div', { class: 'chats-panel__toolbar', 'data-testid': 'chat-list-toolbar' }, [
        h('input', {
          type: 'search',
          class: 'chats-panel__search',
          placeholder: 'Search chats',
          'data-testid': 'chats-panel-search-input',
          value: view.value.search,
          onChange: (event: Event) => setView({ search: (event.target as HTMLInputElement).value.trim() }),
        }),
        h(
          'select',
          { class: 'chats-panel__scope', 'data-stand-chat-scope': '', onChange: (event: Event) => setView({ scope: (event.target as HTMLSelectElement).value as ChatListView['scope'] }) },
          SCOPES.map((scope) => h('option', { value: scope.value, selected: scope.value === view.value.scope }, scope.label)),
        ),
        h(
          'button',
          { type: 'button', class: 'chip', 'data-stand-chat-order': view.value.order, onClick: () => setView({ order: view.value.order === 'old' ? 'recent' : 'old' }) },
          view.value.order === 'old' ? 'Oldest first' : 'Newest first',
        ),
      ]);

    return (): VNode => {
      const hasMore = list.data.value?.pages.at(-1)?.hasMore === true;
      return h('aside', { class: 'chats-panel', 'data-testid': 'chats-panel' }, [
        h('div', { class: 'chats-panel__title' }, list.loading.value && rows.value.length === 0 ? 'Loading chats…' : 'Chats'),
        toolbar(),
        h(
          'nav',
          { class: 'chats-panel__list', ref: listRoot },
          rows.value.map((chat) => {
            const href = `/accounts/${props.accountId}/chats/${chat.id}`;
            const online = chats.isFanOnline(chat.id, fans.value?.[chat.id]?.lastSeen ?? null);
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
        hasMore ? h('button', { type: 'button', class: 'chip chats-panel__more', onClick: () => void loadNextListPage(cache, props.accountId, view.value) }, 'Load more') : null,
      ]);
    };
  },
});

const MessagesList = defineComponent({
  name: 'MessagesList',
  props: {
    accountId: { type: String, required: true },
    chatId: { type: String, required: true },
    anchor: { type: String as PropType<string | null>, default: null },
  },
  setup(props) {
    const cache = useQueryCache();
    const pending = usePendingMessages();
    const key = computed(() => keys.chatMessages(props.accountId, props.chatId, props.anchor));
    const history = computed(() => cache.getQueryData<History>(key.value));
    const loading = computed(() => cache.get(key.value)?.asyncStatus.value === 'loading');
    const scroller = ref<HTMLElement | null>(null);
    const content = ref<HTMLElement | null>(null);
    // Geometry as of the last real scroll (or our own adjustment): a resize is judged against it,
    // never against a scroll event fired by the resize itself.
    let last = { scrollTop: 0, scrollHeight: 0, clientHeight: 0, anchorId: null as string | null, anchorOffset: 0 };
    let loadingOlder = false;

    const messages = computed(() => [...(history.value?.pages.flatMap((page) => page.items) ?? [])].reverse());
    const queued = computed<PendingEntry[]>(() => (pending.messagesByAccountId[props.accountId] ?? []).filter((entry) => entry.chatId === props.chatId && entry.status !== 'confirmed'));

    const snapshot = (element: HTMLElement): void => {
      const first = [...element.querySelectorAll<HTMLElement>('[data-stand-message-id]')].find((node) => node.offsetTop + node.offsetHeight > element.scrollTop);
      last = {
        scrollTop: element.scrollTop,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
        anchorId: first?.dataset['standMessageId'] ?? null,
        anchorOffset: first === undefined ? 0 : first.offsetTop - element.scrollTop,
      };
    };
    const wasAtBottom = (): boolean => last.scrollHeight - last.scrollTop - last.clientHeight <= BOTTOM_SLACK_PX;
    const keepPosition = (): void => {
      const element = scroller.value;
      if (element === null) return;
      if (wasAtBottom()) {
        element.scrollTop = element.scrollHeight;
      } else {
        const anchor = last.anchorId === null ? null : element.querySelector<HTMLElement>(`[data-stand-message-id="${last.anchorId}"]`);
        if (anchor !== null) element.scrollTop = anchor.offsetTop - last.anchorOffset;
      }
      snapshot(element);
    };
    const onScroll = (): void => {
      const element = scroller.value;
      // Only a moved scroll position is a scroll; a resize alone keeps the old judgement.
      if (element === null || Math.abs(element.scrollTop - last.scrollTop) < 0.5) return;
      snapshot(element);
      const oldest = history.value?.pages.at(-1);
      if (element.scrollTop < LOAD_OLDER_AT_PX && oldest?.hasMore === true && !loadingOlder) {
        loadingOlder = true;
        void loadOlderHistory(cache, props.accountId, props.chatId, props.anchor).finally(() => {
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

    return (): VNode =>
      h('div', { ref: scroller, class: 'messages-scroll', 'data-stand-message-list': '', onScroll }, [
        h('div', { ref: content, class: 'messages' }, [
          loading.value && messages.value.length === 0 ? h('p', { class: 'messages__state' }, 'Loading messages…') : null,
          ...messages.value.map((message) =>
            h('div', { key: message.id, class: ['message', message.isOutgoing ? 'message--out' : 'message--in'], 'data-stand-message-id': message.id }, [h('span', { class: 'message__text' }, preview(message))]),
          ),
          ...queued.value.map((entry) =>
            h('div', { key: entry.id, class: ['message', 'message--out', 'message--pending', `message--${entry.status}`], 'data-stand-pending-id': entry.id }, [
              h('span', { class: 'message__text' }, preview({ text: entry.payload.text })),
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

/** Pinned messages of the open chat, loaded only while the dialog is open. */
const PinnedDialog = defineComponent({
  name: 'PinnedMessagesDialog',
  props: { accountId: { type: String, required: true }, chatId: { type: String, required: true }, onClose: { type: Function as PropType<() => void>, required: true } },
  setup(props) {
    const cache = useQueryCache();
    const pinned = useQuery(() => pinnedMessagesQuery(props.accountId, props.chatId, cache));
    const items = computed(() => pinned.data.value?.pages.flatMap((page) => page.items) ?? []);
    const onKeydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') props.onClose();
    };
    onMounted(() => document.addEventListener('keydown', onKeydown));
    onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown));
    return (): VNode =>
      h('div', { class: 'pinned-dialog', role: 'dialog', 'aria-label': 'Pinned messages', 'data-stand-pinned-dialog': '' }, [
        h('div', { class: 'pinned-dialog__title' }, [h('strong', 'Pinned messages'), h('button', { type: 'button', class: 'chip', onClick: () => props.onClose() }, 'Close')]),
        pinned.loading.value && items.value.length === 0 ? h('p', { class: 'messages__state' }, 'Loading…') : null,
        ...items.value.map((message) => h('div', { key: message.id, class: 'message' }, [h('span', { class: 'message__text' }, preview(message))])),
      ]);
  },
});

const ConversationHeader = defineComponent({
  name: 'ConversationHeader',
  props: {
    accountId: { type: String, required: true },
    chatId: { type: String, required: true },
    onOpenPinned: { type: Function as PropType<() => void>, required: true },
  },
  setup(props) {
    const cache = useQueryCache();
    const chats = useChatsStore();
    const fan = computed(() => cache.getQueryData<FansMap>(keys.fansMap(props.accountId))?.[props.chatId] ?? null);
    return (): VNode => {
      const online = chats.isFanOnline(props.chatId, fan.value?.lastSeen ?? null);
      const typing = chats.isFanTyping(props.accountId, props.chatId);
      const name = fanName(cache.getQueryData<FansMap>(keys.fansMap(props.accountId)), props.chatId);
      return h('header', { class: 'conversation-header', 'data-stand-conversation-header': '' }, [
        h('span', { class: ['avatar', online ? 'avatar--online' : ''] }, name.slice(4, 5)),
        h('div', { class: 'conversation-header__text' }, [h('strong', name), h('span', { class: 'conversation-header__status' }, typing ? 'typing…' : online ? 'online' : 'offline')]),
        h('button', { type: 'button', class: 'chip', 'data-testid': 'conversation-header-pinned-messages-button', onClick: () => props.onOpenPinned() }, 'Pinned'),
        fan.value !== null ? h('button', { type: 'button', class: 'chip', 'data-stand-block-button': '', onClick: () => void setBlocked(cache, props.accountId, props.chatId, !fan.value?.isBlocked).catch(() => undefined) }, fan.value.isBlocked ? 'Unblock' : 'Block') : null,
      ]);
    };
  },
});

async function setBlocked(cache: ReturnType<typeof useQueryCache>, accountId: string, chatId: string, blocked: boolean): Promise<void> {
  const path = `api/v0/accounts/${accountId}/platforms/onlyfans/users/${chatId}/block`;
  await (blocked ? api.post(path) : api.delete(path));
  cache.setQueryData<FansMap>(keys.fansMap(accountId), (previous) => {
    const current = previous?.[chatId];
    return current ? { ...previous, [chatId]: { ...current, isBlocked: blocked } } : (previous ?? {});
  });
}

export const ChatView = defineComponent({
  name: 'ChatView',
  setup() {
    const route = useRoute();
    const router = useRouter();
    const cache = useQueryCache();
    const accountTabs = useTabEntries();
    const chatTabs = useChatTabEntries();
    const chatList = useChatListStore();
    useChatMessagesStore();
    const accountId = computed(() => (typeof route.params['accountId'] === 'string' ? route.params['accountId'] : ''));
    const chatId = computed(() => (typeof route.params['chatId'] === 'string' && route.params['chatId'] !== '' ? route.params['chatId'] : null));
    const anchor = computed(() => {
      const raw = route.query[ANCHOR_PARAM];
      const value = Array.isArray(raw) ? raw[0] : raw;
      return typeof value === 'string' && /^\d+$/.test(value) ? value : null;
    });
    const account = computed(() => (cache.getQueryData<Account[]>(keys.accounts()) ?? []).find((item) => String(item.id) === accountId.value));
    const accountKnown = computed(() => account.value !== undefined);

    // Route → tabs.
    watch(
      () => [accountId.value, chatId.value] as const,
      ([acc, chat]) => {
        if (acc === '') return;
        accountTabs.openAccount(acc);
        chatTabs.ensureAccount(acc);
        chatTabs.syncActiveEntryWithChat(acc, chat);
        if (chat !== null) {
          void ensureFans(cache, acc, [chat]).catch(() => undefined);
          void ensureInsights(cache, acc, chat).catch(() => undefined);
        }
      },
      { immediate: true },
    );

    // Every chat tab ever active keeps a composer — those of the route's account are rendered.
    const activeTabId = computed(() => chatTabs.stateByAccountId[accountId.value]?.activeEntryId ?? null);
    const visitedTabIds = ref(new Set<string>());
    watch(
      activeTabId,
      (tab) => {
        if (tab !== null && !visitedTabIds.value.has(tab)) visitedTabIds.value = new Set([...visitedTabIds.value, tab]);
      },
      { immediate: true },
    );
    const slots = computed<ComposerSlot[]>(() =>
      (chatTabs.stateByAccountId[accountId.value]?.entries ?? []).flatMap((entry) =>
        entry.chatId !== null && visitedTabIds.value.has(entry.id) ? [{ key: `${entry.id}:${accountId.value}:${entry.chatId}`, tabId: entry.id, accountId: accountId.value, chatId: entry.chatId }] : [],
      ),
    );

    // The route chat's history, whatever its fan.
    const history = useQuery(() => {
      const platformAccountId = account.value?.platformAccountId;
      return chatId.value !== null && platformAccountId !== undefined && platformAccountId !== '' ? chatMessagesQuery(accountId.value, chatId.value, cache, anchor.value) : null;
    });
    const historyState = computed(() => history.entry.value?.state.value);
    const isError = computed(() => historyState.value?.status === 'error');
    const notFound = computed(() => isError.value && isNotFound(historyState.value?.error));
    const initialFetchFinished = computed(() => historyState.value !== undefined && historyState.value.status !== 'pending');
    watch(
      () => [chatId.value, accountId.value, initialFetchFinished.value, isError.value] as const,
      ([chat, acc, finished, error]) => {
        if (chat !== null && acc !== '' && finished && !error) chatList.markChatAsRead(acc, chat);
      },
      { immediate: true },
    );

    const pinnedOpen = ref(false);
    watch([accountId, chatId], () => {
      pinnedOpen.value = false;
    });
    const fan = computed(() => (chatId.value === null ? undefined : cache.getQueryData<FansMap>(keys.fansMap(accountId.value))?.[chatId.value]));

    /** Leaves the anchored history: back to the latest messages; the anchored entry is dropped. */
    const exitAnchor = async (): Promise<void> => {
      const left = anchor.value;
      const chat = chatId.value;
      const query = { ...route.query };
      delete query[ANCHOR_PARAM];
      await router.replace({ query });
      if (left === null || chat === null) return;
      for (const entry of cache.getEntries({ key: keys.chatMessages(accountId.value, chat, left), exact: true })) {
        cache.cancel(entry);
        cache.remove(entry);
      }
    };

    const conversation = (): VNode | VNode[] => {
      const chat = chatId.value;
      if (chat === null || !accountKnown.value) return h('div', { class: 'conversation-empty' }, 'Pick a chat');
      const body = notFound.value
        ? h('div', { class: 'conversation-empty', 'data-stand-chat-not-found': '' }, 'Chat not found')
        : fan.value?.isBlocked === true
          ? h('div', { class: 'conversation-empty conversation-blocked', 'data-stand-fan-blocked': '' }, [
              h('span', 'You blocked this fan'),
              h('button', { type: 'button', class: 'chip', onClick: () => void setBlocked(cache, accountId.value, chat, false).catch(() => undefined) }, 'Unblock'),
            ])
          : h(MessagesList, { key: `${accountId.value}:${chat}:${anchor.value ?? ''}`, accountId: accountId.value, chatId: chat, anchor: anchor.value });
      return [
        h(ConversationHeader, { key: `${accountId.value}:${chat}`, accountId: accountId.value, chatId: chat, onOpenPinned: () => (pinnedOpen.value = true) }),
        anchor.value !== null ? h('button', { type: 'button', class: 'chip conversation-anchor', 'data-stand-exit-anchor': '', onClick: () => void exitAnchor() }, 'Jump to latest') : null,
        body,
        pinnedOpen.value ? h(PinnedDialog, { key: `pinned:${accountId.value}:${chat}`, accountId: accountId.value, chatId: chat, onClose: () => (pinnedOpen.value = false) }) : null,
      ].filter((node): node is VNode => node !== null);
    };

    return (): VNode =>
      h('div', { class: 'chat-view' }, [
        accountKnown.value ? h(ChatsPanel, { key: accountId.value, accountId: accountId.value, chatId: chatId.value }) : h('aside', { class: 'chats-panel' }, 'Unknown account'),
        h('section', { class: 'conversation-panel' }, [
          conversation(),
          h(ConversationComposers, { slots: slots.value, activeTabId: activeTabId.value, hideActive: notFound.value || fan.value?.isBlocked === true }),
        ]),
        // ChatSpace 0.195: the fan's own panel next to an open chat, and the icon rail at the far right (side-panel.ts).
        sidePanel.state === 'open' && chatId.value !== null ? h(ChatDetailsPanel) : null,
        sidePanel.state === 'none' ? null : h(SidePanelRail),
      ]);
  },
});
