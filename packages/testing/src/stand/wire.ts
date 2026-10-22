// Raw API and socket shapes the stand serves, written by hand from the
// research mappers (docs/research/onlymonster-chatspace/api-catalog.md §3,
// client-internals.md §1.5). The page maps them the way ChatSpace does; only
// the fields the extension or the fixture read are present.

import type { StandAccount, StandChat, StandFan, StandMessage } from './dataset';

export function rawAccount(account: StandAccount): Record<string, unknown> {
  return {
    id: Number(account.id),
    platform_account_id: account.platformAccountId,
    platform: 'onlyfans',
    name: account.name,
    avatar: null,
    username: account.username,
    subscribe_price: 0,
    status: 'active',
    expired_at: null,
    is_expired_soon: false,
    custom_label: null,
    note: null,
    timezone: 'UTC',
  };
}

export function messageMetadata(message: StandMessage): Record<string, unknown> {
  const paid = (message.price ?? 0) > 0;
  const media = [
    ...(paid ? [{ id: Number(message.id), type: 'video', canView: message.isOpened === true }] : []),
    ...(message.audio ? [{ id: Number(message.audio.id), type: 'audio', canView: true, duration: message.audio.duration }] : []),
  ];
  return {
    responseType: 'message',
    isOpened: message.isOpened ?? false,
    isNew: message.isNew ?? true,
    changedAt: message.sentAt,
    cancelSeconds: message.isFromFan ? 0 : 60,
    isFromQueue: false,
    queueId: null,
    price: message.price ?? 0,
    isFree: !paid,
    lockedText: false,
    mediaCount: media.length,
    media,
    previews: [],
    isTip: false,
    canPurchase: false,
    isLiked: false,
    isPinned: message.isPinned === true,
    canBePinned: true,
    canReport: message.isFromFan,
    isMediaReady: true,
  };
}

export function rawMessage(message: StandMessage): Record<string, unknown> {
  return {
    id: message.id,
    content: message.content,
    sent_at: message.sentAt,
    is_from_fan: message.isFromFan,
    platform_metadata: messageMetadata(message),
  };
}

/**
 * The chat list's last message's metadata: the few keys the live list carries (every chat of sixteen captured pages,
 * 2026-10-09…22) — never the history's whole message, so no `isNew`: whether the fan read it is not in the list.
 */
function listMessageMetadata(message: StandMessage, fromUserId: number): Record<string, unknown> {
  const { isOpened, lockedText, isFree, mediaCount, isTip } = messageMetadata(message);
  return { isOpened, giphyId: null, lockedText, isFree, mediaCount, isTip, fromUser: { id: fromUserId } };
}

export function rawChat(chat: StandChat, account: StandAccount): Record<string, unknown> {
  const last = chat.messages.at(-1);
  return {
    platform_fan_id: chat.fan.id,
    unread_messages_count: chat.unread,
    last_message: last
      ? {
          id: last.id,
          content: last.content,
          sent_at: last.sentAt,
          platform_metadata: listMessageMetadata(last, Number(last.isFromFan ? chat.fan.id : account.platformAccountId)),
        }
      : null,
    platform_metadata: {
      canGoToProfile: true,
      canNotSendReason: chat.fan.isBlocked ? 'blocked' : null,
      canSendMessage: !chat.fan.isBlocked && chat.fan.canReceiveChatMessage,
      countPinnedMessages: 0,
      hasPurchasedFeed: false,
      hasUnreadTips: false,
      isMutedNotifications: false,
      lastReadMessageId: null,
    },
  };
}

/** A raw platform user (fan), the subset ChatSpace's fan mapper reads. */
export function rawFan(fan: StandFan): Record<string, unknown> {
  return {
    id: Number(fan.id),
    name: fan.name,
    displayName: '',
    username: fan.username,
    avatar: null,
    avatarThumbs: null,
    header: null,
    lastSeen: fan.lastSeen,
    isRestricted: fan.isRestricted,
    isBlocked: fan.isBlocked,
    canReceiveChatMessage: fan.canReceiveChatMessage,
    subscribedIsExpiredNow: !fan.subscribedOn,
    isVerified: false,
    notice: '',
    listsStates: [],
    subscribedOn: fan.subscribedOn,
    subscribedBy: false,
    subscribedOnData: {
      totalSumm: fan.totalSpent,
      subscribeAt: '2026-06-01T00:00:00+00:00',
      expiredAt: fan.subscribedOn ? '2026-12-01T00:00:00+00:00' : '2026-08-01T00:00:00+00:00',
      renewedAt: null,
      subscribePrice: 0,
    },
  };
}

/** The `account` object of server socket frames. */
export function frameAccount(account: StandAccount): Record<string, unknown> {
  return { account_id: account.id, platform: 'onlyfans', platform_account_id: account.platformAccountId, platform_id: 1 };
}

/** `account_new_message`, top-level fields as ChatSpace's socket listeners destructure them. */
export function newMessageFrame(account: StandAccount, fanId: string, message: StandMessage): Record<string, unknown> {
  return {
    event: 'account_new_message',
    account: frameAccount(account),
    message: {
      id: message.id,
      content: message.content,
      sentAt: message.sentAt,
      chatId: fanId,
      platform_fan_id: fanId,
      is_from_fan: message.isFromFan,
      platformMetadata: messageMetadata(message),
    },
  };
}
