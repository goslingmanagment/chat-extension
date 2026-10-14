// Local recap slots (AI-066; architecture.md §7 «Локальные слоты — только
// копии с id и ревизией общего артефакта», §8.5, D-31). Recaps are shared:
// one full and one short recap per page, fan and persona for every granted
// chatter, kept by the hub (H-13). What the tab holds is a copy of that
// shared artifact — its id (the generation ref) and revision (when it was
// generated) travel with the text — so the sheet opens at once and a newer
// shared recap replaces an older copy. There is no private recap and no
// local-only recap: a copy never outlives or overrides the hub's. The two
// lengths never overwrite each other. Memory only; when the store is full
// the ten oldest entries go.

import { type CoverageLevel } from '@cg/contracts/ops';
import { type RecapLength } from '@cg/contracts/vm';

import { type RecapBlock } from '../output/recap';

export interface RecapSlotLimits {
  readonly maxEntries: number;
  readonly evictBatch: number;
}

export const RECAP_SLOT_LIMITS: RecapSlotLimits = { maxEntries: 60, evictBatch: 10 };

/** Whose recap: the hub, the page, the fan and the persona definition it was written under. */
export interface RecapSlotKey {
  readonly hubOrigin: string;
  readonly pageId: number;
  readonly fanRef: string;
  /** R20 F6b: the conversation, only when it is not the fan (on Fansly the group); the hub's recaps are read by it. */
  readonly conversationRef?: string;
  readonly personaDefinitionId: string;
}

export interface RecapCopy {
  readonly length: RecapLength;
  /** The shared artifact's id: its generation ref (`meta.requestId`). */
  readonly id: string;
  /** The shared artifact's revision: when it was generated (ISO). */
  readonly revision: string;
  /** Our own handle of this copy for the UI (a UUID): never sent anywhere. */
  readonly localId: string;
  /** The finished text, prepared once. */
  readonly markdown: string;
  /** Headed blocks of a full recap; null — shown as one text. */
  readonly blocks: readonly RecapBlock[] | null;
  readonly coverage: { readonly level: CoverageLevel; readonly requested: number | null; readonly served: number | null };
  /** The dossier holds this recap (H-5); null — unknown; always null for the short one. */
  readonly savedToProfile: boolean | null;
  /** Where the copy came from: read from the hub, or generated in this tab just now. */
  readonly source: 'hub' | 'generated';
  /** The operation that generated it in this tab; null for a copy read from the hub. */
  readonly opId: string | null;
  readonly storedAt: number;
}

const slotKey = (key: RecapSlotKey, length: RecapLength): string => [key.hubOrigin, key.pageId, key.fanRef, key.conversationRef, key.personaDefinitionId, length].join('\u0000');

/**
 * How long a recap this tab generated holds its slot against another
 * artifact the hub lists: the hub may not list ours yet. After that the
 * hub's listing is the truth (a copy never overrides the hub's).
 */
export const GENERATED_GRACE_MS = 5 * 60_000;

type Comparable = Pick<RecapCopy, 'id' | 'revision'> & Partial<Pick<RecapCopy, 'source' | 'storedAt'>>;

/**
 * Whether `incoming` takes the slot `current` holds. The same artifact
 * always does (its dossier state or text was read again). Revisions order
 * only two copies read from the hub — both stamps are the hub's. A recap
 * this tab has just generated is stamped by this computer's clock, which
 * may be minutes off the hub's: it is the newest by the order of events and
 * takes the slot whatever the stamps say; while it is fresh, a different
 * artifact read from the hub (an older one — ours is not listed yet) does
 * not push it out.
 */
export function supersedes(incoming: Comparable, current: Comparable): boolean {
  if (incoming.id === current.id) return true;
  if (incoming.source === 'generated') return true;
  if (current.source === 'generated') return (incoming.storedAt ?? 0) - (current.storedAt ?? 0) >= GENERATED_GRACE_MS;
  const a = Date.parse(incoming.revision);
  const b = Date.parse(current.revision);
  return Number.isNaN(a) || Number.isNaN(b) ? true : a >= b;
}

export class RecapSlots {
  /** Insertion order = age: the oldest entry first. */
  private readonly entries = new Map<string, RecapCopy>();

  constructor(private readonly limits: RecapSlotLimits = RECAP_SLOT_LIMITS) {}

  /** Stores a copy unless the slot already holds a newer revision; returns what the slot holds after. */
  put(key: RecapSlotKey, copy: RecapCopy): RecapCopy {
    const id = slotKey(key, copy.length);
    const current = this.entries.get(id);
    if (current !== undefined && !supersedes(copy, current)) return current;
    // The same artifact read again keeps the handle the UI already holds.
    const next = current !== undefined && current.id === copy.id ? { ...copy, localId: current.localId, opId: copy.opId ?? current.opId } : copy;
    this.entries.delete(id);
    this.entries.set(id, next);
    if (this.entries.size > this.limits.maxEntries) {
      for (const victim of [...this.entries.keys()].slice(0, this.limits.evictBatch)) this.entries.delete(victim);
    }
    return next;
  }

  get(key: RecapSlotKey, length: RecapLength): RecapCopy | null {
    return this.entries.get(slotKey(key, length)) ?? null;
  }

  both(key: RecapSlotKey): { readonly short: RecapCopy | null; readonly full: RecapCopy | null } {
    return { short: this.get(key, 'short'), full: this.get(key, 'full') };
  }

  /** The copy shown under this local handle, whichever slot it is in. */
  byLocalId(localId: string): RecapCopy | null {
    for (const copy of this.entries.values()) if (copy.localId === localId) return copy;
    return null;
  }

  /** The dossier state of a full copy became known. */
  markSaved(key: RecapSlotKey, id: string, saved: boolean): RecapCopy | null {
    const current = this.get(key, 'full');
    if (current === null || current.id !== id) return null;
    const next = { ...current, savedToProfile: saved };
    this.entries.set(slotKey(key, 'full'), next);
    return next;
  }

  /** The hub says the slot is empty: the copy goes (a copy never outlives the shared artifact). */
  drop(key: RecapSlotKey, length: RecapLength): void {
    this.entries.delete(slotKey(key, length));
  }

  /** A sign-out or a persona change clears what belonged to it (all, without a filter). */
  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

/**
 * AI-065 «Открыть последний»: the fresher of the two slots; a tie and
 * full-only both give the full one (the durable primary recap).
 */
export function latestLength(slots: { readonly short: Pick<RecapCopy, 'revision'> | null; readonly full: Pick<RecapCopy, 'revision'> | null }): RecapLength | null {
  const { short, full } = slots;
  if (full !== null && short !== null) return Date.parse(short.revision) > Date.parse(full.revision) ? 'short' : 'full';
  if (full !== null) return 'full';
  return short !== null ? 'short' : null;
}
