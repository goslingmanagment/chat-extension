// The filter chips over a creator's list of chats, as Fansly prints them (2026-11-13; main.3dedb73df0fe5484.js
// :73860-74140 template, :74225-74560 component): `.messages-nav-wrapper > .message-list-header >
// .tab-nav-wrapper.font-size-sm > .bubble-wrap.bubble-wrap-sm > .bubble` — All, Subscribers, a tier per tier with an
// active plan (`i.fa-star` in its colour, the name cut `slice(0, 20) + '...'`), Staff (printed with the VIPs string)
// when a chat with Fansly's staff is loaded, VIPs, Followers, a chip per pinned list with its trash, the pencil and the
// refresh. `.active` on the one that is on; `div.badge > span` with the unread messages of the loaded chats in that
// filter (`99+` above 99), none at zero.
//
// What it does, as Fansly does: a chip's click turns its filter on (the rows show its fans, Fansly's spinner a moment);
// the trash unpins its list for the account (`POST /settings` with the whole array; All again if it was on), its click
// never the chip's; the pencil opens «Select a List» (a stub of Fansly's window: the lists not pinned, a click pins one);
// the refresh reads the unread again. The facts — tiers, pinned lists, each fan's subscription, tier, lists, VIP and
// staff — come from the fake Fansly's answers (xhr-backend.ts); the page answering itself has none of them.

import { el, scope, setClass, type Scope } from './ng';

/** A fan's place in the filters, as the page's account cache has it. */
export interface FanFilterFacts {
  readonly lists: readonly string[];
  readonly subscriber: boolean;
  readonly tierId: string | null;
  readonly follower: boolean;
  readonly vip: boolean;
  readonly staff: boolean;
}

/** What the block reads and writes (the XHR backend over the fake Fansly). */
export interface StandFiltersSource {
  /** The creator's tiers with an active plan, in the page's order (`/account/me`). */
  tiers(): ReadonlyArray<{ readonly id: string; readonly name: string; readonly color: string }>;
  /** `GET /settings?categoryIds=4000`: the pinned lists. */
  pinned(done: (lists: ReadonlyArray<{ readonly id: string; readonly label: string }>) => void): void;
  /** `POST /settings`: the whole array, for the account. */
  savePinned(lists: ReadonlyArray<{ readonly id: string; readonly label: string }>): void;
  /** `GET /lists/account`: every list of the account, for «Select a List». */
  accountLists(done: (lists: ReadonlyArray<{ readonly id: string; readonly label: string; readonly itemCount: number }>) => void): void;
  /** A fan's facts; null — the account is not in the page's cache. */
  facts(accountId: string): FanFilterFacts | null;
  /** The refresh: the unread read again. */
  refresh(done: () => void): void;
}

/** The loaded chats the badges count: each one's unread and its fan. */
export interface FilterGroups {
  groups(): ReadonlyArray<{ readonly unread: number; readonly fanId: string | null }>;
}

type Filter = { readonly kind: 'all' | 'subscribers' | 'staff' | 'vips' | 'followers' } | { readonly kind: 'tier'; readonly id: string } | { readonly kind: 'list'; readonly id: string };

const cut = (name: string): string => `${name.slice(0, 20)}${name.length > 21 ? '...' : ''}`;
const badgeText = (n: number): string => (n > 99 ? '99+' : String(n));

/** Font Awesome's glyph as the stand draws it: an inline icon inside Fansly's own `<i>`. */
const GLYPHS: Readonly<Record<string, string>> = {
  star: 'm12 3.3 2.64 5.6 6.1.8-4.46 4.24 1.13 6.06L12 17.05 6.59 20l1.13-6.06L3.26 9.7l6.1-.8Z',
  trash: 'M3.5 6h17M9 6V4.4c0-.8.6-1.4 1.4-1.4h3.2c.8 0 1.4.6 1.4 1.4V6M5.5 6l.9 13.2c.1 1 .9 1.8 1.9 1.8h7.4c1 0 1.8-.8 1.9-1.8L18.5 6',
  pencil: 'm3.5 20.5 1.3-5L16.4 3.9a2 2 0 0 1 2.8 0l.9.9a2 2 0 0 1 0 2.8L8.5 19.2l-5 1.3Z',
  rotate: 'M20.3 4v5.2h-5.2M19.8 9.2A8.3 8.3 0 0 0 4 10.3M3.7 20v-5.2h5.2M4.2 14.8A8.3 8.3 0 0 0 20 13.7',
};
function glyph(name: string, filled: boolean): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', GLYPHS[name] ?? '');
  path.setAttribute('fill', filled ? 'currentColor' : 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.8');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}

export class FilterBlock {
  readonly root: HTMLDivElement;
  private readonly s: Scope = scope();
  private readonly wrap: HTMLDivElement;
  private readonly base: Record<'all' | 'subscribers' | 'staff' | 'vips' | 'followers', HTMLDivElement>;
  private readonly pencil: HTMLDivElement;
  private readonly refreshChip: HTMLDivElement;
  private readonly refreshIcon: HTMLElement;
  private readonly tierNodes = new Map<string, HTMLDivElement>();
  private readonly listNodes = new Map<string, HTMLDivElement>();
  private pinnedLists: Array<{ readonly id: string; readonly label: string }> = [];
  private active: Filter = { kind: 'all' };
  private modal: HTMLElement | null = null;

  constructor(
    private readonly source: StandFiltersSource | null,
    private readonly loaded: FilterGroups,
    /** A filter turned on, or the list read again: the rows show it (with Fansly's spinner). */
    private readonly changed: () => void,
  ) {
    const s = this.s;
    const plain = (label: string, kind: Filter['kind'], subscribers = false): HTMLDivElement => {
      const chip = el(s, 'div', { class: 'bubble' }, [el(s, 'xd-localization-string', subscribers ? { class: 'margin-right-text' } : {}, [`${label} `])]);
      chip.addEventListener('click', () => this.select({ kind } as Filter));
      return chip;
    };
    this.base = { all: plain('All', 'all'), subscribers: plain('Subscribers', 'subscribers', true), staff: plain('VIPs', 'staff'), vips: plain('VIPs', 'vips'), followers: plain('Followers', 'followers') };
    const pencilIcon = el(s, 'i', { class: 'fal fa-pencil pointer blue-1' }, [glyph('pencil', false)]);
    this.pencil = el(s, 'div', { class: 'bubble' }, [pencilIcon]);
    this.pencil.addEventListener('click', () => this.openListSelect());
    this.refreshIcon = el(s, 'i', { class: 'fal fa-arrows-rotate pointer blue-1' }, [glyph('rotate', false)]);
    this.refreshChip = el(s, 'div', { class: 'bubble' }, [this.refreshIcon]);
    this.refreshChip.addEventListener('click', () => this.reload());
    this.wrap = el(s, 'div', { class: 'bubble-wrap bubble-wrap-sm' });
    this.root = el(s, 'div', { class: 'messages-nav-wrapper' }, [el(s, 'div', { class: 'message-list-header' }, [el(s, 'div', { class: 'tab-nav-wrapper font-size-sm' }, [this.wrap])])]);
    this.render();
  }

  /** The route component's `ngOnInit`: the pinned lists read (`loadPinnedLists`). */
  start(): void {
    this.source?.pinned((lists) => {
      this.pinnedLists = [...lists];
      this.render();
    });
  }

  /** Whether a fan is in the filter that is on. */
  shows(fanId: string | null): boolean {
    if (this.active.kind === 'all') return true;
    const facts = fanId === null ? null : (this.source?.facts(fanId) ?? null);
    if (facts === null) return false;
    return this.member(facts, this.active);
  }

  private member(facts: FanFilterFacts, filter: Filter): boolean {
    switch (filter.kind) {
      case 'all':
        return true;
      case 'subscribers':
        return facts.subscriber;
      case 'staff':
        return facts.staff;
      case 'vips':
        return facts.vip;
      case 'followers':
        return facts.follower;
      case 'tier':
        return facts.tierId === filter.id;
      case 'list':
        return facts.lists.includes(filter.id);
    }
  }

  /** Unread messages of the loaded chats in a filter (`getTotalUnreadMessages`). */
  private count(filter: Filter): number {
    let total = 0;
    for (const group of this.loaded.groups()) {
      if (group.unread <= 0) continue;
      if (filter.kind === 'all') {
        total += group.unread;
        continue;
      }
      const facts = group.fanId === null ? null : (this.source?.facts(group.fanId) ?? null);
      if (facts !== null && this.member(facts, filter)) total += group.unread;
    }
    return total;
  }

  private select(filter: Filter): void {
    this.active = filter;
    this.render();
    this.changed();
  }

  private tierNode(tier: { readonly id: string; readonly name: string; readonly color: string }): HTMLDivElement {
    let node = this.tierNodes.get(tier.id);
    if (node === undefined) {
      const s = this.s;
      const star = el(s, 'i', { class: 'fa-fw fas fa-star margin-right-text' }, [glyph('star', true)]);
      star.style.color = tier.color;
      node = el(s, 'div', { class: 'bubble' }, [star, el(s, 'span', { class: 'margin-right-text' }, [cut(tier.name)])]);
      node.addEventListener('click', () => this.select({ kind: 'tier', id: tier.id }));
      this.tierNodes.set(tier.id, node);
    }
    return node;
  }

  private listNode(list: { readonly id: string; readonly label: string }): HTMLDivElement {
    let node = this.listNodes.get(list.id);
    if (node === undefined) {
      const s = this.s;
      const trash = el(s, 'i', { class: 'fal fa-trash-can pointer blue-1' }, [glyph('trash', false)]);
      trash.addEventListener('click', (event) => {
        // Fansly's own: the trash unpins and stops there (main:74019-74021).
        this.unpin(list.id);
        event.stopPropagation();
      });
      node = el(s, 'div', { class: 'bubble' }, [list.label === '' ? el(s, 'xd-localization-string', {}, ['List ']) : el(s, 'span', { class: 'margin-right-text' }, [cut(list.label)]), trash]);
      node.addEventListener('click', () => this.select({ kind: 'list', id: list.id }));
      this.listNodes.set(list.id, node);
    }
    return node;
  }

  private unpin(id: string): void {
    const at = this.pinnedLists.findIndex((list) => list.id === id);
    if (at < 0) return;
    this.pinnedLists.splice(at, 1);
    this.source?.savePinned(this.pinnedLists);
    this.listNodes.get(id)?.remove();
    this.listNodes.delete(id);
    if (this.active.kind === 'list' && this.active.id === id) this.select({ kind: 'all' });
    else this.render();
  }

  private openListSelect(): void {
    if (this.modal !== null || this.source === null) return;
    const source = this.source;
    source.accountLists((lists) => {
      const s = this.s;
      const pinned = new Set(this.pinnedLists.map((list) => list.id));
      const close = (): void => {
        this.modal?.remove();
        this.modal = null;
      };
      const rows = lists
        .filter((list) => !pinned.has(list.id))
        .map((list) => {
          const row = el(s, 'div', { class: 'list-select-row', attrs: { 'data-list-id': list.id } }, [el(s, 'span', {}, [list.label]), el(s, 'small', {}, [`${String(list.itemCount)} users`])]);
          row.addEventListener('click', () => {
            this.pinnedLists.push({ id: list.id, label: list.label });
            source.savePinned(this.pinnedLists);
            close();
            this.render();
          });
          return row;
        });
      const shut = el(s, 'div', { class: 'list-select-close', attrs: { role: 'button', 'aria-label': 'Close' } }, ['×']);
      shut.addEventListener('click', close);
      const box = el(s, 'app-list-select-modal', { class: 'list-select-modal' }, [el(s, 'div', { class: 'list-select-head' }, [el(s, 'span', {}, ['Select a List']), shut]), el(s, 'div', { class: 'list-select-rows' }, rows)]);
      const overlay = el(s, 'div', { class: 'list-select-overlay' }, [box]);
      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) close();
      });
      this.modal = overlay;
      document.body.append(overlay);
    });
  }

  /** Fansly's `reload()`: the unread read again, the list from its top. */
  private reload(): void {
    setClass(this.refreshIcon, 'fa-spin', true);
    const started = Date.now();
    const done = (): void => {
      setTimeout(() => setClass(this.refreshIcon, 'fa-spin', false), Math.max(0, 400 - (Date.now() - started)));
      this.render();
    };
    if (this.source === null) done();
    else this.source.refresh(done);
    this.changed();
  }

  private setBadge(chip: HTMLElement, n: number): void {
    let badge = [...chip.children].find((child) => child.classList.contains('badge')) ?? null;
    if (n <= 0) {
      badge?.remove();
      return;
    }
    if (badge === null) {
      badge = el(this.s, 'div', { class: 'badge' }, [el(this.s, 'span', {}, [''])]);
      chip.append(badge);
    }
    const span = badge.querySelector('span');
    if (span !== null && span.textContent !== badgeText(n)) span.textContent = badgeText(n);
  }

  /** The block as the component's change detection paints it: in order, `.active`, the badges. */
  render(): void {
    const tiers = this.source?.tiers() ?? [];
    if (this.active.kind === 'tier' && !tiers.some((tier) => this.active.kind === 'tier' && tier.id === this.active.id)) this.active = { kind: 'all' };
    const staffShown = this.loaded.groups().some((group) => group.fanId !== null && this.source?.facts(group.fanId)?.staff === true);
    const order: Array<[HTMLElement, Filter]> = [
      [this.base.all, { kind: 'all' }],
      [this.base.subscribers, { kind: 'subscribers' }],
      ...tiers.map((tier): [HTMLElement, Filter] => [this.tierNode(tier), { kind: 'tier', id: tier.id }]),
      ...(staffShown ? [[this.base.staff, { kind: 'staff' }] as [HTMLElement, Filter]] : []),
      [this.base.vips, { kind: 'vips' }],
      [this.base.followers, { kind: 'followers' }],
      ...this.pinnedLists.map((list): [HTMLElement, Filter] => [this.listNode(list), { kind: 'list', id: list.id }]),
    ];
    const nodes = [...order.map(([node]) => node), this.pencil, this.refreshChip];
    if (nodes.length !== this.wrap.children.length || nodes.some((node, index) => this.wrap.children[index] !== node)) this.wrap.replaceChildren(...nodes);
    for (const [node, filter] of order) {
      const on = filter.kind === this.active.kind && (filter.kind === 'tier' || filter.kind === 'list' ? this.active.kind === filter.kind && this.active.id === filter.id : true);
      setClass(node, 'active', on);
      // Fansly's own slip: while a tier is on, Subscribers counts that tier (its `getSubscriberGroups()` reads the filter).
      const counted: Filter = filter.kind === 'subscribers' && this.active.kind === 'tier' ? this.active : filter;
      this.setBadge(node, this.count(counted));
    }
  }

  destroy(): void {
    this.modal?.remove();
    this.modal = null;
  }
}
