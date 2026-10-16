// The full identity of a generation request (architecture.md §5.1
// GenerationIdentity.requestDigest, §7 «Кэш результата», AI-128): hub origin,
// user and sign-in epoch, page and binding revision, fan and its
// conversation (when it is not the fan: on Fansly the group), persona
// definition, feature and recap mode, window, tone, Split, the Fix draft
// digest, the archive head, the freshness proof (1.15.0, R20: its
// fingerprint) and every other request parameter. Two clicks with equal
// identities are the same request: the second reopens the first result;
// anything different is a new generation. The cache never crosses users
// because the user and the sign-in epoch are part of the key.

import { type OpFeature, type Surface, type Tone } from '@cg/contracts/features';
import { chatKeyOf, type SessionIdentity } from '@cg/contracts/ids';
import { type CoverageProof, type StartOp } from '@cg/contracts/ops';
import { type FreshnessCheckpoint } from '@cg/contracts/send';

import { conversationOf } from './conversation';
import { canonicalJson, digestHex, stableDigest } from './digest';

/** The checkpoint as freshness sees it: everything but the moment it was taken. */
export type CheckpointIdentity = Omit<FreshnessCheckpoint, 'observedAt'>;

export function checkpointIdentity(checkpoint: FreshnessCheckpoint): CheckpointIdentity {
  const { observedAt: _observedAt, ...rest } = checkpoint;
  return rest;
}

/** Two checkpoints say the same about the chat (the same counters, epochs and known ids). */
export function checkpointEquivalent(a: FreshnessCheckpoint, b: FreshnessCheckpoint): boolean {
  return canonicalJson(checkpointIdentity(a)) === canonicalJson(checkpointIdentity(b));
}

export interface RequestIdentity {
  readonly hubOrigin: string;
  readonly userId: number;
  readonly signInEpoch: number;
  readonly pageId: number;
  readonly bindingRevision: number;
  readonly host: string;
  readonly hostAccountId: string;
  readonly fanRef: string;
  /**
   * The conversation when it is not the fan (1.15.0: on Fansly the group id — the same fan in another conversation is
   * another request). Absent on OnlyFans, so a ChatSpace key is the one it was before.
   */
  readonly conversationRef?: string;
  readonly personaKey: string;
  readonly personaDefinitionId: string;
  readonly feature: OpFeature;
  readonly surface: Surface;
  readonly recapMode: 'full' | 'short' | null;
  readonly window: number;
  readonly tone: Tone | null;
  readonly split: boolean;
  readonly variantCount: number | null;
  readonly fixDraftDigest: string | null;
  /** The hub archive head the caller knew (feed), when it knew one. */
  readonly archiveHead: string | null;
  /** The newest message id of the fresh tail sent with the request (dock), when there was one. */
  readonly freshHead: string | null;
  readonly freshDigest: string | null;
  readonly coachDigest: string | null;
  readonly checkpoint: CheckpointIdentity | null;
  /**
   * 1.15.0 (R20 §9.1): the fingerprint of the start's freshness proof (`proofDigestOf`) — the same window, deletions,
   * completeness and tail are the same request, so a reopened result is read against the proof it was made with;
   * anything else is a new generation. Absent without a proof, so a ChatSpace key is the one it was before.
   */
  readonly proofDigest?: string;
  /** Extra parameters of an injected site driver, as a fingerprint only. */
  readonly parametersDigest?: string;
}

export interface IdentityInputs {
  readonly session: SessionIdentity;
  readonly start: Omit<StartOp, 'feature'> & { readonly feature: OpFeature; readonly parametersDigest?: string };
  readonly persona: { readonly key: string; readonly definitionId: string };
  readonly archiveHead: string | null;
}

const recapModeOf = (feature: OpFeature): RequestIdentity['recapMode'] => (feature === 'recap' ? 'full' : feature === 'recap-short' ? 'short' : null);

/**
 * The proof as the request key sees it: everything but the moment it was taken (`takenAt`), as a checkpoint is keyed
 * without `observedAt` — a later click on the same observation is the same request. The tail's texts are inside the
 * fingerprint, never in the key.
 */
export function proofDigestOf(proof: CoverageProof): string {
  const { takenAt: _takenAt, ...rest } = proof;
  return stableDigest(rest);
}

export function requestIdentityOf({ session, start, persona, archiveHead }: IdentityInputs): RequestIdentity {
  const fresh = start.fresh;
  const lastFresh = fresh === undefined ? undefined : fresh.messages[fresh.messages.length - 1];
  return {
    hubOrigin: session.hubOrigin,
    userId: session.userId,
    signInEpoch: session.epoch,
    pageId: start.target.binding.pageId,
    bindingRevision: start.target.binding.bindingRevision,
    host: start.target.chat.host,
    hostAccountId: start.target.chat.hostAccountId,
    fanRef: start.target.fanRef,
    ...conversationOf(start.target.fanRef, start.target.conversationRef),
    personaKey: persona.key,
    personaDefinitionId: persona.definitionId,
    feature: start.feature,
    ...(start.parametersDigest === undefined ? {} : { parametersDigest: start.parametersDigest }),
    surface: start.surface,
    recapMode: recapModeOf(start.feature),
    window: start.window,
    tone: start.tone,
    split: start.split,
    variantCount: start.variantCount ?? null,
    fixDraftDigest: start.draft === undefined ? null : start.draft.digest,
    archiveHead,
    freshHead: lastFresh === undefined ? null : lastFresh.platformMessageId,
    freshDigest: fresh === undefined ? null : stableDigest(fresh.messages.map((m) => [m.platformMessageId, m.direction, m.text])),
    coachDigest: start.coach === undefined ? null : stableDigest(start.coach),
    checkpoint: start.checkpoint === undefined ? null : checkpointIdentity(start.checkpoint),
    ...(start.proof === undefined ? {} : { proofDigest: proofDigestOf(start.proof) }),
  };
}

/** The cache key: the canonical form itself (exact, no collisions). */
export function requestKeyOf(identity: RequestIdentity): string {
  return canonicalJson(identity);
}

/** GenerationIdentity.requestDigest: the key's fingerprint. */
export function requestDigestOf(identity: RequestIdentity): string {
  return digestHex(requestKeyOf(identity));
}

/** The chat a start works on, as the one string key of the extension. */
export function chatKeyOfStart(start: Pick<StartOp, 'target'>): ReturnType<typeof chatKeyOf> {
  return chatKeyOf(start.target.chat);
}
