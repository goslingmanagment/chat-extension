// `app-messages-route` (class `nU`, main:73754-74119): the inbox on the left
// and an outlet on the right, kept while the address stays under `/messages`.
// Its child routes are siblings of the `<router-outlet>` in
// `div.messages-content-wrapper`: `app-messages-default-conversation-route`
// for `/messages`, `app-messages-conversation-route` for `/messages/:groupId`
// (the same instance from chat to chat).

import type { MessageContainer } from './container';
import { ConversationRoute } from './conversation';
import { Inbox } from './inbox';
import type { ModalService } from './modal';
import { el, host, scope, setClass, type Scope } from './ng';
import type { Router } from './router';
import type { GroupService } from './store';

export class MessagesRoute {
  readonly host: HTMLElement;
  readonly inbox: Inbox;
  conversation: ConversationRoute | null = null;
  private readonly s: Scope = scope();
  private readonly page: HTMLDivElement;
  private readonly outlet: HTMLElement;
  private empty: HTMLElement | null = null;

  constructor(
    private readonly store: GroupService,
    private readonly modals: ModalService,
    router: Router,
    private readonly onContainer: (container: MessageContainer | null) => void,
  ) {
    const s = this.s;
    this.host = host(s, 'app-messages-route');
    this.inbox = new Inbox(store, router);
    this.outlet = el(s, 'router-outlet');
    this.page = el(s, 'div', { class: 'page-content' }, [el(s, 'div', { class: 'messages-wrapper' }, [this.inbox.root, el(s, 'div', { class: 'messages-content-wrapper' }, [this.outlet])])]);
    this.host.append(this.page);
    this.inbox.start();
  }

  show(groupId: string | null): void {
    setClass(this.page, 'active-group', groupId !== null);
    if (groupId === null) {
      this.conversation?.host.remove();
      this.conversation?.destroy();
      this.conversation = null;
      if (this.empty === null) {
        const s = scope();
        this.empty = host(s, 'app-messages-default-conversation-route');
        this.empty.append(el(s, 'div', { class: 'no-conversation dark-blue-1' }, ['Select a conversation']));
        this.outlet.after(this.empty);
      }
      return;
    }
    this.empty?.remove();
    this.empty = null;
    if (this.conversation === null) {
      this.conversation = new ConversationRoute(this.store, this.modals, { onContainer: this.onContainer });
      this.outlet.after(this.conversation.host);
    }
    if (this.conversation.groupId !== groupId) this.conversation.setGroupId(groupId);
  }

  destroy(): void {
    this.conversation?.destroy();
    this.conversation = null;
    this.inbox.destroy();
  }
}
