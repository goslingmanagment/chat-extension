// The page's group service, as Fansly's behaves where the extension meets it:
// a cache of groups (from the inbox pages and `GET /group/<id>/`), each
// group's loaded messages, the draft cache by group id — in memory only, lost
// on reload (main:28636-28641) — and the events the components listen to.

import type { GroupDetail, OutgoingMessage, StandBackend, UploadFile } from './backend';
import type { Account, Message, MessageAttachment } from './data';

export interface PageMessage extends Message {
  /** Optimistic: shown before `POST /message` answered (main:29012-29023). */
  readonly queued: boolean;
}

export interface Group {
  readonly id: string;
  partners: readonly Account[];
  dmRulesUnmet: boolean;
  status: 1 | 2 | 3 | 4;
  unread: number;
  lastMessage: Message | null;
  /** Loaded messages, oldest first. */
  messages: PageMessage[];
  /** The latest page is in: re-entering the chat asks for nothing (A → B → A, fansly-web.md §4). */
  latestLoaded: boolean;
  /** Nothing older is left on the server. */
  complete: boolean;
  loadingOlder: boolean;
}

type GroupEvent = 'collection' | 'change';
type MessageListener = (message: PageMessage) => void;

let queuedSeq = 0;

export class GroupService {
  private readonly cache = new Map<string, Group>();
  private readonly inboxIds: string[] = [];
  private readonly drafts = new Map<string, string>();
  private readonly groupsListeners = new Set<() => void>();
  private readonly listeners = new Map<string, Set<(event: GroupEvent) => void>>();
  private readonly messageListeners = new Map<string, Set<MessageListener>>();
  private readonly typingListeners = new Set<(groupId: string, accountId: string) => void>();
  private inboxLoading = false;
  private inboxComplete = false;
  activeGroupId: string | null = null;

  constructor(
    readonly creator: Account,
    private readonly backend: StandBackend,
  ) {}

  // ── groups ──

  getGroup(groupId: string): Group | null {
    return this.cache.get(groupId) ?? null;
  }

  /** Forgets a group (a test's control): the next entry waits for `GET /group/<id>/`. */
  forget(groupId: string): void {
    this.cache.delete(groupId);
  }

  /** `GET /group/<id>/` on every entry into a chat; its answer refreshes the cache and tells every listener. */
  fetchGroup(groupId: string): void {
    this.backend.group(groupId, (detail) => {
      if (detail !== null) this.upsert(detail);
      this.emitGroupsChange();
    });
  }

  get inbox(): readonly string[] {
    return this.inboxIds;
  }

  get inboxDone(): boolean {
    return this.inboxComplete;
  }

  /** The next 20 groups of the inbox (main:73846-73868). */
  loadInbox(limit: number, done: () => void): void {
    if (this.inboxLoading || this.inboxComplete) return;
    this.inboxLoading = true;
    this.backend.groups(this.inboxIds.length, limit, (groups) => {
      this.inboxLoading = false;
      if (groups.length < limit) this.inboxComplete = true;
      for (const detail of groups) {
        this.upsert(detail);
        if (!this.inboxIds.includes(detail.id)) this.inboxIds.push(detail.id);
      }
      this.emitGroupsChange();
      done();
    });
  }

  onGroupsChange(listener: () => void): () => void {
    this.groupsListeners.add(listener);
    return () => this.groupsListeners.delete(listener);
  }

  emitGroupsChange(): void {
    for (const listener of [...this.groupsListeners]) listener();
  }

  /** The group changed under the page (participants, DM rules, status): its components re-render. */
  patch(groupId: string, change: Partial<Pick<Group, 'partners' | 'dmRulesUnmet' | 'status'>>): void {
    const group = this.cache.get(groupId);
    if (group === undefined) return;
    Object.assign(group, change);
    this.emit(groupId, 'change');
    this.emitGroupsChange();
  }

  on(groupId: string, listener: (event: GroupEvent) => void): () => void {
    const set = this.listeners.get(groupId) ?? new Set();
    set.add(listener);
    this.listeners.set(groupId, set);
    return () => set.delete(listener);
  }

  onMessage(groupId: string, listener: MessageListener): () => void {
    const set = this.messageListeners.get(groupId) ?? new Set();
    set.add(listener);
    this.messageListeners.set(groupId, set);
    return () => set.delete(listener);
  }

  /** The socket's typing announcements (5/22), for every group: each container keeps its own. */
  onTyping(listener: (groupId: string, accountId: string) => void): () => void {
    this.typingListeners.add(listener);
    return () => this.typingListeners.delete(listener);
  }

  private emit(groupId: string, event: GroupEvent): void {
    for (const listener of [...(this.listeners.get(groupId) ?? [])]) listener(event);
  }

  private upsert(detail: GroupDetail): Group {
    const known = this.cache.get(detail.id);
    if (known !== undefined) {
      known.partners = detail.partners;
      known.dmRulesUnmet = detail.dmRulesUnmet;
      known.status = detail.status;
      known.lastMessage = detail.lastMessage;
      if (detail.id !== this.activeGroupId) known.unread = detail.unread;
      return known;
    }
    const group: Group = { ...detail, partners: detail.partners, messages: [], latestLoaded: false, complete: false, loadingOlder: false };
    this.cache.set(detail.id, group);
    return group;
  }

  // ── messages ──

  /**
   * The latest page once per group (later entries ask for nothing), or the page before the oldest loaded message
   * (`scrollTop = 0`, main:59212-59218). `done` runs after the messages are in.
   */
  fetchGroupMessages(groupId: string, older = false, done?: () => void): void {
    const group = this.cache.get(groupId);
    if (group === undefined) return;
    if (!older && group.latestLoaded) return;
    if (older && (group.complete || group.loadingOlder)) return;
    const before = older ? (group.messages.find((message) => !message.queued)?.id ?? null) : null;
    if (older) group.loadingOlder = true;
    else group.latestLoaded = true;
    this.backend.history(groupId, before, (page) => {
      const loaded = page.messages.map((message): PageMessage => ({ ...message, queued: false }));
      if (older) {
        group.loadingOlder = false;
        group.messages = [...loaded, ...group.messages];
      } else {
        const known = new Set(group.messages.map((message) => message.id));
        group.messages = [...loaded.filter((message) => !known.has(message.id)), ...group.messages];
      }
      group.complete = page.complete;
      this.emit(groupId, 'collection');
      done?.();
    });
  }

  setActiveGroup(group: Group | null): void {
    this.activeGroupId = group?.id ?? null;
    if (group !== null) this.markGroupAsRead(group);
  }

  /** `POST /message/ack` when the open chat has unread messages (main:28316-28323, :29138-29144). */
  markGroupAsRead(group: Group): void {
    if (group.unread <= 0) return;
    group.unread = 0;
    this.backend.ack(group.id);
    this.emitGroupsChange();
  }

  /**
   * The composer's send (main:29012-29023): an optimistic queued message, the chat marked read, then
   * `POST /message` — all in this call, so inside the handler that called it.
   */
  sendMessageToGroup(message: OutgoingMessage): void {
    const group = this.cache.get(message.groupId);
    if (group === undefined) return;
    queuedSeq += 1;
    const queued: PageMessage = { id: `queued-${queuedSeq}`, groupId: group.id, senderId: this.creator.id, content: message.content, createdAt: message.createdAt, attachments: message.attachments, queued: true };
    group.messages = [...group.messages, queued];
    this.markGroupAsRead(group);
    this.emit(group.id, 'collection');
    this.backend.send(message, (sent) => {
      group.messages = group.messages.flatMap((item) => (item !== queued ? [item] : sent === null ? [] : [{ ...sent, queued: false }]));
      if (sent !== null) group.lastMessage = sent;
      this.emit(group.id, 'collection');
      this.emitGroupsChange();
    });
  }

  announceTyping(groupId: string): void {
    this.backend.typing(groupId);
  }

  /** The automated texts the composer asks for when it is created. */
  automatedMessages(): void {
    this.backend.automated();
  }

  /** Account media for the composer's uploaded templates, before the send that carries them. */
  createMedia(files: readonly UploadFile[], done: (attachments: readonly MessageAttachment[]) => void): void {
    this.backend.createMedia(files, done);
  }

  /** A message the socket brings (5/1): into the loaded list, then to the group's listeners. */
  receive(message: Message): void {
    const group = this.cache.get(message.groupId);
    if (group === undefined) return;
    const item: PageMessage = { ...message, queued: false };
    if (group.latestLoaded) group.messages = [...group.messages, item];
    group.lastMessage = message;
    if (group.id !== this.activeGroupId) group.unread += 1;
    for (const listener of [...(this.messageListeners.get(group.id) ?? [])]) listener(item);
    this.emitGroupsChange();
  }

  typing(groupId: string, accountId: string): void {
    for (const listener of [...this.typingListeners]) listener(groupId, accountId);
  }

  // ── drafts ──

  getCachedDmContent(key: string): string {
    return this.drafts.get(key) ?? '';
  }

  cacheDmContent(key: string, content: string): void {
    this.drafts.set(key, content);
  }
}
