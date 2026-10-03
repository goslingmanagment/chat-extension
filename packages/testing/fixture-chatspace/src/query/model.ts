// Cache shapes of the stand, mapped from the raw API the way ChatSpace's
// mappers do (metadata.ts «cache-shapes»): ids stay strings except the
// account's numeric `id`; messages are `{id, text, createdAt, platformSenderId,
// isOutgoing, platform, platformMetadata}`; history pages run newest first.
// `platformMetadata` is the MAPPED OnlyFans metadata (field names as in the
// host's cache, values derived by our own code), not the raw platform object:
// raw fields such as changedAt, fromUser, media, previews, lockedText or
// responseType never reach the cache.

export interface Account {
  readonly id: number;
  readonly platformAccountId: string;
  readonly platform: string;
  readonly name: string;
  readonly avatar: string | null;
  readonly username: string;
  readonly subscribePrice: number;
  readonly status: string;
  readonly expiredAt: string | null;
  readonly isExpiredSoon: boolean;
  readonly customLabel: string | null;
  readonly note: string | null;
  readonly timezone: string | null;
}

/** Locked (paid, unopened) media by kind. */
export interface LockedMediaCounts {
  readonly images: number;
  readonly videos: number;
  readonly gifs: number;
  readonly audios: number;
}

/** A message's OnlyFans metadata as the cache holds it. */
export interface OnlyFansMessageMetadata {
  readonly isTip: boolean;
  readonly tipText?: string;
  readonly gifUrl: string | null;
  readonly giphyId?: string;
  readonly replyToMessage?: { readonly id: string };
  readonly mediaItems?: ReadonlyArray<{ readonly id: string; readonly type: string; readonly isFree: boolean }>;
  readonly audioItems?: ReadonlyArray<{ readonly id: string; readonly isFree: boolean }>;
  readonly storyImageUrl?: string;
  readonly tags?: unknown;
  readonly taggedCreators?: readonly unknown[];
  readonly mediaCount?: number;
  readonly isFree?: boolean;
  readonly isOpened?: boolean;
  readonly isNew?: boolean;
  readonly isMediaReady?: boolean;
  readonly price?: number | null;
  readonly lockedMediaCounts?: LockedMediaCounts;
  readonly isLockedText?: true;
  readonly isLiked?: boolean;
  readonly isPinned?: boolean;
  readonly canBePinned?: boolean;
  readonly canReport?: boolean;
  readonly cancelSeconds: number;
  readonly cancelSecondsAsOf?: string;
  readonly isFromQueue?: boolean;
  readonly queueId?: unknown;
  readonly isUnsent?: boolean;
}

export interface Message {
  readonly id: string;
  readonly text: string;
  readonly createdAt: string;
  readonly platformSenderId: string;
  readonly isOutgoing: boolean;
  readonly platform: string;
  readonly platformMetadata: OnlyFansMessageMetadata;
}

export interface HistoryPage {
  readonly items: readonly Message[];
  readonly hasMore: boolean;
  readonly cursor: string | null;
}

export interface History {
  readonly pages: readonly HistoryPage[];
  readonly pageParams: readonly (string | null)[];
}

export interface Chat {
  readonly id: string;
  readonly accountId: string;
  readonly platform: string;
  readonly unreadMessagesCount: number;
  readonly lastMessage: Message | null;
  readonly canSendMessage: boolean;
  readonly isMutedNotifications: boolean;
  readonly isMarkedAsUnread?: boolean | undefined;
}

export interface ChatListPage {
  readonly items: readonly Chat[];
  readonly hasMore: boolean;
  readonly nextOffset: number;
}

export interface ChatList {
  readonly pages: readonly ChatListPage[];
  readonly pageParams: readonly number[];
}

export interface Fan {
  readonly id: string;
  readonly name: string;
  readonly customName: string | null;
  readonly username: string;
  readonly avatarUrl: string | null;
  readonly avatarThumbnailUrl: string | null;
  readonly lastSeen: string | null;
  readonly isRestricted: boolean;
  readonly isBlocked: boolean;
  readonly canReceiveMessages: boolean;
  readonly isExpired: boolean;
  readonly isVerified: boolean;
  readonly note: string | null;
  readonly isMuted: boolean;
  readonly totalSpent: number;
  readonly subscribedAt: string | null;
  readonly isSubscribed: boolean | null;
  readonly isSubscribedByAccount: boolean | null;
  readonly isRebillOn: boolean;
  readonly subscriptionExpiresAt: string | null;
  readonly subscriptionPrice: number | null;
  readonly headerUrl: string | null;
}

export type FansMap = Readonly<Record<string, Fan | null>>;

export interface MimicChat {
  readonly accountId: string;
  readonly fanId: string;
  readonly status: string;
}

type Raw = Record<string, unknown>;

const str = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : fallback);
const strOrNull = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
const num = (value: unknown): number => (typeof value === 'number' ? value : Number(value) || 0);
const bool = (value: unknown): boolean => value === true;
const record = (value: unknown): Raw => (typeof value === 'object' && value !== null ? (value as Raw) : {});

export function mapAccount(raw: Raw): Account {
  return {
    id: Number(raw['id']),
    platformAccountId: str(raw['platform_account_id']),
    platform: str(raw['platform'], 'onlyfans'),
    name: str(raw['name']),
    avatar: strOrNull(raw['avatar']),
    username: str(raw['username']),
    subscribePrice: num(raw['subscribe_price']),
    status: str(raw['status']),
    expiredAt: strOrNull(raw['expired_at']),
    isExpiredSoon: bool(raw['is_expired_soon']),
    customLabel: strOrNull(raw['custom_label']),
    note: strOrNull(raw['note']),
    timezone: strOrNull(raw['timezone']),
  };
}

const optional = <T>(value: unknown, test: (value: unknown) => value is T): T | undefined => (test(value) ? value : undefined);
const isNumber = (value: unknown): value is number => typeof value === 'number';
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
const nonEmpty = <T>(items: readonly T[]): readonly T[] | undefined => (items.length > 0 ? items : undefined);

/** Raw OnlyFans message metadata → the cache's metadata (own derivation; the stand has text messages only). */
export function mapOnlyFansMetadata(raw: Raw): OnlyFansMessageMetadata {
  const media = Array.isArray(raw['media']) ? (raw['media'] as unknown[]).map(record) : [];
  const freeIds = new Set((Array.isArray(raw['previews']) ? (raw['previews'] as unknown[]) : []).map((id) => String(id)));
  const viewable = media.filter((item) => item['canView'] === true);
  const locked = media.filter((item) => item['canView'] !== true);
  const countOf = (type: string): number => locked.filter((item) => item['type'] === type).length;
  const isTip = bool(raw['isTip']);
  const isFree = optional(raw['isFree'], isBoolean);
  const giphyId = strOrNull(raw['giphyId']);
  const replyTo = record(raw['replyToMessage']);
  const tipText = strOrNull(raw['tipText']);
  const lockedCounts = locked.length > 0 && isFree !== true && raw['isOpened'] !== true ? { images: countOf('photo'), videos: countOf('video'), gifs: countOf('gif'), audios: countOf('audio') } : undefined;
  const mediaItems = nonEmpty(viewable.filter((item) => item['type'] !== 'audio').map((item) => ({ id: str(item['id']), type: str(item['type']), isFree: freeIds.has(str(item['id'])) })));
  const audioItems = nonEmpty(viewable.filter((item) => item['type'] === 'audio').map((item) => ({ id: str(item['id']), isFree: freeIds.has(str(item['id'])) })));
  const mediaCount = optional(raw['mediaCount'], isNumber);
  const isOpened = optional(raw['isOpened'], isBoolean);
  const isNew = optional(raw['isNew'], isBoolean);
  const isMediaReady = optional(raw['isMediaReady'], isBoolean);
  return {
    isTip,
    ...(tipText !== null ? { tipText } : {}),
    gifUrl: giphyId === null ? null : `/stand-gif/${giphyId}.gif`,
    ...(giphyId !== null ? { giphyId } : {}),
    ...(typeof replyTo['id'] === 'string' || typeof replyTo['id'] === 'number' ? { replyToMessage: { id: str(replyTo['id']) } } : {}),
    ...(mediaItems !== undefined ? { mediaItems } : {}),
    ...(audioItems !== undefined ? { audioItems } : {}),
    ...(mediaCount !== undefined ? { mediaCount } : {}),
    ...(isFree !== undefined ? { isFree } : {}),
    ...(isOpened !== undefined ? { isOpened } : {}),
    ...(isNew !== undefined ? { isNew } : {}),
    ...(isMediaReady !== undefined ? { isMediaReady } : {}),
    price: typeof raw['price'] === 'number' ? raw['price'] : null,
    ...(lockedCounts !== undefined ? { lockedMediaCounts: lockedCounts } : {}),
    ...(raw['lockedText'] === true && !isTip && isFree !== true ? { isLockedText: true as const } : {}),
    isLiked: bool(raw['isLiked']),
    isPinned: bool(raw['isPinned']),
    canBePinned: bool(raw['canBePinned']),
    canReport: bool(raw['canReport']),
    cancelSeconds: num(raw['cancelSeconds']),
    cancelSecondsAsOf: new Date().toISOString(),
    isFromQueue: bool(raw['isFromQueue']),
    queueId: raw['queueId'] ?? null,
    isUnsent: bool(raw['isUnsent']),
  };
}

/** Metadata of a message the queue just sent (the server answered with its id only). */
export function sentMessageMetadata(cancelSeconds: number): OnlyFansMessageMetadata {
  return { isTip: false, gifUrl: null, mediaCount: 0, isFree: true, isOpened: false, isLiked: false, isPinned: false, canBePinned: false, canReport: false, cancelSeconds };
}

/** A history item from the REST API. */
export function mapRestMessage(raw: Raw, platform: string, ids: { readonly fanId: string; readonly platformAccountId: string }): Message {
  const fromFan = bool(raw['is_from_fan']);
  return {
    id: str(raw['id']),
    text: str(raw['content']),
    createdAt: str(raw['sent_at']),
    platformSenderId: fromFan ? ids.fanId : ids.platformAccountId,
    isOutgoing: !fromFan,
    platform,
    platformMetadata: mapOnlyFansMetadata(record(raw['platform_metadata'])),
  };
}

/** The `message` of an `account_new_message` socket frame. */
export function mapSocketMessage(raw: Raw, account: Raw, platform: string): Message {
  const fromFan = bool(raw['is_from_fan']);
  return {
    id: str(raw['id']),
    text: str(raw['content']),
    createdAt: str(raw['sentAt']),
    platformSenderId: fromFan ? str(raw['platform_fan_id']) : str(account['platform_account_id']),
    isOutgoing: !fromFan,
    platform,
    platformMetadata: mapOnlyFansMetadata(record(raw['platformMetadata'])),
  };
}

export function mapChat(raw: Raw, accountId: string, platformAccountId: string): Chat {
  const fanId = str(raw['platform_fan_id']);
  const last = raw['last_message'];
  const meta = record(raw['platform_metadata']);
  return {
    id: fanId,
    accountId,
    platform: 'onlyfans',
    unreadMessagesCount: num(raw['unread_messages_count']),
    lastMessage:
      typeof last === 'object' && last !== null
        ? mapRestMessage({ ...(last as Raw), is_from_fan: str(record(record((last as Raw)['platform_metadata'])['fromUser'])['id']) === fanId }, 'onlyfans', { fanId, platformAccountId })
        : null,
    canSendMessage: meta['canSendMessage'] !== false,
    isMutedNotifications: bool(meta['isMutedNotifications']),
  };
}

export function mapFan(raw: Raw): Fan {
  const subscription = record(raw['subscribedOnData']);
  const price = subscription['subscribePrice'];
  return {
    id: str(raw['id']),
    name: str(raw['name']),
    customName: strOrNull(raw['displayName']),
    username: str(raw['username']),
    avatarUrl: strOrNull(raw['avatar']),
    avatarThumbnailUrl: strOrNull(raw['avatar']),
    lastSeen: strOrNull(raw['lastSeen']),
    isRestricted: bool(raw['isRestricted']),
    isBlocked: bool(raw['isBlocked']),
    canReceiveMessages: raw['canReceiveChatMessage'] !== false,
    isExpired: bool(raw['subscribedIsExpiredNow']),
    isVerified: bool(raw['isVerified']),
    note: strOrNull(raw['notice']),
    isMuted: false,
    totalSpent: num(subscription['totalSumm']),
    subscribedAt: strOrNull(subscription['subscribeAt']),
    isSubscribed: typeof raw['subscribedOn'] === 'boolean' ? raw['subscribedOn'] : null,
    isSubscribedByAccount: typeof raw['subscribedBy'] === 'boolean' ? raw['subscribedBy'] : null,
    isRebillOn: strOrNull(subscription['renewedAt']) !== null,
    subscriptionExpiresAt: strOrNull(subscription['expiredAt']),
    subscriptionPrice: price === null || price === undefined ? null : Number(price),
    headerUrl: strOrNull(raw['header']),
  };
}

/** Every entity decoded by the browser's own HTML parser (`&nbsp;` → U+00A0). */
function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return new DOMParser().parseFromString(text, 'text/html').documentElement.textContent ?? '';
}

/**
 * Plain text of an HTML message, as the host compares echoes: every tag
 * dropped (a `<br>` leaves no newline), every entity decoded, trimmed.
 */
export function plainText(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, '')).trim();
}

/** Newest message across all loaded history pages. */
export function newestMessage(history: History | undefined): Message | null {
  let best: Message | null = null;
  for (const page of history?.pages ?? []) {
    for (const item of page.items) if (best === null || item.createdAt > best.createdAt) best = item;
  }
  return best;
}

/** Inserts (or replaces) a message at the top of the first page; idempotent by id. */
export function upsertMessage(history: History, message: Message): History {
  const pages = history.pages.map((page) => ({ ...page, items: page.items.filter((item) => item.id !== message.id) }));
  const [first, ...rest] = pages;
  return { ...history, pages: first === undefined ? [{ items: [message], hasMore: false, cursor: null }] : [{ ...first, items: [message, ...first.items] }, ...rest] };
}

export const hasMessage = (history: History | undefined, id: string): boolean => history?.pages.some((page) => page.items.some((item) => item.id === id)) ?? false;
