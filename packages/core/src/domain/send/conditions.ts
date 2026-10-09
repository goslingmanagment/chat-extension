// The send conditions the background checks before it journals a click and
// asks the hub (architecture.md §6.7.4, conditions 1–4 and 14): the human
// and the part, the frozen identity, the owner switch and the verified
// receipt profile, the X8 fuse of this browser (decision X25), and freshness. MAIN checks the page conditions (5–13)
// again in the same synchronous step as the queue call; the hub checks the
// flag, rights, rate, lease and other sends atomically on `dispatch` (3, 15).

import { type CgCode } from '@cg/contracts/errors';
import { SENDABLE_FEATURES, type FeatureId, type Surface } from '@cg/contracts/features';
import { type Target } from '@cg/contracts/ids';
import { type OpResult, type OpState, type ServedContext } from '@cg/contracts/ops';
import { partInGroup, type FreshnessCheckpoint } from '@cg/contracts/send';
import { type SendBegin } from '@cg/contracts/tab-messages';

import { canonicalJson } from '../ops/digest';
import { checkpointEquivalent } from '../ops/identity';
import { servedContextHold } from './freshness';

/** What the background knows about the operation a send comes from. */
export interface OpForSend {
  readonly opId: string;
  readonly feature: FeatureId;
  readonly surface: Surface;
  readonly state: OpState;
  readonly target: Target;
  readonly generationRef: string | null;
  readonly result: OpResult | null;
  readonly checkpoint: FreshnessCheckpoint | undefined;
  readonly servedContext: ServedContext | null | undefined;
  /** A fan message arrived after the generation started (§6.7.5). */
  readonly stale: boolean;
  readonly personaDefinitionId: string;
  readonly session: { readonly hubOrigin: string; readonly userId: number; readonly epoch: number };
}

export interface SendGate {
  /** The current sign-in; null — signed out. */
  readonly session: { readonly hubOrigin: string; readonly userId: number; readonly epoch: number } | null;
  /** The persona definition assigned to the page now. */
  readonly personaDefinitionId: string | null;
  /** The page's binding revision in the current bootstrap; null — the page is not there. */
  readonly bindingRevision: number | null;
  /** `previewSend` usable on the page (flag, page feature, capability). */
  readonly previewSend: boolean;
  /** `newcomers` usable on the page (greetings only). */
  readonly newcomers: boolean;
  /** Verified profiles of the send path and receipt; none — X8 is off whatever the flags say. */
  readonly receiptProfiles: number;
  /** The X8 fuse holds on the tab's ChatSpace build (decision X25); absent — not checked. */
  readonly fused?: boolean;
}

/** The surface a purpose belongs to: a greeting from «Новые», a reply from a Spenders preview. */
export const PURPOSE_SURFACE = { greeting: 'newcomers', 'preview-reply': 'preview' } as const satisfies Record<SendBegin['purpose'], Surface>;

function partsOf(result: OpResult | null, variant: number): readonly string[] | null {
  if (result === null) return null;
  if (result.kind === 'parts') return variant === 0 ? result.parts : null;
  if (result.kind === 'variants') return result.variants[variant] ?? null;
  return null;
}

const sameSession = (a: OpForSend['session'], b: NonNullable<SendGate['session']>): boolean => a.hubOrigin === b.hubOrigin && a.userId === b.userId && a.epoch === b.epoch;

/** The first failed condition, in the table's order; null — ask the hub. */
export function beginCondition(begin: SendBegin, op: OpForSend | null, gate: SendGate): CgCode | null {
  // 1 — a finished draft of a sendable feature, from the matching surface, an existing part.
  if (op === null || op.state !== 'done') return 'CG-SEND-PART';
  if (!(SENDABLE_FEATURES as readonly FeatureId[]).includes(op.feature) || op.surface !== PURPOSE_SURFACE[begin.purpose]) return 'CG-SEND-PART';
  const parts = partsOf(op.result, begin.group.variant);
  if (parts === null || parts.length !== begin.group.partCount || !partInGroup(begin.part, begin.group)) return 'CG-SEND-PART';
  // 2 — the frozen identity: generation, target, sign-in, persona.
  if (op.generationRef !== begin.group.generationRef) return 'CG-CONTEXT-CHANGED';
  if (canonicalJson(op.target) !== canonicalJson(begin.target)) return 'CG-CONTEXT-CHANGED';
  if (gate.session === null || !sameSession(op.session, gate.session)) return 'CG-CONTEXT-CHANGED';
  if (gate.personaDefinitionId !== op.personaDefinitionId) return 'CG-CONTEXT-CHANGED';
  if (gate.bindingRevision !== op.target.binding.bindingRevision) return 'CG-CONTEXT-CHANGED';
  // 3, 4 — the owner switch and a verified receipt profile (the hub re-checks the flag on dispatch).
  if (!gate.previewSend || (begin.purpose === 'greeting' && !gate.newcomers)) return 'CG-SEND-OFF';
  if (gate.receiptProfiles === 0) return 'CG-SEND-RECEIPT';
  // 4 — the fuse: after a send ChatSpace did not behave as checked, X8 is off in this browser for this build.
  if (gate.fused === true) return 'CG-SEND-FUSE';
  // 14 — freshness: the operation's own checkpoint, unchanged, nothing new since, the served context.
  if (op.checkpoint === undefined || !checkpointEquivalent(op.checkpoint, begin.checkpoint)) return 'CG-SEND-FRESHNESS';
  if (op.stale) return 'CG-SEND-STALE';
  return servedContextHold(op.checkpoint, op.servedContext);
}
