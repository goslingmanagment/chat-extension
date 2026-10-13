// `app-root`: the page's frame as the live DOM has it (live/dom-skeleton.json,
// S2 Q6 «Element chain»):
//   app-root[ng-version]
//     app-video-element-factory-container, app-theme-controller
//     div.global-wrapper
//       div.site-wrapper > app-nav-bar-top, div.content-wrapper > router-outlet + the routed page
//       app-account-card-overlay, div.alert-wrapper, div.modal-wrapper > div.xdModal
//     app-messaging-overlay (the mini-chat)
// The routed page is a sibling of the `<router-outlet>`: `app-messages-route` under `/messages`, a placeholder
// elsewhere.

import { createLocalBackend, type StandBackend } from './backend';
import type { MessageContainer } from './container';
import { createWorld, type World } from './data';
import { record } from './journal';
import { LiveSession, type LiveOptions, type ServerConfig } from './live';
import { MessagesRoute } from './messages-route';
import { MiniChat } from './mini-chat';
import { ModalService } from './modal';
import { el, host, scope } from './ng';
import { OldExtensionMarks } from './old-extension';
import { FANSLY_STAND_DEFAULT_LATENCY_MS } from './protocol';
import { Router, type Route } from './router';
import { GroupService } from './store';

/** The Angular version the live page declares (`ng-version`, chat-dom-2026-10-13.json). */
export const NG_VERSION = '19.1.2';

export interface StandApp {
  readonly world: World;
  readonly store: GroupService;
  readonly router: Router;
  readonly modals: ModalService;
  readonly miniChat: MiniChat;
  readonly oldMarks: OldExtensionMarks;
  readonly root: HTMLElement;
  /** The page over the fake Fansly (R20 P6b): its XHR backend and its socket; null — the page answers itself. */
  readonly live: LiveSession | null;
  latency: number;
  /**
   * Boots the page: with the fake Fansly — `GET /account/me`, the socket, then the router's first navigation;
   * without — the first navigation at once. `ready` runs after it.
   */
  start(ready?: () => void): void;
  messages(): MessagesRoute | null;
  /** The main chat's container (under `app-messages-conversation-route`), if one stands. */
  mainContainer(): MessageContainer | null;
  /** Takes the app down (DOM tests mount one per test). */
  destroy(): void;
}

export interface StandAppOptions {
  readonly latency?: number;
  /** Replaces the stand's own in-page backend. */
  readonly backend?: (world: World, latency: () => number) => StandBackend;
  /** The fake Fansly (R20 P6b): the page asks it by XHR and a socket instead of answering itself. */
  readonly server?: ServerConfig;
  readonly live?: LiveOptions;
}

export function createStandApp(mount: HTMLElement, options: StandAppOptions = {}): StandApp {
  const world = createWorld();
  const app = { latency: options.latency ?? FANSLY_STAND_DEFAULT_LATENCY_MS };
  const live = options.server === undefined ? null : new LiveSession(options.server, options.live);
  const backend = live?.backend ?? (options.backend ?? createLocalBackend)(world, () => app.latency);
  const store = new GroupService(world.creator, backend);
  live?.attach(store);
  const modals = new ModalService();
  const miniChat = new MiniChat(store, modals);
  const oldMarks = new OldExtensionMarks();
  const s = scope();

  const outlet = el(s, 'router-outlet');
  const content = el(s, 'div', { class: 'content-wrapper' }, [outlet]);
  let messages: MessagesRoute | null = null;
  let other: HTMLElement | null = null;

  const activate = (route: Route): void => {
    if (route.kind === 'messages') {
      other?.remove();
      other = null;
      if (messages === null) {
        messages = new MessagesRoute(store, modals, router, (container) => oldMarks.follow(container));
        outlet.after(messages.host);
        record('route-created', { route: 'app-messages-route' });
      }
      messages.show(route.groupId);
      return;
    }
    if (messages !== null) {
      messages.host.remove();
      messages.destroy();
      messages = null;
    }
    other?.remove();
    const page = scope();
    other = host(page, 'app-home-route');
    other.append(el(page, 'div', { class: 'home-placeholder' }, [`Stand page ${route.path}`]));
    outlet.after(other);
  };
  const router = new Router((route) => activate(route));

  const messagesLink = el(s, 'a', { class: 'nav-bar-item', attrs: { href: '/messages' } }, [el(s, 'i', { class: 'fa-fw fal fa-envelope' }), ' Messages ']);
  const homeLink = el(s, 'a', { class: 'nav-bar-item', attrs: { href: '/home' } }, [el(s, 'i', { class: 'fa-fw fal fa-house' }), ' Home ']);
  router.link(messagesLink, false);
  router.link(homeLink, false);
  const root = mount;
  root.setAttribute('ng-version', NG_VERSION);
  root.append(
    host(s, 'app-video-element-factory-container'),
    host(s, 'app-theme-controller'),
    el(s, 'div', { class: 'global-wrapper' }, [
      el(s, 'div', { class: 'site-wrapper nav-bar-visible' }, [
        el(s, 'app-nav-bar-top', { class: 'app-mobile-hidden' }, [
          el(s, 'div', { class: 'nav-content-wrapper logged-in' }, [el(s, 'div', { class: 'left-side' }, [homeLink]), el(s, 'div', { class: 'right-side' }, [messagesLink])]),
        ]),
        content,
      ]),
      el(s, 'app-account-card-overlay', { class: 'account-card-overlay' }),
      el(s, 'div', { class: 'alert-wrapper' }, [el(s, 'div', { class: 'alert', attrs: { xdalerts: '' } })]),
      modals.wrapper,
    ]),
    miniChat.host,
  );

  return {
    world,
    store,
    router,
    modals,
    miniChat,
    oldMarks,
    root,
    live,
    start: (ready = () => undefined) => {
      if (live === null) {
        router.start();
        ready();
        return;
      }
      live.start(() => {
        // A dead session: no chat, the page stays as it is.
        if (!live.loggedOut) router.start();
        ready();
      });
    },
    get latency() {
      return app.latency;
    },
    set latency(ms: number) {
      app.latency = ms;
    },
    messages: () => messages,
    mainContainer: () => messages?.conversation?.container ?? null,
    destroy: () => {
      live?.destroy();
      router.destroy();
      messages?.destroy();
      messages = null;
      miniChat.destroy();
      oldMarks.set(false);
      root.replaceChildren();
    },
  };
}
