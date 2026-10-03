// Cache shapes of the stand, mapped from the raw API the way ChatSpace's
// mappers do (metadata.ts «cache-shapes»): ids stay strings except the
// account's numeric `id`; messages are `{id, text, createdAt, platformSenderId,
// isOutgoing, platform, platformMetadata}`; history pages run newest first.

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

export interface Message {
  readonly id: string;
  readonly text: string;
  readonly createdAt: string;
  readonly platformSenderId: string;
  readonly isOutgoing: boolean;
  readonly platform: string;
  readonly platformMetadata: Readonly<Record<string, unknown>>;
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
  readonly isMarkedAsUnread?: boolean;
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
    platformMetadata: record(raw['platform_metadata']),
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
    platformMetadata: record(raw['platformMetadata']),
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

/** Plain text of an HTML message (tags dropped, entities decoded, trimmed) — how echoes are compared. */
export function plainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&')
    .trim();
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
