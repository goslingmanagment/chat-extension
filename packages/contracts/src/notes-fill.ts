// «Заполнить из чата» of the fan's notes (FS-NOTE-6), on any site: its start, its answer, its limits and its driver's
// data, as the shared scheduler runs it (one operation per chat, three per tab, its timeouts, cancel and kept result).
// Since 2026-10-28 the notes are on ChatSpace too (kept in OnlyMonster's own fan notes): ChatSpace's tab asks
// `notes.fill.*`, the background adds this operation to a site that has no driver of its own. Fansly keeps its own
// operation (`ops-fansly.ts`, `fansly.ops.*`), built from these schemas.

import * as z from 'zod/mini';

import { LiveTextTailSchema } from './host';
import { NoteFieldLabelSchema, NoteFieldsSchema, NoteValuesSchema } from './hub/ai';
import { HumanCauseSchema, TargetSchema } from './ids';
import { AI_REQUEST_LIMITS, NOTE_FILL_LIMITS, OP_TIMEOUTS, type OpTimeouts } from './limits';
import { OpViewSchema } from './ops';
import { UuidSchema, displayText } from './primitives';

export const NOTES_FILL_OP_LIMITS = {
  /** HF-6: «Заполнить из чата» reads the whole chat, never fewer than this many messages, as the Fansly extension did; above it — the hub's `limits.deepMax` (R20 P11c). */
  notesFillDepthMin: 3_000,
  /** 1.16.0 (R20 P11b2; the Fansly extension's `FAN_NOTE_QUOTES_MAX`, decision 164): quotes kept per field; a fourth is ignored. */
  noteQuotesMax: 3,
  /** A quote's length: the hub asks for at most 200 characters; a longer one is cut by the driver, never refused. */
  noteQuoteMaxChars: 400,
  /** `+ Label: value` fields read from one answer (the old's `FAN_NOTE_PROPOSED_MAX`): the hub asks for two at most. */
  noteProposedMax: 5,
} as const;

const oneLine = (max: number) => displayText(max).check(z.regex(/^[^\r\n\u2028\u2029]*$/));

/** 1.16.0 (R20 P11b2): the fan's words behind a value — up to three `> «…»` lines of the hub's merge mode, one line each. */
export const NoteQuotesSchema = z.array(oneLine(NOTES_FILL_OP_LIMITS.noteQuoteMaxChars).check(z.minLength(1))).check(z.maxLength(NOTES_FILL_OP_LIMITS.noteQuotesMax));

/** One asked label and what the chat gave it — one line of the note; `''`: nothing, the field stays as it is. */
export const NoteFieldValueSchema = z.strictObject({
  label: NoteFieldLabelSchema,
  value: oneLine(NOTE_FILL_LIMITS.valueMaxChars),
  /** 1.16.0: absent — no quote (the labels-only mode, or none written). */
  quotes: z.optional(NoteQuotesSchema),
});

/** The asked labels, each once, with their values: the panel fills the empty fields and shows the rest as «было → станет». */
export const NoteFieldsResultSchema = z
  .strictObject({
    kind: z.literal('note-fields'),
    fields: z
      .array(NoteFieldValueSchema)
      .check(
        z.minLength(1),
        z.maxLength(NOTE_FILL_LIMITS.fieldsMax),
        z.refine((fields) => new Set(fields.map((field) => field.label.toLowerCase())).size === fields.length, { message: 'a label answered twice' }),
      ),
    /** 1.16.0 (R20 P11b2): `+ Label: value` of the merge mode — a field the hub named itself, with a value, none an asked label. */
    proposed: z.optional(z.array(NoteFieldValueSchema.check(z.refine((field) => field.value.trim() !== '', { message: 'a proposed field without a value' }))).check(z.maxLength(NOTES_FILL_OP_LIMITS.noteProposedMax))),
  })
  .check(
    z.refine((result) => (result.proposed ?? []).every((field) => !result.fields.some((asked) => asked.label.toLowerCase() === field.label.toLowerCase())), { message: 'a proposed field repeats an asked label' }),
  );

// ── the operation ───────────────────────────────────────────────────────────

/** What drives `notes-fill` in the scheduler: the hub feature it streams, the manifest entry that admits it (the page's
 * `notesFill`), the kind of its result, its timeouts (it reads the whole chat: as long as a full Recap). */
export const NOTES_FILL_OP_DRIVER = {
  hub: 'fan-notes-fill',
  feature: 'notes-fill',
  result: 'note-fields',
  timeouts: OP_TIMEOUTS.recap,
} as const satisfies { readonly hub: string; readonly feature: string; readonly result: string; readonly timeouts: OpTimeouts };

/**
 * «Дополнить из чата» of any site's chat: the questionnaire's labels and, 1.28.0 (X43, the owner's ruling of
 * 2026-10-17), their values, index-aligned — the hub body's `noteValues`, never anything else of the note (FS-NOTE-5,
 * FX-024). Without `values` the request carries one empty value per label. The target's refinements hold the ids (on
 * OnlyFans the chat is the fan, on Fansly the group named apart from the fan).
 */
export const NotesFillStartSchema = z
  .strictObject({
    feature: z.literal('notes-fill'),
    target: TargetSchema,
    cause: HumanCauseSchema,
    /** The body's `messageCount`, within its bounds: the deep window (the driver raises it to the fill's floor). */
    window: z.int().check(z.gte(AI_REQUEST_LIMITS.messageCountMin), z.lte(AI_REQUEST_LIMITS.messageCountMax)),
    fresh: z.optional(LiveTextTailSchema),
    regenerateOf: z.optional(UuidSchema),
    force: z.optional(z.boolean()),
    fields: NoteFieldsSchema,
    values: z.optional(NoteValuesSchema),
  })
  .check(z.refine((start) => start.values === undefined || start.values.length === start.fields.length, { message: 'values: one per field' }));
export type NotesFillStartWire = z.infer<typeof NotesFillStartSchema>;

/** The fill's kept view, as the scheduler keeps it for any site. */
export const NotesFillOpViewSchema = z
  .strictObject({
    ...OpViewSchema.shape,
    feature: z.literal('notes-fill'),
    result: z.optional(NoteFieldsResultSchema),
  })
  .check(z.refine((view) => view.state !== 'done' || (view.result !== undefined && view.generationRef !== undefined), { message: 'done needs a result and its source' }));
export type NotesFillOpView = z.infer<typeof NotesFillOpViewSchema>;
