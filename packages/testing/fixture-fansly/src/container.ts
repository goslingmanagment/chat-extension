// `app-group-message-container` — history and composer of one group (class
// `qp`, main:59153-59266), made anew for every chat the route opens:
// - `div.message-content-list[xdscrollwatcher]` (flex column, `overflow-y: auto`) holding the message collections;
// - the scroll rules (main:59201-59236, xdScrollWatcher main:24538-24550): every scroll sets `scrollBlock`, and
//   `resizeScrollBlock_` while the list is more than 1 px from its bottom; within 350 px of the bottom
//   `scrollBlock` is lifted; at `scrollTop = 0` the page before the oldest message loads and the position is kept;
//   a new message brings the list down unless `scrollBlock`; a size change of the list (its ResizeObserver, the
//   window's `resize`) brings it down only within 1 px of the bottom;
// - `div.partner-is-typing` (zero height, `z-index: 2`) inserted when the fan types (5/22) and removed by a 2 s
//   interval after 3.1 s without another announcement, or by the fan's message (main:59178-59205);
// - the composer under `*ngIf="group"`, the last child.

import { Composer } from './composer';
import type { Account } from './data';
import type { ModalService } from './modal';
import { NgFor, NgIf, anchor, el, host, scope, setClass, setText, type Scope, type View } from './ng';
import type { ComposerPlace, ListView } from './protocol';
import { watchScroll } from './scroll';
import type { Group, GroupService, PageMessage } from './store';

const TYPING_EXPIRE_MS = 3100;
const TYPING_SWEEP_MS = 2000;

interface CollectionView extends View {
  readonly body: HTMLElement;
}

interface Run {
  readonly key: string;
  readonly mine: boolean;
  readonly messages: readonly PageMessage[];
}

/** Consecutive messages of one sender form a collection (Fansly also splits them by time). */
function runsOf(messages: readonly PageMessage[], creatorId: string): Run[] {
  const runs: Array<{ key: string; mine: boolean; messages: PageMessage[] }> = [];
  for (const message of messages) {
    const mine = message.senderId === creatorId;
    const last = runs.at(-1);
    if (last !== undefined && last.mine === mine) last.messages.push(message);
    else runs.push({ key: message.id, mine, messages: [message] });
  }
  return runs;
}

export class MessageContainer implements View {
  readonly host: HTMLElement;
  readonly nodes: readonly Node[];
  readonly list: HTMLDivElement;
  scrollBlock = false;
  resizeScrollBlock = false;
  private readonly s: Scope = scope();
  private readonly wrapper: HTMLDivElement;
  private readonly collections: NgFor<Run, CollectionView>;
  private readonly typingIf: NgIf<View>;
  private readonly composerIf: NgIf<Composer>;
  private typingStates: Array<{ accountId: string; lastAnnounce: number }> = [];
  private readonly unsubscribe: Array<() => void> = [];
  private readonly typingTimer: ReturnType<typeof setInterval>;
  private resizeObserver: ResizeObserver | null = null;
  private readonly onWindowResize = (): void => this.onResize();

  constructor(
    readonly place: ComposerPlace,
    readonly group: Group,
    private readonly store: GroupService,
    modals: ModalService,
  ) {
    const s = this.s;
    this.host = host(s, 'app-group-message-container', { class: 'message-content' });
    this.nodes = [this.host];
    this.collections = new NgFor(
      (run) => run.key,
      (run) => this.createCollection(run),
    );
    this.wrapper = el(s, 'div', { class: 'message-collection-wrapper', attrs: { xdmutation: '' } }, [this.collections.anchor]);
    this.list = el(s, 'div', { class: 'message-content-list', attrs: { xdscrollwatcher: '' } }, [this.wrapper]);
    this.typingIf = new NgIf(() => ({
      nodes: [
        el(s, 'div', { class: 'partner-is-typing' }, [
          el(s, 'div', { class: 'flex-row margin-bottom-4 flex-align-center' }, [el(s, 'app-account-avatar', { class: 'typing-avatar' }), el(s, 'div', { class: 'typing-dots' }, ['typing…'])]),
        ]),
      ],
    }));
    this.composerIf = new NgIf(() => new Composer(place, group, store, modals));
    this.host.append(this.list, this.typingIf.anchor, anchor(), this.composerIf.anchor);

    this.unsubscribe.push(
      watchScroll(this.list, {
        scroll: (top) => this.onScroll(top),
        bottom: () => {
          this.scrollBlock = false;
        },
        top: () => this.onScrollTop(),
      }),
      store.on(group.id, (event) => {
        // A deleted message: the collections are made anew (their views only ever grow).
        if (event === 'removed') this.collections.update([]);
        if (event === 'collection' || event === 'removed') {
          this.refreshUi();
          this.scrollToBottom();
        }
      }),
      store.onMessage(group.id, (message) => {
        this.typingStates = this.typingStates.filter((state) => state.accountId !== message.senderId);
        this.refreshUi();
        this.scrollToBottom();
      }),
      store.onTyping((groupId, accountId) => {
        if (groupId !== group.id || accountId === store.creator.id) return;
        const known = this.typingStates.find((state) => state.accountId === accountId);
        if (known !== undefined) known.lastAnnounce = Date.now();
        else this.typingStates.push({ accountId, lastAnnounce: Date.now() });
        this.refreshUi();
      }),
    );
    this.typingTimer = setInterval(() => {
      const now = Date.now();
      const before = this.typingStates.length;
      this.typingStates = this.typingStates.filter((state) => now - state.lastAnnounce <= TYPING_EXPIRE_MS);
      if (this.typingStates.length !== before) this.refreshUi();
    }, TYPING_SWEEP_MS);
    window.addEventListener('resize', this.onWindowResize);
    // ngOnChanges(group): both blocks lifted, render, to the bottom.
    this.refreshUi();
    this.scrollToBottom();
  }

  /** After the host is in the document: the composer's init hooks (ngOnInit), the list's ResizeObserver (ngAfterViewInit). */
  attached(): void {
    this.composer?.ngOnInit();
    if (this.resizeObserver !== null || typeof ResizeObserver === 'undefined') return;
    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(this.list);
    this.scrollToBottom();
  }

  get composer(): Composer | null {
    return this.composerIf.view;
  }

  private createCollection(run: Run): CollectionView {
    const s = this.s;
    const partner: Account | undefined = this.group.partners[0];
    const body = el(s, 'div', { class: 'flex-col width-100' });
    const element = el(s, 'app-group-message-collection', { class: 'message-collection', attrs: { apptheme: '' } }, [
      el(s, 'div', { class: 'flex-row width-100', attrs: { appmutation: '' } }, [run.mine ? null : el(s, 'app-account-avatar', { class: 'avatar', attrs: { title: partner?.username ?? '' } }), body]),
    ]);
    const view: CollectionView = { nodes: [element], body };
    this.fillCollection(view, run);
    return view;
  }

  /** Messages carry no id and no time in the DOM (fansly-web.md §3). */
  private fillCollection(view: CollectionView, run: Run): void {
    const s = this.s;
    const rendered = view.body.querySelectorAll(':scope > .flex-col > app-group-message').length;
    for (const message of run.messages.slice(rendered)) {
      const bubble = el(s, 'app-group-message', { class: run.mine ? 'message my-message' : 'message', attrs: { apptheme: '' } }, [
        el(s, 'div', { class: 'message-reply-wrapper' }, [el(s, 'div', { class: 'message-text' }, [message.content])]),
      ]);
      setClass(bubble, 'queued', message.queued);
      view.body.append(el(s, 'div', { class: 'flex-col width-100' }, [bubble]));
    }
    let stamp = view.body.querySelector<HTMLElement>(':scope > .timestamp');
    stamp ??= el(s, 'div', { class: run.mine ? 'timestamp my-message' : 'timestamp' }, [el(s, 'span', { class: 'margin-right-text' })]);
    // The time line closes the collection: moved only when messages were added after it.
    if (view.body.lastElementChild !== stamp) view.body.append(stamp);
    const last = run.messages.at(-1);
    const span = stamp.firstElementChild;
    if (span !== null && last !== undefined) setText(span, new Date(last.createdAt * 1000).toISOString().slice(11, 16));
    for (const [index, message] of run.messages.entries()) {
      const bubble = view.body.querySelectorAll(':scope > .flex-col > app-group-message')[index];
      if (bubble !== undefined) setClass(bubble, 'queued', message.queued);
    }
  }

  refreshUi(): void {
    const runs = runsOf(this.group.messages, this.store.creator.id);
    this.collections.update(runs);
    // A run that grew keeps its view: its new messages are appended to it.
    for (const run of runs) {
      const view = this.collections.get(run.key);
      if (view !== undefined) this.fillCollection(view, run);
    }
    this.typingIf.update(this.typingStates.length > 0);
    this.composerIf.update(true);
  }

  private onScroll(top: number): void {
    this.scrollBlock = true;
    this.resizeScrollBlock = this.list.scrollHeight - this.list.clientHeight - top > 1;
  }

  /** `scrollTop = 0`: the page before the oldest message; the position stays on what was in view. */
  private onScrollTop(): void {
    const height = this.list.scrollHeight;
    this.store.fetchGroupMessages(this.group.id, true, () => {
      this.list.scrollTop = this.list.scrollHeight - height;
    });
  }

  private onResize(): void {
    if (!this.resizeScrollBlock) this.scrollToBottom();
  }

  scrollToBottom(): void {
    if (!this.scrollBlock) this.list.scrollTop = this.list.scrollHeight;
  }

  listView(): ListView {
    return {
      groupId: this.group.id,
      scrollTop: this.list.scrollTop,
      scrollHeight: this.list.scrollHeight,
      clientHeight: this.list.clientHeight,
      scrollBlock: this.scrollBlock,
      resizeScrollBlock: this.resizeScrollBlock,
      messages: this.group.messages.length,
      rendered: this.list.querySelectorAll('app-group-message').length,
      loadedAll: this.group.complete,
      typing: this.typingIf.view !== null,
    };
  }

  destroy(): void {
    for (const stop of this.unsubscribe) stop();
    clearInterval(this.typingTimer);
    window.removeEventListener('resize', this.onWindowResize);
    this.resizeObserver?.disconnect();
    this.composerIf.destroy();
    this.collections.destroy();
  }
}
