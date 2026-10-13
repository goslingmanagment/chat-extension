// The mini-chat (`app-messaging-overlay`, main:59914, :60358, :61744-61745):
// a fixed window at the bottom right, outside the routed content, a direct
// child of `app-root`. Open on a group, `app-messaging-overlay-group` repeats
// the chat header's classes (`.content-header-sub-row` included) and has its
// OWN `app-group-message-container` with its own composer — the same draft
// cache key (the group id) as the main one. Only anchors under
// `app-messages-conversation-route` are the main chat's (fansly-web.md §3).

import { MessageContainer } from './container';
import { handler } from './events';
import { record } from './journal';
import type { ModalService } from './modal';
import { NgIf, el, host, scope, type Scope, type View } from './ng';
import type { GroupService } from './store';

interface OverlayView extends View {
  readonly container: MessageContainer | null;
}

export class MiniChat {
  readonly host: HTMLElement;
  groupId: string | null = null;
  private readonly s: Scope = scope();
  private readonly groupIf: NgIf<OverlayView>;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly store: GroupService,
    private readonly modals: ModalService,
  ) {
    this.host = host(this.s, 'app-messaging-overlay', { class: 'fansly-chat-client-wrapper sm-mobile-hidden' });
    this.groupIf = new NgIf(() => this.createGroup());
    this.host.append(this.groupIf.anchor);
    // A group the page did not have yet: the window opens once `GET /group/<id>/` answered.
    this.unsubscribe = store.onGroupsChange(() => this.refresh());
  }

  get container(): MessageContainer | null {
    return this.groupIf.view?.container ?? null;
  }

  open(groupId: string | null): void {
    if (this.groupId === groupId) return;
    this.groupIf.update(false);
    this.groupId = groupId;
    record('mini-chat', { groupId });
    if (groupId !== null && this.store.getGroup(groupId) === null) this.store.fetchGroup(groupId);
    this.refresh();
  }

  private refresh(): void {
    const group = this.groupId === null ? null : this.store.getGroup(this.groupId);
    const view = this.groupIf.update(group !== null);
    view?.container?.attached();
  }

  private createGroup(): OverlayView {
    const s = this.s;
    const group = this.groupId === null ? null : this.store.getGroup(this.groupId);
    if (group === null) return { nodes: [], container: null };
    this.store.fetchGroupMessages(group.id);
    const partner = group.partners[0];
    const close = el(s, 'i', { class: 'fa-fw fal fa-xmark pointer' });
    close.addEventListener('click', handler(() => this.open(null)));
    const container = new MessageContainer('mini', group, this.store, this.modals);
    const overlay = host(s, 'app-messaging-overlay-group');
    overlay.append(
      el(s, 'div', { class: 'message-content-header border-color' }, [
        el(s, 'div', { class: 'flex-col' }, [
          el(s, 'div', { class: 'flex-row' }, [
            el(s, 'div', { class: 'message-content-header-avatar' }, [el(s, 'app-account-avatar', { class: 'avatar flex-0' })]),
            el(s, 'div', { class: 'message-content-header-contact' }, [
              el(s, 'app-account-username', {}, [el(s, 'span', { class: 'display-name' }, [partner?.displayName ?? ''])]),
              el(s, 'div', { class: 'flex-row flex-align-center content-header-sub-row' }, [el(s, 'div', { class: 'gallery-hot-icon dark-blue-1 font-size-xs' }, [el(s, 'i', { class: 'fa-light fa-images' })])]),
            ]),
          ]),
        ]),
        el(s, 'div', { class: 'flex-1' }),
        close,
      ]),
      container.host,
    );
    return { nodes: [overlay], container, destroy: () => container.destroy() };
  }

  destroy(): void {
    this.unsubscribe();
    this.groupIf.destroy();
  }
}
