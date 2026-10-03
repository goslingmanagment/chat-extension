// Layout of the stand: account tabs on the left, chat tabs on top (both full
// width), the route below in the content frame — the one box «fixed width»
// narrows and aligns (`--app-content-max-width`, `--app-content-align`), as on
// the host. The global hotkeys are registered when the layout mounts.

import { defineComponent, h, onBeforeUnmount, onMounted, type VNode } from 'vue';
import { RouterView } from 'vue-router';

import { useQueryCache } from '../query/cache';
import type { Account, FansMap } from '../query/model';
import { keys } from '../query/queries';
import { useChatTabEntries, useTabEntries } from '../stores/accounts';
import { installGlobalHotkeys } from './hotkeys';
import { useNavigation } from './navigation';

const initials = (name: string): string =>
  name
    .split(' ')
    .map((part) => part[0] ?? '')
    .join('')
    .slice(-2)
    .toUpperCase();

const AccountTabSideBar = defineComponent({
  name: 'AccountTabSideBar',
  setup() {
    const cache = useQueryCache();
    const tabs = useTabEntries();
    const nav = useNavigation();
    return (): VNode => {
      const accounts = cache.getQueryData<Account[]>(keys.accounts()) ?? [];
      const current = nav.currentAccountId();
      return h(
        'aside',
        { class: 'account-sidebar', 'aria-label': 'Accounts' },
        tabs.openedEntries.map((entry) => {
          const account = accounts.find((item) => String(item.id) === entry.accountId);
          return h(
            'button',
            {
              key: entry.id,
              type: 'button',
              class: ['account-tab', entry.accountId === current ? 'account-tab--active' : ''],
              title: account?.name ?? 'Account',
              onClick: () => entry.accountId !== null && void nav.openAccount(entry.accountId),
            },
            initials(account?.name ?? '?'),
          );
        }),
      );
    };
  },
});

const ChatTabBar = defineComponent({
  name: 'ChatTabBar',
  setup() {
    const cache = useQueryCache();
    const chatTabs = useChatTabEntries();
    const nav = useNavigation();
    return (): VNode => {
      const accountId = nav.currentAccountId();
      const state = accountId === null ? undefined : chatTabs.stateByAccountId[accountId];
      const fans = accountId === null ? undefined : cache.getQueryData<FansMap>(keys.fansMap(accountId));
      return h('div', { class: 'chat-tab-bar' }, [
        ...(state?.entries ?? []).map((entry) => {
          const count = entry.chatId === null ? 0 : (state?.newMessagesByChatId[entry.chatId] ?? 0);
          const label = entry.chatId === null ? 'New tab' : (fans?.[entry.chatId]?.name ?? `Fan ${entry.chatId.slice(-4)}`);
          return h('div', { key: entry.id, class: ['chat-tab', entry.id === state?.activeEntryId ? 'chat-tab--active' : ''], 'data-chat-tab': entry.chatId ?? '' }, [
            h('button', { type: 'button', class: 'chat-tab__label', onClick: () => accountId !== null && void nav.activateChatTab(accountId, entry.id) }, label),
            count > 0 ? h('span', { class: 'badge' }, String(count)) : null,
            h('button', { type: 'button', class: 'chat-tab__close', 'aria-label': 'Close tab', onClick: () => accountId !== null && void nav.closeChatTab(accountId, entry.id, 'button') }, '×'),
          ]);
        }),
        accountId !== null ? h('button', { type: 'button', class: 'chat-tab chat-tab__new', 'aria-label': 'New tab', onClick: () => void nav.newChatTab(accountId) }, '+') : null,
      ]);
    };
  },
});

export const MainLayout = defineComponent({
  name: 'MainLayout',
  setup() {
    const nav = useNavigation();
    let uninstall: (() => void) | null = null;
    onMounted(() => {
      uninstall = installGlobalHotkeys({
        closeActiveChatTab: (via) => void nav.closeActiveChatTab(via),
        switchChatTab: (step) => void nav.switchChatTab(step),
      });
    });
    onBeforeUnmount(() => uninstall?.());
    return (): VNode =>
      h('main', { class: 'main-layout' }, [
        h(AccountTabSideBar),
        h('div', { class: 'app-column' }, [h(ChatTabBar), h('div', { class: 'content-frame', 'data-stand-content-frame': '' }, [h(RouterView)])]),
      ]);
  },
});

export const AccountsOverview = defineComponent({
  name: 'AccountsOverview',
  setup() {
    const cache = useQueryCache();
    const nav = useNavigation();
    return (): VNode =>
      h('div', { class: 'overview' }, [
        h('h1', 'Accounts'),
        ...(cache.getQueryData<Account[]>(keys.accounts()) ?? []).map((account) =>
          h('button', { key: account.id, type: 'button', class: 'chip overview__account', onClick: () => void nav.openAccount(String(account.id)) }, `${account.name} (@${account.username})`),
        ),
      ]);
  },
});

export const SignIn = defineComponent({
  name: 'SignInView',
  setup: () => (): VNode => h('div', { class: 'overview' }, [h('h1', 'Signed out'), h('p', 'The stand session ended (a 401 without a fresh token).')]),
});
