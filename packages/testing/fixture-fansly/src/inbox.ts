// The inbox (`div.messages-list-wrapper`, main:73686-73690, :73822-73868):
// a virtual list. Groups load 20 at a time (`GET /messaging/groups`), more
// when the list is scrolled near its bottom (xdScrollWatcher, 350 px; the
// same offset is not asked again within 10 s). Only the rows within 1.5
// heights of the list around the view are in the DOM, 73 px each, between two
// spacers; the set is recomputed when the list moved more than its own
// height. A row is `<a href="/messages/<groupId>" routerLinkActive="selected">`.

import { record } from './journal';
import { NgFor, el, scope, setClass, setStyle, setText, type Scope, type View } from './ng';
import type { InboxView } from './protocol';
import type { Router } from './router';
import { watchScroll } from './scroll';
import type { GroupService } from './store';
import { clock, picture } from './world';

export const INBOX_ROW_PX = 73;
export const INBOX_PAGE = 20;
const REFETCH_GUARD_MS = 10_000;

interface RowView extends View {
  readonly link: HTMLAnchorElement;
  refresh(): void;
}

export class Inbox {
  readonly root: HTMLDivElement;
  readonly list: HTMLDivElement;
  private readonly s: Scope = scope();
  private readonly topSpacer: HTMLDivElement;
  private readonly bottomSpacer: HTMLDivElement;
  private readonly rows: NgFor<string, RowView>;
  private renderIds: string[] = [];
  private lastScrollPoint = 0;
  private lastFetchedOffset = -1;
  private lastFetched = 0;
  private readonly unsubscribe: Array<() => void> = [];

  constructor(
    private readonly store: GroupService,
    private readonly router: Router,
  ) {
    const s = this.s;
    this.rows = new NgFor(
      (id) => id,
      (id) => this.createRow(id),
    );
    this.topSpacer = el(s, 'div', { class: 'spacer' });
    this.bottomSpacer = el(s, 'div', { class: 'spacer' });
    this.list = el(s, 'div', { class: 'message-list noselect', attrs: { xdscrollwatcher: '' } }, [this.topSpacer, this.rows.anchor, this.bottomSpacer]);
    this.root = el(s, 'div', { class: 'messages-list-wrapper border-color' }, [
      el(s, 'div', { class: 'messages-top-header border-color sm-mobile-hidden' }, [el(s, 'span', { class: 'flex-1' }, [el(s, 'xd-localization-string', {}, ['Messages'])])]),
      el(s, 'div', { class: 'message-search' }, [el(s, 'input', { class: 'search-input', attrs: { type: 'text', placeholder: 'Search' } })]),
      el(s, 'div', { class: 'messages-nav-wrapper' }, [el(s, 'div', { class: 'messages-nav' }, ['All'])]),
      this.list,
    ]);
    this.unsubscribe.push(
      watchScroll(this.list, { scroll: (top) => this.onScroll(top), bottom: () => this.loadMore() }),
      store.onGroupsChange(() => this.refresh()),
      router.onNavigation(() => this.refresh()),
    );
  }

  /** The first page; the route component asks for it when it is created. */
  start(): void {
    this.loadMore();
  }

  private loadMore(): void {
    const loaded = this.store.inbox.length;
    const now = Date.now();
    if (loaded === this.lastFetchedOffset && now - this.lastFetched < REFETCH_GUARD_MS) return;
    if (this.store.inboxDone) return;
    this.lastFetchedOffset = loaded;
    this.lastFetched = now;
    this.store.loadInbox(INBOX_PAGE, () => {
      this.calculate(this.list.scrollTop);
      record('inbox-loaded', { loaded: this.store.inbox.length });
    });
  }

  private onScroll(top: number): void {
    if (Math.abs(this.lastScrollPoint - top) > this.height()) {
      this.calculate(top);
      this.lastScrollPoint = top;
    }
  }

  private height(): number {
    return this.list.clientHeight || 500;
  }

  private calculate(top: number): void {
    const height = this.height();
    const from = top;
    const to = top + height;
    const margin = 1.5 * height;
    let above = 0;
    let below = 0;
    let end = 0;
    const render: string[] = [];
    for (const id of this.store.inbox) {
      end += INBOX_ROW_PX;
      if (end < from - margin) above += INBOX_ROW_PX;
      else if (end > to + margin) below += INBOX_ROW_PX;
      else render.push(id);
    }
    this.renderIds = render;
    setStyle(this.topSpacer, 'height', `${above}px`);
    setStyle(this.bottomSpacer, 'height', `${below}px`);
    this.refresh();
  }

  private createRow(groupId: string): RowView {
    const s = this.s;
    const group = this.store.getGroup(groupId);
    const partner = group?.partners[0];
    const preview = el(s, 'div', { class: 'font-size-xs dark-blue-1 eclipse' });
    const badge = el(s, 'div', { class: 'badge' });
    const badges = el(s, 'div', { class: 'badge-container flex-row' }, [badge]);
    const line = el(s, 'div', { class: 'flex-row flex-1' }, [preview]);
    const time = el(s, 'div', { class: 'message-time' });
    const link = el(s, 'a', { attrs: { href: `/messages/${groupId}` } }, [
      el(s, 'app-messaging-group', { class: 'message border-color' }, [
        el(s, 'div', { class: 'message-avatar' }, [picture(el(s, 'app-account-avatar', { class: 'avatar' }, [el(s, 'div', { class: 'avatar default-avatar' })]), partner)]),
        el(s, 'div', { class: 'flex-col flex-1 min-width-0' }, [
          el(s, 'div', { class: 'flex-row' }, [
            el(s, 'div', { class: 'message-contact' }, [
              el(s, 'app-account-username', { class: 'xs-mobile-hidden' }, [el(s, 'a', { class: 'username-wrapper', attrs: { href: `/${partner?.username ?? ''}` } }, [el(s, 'span', { class: 'display-name' }, [partner?.displayName ?? ''])])]),
            ]),
            time,
          ]),
          line,
        ]),
      ]),
    ]);
    this.router.link(link, true);
    return {
      nodes: [link],
      link,
      refresh: () => {
        const current = this.store.getGroup(groupId);
        setText(preview, current?.lastMessage?.content ?? '');
        setText(time, current?.lastMessage === null || current?.lastMessage === undefined ? '' : clock(current.lastMessage.createdAt));
        const unread = current?.unread ?? 0;
        if (unread > 0) {
          setText(badge, String(unread));
          if (badges.parentNode === null) line.append(badges);
        } else badges.remove();
      },
    };
  }

  refresh(): void {
    this.rows.update(this.renderIds);
    for (const id of this.renderIds) {
      const row = this.rows.get(id);
      if (row === undefined) continue;
      row.refresh();
      setClass(row.link, 'selected', row.link.getAttribute('href') === location.pathname);
    }
  }

  view(): InboxView {
    return {
      loaded: this.store.inbox.length,
      rendered: [...this.renderIds],
      selected: /^\/messages\/(\d+)$/.exec(location.pathname)?.[1] ?? null,
      topSpacer: Number.parseFloat(this.topSpacer.style.height) || 0,
      bottomSpacer: Number.parseFloat(this.bottomSpacer.style.height) || 0,
    };
  }

  destroy(): void {
    for (const stop of this.unsubscribe) stop();
    this.rows.destroy();
  }
}
