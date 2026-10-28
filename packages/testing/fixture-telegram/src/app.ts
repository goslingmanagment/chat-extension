// The page: Web A's columns and the open chat's two `Transition`s (telegram-tt components/main/Main.tsx,
// left/LeftColumn.tsx, middle/MiddleColumn.tsx, middle/MiddleHeader.tsx, ui/Transition.tsx):
//
//   #Main > #LeftColumn (the chat list: rows with `.Avatar[data-peer-id]`)
//         > #MiddleColumn > .messages-layout
//             > .MiddleHeader > .Transition > .Transition_slide…   (the header: .ChatInfo .Avatar[data-peer-id])
//                             > .header-tools
//             > .Transition > .Transition_slide…                    (the list and the composer of a chat)
//   #portals
//
// A chat opens as a click on its row does in Web A: `history.pushState` to `#<id>` (no `hashchange`), then both
// Transitions slide for ~300 ms. While they slide, no slide is `-active`: the old one is `-from`, the new one `-to`;
// then the new one is `-active` and the old one stays in the DOM as `-inactive` (with its own hidden
// `#editable-message-text`), until a third chat replaces it.

import { type JSONContent } from '@tiptap/core';

import { AttachmentWindow } from './attachment';
import { Composer, focusAtEnd } from './composer';
import { dayLabel, listTime, seededAt } from './dates';
import { cn, h, ICONS, svgIcon } from './dom';
import { renderText } from './emoji';
import { renderContainer, renderMessage, type ChatMessage } from './messages';
import { type TelegramStandSend } from './protocol';
import { type SeedChat } from './world';

/** Web A's slide animation of the middle column. */
export const TRANSITION_MS = 300;
/** How many of the newest messages a viewport that left them does not render. */
const HIDDEN_WHEN_SCROLLED = 12;

interface Chat {
  readonly seed: SeedChat;
  readonly messages: ChatMessage[];
  nextId: number;
  localCount: number;
  unread: number;
  scrolledUp: boolean;
  draft: JSONContent | null;
  header: HTMLElement | null;
  slide: HTMLElement | null;
  list: HTMLElement | null;
  composer: Composer | null;
}

const SLIDE = 'Transition_slide';
const slideState = (element: HTMLElement | null, state: 'active' | 'inactive' | 'from' | 'to'): void => {
  if (element !== null) element.className = `${SLIDE} ${SLIDE}-${state}`;
};

function initials(name: string): string {
  const [first = '', second = ''] = name.split(/\s+/);
  return `${Array.from(first)[0] ?? ''}${Array.from(second)[0] ?? ''}`.toUpperCase();
}

function avatar(seed: SeedChat, size: number): HTMLElement {
  return h('div', { class: 'Avatar no-photo', 'data-peer-id': seed.peerId, style: `--_size: ${size}px; background-image: linear-gradient(${seed.colors[0]}, ${seed.colors[1]})` }, [
    h('div', { class: 'inner' }, [h('span', { class: 'letters' }, [initials(seed.name)])]),
  ]);
}

/** What the chat list shows for a message: its text, or the media's name. */
function preview(message: ChatMessage): string {
  const kinds: Record<string, string> = { photo: 'Photo', video: 'Video', voice: 'Voice message', round: 'Video message', album: 'Album', call: 'Incoming call', 'emoji-only': '❤️' };
  if (message.kind === 'sticker') return `${message.alt ?? ''} Sticker`.trim();
  const label = kinds[message.kind];
  if (label === undefined) return message.text;
  return message.text !== '' && message.kind !== 'call' ? `${label}, ${message.text}` : label;
}

export class TelegramApp {
  readonly sent: TelegramStandSend[] = [];
  private readonly chats: Chat[];
  private readonly chatList: HTMLElement;
  private readonly middle: HTMLElement;
  private readonly headerTransition: HTMLElement;
  private readonly listTransition: HTMLElement;
  private readonly layout: HTMLElement;
  private readonly empty: HTMLElement;
  private current_: Chat | null = null;
  private switching: (() => void) | null = null;
  private attachment_: AttachmentWindow | null = null;

  constructor(
    root: HTMLElement,
    private readonly portals: HTMLElement,
    seeds: readonly SeedChat[],
    private readonly self: { readonly userId: string; readonly firstName: string },
    private readonly now: () => Date,
  ) {
    const loaded = now();
    this.chats = seeds.map((seed) => {
      const messages = seed.messages.map(
        (message, index): ChatMessage => ({
          id: String(seed.firstId + index),
          own: message.own === true,
          at: seededAt(message.when, loaded),
          kind: message.kind ?? 'text',
          text: message.text ?? '',
          reply: message.reply ?? null,
          edited: message.edited === true,
          ...(message.kind === 'sticker' ? { alt: message.alt ?? null } : {}),
          ...(message.length === undefined ? {} : { length: message.length }),
        }),
      );
      messages.sort((a, b) => a.at.getTime() - b.at.getTime());
      return { seed, messages, nextId: seed.firstId + messages.length, localCount: 0, unread: seed.unread, scrolledUp: false, draft: null, header: null, slide: null, list: null, composer: null };
    });
    this.chatList = h('div', { class: 'chat-list custom-scroll', role: 'listbox' });
    const search = h('input', { id: 'telegram-search-input', type: 'text', class: 'form-control', placeholder: 'Search', autocomplete: 'off', dir: 'auto' });
    const menu = h('button', { class: 'Button smaller translucent round', type: 'button', 'aria-label': 'Open menu', title: `${self.firstName} · ${self.userId}` }, [svgIcon(ICONS.menu)]);
    const left = h('div', { id: 'LeftColumn' }, [
      h('div', { id: 'LeftColumn-main' }, [
        h('div', { class: 'left-header' }, [menu, h('div', { class: 'SearchInput' }, [svgIcon(ICONS.search, 22, 'stand-svg search-icon'), search])]),
        h('div', { class: 'chat-folders' }, [h('div', { class: 'TabList' }, ['All', 'Personal', 'Unread'].map((tab, index) => h('div', { class: cn('Tab', index === 0 && 'Tab--active') }, [h('span', { class: 'Tab_inner' }, [tab])])))]),
        this.chatList,
      ]),
    ]);
    this.headerTransition = h('div', { class: 'Transition' });
    this.listTransition = h('div', { class: 'Transition' });
    const tools = h('div', { class: 'header-tools' }, [
      h('div', { class: 'HeaderActions' }, [ICONS.search, ICONS.phone, ICONS.more].map((icon) => h('button', { class: 'Button smaller translucent round', type: 'button' }, [svgIcon(icon)]))),
    ]);
    this.layout = h('div', { class: 'messages-layout' }, [h('div', { class: 'MiddleHeader' }, [this.headerTransition, tools]), this.listTransition]);
    this.empty = h('div', { class: 'stand-empty' }, [h('span', {}, ['Select a chat to start messaging'])]);
    this.middle = h('div', { id: 'MiddleColumn' }, [h('div', { id: 'middle-column-bg' }), h('div', { id: 'middle-column-portals' }), this.empty]);
    root.replaceChildren(h('div', { id: 'Main', class: 'left-column-shown' }, [left, this.middle]));
    this.renderChatList();
    window.addEventListener('popstate', () => this.followHash());
    window.addEventListener('hashchange', () => this.followHash());
  }

  get current(): Chat | null {
    return this.current_;
  }

  get attachment(): AttachmentWindow | null {
    return this.attachment_;
  }

  /** The chat the address names (`#<id>`), opened without the animation, as on a load. */
  followHash(): void {
    const peer = /^#(-?\d+)/.exec(location.hash)?.[1];
    const chat = peer === undefined ? undefined : this.chats.find((candidate) => candidate.seed.peerId === peer);
    if (chat !== undefined && chat !== this.current_) this.show(chat, this.current_ !== null);
  }

  /** A click on the chat's row: the address by `pushState` (no `hashchange`), then the slides. */
  openChat(peerId: string): void {
    const chat = this.chat(peerId);
    if (chat === this.current_) return;
    history.pushState(history.state, '', `#${peerId}`);
    this.show(chat, true);
  }

  /** A fan's message arrives: rendered in his chat if its viewport is at the newest messages. */
  incoming(peerId: string, text: string): void {
    const chat = this.chat(peerId);
    const message: ChatMessage = { id: String(chat.nextId), own: false, at: this.now(), kind: 'text', text, reply: null, edited: false };
    chat.nextId += 1;
    chat.messages.push(message);
    if (chat === this.current_) this.append(chat, message);
    else chat.unread += 1;
    this.renderChatList();
  }

  /** The viewport leaves the newest messages (`true`) or comes back to them. */
  scroll(up: boolean): void {
    const chat = this.open();
    chat.scrolledUp = up;
    this.renderList(chat);
    if (chat.list !== null) chat.list.scrollTop = up ? 0 : chat.list.scrollHeight;
  }

  openAttachment(): void {
    const chat = this.open();
    if (this.attachment_ !== null || chat.composer === null) return;
    const content = chat.composer.park();
    const window = new AttachmentWindow(content, {
      onSend: (caption) => {
        this.attachment_ = null;
        this.record(chat, caption, 'attachment');
        this.ownMessage(chat, { kind: 'photo', text: caption });
        chat.composer?.unpark(null);
      },
      onClose: (caption) => {
        this.attachment_ = null;
        chat.composer?.unpark(caption);
        chat.composer?.focus();
      },
    });
    this.attachment_ = window;
    this.portals.append(window.root);
    window.focus();
  }

  closeAttachment(): void {
    this.attachment_?.close();
  }

  editLast(): void {
    const chat = this.open();
    const last = [...chat.messages].reverse().find((message) => message.own && message.kind === 'text' && Number.isInteger(Number(message.id)));
    if (last === undefined || chat.composer === null) throw new Error('no own text message to edit');
    chat.composer.edit(last);
  }

  /**
   * The input the `document` key listener works for (telegram-tt MessageInput.tsx): the attachment window's caption
   * while it is open, else the open chat's field once its editor is up — with what a send from there does.
   */
  activeInput(): { readonly input: HTMLElement; send(): void } | null {
    if (this.attachment_ !== null) {
      const window = this.attachment_;
      return { input: window.field, send: () => window.send() };
    }
    const composer = this.current_?.composer ?? null;
    if (composer === null || !composer.active) return null;
    return { input: composer.field, send: () => composer.send() };
  }

  // ── chats ──────────────────────────────────────────────────────────────────

  private chat(peerId: string): Chat {
    const chat = this.chats.find((candidate) => candidate.seed.peerId === peerId);
    if (chat === undefined) throw new Error(`the stand has no chat ${peerId}`);
    return chat;
  }

  private open(): Chat {
    if (this.current_ === null) throw new Error('no chat is open');
    return this.current_;
  }

  private show(to: Chat, animate: boolean): void {
    this.switching?.();
    const from = this.current_;
    if (this.attachment_ !== null) this.closeAttachment();
    if (from === null) this.middle.replaceChildren(...Array.from(this.middle.children).filter((child) => child !== this.empty), this.layout);
    for (const chat of this.chats) if (chat !== from && chat !== to) this.drop(chat);
    this.build(to);
    this.current_ = to;
    to.unread = 0;
    this.renderChatList();
    if (from === null || !animate) {
      slideState(to.header, 'active');
      slideState(to.slide, 'active');
      slideState(from?.header ?? null, 'inactive');
      slideState(from?.slide ?? null, 'inactive');
      this.scrollToEnd(to);
      return;
    }
    slideState(from.header, 'from');
    slideState(from.slide, 'from');
    slideState(to.header, 'to');
    slideState(to.slide, 'to');
    const finish = (): void => {
      clearTimeout(timer);
      this.switching = null;
      slideState(to.header, 'active');
      slideState(to.slide, 'active');
      slideState(from.header, 'inactive');
      slideState(from.slide, 'inactive');
    };
    const timer = setTimeout(finish, TRANSITION_MS);
    this.switching = finish;
    this.scrollToEnd(to);
  }

  /** The chat's header and list slides, made once and kept while the chat is the open or the previous one. */
  private build(chat: Chat): void {
    if (chat.header === null) {
      const { seed } = chat;
      chat.header = h('div', { class: SLIDE }, [
        h('div', { class: 'chat-info-wrapper' }, [
          h('div', { class: 'ChatInfo' }, [
            avatar(seed, 42),
            h('div', { class: 'info' }, [
              h('div', { class: 'title QvYc7Ffb' }, [h('h3', { dir: 'auto', role: 'button', class: 'fullName' }, [seed.name])]),
              h('span', { class: cn('status', seed.status === 'online' && 'online') }, [h('span', { class: 'user-status', dir: 'auto' }, [seed.status])]),
            ]),
          ]),
        ]),
      ]);
      this.headerTransition.append(chat.header);
    }
    if (chat.slide === null) {
      chat.list = h('div', { class: 'MessageList custom-scroll with-default-bg' });
      const composer = new Composer(chat.seed.peerId, chat.draft, {
        onSend: (text, edited) => this.sendFrom(chat, text, edited),
        onAttach: () => this.openAttachment(),
      });
      chat.draft = null;
      chat.composer = composer;
      chat.slide = h('div', { class: SLIDE }, [chat.list, composer.root]);
      this.listTransition.append(chat.slide);
      // Web A keeps the list's bottom with the footer (MiddleColumn.tsx: a ResizeObserver on `.middle-column-footer`
      // resyncs the list's bottom reserve): a taller composer never covers the newest message of a list at its bottom.
      const list = chat.list;
      let atBottom = true;
      list.addEventListener('scroll', () => {
        atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 24;
      });
      new ResizeObserver(() => {
        if (atBottom) list.scrollTop = list.scrollHeight;
      }).observe(composer.root);
      this.renderList(chat);
      // Web A focuses the field of the chat it opened once the editor is up (MessageInput `canAutoFocus`).
      composer.load();
      setTimeout(() => {
        if (this.current_ === chat && this.attachment_ === null) composer.focus();
      }, 450);
    }
  }

  /** A chat that is neither open nor the previous one loses its slides (Web A's Transition cleanup); its draft stays. */
  private drop(chat: Chat): void {
    if (chat.composer !== null) chat.draft = chat.composer.destroy();
    chat.header?.remove();
    chat.slide?.remove();
    chat.composer = null;
    chat.header = null;
    chat.slide = null;
    chat.list = null;
  }

  private renderList(chat: Chat): void {
    if (chat.list === null) return;
    const shown = chat.scrolledUp ? chat.messages.slice(0, Math.max(0, chat.messages.length - HIDDEN_WHEN_SCROLLED)) : chat.messages;
    chat.list.replaceChildren(renderContainer(shown, { clock: chat.seed.clock, now: this.now(), newest: !chat.scrolledUp }));
  }

  private scrollToEnd(chat: Chat): void {
    requestAnimationFrame(() => {
      if (chat.list !== null && !chat.scrolledUp) chat.list.scrollTop = chat.list.scrollHeight;
    });
  }

  /** A new message at the end of the open chat's list (when its viewport is at the newest ones). */
  private append(chat: Chat, message: ChatMessage): void {
    if (chat.list === null || chat.scrolledUp) return;
    const container = chat.list.querySelector('.messages-container');
    const groups = chat.list.querySelectorAll('.message-date-group');
    let group = groups[groups.length - 1] ?? null;
    const label = dayLabel(message.at, this.now());
    if (group === null || group.querySelector('.sticky-date span')?.textContent !== label) {
      group = h('div', { class: 'message-date-group' }, [h('div', { class: 'sticky-date interactive' }, [h('span', { dir: 'auto' }, [label])])]);
      container?.insertBefore(group, container.querySelector('.forwards-trigger'));
    }
    const previous = group.querySelector('.message-list-item:last-child');
    const sameSide = previous !== null && previous.classList.contains('Message') && previous.classList.contains('own') === message.own;
    if (sameSide) {
      previous.classList.remove('last-in-group');
      previous.querySelector('.message-content')?.classList.remove('has-appendix');
    }
    group.append(renderMessage(message, chat.seed.clock, { first: !sameSide, last: true }));
    this.scrollToEnd(chat);
  }

  private record(chat: Chat, text: string, kind: TelegramStandSend['kind']): void {
    this.sent.push({ chat: chat.seed.peerId, text, at: Date.now(), kind });
  }

  /** A send of the field: an edit changes the sent message; a new one appears with a local id, then its real one. */
  private sendFrom(chat: Chat, text: string, edited: ChatMessage | null): void {
    if (edited !== null) {
      this.record(chat, text, 'edit');
      edited.text = text;
      edited.edited = true;
      const node = chat.list?.querySelector(`.Message[data-message-id="${edited.id}"]`);
      node?.replaceWith(renderMessage(edited, chat.seed.clock, { first: node.classList.contains('first-in-group'), last: node.classList.contains('last-in-group') }));
      this.renderChatList();
      return;
    }
    this.record(chat, text, 'message');
    this.ownMessage(chat, { kind: 'text', text });
  }

  private ownMessage(chat: Chat, what: { readonly kind: ChatMessage['kind']; readonly text: string }): void {
    chat.localCount += 1;
    const lastId = chat.nextId - 1;
    const message: ChatMessage = { id: `${lastId}.${String(chat.localCount).padStart(6, '0')}`, own: true, at: this.now(), kind: what.kind, text: what.text, reply: null, edited: false };
    chat.messages.push(message);
    // Leaving the older viewport: Web A scrolls to the newest messages on a send.
    if (chat.scrolledUp) this.scroll(false);
    else this.append(chat, message);
    this.renderChatList();
    setTimeout(() => {
      const local = message.id;
      message.id = String(chat.nextId);
      chat.nextId += 1;
      const node = chat.list?.querySelector(`.Message[data-message-id="${local}"]`);
      node?.replaceWith(renderMessage(message, chat.seed.clock, { first: node.classList.contains('first-in-group'), last: node.classList.contains('last-in-group') }));
    }, 600);
  }

  // ── the chat list ──────────────────────────────────────────────────────────

  private renderChatList(): void {
    const now = this.now();
    const rows = [...this.chats]
      .sort((a, b) => (b.messages.at(-1)?.at.getTime() ?? 0) - (a.messages.at(-1)?.at.getTime() ?? 0))
      .map((chat) => {
        const last = chat.messages.at(-1);
        const selected = chat === this.current_;
        const button = h('div', { class: cn('ListItem-button', selected && 'active'), role: 'button', tabindex: '0' }, [
          h('div', { class: 'status status-clickable' }, [h('div', { class: 'avatar-wrapper' }, [avatar(chat.seed, 54)])]),
          h('div', { class: 'info' }, [
            h('div', { class: 'info-row' }, [
              h('div', { class: 'title' }, [h('h3', { dir: 'auto', class: 'fullName' }, [chat.seed.name])]),
              h('div', { class: 'separator' }),
              h('div', { class: 'LastMessageMeta' }, [last !== undefined && last.own ? h('div', { class: 'MessageOutgoingStatus' }, [h('i', { class: 'icon icon-message-read' })]) : null, h('span', { class: 'time' }, [last === undefined ? '' : listTime(last.at, now, chat.seed.clock)])]),
            ]),
            h('div', { class: 'subtitle' }, [
              h('p', { class: 'last-message', dir: 'ltr' }, [last !== undefined && last.own ? h('span', { class: 'sender-name' }, ['You']) : null, last !== undefined && last.own ? h('span', { class: 'colon' }, [': ']) : null, ...(last === undefined ? [] : renderText(preview(last)))]),
              chat.unread > 0 && !selected ? h('div', { class: 'ChatBadge unread' }, [String(chat.unread)]) : null,
            ]),
          ]),
        ]);
        button.addEventListener('click', () => this.openChat(chat.seed.peerId));
        return h('div', { class: cn('ListItem Chat chat-item-clickable private', selected && 'selected'), 'data-peer-row': chat.seed.peerId }, [button]);
      });
    this.chatList.replaceChildren(...rows);
  }

  /** The open chat's field gets the focus with the caret at its end (a person clicking into it). */
  focusField(): void {
    const composer = this.current_?.composer;
    if (composer?.active === true) focusAtEnd(composer.field);
  }
}
