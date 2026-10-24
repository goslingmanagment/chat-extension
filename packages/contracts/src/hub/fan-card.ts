// Chat Memory week 2 (hub `docs/plans/2026-10-24-chat-memory/week-2.md` §1–4; hub `clientFanCard`,
// `clientFanLinkDecide`, `clientFanFactChange`, capability `fan-card-v1`): the fan's card across pages — the person's
// accounts, the team's alias with its marks (💵, ❌) and the money on every page, the accounts Hub suggests are the
// same person (a chatter decides «Да» or «Нет»), and the facts from the chats (a chatter deletes or corrects one).
// Pages the caller does not work show only that: never a message or a note of theirs. Money is gross mills.
//
// Chat Memory week 4 (hub week-4.md §1, `clientFanCustomCreate`, `clientFanCustomChange`, capability `fan-customs-v1`):
// the person's customs — what was ordered, the price, ordered → paid → delivered (or cancelled). Hub only suggests the
// payment (a tip no custom took) and the delivery (media the page sent since); a chatter confirms with one tap.
//
// The requests mirror the hub's strict bodies; the answers are open like every hub answer.

import * as z from 'zod/mini';

import { HubIntIdSchema, NativeIdSchema, OpenTokenSchema } from '../primitives';
import { PageLabelSchema } from './wire';

/** The longest fact a chatter may write (hub CLIENT_FAN_FACT_MAX_CHARS). */
export const FAN_FACT_MAX_CHARS = 500;
/** The kinds of a fact, in the card's order (hub CLIENT_FAN_FACT_KINDS); open on the wire. */
export const FAN_FACT_KINDS = ['about', 'promise', 'agreement'] as const;
export type FanFactKind = (typeof FAN_FACT_KINDS)[number];
/** Why Hub suggests a pair (hub CLIENT_FAN_LINK_REASONS); open on the wire. */
export const FAN_LINK_REASONS = ['same_alias', 'same_username', 'replaced_account'] as const;

/** The longest description of a custom (hub `clientFanCustomCreateBodySchema`). */
export const FAN_CUSTOM_MAX_CHARS = 500;
/** The states of a custom (hub CLIENT_FAN_CUSTOM_STATES); open on the wire. */
export const FAN_CUSTOM_STATES = ['ordered', 'paid', 'delivered', 'cancelled'] as const;
export type FanCustomState = (typeof FAN_CUSTOM_STATES)[number];

const MillsSchema = z.number();
const TimeSchema = z.nullable(z.string());

export const FanCardPageSchema = z.object({
  pageLabel: z.string(),
  platform: z.string(),
  modelName: z.nullable(z.string()),
  fanRef: z.string(),
  granted: z.boolean(),
  alias: z.nullable(z.string()),
  subscribed: z.boolean(),
  subscribedSince: TimeSchema,
  subscriptionEndsAt: TimeSchema,
  spentMills: MillsSchema,
  last30Mills: z.record(z.string(), MillsSchema),
  lastPurchaseAt: TimeSchema,
});
export type FanCardPage = z.infer<typeof FanCardPageSchema>;

const FanCardAccountFields = {
  platform: z.string(),
  fanRef: z.string(),
  username: z.nullable(z.string()),
  displayName: z.nullable(z.string()),
  gone: z.boolean(),
};

export const FanCardFactSchema = z.object({
  id: z.number(),
  kind: z.string(),
  text: z.string(),
  pageLabel: z.string(),
  granted: z.boolean(),
  conversationRef: z.string(),
  messageRef: z.string(),
  messageAt: TimeSchema,
  source: z.string(),
  author: z.nullable(z.string()),
  createdAt: z.string(),
});
export type FanCardFact = z.infer<typeof FanCardFactSchema>;

export const FanCardCustomSchema = z.object({
  id: z.number(),
  pageLabel: z.string(),
  /** The caller works the custom's page: only then it can be changed. */
  granted: z.boolean(),
  description: z.string(),
  priceMills: z.nullable(MillsSchema),
  state: z.string(),
  paymentMills: z.nullable(MillsSchema),
  paidAt: TimeSchema,
  deliveredMessageRef: z.nullable(z.string()),
  deliveredAt: TimeSchema,
  createdBy: z.string(),
  createdAt: z.string(),
  /** Media the page sent in the chat since the payment, the newest first: «это он?». */
  deliveryCandidates: z.array(z.object({ messageRef: z.string(), at: z.string(), mediaCount: z.number(), priceMills: z.nullable(MillsSchema) })),
});
export type FanCardCustom = z.infer<typeof FanCardCustomSchema>;

export const FanCardCustomPaymentSchema = z.object({ paymentRef: z.string(), amountMills: MillsSchema, at: z.string(), note: z.nullable(z.string()) });
export type FanCardCustomPayment = z.infer<typeof FanCardCustomPaymentSchema>;

export const FanCardSchema = z.object({
  pageLabel: z.string(),
  fanRef: z.string(),
  known: z.boolean(),
  accounts: z.array(z.object({ ...FanCardAccountFields, linkedBy: z.nullable(z.string()) })),
  pages: z.array(FanCardPageSchema),
  suggestions: z.array(z.object({ ...FanCardAccountFields, reason: z.string(), shared: z.string(), sharedOn: z.nullable(z.string()), pages: z.array(FanCardPageSchema) })),
  facts: z.array(FanCardFactSchema),
  /** Chat Memory week 4: the person's customs, the open first, ended ones for 30 days. Absent from an older hub. */
  customs: z.optional(z.array(FanCardCustomSchema)),
  /** The fan's tips on the asked page in 30 days that no custom took: «это оплата кастома?». Absent from an older hub. */
  customPayments: z.optional(z.array(FanCardCustomPaymentSchema)),
  serverNow: z.string(),
});
export type FanCard = z.infer<typeof FanCardSchema>;

export const FanCardQuerySchema = z.strictObject({ pageLabel: PageLabelSchema, fanRef: NativeIdSchema });
export type FanCardQuery = z.infer<typeof FanCardQuerySchema>;

/** Path `pageLabel`, `fanRef`; the body is the rest. */
export const FanLinkDecideRequestSchema = z.strictObject({
  pageLabel: PageLabelSchema,
  fanRef: NativeIdSchema,
  otherPlatform: OpenTokenSchema,
  otherFanRef: NativeIdSchema,
  decision: z.enum(['same', 'different']),
});
export type FanLinkDecideRequest = z.infer<typeof FanLinkDecideRequestSchema>;
export const FanLinkDecideResultSchema = z.object({ decision: z.string(), recorded: z.boolean(), card: FanCardSchema });
export type FanLinkDecideResult = z.infer<typeof FanLinkDecideResultSchema>;

/** Path `pageLabel`, `fanRef`, `factId`; the body is `action` (and `text` of a correction). */
export const FanFactChangeRequestSchema = z.union([
  z.strictObject({ pageLabel: PageLabelSchema, fanRef: NativeIdSchema, factId: HubIntIdSchema, action: z.literal('delete') }),
  z.strictObject({
    pageLabel: PageLabelSchema,
    fanRef: NativeIdSchema,
    factId: HubIntIdSchema,
    action: z.literal('correct'),
    text: z.string().check(z.trim(), z.minLength(1), z.maxLength(FAN_FACT_MAX_CHARS)),
  }),
]);
export type FanFactChangeRequest = z.infer<typeof FanFactChangeRequestSchema>;
export const FanFactChangeResultSchema = z.object({ changed: z.boolean(), card: FanCardSchema });
export type FanFactChangeResult = z.infer<typeof FanFactChangeResultSchema>;

const CustomText = z.string().check(z.trim(), z.minLength(1), z.maxLength(FAN_CUSTOM_MAX_CHARS));
const CustomPrice = z.int().check(z.gte(0));

/** Path `pageLabel`, `fanRef`; the body is the rest. `paymentRef` — one of the card's `customPayments`. */
export const FanCustomCreateRequestSchema = z.strictObject({
  pageLabel: PageLabelSchema,
  fanRef: NativeIdSchema,
  description: CustomText,
  priceMills: z.optional(CustomPrice),
  paymentRef: z.optional(NativeIdSchema),
});
export type FanCustomCreateRequest = z.infer<typeof FanCustomCreateRequestSchema>;

const CustomPath = { pageLabel: PageLabelSchema, fanRef: NativeIdSchema, customId: HubIntIdSchema };
/** Path `pageLabel`, `fanRef`, `customId`; the body is `action` and its suggestion. Delivered or cancelled is final. */
export const FanCustomChangeRequestSchema = z.union([
  z.strictObject({ ...CustomPath, action: z.literal('paid'), paymentRef: NativeIdSchema }),
  z.strictObject({ ...CustomPath, action: z.literal('delivered'), messageRef: NativeIdSchema }),
  z.strictObject({ ...CustomPath, action: z.literal('cancel') }),
  z.strictObject({ ...CustomPath, action: z.literal('edit'), description: CustomText, priceMills: z.nullable(CustomPrice) }),
]);
export type FanCustomChangeRequest = z.infer<typeof FanCustomChangeRequestSchema>;
