// The hub's claim body since HF-3 (1.15.0, R20; hub `clientFanClaimBodySchema`,
// merged in b37075d8): the same lease and custody on Fansly, admitted per
// (platform, purpose, action), and a group that may be manual — the sha256 of
// a greeting text the person wrote or edited (`manual-greeting-v1`). Types
// only, so the shared code that talks to the hub (the facade, the background
// kit) can name the wider body without a byte of it in any bundle.
//
// Where the schemas are. The OnlyFans body is unchanged: ClaimBodySchema
// (newcomers.ts), AI groups only, which is all the hub admits there. The
// Fansly greeting's body, the manual group and its schema are Fansly's own
// module (send-fansly.ts: FanslyGreetingClaimBodySchema,
// ManualClaimGroupSchema): no ChatSpace bundle carries them. This module is
// apart from newcomers.ts on purpose: the request registry of the tab imports
// newcomers.ts, and any edit there, a type or a comment, renames identifiers
// in the minified probe of that registry (its gzip moves by a few bytes).

import type { ClaimBody, ClaimGroup } from './newcomers';

/**
 * A greeting with no AI generation behind it: one part, named by the sha256 of its exact text, lower-case hex. The
 * hub keeps and answers it as `generationRef` `manual:<textFingerprint>`, variant 0, one part, so ClaimStateSchema
 * reads it unchanged. Only where the platform's admission takes it (Fansly, never OnlyFans), only for a greeting.
 */
export interface ManualClaimGroup {
  readonly kind: 'manual';
  readonly textFingerprint: string;
}

/** The group a send names in the hub's body: a generation's or a manual one. */
export type ClaimSendGroup = ClaimGroup | ManualClaimGroup;

type WithSendGroup<B> = B extends { readonly group: ClaimGroup } ? Omit<B, 'group'> & { readonly group: ClaimSendGroup } : B;

/**
 * The body the hub takes since HF-3: `dispatch` and `registerNativeSend` may name a manual group. ClaimBody (OnlyFans)
 * and FanslyGreetingClaimBody (send-fansly.ts) are both of it; a test holds that.
 */
export type HubClaimBody = WithSendGroup<ClaimBody>;

/** One claim call as the hub takes it: path `pageLabel` + `fanRef`, and the body. */
export interface HubClaimOp {
  readonly pageLabel: string;
  readonly fanRef: string;
  readonly body: HubClaimBody;
}
