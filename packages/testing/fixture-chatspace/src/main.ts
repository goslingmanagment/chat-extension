// Boot of the ChatSpace-like stand page: session token → Vue app with Pinia
// and the router on #app (so `#app.__vue_app__.config.globalProperties` has
// `$pinia` and `$router`) → app-wide queries (accounts and permissions
// awaited, Mimic data not) → socket → test-control API.
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
  const appQueryOptions: QueryOptions<unknown>[] = [accountsQuery(), permissionsQuery(), mimicSettingsQuery(), mimicChatsQuery()];
  const appQueries = appQueryOptions.map((options) => {
    const entry = cache.ensure(options);
    cache.track(entry, appObserver);
    return cache.refresh(entry);
  });
  await Promise.all(appQueries.slice(0, 2));
  useTabEntries().seed((cache.getQueryData<Account[]>(accountsQuery().key) ?? []).map((account) => String(account.id)));
  useAccountsStore();
  useChatTabEntries();
  useChatsStore();
  useChatListStore();

  const navigation = installNavigation(router);
  const control = installControl(navigation);
  socket.connect();
  app.mount('#app');
  await router.isReady();
  if (isBroken('vue-app')) Reflect.deleteProperty(document.querySelector('#app') ?? {}, '__vue_app__');
  control.markReady();
  document.documentElement.dataset['standReady'] = '1';
  record('ready');
}

boot().catch((error: unknown) => {
  record('boot-failed', { message: error instanceof Error ? error.message : String(error) });
  document.documentElement.dataset['standReady'] = 'failed';
});
