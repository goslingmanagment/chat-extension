// `app-messages-conversation-route` — one open chat (class `zU`,
// main:74543-74724). Reused from chat to chat: only its `groupId` parameter
// changes (shouldReuseRoute, main:117193-117206). Its template (main:74724):
//   <!--ngIf false: the mobile header-->
//   div.message-content-header       *ngIf="!galleryAccountId"
//   app-group-message-container      *ngIf="!galleryAccountId && group"
//   gallery header + media           *ngIf="galleryAccountId && one partner"
// On a new `groupId` (main:74562-74566) the route drops its group and renders at once — the container and composer
// die, and so do the header's avatar and contact block, which stand only while the group has exactly one partner
// (main:74512); the header's own root survives. Then, with the group in the cache (same task) or after
// `GET /group/<id>/` answers, the contact block, the avatar and a NEW container with a NEW composer are made
// (main:74559-74561). The gallery (`setGalleryAccount`) swaps the header and the container for its own header and
// media without an address change (main:74527-74541, :74556-74558).

import { MessageContainer } from './container';
import type { Account } from './data';
import { handler } from './events';
import { record } from './journal';
import type { ModalService } from './modal';
import { NgIf, anchor, el, host, scope, setAttr, setText, type Scope, type View } from './ng';
import type { Group, GroupService } from './store';
import { picture } from './world';

/**
 * Fansly's chat header (`app-account-username`, maxLength 10, its `getDisplayName`): the creator's custom name for the
 * fan first, else the display name, cut at 10 characters: «Stand Fan ...».
 */
const HEADER_NAME_MAX = 10;
const headerName = (account: Account | undefined): string => {
  const name = account?.customName ?? account?.displayName ?? '';
  return name.length > HEADER_NAME_MAX ? `${name.substring(0, HEADER_NAME_MAX)}...` : name;
};

const STATUS_TEXT: Readonly<Record<1 | 2 | 3, string>> = { 1: 'Active now', 2: 'Away', 3: 'Offline' };

interface HeaderView extends View {
  refresh(): void;
}

interface ContactView extends View {
  readonly statusIf: NgIf<View & { readonly text: HTMLElement }>;
  readonly dividerIf: NgIf<View>;
  readonly link: HTMLAnchorElement;
  readonly displayName: HTMLElement;
  readonly userName: HTMLElement;
}

export interface ConversationHooks {
  /** After every render that made a new container (the old extension's root follows the main composer). */
  readonly onContainer: (container: MessageContainer | null) => void;
}

export class ConversationRoute {
  readonly host: HTMLElement;
  groupId = '';
  group: Group | null = null;
  galleryAccountId = '';
  loading = false;
  private readonly s: Scope = scope();
  private readonly headerIf: NgIf<HeaderView>;
  private readonly containerIf: NgIf<MessageContainer>;
  private readonly galleryIf: NgIf<View>;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly store: GroupService,
    private readonly modals: ModalService,
    private readonly hooks: ConversationHooks,
  ) {
    this.host = host(this.s, 'app-messages-conversation-route');
    this.headerIf = new NgIf(() => this.createHeader());
    this.containerIf = new NgIf(() => new MessageContainer('main', this.group as Group, this.store, this.modals));
    this.galleryIf = new NgIf(() => this.createGallery());
    this.host.append(anchor(), this.headerIf.anchor, this.containerIf.anchor, this.galleryIf.anchor);
    this.unsubscribe = store.onGroupsChange(() => this.onGroupsChange());
  }

  get container(): MessageContainer | null {
    return this.containerIf.view;
  }

  private partners(): readonly Account[] {
    return this.group?.partners ?? [];
  }

  /** `paramMap`: a new chat. */
  setGroupId(groupId: string): void {
    this.galleryAccountId = '';
    this.group = null;
    this.loading = true;
    this.groupId = groupId;
    record('route-group', { groupId });
    this.store.fetchGroup(groupId);
    this.refreshUi();
    this.onGroupsChange();
  }

  /**
   * The group arrived (cache or `GET /group/<id>/`): set it, ask for its latest messages, mark it read. Any other
   * change of the groups only re-renders — a new partner count re-creates the contact block, nothing else.
   */
  private onGroupsChange(): void {
    if (this.groupId === '') return;
    if (this.group === null || this.group.id !== this.groupId) {
      this.group = this.store.getGroup(this.groupId);
      this.loading = this.group === null;
      if (this.group !== null) {
        this.store.fetchGroupMessages(this.group.id);
        this.store.setActiveGroup(this.group);
      }
    }
    this.refreshUi();
  }

  setGalleryAccount(accountId: string): void {
    this.galleryAccountId = accountId;
    record('gallery', { open: accountId !== '', groupId: this.groupId });
    this.refreshUi();
  }

  refreshUi(): void {
    const gallery = this.galleryAccountId !== '';
    const header = this.headerIf.update(!gallery);
    header?.refresh();
    const had = this.containerIf.view;
    const container = this.containerIf.update(!gallery && this.group !== null);
    if (container !== null && container !== had) {
      record('container-created', { groupId: container.group.id, composer: container.composer?.instance ?? null });
      container.attached();
    }
    if (container !== had) this.hooks.onContainer(container);
    this.galleryIf.update(gallery && this.partners().length === 1);
  }

  private createHeader(): HeaderView {
    const s = this.s;
    const back = el(s, 'div', { class: 'back-button' }, [el(s, 'i', { class: 'fa-fw fal fa-arrow-left' })]);
    back.addEventListener('click', handler(() => history.back()));
    const avatarIf = new NgIf<View>(() => ({
      nodes: [el(s, 'div', { class: 'message-content-header-avatar' }, [picture(el(s, 'app-account-avatar', { class: 'avatar flex-0' }, [el(s, 'div', { class: 'avatar default-avatar' })]), this.partners()[0])])],
    }));
    const contactIf = new NgIf(() => this.createContact());
    const notes = el(s, 'div', { class: 'dropdown-item' }, [el(s, 'i', { class: 'fa-fw fal fa-note-sticky hover-effect' }), el(s, 'xd-localization-string', {}, ['Notes / Custom Name '])]);
    const root = el(s, 'div', { class: 'message-content-header border-color' }, [
      el(s, 'div', { class: 'flex-col' }, [el(s, 'div', { class: 'flex-row' }, [back, avatarIf.anchor, contactIf.anchor])]),
      el(s, 'div', { class: 'flex-1' }),
      el(s, 'div', { class: 'flex-row' }, [
        el(s, 'div', { class: 'feed-item-actions dropdown-trigger more-dropdown', attrs: { appxddropdown: '' } }, [
          el(s, 'div', { class: 'navigation-icon custom-hover-effect' }, [el(s, 'i', { class: 'fa-fw fas fa-circle' }), el(s, 'i', { class: 'fa-fw fas fa-circle' }), el(s, 'i', { class: 'fa-fw fas fa-circle' })]),
          el(s, 'div', { class: 'dropdown-list' }, [notes]),
        ]),
      ]),
    ]);
    return {
      nodes: [root],
      refresh: () => {
        const one = this.partners().length === 1;
        avatarIf.update(one);
        // The showcase world's picture, once the partner's account is known (it may come after the header stood).
        const avatar = root.querySelector<HTMLElement>('.message-content-header-avatar app-account-avatar');
        if (avatar !== null) picture(avatar, this.partners()[0]);
        const contact = contactIf.update(one);
        if (contact !== null) this.refreshContact(contact);
      },
      destroy: () => {
        avatarIf.destroy();
        contactIf.destroy();
      },
    };
  }

  private createContact(): ContactView {
    const s = this.s;
    const partner = this.partners()[0];
    const statusIf = new NgIf(() => {
      const text = el(s, 'div', { class: 'active-status font-size-xs dark-blue-1' });
      return { nodes: [text], text };
    });
    const dividerIf = new NgIf<View>(() => ({ nodes: [el(s, 'div', { class: 'divider font-size-xs' }, [' | '])] }));
    const gallery = el(s, 'div', { class: 'gallery-hot-icon dark-blue-1 font-size-xs blue-1-hover-only pointer' }, [el(s, 'i', { class: 'fa-light fa-images' }), ' Gallery ']);
    gallery.addEventListener(
      'click',
      handler(() => this.setGalleryAccount(this.partners()[0]?.id ?? '')),
    );
    const displayName = el(s, 'span', { class: 'display-name' }, [headerName(partner)]);
    const userName = el(s, 'span', { class: 'user-name' }, [`@${partner?.username ?? ''}`]);
    const link = el(s, 'a', { class: 'username-wrapper', attrs: { href: `/${partner?.username ?? ''}` } }, [el(s, 'div', { class: 'icon-wrapper flex-row flex-align-center' }, [displayName]), userName]);
    const contact = el(s, 'div', { class: 'message-content-header-contact' }, [
      el(s, 'app-account-username', {}, [link]),
      el(s, 'div', { class: 'flex-row flex-align-center content-header-sub-row' }, [statusIf.anchor, dividerIf.anchor, gallery]),
    ]);
    return {
      nodes: [contact],
      statusIf,
      dividerIf,
      link,
      displayName,
      userName,
      destroy: () => {
        statusIf.destroy();
        dividerIf.destroy();
      },
    };
  }

  /**
   * The sub-row's status line: shown unless hidden (4), with a divider when online or away. The partner's names are
   * bound too: an account the page did not have yet fills them in when it arrives (the account cache, main:24675-24681).
   */
  private refreshContact(contact: ContactView): void {
    const partner = this.partners()[0];
    setText(contact.displayName, headerName(partner));
    setText(contact.userName, `@${partner?.username ?? ''}`);
    setAttr(contact.link, 'href', `/${partner?.username ?? ''}`);
    const status = this.group?.status ?? 4;
    const line = contact.statusIf.update(status !== 4);
    if (line !== null && status !== 4) setText(line.text, STATUS_TEXT[status]);
    contact.dividerIf.update(status === 1 || status === 2);
  }

  private createGallery(): View {
    const s = this.s;
    const partner = this.partners()[0];
    const back = el(s, 'div', { class: 'back-button-always' }, [el(s, 'i', { class: 'fa-fw fal fa-arrow-left' })]);
    back.addEventListener('click', handler(() => this.setGalleryAccount('')));
    return {
      nodes: [
        el(s, 'div', { class: 'message-content-header border-color' }, [
          el(s, 'div', { class: 'flex-col' }, [
            el(s, 'div', { class: 'flex-row flex-align-center' }, [
              back,
              el(s, 'div', { class: 'flex-col' }, [
                el(s, 'div', { class: 'bold' }, [' Gallery ']),
                el(s, 'div', { class: 'flex-row font-size-sm gallery-sub-title' }, [' With ', el(s, 'app-account-username', { class: 'margin-left-text' }, [`@${partner?.username ?? ''}`])]),
              ]),
            ]),
          ]),
        ]),
        el(s, 'app-group-media-offers', { class: 'media-content' }, [el(s, 'div', { class: 'media-offers-empty' }, ['No media yet'])]),
        // The ng-container's own comment.
        anchor(),
      ],
    };
  }

  destroy(): void {
    this.unsubscribe();
    this.galleryIf.destroy();
    this.containerIf.destroy();
    this.headerIf.destroy();
    this.hooks.onContainer(null);
    this.store.setActiveGroup(null);
  }
}
