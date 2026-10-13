// Fansly's wire as the stand speaks it: the shapes of the API answers and of
// the socket frames, shared by the stand page (it reads them) and the fake
// Fansly (packages/testing/src/fake-fansly, it writes them). Only fields a
// reader of ours or the stand page uses are here; contents are synthetic.
//
// Where the shapes come from (S2 = ~/Documents/Codex/r20-detail-2026-10-12/
// research/s2-fansly-page.md; `main:N` = a line of the formatted bundle
// `main.2e6b96097a4bb73b.js`, docs/project-unite/fansly-web.md §0):
// - the envelope `{success, response}` or `{success: false, error}` — every API
//   callback of the page (`X.success ? N(null, X.response) : N(X.error, null)`,
//   main:28316-28420);
// - messages, groups, the inbox page, followers, accounts and their notes —
//   the hub's wire types (hub `packages/fansly/src/types.ts`) and the old
//   extension's (`fansly-chat/src/shared/types.ts`), S2 Q1.5, Q3;
// - the history page: `tips`, `stories` and `accountMedia` are arrays the page
//   walks without a check (main:28989-29011), newest message first on the wire
//   (the page reverses them);
// - the socket: `{t, d}` with `d` a JSON string, `t: 10000` carrying
//   `{serviceId, event}` whose `event` is one more JSON string, `t: 10001` an
//   array of wrapper strings (main:27556-27567; S2 Q1.3); the events of
//   MessageService 5, GroupService 4 and FollowerService 3 (main:28562,
//   :28662-28682; S2 Q1.4).
// Browser-safe: no Node imports.

/** `https://apiv3.fansly.com/api/v1` on the real site; the stand serves the same path on its own loopback origin. */
export const FANSLY_API_PATH = '/api/v1';

/** Every API address of the page carries it (main:25694-25697), and so does every one of ours (architecture.md §8.3). */
export const NGSW_BYPASS = 'ngsw-bypass';

/** The headers Fansly's client adds to its API requests (main:25671-25690, :26082-26084): the session template of §8.2. */
export const FANSLY_SESSION_HEADERS = ['authorization', 'fansly-client-id', 'fansly-client-ts', 'fansly-session-id', 'fansly-client-check'] as const;

export interface WireError {
  readonly code: number;
  readonly details?: string;
}

export type WireEnvelope<T> = { readonly success: true; readonly response: T } | { readonly success: false; readonly error: WireError };

// ── messages ──

export interface WireAttachment {
  readonly messageId: string | null;
  readonly pos: number;
  /** 1 — account media, 2 — a bundle, 7 — a tip, 32001 — a story (S2 Q1.5). */
  readonly contentType: number;
  readonly contentId: string;
}

export interface WireInteraction {
  readonly userId: string;
  readonly readAt: number;
  readonly deliveredAt: number;
}

export interface WireMessage {
  readonly id: string;
  /** 1 — a message, 2 — an automated one, 3 — the parent of a mass send (in the creator's broadcast group). */
  readonly type: number;
  readonly dataVersion: number;
  readonly content: string;
  readonly groupId: string;
  readonly senderId: string;
  /** The id of what made the message (a mass send's parent, an automation); null — nothing did. */
  readonly correlationId: string | null;
  readonly inReplyTo: string | null;
  readonly inReplyToRoot: string | null;
  /** Seconds. */
  readonly createdAt: number;
  readonly attachments: readonly WireAttachment[];
  readonly embeds: readonly unknown[];
  readonly interactions: readonly WireInteraction[];
  readonly likes: readonly unknown[];
  readonly totalTipAmount: number;
}

/** `GET /message?groupId=…` and `GET /messages?ids=…`: newest first. */
export interface WireHistoryPage {
  readonly messages: readonly WireMessage[];
  readonly accountMedia: readonly unknown[];
  readonly accountMediaBundles: readonly unknown[];
  readonly tips: readonly unknown[];
  readonly tipGoals: readonly unknown[];
  readonly accountMediaOrders: readonly unknown[];
  readonly stories: readonly unknown[];
  readonly storyOrders: readonly unknown[];
}

/** `POST /message`, as the page's composer builds it (class `zd`, main:54168-54172; :56169-56199). */
export interface WireSendBody {
  readonly type: number;
  readonly attachments: readonly WireAttachment[];
  readonly likes: readonly unknown[];
  readonly content: string;
  readonly groupId: string;
  readonly scheduledFor: number;
  readonly inReplyTo: string | null;
  /** The page sends `Date.now() / 1000`, a float. */
  readonly createdAt: number;
}

/** `GET /message/unread`: one entry per unread message (main:28758-28806). */
export interface WireUnreadInteraction {
  readonly messageId: string;
  readonly groupId: string;
  readonly userId: string;
  readonly readAt: number;
  readonly deliveredAt: number;
  readonly deletedAt: number | null;
  readonly validMessage: boolean;
}

export interface WireUnreadPage {
  readonly messageInteractions: readonly WireUnreadInteraction[];
  readonly total: number;
}

/** `POST /message/ack`: 1 — delivered, 2 — read, 3 — read and delivered, 4 — unread (S2 Q1.4). */
export interface WireAckBody {
  readonly messageIds: readonly string[];
  readonly type: number;
}

// ── groups ──

export interface WireGroupUser {
  readonly groupId: string;
  readonly userId: string;
  readonly type: number;
  readonly permissionFlags: number;
  readonly userSettings?: { readonly customName: string; readonly hidden: number };
}

/** One way into the partner's DMs; the composer is hidden while no rule set is met (old `fansly-dm-permissions.ts`, E155). */
export interface WireDmPermissionRule {
  readonly id: number;
  readonly accountId: string;
  readonly type: number;
  /** Bits: 1 a price per message, 2 follow the fan, 4 subscribe to the fan, 8 tips, 16 followed by the fan… */
  readonly flags: number;
  readonly metadata: string;
  /** The bits this account already meets. */
  readonly verificationFlags: number;
  readonly verificationMetadata: string;
}

/** The group object of `GET /group/<id>/`, `POST /group` and the inbox's `aggregationData.groups[]`. */
export interface WireGroup {
  readonly id: string;
  /** 1 — a conversation, 3 — the creator's mass-send group. */
  readonly type: number;
  readonly groupFlags: number;
  readonly groupFlagsMetadata: string;
  readonly createdBy: string;
  readonly users: readonly WireGroupUser[];
  readonly permissionFlags: readonly unknown[];
  readonly recipients: readonly unknown[];
  readonly userSettings: { readonly customName: string; readonly hidden: number } | null;
  readonly lastMessage: WireMessage | null;
  readonly hasDmPermissionFlags: boolean;
  readonly partnerMissingDmPermissionFlagsChecked: boolean;
  readonly dmPermissionFlags: readonly WireDmPermissionRule[];
  readonly accountDmPermissionFlags: { readonly flags: number; readonly metadata: string };
  readonly sendReadReceipts: boolean;
}

/** `POST /group`: get-or-create by its two users (old `createFollowerGroup`). */
export interface WireCreateGroupBody {
  readonly users: ReadonlyArray<{ readonly userId: string; readonly permissionFlags: number }>;
  readonly recipients: readonly unknown[];
  readonly lastMessage: null;
  readonly userSettings: null;
  readonly type: number;
}

export interface WireInboxEntry {
  readonly groupId: string;
  readonly partnerAccountId: string | null;
  /** `lower(displayName || username)`: what the server's `search` matches. */
  readonly partnerUsername: string | null;
  readonly flags: number;
  readonly unreadCount: number;
  readonly subscriptionTierId: string | null;
  readonly lastMessageId: string | null;
  readonly lastUnreadMessageId: string | null;
}

/** `GET /messaging/groups` (up to 115 KB on a live page, fansly-web.md §4). */
export interface WireInboxPage {
  readonly data: readonly WireInboxEntry[];
  readonly aggregationData: {
    readonly accounts: readonly WireAccount[];
    readonly groups: readonly WireGroup[];
    readonly accountMedia: readonly unknown[];
    readonly accountMediaBundles: readonly unknown[];
  };
}

// ── accounts ──

export interface WireAvatarLocation {
  readonly locationId: string;
  /** A Fansly CDN address: data only — the stand never loads it, and neither may our UI (FX-018). */
  readonly location: string;
}

export interface WireAvatar {
  readonly id: string;
  readonly type: number;
  readonly status: number;
  readonly accountId: string;
  readonly mimetype: string;
  readonly flags: number;
  readonly location: string;
  readonly width: number;
  readonly height: number;
  readonly metadata: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly variants: ReadonlyArray<Omit<WireAvatar, 'variants'>>;
  readonly locations: readonly WireAvatarLocation[];
}

/** A note of the creator on an account: 12000 — a note, 12002 — the custom name («Custom Username»; old `fan-notes.ts`). */
export interface WireNote {
  readonly id: string;
  readonly accountId: string;
  readonly contentType: number;
  readonly contentId: string;
  readonly title: string;
  readonly note: string;
  readonly createdAt: number;
  readonly updatedAt: number | null;
}

export interface WireAccount {
  readonly id: string;
  readonly username: string;
  readonly displayName: string | null;
  readonly flags: number;
  readonly version: number;
  /** Seconds; the id's own snowflake time. */
  readonly createdAt: number;
  readonly followCount: number;
  readonly subscriberCount: number;
  /** 1 online, 2 away, 3 offline, 4 hidden. */
  readonly statusId: number;
  readonly lastSeenAt: number;
  readonly about: string;
  readonly location: string;
  readonly profileAccessFlags: number;
  readonly profileFlags: number;
  readonly followsYou: boolean;
  readonly following: boolean;
  readonly avatar: WireAvatar | null;
  readonly notes: readonly WireNote[];
}

/** `GET /account/me`. */
export interface WireAccountMe {
  readonly account: WireAccount;
  readonly correlationId: string;
  readonly authorizedAccountFlags: number;
}

export interface WireFollow {
  /** A snowflake: the moment of the follow. */
  readonly id: string;
  /** The followed account. */
  readonly accountId: string;
  readonly followerId: string;
}

/** `GET /account/<id>/followersnew`: newest first. */
export interface WireFollowersPage {
  readonly followers: ReadonlyArray<{ readonly id: string; readonly followerId: string; readonly lastSeenAt: number }>;
  readonly aggregationData: { readonly accounts: readonly WireAccount[] };
}

/** `POST /notes` (and `/notes/edit` with `id`; `/notes/delete` takes the whole note). */
export interface WireNoteBody {
  readonly id?: string;
  readonly contentType: number;
  readonly contentId: string;
  readonly title: string;
  readonly note: string;
}

/** `GET /message/automated`: the creator's automations; the text is inside `messageTemplate`, a JSON string (old `welcomeTexts`). */
export interface WireAutomatedMessage {
  readonly id: string;
  readonly accountId: string;
  readonly type: number;
  readonly status: number;
  readonly messageTemplate: string;
}

export interface WireVaultAlbum {
  readonly id: string;
  readonly type: number;
  readonly accountId: string;
  readonly title: string;
  readonly description: string;
  readonly itemCount: number;
  readonly lastItemId: string | null;
}

/** `GET /vault/albumsnew` (main:12727; the albums and the media of their covers). */
export interface WireVaultAlbums {
  readonly albums: readonly WireVaultAlbum[];
  readonly aggregationData: { readonly media: readonly unknown[] };
}

// ── the socket ──

/** `t` of a frame (main:27556-27567). */
export const FRAME = { error: 0, session: 1, pong: 2, service: 10000, batch: 10001 } as const;

/** `serviceId` of a `t: 10000` frame (`ServiceIds`, main:27590). */
export const SERVICE = { follower: 3, group: 4, message: 5 } as const;

/** `type` inside the `event` of a service frame (main:28562, :28662-28682, :66249-66255). */
export const EVENT = {
  message: { created: 1, ack: 2, deleted: 10, typing: 22 },
  group: { ack: 2, userAdded: 6, userRemoved: 7, created: 8 },
  follower: { followed: 2, unfollowed: 3 },
} as const;

/** The page's text ping, every 20–25 s (main:27483-27495); the answer is a `t: 2` frame. */
export const SOCKET_PING = 'p';

/** `{t: 10000, d}`: three levels of JSON — the wrapper, the service event, its `event`. */
export function serviceFrame(serviceId: number, event: Readonly<Record<string, unknown>>): string {
  return JSON.stringify({ t: FRAME.service, d: JSON.stringify({ serviceId, event: JSON.stringify(event) }) });
}

/** `{t: 10001, d}`: an ARRAY of wrapper strings, each handled as a frame of its own (main:27563-27566). */
export function batchFrame(frames: readonly string[]): string {
  return JSON.stringify({ t: FRAME.batch, d: frames });
}

/** `t: 1`, SessionVerifiedEvent: it carries the session token — never keep a raw frame of it. */
export function sessionFrame(session: { readonly id: string; readonly accountId: string; readonly token: string }): string {
  return JSON.stringify({ t: FRAME.session, d: JSON.stringify({ session: { ...session, deviceId: null } }) });
}

export function pongFrame(now = Date.now()): string {
  return JSON.stringify({ t: FRAME.pong, d: JSON.stringify({ lastPing: now }) });
}

/** `t: 0`, ErrorEvent: `code 401` logs the page out (main:27530-27532). */
export function errorFrame(code: number): string {
  return JSON.stringify({ t: FRAME.error, d: JSON.stringify({ code }) });
}

/** The page's first frame on an open socket (main:27523-27529, :27571-27576). */
export function sessionVerifyRequest(token: string): string {
  return JSON.stringify({ t: FRAME.session, d: JSON.stringify({ token, v: 3 }) });
}

/** `4/2`: read receipts as production sends them (GroupService; `5/2` carries the same inside `messageAckEvent`). */
export interface WireAckCommand {
  readonly type: number;
  readonly userId: string;
  readonly messageIds: readonly string[];
}

export const messageCreatedFrame = (message: WireMessage): string => serviceFrame(SERVICE.message, { type: EVENT.message.created, message });
/** `5/10`: one frame for the deleted message; deleting a `type 3` parent takes its copies in every chat with it (main:28943-28950). */
export const messageDeletedFrame = (message: WireMessage): string => serviceFrame(SERVICE.message, { type: EVENT.message.deleted, message });
export const ackFrame = (ackCommand: WireAckCommand): string => serviceFrame(SERVICE.group, { type: EVENT.group.ack, ackCommand });
export const typingFrame = (groupId: string, accountId: string, lastAnnounce = Date.now()): string =>
  serviceFrame(SERVICE.message, { type: EVENT.message.typing, typingAnnounceEvent: { accountId, groupId, lastAnnounce } });
export const followFrame = (follow: WireFollow): string => serviceFrame(SERVICE.follower, { type: EVENT.follower.followed, follow });
export const groupUserFrame = (groupUser: WireGroupUser, added: boolean): string =>
  serviceFrame(SERVICE.group, { type: added ? EVENT.group.userAdded : EVENT.group.userRemoved, groupUser });

/** A frame as its reader sees it after the three parses; null — not a frame the stand's page reads. */
export type ParsedFrame =
  | { readonly t: 0; readonly code: number }
  | { readonly t: 1 }
  | { readonly t: 2 }
  | { readonly t: 10000; readonly serviceId: number; readonly event: Readonly<Record<string, unknown>> }
  | { readonly t: 10001; readonly frames: readonly string[] };

/** Parses one text frame the way the page does; throws on a damaged one, as `JSON.parse` in the page's handler does. */
export function parseFrame(text: string): ParsedFrame | null {
  const wrapper = JSON.parse(text) as { t?: unknown; d?: unknown };
  if (wrapper.t === FRAME.error) return { t: 0, code: Number((JSON.parse(String(wrapper.d)) as { code?: unknown }).code) };
  if (wrapper.t === FRAME.session) return { t: 1 };
  if (wrapper.t === FRAME.pong) return { t: 2 };
  if (wrapper.t === FRAME.service) {
    const service = JSON.parse(String(wrapper.d)) as { serviceId?: unknown; event?: unknown };
    return { t: 10000, serviceId: Number(service.serviceId), event: JSON.parse(String(service.event)) as Record<string, unknown> };
  }
  // The page takes `d || []` and walks it by index: a string `d` would be walked by characters and throw.
  if (wrapper.t === FRAME.batch) return { t: 10001, frames: (wrapper.d ?? []) as string[] };
  return null;
}

// ── ids ──

/** Fansly's snowflake epoch (old `fansly-id-time.ts`): the bits above the low 22 are milliseconds since it. */
export const FANSLY_EPOCH_MS = 1_561_494_360_000;

/** The id Fansly would give something made at `ms`: 18 digits today, a string always. */
export function snowflakeAt(ms: number, sequence = 0): string {
  return String((BigInt(Math.max(1, Math.floor(ms) - FANSLY_EPOCH_MS)) << 22n) + BigInt(sequence & 0x3f_ffff));
}

/** The creation time an id carries. */
export function snowflakeMs(id: string): number {
  return Number(BigInt(id) >> 22n) + FANSLY_EPOCH_MS;
}

/** Snowflake order of two ids: the shorter is the older, then the string order. */
export function compareIds(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}
