// Routes (metadata.ts «router»): `chat` = /accounts/:accountId/chats/:chatId?,
// `accounts-overview` = /, `sign-in`. A «build» with a renamed chat route
// (?stand-break=router-name) calls it `conversation`. Like ChatSpace's, the
// guard before every navigation is async; tests may stretch it
// (`setRouteDelayMs`), so a chat tab's composer shows before the route follows.

import { createRouter, createWebHistory, type Router } from 'vue-router';

import { env } from './env';
import { record } from './journal';
import { ChatView } from './ui/chat-view';
import { AccountsOverview, SignIn } from './ui/layout';
import { chatRouteName } from './ui/navigation';

export function createStandRouter(): Router {
  const router = createRouter({
    history: createWebHistory(),
    routes: [
      { path: '/', name: 'accounts-overview', component: AccountsOverview },
      { path: '/accounts/:accountId/chats/:chatId?', name: chatRouteName(), component: ChatView },
      { path: '/sign-in', name: 'sign-in', component: SignIn },
      { path: '/:pathMatch(.*)*', redirect: '/' },
    ],
  });
  router.beforeEach(async () => {
    if (env.routeDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, env.routeDelayMs));
  });
  router.afterEach((to) => {
    record('route', { name: typeof to.name === 'string' ? to.name : null, accountId: to.params['accountId'] ?? null, chatId: to.params['chatId'] ?? null });
  });
  return router;
}
