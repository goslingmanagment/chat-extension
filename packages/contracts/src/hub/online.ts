// «Онлайн» (hub #879, `online-v1`): the page's fans seen online recently, why to write to each now and with what
// (`clientOnline`); the Fansly fans a tab saw active, kept as their presence (`clientOnlinePresence`, Fansly pages only:
// OnlyFansAPI reports an OnlyFans page's own); and what a chatter did in the window — a message sent, «Не предлагать» and
// its undo — journaled and shared by the team (`clientOnlineAttempt`). The hub sends nothing to a fan: the chatter does,
// one click per fan.
//
// The requests mirror the hub's strict ones; the answers are open like every hub answer: a reason, an act or an aside
// this client does not know reads as the most neutral one (`none`, no act, not set aside).

import * as z from 'zod/mini';

import { NativeIdSchema } from '../primitives';
import { PageLabelSchema } from './wire';

/** Why to write now, the most urgent first (hub CLIENT_ONLINE_REASONS); open on the wire. */
export const ONLINE_REASONS = ['waiting', 'new_unattended', 'expiring', 'silent', 'quiet', 'never_wrote', 'none'] as const;
export type OnlineReason = (typeof ONLINE_REASONS)[number];
/** With what (hub CLIENT_ONLINE_ACTS): Reply, Hi, Ping, a text of the team's guide (A — talked before, B — never wrote). */
export const ONLINE_HUB_ACTS = ['reply', 'hi', 'ping', 'template_a', 'template_b', 'none'] as const;
export type OnlineHubAct = (typeof ONLINE_HUB_ACTS)[number];
/** Why a fan is set aside now, though a chatter may still write (hub CLIENT_ONLINE_ASIDES). */
export const ONLINE_ASIDES = ['in_conversation', 'wrote_recently', 'attempted_recently', 'dismissed', 'unreachable'] as const;
export type OnlineAside = (typeof ONLINE_ASIDES)[number];
/** What a chatter did: a message went from the window, «Не предлагать», its undo. */
export const ONLINE_ATTEMPT_ACTIONS = ['sent', 'dismissed', 'restored'] as const;
export type OnlineAttemptAction = (typeof ONLINE_ATTEMPT_ACTIONS)[number];
/** What wrote a message that went. */
export const ONLINE_SENT_ACTS = ['reply', 'hi', 'ping', 'template'] as const;
export type OnlineSentAct = (typeof ONLINE_SENT_ACTS)[number];
/** Fansly fans one presence report names at most (a `followersnew` page is 100). */
export const ONLINE_PRESENCE_MAX = 200;

const Time = z.string();

export const OnlineQuerySchema = z.strictObject({
  pageLabel: PageLabelSchema,
  /** The presence window: fans whose last activity is at most this many minutes old (5 to 180). */
  minutes: z.int().check(z.gte(5), z.lte(180)),
});
export type OnlineQuery = z.infer<typeof OnlineQuerySchema>;

export const OnlineItemSchema = z.object({
  fanRef: z.string(),
  /** The fan's primary chat (on Fansly the group); null — none known yet. */
  conversationRef: z.nullable(z.string()),
  username: z.nullable(z.string()),
  displayName: z.nullable(z.string()),
  /** The team's name for the fan on the page, with its marks. */
  alias: z.nullable(z.string()),
  /** The name a guide's text puts instead of «love»; null — «love» stays. */
  greetingName: z.nullable(z.string()),
  lifetimeGrossMills: z.number(),
  last30dGrossMills: z.number(),
  /** The fan's last activity the hub knows. */
  seenAt: z.nullable(Time),
  /** OnlyFans: online now by OnlyFansAPI's own state, since this moment (its «offline» comes ~30 minutes late). */
  onlineSince: z.nullable(Time),
  seenSource: z.nullable(z.string()),
  reason: z.string(),
  reasonAt: z.nullable(Time),
  act: z.string(),
  aside: z.nullable(z.string()),
  asideAt: z.nullable(Time),
  /** The chatters «в разговоре» with the fan, or who marked «Не предлагать». */
  asideBy: z.nullable(z.string()),
  /** Messages of the primary chat in the archive, counted up to 10 (Ping's minimum). */
  messageCount: z.number(),
  lastFanMessageAt: z.nullable(Time),
  /** The page's last personal message to the fan (no mass message). */
  lastPageMessageAt: z.nullable(Time),
  subscription: z.object({
    isSubscriber: z.boolean(),
    startedAt: z.nullable(Time),
    endsAt: z.nullable(Time),
    autoRenew: z.nullable(z.boolean()),
  }),
});
export type OnlineItem = z.infer<typeof OnlineItemSchema>;

/** A text of the team's reactivation guide, word for word; `love` is the place of the fan's name. */
export const OnlineTemplateSchema = z.object({ id: z.string(), group: z.string(), text: z.string() });
export type OnlineTemplate = z.infer<typeof OnlineTemplateSchema>;

export const OnlineListSchema = z.object({
  pageLabel: z.string(),
  minutes: z.number(),
  /** The most urgent reason first, the offered before the set aside, then the newest activity. */
  items: z.array(OnlineItemSchema),
  templates: z.array(OnlineTemplateSchema),
  serverNow: Time,
});
export type OnlineList = z.infer<typeof OnlineListSchema>;

export const OnlinePresenceRequestSchema = z.strictObject({
  pageLabel: PageLabelSchema,
  /** Fansly fans the tab saw active (`followersnew?lastSeenAfter=` in the chatter's own session) and when. */
  seen: z.array(z.strictObject({ fanRef: NativeIdSchema, lastSeenAt: z.iso.datetime({ offset: true }) })).check(z.minLength(1), z.maxLength(ONLINE_PRESENCE_MAX)),
});
export type OnlinePresenceRequest = z.infer<typeof OnlinePresenceRequestSchema>;
export const OnlinePresenceResultSchema = z.object({ recorded: z.number(), skipped: z.number(), serverNow: Time });
export type OnlinePresenceResult = z.infer<typeof OnlinePresenceResultSchema>;

export const OnlineAttemptRequestSchema = z.strictObject({
  pageLabel: PageLabelSchema,
  fanRef: NativeIdSchema,
  action: z.enum(ONLINE_ATTEMPT_ACTIONS),
  act: z.optional(z.enum(ONLINE_SENT_ACTS)),
  templateId: z.optional(z.string().check(z.minLength(1), z.maxLength(32))),
  /** Why the list offered the fan when the chatter acted. */
  reason: z.optional(z.string().check(z.minLength(1), z.maxLength(64))),
});
export type OnlineAttemptRequest = z.infer<typeof OnlineAttemptRequestSchema>;
export const OnlineAttemptResultSchema = z.object({ attemptId: z.number() });
export type OnlineAttemptResult = z.infer<typeof OnlineAttemptResultSchema>;
