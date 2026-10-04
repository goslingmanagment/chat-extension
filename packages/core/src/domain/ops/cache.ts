// The result cache and the «устарело» marker (architecture.md §7 «Кэш
// результата», AI-128, RB-018). A repeated click with the same request
// identity reopens the previous result with its time; different parameters,
// Regenerate and Refresh make a new generation. Results live 30 minutes. The
// last run of a request owns its slot: an older run finishing later never
// replaces a newer one. A new fan message marks a result stale: the dock may
// still insert it, a preview holds its sends (§6.7.5).

import { type IncomingFact } from '@cg/contracts/host';
import { chatKeyOf, type ChatKey } from '@cg/contracts/ids';
import { OP_LIMITS } from '@cg/contracts/limits';
import { type OpView } from '@cg/contracts/ops';
import { type IsoTimestamp } from '@cg/contracts/primitives';

export interface CachedResult {
  readonly requestKey: string;
  readonly opId: string;
  readonly startedAt: number;
  readonly endedAt: number;
}

export class ResultCache {
  private readonly slots = new Map<string, CachedResult>();

  constructor(private readonly ttlMs: number = OP_LIMITS.resultTtlMs) {}

  /** Keeps the newest run per request (RB-018); returns whether `entry` now owns the slot. */
  remember(entry: CachedResult): boolean {
    const current = this.slots.get(entry.requestKey);
    if (current !== undefined && current.opId !== entry.opId && current.startedAt > entry.startedAt) return false;
    this.slots.set(entry.requestKey, entry);
    return true;
  }

  /** The live result for a request key; an expired one is dropped. */
  lookup(requestKey: string, now: number): CachedResult | null {
    const entry = this.slots.get(requestKey);
    if (entry === undefined) return null;
    if (now - entry.endedAt >= this.ttlMs) {
      this.slots.delete(requestKey);
      return null;
    }
    return entry;
  }

  forgetOp(opId: string): void {
    for (const [key, entry] of this.slots) if (entry.opId === opId) this.slots.delete(key);
  }

  clear(): void {
    this.slots.clear();
  }

  get size(): number {
    return this.slots.size;
  }
}

/** Whether a stored result is past its 30 minutes. */
export function resultExpired(view: Pick<OpView, 'endedAt'>, now: number, ttlMs: number = OP_LIMITS.resultTtlMs): boolean {
  return view.endedAt !== undefined && now - view.endedAt >= ttlMs;
}

/** What a generation already knew about its chat: messages that cannot make it stale. */
export interface KnownMessages {
  readonly chatKey: ChatKey;
  /** When the operation was admitted (background clock). */
  readonly startedAt: number;
  readonly ids: readonly string[];
}

export function knownMessageIds(view: Pick<OpView, 'servedContext'>, extra: readonly string[]): string[] {
  const ids = new Set(extra);
  const served = view.servedContext;
  if (served !== undefined && served !== null) {
    if (served.servedHead !== null) ids.add(served.servedHead.messageRef);
    for (const known of served.knownFanMessages ?? []) if (known.state === 'included') ids.add(known.id);
  }
  return [...ids];
}

/**
 * The stale marker a fan's message puts on a result (§6.7.5): only a real,
 * non-automatic fan message on the same chat, received after the operation
 * started, that the generation did not already include.
 */
export function staleMarkFor(known: KnownMessages, fact: IncomingFact, receivedAt: number): { readonly reason: 'fan-wrote'; readonly at: IsoTimestamp | null } | null {
  if (!fact.fromFan || fact.automatic) return null;
  if (chatKeyOf({ host: fact.host, hostAccountId: fact.hostAccountId, platformFanId: fact.platformFanId }) !== known.chatKey) return null;
  if (receivedAt < known.startedAt) return null;
  if (known.ids.includes(fact.platformMessageId)) return null;
  return { reason: 'fan-wrote', at: fact.sentAt };
}
