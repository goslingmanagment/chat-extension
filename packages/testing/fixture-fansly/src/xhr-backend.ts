// The stand page's backend over the fake Fansly's API (R20 P6b): the same
// interface as its in-page backend (backend.ts), answered by real XHR requests
// to the addresses Fansly's client asks (fansly-web.md §4, S2 Q3). Beyond that
// interface it does what Fansly's group service does around those requests:
// - the account cache: accounts come with the inbox (`aggregationData.accounts`)
//   and, for a partner the cache lacks, by `GET /account?ids=` (main:24675-24681);
// - the unread messages: read in chunks at start and when the tab comes back
//   (`GET /message/unread?limit=100&offset=0&before=<last id>`, on an error
//   again after 1 s; main:28758-28806), each not yet delivered one is marked
//   delivered;
// - the marks of delivery and reading, `POST /message/ack {messageIds, type}`:
//   never at once — collected for 1–3 s, then sent by type in chunks of 25,
//   200 ms apart (main:28702-28716, :29121-29133). So opening a chat or sending
//   never makes an ack request inside the gesture.

import type { GroupDetail, HistoryPage, OutgoingMessage, StandBackend, UploadFile } from './backend';
import type { Account, Message, MessageAttachment } from './data';
import type { FanslyHttp } from './http';
import type { WireAccount, WireAccountMe, WireAckBody, WireGroup, WireHistoryPage, WireInboxPage, WireMessage, WireSendBody, WireUnreadPage } from './wire';

const HISTORY_PAGE = 25;
const UNREAD_CHUNK = 100;
/** The page stops reading unread messages past this many (main:28758-28806). */
const UNREAD_MAX = 500;
const ACK_CHUNK = 25;
const ACK_CHUNK_GAP_MS = 200;
/** 2 read, 1 delivered, 3 both, 4 unread: the order the page sends its collected marks in. */
const ACK_ORDER = [2, 1, 3, 4] as const;

export function toMessage(wire: WireMessage): Message {
  return {
    id: wire.id,
    groupId: wire.groupId,
    senderId: wire.senderId,
    content: wire.content,
    createdAt: wire.createdAt,
    attachments: wire.attachments.map((attachment) => ({ contentId: attachment.contentId, contentType: attachment.contentType })),
    type: wire.type,
    correlationId: wire.correlationId,
  };
}

const toAccount = (wire: WireAccount): Account => ({ id: wire.id, username: wire.username, displayName: wire.displayName ?? wire.username });

/** Fansly's own answer to «may this account write to the partner?» in brief: no rule set, or one with every bit met (E155). */
const dmRulesUnmet = (group: WireGroup): boolean => group.dmPermissionFlags.length > 0 && group.dmPermissionFlags.every((rule) => (rule.flags & ~rule.verificationFlags) !== 0);

export interface XhrBackendOptions {
  readonly http: FanslyHttp;
  /** How long the page collects its marks before it sends them: 1–3 s on the site. */
  readonly ackDelay: () => number;
}

export class XhrBackend implements StandBackend {
  creatorId = '';
  /** A group's facts changed after its answer (a partner's account arrived): the store hears of it here. */
  onGroup: (detail: GroupDetail) => void = () => undefined;
  /** The unread messages were read to their end. */
  onUnread: () => void = () => undefined;
  private readonly http: FanslyHttp;
  private readonly ackDelay: () => number;
  private readonly accounts = new Map<string, WireAccount>();
  private readonly groupCache = new Map<string, WireGroup>();
  /** Unread message ids by group, and the inbox's own count for a group whose ids are not read yet. */
  private readonly unreadIds = new Map<string, Set<string>>();
  private readonly unreadCounts = new Map<string, number>();
  private readonly ackQueue = new Map<number, string[]>();
  private readonly acked = new Set<string>();
  private ackTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(options: XhrBackendOptions) {
    this.http = options.http;
    this.ackDelay = options.ackDelay;
  }

  /** The page is going away: no more retries or marks. */
  stop(): void {
    this.stopped = true;
    if (this.ackTimer !== null) clearTimeout(this.ackTimer);
  }

  // ── session ──

  /** `GET /account/me`, the first request of the page: the creator's own account. `unauthorized` — the session is dead. */
  me(done: (account: Account | null, unauthorized: boolean) => void): void {
    this.http.request<WireAccountMe>('GET', '/account/me', null, (error, response, status) => {
      if (error !== null || response === null) {
        done(null, status === 401);
        return;
      }
      this.creatorId = response.account.id;
      this.accounts.set(response.account.id, response.account);
      done(toAccount(response.account), false);
    });
  }

  // ── groups ──

  private detailOf(group: WireGroup): GroupDetail {
    const others = group.users.filter((user) => user.userId !== this.creatorId);
    const first = this.accounts.get(others[0]?.userId ?? '');
    return {
      id: group.id,
      partners: others.map((user) => {
        const account = this.accounts.get(user.userId);
        // An account the cache lacks: the header fills in when `GET /account?ids=` answers.
        return account === undefined ? { id: user.userId, username: '', displayName: '' } : toAccount(account);
      }),
      dmRulesUnmet: dmRulesUnmet(group),
      // The partner's own status; hidden until its account is known.
      status: first !== undefined && first.statusId >= 1 && first.statusId <= 4 ? (first.statusId as 1 | 2 | 3 | 4) : 4,
      unread: this.unreadIds.get(group.id)?.size ?? this.unreadCounts.get(group.id) ?? 0,
      lastMessage: group.lastMessage === null ? null : toMessage(group.lastMessage),
    };
  }

  /** Asks for the accounts the cache lacks; the group's listeners hear when they are in. */
  private resolveAccounts(group: WireGroup): void {
    const missing = group.users.map((user) => user.userId).filter((id) => id !== this.creatorId && !this.accounts.has(id));
    if (missing.length === 0) return;
    this.http.request<WireAccount[]>('GET', `/account?ids=${missing.join(',')}`, null, (error, response) => {
      if (error !== null || response === null) return;
      for (const account of response) this.accounts.set(account.id, account);
      const known = this.groupCache.get(group.id);
      if (known !== undefined) this.onGroup(this.detailOf(known));
    });
  }

  groups(offset: number, limit: number, done: (groups: readonly GroupDetail[]) => void): void {
    // The page's own query (main:28526-28532): every parameter, empty ones too.
    this.http.request<WireInboxPage>('GET', `/messaging/groups?sortOrder=1&flags=0&subscriptionTierId=&listIds=&search=&limit=${limit}&offset=${offset}`, null, (error, response) => {
      if (error !== null || response === null) {
        done([]);
        return;
      }
      for (const account of response.aggregationData.accounts) this.accounts.set(account.id, account);
      for (const entry of response.data) if (!this.unreadIds.has(entry.groupId)) this.unreadCounts.set(entry.groupId, entry.unreadCount);
      const byId = new Map(response.aggregationData.groups.map((group) => [group.id, group]));
      done(
        response.data.flatMap((entry) => {
          const group = byId.get(entry.groupId);
          if (group === undefined) return [];
          this.groupCache.set(group.id, group);
          return [this.detailOf(group)];
        }),
      );
    });
  }

  group(groupId: string, done: (group: GroupDetail | null) => void): void {
    // With the trailing slash (main:28372-28378).
    this.http.request<WireGroup>('GET', `/group/${groupId}/`, null, (error, response) => {
      if (error !== null || response === null) {
        done(null);
        return;
      }
      this.groupCache.set(response.id, response);
      done(this.detailOf(response));
      this.resolveAccounts(response);
    });
  }

  /** A member came or left (socket 4/6, 4/7): the group as the page knows it now. */
  setGroupUser(groupId: string, userId: string, present: boolean): GroupDetail | null {
    const group = this.groupCache.get(groupId);
    if (group === undefined) return null;
    const users = group.users.filter((user) => user.userId !== userId);
    const changed: WireGroup = { ...group, users: present ? [...users, { groupId, userId, type: 0, permissionFlags: 0 }] : users };
    this.groupCache.set(groupId, changed);
    this.resolveAccounts(changed);
    return this.detailOf(changed);
  }

  // ── messages ──

  history(groupId: string, before: string | null, done: (page: HistoryPage) => void): void {
    // `before` first, then `limit` (main:28396-28404); never `offset` or `after`.
    this.http.request<WireHistoryPage>('GET', `/message?groupId=${groupId}${before === null ? '' : `&before=${before}`}&limit=${HISTORY_PAGE}`, null, (error, response) => {
      if (error !== null || response === null) {
        done({ messages: [], complete: false });
        return;
      }
      // Newest first on the wire: the page reverses them.
      done({ messages: [...response.messages].reverse().map(toMessage), complete: response.messages.length < HISTORY_PAGE });
    });
  }

  /** `GET /messages?ids=`: what a message-like notification asks for (main:28388-28394, :72183-72188). */
  messagesByIds(ids: readonly string[], done: (messages: readonly Message[]) => void): void {
    this.http.request<WireHistoryPage>('GET', `/messages?ids=${ids.join(',')}`, null, (error, response) => {
      done(error !== null || response === null ? [] : response.messages.map(toMessage));
    });
  }

  send(message: OutgoingMessage, done: (sent: Message | null) => void): void {
    const body: WireSendBody = {
      type: 1,
      attachments: message.attachments.map((attachment, pos) => ({ messageId: null, pos, contentId: attachment.contentId, contentType: attachment.contentType })),
      likes: [],
      content: message.content,
      groupId: message.groupId,
      scheduledFor: 0,
      inReplyTo: null,
      createdAt: Date.now() / 1000,
    };
    this.http.request<WireMessage>('POST', '/message', body, (error, response) => done(error !== null || response === null ? null : toMessage(response)), {
      groupId: message.groupId,
      content: message.content,
      attachments: message.attachments.length,
    });
  }

  typing(groupId: string): void {
    this.http.request<unknown>('POST', '/message/typing', { groupId }, () => undefined, { groupId });
  }

  createMedia(files: readonly UploadFile[], done: (attachments: readonly MessageAttachment[]) => void): void {
    this.http.request<MessageAttachment[]>('POST', '/account/media', files, (error, response) => done(error !== null || response === null ? [] : response), { files: files.length });
  }

  automated(): void {
    this.http.request<unknown>('GET', '/message/automated', null, () => undefined);
  }

  // ── unread and the page's marks ──

  /** A fan's message arrived (socket 5/1) and is not read yet. */
  noteUnread(groupId: string, messageId: string): void {
    const ids = this.unreadIds.get(groupId) ?? new Set<string>();
    ids.add(messageId);
    this.unreadIds.set(groupId, ids);
  }

  /** The account read messages somewhere (its own receipt, socket 4/2). */
  clearUnread(messageIds: readonly string[]): void {
    for (const ids of this.unreadIds.values()) for (const id of messageIds) ids.delete(id);
  }

  unreadOf(groupId: string): number {
    return this.unreadIds.get(groupId)?.size ?? this.unreadCounts.get(groupId) ?? 0;
  }

  /** `getUnreadInChunks`: every unread message, a chunk at a time, older and older. */
  readUnread(): void {
    this.unreadIds.clear();
    let before = '0';
    let read = 0;
    let gap = 500;
    const next = (): void => {
      if (this.stopped) return;
      this.http.request<WireUnreadPage>('GET', `/message/unread?limit=${UNREAD_CHUNK}&offset=0&before=${before}`, null, (error, response) => {
        if (error !== null || response === null) {
          setTimeout(next, 1000);
          return;
        }
        for (const item of response.messageInteractions) {
          if (item.deletedAt === null && item.validMessage) {
            this.noteUnread(item.groupId, item.messageId);
            if (item.deliveredAt === 0) this.ackMessage(1, item.messageId);
          }
          before = item.messageId;
        }
        read += UNREAD_CHUNK;
        const done = response.total > 0 ? read >= response.total : response.messageInteractions.length < UNREAD_CHUNK;
        if (done || read > UNREAD_MAX) {
          this.onUnread();
          return;
        }
        setTimeout(() => {
          gap += 100;
          next();
        }, gap);
      });
    };
    next();
  }

  /** `markGroupAsRead`: every unread message of the group gets a «read» mark — queued, not sent (main:29138-29144). */
  ack(groupId: string): void {
    const ids = [...(this.unreadIds.get(groupId) ?? [])];
    this.unreadIds.delete(groupId);
    this.unreadCounts.set(groupId, 0);
    for (const id of ids) this.ackMessage(2, id);
  }

  /** One mark into the page's queue: sent with the rest after the collecting delay. */
  ackMessage(type: number, messageId: string): void {
    const key = `${messageId}_${type}`;
    if (this.acked.has(key)) return;
    this.acked.add(key);
    this.ackQueue.set(type, [...(this.ackQueue.get(type) ?? []), messageId]);
    this.scheduleAcks();
  }

  private scheduleAcks(): void {
    if (this.ackTimer !== null || this.stopped) return;
    this.ackTimer = setTimeout(() => {
      const batches = ACK_ORDER.flatMap((type) => {
        const ids = this.ackQueue.get(type) ?? [];
        return ids.length > 0 ? [{ type, ids }] : [];
      });
      this.ackQueue.clear();
      this.acked.clear();
      let pending = batches.length;
      const finished = (): void => {
        pending -= 1;
        if (pending > 0) return;
        this.ackTimer = null;
        if (this.ackQueue.size > 0) this.scheduleAcks();
      };
      if (pending === 0) this.ackTimer = null;
      for (const batch of batches) this.sendAckChunks(batch.type, batch.ids, 0, finished);
    }, this.ackDelay());
  }

  private sendAckChunks(type: number, ids: readonly string[], from: number, done: () => void): void {
    const chunk = ids.slice(from, from + ACK_CHUNK);
    if (chunk.length === 0 || this.stopped) {
      done();
      return;
    }
    const body: WireAckBody = { messageIds: chunk, type };
    this.http.request<unknown>('POST', '/message/ack', body, () => setTimeout(() => this.sendAckChunks(type, ids, from + chunk.length, done), ACK_CHUNK_GAP_MS), { messageIds: chunk.length, ackType: type });
  }
}
