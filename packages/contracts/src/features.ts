// The AI feature vocabulary (architecture.md §5.5, §8.4, D-14, D-15), shared by
// identities, operations, telemetry and settings. Our names, not the hub's:
// the hub facade (part 2b) maps them onto hub feature ids.

import * as z from 'zod/mini';

export const FEATURE_IDS = ['reply', 'fix', 'hi', 'ping', 'review', 'recap', 'recap-short', 'coach'] as const;
export const FeatureIdSchema = z.enum(FEATURE_IDS);
export type FeatureId = z.infer<typeof FeatureIdSchema>;

/**
 * 1.15.0 (R20 P4b3; docs/project-unite/architecture.md §1.6, §8.8): the operations of a site's own slice — Fansly's
 * voice script (`voice-script`) and «Заполнить из чата» (`notes-fill`). They run through the scheduler's shared
 * admission beside the features above, but they are no `FeatureId`: the closed list and every shared schema built on
 * it stay as they are, and no ChatSpace bundle carries a site's operation. A union at the type level only; the runtime
 * list, the schemas of a start and a result and the driver's data are the site's module (`ops-fansly`, its subpath).
 */
export type SiteOpId = 'voice-script' | 'notes-fill';
/** What the scheduler runs: a shared AI feature or an operation of a site's slice. */
export type OpFeature = FeatureId | SiteOpId;

/** Where an operation was started and where its result is shown. */
export const SURFACES = ['dock', 'preview', 'newcomers', 'coach', 'overlay'] as const;
export const SurfaceSchema = z.enum(SURFACES);
export type Surface = z.infer<typeof SurfaceSchema>;

/** Reply tones (Б1, AI-002). `null` where a tone is optional means "no tone" (hub `none`). */
export const TONES = ['casual', 'flirty', 'upsell', 'spicy'] as const;
export const ToneSchema = z.enum(TONES);
export type Tone = z.infer<typeof ToneSchema>;

/** D-14: fresh page text is allowed only for these features, only in the open chat (surface `dock`). */
export const FRESH_TEXT_FEATURES = ['reply', 'fix', 'hi', 'ping'] as const satisfies readonly FeatureId[];

/**
 * 1.29.0 (decision X52): fresh page text for Review and Coach (its own panel) too — each the answer of
 * the one person who asked, which no one else reads. The hub takes it there from `live-text-review-coach-v1` on
 * (`LIVE_TEXT_HUB_NEEDS`). 1.31.0 (X52, the owner's ruling 2026-10-17): Recap, full and short, in the dock too, on a
 * hub with `live-text-recap-v1` — such a recap stays the fan's shared recap and goes to the dossier.
 */
export const ANSWER_FRESH_TEXT_FEATURES = ['review', 'coach', 'recap', 'recap-short'] as const satisfies readonly FeatureId[];

/**
 * Where a start may carry fresh page text: the open chat's dock, Coach's own panel; null — never. 1.51.0: Review on
 * Coach's panel — it is a turn of Coach's dialog, started there and nowhere else.
 */
export function freshTextSurface(feature: FeatureId): Surface | null {
  if (feature === 'coach' || feature === 'review') return 'coach';
  return isFreshTextFeature(feature) || (ANSWER_FRESH_TEXT_FEATURES as readonly FeatureId[]).includes(feature) ? 'dock' : null;
}

/** D-15: features whose output is a message to the fan and may be split into parts. Recap and Review never are. */
export const SPLIT_FEATURES = ['reply', 'fix', 'hi', 'ping', 'coach'] as const satisfies readonly FeatureId[];

/** Features whose result can be sent from a preview (X8): drafts for the fan, never analysis. */
export const SENDABLE_FEATURES = ['reply', 'fix', 'hi', 'ping'] as const satisfies readonly FeatureId[];

export function isFreshTextFeature(feature: FeatureId): feature is (typeof FRESH_TEXT_FEATURES)[number] {
  return (FRESH_TEXT_FEATURES as readonly FeatureId[]).includes(feature);
}

export function isSplitFeature(feature: FeatureId): feature is (typeof SPLIT_FEATURES)[number] {
  return (SPLIT_FEATURES as readonly FeatureId[]).includes(feature);
}
