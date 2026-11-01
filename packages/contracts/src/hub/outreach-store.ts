// «Рассылки» kept by the hub (hub `outreach-store-v1`; hub docs/plans/2026-11-01-outreach-store/spec.md; the owner,
// 2026-11-01: «чтобы хранились рассылки у нас на сервере», the page's team sees and continues each other's): an
// outreach of a page — its common text, the window's own state (`settings`, the hub never reads it), the order of its
// fans once their versions are written, and per fan the version, the person's words, the send and what came of it.
//
// - `clientOutreaches`: the page's outreaches, newest change first, whoever made them;
// - `clientOutreach`: one of them whole (an uncertain send the hub's archive proves is settled as sent on the read);
// - `clientOutreachSave`: create (the first save of an id the client minted) or change; the last save wins a field, and
//   a fan whose send was claimed keeps its version (`kept`);
// - `clientOutreachSend`: claim a fan's send before the platform is asked — once per fan of an outreach (again only
//   after a proven refusal), never while another outreach's send to the fan is on its way — then report it sent,
//   refused or unknown; `record` — a send made before the outreach reached the hub (kept by this browser);
// - `clientOutreachTouches`: the page's fans an outreach, a fan queue or «Онлайн» wrote to in the last 72 hours.
//
// The requests mirror the hub's strict ones; the answers are open like every hub answer: a state, an outcome or a kind
// this client does not know reads as the most careful one (a send — went or may have; never sendable).

import * as z from 'zod/mini';

import { PageLabelSchema } from './wire';

/** The common text and one version at most (hub OUTREACH_TEXT_MAX). */
export const OUTREACH_STORE_TEXT_MAX = 5_000;
/** Fans one outreach holds at most (hub OUTREACH_FANS_MAX). */
export const OUTREACH_STORE_FANS_MAX = 1_000;
/** Fans one save changes at most (hub OUTREACH_SAVE_FANS_MAX). */
export const OUTREACH_STORE_SAVE_FANS_MAX = 50;
/** `settings` at most, as JSON (hub OUTREACH_SETTINGS_MAX_BYTES). */
export const OUTREACH_STORE_SETTINGS_MAX_BYTES = 32 * 1024;
/** A claim not reported within this reads `uncertain` (hub OUTREACH_SEND_TICKET_SECONDS). */
export const OUTREACH_STORE_TICKET_MS = 120_000;
/** A send made before the outreach reached the hub is taken this old at most (hub OUTREACH_RECORD_MAX_AGE_DAYS). */
export const OUTREACH_STORE_RECORD_MAX_AGE_MS = 30 * 86_400_000;
/** «Писали за 3 дня» (hub OUTREACH_TOUCH_HOURS). */
export const OUTREACH_STORE_TOUCH_MS = 72 * 3_600_000;

/** A fan's send (hub OUTREACH_SEND_STATES); open on the wire. `sending` past its ticket answers `uncertain`. */
export const OUTREACH_STORE_SEND_STATES = ['sending', 'sent', 'uncertain', 'failed'] as const;
/** What a send action did (hub OUTREACH_SEND_OUTCOMES); open on the wire. */
export const OUTREACH_STORE_SEND_OUTCOMES = ['ok', 'taken', 'busy', 'not_yours'] as const;
export type OutreachStoreSendOutcome = (typeof OUTREACH_STORE_SEND_OUTCOMES)[number];
/** Where a touch came from (hub OUTREACH_TOUCH_KINDS); open on the wire. */
export const OUTREACH_STORE_TOUCH_KINDS = ['outreach', 'queue', 'online'] as const;
export type OutreachStoreTouchKind = (typeof OUTREACH_STORE_TOUCH_KINDS)[number];

const Time = z.string();
const Ref = z.string().check(z.regex(/^\d{1,30}$/));
const Uuid = z.string().check(z.regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/));
const Text = z.string().check(z.maxLength(OUTREACH_STORE_TEXT_MAX));
const Opaque = z.record(z.string(), z.unknown());

/** A person of the page's team: their login, and whether it is the caller. */
export const OutreachStorePersonSchema = z.object({ name: z.string(), isMe: z.boolean() });
export type OutreachStorePerson = z.infer<typeof OutreachStorePersonSchema>;

export const OutreachStoreSendSchema = z.object({
  /** Open token: OUTREACH_STORE_SEND_STATES. */
  state: z.string(),
  attemptId: z.string(),
  by: OutreachStorePersonSchema,
  clickedAt: Time,
  ticketUntil: z.nullable(Time),
  sentAt: z.nullable(Time),
  code: z.nullable(z.string()),
  /** The version as it went. */
  text: z.nullable(z.string()),
  /** What went with it, as the client sent it. */
  media: z.nullable(Opaque),
  platformMessageId: z.nullable(z.string()),
  /** `archive` — the hub found the message in its copy of the chat; null — reported by a client. */
  resolvedBy: z.nullable(z.string()),
});
export type OutreachStoreSend = z.infer<typeof OutreachStoreSendSchema>;

export const OutreachStoreOutcomeSchema = z.object({
  /** The fan's first message within 72 hours of the send. */
  replied: z.nullable(z.object({ at: Time, text: z.nullable(z.string()) })),
  /** The fan's money within 7 days of the send: the sum, mills, and the first payment. */
  bought: z.nullable(z.object({ mills: z.number(), at: Time })),
});
export type OutreachStoreOutcome = z.infer<typeof OutreachStoreOutcomeSchema>;

export const OutreachStoreFanSchema = z.object({
  fanRef: z.string(),
  version: z.nullable(z.string()),
  basis: z.nullable(z.string()),
  versionAt: z.nullable(Time),
  edit: z.nullable(z.string()),
  editedBy: z.nullable(OutreachStorePersonSchema),
  editedAt: z.nullable(Time),
  send: z.nullable(OutreachStoreSendSchema),
  outcome: z.nullable(OutreachStoreOutcomeSchema),
});
export type OutreachStoreFan = z.infer<typeof OutreachStoreFanSchema>;

export const OutreachStoreOutreachSchema = z.object({
  outreachId: z.string(),
  author: OutreachStorePersonSchema,
  createdAt: Time,
  updatedAt: Time,
  updatedBy: OutreachStorePersonSchema,
  text: z.string(),
  withMedia: z.boolean(),
  settings: Opaque,
  order: z.array(z.string()),
  fans: z.array(OutreachStoreFanSchema),
  serverNow: Time,
});
export type OutreachStoreOutreach = z.infer<typeof OutreachStoreOutreachSchema>;

export const OutreachStoreSummarySchema = z.object({
  outreachId: z.string(),
  author: OutreachStorePersonSchema,
  createdAt: Time,
  updatedAt: Time,
  updatedBy: OutreachStorePersonSchema,
  text: z.string(),
  withMedia: z.boolean(),
  fans: z.number(),
  written: z.number(),
  sent: z.number(),
  uncertain: z.number(),
  sending: z.number(),
  failed: z.number(),
  replied: z.number(),
  bought: z.number(),
  boughtMills: z.number(),
  lastSentAt: z.nullable(Time),
});
export type OutreachStoreSummary = z.infer<typeof OutreachStoreSummarySchema>;

export const OutreachStoreListQuerySchema = z.strictObject({ pageLabel: PageLabelSchema });
export type OutreachStoreListQuery = z.infer<typeof OutreachStoreListQuerySchema>;
export const OutreachStoreListSchema = z.object({ pageLabel: z.string(), outreaches: z.array(OutreachStoreSummarySchema), serverNow: Time });
export type OutreachStoreList = z.infer<typeof OutreachStoreListSchema>;

export const OutreachStoreGetQuerySchema = z.strictObject({ pageLabel: PageLabelSchema, outreachId: Uuid });
export type OutreachStoreGetQuery = z.infer<typeof OutreachStoreGetQuerySchema>;

export const OutreachStoreFanChangeSchema = z.strictObject({
  fanRef: Ref,
  /** Fix's version; null — let go («Очистить»). Comes with `basis`. */
  version: z.optional(z.nullable(Text)),
  /** The common text the version was written from, as this client names it (outreach/sync.ts textKey). */
  basis: z.optional(z.string().check(z.minLength(1), z.maxLength(64))),
  generationRef: z.optional(z.string().check(z.minLength(1), z.maxLength(100))),
  /** The person's own words; null — back to Fix's version. */
  edit: z.optional(z.nullable(Text)),
});
export type OutreachStoreFanChange = z.infer<typeof OutreachStoreFanChangeSchema>;

/** The fields of a save; an absent one is left as it is. */
export const OutreachStoreSaveBodySchema = z.strictObject({
  text: z.optional(Text),
  withMedia: z.optional(z.boolean()),
  settings: z.optional(Opaque),
  order: z.optional(z.array(Ref).check(z.maxLength(OUTREACH_STORE_FANS_MAX))),
  fans: z.optional(z.array(OutreachStoreFanChangeSchema).check(z.maxLength(OUTREACH_STORE_SAVE_FANS_MAX))),
  /** The first save of an outreach made before (kept by this browser): when; at most 30 days back. */
  createdAt: z.optional(Time),
});
export type OutreachStoreSaveBody = z.infer<typeof OutreachStoreSaveBodySchema>;

export const OutreachStoreSaveRequestSchema = z.strictObject({
  pageLabel: PageLabelSchema,
  outreachId: Uuid,
  ...OutreachStoreSaveBodySchema.shape,
});
export type OutreachStoreSaveRequest = z.infer<typeof OutreachStoreSaveRequestSchema>;

export const OutreachStoreSavedSchema = z.extend(OutreachStoreOutreachSchema, {
  /** Fans whose change this save did not take: their send was claimed. */
  kept: z.array(z.string()),
});
export type OutreachStoreSaved = z.infer<typeof OutreachStoreSavedSchema>;

/** A fan's send: claim it, report it, or record one made before the outreach reached the hub. */
const SEND_CLAIM = { action: z.literal('claim'), fanRef: Ref, attemptId: Uuid, text: z.string().check(z.minLength(1), z.maxLength(OUTREACH_STORE_TEXT_MAX)), media: z.nullable(Opaque) };
const SEND_SENT = { action: z.literal('sent'), fanRef: Ref, attemptId: Uuid, platformMessageId: z.optional(Ref) };
const SEND_FAILED = { action: z.literal('failed'), fanRef: Ref, attemptId: Uuid, code: z.string().check(z.minLength(1), z.maxLength(64)) };
const SEND_UNCERTAIN = { action: z.literal('uncertain'), fanRef: Ref, attemptId: Uuid };
const SEND_RECORD = {
  action: z.literal('record'),
  fanRef: Ref,
  attemptId: Uuid,
  state: z.enum(['sent', 'uncertain']),
  clickedAt: Time,
  sentAt: z.optional(Time),
  text: z.string().check(z.minLength(1), z.maxLength(OUTREACH_STORE_TEXT_MAX)),
  media: z.nullable(Opaque),
  platformMessageId: z.optional(Ref),
};

export const OutreachStoreSendBodySchema = z.discriminatedUnion('action', [
  z.strictObject(SEND_CLAIM),
  z.strictObject(SEND_SENT),
  z.strictObject(SEND_FAILED),
  z.strictObject(SEND_UNCERTAIN),
  z.strictObject(SEND_RECORD),
]);
export type OutreachStoreSendBody = z.infer<typeof OutreachStoreSendBodySchema>;

/** The send as the hub's route takes it: the page and the outreach in the path, the action in the body. */
const AT = { pageLabel: PageLabelSchema, outreachId: Uuid };
export const OutreachStoreSendRequestSchema = z.discriminatedUnion('action', [
  z.strictObject({ ...AT, ...SEND_CLAIM }),
  z.strictObject({ ...AT, ...SEND_SENT }),
  z.strictObject({ ...AT, ...SEND_FAILED }),
  z.strictObject({ ...AT, ...SEND_UNCERTAIN }),
  z.strictObject({ ...AT, ...SEND_RECORD }),
]);
export type OutreachStoreSendRequest = z.infer<typeof OutreachStoreSendRequestSchema>;

export const OutreachStoreSendAnswerSchema = z.object({
  /** Open token: OUTREACH_STORE_SEND_OUTCOMES. */
  outcome: z.string(),
  fan: OutreachStoreFanSchema,
  serverNow: Time,
});
export type OutreachStoreSendAnswer = z.infer<typeof OutreachStoreSendAnswerSchema>;

export const OutreachStoreTouchSchema = z.object({
  fanRef: z.string(),
  at: Time,
  /** Open token: OUTREACH_STORE_TOUCH_KINDS. */
  kind: z.string(),
  by: z.nullable(OutreachStorePersonSchema),
  outreachId: z.nullable(z.string()),
});
export type OutreachStoreTouch = z.infer<typeof OutreachStoreTouchSchema>;

export const OutreachStoreTouchesSchema = z.object({ pageLabel: z.string(), hours: z.number(), fans: z.array(OutreachStoreTouchSchema), serverNow: Time });
export type OutreachStoreTouches = z.infer<typeof OutreachStoreTouchesSchema>;
