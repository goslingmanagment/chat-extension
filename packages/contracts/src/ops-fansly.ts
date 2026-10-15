// Fansly's own operations (1.15.0, R20 P4b3; docs/project-unite/architecture.md
// §1.6, §8.8, §11.1): the voice script and «Заполнить из чата», as the shared
// scheduler runs them — through its admission (one operation per chat across
// the extension and three per tab, together with Reply and the rest), its
// timeouts, cancel, spend, dedup and kept result. The shared code knows them
// as types (`SiteOpId`, `SiteStartOp`, `SiteOpResult`); what checks and drives
// them is here: the runtime list, the schemas of a start and of a result, and
// each one's driver data — the hub feature it streams, the entry of Fansly's
// manifest that admits it, the kind of its result, its timeouts. The request
// it becomes and the parse of its answer are the driver's code (core, the
// site's background chunk), not data.
//
// A site module: imported by its subpath only (`@cg/contracts/ops-fansly`), by
// Fansly's own code; the root does not re-export it, so neither a ChatSpace
// bundle nor the core of the background carries it (§1.8, §3.2).

import * as z from 'zod/mini';

import { ToneSchema, type SiteOpId } from './features';
import type { FanslyFeatureKey } from './features/fansly';
import { NoteFieldLabelSchema, NoteFieldsSchema, type HubAiFeature } from './hub/ai';
import { HumanCauseSchema, TargetSchema } from './ids';
import { AI_REQUEST_LIMITS, NOTE_FILL_LIMITS, OP_TIMEOUTS, type OpTimeouts } from './limits';
import { OpDraftSchema, OpViewSchema, type SiteOpResult, type SiteStartOp, type SiteOpView } from './ops';
import { UuidSchema, boundedText, displayText } from './primitives';

/** The operations of Fansly's slice, beside the shared `FEATURE_IDS`. */
export const FANSLY_OPS = ['voice-script', 'notes-fill'] as const satisfies readonly SiteOpId[];
export const FanslyOpSchema = z.enum(FANSLY_OPS);
export type FanslyOp = z.infer<typeof FanslyOpSchema>;

export function isFanslyOp(feature: string): feature is FanslyOp {
  return (FANSLY_OPS as readonly string[]).includes(feature);
}

export const FANSLY_OP_LIMITS = {
  /** The voice script a result may carry: the bound of `fansly.voice.create`'s `script` (the hub checks the script itself; the editor holds about 600). */
  voiceScriptMaxChars: 5_000,
} as const;

// ── The driver's data ──────────────────────────────────────────────────────

/** What drives one operation (§8.8): the scheduler's table of the site's slice, handed to it by the site's background chunk. */
export interface FanslyOpDriver {
  /** The hub feature it streams through `aiFeatureStream` (`HUB_AI_FEATURES`). */
  readonly hub: HubAiFeature;
  /** The entry of Fansly's manifest whose `generate` admits it: its switch is the page's — `voice`, `notesFill` (§11.1). */
  readonly feature: FanslyFeatureKey;
  /** The kind of its result (`SiteOpResult`). */
  readonly result: SiteOpResult['kind'];
  /** §7: the voice script waits as long as a draft; the notes fill, which reads the whole chat, as long as a full Recap. */
  readonly timeouts: OpTimeouts;
}

export const FANSLY_OP_DRIVERS = {
  'voice-script': { hub: 'voice-script', feature: 'voice', result: 'voice-script', timeouts: OP_TIMEOUTS.reply },
  'notes-fill': { hub: 'fan-notes-fill', feature: 'notes-fill', result: 'note-fields', timeouts: OP_TIMEOUTS.recap },
} as const satisfies Record<FanslyOp, FanslyOpDriver>;

// ── A start ────────────────────────────────────────────────────────────────

/**
 * A Fansly operation is a Fansly chat's: the target's page is a Fansly page (and so its chat a `fansly-web` one,
 * `TargetSchema`), the conversation is the group, the fan named apart — the hub reads both (HF-4а, HF-9).
 */
const ofFansly = (start: { readonly target: { readonly binding: { readonly platform: string } } }): boolean => start.target.binding.platform === 'fansly';

const START = {
  target: TargetSchema,
  cause: HumanCauseSchema,
  /** The body's `messageCount`, within its bounds: the quick window for the script, the deep one for the notes fill. */
  window: z.int().check(z.gte(AI_REQUEST_LIMITS.messageCountMin), z.lte(AI_REQUEST_LIMITS.messageCountMax)),
  regenerateOf: z.optional(UuidSchema),
  force: z.optional(z.boolean()),
};

/** The voice script: spoken from the draft in the chat's field (never blank), in a preset's tone — null is the calm one, the hub's `none`. */
export const VoiceScriptStartSchema = z
  .strictObject({ feature: z.literal('voice-script'), ...START, tone: z.nullable(ToneSchema), draft: OpDraftSchema })
  .check(
    z.refine(ofFansly, { message: "a Fansly operation is a Fansly chat's" }),
    z.refine((start) => start.draft.text.trim() !== '', { message: 'the voice script is spoken from a draft' }),
  );

/** «Заполнить из чата»: the questionnaire's labels and nothing of the note — its values never leave the tab (FS-NOTE-5, FX-015). */
export const NotesFillStartSchema = z
  .strictObject({ feature: z.literal('notes-fill'), ...START, fields: NoteFieldsSchema })
  .check(z.refine(ofFansly, { message: "a Fansly operation is a Fansly chat's" }));

export const FanslyStartOpSchema = z.discriminatedUnion('feature', [VoiceScriptStartSchema, NotesFillStartSchema]) satisfies z.ZodMiniType<SiteStartOp>;
export type FanslyStartOp = z.infer<typeof FanslyStartOpSchema>;

// ── A result ───────────────────────────────────────────────────────────────

/** The script, ready for the editor and then for the paid voicing (`fansly.voice.create`); its source is the view's `generationRef`. */
export const VoiceScriptResultSchema = z.strictObject({
  kind: z.literal('voice-script'),
  script: boundedText(FANSLY_OP_LIMITS.voiceScriptMaxChars).check(z.refine((script) => script.trim() !== '', { message: 'an empty voice script' })),
});

/** One asked label and what the chat gave it — one line of the note; `''`: nothing, the field stays as it is. */
export const NoteFieldValueSchema = z.strictObject({
  label: NoteFieldLabelSchema,
  value: displayText(NOTE_FILL_LIMITS.valueMaxChars).check(z.regex(/^[^\r\n\u2028\u2029]*$/)),
});

/** The asked labels, each once, with their values: the panel fills the empty fields and shows the rest as «было → станет». */
export const NoteFieldsResultSchema = z.strictObject({
  kind: z.literal('note-fields'),
  fields: z
    .array(NoteFieldValueSchema)
    .check(
      z.minLength(1),
      z.maxLength(NOTE_FILL_LIMITS.fieldsMax),
      z.refine((fields) => new Set(fields.map((field) => field.label.toLowerCase())).size === fields.length, { message: 'a label answered twice' }),
    ),
});

export const FanslyOpResultSchema = z.discriminatedUnion('kind', [VoiceScriptResultSchema, NoteFieldsResultSchema]) satisfies z.ZodMiniType<SiteOpResult>;
export type FanslyOpResult = z.infer<typeof FanslyOpResultSchema>;

/** Kept by the common scheduler, decoded only by the Fansly chunk. */
export const FanslyOpViewSchema = z.strictObject({
  ...OpViewSchema.shape,
  feature: FanslyOpSchema,
  result: z.optional(FanslyOpResultSchema),
}).check(
  z.refine(ofFansly, { message: "a Fansly operation is a Fansly chat's" }),
  z.refine((view) => view.result === undefined || view.result.kind === FANSLY_OP_DRIVERS[view.feature].result, { message: 'result belongs to another operation' }),
  z.refine((view) => view.state !== 'done' || (view.result !== undefined && view.generationRef !== undefined), { message: 'done needs a result and its source' }),
) satisfies z.ZodMiniType<SiteOpView>;
export type FanslyOpView = z.infer<typeof FanslyOpViewSchema>;
