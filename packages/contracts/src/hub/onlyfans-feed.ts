// The OnlyFans feed from ChatSpace (hub #953, `onlyfans-feed-v1`, the page's `ofFeed`; `clientOnlyfansFeed`). From
// 2026-11-01 the hub has no OnlyFansAPI: the extension passes on to the hub what the chatter's ChatSpace itself already
// received — its socket's frames and the answers of its own reads — so the hub's archive, the page's chats, its money
// and its fans stay fresh. It makes no request of its own for it.
//
// One report names one page, the OnlyMonster account the page showed the records under and that account's OnlyFans
// creator; at most ONLYFANS_FEED_MAX_RECORDS records of seven kinds. The hub journals each one under the person
// signed in and dedups by OnlyFans' ids, so every tab may report what it saw.
//
// The request mirrors the hub's strict one: a record it would refuse is never built (MAIN cuts and checks each one,
// and the background checks the report again). The answer is open like every hub answer.

import * as z from 'zod/mini';

import { NativeIdSchema } from '../primitives';
import { PageLabelSchema } from './wire';

/** Records in one report (hub CLIENT_ONLYFANS_FEED_MAX_RECORDS). */
export const ONLYFANS_FEED_MAX_RECORDS = 200;
/** A message's text as OnlyFans gave it (HTML); a longer one is cut (hub CLIENT_ONLYFANS_FEED_TEXT_MAX). */
export const ONLYFANS_FEED_TEXT_MAX = 20_000;
/** Media one message names (hub CLIENT_ONLYFANS_FEED_MEDIA_MAX). */
export const ONLYFANS_FEED_MEDIA_MAX = 60;
/** The largest single amount, in dollars (hub CLIENT_ONLYFANS_FEED_MONEY_MAX_DOLLARS). */
export const ONLYFANS_FEED_MONEY_MAX = 100_000;
/** A report's body is kept under this many bytes of JSON by the uploader (the hub takes 4 MiB). */
export const ONLYFANS_FEED_REPORT_BYTES = 768 * 1024;
/** Where the page got a message: its socket, a page of the open chat's history, the chat list's last message. */
export const ONLYFANS_FEED_VIAS = ['socket', 'history', 'chat_list'] as const;
export type OnlyfansFeedVia = (typeof ONLYFANS_FEED_VIAS)[number];
/** OnlyMonster's id of a ledger row and the socket's id of a tip (hub CLIENT_ONLYFANS_FEED_REF_PATTERN). */
export const ONLYFANS_FEED_REF_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
/** The OnlyMonster account a report names. */
export const ONLYFANS_FEED_HOST_ACCOUNT_PATTERN = /^onlymonster:[1-9]\d{0,29}$/;
/** RFC 3339 with a zone, as `toISOString` writes it (hub CLIENT_SEND_ATTRIBUTION_TIMESTAMP_PATTERN). */
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

const Timestamp = z.string().check(z.regex(TIMESTAMP));
const Dollars = z.number().check(z.minimum(0), z.maximum(ONLYFANS_FEED_MONEY_MAX));
const SignedDollars = z.number().check(z.minimum(-ONLYFANS_FEED_MONEY_MAX), z.maximum(ONLYFANS_FEED_MONEY_MAX));
const Ref = z.string().check(z.regex(ONLYFANS_FEED_REF_PATTERN));
const Token = z.string().check(z.minLength(1), z.maxLength(64));
const Text = (max: number) => z.string().check(z.maxLength(max));

/** A fan's own OnlyFans facts as the page received them (the fan read, the socket's sender). Null — not given. */
export const OnlyfansFeedFanFactsShape = {
  username: z.nullable(Text(100)),
  /** OnlyFans' `name`: the fan's own name. */
  name: z.nullable(Text(200)),
  /** OnlyFans' `displayName`: the creator's custom name for the fan. */
  displayName: z.nullable(Text(200)),
  subscribedOn: z.nullable(z.boolean()),
  subscribedOnExpiredNow: z.nullable(z.boolean()),
  subscribeAt: z.nullable(Timestamp),
  expiredAt: z.nullable(Timestamp),
  renewedAt: z.nullable(Timestamp),
  /** `subscribedOnData.status`: `Set to Expire` — auto-renew is off. */
  subscriptionStatus: z.nullable(Text(64)),
  subscribePrice: z.nullable(Dollars),
  regularPrice: z.nullable(Dollars),
  /** The platform's own lifetime sums of the fan on this page, gross dollars (`*Summ`). */
  spend: z.nullable(
    z.strictObject({
      tips: z.nullable(Dollars),
      subscriptions: z.nullable(Dollars),
      messages: z.nullable(Dollars),
      posts: z.nullable(Dollars),
      streams: z.nullable(Dollars),
      total: z.nullable(Dollars),
    }),
  ),
};
export const OnlyfansFeedFanFactsSchema = z.strictObject(OnlyfansFeedFanFactsShape);
export type OnlyfansFeedFanFacts = z.infer<typeof OnlyfansFeedFanFactsSchema>;

export const OnlyfansFeedMessageSchema = z.strictObject({
  kind: z.literal('message'),
  messageRef: NativeIdSchema,
  fanRef: NativeIdSchema,
  fromFan: z.boolean(),
  sentAt: Timestamp,
  /** When the page received it, by this browser's clock. */
  observedAt: Timestamp,
  via: z.enum(ONLYFANS_FEED_VIAS),
  textHtml: Text(ONLYFANS_FEED_TEXT_MAX),
  /** A priced message's price; on a tip, the tip. */
  price: z.nullable(Dollars),
  isFree: z.nullable(z.boolean()),
  isOpened: z.nullable(z.boolean()),
  isNew: z.nullable(z.boolean()),
  isTip: z.boolean(),
  tipText: z.nullable(Text(2000)),
  mediaCount: z.nullable(z.number().check(z.int(), z.minimum(0), z.maximum(1000))),
  media: z
    .array(
      z.strictObject({
        ref: Ref,
        type: Token,
        canView: z.nullable(z.boolean()),
        duration: z.nullable(z.number().check(z.minimum(0), z.maximum(86_400))),
      }),
    )
    .check(z.maxLength(ONLYFANS_FEED_MEDIA_MAX)),
  /** Sent by a queue (OnlyFans' `isFromQueue`). */
  automatic: z.nullable(z.boolean()),
  changedAt: z.nullable(Timestamp),
  /** The fan's facts, when the fan is the sender and the socket carried them. */
  fan: z.nullable(OnlyfansFeedFanFactsSchema),
});
export type OnlyfansFeedMessage = z.infer<typeof OnlyfansFeedMessageSchema>;

export const OnlyfansFeedRecordSchema = z.discriminatedUnion('kind', [
  OnlyfansFeedMessageSchema,
  z.strictObject({ kind: z.literal('deleted'), messageRef: NativeIdSchema, observedAt: Timestamp }),
  z.strictObject({ kind: z.literal('ppv'), fanRef: NativeIdSchema, contentType: Token, contentRef: NativeIdSchema, priceGross: Dollars, observedAt: Timestamp }),
  z.strictObject({ kind: z.literal('tip'), fanRef: NativeIdSchema, tipRef: Ref, amountGross: Dollars, observedAt: Timestamp }),
  z.strictObject({ kind: z.literal('fan'), fanRef: NativeIdSchema, observedAt: Timestamp, ...OnlyfansFeedFanFactsShape }),
  z.strictObject({
    kind: z.literal('chat'),
    fanRef: NativeIdSchema,
    unreadCount: z.nullable(z.number().check(z.int(), z.minimum(0), z.maximum(1_000_000))),
    lastMessageRef: z.nullable(NativeIdSchema),
    observedAt: Timestamp,
  }),
  /** hub #955: a new subscriber, as ChatSpace's notifications list (`type=subscribed`) shows OnlyFans' notification. */
  z.strictObject({
    kind: z.literal('subscriber'),
    notificationRef: Ref,
    fanRef: NativeIdSchema,
    /** `new_subscriber`, `new_subscriber_trial`, `returning_subscriber`; null — not given. */
    subType: z.nullable(Token),
    createdAt: Timestamp,
    observedAt: Timestamp,
  }),
  z.strictObject({
    kind: z.literal('ledger'),
    transactionRef: Ref,
    fanRef: z.nullable(NativeIdSchema),
    createdAt: Timestamp,
    amountGross: SignedDollars,
    amountNet: SignedDollars,
    description: Text(500),
    status: z.nullable(Text(64)),
    observedAt: Timestamp,
  }),
]);
export type OnlyfansFeedRecord = z.infer<typeof OnlyfansFeedRecordSchema>;
export type OnlyfansFeedKind = OnlyfansFeedRecord['kind'];

export const OnlyfansFeedRequestSchema = z.strictObject({
  pageLabel: PageLabelSchema,
  hostAccountRef: z.string().check(z.regex(ONLYFANS_FEED_HOST_ACCOUNT_PATTERN)),
  creatorRef: NativeIdSchema,
  records: z.array(OnlyfansFeedRecordSchema).check(z.minLength(1), z.maxLength(ONLYFANS_FEED_MAX_RECORDS)),
});
export type OnlyfansFeedRequest = z.infer<typeof OnlyfansFeedRequestSchema>;

export const OnlyfansFeedResultSchema = z.object({
  pageLabel: z.string(),
  taken: z.number(),
  duplicates: z.number(),
  held: z.number(),
  outOfRange: z.number(),
  serverNow: z.string(),
});
export type OnlyfansFeedResult = z.infer<typeof OnlyfansFeedResultSchema>;

/** hub #955: how often a page's poll is lent, for the whole team (hub CLIENT_ONLYFANS_POLL_EVERY_SECONDS). */
export const ONLYFANS_POLL_EVERY_MS = 600_000;
/** The lists a poll reads: ChatSpace's notifications of new subscribers, its sales ledger. */
export const ONLYFANS_POLL_LISTS = ['subscribers', 'ledger'] as const;
export type OnlyfansPollList = (typeof ONLYFANS_POLL_LISTS)[number];

/** How a holder's pass of the page's poll went (hub #961): each list `true` when read back to the hub's cursor. */
export const OnlyfansPollPassSchema = z.strictObject({ subscribers: z.boolean(), ledger: z.boolean() });
export type OnlyfansPollPass = z.infer<typeof OnlyfansPollPassSchema>;

export const OnlyfansPollRequestSchema = z.strictObject({
  pageLabel: PageLabelSchema,
  hostAccountRef: z.string().check(z.regex(ONLYFANS_FEED_HOST_ACCOUNT_PATTERN)),
  creatorRef: NativeIdSchema,
  /** hub #961: a report of the pass this tab just made while it held the poll, instead of an ask; lends nothing. */
  passed: z.optional(OnlyfansPollPassSchema),
});
export type OnlyfansPollRequest = z.infer<typeof OnlyfansPollRequestSchema>;

export const OnlyfansPollResultSchema = z.object({
  pageLabel: z.string(),
  /** This caller holds the page's poll now: read each list once, back to its cursor. */
  granted: z.boolean(),
  holder: z.nullable(z.string()),
  nextAt: z.string(),
  /** The newest of each list the hub holds: a poll reads back to it and no further. */
  cursors: z.object({ subscribers: z.nullable(z.string()), ledger: z.nullable(z.string()) }),
  maxPages: z.number(),
  serverNow: z.string(),
});
export type OnlyfansPollResult = z.infer<typeof OnlyfansPollResultSchema>;

/** OnlyFans' id of what a record is about: the uploader's dedup key, with the record's content beside it. Pure. */
export function onlyfansFeedRecordKey(record: OnlyfansFeedRecord): string {
  switch (record.kind) {
    case 'message':
      return `m:${record.messageRef}`;
    case 'deleted':
      return `d:${record.messageRef}`;
    case 'ppv':
      return `ppv:${record.contentType}:${record.contentRef}:${record.fanRef}`;
    case 'tip':
      return `tip:${record.tipRef}`;
    case 'fan':
      return `fan:${record.fanRef}`;
    case 'chat':
      return `chat:${record.fanRef}`;
    case 'ledger':
      return `tx:${record.transactionRef}`;
    case 'subscriber':
      return `sub:${record.notificationRef}`;
  }
}
