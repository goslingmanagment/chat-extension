// A Fansly-like page for the isolated side's DOM tests (test-only; nothing
// that ships imports it): the element chain of fansly.com's chat as
// docs/project-unite/fansly-web.md §3 draws it, and the lifecycle the
// isolated world relies on (architecture.md §7.2, §7.3) — a chat switch
// pushes the address and, in the same task, drops the container and the
// header's contact block and makes them anew (at once for a cached group,
// later for one the page must fetch); the gallery takes the header's contact
// and the container away without a change of address; `/messages` shows no
// conversation and another page no messages route. The mini-chat repeats the
// container's classes outside the route. On request (R20 P7e) the inbox rows
// with their links, Angular's `popstate` read a task later, and the page's
// draft cache: a new field gets its group's cached draft a microtask after it
// appears, with no event. The Firefox stand is packages/testing/fixture-fansly;
// this is only the shape of it.

export interface FakeChatOptions {
  /** The group is in the page's cache: its container comes in the same task (default); false — `arrive()` brings it. */
  readonly cached?: boolean;
  /** Participants other than the creator: the contact block stands only at one (default 1). */
  readonly partners?: number;
  /** The DM rules are not met: `div.no-dm-allowed` and the field's branch hidden. */
  readonly copyOnly?: boolean;
}

export interface FakeFanslyPage {
  /** Opens a conversation the way Fansly's router does: the address first, the nodes in the same task. */
  openChat(groupId: string, options?: FakeChatOptions): void;
  /** The group the page had to fetch has arrived: its container and contact block come now. */
  arrive(): void;
  openInbox(): void;
  openHome(): void;
  /** The gallery of the open chat, without a change of address. */
  gallery(open: boolean): void;
  /** The mini-chat: its own container and field, outside the conversation route. */
  miniChat(open: boolean): void;
  /** Back or forward: the address changes, `popstate` fires, the route activates a task later (Angular). */
  popTo(path: string): Promise<void>;
  /** Changes the address without any signal or node of the page: what FS-RTE-3 counts. */
  silentPush(path: string): void;
  /** The open chat's field branch (`div.message-composer`) made anew in the same composer (R20 P7d). */
  recreateField(): void;
  /** The DM rules turn unmet or met again without a change of address: the branch and the `hidden` class (P7d). */
  setCopyOnly(on: boolean): void;
  /** The number of participants changes without a change of address: the contact block goes or is made anew (P7d). */
  setPartners(count: number): void;
  /** The fan types (a typing line in the container, no height) or stops (P7d). */
  typing(on: boolean): void;
  /** The inbox rows of these groups: `a[href="/messages/<id>"]`; a click on one opens it in the router's microtask. */
  inbox(groupIds: readonly string[]): void;
  /** The router reads `popstate`: a task later, the address it finds is shown (Angular, S2 Q4). Off by default. */
  routing(on: boolean): void;
  /** The page's draft cache by group: typed text kept; a new field shows its group's a microtask after it appears. Off by default. */
  cacheDrafts(on: boolean): void;
  route(): Element | null;
  container(): Element | null;
  composer(): Element | null;
  headerRow(): Element | null;
  textarea(): HTMLTextAreaElement | null;
  destroy(): void;
}

const make = (tag: string, className?: string, children: readonly Node[] = []): HTMLElement => {
  const element = document.createElement(tag);
  if (className !== undefined) element.className = className;
  element.append(...children);
  return element;
};

/** Builds the page's frame in `document.body` and leaves the address where the test put it. */
export function createFakeFanslyPage(): FakeFanslyPage {
  const content = make('div', 'content-wrapper', [make('router-outlet')]);
  const root = make('app-root', undefined, [make('div', 'global-wrapper', [make('div', 'site-wrapper', [make('app-nav-bar-top'), content])])]);
  document.body.append(root);
  let messagesRoute: HTMLElement | null = null;
  let messagesWrapper: HTMLElement | null = null;
  let conversation: HTMLElement | null = null;
  let header: HTMLElement | null = null;
  let row: HTMLElement | null = null;
  let pending: { readonly groupId: string; readonly options: FakeChatOptions } | null = null;
  let mini: HTMLElement | null = null;
  let drafts: Map<string, string> | null = null;
  const remember = (event: Event): void => {
    const group = /^\/messages\/(\d+)$/.exec(location.pathname)?.[1];
    if (drafts !== null && group !== undefined && event.target instanceof HTMLTextAreaElement) drafts.set(group, event.target.value);
  };
  document.addEventListener('input', remember, true);
  const onPopState = (): void => void setTimeout(() => show(location.pathname), 0);

  const branch = (copyOnly: boolean): HTMLElement =>
    make('div', copyOnly ? 'message-composer hidden' : 'message-composer', [
      make('div', 'collapsable-actions', [Object.assign(document.createElement('input'), { type: 'file' })]),
      make('div', 'message-entry', [make('textarea', 'message-input'), make('button', 'send-button')]),
    ]);
  const field = (copyOnly: boolean): HTMLElement => make('app-group-message-input', undefined, [make('div', 'message-attachments'), ...(copyOnly ? [make('div', 'no-dm-allowed')] : []), branch(copyOnly)]);
  const containerOf = (options: FakeChatOptions): HTMLElement => make('app-group-message-container', 'message-content', [make('div', 'message-content-list'), field(options.copyOnly === true)]);
  const contact = (): HTMLElement => make('div', 'message-content-header-contact', [make('app-account-username'), make('div', 'flex-row content-header-sub-row', [make('div', 'gallery-hot-icon')])]);

  const ensureMessages = (): void => {
    if (messagesRoute !== null) return;
    messagesWrapper = make('div', 'messages-content-wrapper', [make('router-outlet')]);
    messagesRoute = make('app-messages-route', undefined, [make('div', 'page-content', [make('div', 'messages-wrapper', [make('div', 'messages-list-wrapper'), messagesWrapper])])]);
    content.append(messagesRoute);
  };
  const dropConversation = (): void => {
    conversation?.remove();
    conversation = null;
    header = null;
    row = null;
  };
  const render = (options: FakeChatOptions): void => {
    if (conversation === null || header === null || row === null) return;
    if ((options.partners ?? 1) === 1) row.append(contact());
    const container = containerOf(options);
    conversation.append(container);
    // NgModel writes the cached draft into the new field a microtask later, with no event (main:55931).
    const cached = drafts?.get(/^\/messages\/(\d+)$/.exec(location.pathname)?.[1] ?? '');
    const field = container.querySelector('textarea');
    if (cached !== undefined && field !== null) queueMicrotask(() => (field.value = cached));
  };

  const show = (path: string, options: FakeChatOptions = {}): void => {
    const chat = /^\/messages\/(\d+)$/.exec(path);
    if (!path.startsWith('/messages')) {
      messagesRoute?.remove();
      messagesRoute = null;
      messagesWrapper = null;
      dropConversation();
      return;
    }
    ensureMessages();
    if (chat === null) return dropConversation();
    if (conversation === null) {
      row = make('div', 'flex-row', [make('div', 'back-button')]);
      header = make('div', 'message-content-header', [make('div', 'flex-col', [row])]);
      conversation = make('app-messages-conversation-route', undefined, [header]);
      messagesWrapper?.append(conversation);
    } else {
      // The same route instance: the container and the contact block die at once.
      conversation.querySelector(':scope > app-group-message-container')?.remove();
      conversation.querySelector(':scope > app-group-media-offers')?.remove();
      row?.querySelector('.message-content-header-contact')?.remove();
      if (header !== null && !header.isConnected) conversation.prepend(header);
    }
    if (options.cached === false) pending = { groupId: chat[1] as string, options };
    else render(options);
  };

  const openChat = (groupId: string, options: FakeChatOptions = {}): void => {
    history.pushState({}, '', `/messages/${groupId}`);
    show(`/messages/${groupId}`, options);
  };

  return {
    openChat,
    arrive() {
      if (pending === null) return;
      const { options } = pending;
      pending = null;
      render(options);
    },
    openInbox() {
      history.pushState({}, '', '/messages');
      show('/messages');
    },
    openHome() {
      history.pushState({}, '', '/home');
      show('/home');
    },
    gallery(open) {
      if (conversation === null) return;
      if (open) {
        header?.remove();
        conversation.querySelector(':scope > app-group-message-container')?.remove();
        conversation.append(make('app-group-media-offers'));
      } else {
        conversation.querySelector(':scope > app-group-media-offers')?.remove();
        if (header !== null) conversation.prepend(header);
        conversation.append(containerOf({}));
      }
    },
    miniChat(open) {
      if (!open) {
        mini?.remove();
        mini = null;
        return;
      }
      mini = make('app-messaging-overlay', undefined, [make('app-group-message-container', 'message-content', [field(false)])]);
      root.append(mini);
    },
    popTo(path) {
      history.replaceState({}, '', path);
      window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
      // Angular reads `popstate` a task later and activates the route then.
      return new Promise((resolve) =>
        setTimeout(() => {
          show(path);
          resolve();
        }, 0),
      );
    },
    silentPush(path) {
      history.pushState({}, '', path);
    },
    recreateField() {
      const composer = conversation?.querySelector(':scope > app-group-message-container > app-group-message-input');
      const old = composer?.querySelector(':scope > div.message-composer');
      old?.replaceWith(branch(old.classList.contains('hidden')));
    },
    setCopyOnly(on) {
      const composer = conversation?.querySelector(':scope > app-group-message-container > app-group-message-input');
      const fieldBranch = composer?.querySelector(':scope > div.message-composer');
      if (composer === null || composer === undefined || fieldBranch === null || fieldBranch === undefined) return;
      composer.querySelector(':scope > div.no-dm-allowed')?.remove();
      if (on) fieldBranch.before(make('div', 'no-dm-allowed'));
      fieldBranch.classList.toggle('hidden', on);
    },
    setPartners(count) {
      row?.querySelector(':scope > .message-content-header-contact')?.remove();
      if (count === 1) row?.append(contact());
    },
    typing(on) {
      const container = conversation?.querySelector(':scope > app-group-message-container');
      container?.querySelector(':scope > .partner-is-typing')?.remove();
      if (on) container?.querySelector(':scope > .message-content-list')?.after(make('div', 'partner-is-typing'));
    },
    inbox(groupIds) {
      ensureMessages();
      const list = messagesRoute?.querySelector('.messages-list-wrapper');
      if (list === null || list === undefined) return;
      list.replaceChildren(
        ...groupIds.map((groupId) => {
          const link = make('a');
          link.setAttribute('href', `/messages/${groupId}`);
          link.addEventListener('click', (event) => {
            event.preventDefault();
            queueMicrotask(() => openChat(groupId));
          });
          return link;
        }),
      );
    },
    routing(on) {
      window.removeEventListener('popstate', onPopState);
      if (on) window.addEventListener('popstate', onPopState);
    },
    cacheDrafts(on) {
      drafts = on ? new Map() : null;
    },
    route: () => conversation,
    container: () => conversation?.querySelector(':scope > app-group-message-container') ?? null,
    composer: () => conversation?.querySelector(':scope > app-group-message-container > app-group-message-input') ?? null,
    headerRow: () => row,
    textarea: () => conversation?.querySelector<HTMLTextAreaElement>(':scope > app-group-message-container textarea.message-input') ?? null,
    destroy() {
      window.removeEventListener('popstate', onPopState);
      document.removeEventListener('input', remember, true);
      root.remove();
      history.replaceState({}, '', '/');
    },
  };
}
