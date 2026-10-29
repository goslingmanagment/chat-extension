// «Очереди» (hub fan queues, `fan-queues-v1`; hub docs/plans/2026-10-29-fan-queues/spec.md): the fans of one page
// gathered on someone's word — by a rule the hub evaluates or a list — and handed out to the page's chatters in portions
// of up to 10. The extension lists a person's queues (`clientFanQueues`: their progress today, the goal, how they are
// written, the fans who answered a message from a queue), takes a portion (`clientFanQueueTake`: each fan re-checked by
// the hub, a 30-minute lease renewed by each take), reports each fan — sent, with what, or skipped, why
// (`clientFanQueueItemDone`) — and gives the portion back when the window closes (`clientFanQueueRelease`). The hub sends
// nothing to a fan: the chatter does, one click per fan («Отправить всем» of a template queue is the one batch).
//
// The requests mirror the hub's strict ones; the answers are open like every hub answer: an act, a status or a stop this
// client does not know reads as the most neutral one.

import * as z from 'zod/mini';

import { HubIntIdSchema } from '../primitives';
import { OnlineItemSchema, OnlineTemplateSchema } from './online';
import { PageLabelSchema } from './wire';

/** Fans one portion holds at most. */
export const FAN_QUEUE_PORTION_MAX = 10;
/** «Не подходит», «Позже» (back in 3 days), «Уже общаемся», «Не предлагать» (the team's mark, as «Онлайн»'s). */
export const FAN_QUEUE_SKIP_REASONS = ['not_fit', 'later', 'talking', 'dismiss'] as const;
export type FanQueueSkipReason = (typeof FAN_QUEUE_SKIP_REASONS)[number];
/** What wrote a message that went. */
export const FAN_QUEUE_SENT_ACTS = ['reply', 'hi', 'ping', 'template', 'own'] as const;
export type FanQueueSentAct = (typeof FAN_QUEUE_SENT_ACTS)[number];
/** Why a take handed out nothing more (hub FAN_QUEUE_STOPS); open on the wire. */
export const FAN_QUEUE_STOPS = ['paused', 'done', 'portion_done', 'limit_reached', 'empty'] as const;
export type FanQueueStop = (typeof FAN_QUEUE_STOPS)[number];

const Time = z.string();

/** How the queue writes, as the hub answers it: open tokens. */
export const FanQueueScenarioSchema = z.object({
  /** `auto` (as «Онлайн» picks), `hi`, `ping`, `reply`, `template`, `own`. */
  action: z.string(),
  /** `one` — a click per message; `batch` — «Отправить всем» over a portion (template queues). */
  sendMode: z.string(),
  /** With `template`: the team guide's group (`a`, `b`); null — the asker's own texts or none. */
  templates: z.nullable(z.string()),
  /** The asker's own texts (group `q<queueId>` of the list's templates). */
  texts: z.nullable(z.array(z.string())),
  hint: z.nullable(z.string()),
});
export type FanQueueScenario = z.infer<typeof FanQueueScenarioSchema>;

/** Sent today (a Moscow day): by the caller, by the page. */
export const FanQueueTodaySchema = z.object({ mine: z.number(), page: z.number() });
export type FanQueueToday = z.infer<typeof FanQueueTodaySchema>;

export const FanQueueSummarySchema = z.object({
  queueId: z.number(),
  name: z.string(),
  goal: z.nullable(z.string()),
  /** `campaign`, `standing` (refills from its rule once a day). */
  kind: z.string(),
  /** `active`, `paused`, `done`. */
  status: z.string(),
  /** `pool` — the page's chatters take portions in turn; `people` — split between named people. */
  distribution: z.string(),
  /** People: the caller is its only person (a queue they asked for themselves). */
  mineOnly: z.boolean(),
  scenario: FanQueueScenarioSchema,
  /** The hub's own words for who is in it, one line each. */
  ruleText: z.nullable(z.array(z.string())),
  requestedBy: z.string(),
  pausedAt: z.nullable(Time),
  pausedBy: z.nullable(z.string()),
  /** A person's portion per day; null — none. */
  perPerson: z.nullable(z.number()),
  /** The page's sends from the queue per day; null — none. */
  dailyLimit: z.nullable(z.number()),
  today: FanQueueTodaySchema,
  /** Fans the caller can still be handed. */
  pending: z.number(),
  /** Fans in the caller's portion now. */
  leasedToMe: z.number(),
});
export type FanQueueSummary = z.infer<typeof FanQueueSummarySchema>;

/** A fan the caller wrote to from a queue within 72 hours who answered after: on top of the window, with a Reply. */
export const FanQueueAnsweredSchema = z.object({
  itemId: z.number(),
  queueId: z.number(),
  fanRef: z.string(),
  conversationRef: z.nullable(z.string()),
  username: z.nullable(z.string()),
  displayName: z.nullable(z.string()),
  alias: z.nullable(z.string()),
  sentAt: Time,
  act: z.nullable(z.string()),
  templateId: z.nullable(z.string()),
  answeredAt: Time,
  answerText: z.nullable(z.string()),
});
export type FanQueueAnswered = z.infer<typeof FanQueueAnsweredSchema>;

export const FanQueuesQuerySchema = z.strictObject({ pageLabel: PageLabelSchema });
export type FanQueuesQuery = z.infer<typeof FanQueuesQuerySchema>;

export const FanQueuesSchema = z.object({
  pageLabel: z.string(),
  /** Active and paused queues the caller may work, in the order they were made. */
  queues: z.array(FanQueueSummarySchema),
  answered: z.array(FanQueueAnsweredSchema),
  /** The team guide's texts (group `a`, `b`) and each template queue's own (group `q<queueId>`). */
  templates: z.array(OnlineTemplateSchema),
  serverNow: Time,
});
export type FanQueues = z.infer<typeof FanQueuesSchema>;

export const FanQueueTakeRequestSchema = z.strictObject({
  pageLabel: PageLabelSchema,
  queueId: HubIntIdSchema,
  count: z.int().check(z.gte(1), z.lte(FAN_QUEUE_PORTION_MAX)),
  /** «Ещё 10»: past the caller's portion for the day, while the page's limit allows. */
  more: z.boolean(),
});
export type FanQueueTakeRequest = z.infer<typeof FanQueueTakeRequestSchema>;

/** A fan of the caller's portion: «Онлайн»'s item (facts, the hub's advice) and the queue's own. */
export const FanQueueItemSchema = z.extend(OnlineItemSchema, {
  itemId: z.number(),
  queueId: z.number(),
  /** Why the fan is in the queue, as the asker or the hub put it. */
  why: z.nullable(z.string()),
  leaseUntil: Time,
  /** With a template: the text the hub picked for this fan (neighbours get different ones). */
  templateId: z.nullable(z.string()),
  followedAt: z.nullable(Time),
  /** Mass messages the fan got from the page in 90 days, and the last one. */
  massLast90d: z.object({ count: z.number(), lastAt: z.nullable(Time) }),
});
export type FanQueueItem = z.infer<typeof FanQueueItemSchema>;

export const FanQueueTakeSchema = z.object({
  queueId: z.number(),
  /** The caller's portion: the items kept from before first, then the new ones, in the queue's order. */
  items: z.array(FanQueueItemSchema),
  /** Why nothing more came; open token (FAN_QUEUE_STOPS); null — the portion is whole. */
  stopped: z.nullable(z.string()),
  today: FanQueueTodaySchema,
  pending: z.number(),
  /** Fans this take dropped on the hub's re-check. */
  dropped: z.number(),
  serverNow: Time,
});
export type FanQueueTake = z.infer<typeof FanQueueTakeSchema>;

export const FanQueueItemDoneRequestSchema = z.strictObject({
  pageLabel: PageLabelSchema,
  itemId: HubIntIdSchema,
  outcome: z.enum(['sent', 'skipped']),
  act: z.optional(z.enum(FAN_QUEUE_SENT_ACTS)),
  templateId: z.optional(z.string().check(z.minLength(1), z.maxLength(32))),
  skipReason: z.optional(z.enum(FAN_QUEUE_SKIP_REASONS)),
  /** The send's outcome is not known: it counts as sent and is never sent again. */
  uncertain: z.optional(z.boolean()),
});
export type FanQueueItemDoneRequest = z.infer<typeof FanQueueItemDoneRequestSchema>;

export const FanQueueItemDoneSchema = z.object({
  itemId: z.number(),
  /** Open token: the item's state after the report. */
  state: z.string(),
  today: FanQueueTodaySchema,
  serverNow: Time,
});
export type FanQueueItemDone = z.infer<typeof FanQueueItemDoneSchema>;

export const FanQueueReleaseRequestSchema = z.strictObject({ pageLabel: PageLabelSchema, queueId: HubIntIdSchema });
export type FanQueueReleaseRequest = z.infer<typeof FanQueueReleaseRequestSchema>;
export const FanQueueReleaseSchema = z.object({ released: z.number() });
export type FanQueueRelease = z.infer<typeof FanQueueReleaseSchema>;
