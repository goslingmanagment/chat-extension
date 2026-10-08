// Boot of the ChatSpace-like stand page: session token → Vue app with Pinia
// and the router on #app (so `#app.__vue_app__.config.globalProperties` has
// `$pinia` and `$router`) → app-wide queries (accounts and permissions
// awaited, Mimic data not) → socket → test-control API. A slow start
// (?stand-slow-start=<ms>) mounts the app first and loads that data later, as
// ChatSpace 0.195 does.
// Everything this page shows is synthetic (packages/testing/src/stand/dataset.ts).

import './styles.css';

import { createPinia } from 'pinia';
import { createApp, h } from 'vue';

import { installControl } from './control';
import { env, isBroken } from './env';
import { record } from './journal';
import { getToken } from './net/auth';
import { socket } from './net/socket';
import { useQueryCache, type QueryOptions } from './query/cache';
import type { Account } from './query/model';
import { accountsQuery, mimicChatsQuery, mimicSettingsQuery, permissionsQuery } from './query/queries';
import { createStandRouter } from './router';
import { useAccountsStore, useChatTabEntries, useTabEntries } from './stores/accounts';
import { useChatListStore, useChatsStore } from './stores/chats';
import { MainLayout } from './ui/layout';
import { installNavigation } from './ui/navigation';
import { installSidePanel } from './ui/side-panel';
import { installTheme } from './ui/theme';

async function boot(): Promise<void> {
  installTheme();
  installSidePanel();
  record('boot', { breaks: env.breaks });
  await getToken();

  const pinia = createPinia();
  const router = createStandRouter();
  const app = createApp({ name: 'App', setup: () => () => h(MainLayout) });
  app.use(pinia);
  app.use(router);

  // App-wide queries stay observed (active) for the whole session. The page
  // waits for accounts and permissions only: Mimic data may arrive later, and
  // until it does, composers stay unrendered (ui/composer.ts).
  const cache = useQueryCache();
  const appObserver = {};
  const load = (options: QueryOptions<unknown>): Promise<unknown> => {
    const entry = cache.ensure(options);
    cache.track(entry, appObserver);
    return cache.refresh(entry);
  };
  const loadAccounts = async (): Promise<void> => {
    await Promise.all([load(accountsQuery()), load(permissionsQuery())]);
    useTabEntries().seed((cache.getQueryData<Account[]>(accountsQuery().key) ?? []).map((account) => String(account.id)));
  };

  if (env.slowStartMs > 0) {
    // A slow start (?stand-slow-start): as ChatSpace 0.195, the app and the open chat's composer are on the page
    // first and the accounts and permissions come later — an extension that starts with the composer reads empty
    // stores for a moment.
    void load(mimicSettingsQuery());
    void load(mimicChatsQuery());
    useAccountsStore();
    useChatTabEntries();
    useChatsStore();
    useChatListStore();
    const navigation = installNavigation(router);
    const control = installControl(navigation);
    socket.connect();
    app.mount('#app');
    await router.isReady();
    await new Promise((resolve) => setTimeout(resolve, env.slowStartMs));
    await loadAccounts();
    finish(control);
    return;
  }

  const accounts = loadAccounts();
  void load(mimicSettingsQuery());
  void load(mimicChatsQuery());
  await accounts;
  useAccountsStore();
  useChatTabEntries();
  useChatsStore();
  useChatListStore();

  const navigation = installNavigation(router);
  const control = installControl(navigation);
  socket.connect();
  app.mount('#app');
  await router.isReady();
  finish(control);
}

function finish(control: { readonly markReady: () => void }): void {
  if (isBroken('vue-app')) Reflect.deleteProperty(document.querySelector('#app') ?? {}, '__vue_app__');
  control.markReady();
  document.documentElement.dataset['standReady'] = '1';
  record('ready');
}

boot().catch((error: unknown) => {
  record('boot-failed', { message: error instanceof Error ? error.message : String(error) });
  document.documentElement.dataset['standReady'] = 'failed';
});
