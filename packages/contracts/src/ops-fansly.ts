// Fansly's own operations (1.15.0, R20 P4b3; docs/project-unite/architecture.md
// §1.6, §8.8, §11.1): «Заполнить из чата», as the shared scheduler runs it
// (the voice script is every site's since 1.47.0: voice.ts) — through its admission (one operation per chat across
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

import { type SiteOpId } from './features';
import type { FanslyFeatureKey } from './features/fansly';
import { type HubAiFeature } from './hub/ai';
import { OP_TIMEOUTS, type OpTimeouts } from './limits';
import { NOTES_FILL_OP_LIMITS, NoteFieldsResultSchema, NotesFillStartSchema as SharedNotesFillStartSchema } from './notes-fill';
import { OpViewSchema, type SiteOpResult, type SiteStartOp, type SiteOpView } from './ops';

/** The operations of Fansly's slice, beside the shared `FEATURE_IDS`. */
export const FANSLY_OPS = ['notes-fill'] as const satisfies readonly SiteOpId[];
export const FanslyOpSchema = z.enum(FANSLY_OPS);
export type FanslyOp = z.infer<typeof FanslyOpSchema>;

export function isFanslyOp(feature: string): feature is FanslyOp {
  return (FANSLY_OPS as readonly string[]).includes(feature);
}

/** The notes fill's limits: since 2026-10-28 the fill is shared (`notes-fill.ts`); the name stays for Fansly's code. */
export const FANSLY_OP_LIMITS = NOTES_FILL_OP_LIMITS;

// ── The driver's data ──────────────────────────────────────────────────────

/** What drives one operation (§8.8): the scheduler's table of the site's slice, handed to it by the site's background chunk. */
export interface FanslyOpDriver {
  /** The hub feature it streams through `aiFeatureStream` (`HUB_AI_FEATURES`). */
  readonly hub: HubAiFeature;
  /** The entry of Fansly's manifest whose `generate` admits it: its switch is the page's — `voice`, `notesFill` (§11.1). */
  readonly feature: FanslyFeatureKey;
  /** The kind of its result (`SiteOpResult`). */
  readonly result: SiteOpResult['kind'];
  /** §7: the notes fill, which reads the whole chat, waits as long as a full Recap. */
  readonly timeouts: OpTimeouts;
}

export const FANSLY_OP_DRIVERS = {
  'notes-fill': { hub: 'fan-notes-fill', feature: 'notes-fill', result: 'note-fields', timeouts: OP_TIMEOUTS.recap },
} as const satisfies Record<FanslyOp, FanslyOpDriver>;

// ── A start ────────────────────────────────────────────────────────────────

/**
 * A Fansly operation is a Fansly chat's: the target's page is a Fansly page (and so its chat a `fansly-web` one,
 * `TargetSchema`), the conversation is the group, the fan named apart — the hub reads both (HF-4а, HF-9).
 */
const ofFansly = (start: { readonly target: { readonly binding: { readonly platform: string } } }): boolean => start.target.binding.platform === 'fansly';

/**
 * «Дополнить из чата» of a Fansly chat: the shared start (`notes-fill.ts`), and the chat is Fansly's.
 */
export const NotesFillStartSchema = SharedNotesFillStartSchema.check(z.refine(ofFansly, { message: "a Fansly operation is a Fansly chat's" }));

export const FanslyStartOpSchema = z.discriminatedUnion('feature', [NotesFillStartSchema]) satisfies z.ZodMiniType<SiteStartOp>;
export type FanslyStartOp = z.infer<typeof FanslyStartOpSchema>;

// ── A result (its schema is the shared `notes-fill.ts`) ──────────────────────

export { NoteFieldValueSchema, NoteFieldsResultSchema, NoteQuotesSchema } from './notes-fill';

export const FanslyOpResultSchema = z.discriminatedUnion('kind', [NoteFieldsResultSchema]) satisfies z.ZodMiniType<SiteOpResult>;
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
