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
//
// An event page may be unloaded between `meta` and the person's click: the
// links and the dedupe keys (ids only) are a snapshot the composition root
// keeps in storage.session (`onChange` says when), restored on wake.

import { FeatureIdSchema, SurfaceSchema, type FeatureId, type Surface } from '@cg/contracts/features';
import { GenerationRefSchema, UuidSchema, type NativeId, type Uuid } from '@cg/contracts/primitives';
import { AcceptanceEventSchema, type AcceptanceEvent } from '@cg/contracts/telemetry';

/** Links kept in memory (TL-008). */
export const ACCEPTANCE_LINKS_MAX = 50;
/** Remembered `shown`/`sent` keys, for deduplication. */
const DEDUPE_KEYS_MAX = 2000;
const DEDUPE_KEY = /^(?:shown|sent)\|[A-Za-z0-9|-]{1,160}$/;
const PAGE_LABEL_MAX = 120;

export interface GenerationLink {
  readonly opId: Uuid;
  /** `meta.requestId`. */
  readonly generationRef: Uuid;
  readonly feature: FeatureId;
  readonly surface: Surface;
  /** The hub page label of the binding. */
  readonly pageLabel: string;
}

/**
 * What a generation's link is made of: an operation's view (an `OpView` is one), or what a «Новые» card's draft kept of
 * its generation once the operation's result has expired (it lasts 30 minutes, the draft 7 days).
 */
export interface LinkSource {
  readonly generationRef?: string | undefined;
  readonly feature: FeatureId;
  readonly surface: Surface;
  readonly target: { readonly binding: { readonly pageLabel: string } };
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
  /** The links or the dedupe keys changed: time to save `snapshot()` (storage.session). Must not throw; it is guarded anyway. */
  readonly onChange?: () => void;
}

/** What survives an event-page restart: ids, labels and dedupe keys, never text. */
export interface AcceptanceSnapshot {
  readonly v: 1;
  readonly links: readonly GenerationLink[];
  readonly seen: readonly string[];
}

function readLink(value: unknown): GenerationLink | null {
  if (value === null || typeof value !== 'object') return null;
  const raw = value as Partial<Record<keyof GenerationLink, unknown>>;
  const opId = UuidSchema.safeParse(raw.opId);
  const generationRef = GenerationRefSchema.safeParse(raw.generationRef);
  const feature = FeatureIdSchema.safeParse(raw.feature);
  const surface = SurfaceSchema.safeParse(raw.surface);
  if (!opId.success || !generationRef.success || !feature.success || !surface.success) return null;
  if (typeof raw.pageLabel !== 'string' || raw.pageLabel.length === 0 || raw.pageLabel.length > PAGE_LABEL_MAX) return null;
  return { opId: opId.data, generationRef: generationRef.data, feature: feature.data, surface: surface.data, pageLabel: raw.pageLabel };
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
    this.put(link);
    this.changed();
  }

  private put(link: GenerationLink): void {
    this.links.delete(link.opId);
    this.links.set(link.opId, link);
    while (this.links.size > this.capacity) {
      const oldest = this.links.keys().next().value;
      if (oldest === undefined) break;
      this.links.delete(oldest);
    }
  }

  private remember(key: string): void {
    this.seen.add(key);
    if (this.seen.size > DEDUPE_KEYS_MAX) {
      const oldest = this.seen.values().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
  }

  private changed(): void {
    try {
      this.deps.onChange?.();
    } catch {
      // Saving is the composition root's business; a failure never breaks an event.
    }
  }

  /** The links (oldest first) and the dedupe keys, for storage.session. */
  snapshot(): AcceptanceSnapshot {
    return { v: 1, links: [...this.links.values()].map((link) => ({ ...link })), seen: [...this.seen] };
  }

  /**
   * After an event-page restart: what was stored comes back under what was
   * linked since (newer wins); junk is skipped. Returns the links restored.
   */
  restore(value: unknown): number {
    if (value === null || typeof value !== 'object') return 0;
    const stored = value as { links?: unknown; seen?: unknown };
    const live = [...this.links.values()];
    const liveSeen = [...this.seen];
    this.links.clear();
    this.seen.clear();
    let restored = 0;
    if (Array.isArray(stored.links)) {
      for (const raw of (stored.links as unknown[]).slice(-this.capacity)) {
        const link = readLink(raw);
        if (link === null) continue;
        this.put(link);
        restored += 1;
      }
    }
    if (Array.isArray(stored.seen)) {
      for (const key of (stored.seen as unknown[]).slice(-DEDUPE_KEYS_MAX)) if (typeof key === 'string' && DEDUPE_KEY.test(key)) this.remember(key);
    }
    for (const link of live) this.put(link);
    for (const key of liveSeen) this.remember(key);
    return restored;
  }

  linkOf(opId: string): GenerationLink | null {
    return this.links.get(opId) ?? null;
  }

  forget(opId: string): void {
    if (this.links.delete(opId)) this.changed();
  }

  /** Sign-out and consent revocation drop everything. */
  clear(): void {
    this.links.clear();
    this.seen.clear();
    this.changed();
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
      this.remember(dedupeKey);
      this.changed();
    }
    return { ok: true, event: parsed.data };
  }
}
