// «Заполнить из чата» of the fan's notes (FS-NOTE-6): what its answer is, on any site. Since 2026-10-28 the notes are on
// ChatSpace too (kept in OnlyMonster's own fan notes), so the fill's result and its limits are shared; Fansly's own
// operation data stay in `ops-fansly.ts`.

import * as z from 'zod/mini';

import { NoteFieldLabelSchema } from './hub/ai';
import { NOTE_FILL_LIMITS } from './limits';
import { displayText } from './primitives';

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
