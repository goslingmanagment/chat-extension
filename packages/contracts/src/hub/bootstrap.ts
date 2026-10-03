// `GET /client/bootstrap` (hub H-2a, architecture.md §8.3 with the critic's
// corrections, hub-pr-plan.md §4.2): who you are, your pages and their
// bindings, owner kill switches, run-time limits and the hub's capabilities.
// Flags, page features, capabilities, platform and role are open tokens: a
// value this XPI does not know is "off"/skipped, never a failed parse of the
// whole bootstrap (critic item 14). Pages bind by `platformAccountId` only.

import * as z from 'zod/mini';

import { CountSchema, HubIntIdSchema, IsoTimestampSchema, OpenTokenSchema, boundedText } from '../primitives';

/** Bootstrap protocol this client speaks; another number → CG-HUB-OUTDATED (the client checks). */
export const BOOTSTRAP_PROTOCOL = 1;

const PositiveIntSchema = z.int().check(z.gte(1));

export const FeatureAvailabilitySchema = z.object({
  available: z.boolean(),
  /** A `CLIENT_FEATURE_UNAVAILABLE_REASONS` value or a newer one. */
  reason: z.optional(OpenTokenSchema),
});
export type FeatureAvailability = z.infer<typeof FeatureAvailabilitySchema>;

/**
 * An approved profile of ChatSpace's send path and receipt (X8): adapter
 * version + module fingerprints by role. No code, no selectors.
 */
export const ReceiptProfileSchema = z.object({
  id: boundedText(64),
  adapterVersion: boundedText(64),
  modules: z.record(boundedText(64), boundedText(128)),
});
export type ReceiptProfile = z.infer<typeof ReceiptProfileSchema>;

export const BootstrapPageSchema = z.object({
  pageId: HubIntIdSchema,
  pageLabel: z.string(),
  title: z.string(),
  /** Open token; narrowPlatform() skips a page of an unknown platform. */
  platform: OpenTokenSchema,
  /** `pages.external_page_id`; the ONLY binding key (AU-023). Fansly pages may have none. */
  platformAccountId: z.nullable(z.string()),
  bindingRevision: CountSchema,
  /** Per-flag availability for this page. */
  features: z.record(OpenTokenSchema, FeatureAvailabilitySchema),
});
export type BootstrapPage = z.infer<typeof BootstrapPageSchema>;

export const BootstrapLimitsSchema = z.object({
  /** Fresh-text items per request (60). */
  freshTextMaxItems: CountSchema,
  /** Characters per fresh-text item (5000). */
  freshTextMaxChars: CountSchema,
  /** Feed page size (100). */
  feedMax: PositiveIntSchema,
  /** Deepest `messageCount` (1500 → 3000 after H-6, full Recap only). */
  deepMax: PositiveIntSchema,
  /** Widest «Новые» window, hours (720). */
  audienceWindowHours: PositiveIntSchema,
  claimLeaseSec: PositiveIntSchema,
  claimRenewSec: PositiveIntSchema,
  claimActivityWindowSec: PositiveIntSchema,
  /** Preview sends per minute per user (6). */
  previewSendPerMinute: CountSchema,
  navInsertTimeoutSec: PositiveIntSchema,
  dispatchTicketSec: PositiveIntSchema,
  /** [] = X8 is off whatever the flags say. */
  previewSendReceiptProfiles: z.array(ReceiptProfileSchema).check(z.maxLength(32)),
});
export type BootstrapLimits = z.infer<typeof BootstrapLimitsSchema>;

export const BootstrapSchema = z.object({
  protocol: PositiveIntSchema,
  issuedAt: IsoTimestampSchema,
  /** Cache lifetime (300). */
  ttlSec: PositiveIntSchema,
  /** Grows on every owner change of the client config; also the custody `flagRevision`. */
  configRevision: CountSchema,
  /** Below it AI is off and the client shows CG-HUB-OUTDATED. */
  minVersion: boundedText(32),
  identity: z.object({
    userId: HubIntIdSchema,
    username: z.string(),
    /** Open token; narrowRole() maps an unknown role to `unknown` (least privilege). */
    role: OpenTokenSchema,
    /** `chat-extension` for the narrow token (H-3); null = a full token. */
    tokenClient: z.nullable(OpenTokenSchema),
  }),
  pages: z.array(BootstrapPageSchema),
  /** `onlymonster:<accountId>` → pageId: the owner's explicit binding wins over platformAccountId. */
  bindingsByHost: z.record(boundedText(128), HubIntIdSchema),
  /** Owner kill switches; an unknown name is ignored, a missing known one is off. */
  flags: z.record(OpenTokenSchema, z.boolean()),
  limits: BootstrapLimitsSchema,
  capabilities: z.array(OpenTokenSchema).check(z.maxLength(64)),
});
export type Bootstrap = z.infer<typeof BootstrapSchema>;
