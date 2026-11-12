// The fake Fansly's world (R20 P6b): what its API answers from and its socket
// tells about — one creator, the conversations of the stand page's synthetic
// world (fixture-fansly/src/data.ts: the same ids, so a page and a test name
// the same chats), their accounts, the creator's followers, notes, automated
// texts and vault albums. Nothing here is real: ids are Fansly-shaped
// snowflakes kept as strings, names and texts are made up, and an avatar's
// address is data nobody loads. The shapes it serialises to are
// fixture-fansly/src/wire.ts, where each one's source is named. The showcase
// world (src/showcase.ts) is Sofia Lane's: her inbox, today's new followers
// with names and a line about them, her welcome texts and albums.

import { createWorld } from '../../fixture-fansly/src/data';
import { showcasePerson } from '../../fixture-fansly/src/showcase';
import { SHOWCASE, SHOWCASE_AT } from '../showcase';
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
  type WireMediaUpload,
  type WireVaultMedia,
  type WireList,
  type WireSetting,
} from '../../fixture-fansly/src/wire';
import type { FilterFanSeed } from '../../fixture-fansly/src/server-protocol';

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
/**
 * «Онлайн» (`followersnew?lastSeenAfter=`): the seeded followers Fansly sees active a few minutes before every read —
 * by their place among the follows (newest first) and how many minutes ago —, so they stay online however long the
 * stand runs: in the synthetic world the first five have a chat and the rest none; in the showcase world the last two
 * are fans of the inbox. Every other follower was last seen hours to days before the start.
 */
export const ONLINE_FOLLOWERS: ReadonlyArray<readonly [index: number, minutesAgo: number]> = [
  [0, 2],
  [3, 6],
  [8, 1],
  [15, 11],
  [27, 4],
  [44, 3],
  [52, 9],
  [71, 13],
  [112, 5],
  [118, 8],
];

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

/** The stand's fans with Fansly's blue card «Recent Spender»: two in three, by the id (as the live test model's online fans). */
export const standRecentSpender = (id: string): boolean => BigInt(id) % 3n !== 0n;

/** FBuddy's tier of a stand fan (the stand's copy of FBuddy's batch, `/fbuddy/…`): every tier and none, by the id. */
export function standFbuddyTier(id: string): 'basic' | 'bronze' | 'silver' | 'gold' | 'platinum' | null {
  return (['gold', 'silver', null, 'platinum', 'bronze', 'basic', 'silver'] as const)[Number(BigInt(id) % 7n)] ?? null;
}

export interface FakeAccount {
  readonly id: string;
  username: string;
  displayName: string;
  /** 1 online, 2 away, 3 offline, 4 hidden. */
  statusId: number;
  /** When Fansly last saw the account (ms); `seenAgoMs` — active this long before every read instead (it stays online). */
  lastSeenAt: number;
  seenAgoMs?: number;
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

/**
 * 2026-11-13, the creator's filter chips (control `filters`): her tiers, her lists, the pinned ones in pin order, and
 * each fan's place in them. None by default: Fansly then shows All, Subscribers, VIPs and Followers alone.
 */
export interface FakeFilters {
  tiers: Array<{ readonly id: string; readonly name: string; readonly color: string; readonly active: boolean }>;
  lists: Array<{ readonly id: string; label: string; itemCount: number }>;
  pinned: string[];
  readonly fans: Map<string, { readonly tier: string | null; readonly lists: readonly string[]; readonly vip: boolean; readonly staff: boolean }>;
}

const FILTER_ID_BASE = 830_000_000_000_000_000n;
/** What a showcase fan writes when the control gives the chat unread messages (invented). */
const FAN_LINES = ['hey, are you online tonight?', 'did you see my tip? 🙂', 'how much for the full video?', 'good morning beautiful', 'that last set was unreal 🔥', 'can i request something for next week?', 'missed you today', 'ok deal, send it over'];

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

/** An account medium the page uploaded (the stand's `POST /account/media`, the vault's upload): its file name for the vault's cards. */
export interface FakeMedia {
  readonly id: string;
  readonly filename: string | null;
  readonly mimetype: string;
  readonly createdAt: number;
  /** What Fansly says of its content: the picture's size the page measured (the stand's stand-in for Fansly's processing). */
  readonly width?: number | null;
  readonly height?: number | null;
}

/** The vault's upload as the page made it (`POST /media/upload/create`): its medium once `complete` answered. */
export interface FakeUpload {
  readonly id: string;
  readonly fileName: string;
  readonly fileSize: number;
  readonly mimeType: string;
  readonly width: number | null;
  readonly height: number | null;
  mediaId: string | null;
}

/** A paid attachment the stand's `ppv` command made (X54 on Fansly): its kind and its PPV price, in mills. */
export interface FakePaidContent {
  readonly kind: 'media' | 'bundle';
  readonly priceMills: number;
}

/** A fan's order of a paid attachment: served inline on the history pages and in `/media/orderhistory`. */
export interface FakeOrder {
  readonly id: string;
  readonly accountId: string;
  readonly contentId: string;
  readonly kind: 'media' | 'bundle';
  /** Milliseconds. */
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
  readonly uploadFilenames = new Map<string, string>();
  /** Accounts `GET /account?ids=` no longer returns to the creator (control `gone`): deleted, or the page blocked. */
  readonly goneAccounts = new Set<string>();
  readonly albumFilenames = new Map<string, string>();
  /** The media the page uploaded, by content (`name:size:type`): the same file again is the same medium. */
  readonly uploadedContent = new Map<string, string>();
  /** The vault's uploads by their id (`POST /media/upload/create`). */
  readonly uploads = new Map<string, FakeUpload>();
  /** The row of a member in an album (`<album>:<media>`): a new one each time it is added. */
  readonly albumRows = new Map<string, string>();
  /** Paid attachments by content id (the `ppv` command), and the fans' orders of them. */
  readonly paid = new Map<string, FakePaidContent>();
  /** The creator's bundles a post holds (the stand's `bundles` command): what «Copy» on a post puts in the «Copied …» list. */
  readonly bundles = new Set<string>();
  readonly orders: FakeOrder[] = [];
  /** The creator's mass-send group: the parents of its mass sends live there. */
  readonly broadcastGroupId = BROADCAST_GROUP_ID;
  private readonly ids = new Snowflakes();
  readonly filters: FakeFilters = { tiers: [], lists: [], pinned: [], fans: new Map() };
  /** The filters' ids by name: a tier or a list keeps its id across the control's sets, as on Fansly. */
  private readonly filterIds = new Map<string, string>();
  private filterId(key: string): string {
    let id = this.filterIds.get(key);
    if (id === undefined) {
      id = String(FILTER_ID_BASE + BigInt(this.filterIds.size + 1));
      this.filterIds.set(key, id);
    }
    return id;
  }

  constructor(readonly startedAt = Date.now(), creatorId?: string) {
    const seed = createWorld(creatorId, SHOWCASE ? SHOWCASE_AT : null);
    this.creatorId = seed.creator.id;
    this.accounts.set(seed.creator.id, this.newAccount(seed.creator.id, seed.creator.username, seed.creator.displayName, 1));
    for (const seeded of seed.groups) {
      for (const partner of seeded.partners) this.accounts.set(partner.id, this.newAccount(partner.id, partner.username, partner.displayName, seeded.status, partner.about));
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
          interactions: new Map([[mine ? seeded.fan.id : seed.creator.id, { readAt: (message.readAt ?? message.createdAt) * 1000, deliveredAt: message.createdAt * 1000 }]]),
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

    // Followers, newest first: the newest followed five minutes before the start, the oldest about a week before. In
    // the showcase world today's followers are new people, sixteen in the last twelve hours, and the fans of the inbox
    // followed weeks ago (the oldest).
    const fans = seed.groups.map((group) => group.fan.id);
    for (let index = 0; index < SEED_FOLLOWERS; index += 1) {
      const followedAt = startedAt - Math.round((5 + index * index * (SHOWCASE ? 3 : 0.45)) * 60_000);
      const withChat = SHOWCASE ? index - (SEED_FOLLOWERS - SEED_FOLLOWERS_WITH_CHAT) : index;
      let followerId = withChat < 0 ? undefined : fans[withChat * 3];
      if (withChat >= SEED_FOLLOWERS_WITH_CHAT || followerId === undefined) {
        followerId = String(FOLLOWER_ACCOUNT_BASE + BigInt(index * 31 + 7));
        const person = showcasePerson(500 + index);
        this.accounts.set(followerId, SHOWCASE ? this.newAccount(followerId, person.username, person.displayName, index % 4 === 0 ? 1 : 3, person.about) : this.newAccount(followerId, `stand_follower_${index + 1}`, `Stand Follower ${index + 1}`, 3));
      }
      const account = this.accounts.get(followerId);
      if (account !== undefined) {
        account.followsCreator = true;
        const online = ONLINE_FOLLOWERS.find(([at]) => at === index);
        if (online === undefined) account.lastSeenAt = startedAt - (2 + (index % 17) * 5) * 3_600_000;
        else account.seenAgoMs = online[1] * 60_000;
      }
      this.follows.push({ id: snowflakeAt(followedAt, index), followerId });
    }

    const [followed, subscribed] = SHOWCASE ? ['hey you 💕 thanks for the follow! say hi anytime', 'welcome to my page 🥰 so happy you’re here'] : ['Stand welcome: thanks for the follow', 'Stand welcome: thanks for subscribing'];
    this.automated = [
      { id: '806000000000000011', accountId: seed.creator.id, type: 1, status: 1, messageTemplate: JSON.stringify({ type: 1, content: followed, attachments: [] }) },
      { id: '806000000000000012', accountId: seed.creator.id, type: 2, status: 1, messageTemplate: JSON.stringify({ type: 1, content: subscribed, attachments: [] }) },
      // An automation with media only: no text to match.
      { id: '806000000000000013', accountId: seed.creator.id, type: 3, status: 1, messageTemplate: JSON.stringify({ type: 1, content: null, attachments: [] }) },
    ];
    this.albums = [
      { id: '807000000000000021', type: 0, title: SHOWCASE ? 'October set' : 'Stand album', mediaIds: [] },
      { id: '807000000000000022', type: 0, title: SHOWCASE ? 'Behind the scenes' : 'Stand album 2', mediaIds: [] },
    ];
  }

  // ── ids and accounts ──

  nextId(ms = Date.now()): string {
    return this.ids.next(ms);
  }

  private newAccount(id: string, username: string, displayName: string, statusId: number, about?: string): FakeAccount {
    return { id, username, displayName, statusId, lastSeenAt: this.startedAt - 60_000, about: about ?? `About ${username}`, followsCreator: false, notes: [] };
  }

  /** When Fansly last saw the account (ms): `seenAgoMs` before `now` for one that stays online, else its stored moment. */
  seenAt(account: FakeAccount, now = Date.now()): number {
    return account.seenAgoMs === undefined ? account.lastSeenAt : now - account.seenAgoMs;
  }

  /** «Онлайн» of a test: the account is active `agoMs` before every read from now on; null — last seen now, and no more. */
  setSeen(id: string, agoMs: number | null, now = Date.now()): FakeAccount {
    const account = this.ensureAccount(id);
    if (agoMs === null) {
      account.lastSeenAt = now;
      delete account.seenAgoMs;
    } else account.seenAgoMs = agoMs;
    return account;
  }

  /** The account, made up on first mention (a fan a test names, a guest of a group chat); a person with a name in the showcase world. */
  ensureAccount(id: string): FakeAccount {
    let account = this.accounts.get(id);
    if (account === undefined) {
      const person = showcasePerson(Number(BigInt(id) % 997n));
      account = SHOWCASE ? this.newAccount(id, person.username, person.displayName, 1, person.about) : this.newAccount(id, `stand_account_${id.slice(-6)}`, `Stand Account ${id.slice(-4)}`, 3);
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

  /**
   * A new follower, now (or `agoMs` ago, by its id): a made-up account unless one is named; `dmRulesUnmet` — the fan's
   * DMs are closed to the creator.
   */
  follow(followerId?: string, dmRulesUnmet = false, agoMs?: number): FakeFollow {
    const id = followerId ?? String(FOLLOWER_ACCOUNT_BASE + 900_000n + BigInt(this.follows.length * 17 + 5));
    if (dmRulesUnmet) this.dmClosed.add(id);
    const account = this.ensureAccount(id);
    account.followsCreator = true;
    const follow: FakeFollow = { id: agoMs === undefined ? this.nextId() : snowflakeAt(Date.now() - agoMs, this.follows.length), followerId: id };
    // Following is being active: Fansly saw the fan then.
    if (account.seenAgoMs === undefined) account.lastSeenAt = Math.max(account.lastSeenAt, Date.now() - (agoMs ?? 0));
    this.follows.unshift(follow);
    return follow;
  }

  /**
   * `GET /account/<id>/followersnew`: follows older than `before` (null — from the newest), newest first; with
   * `lastSeenAfter` (ms) only the followers Fansly saw after it (the read of «Онлайн» and of FBuddy).
   */
  followersPage(before: string | null, limit: number, lastSeenAfter: number | null = null, now = Date.now()): FakeFollow[] {
    const older = before === null ? this.follows : this.follows.filter((follow) => compareIds(follow.id, before) < 0);
    const seen = (follow: FakeFollow): boolean => {
      const account = this.accounts.get(follow.followerId);
      return account !== undefined && this.seenAt(account, now) > (lastSeenAfter ?? 0);
    };
    return (lastSeenAfter === null ? older : older.filter(seen)).slice(0, limit);
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
    // The page's own aggregation: each paid attachment's media or bundle with its PPV permission row, and the orders of it.
    const paid = [...new Set(messages.flatMap((message) => message.attachments.map((attachment) => attachment.contentId)))].flatMap((id) => {
      const content = this.paid.get(id);
      return content === undefined ? [] : [{ id, ...content }];
    });
    const permissions = (priceMills: number) => ({ permissionFlags: [{ id: this.nextId(), flags: 1, price: priceMills, metadata: '' }] });
    return {
      messages: messages.map((message) => this.wireMessage(message)),
      ...EMPTY_HISTORY,
      accountMedia: paid.filter((item) => item.kind === 'media').map((item) => ({ id: item.id, accountId: this.creatorId, media: { type: 2, mimetype: 'video/mp4' }, permissions: permissions(item.priceMills) })),
      accountMediaBundles: paid.filter((item) => item.kind === 'bundle').map((item) => ({ id: item.id, accountId: this.creatorId, accountMediaIds: [], permissions: permissions(item.priceMills) })),
      // Inline, a bundle's order names the bundle in `accountMediaId` with type 2 (the old extension's reading).
      accountMediaOrders: this.orders.filter((order) => paid.some((item) => item.id === order.contentId)).map((order) => ({ id: order.id, accountId: order.accountId, accountMediaId: order.contentId, type: order.kind === 'media' ? 1 : 2, createdAt: order.createdAt })),
    };
  }

  /** `/media/orderhistory`: the orders of one media or bundle, by the accounts asked (all when none). */
  wireOrderHistory(contentId: string, kind: 'media' | 'bundle', accountIds: readonly string[]): { accountMediaOrderHistory: unknown[] } {
    return {
      accountMediaOrderHistory: this.orders
        .filter((order) => order.contentId === contentId && order.kind === kind && (accountIds.length === 0 || accountIds.includes(order.accountId)))
        .map((order) => ({ id: order.id, orderId: order.id, accountId: order.accountId, accountMediaId: kind === 'media' ? contentId : null, accountMediaBundleId: kind === 'bundle' ? contentId : null, type: kind === 'media' ? 1 : 2, createdAt: order.createdAt })),
    };
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

  /** The creator's tiers as `/account/me` carries them; a fan's place in the filters (2026-11-13). */
  private filterFacts(account: FakeAccount): Partial<WireAccount> {
    if (account.id === this.creatorId) {
      return { subscriptionTiers: this.filters.tiers.map((tier, index) => ({ id: tier.id, name: tier.name, color: tier.color, plans: [{ id: String(FILTER_ID_BASE + 500n + BigInt(index)), status: tier.active ? 1 : 2, billingCycle: 30, price: 9990 }] })) };
    }
    const fan = this.filters.fans.get(account.id);
    if (fan === undefined) return { containingLists: [], subscriber: false, subscriberSubscription: null };
    return { containingLists: [...fan.lists], subscriber: fan.tier !== null, subscriberSubscription: fan.tier === null ? null : { subscriptionTierId: fan.tier }, ...(fan.vip ? { vip: true } : {}), ...(fan.staff ? { staff: true } : {}) };
  }

  /** `GET /settings?categoryIds=4000`: the pinned lists (4000/100) as the page saved them. */
  wireSettings(categories: readonly string[]): WireSetting[] {
    if (!categories.includes('4000')) return [];
    const pinnedLists = this.filters.pinned.flatMap((id) => this.filters.lists.find((list) => list.id === id) ?? []).map((list) => ({ id: list.id, label: list.label, itemCount: list.itemCount }));
    return [{ categoryId: '4000', keyId: '100', value: 1, metadata: JSON.stringify({ pinnedLists }) }];
  }

  /** `POST /settings` of the pinned lists: the whole array, for the account (last writer wins, as on Fansly). */
  savePinned(lists: ReadonlyArray<{ readonly id: string; readonly label?: string }>): void {
    for (const list of lists) if (!this.filters.lists.some((known) => known.id === list.id)) this.filters.lists.push({ id: list.id, label: list.label ?? 'List', itemCount: 0 });
    this.filters.pinned = lists.map((list) => list.id);
  }

  /** `GET /lists/account`. */
  wireLists(): WireList[] {
    return this.filters.lists.map((list) => ({ id: list.id, label: list.label, itemCount: list.itemCount }));
  }

  /** The control's `filters`: the tiers and lists given replace the old ones; the fans named get their places. */
  setFilters(input: { readonly tiers?: ReadonlyArray<{ readonly name: string; readonly color?: string; readonly active?: boolean }>; readonly lists?: ReadonlyArray<{ readonly label: string; readonly pinned?: boolean; readonly itemCount?: number }>; readonly clearUnread?: boolean; readonly fans?: readonly FilterFanSeed[] }): { readonly tierIds: string[]; readonly listIds: string[] } {
    if (input.tiers !== undefined) this.filters.tiers = input.tiers.map((tier) => ({ id: this.filterId(`tier:${tier.name}`), name: tier.name, color: tier.color ?? '#4781b4', active: tier.active !== false }));
    if (input.lists !== undefined) {
      this.filters.lists = input.lists.map((list) => ({ id: this.filterId(`list:${list.label}`), label: list.label, itemCount: list.itemCount ?? 0 }));
      this.filters.pinned = this.filters.lists.filter((_, index) => input.lists?.[index]?.pinned !== false).map((list) => list.id);
    }
    const tierIds = this.filters.tiers.map((tier) => tier.id);
    const listIds = this.filters.lists.map((list) => list.id);
    if (input.clearUnread === true) for (const group of this.groups.values()) this.readAll(group);
    const inbox = this.inbox();
    for (const seed of input.fans ?? []) {
      const fanId = seed.fanId ?? (seed.at === undefined ? null : (inbox[seed.at] === undefined ? null : this.fanOf(inbox[seed.at] as FakeGroup)));
      if (fanId === null) continue;
      const account = this.ensureAccount(fanId);
      account.followsCreator = seed.follower === true;
      this.filters.fans.set(fanId, {
        tier: seed.tier === undefined || seed.tier === null ? null : (tierIds[seed.tier] ?? null),
        lists: (seed.lists ?? []).flatMap((at) => listIds[at] ?? []),
        vip: seed.vip === true,
        staff: seed.staff === true,
      });
      const group = this.conversationWith(fanId);
      if (seed.unread !== undefined && group !== null) {
        this.readAll(group);
        for (let n = 0; n < seed.unread; n += 1) this.addMessage({ groupId: group.id, senderId: fanId, content: SHOWCASE ? (FAN_LINES[(Number(BigInt(fanId) % 97n) + n) % FAN_LINES.length] as string) : `Stand line ${String(n + 1)} for the filters` });
      }
    }
    return { tierIds, listIds };
  }

  /** Every unread message of a chat read by the creator. */
  private readAll(group: FakeGroup): void {
    for (const id of group.unread) {
      const state = this.messages.get(id)?.interactions.get(this.creatorId);
      if (state !== undefined) state.readAt ||= Date.now();
    }
    group.unread.clear();
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
      lastSeenAt: this.seenAt(account),
      about: account.about,
      location: '',
      profileAccessFlags: 0,
      profileFlags: 0,
      userFlags: account.id !== this.creatorId && standRecentSpender(account.id) ? 2 : 0,
      followsYou: account.followsCreator,
      following: false,
      avatar: account.id === this.creatorId ? null : this.wireAvatar(account),
      notes: account.notes.map((note) => this.wireNote(note)),
      ...this.filterFacts(account),
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

  wireFollowersPage(before: string | null, limit: number, lastSeenAfter: number | null = null): WireFollowersPage {
    const page = this.followersPage(before, limit, lastSeenAfter);
    const seen = (id: string): number => {
      const account = this.accounts.get(id);
      return account === undefined ? 0 : this.seenAt(account);
    };
    return {
      followers: page.map((follow) => ({ id: follow.id, followerId: follow.followerId, lastSeenAt: seen(follow.followerId) })),
      aggregationData: { accounts: page.flatMap((follow) => this.accounts.get(follow.followerId) ?? []).map((account) => this.wireAccount(account)) },
    };
  }

  wireAlbum(album: FakeAlbum): WireVaultAlbum {
    return { id: album.id, type: album.type, accountId: this.creatorId, title: album.title, description: '', itemCount: album.mediaIds.length, lastItemId: album.mediaIds.at(-1) ?? null };
  }

  wireAlbums(): WireVaultAlbums {
    return { albums: this.albums.map((album) => this.wireAlbum(album)), aggregationData: { media: [] } };
  }

  /**
   * An album's media, the newest first, with the media they name (`GET /media/vaultnew`). `before` — the id of the last
   * row of the page before ('0' or none — the head); a page holds at most `pageSize` rows, as Fansly's do.
   */
  wireAlbumMedia(album: FakeAlbum, before: string | null = null, pageSize = Number.POSITIVE_INFINITY): WireVaultAlbumMediaPage {
    const rows = [...album.mediaIds].reverse().flatMap((id) => {
      const item = this.media.get(id);
      return item === undefined ? [] : [{ row: this.albumRows.get(`${album.id}:${id}`) ?? String(BigInt(id) + 1n), item }];
    });
    const from = before === null || before === '0' ? 0 : rows.findIndex((entry) => entry.row === before) + 1;
    // A cursor the album does not hold: past its end.
    const page = from === 0 && before !== null && before !== '0' ? [] : rows.slice(from, from + pageSize);
    return {
      albumMedia: page.map(({ row, item }) => ({ id: row, albumId: album.id, mediaId: item.id, customFilename: this.albumFilenames.get(`${album.id}:${item.id}`) ?? null, createdAt: Math.floor(item.createdAt / 1000) })),
      media: page.map(({ item }) => this.wireMedia(item)),
    };
  }

  /** An upload as `mediav2` answers it (fansly-publish-contract.md §2): the file as sent; on `status` 6, its medium. */
  wireUpload(upload: FakeUpload, status: number): WireMediaUpload {
    const medium = upload.mediaId === null ? undefined : this.media.get(upload.mediaId);
    const done = status === 6 && medium !== undefined;
    return {
      id: upload.id,
      type: upload.mimeType.startsWith('video/') ? 2 : 1,
      status,
      fileName: upload.fileName,
      fileSize: upload.fileSize,
      mimeType: upload.mimeType,
      partSize: 20_971_520,
      parts: [],
      accountId: this.creatorId,
      mediaId: done ? upload.mediaId : null,
      ...(done ? { media: this.wireMedia(medium) } : {}),
    };
  }

  /** A medium as Fansly's answers carry it: a video's size and duration in its metadata, a photo's own size. */
  wireMedia(item: FakeMedia): WireVaultMedia {
    const video = item.mimetype.startsWith('video/');
    const width = item.width ?? null;
    const height = item.height ?? null;
    if (!video) return { id: item.id, filename: item.filename, mimetype: item.mimetype, type: 1, width, height, metadata: JSON.stringify({ resolutionMode: 1 }) };
    // The stand's video has no picture: Fansly's transcoded copy and its original are said as the page measured them.
    const metadata = width === null || height === null ? {} : { originalWidth: width, originalHeight: height };
    return { id: item.id, filename: item.filename, mimetype: 'video/mp4', type: 2, width, height, metadata: JSON.stringify(metadata) };
  }

  /**
   * `POST /vault/albums/media` as Fansly answers it (hub docs/plans/2026-10-23-wall-posts/fansly-publish-contract.md
   * §13): each member gets a new row in the request's order, the last one on top; a member already in the album loses its
   * old row first, its name in the album kept.
   */
  addAlbumMedia(album: FakeAlbum, mediaIds: readonly string[]): void {
    for (const id of mediaIds) {
      const at = album.mediaIds.indexOf(id);
      if (at >= 0) album.mediaIds.splice(at, 1);
      album.mediaIds.push(id);
      this.albumRows.set(`${album.id}:${id}`, this.nextId());
    }
  }
}
