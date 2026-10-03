// Routes (metadata.ts «router»): `chat` = /accounts/:accountId/chats/:chatId?,
// `accounts-overview` = /, `sign-in`. A «build» with a renamed chat route
// (?stand-break=router-name) calls it `conversation`.

import { createRouter, createWebHistory, type Router } from 'vue-router';

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
  router.afterEach((to) => {
    record('route', { name: typeof to.name === 'string' ? to.name : null, accountId: to.params['accountId'] ?? null, chatId: to.params['chatId'] ?? null });
  });
  return router;
}
