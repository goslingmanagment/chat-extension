// Who wrote each Fansly note (hub `clientNoteAttributions`, capability
// `note-attribution-v1`). Fansly keeps the notes and the hub syncs them by
// Fansly's note id; it does not know who wrote them. A person's write of a
// note through our panel that Fansly confirmed — a created note with its new
// id, an edit, a delete, the custom name set or cleared — is reported by the
// background: this page, this fan, this note, what was done and from where.
// The person is the hub's — the user of the token — never a field of ours.
// No text of a note, no title travels: only ids, kinds, actions, the origin
// and the questionnaire field labels the write changed.
//
// The request mirrors the hub's strict body exactly (the vendored SDK checks
// it first; a looser mirror would accept what the hub refuses), the answer is
// open like every hub answer: an outcome this build does not know is final
// all the same.

import * as z from 'zod/mini';

import { NativeIdSchema, OpenTokenSchema, UuidSchema } from '../primitives';
import { SEND_ATTRIBUTION_TIMESTAMP_PATTERN } from './attribution';
import { PageLabelSchema } from './wire';

/** The clients a report may name (hub CLIENT_NOTE_ATTRIBUTION_SOURCES); 2026-10-29: ChatSpace's OnlyMonster notes on
 * OnlyFans pages too (hub #912). */
export const NOTE_ATTRIBUTION_SOURCES = ['fansly-extension', 'chatspace-extension'] as const;
export type NoteAttributionSource = (typeof NOTE_ATTRIBUTION_SOURCES)[number];

/** A regular note, or the custom name (Fansly keeps the name as a note of its own type). */
export const NOTE_ATTRIBUTION_KINDS = ['note', 'custom_name'] as const;
export type NoteAttributionKind = (typeof NOTE_ATTRIBUTION_KINDS)[number];

export const NOTE_ATTRIBUTION_ACTIONS = ['created', 'edited', 'deleted'] as const;
export type NoteAttributionAction = (typeof NOTE_ATTRIBUTION_ACTIONS)[number];

/**
 * Where in the panel the write came from: `quick` — the quick-note box; `editor` — the text editor's save (a new
 * draft, an edit, «Править текстом» of the questionnaire); `field` — a questionnaire field's Enter; `fill` — a Goose
 * suggestion taken (✓, «Заменить», «Принять все»); `undo` — the fill's «Отменить»; `list` — a delete from the list;
 * `name` — the custom-name field; `transfer` (2026-10-29) — the notes of the fan's old account moved here: «Вставить
 * сюда» and the ✓ of its questionnaire's facts (a hub that does not know it yet stores null).
 */
export const NOTE_ATTRIBUTION_ORIGINS = ['quick', 'editor', 'field', 'fill', 'undo', 'list', 'name', 'transfer'] as const;
export type NoteAttributionOrigin = (typeof NOTE_ATTRIBUTION_ORIGINS)[number];

/**
 * What the hub did with one fact (hub CLIENT_NOTE_ATTRIBUTION_OUTCOMES). Every one is final: `recorded`; `duplicate`
 * — the same event of the same person, note and action was recorded already (a lost answer repeated); `conflict` —
 * the same event id with another content, the first stands; `out_of_range` — more than 5 minutes ahead of the hub's
 * clock or more than 30 days old, nothing is stored.
 */
export const NOTE_ATTRIBUTION_OUTCOMES = ['recorded', 'duplicate', 'conflict', 'out_of_range'] as const;
export type NoteAttributionOutcome = (typeof NOTE_ATTRIBUTION_OUTCOMES)[number];

export const NOTE_ATTRIBUTION_LIMITS = {
  /** Facts in one report (hub CLIENT_NOTE_ATTRIBUTION_MAX_FACTS). */
  maxFacts: 50,
  /** How far ahead of the hub's clock a fact may be. */
  maxAheadMs: 5 * 60_000,
  /** How old a fact the hub still takes; the background keeps less. */
  maxAgeDays: 30,
  /** Questionnaire labels in one fact. */
  maxFields: 20,
  /** Characters of one label. */
  fieldLabelMaxChars: 100,
} as const;

export const NoteAttributionFieldsSchema = z
  .array(z.string().check(z.minLength(1), z.maxLength(NOTE_ATTRIBUTION_LIMITS.fieldLabelMaxChars)))
  .check(z.minLength(1), z.maxLength(NOTE_ATTRIBUTION_LIMITS.maxFields));

export const NoteAttributionHubFactSchema = z.strictObject({
  /** Minted by the client for this write: a repeat of a lost answer is `duplicate`, never a second record. */
  eventId: UuidSchema,
  fanRef: NativeIdSchema,
  /** Fansly's note id (of the name's own note for `custom_name`). */
  noteRef: NativeIdSchema,
  noteKind: z.enum(NOTE_ATTRIBUTION_KINDS),
  action: z.enum(NOTE_ATTRIBUTION_ACTIONS),
  origin: z.optional(z.enum(NOTE_ATTRIBUTION_ORIGINS)),
  /** The questionnaire labels this write changed (never their values). */
  fields: z.optional(NoteAttributionFieldsSchema),
  observedAt: z.string().check(z.regex(SEND_ATTRIBUTION_TIMESTAMP_PATTERN)),
});
export type NoteAttributionHubFact = z.infer<typeof NoteAttributionHubFactSchema>;

/** Path `pageLabel`; the body is `source` and `facts`. */
export const NoteAttributionsRequestSchema = z.strictObject({
  pageLabel: PageLabelSchema,
  source: z.enum(NOTE_ATTRIBUTION_SOURCES),
  facts: z.array(NoteAttributionHubFactSchema).check(z.minLength(1), z.maxLength(NOTE_ATTRIBUTION_LIMITS.maxFacts)),
});
export type NoteAttributionsRequest = z.infer<typeof NoteAttributionsRequestSchema>;

export const NoteAttributionsResultSchema = z.object({
  pageLabel: z.string(),
  /** One per fact, in the order of the request. */
  results: z.array(z.object({ eventId: z.string(), outcome: OpenTokenSchema })),
  serverNow: z.string(),
});
export type NoteAttributionsResult = z.infer<typeof NoteAttributionsResultSchema>;

// ── who created a fan's notes and who changed them last (hub `clientFanNoteAttributions`, `note-attribution-read-v1`,
// 2026-10-29, the owner: «понимать кто и когда создавал анкетку») ──

/** The most notes of one fan the hub answers (hub CLIENT_FAN_NOTE_ATTRIBUTIONS_MAX_NOTES). */
export const FAN_NOTE_ATTRIBUTIONS_MAX_NOTES = 200;

/** Path `pageLabel` and `fanRef`. */
export const FanNoteAttributionsQuerySchema = z.strictObject({ pageLabel: PageLabelSchema, fanRef: NativeIdSchema });
export type FanNoteAttributionsQuery = z.infer<typeof FanNoteAttributionsQuerySchema>;

/** One person's write as the hub recorded it: the login, whether it is the caller, when the client saw it confirmed. */
export const FanNoteAttributionWhoSchema = z.object({ userId: z.number(), name: z.string(), isMe: z.boolean(), at: z.string() });
export type FanNoteAttributionWho = z.infer<typeof FanNoteAttributionWhoSchema>;

/** Each note the hub knows a write of (a deleted one left out), the latest written first: its first `created`, its last
 * `edited`. A note written before the hub recorded writes, or outside our panel, is absent or has `created` null. */
export const FanNoteAttributionsSchema = z.object({
  pageLabel: z.string(),
  fanRef: z.string(),
  notes: z.array(z.object({ noteRef: z.string(), noteKind: OpenTokenSchema, created: z.nullable(FanNoteAttributionWhoSchema), edited: z.nullable(FanNoteAttributionWhoSchema) })),
  serverNow: z.string(),
});
export type FanNoteAttributions = z.infer<typeof FanNoteAttributionsSchema>;
