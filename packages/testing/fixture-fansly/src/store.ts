// The page's group service, as Fansly's behaves where the extension meets it:
// a cache of groups (from the inbox pages and `GET /group/<id>/`), each
// group's loaded messages, the draft cache by group id — in memory only, lost
// on reload (main:28636-28641) — and the events the components listen to.

import type { GroupDetail, OutgoingMessage, StandBackend, UploadFile } from './backend';
import type { Account, Message, MessageAttachment } from './data';
import { compareIds } from './wire';

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

/** `collection` — messages came; `removed` — some were deleted (the list is rendered anew); `change` — the group's own facts. */
type GroupEvent = 'collection' | 'removed' | 'change';
type MessageListener = (message: PageMessage) => void;

let queuedSeq = 0;

/** Loaded messages with more of them: none twice, in id order (the snowflake's), the queued ones — not sent yet — last. */
function merged(known: readonly PageMessage[], more: readonly PageMessage[]): PageMessage[] {
  const byId = new Map<string, PageMessage>();
  for (const message of [...known, ...more]) if (!message.queued) byId.set(message.id, message);
  return [...[...byId.values()].sort((a, b) => compareIds(a.id, b.id)), ...known.filter((message) => message.queued)];
}

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
    /** The session's own account: the stand's seed until `GET /account/me` names it (the fake Fansly, R20 P6b). */
    public creator: Account,
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
      if (older) group.loadingOlder = false;
      // A fresh end asked again (after the socket's `t: 1`) brings what the page missed: merged in, nothing twice.
      group.messages = merged(group.messages, loaded);
      // A fresh end asked again says nothing about the older pages already loaded.
      if (older || !group.complete) group.complete = page.complete;
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
      // The socket's echo of the same message may have come first: it is in the list already.
      const rest = group.messages.filter((item) => item !== queued);
      const echoed = sent !== null && rest.some((item) => item.id === sent.id);
      group.messages = sent === null ? rest : merged(rest, [{ ...sent, queued: false }]);
      if (sent !== null) group.lastMessage = sent;
      // The echo took the message's place already: one bubble fewer — the list is rendered anew.
      this.emit(group.id, echoed || sent === null ? 'removed' : 'collection');
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

  /** A message the socket brings (5/1): into the loaded list, then to the group's listeners. One the page has already is not taken twice. */
  receive(message: Message): void {
    const group = this.cache.get(message.groupId);
    if (group === undefined) return;
    if (group.messages.some((known) => known.id === message.id)) return;
    const item: PageMessage = { ...message, queued: false };
    if (group.latestLoaded) group.messages = merged(group.messages, [item]);
    group.lastMessage = message;
    if (group.id !== this.activeGroupId && message.senderId !== this.creator.id) group.unread += 1;
    for (const listener of [...(this.messageListeners.get(group.id) ?? [])]) listener(item);
    this.emitGroupsChange();
  }

  /**
   * The socket verified a session (`t: 1`) or the tab came back after 30 s: every group's «latest page is in» mark
   * is dropped and the open chat's fresh end is asked again; the others ask when they are opened next
   * (main:28595-28603, :28684-28687).
   */
  resetFetched(): void {
    for (const group of this.cache.values()) group.latestLoaded = false;
    if (this.activeGroupId !== null) this.fetchGroupMessages(this.activeGroupId);
  }

  /** A deleted message (5/10) leaves the list it is in. */
  remove(messageId: string): void {
    this.removeWhere((message) => message.id === messageId);
  }

  /**
   * The copies of a deleted mass send: in EVERY group, queued ones too, each message whose `correlationId` is the
   * deleted parent's id (main:28943-28950).
   */
  removeCorrelated(parentId: string): void {
    this.removeWhere((message) => message.correlationId === parentId);
  }

  private removeWhere(gone: (message: PageMessage) => boolean): void {
    let any = false;
    for (const group of this.cache.values()) {
      const kept = group.messages.filter((message) => !gone(message));
      if (kept.length === group.messages.length) continue;
      group.messages = kept;
      any = true;
      this.emit(group.id, 'removed');
    }
    if (any) this.emitGroupsChange();
  }

  /** The loaded message with this id, in whatever group. */
  messageById(messageId: string): PageMessage | null {
    for (const group of this.cache.values()) {
      const found = group.messages.find((message) => message.id === messageId);
      if (found !== undefined) return found;
    }
    return null;
  }

  /** The unread counts were read anew (the unread messages, a receipt of the account's own). */
  refreshUnread(countOf: (groupId: string) => number): void {
    for (const group of this.cache.values()) if (group.id !== this.activeGroupId) group.unread = countOf(group.id);
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
