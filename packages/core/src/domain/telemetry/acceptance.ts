// `ai_acceptance` lifecycle events (architecture.md §9.6; TL-001…TL-008,
// TL-005, TL-006). The background links every generation when its `meta`
// arrives (opId → generationRef = meta.requestId, feature, surface, page)
// and keeps the last 50 links (TL-008); every later event of that operation
// is built from the link, so it carries the generation's identity even when
// the tab knows only the opId. No text ever: positions, ids and flags.
//
// - `shown` — the result was really visible (once per part/variant);
// - `copied` — after a successful clipboard write, Review and Recap and
//   Coach drafts included (Б14, TL-006);
// - `inserted` — after an `applied` insert receipt, Fix's replacement
//   included (TL-006);
// - `sent` — only with proof: receipt and echo with the same platform
//   message id (§6.6 `composer`, §6.7.6 `preview`), once per message id;
//   `edited` by draft revision and provenance, never by text similarity.
//
// Each event gets its `clientEventId` once, here; the queue keeps it across
// retries and the hub deduplicates by it.

import { type FeatureId, type Surface } from '@cg/contracts/features';
import { type NativeId, type Uuid } from '@cg/contracts/primitives';
import { AcceptanceEventSchema, type AcceptanceEvent } from '@cg/contracts/telemetry';

/** Links kept in memory (TL-008). */
export const ACCEPTANCE_LINKS_MAX = 50;
/** Remembered `shown`/`sent` keys, for deduplication. */
const DEDUPE_KEYS_MAX = 2000;

export interface GenerationLink {
  readonly opId: Uuid;
  /** `meta.requestId`. */
  readonly generationRef: Uuid;
  readonly feature: FeatureId;
  readonly surface: Surface;
  /** The hub page label of the binding. */
  readonly pageLabel: string;
}

/** Which part of a result: `part` of Split (0–9), `variant` of Hi or a Coach draft (0–2). */
export interface PartPosition {
  readonly part?: number;
  readonly variant?: number;
}

export type SentProof =
  | { readonly via: 'composer'; readonly platformMessageId: NativeId; readonly edited: boolean }
  | { readonly via: 'preview'; readonly platformMessageId: NativeId; readonly attemptId: Uuid; readonly edited?: boolean };

export type AcceptanceOutcome =
  | { readonly ok: true; readonly event: AcceptanceEvent }
  /** No link for this operation (never linked, evicted, or the background restarted): logged (LG-015). */
  | { readonly ok: false; readonly reason: 'unlinked' }
  /** Already reported: a second `shown` of the same part, a second `sent` of the same message. */
  | { readonly ok: false; readonly reason: 'duplicate' }
  /** The event failed its schema (a part out of range, a bad id). */
  | { readonly ok: false; readonly reason: 'invalid' };

export interface AcceptanceDeps {
  readonly now: () => number;
  readonly uuid: () => string;
  readonly capacity?: number;
}

export class AcceptanceTracker {
  private readonly links = new Map<string, GenerationLink>();
  private readonly seen = new Set<string>();
  private readonly capacity: number;

  constructor(private readonly deps: AcceptanceDeps) {
    this.capacity = Math.max(1, deps.capacity ?? ACCEPTANCE_LINKS_MAX);
  }

  /** On `meta`: remembers the generation of the operation (the newest 50). */
  link(link: GenerationLink): void {
    this.links.delete(link.opId);
    this.links.set(link.opId, link);
    while (this.links.size > this.capacity) {
      const oldest = this.links.keys().next().value;
      if (oldest === undefined) break;
      this.links.delete(oldest);
    }
  }

  linkOf(opId: string): GenerationLink | null {
    return this.links.get(opId) ?? null;
  }

  forget(opId: string): void {
    this.links.delete(opId);
  }

  /** Sign-out and consent revocation drop everything. */
  clear(): void {
    this.links.clear();
    this.seen.clear();
  }

  get size(): number {
    return this.links.size;
  }

  shown(opId: string, position: PartPosition = {}): AcceptanceOutcome {
    return this.build(opId, 'shown', position, null, `shown|${opId}|${position.variant ?? '-'}|${position.part ?? '-'}`);
  }

  copied(opId: string, position: PartPosition = {}): AcceptanceOutcome {
    return this.build(opId, 'copied', position, null, null);
  }

  inserted(opId: string, position: PartPosition = {}): AcceptanceOutcome {
    return this.build(opId, 'inserted', position, null, null);
  }

  sent(opId: string, position: PartPosition, proof: SentProof): AcceptanceOutcome {
    return this.build(opId, 'sent', position, proof, `sent|${proof.platformMessageId}`);
  }

  private build(opId: string, lifecycle: AcceptanceEvent['payload']['lifecycle'], position: PartPosition, proof: SentProof | null, dedupeKey: string | null): AcceptanceOutcome {
    const link = this.links.get(opId);
    if (link === undefined) return { ok: false, reason: 'unlinked' };
    if (dedupeKey !== null && this.seen.has(dedupeKey)) return { ok: false, reason: 'duplicate' };
    const payload: Record<string, unknown> = {
      generationRef: link.generationRef,
      lifecycle,
      opId: link.opId,
      feature: link.feature,
      surface: link.surface,
    };
    if (position.part !== undefined) payload['part'] = position.part;
    if (position.variant !== undefined) payload['variant'] = position.variant;
    if (proof !== null) {
      payload['via'] = proof.via;
      payload['platformMessageId'] = proof.platformMessageId;
      if (proof.via === 'preview') payload['attemptId'] = proof.attemptId;
      if (proof.edited !== undefined) payload['edited'] = proof.edited;
    }
    let observedAt: string;
    try {
      observedAt = new Date(this.deps.now()).toISOString();
    } catch {
      return { ok: false, reason: 'invalid' };
    }
    const parsed = AcceptanceEventSchema.safeParse({
      clientEventId: this.deps.uuid(),
      kind: 'ai_acceptance',
      observedAt,
      pageLabel: link.pageLabel,
      payload,
    });
    if (!parsed.success) return { ok: false, reason: 'invalid' };
    if (dedupeKey !== null) {
      this.seen.add(dedupeKey);
      if (this.seen.size > DEDUPE_KEYS_MAX) {
        const oldest = this.seen.values().next().value;
        if (oldest !== undefined) this.seen.delete(oldest);
      }
    }
    return { ok: true, event: parsed.data };
  }
}
