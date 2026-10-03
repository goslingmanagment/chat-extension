// The AI feature vocabulary (architecture.md §5.5, §8.4, D-14, D-15), shared by
// identities, operations, telemetry and settings. Our names, not the hub's:
// the hub facade (part 2b) maps them onto hub feature ids.

import * as z from 'zod/mini';

export const FEATURE_IDS = ['reply', 'fix', 'hi', 'ping', 'review', 'recap', 'recap-short', 'coach'] as const;
export const FeatureIdSchema = z.enum(FEATURE_IDS);
export type FeatureId = z.infer<typeof FeatureIdSchema>;

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
