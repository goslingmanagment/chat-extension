// Recaps and the dossier (architecture.md §7 «Recap: общий и досье», §8.5;
// hub H-5, H-13): the recap status line (`aiRecapStatus`, metadata only),
// the shared recap text of a page + fan + persona (H-13), the dossier save
// from a finished full fan-summary (H-5), and the dossier read
// (`pageConversationProfile` / `pageFanProfile`).

import * as z from 'zod/mini';

import {
  CountSchema,
  GenerationRefSchema,
  HubIntIdSchema,
  IsoTimestampSchema,
  NativeIdSchema,
  OpenTokenSchema,
  PersonaDefinitionIdSchema,
  UuidSchema,
  boundedText,
} from '../primitives';
import { HUB_PLATFORMS } from './auth';
import { PageLabelSchema } from './wire';

// ── `aiRecapStatus` (existing; strict in the SDK) ──────────────────────────

export const RecapStatusQuerySchema = z.strictObject({
  pageLabel: PageLabelSchema,
  conversationRef: boundedText(255),
  fanRef: z.optional(boundedText(255)),
  /** Definition-aware: status and the Coach attach pick the same persona-scoped rows. */
  personaDefinitionId: z.optional(PersonaDefinitionIdSchema),
});
export type RecapStatusQuery = z.infer<typeof RecapStatusQuerySchema>;

export const RECAP_TRANSCRIPT_COVERAGES = ['full-history', 'window'] as const;

const RecapSlotSchema = z.strictObject({
  generatedAt: IsoTimestampSchema,
  ageMs: CountSchema,
  transcriptCoverage: z.nullable(z.enum(RECAP_TRANSCRIPT_COVERAGES)),
  requestedCount: z.nullable(z.int()),
  /** The honest count (`requestedCount` keeps the uncut request, critic H-6). */
  keptCount: z.nullable(z.int()),
});

/** The freshest usable full and short recap of one conversation: metadata, no text, no AI spend. */
export const RecapStatusSchema = z.strictObject({
  full: z.nullable(RecapSlotSchema),
  short: z.nullable(RecapSlotSchema),
});
export type RecapStatus = z.infer<typeof RecapStatusSchema>;

// ── H-13 shared recaps ─────────────────────────────────────────────────────

/**
 * Path `pageLabel` + `fanRef`, query `personaDefinitionId` and, 1.15.0 (R20 F6b, hub HF-10), `conversationRef`: the
 * conversation apart from the fan (on Fansly the group). Only to a hub with `conversation-recaps-v1`, and only when
 * the conversation is not the fan: absent, the recaps are the fan's own, as on ChatSpace before 1.15.0.
 */
export const SharedRecapsQuerySchema = z.strictObject({
  pageLabel: PageLabelSchema,
  fanRef: NativeIdSchema,
  personaDefinitionId: z.optional(PersonaDefinitionIdSchema),
  conversationRef: z.optional(NativeIdSchema),
});
export type SharedRecapsQuery = z.infer<typeof SharedRecapsQuerySchema>;

export const RecapBodySchema = z.object({
  generationRef: boundedText(100),
  generatedAt: IsoTimestampSchema,
  personaDefinitionId: z.nullable(z.string()),
  coverage: z.object({
    /** full-history | window. */
    transcriptCoverage: z.nullable(OpenTokenSchema),
    requestedCount: z.nullable(z.int()),
    keptCount: z.nullable(z.int()),
  }),
  text: z.string(),
});
export type RecapBody = z.infer<typeof RecapBodySchema>;

/** One recap per page + fan + persona for every granted chatter (D-31); local slots are copies keyed by `generationRef`. */
export const SharedRecapsSchema = z.object({
  full: z.nullable(RecapBodySchema),
  short: z.nullable(RecapBodySchema),
  /** The latest dossier body equals the full recap. */
  fullSavedToProfile: z.boolean(),
});
export type SharedRecaps = z.infer<typeof SharedRecapsSchema>;

// ── H-5 dossier from a generation ──────────────────────────────────────────

/** Path `pageLabel` + `fanRef`; body `generationRef` (= meta.requestId) + our clientRequestId. */
export const ProfileFromGenerationRequestSchema = z.strictObject({
  pageLabel: PageLabelSchema,
  fanRef: NativeIdSchema,
  generationRef: GenerationRefSchema,
  /** Tells "in flight" from "unknown" on the hub. */
  clientRequestId: z.optional(UuidSchema),
  /**
   * 1.15.0 (R20 F6b, hub HF-10): the conversation the generation was made in, when it is not the fan (on Fansly the
   * group); the hub finds that conversation's generation of this fan. Only with `conversation-recaps-v1`. The dossier
   * is still the fan's (the path).
   */
  conversationRef: z.optional(NativeIdSchema),
});
export type ProfileFromGenerationRequest = z.infer<typeof ProfileFromGenerationRequestSchema>;

export const ProfileFromGenerationResponseSchema = z.object({
  outcome: z.enum(['created', 'existing']),
  profile: z.object({
    version: z.int().check(z.gte(1)),
    createdAt: IsoTimestampSchema,
    sourceGeneratedAt: z.nullable(IsoTimestampSchema),
  }),
});
export type ProfileFromGenerationResponse = z.infer<typeof ProfileFromGenerationResponseSchema>;

/**
 * What the facade makes of H-5: saved (created or already there), not ready
 * yet (409 `generation_not_ready`: the caller follows the §7 schedule, an
 * idempotent link write, never a new generation), or rejected for good
 * (`generation_not_eligible`, 404).
 */
export const ProfileSaveOutcomeSchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('saved'), response: ProfileFromGenerationResponseSchema }),
  z.strictObject({ state: z.literal('not-ready') }),
  z.strictObject({ state: z.literal('rejected'), reason: z.nullable(OpenTokenSchema) }),
]);
export type ProfileSaveOutcome = z.infer<typeof ProfileSaveOutcomeSchema>;

// ── Dossier read (`pageConversationProfile`, `pageFanProfile`) ─────────────

/**
 * The dossier is the fan's (R20 F6b, docs/project-unite/architecture.md §11.1): the query names the fan only. Where a
 * chat is its fan (`CHAT_IS_FAN`, OnlyFans) the facade reads it by that conversation (`pageConversationProfile`), as
 * always; elsewhere by the fan (`pageFanProfile`).
 */
export const DossierQuerySchema = z.strictObject({ pageLabel: PageLabelSchema, fanRef: NativeIdSchema });
export type DossierQuery = z.infer<typeof DossierQuerySchema>;

/** `fanProfileResponseSchema`: the fan plus the latest profile document (null when none). */
export const DossierSchema = z.object({
  fan: z.object({
    platform: z.enum(HUB_PLATFORMS),
    platformUserId: z.string(),
    username: z.nullable(z.string()),
    displayName: z.nullable(z.string()),
    createdAtExternal: z.nullable(IsoTimestampSchema),
    pageAlias: z.nullable(z.string()),
  }),
  profile: z.nullable(
    z.object({
      version: z.int().check(z.gte(1)),
      body: z.string(),
      source: z.enum(['chatmuse']),
      createdAt: IsoTimestampSchema,
      sourceGeneratedAt: z.optional(z.nullable(IsoTimestampSchema)),
      createdByUserId: z.nullable(HubIntIdSchema),
    }),
  ),
});
export type Dossier = z.infer<typeof DossierSchema>;
