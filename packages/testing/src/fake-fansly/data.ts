// The fake Fansly's world (R20 P6b): what its API answers from and its socket
// tells about — one creator, the conversations of the stand page's synthetic
// world (fixture-fansly/src/data.ts: the same ids, so a page and a test name
// the same chats), their accounts, the creator's followers, notes, automated
// texts and vault albums. Nothing here is real: ids are Fansly-shaped
// snowflakes kept as strings, names and texts are made up, and an avatar's
// address is data nobody loads. The shapes it serialises to are
// fixture-fansly/src/wire.ts, where each one's source is named.

import { createWorld } from '../../fixture-fansly/src/data';
import {
  compareIds,
  snowflakeAt,
  snowflakeMs,
  type WireAccount,
  type WireAttachment,
  type WireAutomatedMessage,
  type WireAvatar,
  type WireFollow,
  type WireFollowersPage,
  type WireGroup,
  type WireGroupUser,
  type WireHistoryPage,
  type WireInboxEntry,
  type WireInboxPage,
  type WireMessage,
  type WireNote,
  type WireUnreadPage,
  type WireVaultAlbum,
  type WireVaultAlbumMediaPage,
  type WireVaultAlbums,
} from '../../fixture-fansly/src/wire';

/** A page of history as Fansly serves it (`limit=25`, main:28989-28995). */
export const HISTORY_PAGE = 25;
/** `contentType` of a regular note and of the custom name (old `fan-notes.ts`). */
export const NOTE_TYPE = { note: 12000, customName: 12002 } as const;
/** `type` of a message: a person's, an automation's, the parent of a mass send. */
export const MESSAGE_TYPE = { message: 1, automated: 2, broadcast: 3 } as const;
/** `type` of a group: a conversation, the creator's mass-send group. */
export const GROUP_TYPE = { conversation: 1, broadcast: 3 } as const;
/** Followers the world starts with: two pages of the pass's `limit=100` (old `getFollowerPage`). */
/** Fansly's CDN as the fake world addresses the accounts' pictures: the window of «Новые» shows them (X59). */
export const FAKE_FANSLY_MEDIA_HOST = 'cdn3.fansly.com';

export const SEED_FOLLOWERS = 150;
/** Of them, the first ones already have a conversation (a fan of the inbox); the rest have none yet. */
export const SEED_FOLLOWERS_WITH_CHAT = 40;

const FOLLOWER_ACCOUNT_BASE = 930_000_000_000_000_000n;
const BROADCAST_GROUP_ID = '805000000000000009';

export interface FakeNote {
  readonly id: string;
  readonly contentType: number;
  /** The account the note is about. */
  readonly contentId: string;
  title: string;
  note: string;
  readonly createdAt: number;
  updatedAt: number | null;
}

export interface FakeAccount {
  readonly id: string;
  username: string;
  displayName: string;
  /** 1 online, 2 away, 3 offline, 4 hidden. */
  statusId: number;
  lastSeenAt: number;
  about: string;
  followsCreator: boolean;
  /** The creator's notes on this account, in Fansly's own order (as stored). */
  readonly notes: FakeNote[];
}

export interface FakeMessage {
  readonly id: string;
  readonly groupId: string;
  readonly senderId: string;
  readonly type: number;
  readonly content: string;
  /** Seconds. */
  readonly createdAt: number;
  readonly correlationId: string | null;
  readonly inReplyTo: string | null;
  readonly attachments: readonly WireAttachment[];
  /** Who has it delivered and read, by account id (milliseconds; 0 — not yet). */
  readonly interactions: Map<string, { readAt: number; deliveredAt: number }>;
}

export interface FakeGroup {
  readonly id: string;
  readonly type: number;
  readonly createdBy: string;
  /** The conversation's fan — its first member besides the creator; null for the mass-send group. */
  readonly fanId: string | null;
  /** Account ids, the creator among them. */
  users: string[];
  /** Oldest first. */
  readonly history: FakeMessage[];
  /** Ids of the messages the creator has not read. */
  readonly unread: Set<string>;
  /** The partner's DM rules are not met: the page hides its composer (E155). */
  dmRulesUnmet: boolean;
  /** The pass fixture's unpaid DM price (R20 P10d), in Fansly's mills. */
  dmPriceMills?: number;
}

export interface FakeFollow {
  readonly id: string;
  readonly followerId: string;
}

export interface FakeAlbum {
  readonly id: string;
  readonly type: number;
  title: string;
  /** Oldest first: the page lists the newest first. */
  readonly mediaIds: string[];
}

/** An account medium the page uploaded (the stand's `POST /account/media`): its file name for the vault's cards. */
export interface FakeMedia {
  readonly id: string;
  readonly filename: string | null;
  readonly mimetype: string;
  readonly createdAt: number;
}

export interface NewMessage {
  readonly groupId: string;
  readonly senderId: string;
  readonly content: string;
  readonly type?: number;
  readonly correlationId?: string | null;
  readonly inReplyTo?: string | null;
  readonly attachments?: readonly WireAttachment[];
  /** Seconds; now by default. A socket message older than 180 s is dropped by the page (main:29054-29071). */
  readonly createdAt?: number;
  /** A given id (a test of id order or of a 19-digit id); a fresh snowflake by default. */
  readonly id?: string;
}

const EMPTY_HISTORY: Omit<WireHistoryPage, 'messages'> = { accountMedia: [], accountMediaBundles: [], tips: [], tipGoals: [], accountMediaOrders: [], stories: [], storyOrders: [] };

/** Ids in creation order: a snowflake of the moment, never repeated and never going back. */
class Snowflakes {
  private last = 0n;

  next(ms = Date.now()): string {
    let id = BigInt(snowflakeAt(ms));
    if (id <= this.last) id = this.last + 1n;
    this.last = id;
    return String(id);
  }
}

export class FanslyWorld {
  readonly creatorId: string;
  readonly accounts = new Map<string, FakeAccount>();
  readonly groups = new Map<string, FakeGroup>();
  readonly messages = new Map<string, FakeMessage>();
  /** Newest first. */
  readonly follows: FakeFollow[] = [];
  /** Fans whose DM rules the creator does not meet: the chat `POST /group` makes for one carries them (R20 P10b2). */
  private readonly dmClosed = new Set<string>();
  readonly automated: WireAutomatedMessage[];
  readonly albums: FakeAlbum[];
  /** The account's media by id: what the page uploaded. */
  readonly media = new Map<string, FakeMedia>();
  /** The creator's mass-send group: the parents of its mass sends live there. */
  readonly broadcastGroupId = BROADCAST_GROUP_ID;
  private readonly ids = new Snowflakes();

  constructor(readonly startedAt = Date.now(), creatorId?: string) {
    const seed = createWorld(creatorId);
    this.creatorId = seed.creator.id;
    this.accounts.set(seed.creator.id, this.newAccount(seed.creator.id, seed.creator.username, seed.creator.displayName, 1));
    for (const seeded of seed.groups) {
      for (const partner of seeded.partners) this.accounts.set(partner.id, this.newAccount(partner.id, partner.username, partner.displayName, seeded.status));
      const group: FakeGroup = { id: seeded.id, type: GROUP_TYPE.conversation, createdBy: seeded.fan.id, fanId: seeded.fan.id, users: [seed.creator.id, ...seeded.partners.map((partner) => partner.id)], history: [], unread: new Set(), dmRulesUnmet: seeded.dmRulesUnmet };
      for (const message of seeded.history) {
        const mine = message.senderId === seed.creator.id;
        const stored: FakeMessage = {
          id: message.id,
          groupId: seeded.id,
          senderId: message.senderId,
          type: MESSAGE_TYPE.message,
          content: message.content,
          createdAt: message.createdAt,
          correlationId: null,
          inReplyTo: null,
          attachments: [],
          interactions: new Map([[mine ? seeded.fan.id : seed.creator.id, { readAt: message.createdAt * 1000, deliveredAt: message.createdAt * 1000 }]]),
        };
        group.history.push(stored);
        this.messages.set(stored.id, stored);
      }
      // The seed's unread count: the fan's newest messages.
      const fromFan = group.history.filter((item) => item.senderId !== seed.creator.id);
      for (const message of seeded.unread > 0 ? fromFan.slice(-seeded.unread) : []) this.markUnread(group, message);
      this.groups.set(group.id, group);
    }
    this.groups.set(BROADCAST_GROUP_ID, { id: BROADCAST_GROUP_ID, type: GROUP_TYPE.broadcast, createdBy: seed.creator.id, fanId: null, users: [seed.creator.id], history: [], unread: new Set(), dmRulesUnmet: false });

    // Followers, newest first: the newest followed five minutes before the start, the oldest about a week before.
    const fans = seed.groups.map((group) => group.fan.id);
    for (let index = 0; index < SEED_FOLLOWERS; index += 1) {
      const followedAt = startedAt - Math.round((5 + index * index * 0.45) * 60_000);
      let followerId = fans[index * 3];
      if (index >= SEED_FOLLOWERS_WITH_CHAT || followerId === undefined) {
        followerId = String(FOLLOWER_ACCOUNT_BASE + BigInt(index * 31 + 7));
        this.accounts.set(followerId, this.newAccount(followerId, `stand_follower_${index + 1}`, `Stand Follower ${index + 1}`, 3));
      }
      const account = this.accounts.get(followerId);
      if (account !== undefined) account.followsCreator = true;
      this.follows.push({ id: snowflakeAt(followedAt, index), followerId });
    }

    this.automated = [
      { id: '806000000000000011', accountId: seed.creator.id, type: 1, status: 1, messageTemplate: JSON.stringify({ type: 1, content: 'Stand welcome: thanks for the follow', attachments: [] }) },
      { id: '806000000000000012', accountId: seed.creator.id, type: 2, status: 1, messageTemplate: JSON.stringify({ type: 1, content: 'Stand welcome: thanks for subscribing', attachments: [] }) },
      // An automation with media only: no text to match.
      { id: '806000000000000013', accountId: seed.creator.id, type: 3, status: 1, messageTemplate: JSON.stringify({ type: 1, content: null, attachments: [] }) },
    ];
    this.albums = [
      { id: '807000000000000021', type: 0, title: 'Stand album', mediaIds: [] },
      { id: '807000000000000022', type: 0, title: 'Stand album 2', mediaIds: [] },
    ];
  }

  // ── ids and accounts ──

  nextId(ms = Date.now()): string {
    return this.ids.next(ms);
  }

  private newAccount(id: string, username: string, displayName: string, statusId: number): FakeAccount {
    return { id, username, displayName, statusId, lastSeenAt: this.startedAt - 60_000, about: `About ${username}`, followsCreator: false, notes: [] };
  }

  /** The account, made up on first mention (a fan a test names, a guest of a group chat). */
  ensureAccount(id: string): FakeAccount {
    let account = this.accounts.get(id);
    if (account === undefined) {
      account = this.newAccount(id, `stand_account_${id.slice(-6)}`, `Stand Account ${id.slice(-4)}`, 3);
      this.accounts.set(id, account);
    }
    return account;
  }

  // ── groups ──

  /** The fan of a one-to-one conversation (null for a group chat — more than two members — or the mass-send group). */
  fanOf(group: FakeGroup): string | null {
    return group.type === GROUP_TYPE.conversation && group.users.length === 2 ? group.fanId : null;
  }

  /**
   * Sets a conversation's members other than the creator to its fan and `count - 1` made-up guests (0 — nobody).
   * Returns who came and who left: the page hears of each by a `4/6` or `4/7` frame.
   */
  setPartners(group: FakeGroup, count: number): { readonly added: string[]; readonly removed: string[] } {
    const fan = group.fanId;
    if (fan === null) return { added: [], removed: [] };
    // The same guest ids as the stand page's own control makes (fixture-fansly/src/control.ts).
    const partners = Array.from({ length: count }, (_, index) => (index === 0 ? fan : `${fan.slice(0, -2)}${String(50 + index)}`));
    for (const id of partners) this.ensureAccount(id);
    const before = group.users.filter((id) => id !== this.creatorId);
    group.users = [this.creatorId, ...partners];
    return { added: partners.filter((id) => !before.includes(id)), removed: before.filter((id) => !partners.includes(id)) };
  }

  conversationWith(fanId: string): FakeGroup | null {
    for (const group of this.groups.values()) if (this.fanOf(group) === fanId) return group;
    return null;
  }

  /** `POST /group`: the fan's existing conversation, however old, and only otherwise a new empty one. */
  createConversation(fanId: string): { readonly group: FakeGroup; readonly created: boolean } {
    const known = this.conversationWith(fanId);
    if (known !== null) return { group: known, created: false };
    this.ensureAccount(fanId);
    const group: FakeGroup = { id: this.nextId(), type: GROUP_TYPE.conversation, createdBy: this.creatorId, fanId, users: [this.creatorId, fanId], history: [], unread: new Set(), dmRulesUnmet: this.dmClosed.has(fanId) };
    this.groups.set(group.id, group);
    return { group, created: true };
  }

  /** Conversations as the inbox lists them: the newest last message first; one without messages after the rest. */
  inbox(search = ''): FakeGroup[] {
    const term = search.trim().toLowerCase();
    const newest = (group: FakeGroup): string => group.history.at(-1)?.id ?? '';
    return [...this.groups.values()]
      .filter((group) => group.type === GROUP_TYPE.conversation)
      .filter((group) => term === '' || (this.partnerName(group) ?? '').includes(term))
      .sort((a, b) => compareIds(newest(b), newest(a)) || compareIds(b.id, a.id));
  }

  /** `partnerUsername` of the inbox: `lower(displayName || username)`, what `search` matches (old types.ts). */
  private partnerName(group: FakeGroup): string | null {
    const fan = this.fanOf(group);
    const account = fan === null ? undefined : this.accounts.get(fan);
    return account === undefined ? null : (account.displayName || account.username).toLowerCase();
  }

  // ── messages ──

  addMessage(input: NewMessage): FakeMessage {
    const group = this.groups.get(input.groupId);
    if (group === undefined) throw new Error(`no group ${input.groupId}`);
    const createdAt = input.createdAt ?? Date.now() / 1000;
    const message: FakeMessage = {
      id: input.id ?? this.nextId(),
      groupId: group.id,
      senderId: input.senderId,
      type: input.type ?? MESSAGE_TYPE.message,
      content: input.content,
      createdAt: Math.floor(createdAt),
      correlationId: input.correlationId ?? null,
      inReplyTo: input.inReplyTo ?? null,
      attachments: (input.attachments ?? []).map((attachment, pos) => ({ ...attachment, pos })),
      interactions: new Map(),
    };
    group.history.push(message);
    group.history.sort((a, b) => compareIds(a.id, b.id));
    this.messages.set(message.id, message);
    if (message.senderId !== this.creatorId) this.markUnread(group, message);
    return message;
  }

  private markUnread(group: FakeGroup, message: FakeMessage): void {
    group.unread.add(message.id);
    message.interactions.set(this.creatorId, { readAt: 0, deliveredAt: 0 });
  }

  /**
   * A mass send: its parent (`type 3`) in the creator's mass-send group and a copy in every named conversation, each
   * carrying the parent's id as `correlationId` (no `inReplyTo`: the old extension's «automated» mark, NF-033).
   */
  broadcast(content: string, groupIds: readonly string[]): { readonly parent: FakeMessage; readonly copies: FakeMessage[] } {
    const parent = this.addMessage({ groupId: BROADCAST_GROUP_ID, senderId: this.creatorId, content, type: MESSAGE_TYPE.broadcast });
    const copies = groupIds.map((groupId) => this.addMessage({ groupId, senderId: this.creatorId, content, correlationId: parent.id }));
    return { parent, copies };
  }

  /**
   * Deletes a message. A `type 3` parent takes with it, in every group, the messages whose `correlationId` is its id
   * (what the page does on the one `5/10` frame it gets, main:28943-28950).
   */
  deleteMessage(messageId: string): { readonly deleted: FakeMessage; readonly cascade: FakeMessage[] } | null {
    const deleted = this.messages.get(messageId);
    if (deleted === undefined) return null;
    const cascade = deleted.type === MESSAGE_TYPE.broadcast ? [...this.messages.values()].filter((message) => message.correlationId === deleted.id) : [];
    for (const message of [deleted, ...cascade]) {
      this.messages.delete(message.id);
      const group = this.groups.get(message.groupId);
      if (group === undefined) continue;
      const index = group.history.indexOf(message);
      if (index >= 0) group.history.splice(index, 1);
      group.unread.delete(message.id);
    }
    return { deleted, cascade };
  }

  /** A page of a group's history: the newest `limit` messages older than `before` (null — the fresh end), newest first. */
  history(groupId: string, before: string | null, limit = HISTORY_PAGE): FakeMessage[] {
    const all = this.groups.get(groupId)?.history ?? [];
    const older = before === null ? all : all.filter((message) => compareIds(message.id, before) < 0);
    return older.slice(Math.max(0, older.length - limit)).reverse();
  }

  /** The creator's unread messages, newest first, older than `before`. */
  unread(before: string | null, limit: number, offset: number): { readonly page: FakeMessage[]; readonly total: number } {
    const all = [...this.groups.values()]
      .flatMap((group) => [...group.unread])
      .flatMap((id) => this.messages.get(id) ?? [])
      .sort((a, b) => compareIds(b.id, a.id));
    const older = before === null ? all : all.filter((message) => compareIds(message.id, before) < 0);
    return { page: older.slice(offset, offset + limit), total: all.length };
  }

  /** `POST /message/ack`: 1 delivered, 2 read, 3 both, 4 unread again. Returns the messages it touched. */
  ack(userId: string, messageIds: readonly string[], type: number, now = Date.now()): FakeMessage[] {
    const touched: FakeMessage[] = [];
    for (const id of messageIds) {
      const message = this.messages.get(id);
      const group = message === undefined ? undefined : this.groups.get(message.groupId);
      if (message === undefined || group === undefined || !group.users.includes(userId) || message.senderId === userId) continue;
      const state = message.interactions.get(userId) ?? { readAt: 0, deliveredAt: 0 };
      if (type === 1 || type === 3) state.deliveredAt ||= now;
      if (type === 2 || type === 3) state.readAt ||= now;
      if (type === 4) state.readAt = 0;
      message.interactions.set(userId, state);
      if (userId === this.creatorId) {
        if (type === 2 || type === 3) group.unread.delete(id);
        if (type === 4) group.unread.add(id);
      }
      touched.push(message);
    }
    return touched;
  }

  // ── followers ──

  /** A new follower, now: a made-up account unless one is named; `dmRulesUnmet` — the fan's DMs are closed to the creator. */
  follow(followerId?: string, dmRulesUnmet = false): FakeFollow {
    const id = followerId ?? String(FOLLOWER_ACCOUNT_BASE + 900_000n + BigInt(this.follows.length * 17 + 5));
    if (dmRulesUnmet) this.dmClosed.add(id);
    const account = this.ensureAccount(id);
    account.followsCreator = true;
    const follow: FakeFollow = { id: this.nextId(), followerId: id };
    this.follows.unshift(follow);
    return follow;
  }

  /** `GET /account/<id>/followersnew`: follows older than `before` (null — from the newest), newest first. */
  followersPage(before: string | null, limit: number): FakeFollow[] {
    const older = before === null ? this.follows : this.follows.filter((follow) => compareIds(follow.id, before) < 0);
    return older.slice(0, limit);
  }

  // ── notes ──

  createNote(fanId: string, contentType: number, title: string, note: string, createdAt = Date.now()): FakeNote {
    const created: FakeNote = { id: this.nextId(), contentType, contentId: fanId, title, note, createdAt, updatedAt: null };
    this.ensureAccount(fanId).notes.push(created);
    return created;
  }

  findNote(noteId: string): { readonly account: FakeAccount; readonly note: FakeNote } | null {
    for (const account of this.accounts.values()) {
      const note = account.notes.find((item) => item.id === noteId);
      if (note !== undefined) return { account, note };
    }
    return null;
  }

  // ── the wire ──

  wireMessage(message: FakeMessage): WireMessage {
    return {
      id: message.id,
      type: message.type,
      dataVersion: 1,
      content: message.content,
      groupId: message.groupId,
      senderId: message.senderId,
      correlationId: message.correlationId,
      inReplyTo: message.inReplyTo,
      inReplyToRoot: message.inReplyTo,
      createdAt: message.createdAt,
      attachments: message.attachments.map((attachment) => ({ ...attachment, messageId: message.id })),
      embeds: [],
      interactions: [...message.interactions].map(([userId, state]) => ({ userId, readAt: state.readAt, deliveredAt: state.deliveredAt })),
      likes: [],
      totalTipAmount: 0,
    };
  }

  wireHistory(messages: readonly FakeMessage[]): WireHistoryPage {
    return { messages: messages.map((message) => this.wireMessage(message)), ...EMPTY_HISTORY };
  }

  wireUnread(before: string | null, limit: number, offset: number): WireUnreadPage {
    const { page, total } = this.unread(before, limit, offset);
    return {
      messageInteractions: page.map((message) => {
        const state = message.interactions.get(this.creatorId);
        return { messageId: message.id, groupId: message.groupId, userId: this.creatorId, readAt: state?.readAt ?? 0, deliveredAt: state?.deliveredAt ?? 0, deletedAt: null, validMessage: true };
      }),
      total,
    };
  }

  wireGroupUser(group: FakeGroup, userId: string): WireGroupUser {
    return { groupId: group.id, userId, type: 0, permissionFlags: 0, userSettings: { customName: '', hidden: 0 } };
  }

  wireGroup(group: FakeGroup): WireGroup {
    const fan = this.fanOf(group);
    const last = group.history.at(-1);
    return {
      id: group.id,
      type: group.type,
      groupFlags: 0,
      groupFlagsMetadata: '',
      createdBy: group.createdBy,
      users: group.users.map((userId) => this.wireGroupUser(group, userId)),
      permissionFlags: [],
      recipients: [],
      userSettings: { customName: '', hidden: 0 },
      lastMessage: last === undefined ? null : this.wireMessage(last),
      hasDmPermissionFlags: group.dmRulesUnmet,
      partnerMissingDmPermissionFlagsChecked: false,
      // One rule set, «follow the fan» (bit 2), which the creator does not meet: the composer hides (E155).
      dmPermissionFlags: group.dmRulesUnmet && fan !== null ? [{ id: 1, accountId: fan, type: 1, flags: group.dmPriceMills === undefined ? 2 : 1, metadata: group.dmPriceMills === undefined ? '{}' : JSON.stringify({ '1': JSON.stringify({ price: group.dmPriceMills }) }), verificationFlags: 0, verificationMetadata: '{}' }] : [],
      accountDmPermissionFlags: { flags: 0, metadata: '{}' },
      sendReadReceipts: true,
    };
  }

  private wireAvatar(account: FakeAccount): WireAvatar {
    const mediaId = String(BigInt(account.id) + 77n);
    const at = Math.floor(snowflakeMs(account.id) / 1000);
    const base = { type: 1, status: 1, accountId: account.id, mimetype: 'image/jpeg', flags: 0, metadata: '{}', createdAt: at, updatedAt: at };
    const address = (id: string): string => `https://${FAKE_FANSLY_MEDIA_HOST}/${account.id}/${id}.jpeg`;
    const variantId = String(BigInt(mediaId) + 1n);
    return {
      ...base,
      id: mediaId,
      location: `/${account.id}/${mediaId}.jpeg`,
      width: 800,
      height: 800,
      variants: [{ ...base, id: variantId, location: `/${account.id}/${variantId}.jpeg`, width: 400, height: 400, locations: [{ locationId: '1', location: address(variantId) }] }],
      locations: [{ locationId: '1', location: address(mediaId) }],
    };
  }

  wireNote(note: FakeNote): WireNote {
    // Fansly serves a note's times in seconds (R20 P11b2; decision 171 of the Fansly extension: `createdAt` 1790790855).
    const seconds = (ms: number): number => Math.floor(ms / 1000);
    return { id: note.id, accountId: this.creatorId, contentType: note.contentType, contentId: note.contentId, title: note.title, note: note.note, createdAt: seconds(note.createdAt), updatedAt: note.updatedAt === null ? null : seconds(note.updatedAt) };
  }

  wireAccount(account: FakeAccount): WireAccount {
    return {
      id: account.id,
      username: account.username,
      displayName: account.displayName,
      flags: 0,
      version: 3,
      createdAt: Math.floor(snowflakeMs(account.id) / 1000),
      followCount: 12,
      subscriberCount: 0,
      statusId: account.statusId,
      lastSeenAt: account.lastSeenAt,
      about: account.about,
      location: '',
      profileAccessFlags: 0,
      profileFlags: 0,
      followsYou: account.followsCreator,
      following: false,
      avatar: account.id === this.creatorId ? null : this.wireAvatar(account),
      notes: account.notes.map((note) => this.wireNote(note)),
    };
  }

  wireInboxEntry(group: FakeGroup): WireInboxEntry {
    const newestUnread = [...group.unread].sort(compareIds).at(-1);
    return {
      groupId: group.id,
      partnerAccountId: this.fanOf(group),
      partnerUsername: this.partnerName(group),
      flags: 0,
      unreadCount: group.unread.size,
      subscriptionTierId: null,
      lastMessageId: group.history.at(-1)?.id ?? null,
      lastUnreadMessageId: newestUnread ?? null,
    };
  }

  wireInboxPage(search: string, limit: number, offset: number): WireInboxPage {
    const page = this.inbox(search).slice(offset, offset + limit);
    const accounts = page.flatMap((group) => group.users.filter((id) => id !== this.creatorId)).flatMap((id) => this.accounts.get(id) ?? []);
    return {
      data: page.map((group) => this.wireInboxEntry(group)),
      aggregationData: { accounts: accounts.map((account) => this.wireAccount(account)), groups: page.map((group) => this.wireGroup(group)), accountMedia: [], accountMediaBundles: [] },
    };
  }

  wireFollow(follow: FakeFollow): WireFollow {
    return { id: follow.id, accountId: this.creatorId, followerId: follow.followerId };
  }

  wireFollowersPage(before: string | null, limit: number): WireFollowersPage {
    const page = this.followersPage(before, limit);
    return {
      followers: page.map((follow) => ({ id: follow.id, followerId: follow.followerId, lastSeenAt: this.accounts.get(follow.followerId)?.lastSeenAt ?? 0 })),
      aggregationData: { accounts: page.flatMap((follow) => this.accounts.get(follow.followerId) ?? []).map((account) => this.wireAccount(account)) },
    };
  }

  wireAlbum(album: FakeAlbum): WireVaultAlbum {
    return { id: album.id, type: album.type, accountId: this.creatorId, title: album.title, description: '', itemCount: album.mediaIds.length, lastItemId: album.mediaIds.at(-1) ?? null };
  }

  wireAlbums(): WireVaultAlbums {
    return { albums: this.albums.map((album) => this.wireAlbum(album)), aggregationData: { media: [] } };
  }

  /** An album's media, the newest first, with the media they name (`GET /media/vaultnew`). */
  wireAlbumMedia(album: FakeAlbum): WireVaultAlbumMediaPage {
    const media = [...album.mediaIds].reverse().flatMap((id) => this.media.get(id) ?? []);
    return {
      albumMedia: media.map((item) => ({ id: String(BigInt(item.id) + 1n), albumId: album.id, mediaId: item.id, customFilename: null, createdAt: Math.floor(item.createdAt / 1000) })),
      media: media.map((item) => ({ id: item.id, filename: item.filename, mimetype: item.mimetype })),
    };
  }
}
