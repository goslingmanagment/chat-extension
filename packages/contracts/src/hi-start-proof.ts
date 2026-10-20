// Hi wire values (1.15.0, R20 P4b4 / HF-5). Kept apart from the page's Fansly module: the shared operation and
// hub request schemas use these values without importing the site's snapshot, anchors or bridge vocabulary.
import * as z from 'zod/mini';

import { compareNativeIds, nativeIdsAscending, CountSchema, NativeIdSchema } from './primitives';

export const START_PROOF_LIMITS = { automatedIdsMax: 120, passPersonalWindow: 30 } as const;

/** The hub's fanslyAvatarUrlSchema: the provider receives an image; neither this client nor the hub fetches it. */
export const HI_FAN_AVATAR_URL_PATTERN = /^https:\/\/[a-z0-9-]+\.fansly\.com\//;
export const HiFanAvatarUrlSchema = z.string().check(z.maxLength(4096), z.regex(HI_FAN_AVATAR_URL_PATTERN));

// ── StartProofV1 (§5.8, FS-AI-2, HF-5) ─────────────────────────────────────

/**
 * Who proved the start: `tab-short-page` — the tab, by a certified fresh end shorter than a history page and the
 * continuous observation since (§5.6); `pass-empty-page` — the pass of «Новые», by walking the history to its empty
 * page (FS-NEW-7).
 */
export const START_PROOF_SOURCES = ['tab-short-page', 'pass-empty-page'] as const;
export type StartProofSource = (typeof START_PROOF_SOURCES)[number];

const startProofShape = {
  v: z.literal(1),
  source: z.enum(START_PROOF_SOURCES),
  groupId: NativeIdSchema,
  /**
   * The first message of the conversation, as the source saw it. Tab: the oldest message of the short certificate.
   * Pass: the earliest message of the whole history it walked (from the last non-empty page before the confirmed
   * end). Null only when the whole history is empty.
   */
  startWitnessId: z.nullable(NativeIdSchema),
  /** Messages from the start that the tab or the pass saw. */
  coveredCount: CountSchema,
  /**
   * Personal messages (NF-033: the fan's always; the model's unless automated by `type === 2`, a `correlationId`
   * without `inReplyTo`, or a welcome text of `/message/automated`). Tab: over the whole proven history; pass: among
   * the last 30 messages of the history it walked.
   */
  personalCount: CountSchema,
  /** The newest automated messages, oldest first, at most the ring's capacity. */
  automatedIds: z.array(NativeIdSchema).check(z.maxLength(START_PROOF_LIMITS.automatedIdsMax)),
};
type StartProofShape = { readonly source: StartProofSource; readonly startWitnessId: string | null; readonly coveredCount: number; readonly personalCount: number; readonly automatedIds: readonly string[] };

/** The witness is there exactly when the history is not empty, and no automated message is older than it. */
function startWitnessHolds(p: StartProofShape): boolean {
  if ((p.startWitnessId === null) !== (p.coveredCount === 0)) return false;
  const first = p.automatedIds[0];
  return p.startWitnessId === null || first === undefined || compareNativeIds(p.startWitnessId, first) <= 0;
}

/** The counts fit the history they come from: the pass counts personal messages among its last 30 only. */
function startCountsHold(p: StartProofShape): boolean {
  const automated = p.automatedIds.length;
  if (!nativeIdsAscending(p.automatedIds) || automated > p.coveredCount || p.personalCount > p.coveredCount) return false;
  if (p.source === 'pass-empty-page') return p.personalCount <= START_PROOF_LIMITS.passPersonalWindow;
  return p.personalCount + automated <= p.coveredCount;
}

/**
 * The client's proof of the start of a conversation and its count of personal messages (§5.8, decision X37): Hi on
 * Fansly is allowed by the hub (`hi-start-proof-v1`) on it; the client refuses by itself only when more than 10 are
 * proven. A missing proof is never a zero count. Ids only, never a text; the hub checks the ids against its history.
 */
export const StartProofV1Schema = z
  .strictObject(startProofShape)
  .check(
    z.refine(startWitnessHolds, { message: 'the witness is null only for an empty history and no automated message is older' }),
    z.refine(startCountsHold, { message: 'counts within the covered history; automated ids ascending; the pass counts its last 30' }),
  );
export type StartProofV1 = z.infer<typeof StartProofV1Schema>;

/** The wire's proof belongs to this conversation; an optional top-level count repeats its personalCount. */
export function hiStartProofMatches(fields: { readonly startProof?: StartProofV1 | undefined; readonly personalMessageCount?: number | undefined }, conversationRef: string): boolean {
  return fields.startProof === undefined || (fields.startProof.groupId === conversationRef
    && (fields.personalMessageCount === undefined || fields.personalMessageCount === fields.startProof.personalCount));
}

export function hasHiStartFields(fields: { readonly startProof?: unknown; readonly personalMessageCount?: unknown; readonly fanAvatarUrl?: unknown }): boolean {
  return fields.startProof !== undefined || fields.personalMessageCount !== undefined || fields.fanAvatarUrl !== undefined;
}

/**
 * The 2026-10-20 audit, row 6: on an OnlyFans page Hi carries the count of the window's personal messages alone (no
 * proof, no avatar) — the hub counts it instead of its archive, which has no mark of a mass message.
 */
export function hasOnlyPersonalCount(fields: { readonly startProof?: unknown; readonly personalMessageCount?: unknown; readonly fanAvatarUrl?: unknown }): boolean {
  return fields.personalMessageCount !== undefined && fields.startProof === undefined && fields.fanAvatarUrl === undefined;
}
