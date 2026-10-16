// The background's pass of «Новые» on Fansly as pure rules (R20 P10b1; docs/project-unite/architecture.md §5.8, §8.7;
// FS-NEW-1, FS-NEW-7; NF-030…NF-033): how Fansly's answers read — the new followers, the start of the inbox, the
// profiles, a group, a page of history, the welcome texts of `/message/automated` — and what a walked history proves.
// The old extension's rules (src/background/followers-service.ts, src/shared/followers.ts), carried over:
// - a follow's moment is its id's (a snowflake from Fansly's epoch); ids are strings, never numbers;
// - a group is a fact only with exactly its two users, the creator and the fan (the participants' fence);
// - a page of history is a fact only when every message is of this group and of one of the two;
// - a message of the creator's is automated by `type === 2`, a `correlationId` without `inReplyTo`, or a welcome text
//   after whitespace is folded (NF-033, the owner's rule: the exact text); personal — the creator's `type 1` message
//   that is not automated; a fan's message is always personal for the count (§5.8);
// - only a history walked to its empty page proves the start: `StartProofV1` with `source: 'pass-empty-page'`,
//   `coveredCount` — every message walked, `personalCount` — the personal ones among the last 30 (HF-5, as the old).
// - a group's DM rules (`dmPermissionFlags`): may the creator write to the fan at all (R20 P10b2, ./dm-permissions.ts).
// Nothing here asks Fansly, keeps a text or names a site.

import { compareNativeIds, NATIVE_ID_PATTERN } from '@cg/contracts/primitives';
import { FANSLY_AVATAR_URL_PATTERN, FANSLY_LIMITS, type StartProofV1 } from '@cg/contracts/fansly';
import { FANSLY_TAB_LIMITS, type FanslyPreviewMessage } from '@cg/contracts/tab-messages-fansly';
import { type NewcomerDmClosed } from '@cg/contracts/vm';

import { groupDmClosed } from './dm-permissions';

/** Fansly's epoch: the milliseconds of a snowflake count from here (old fansly-id-time.ts). */
export const FANSLY_EPOCH_MS = 1_561_494_360_000;

/** The old pass's bounds (NF-030…NF-032; architecture §8.7). */
export const PASS_BOUNDS = {
  /** `followersnew`: at most 20 pages of 100. */
  followerPages: 20,
  followerPage: 100,
  /** The start of the inbox: pages of 100 while its last row is newer than the period, at most 10. */
  inboxPages: 10,
  inboxPage: 100,
  /** `/account?ids=`: 100 ids a batch. */
  profileBatch: 100,
  /** A history: pages of 25 (the page's own), to the empty page, at most 30. */
  historyPage: FANSLY_LIMITS.historyPage,
  historyPages: 30,
  /** The ids of a checked history the proof names (both directions), newest. */
  windowIds: 60,
  /** Messages of a walked history kept for the card (newest); older ones are read again when asked. */
  previewKept: FANSLY_TAB_LIMITS.historyMessagesPerRead,
} as const;

/** The «Custom Username» note (FS-NOTE: contentType 12002): the creator's own name for the fan. */
const CUSTOM_NAME_NOTE = 12002;

const isId = (value: unknown): value is string => typeof value === 'string' && NATIVE_ID_PATTERN.test(value);
const record = (value: unknown): Record<string, unknown> | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null);
const text = (value: unknown, max: number): string | null => (typeof value === 'string' && value.trim() !== '' ? value.slice(0, max) : null);

/** The moment a Fansly id was made, epoch ms; null — not a Fansly id (or from the future). */
export function snowflakeMs(id: string, now: number): number | null {
  if (!isId(id)) return null;
  const ms = Number(BigInt(id) >> 22n) + FANSLY_EPOCH_MS;
  return Number.isSafeInteger(ms) && ms > FANSLY_EPOCH_MS && ms <= now + 60_000 ? ms : null;
}

// ── profiles ──

export interface PassProfile {
  readonly fanRef: string;
  readonly username: string | null;
  readonly displayName: string | null;
  readonly bio: string | null;
  /** Read only from an account that carried its notes; undefined — the answer did not say. */
  readonly customName: string | null | undefined;
  /** R20 P10c (FX-018, NF-034): the avatar's address fit to send to the hub for Hi; null — none. */
  readonly avatarUrl: string | null;
}

/** The hub's `fanslyAvatarUrlSchema`: at most this long. */
const AVATAR_MAX_CHARS = 4096;
/** The CDN's signature, kept from a location's metadata (as MAIN's avatarOf, host-fansly main/identity.ts). */
const SIGNATURE_KEYS = ['Key-Pair-Id', 'Policy', 'Signature'] as const;
const AVATAR_ORIGIN = /^https:\/\/([-a-z0-9]+\.fansly\.com)(\/[^\s#]*)?$/i;
const amount = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/**
 * The fan's avatar address by the rule of MAIN's `avatarOf` (the old extension's and the hub's): the largest variant up
 * to 512 px, then the image itself; its first location, https on a `*.fansly.com` host with no user or port, the CDN's
 * signature from the location's metadata. A pure reading of the string — the core has no URL parser.
 */
export function avatarUrlOf(account: Record<string, unknown>): string | null {
  const avatar = record(account['avatar']);
  if (avatar === null) return null;
  const variants = (Array.isArray(avatar['variants']) ? (avatar['variants'] as unknown[]) : [])
    .map(record)
    .filter((v): v is Record<string, unknown> => v !== null && amount(v['width']) > 0 && amount(v['width']) <= 512)
    .sort((a, b) => amount(b['width']) - amount(a['width']));
  for (const candidate of [...variants, avatar]) {
    const locations = candidate['locations'];
    const first = Array.isArray(locations) ? record((locations as unknown[])[0]) : null;
    const location = first?.['location'];
    const raw = typeof location === 'string' && location !== '' ? location : candidate['location'];
    if (typeof raw !== 'string') continue;
    const match = AVATAR_ORIGIN.exec(raw);
    if (match === null) continue;
    let href = `https://${(match[1] as string).toLowerCase()}${match[2] ?? '/'}`;
    const metadata = record(first?.['metadata']);
    if (metadata !== null) {
      for (const key of SIGNATURE_KEYS) {
        const value = metadata[key];
        if (typeof value !== 'string' || new RegExp(`[?&]${key}=`).test(href)) continue;
        href += `${href.includes('?') ? '&' : '?'}${key}=${encodeURIComponent(value)}`;
      }
    }
    if (href.length <= AVATAR_MAX_CHARS && FANSLY_AVATAR_URL_PATTERN.test(href)) return href;
  }
  return null;
}

export function profileOf(value: unknown): PassProfile | null {
  const account = record(value);
  if (account === null || !isId(account['id'])) return null;
  const notes = account['notes'];
  let customName: string | null | undefined;
  if (Array.isArray(notes)) {
    const note = notes.map(record).find((entry) => entry?.['contentType'] === CUSTOM_NAME_NOTE);
    customName = text(typeof note?.['note'] === 'string' ? note['note'].trim() : null, FANSLY_TAB_LIMITS.customNameMaxChars);
  }
  return {
    fanRef: account['id'],
    username: text(account['username'], 64),
    displayName: text(account['displayName'], 128),
    bio: text(account['about'], FANSLY_TAB_LIMITS.bioMaxChars),
    customName,
    avatarUrl: avatarUrlOf(account),
  };
}

/** `GET /account?ids=`: an array of accounts (or `{accounts}`); null — not that shape. */
export function readAccounts(response: unknown): PassProfile[] | null {
  const list = Array.isArray(response) ? response : record(response)?.['accounts'];
  if (!Array.isArray(list)) return null;
  return list.map(profileOf).filter((profile): profile is PassProfile => profile !== null);
}

// ── followers (NF-030) ──

export interface FollowersPage {
  readonly follows: readonly { readonly id: string; readonly fanRef: string }[];
  readonly profiles: readonly PassProfile[];
}

/** `GET /account/<creator>/followersnew`: newest first. Null — a malformed page (an entry without its ids). */
export function readFollowersPage(response: unknown): FollowersPage | null {
  const page = record(response);
  const list = page?.['followers'];
  if (page === null || !Array.isArray(list)) return null;
  const follows: { id: string; fanRef: string }[] = [];
  for (const entry of list) {
    const follow = record(entry);
    if (follow === null || !isId(follow['id']) || !isId(follow['followerId'])) return null;
    follows.push({ id: follow['id'], fanRef: follow['followerId'] });
  }
  const accounts = record(page['aggregationData'])?.['accounts'];
  return { follows, profiles: Array.isArray(accounts) ? (readAccounts(accounts) ?? []) : [] };
}

// ── messages (NF-033) ──

/** A message of a chat as the pass reads it: the fields its rules need, and the text for the card. */
export interface PassMessage {
  readonly id: string;
  readonly senderId: string;
  readonly type: number;
  readonly correlationId: string | null;
  readonly inReplyTo: string | null;
  /** Epoch ms. */
  readonly at: number;
  readonly content: string;
  readonly attachments: number;
}

const zeroless = (value: unknown): string | null => (isId(value) ? value : null);

/**
 * A message of this group by one of its two users; null — not one (another group, a stranger, a broken id) or, with
 * `strict`, without the fields that tell an automation from a personal message (Fansly's key sets drift: such a
 * message proves nothing).
 */
export function messageOf(value: unknown, groupId: string, users: readonly string[], now: number, strict = false): PassMessage | null {
  const message = record(value);
  if (message === null || !isId(message['id']) || message['groupId'] !== groupId) return null;
  const senderId = message['senderId'];
  if (typeof senderId !== 'string' || !users.includes(senderId)) return null;
  if (strict && (typeof message['type'] !== 'number' || !('correlationId' in message) || !('inReplyTo' in message))) return null;
  const seconds = message['createdAt'];
  const at = typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : (snowflakeMs(message['id'], now) ?? now);
  return {
    id: message['id'],
    senderId,
    type: typeof message['type'] === 'number' ? message['type'] : 0,
    correlationId: zeroless(message['correlationId']),
    inReplyTo: zeroless(message['inReplyTo']),
    at,
    content: typeof message['content'] === 'string' ? message['content'] : '',
    attachments: Array.isArray(message['attachments']) ? message['attachments'].length : 0,
  };
}

/** `GET /message?groupId=`: a page, newest first; null — a page that is not a fact about this group (the old refusal). */
export function readHistoryPage(response: unknown, groupId: string, users: readonly string[], now: number): PassMessage[] | null {
  const list = record(response)?.['messages'];
  if (!Array.isArray(list)) return null;
  const messages: PassMessage[] = [];
  for (const entry of list) {
    const message = messageOf(entry, groupId, users, now);
    if (message === null) return null;
    messages.push(message);
  }
  return messages;
}

/** Runs of whitespace fold to one space, the ends trimmed (the owner's rule for a welcome text). */
export const foldText = (value: string): string => value.replace(/\s+/gu, ' ').trim();

/** `GET /message/automated`: the creator's welcome texts, folded; null — not that shape. */
export function readWelcomeTexts(response: unknown): Set<string> | null {
  if (!Array.isArray(response)) return null;
  const texts = new Set<string>();
  for (const item of response) {
    let template = record(item)?.['messageTemplate'];
    if (typeof template === 'string') {
      try {
        template = JSON.parse(template) as unknown;
      } catch {
        continue;
      }
    }
    const content = record(template)?.['content'];
    if (typeof content === 'string' && foldText(content) !== '') texts.add(foldText(content));
  }
  return texts;
}

/** NF-033: a message made by something — `type 2`, a `correlationId` that is not a reply, or a welcome text. */
export function isAutomated(message: PassMessage, welcome: ReadonlySet<string>): boolean {
  if (message.type === 2) return true;
  if (message.correlationId !== null && message.inReplyTo === null) return true;
  const folded = foldText(message.content);
  return folded !== '' && welcome.has(folded);
}

/** The creator's own message to the fan: `type 1` and not automated. Its presence is «Уже писали». */
export function isCreatorPersonal(message: PassMessage, creatorId: string, welcome: ReadonlySet<string>): boolean {
  return message.senderId === creatorId && message.type === 1 && !isAutomated(message, welcome);
}

/** For the count of §5.8: the fan's messages always, the creator's when personal. */
export function countsPersonal(message: PassMessage, creatorId: string, welcome: ReadonlySet<string>): boolean {
  return message.senderId !== creatorId || isCreatorPersonal(message, creatorId, welcome);
}

export function previewOf(message: PassMessage, creatorId: string, welcome: ReadonlySet<string>): FanslyPreviewMessage {
  return {
    messageId: message.id,
    fromFan: message.senderId !== creatorId,
    at: new Date(message.at).toISOString(),
    text: message.content.slice(0, FANSLY_TAB_LIMITS.historyMessageMaxChars),
    automated: message.senderId === creatorId && isAutomated(message, welcome),
    attachments: message.attachments,
  };
}

/** Oldest first, by snowflake (never by `createdAt`: one second holds several messages). */
export const byId = (a: PassMessage, b: PassMessage): number => compareNativeIds(a.id, b.id);

// ── groups and the inbox (NF-031, NF-032) ──

/** A chat of the fan's the pass learned of: its group, whether the answer named both users, its last message. */
export interface PassChat {
  readonly fanRef: string;
  readonly groupId: string;
  /** The answer listed exactly the creator and the fan: no `GET /group` is needed to trust it. */
  readonly verified: boolean;
  /** A last message that carries the fields of the rule; null — none or unreadable (it proves nothing then). */
  readonly last: PassMessage | null;
  /** Its object named a last message (an empty first page of history is then a lagging read, not an empty chat). */
  readonly lastKnown: boolean;
  /** The known head must occur in the walked history before it can prove the chat ready. */
  readonly lastMessageId: string | null;
  /**
   * R20 P10b2, FS-NEW-2: the fan's DM rules this answer carried (`dmPermissionFlags`) — `dmRead` — and, when the creator
   * meets none of them, why (`dmClosed`); an answer without the rules (a thin inbox entry) says nothing either way.
   */
  readonly dmRead: boolean;
  readonly dmClosed: NewcomerDmClosed | null;
  readonly dmPriceMills?: number | null;
}

/** A richer group object cannot erase the inbox's evidence that the chat already has messages. */
export function withChatHead(chat: PassChat, lastMessageId: string | null, lastKnown = lastMessageId !== null): PassChat {
  const head = [chat.lastMessageId, lastMessageId].filter((id): id is string => id !== null).sort(compareNativeIds).at(-1) ?? null;
  return { ...chat, lastMessageId: head, lastKnown: chat.lastKnown || lastKnown || head !== null };
}

function usersOf(group: Record<string, unknown>): string[] {
  const users = group['users'];
  return Array.isArray(users) ? users.map((user) => record(user)?.['userId']).filter((id): id is string => typeof id === 'string') : [];
}

/** A group object (`GET /group/<id>/`, `POST /group`, the inbox's aggregation): the fan's chat with the creator, or null. */
export function readGroup(response: unknown, creatorId: string, fanRef: string, now: number, expected?: string): PassChat | null {
  const group = record(response);
  if (group === null || !isId(group['id']) || (expected !== undefined && group['id'] !== expected)) return null;
  const users = usersOf(group);
  if (users.length !== 2 || !users.includes(creatorId) || !users.includes(fanRef) || creatorId === fanRef) return null;
  const last = group['lastMessage'] === null || group['lastMessage'] === undefined ? null : messageOf(group['lastMessage'], group['id'], [creatorId, fanRef], now, true);
  const dm = groupDmClosed(group);
  const chat: PassChat = { fanRef, groupId: group['id'], verified: true, last, lastKnown: group['lastMessage'] !== null && group['lastMessage'] !== undefined, lastMessageId: zeroless(record(group['lastMessage'])?.['id']), dmRead: dm.read, dmClosed: dm.closed, dmPriceMills: dm.priceMills };
  return withChatHead(chat, zeroless(group['lastMessageId']));
}

export interface InboxPage {
  readonly chats: readonly PassChat[];
  readonly count: number;
  /** The last row's last message id: how far back this page reaches; null — unknown. */
  readonly tail: string | null;
}

/** `GET /messaging/groups`: the chats of the wanted fans; a thin entry is a lead that `GET /group` confirms. */
export function readInboxPage(response: unknown, creatorId: string, wanted: ReadonlySet<string>, now: number): InboxPage | null {
  const page = record(response);
  const data = page?.['data'];
  if (page === null || !Array.isArray(data)) return null;
  const groups = new Map<string, unknown>();
  const aggregated = record(page['aggregationData'])?.['groups'];
  for (const group of Array.isArray(aggregated) ? aggregated : []) {
    const id = record(group)?.['id'];
    if (typeof id === 'string') groups.set(id, group);
  }
  const chats: PassChat[] = [];
  const seen = new Set<string>();
  for (const item of data) {
    const entry = record(item);
    const fanRef = entry?.['partnerAccountId'];
    const groupId = entry?.['groupId'];
    if (!isId(fanRef) || !isId(groupId) || seen.has(fanRef) || !wanted.has(fanRef)) continue;
    seen.add(fanRef);
    const chat = readGroup(groups.get(groupId), creatorId, fanRef, now, groupId);
    chats.push(withChatHead(chat ?? { fanRef, groupId, verified: false, last: null, lastKnown: false, lastMessageId: null, dmRead: false, dmClosed: null }, zeroless(entry?.['lastMessageId'])));
  }
  const tail = record(data.at(-1))?.['lastMessageId'];
  return { chats, count: data.length, tail: isId(tail) ? tail : null };
}

// ── what a walked history proves (FS-NEW-7, §5.8) ──

/** The ids of a checked history the generation names: both directions, the newest `PASS_BOUNDS.windowIds`, oldest first. */
export function windowOf(messages: readonly PassMessage[], creatorId: string): { readonly id: string; readonly dir: 'fan' | 'model' }[] {
  return messages.slice(-PASS_BOUNDS.windowIds).map((message) => ({ id: message.id, dir: message.senderId === creatorId ? 'model' : 'fan' }));
}

/**
 * The start of a conversation the pass walked to its empty page (`messages` — every message walked, oldest first):
 * the earliest message is the witness, every one is covered, the personal ones are counted among the last 30.
 */
export function passStartProof(groupId: string, messages: readonly PassMessage[], creatorId: string, welcome: ReadonlySet<string>): StartProofV1 {
  const last = messages.slice(-FANSLY_LIMITS.passPersonalWindow);
  return {
    v: 1,
    source: 'pass-empty-page',
    groupId,
    startWitnessId: messages[0]?.id ?? null,
    coveredCount: messages.length,
    personalCount: last.filter((message) => countsPersonal(message, creatorId, welcome)).length,
    automatedIds: messages
      .filter((message) => message.senderId === creatorId && isAutomated(message, welcome))
      .map((message) => message.id)
      .slice(-FANSLY_LIMITS.automatedIdsMax),
  };
}
