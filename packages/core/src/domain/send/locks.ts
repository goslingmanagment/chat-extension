// Locks of the preview send (architecture.md §6.7.7 «Блокировки», X8-08):
// the background lets attempts through one at a time per (hubOrigin, pageId,
// platform, fanRef) — for Spenders, «Новые», every tab and window of this
// instance — and one generationRef + variant + part + preview revision can
// never make two attempts, however many clicks arrive. A lock is held while
// the attempt keeps the hub custody (preparing, nativeEnqueued,
// nativeAccepted, uncertain): an uncertain send holds its fan until resolved.

import { SEND_ATTEMPT_CUSTODY_STATES, type SendAttemptState } from '@cg/contracts/send-rules';
import { type SendLockKey } from '@cg/contracts/send';

export interface AttemptKeyParts {
  readonly generationRef: string;
  readonly variant: number;
  readonly partIndex: number;
  readonly previewRevision: number;
}

/** One attempt per generation part and preview revision (a double click is one attempt). */
export function attemptKeyOf(parts: AttemptKeyParts): string {
  return `${parts.generationRef}|${parts.variant}|${parts.partIndex}|${parts.previewRevision}`;
}

/** States in which an attempt keeps its fan locked. */
export function holdsLock(state: SendAttemptState): boolean {
  return (SEND_ATTEMPT_CUSTODY_STATES as readonly SendAttemptState[]).includes(state);
}

export class SendLockTable {
  private readonly holders = new Map<SendLockKey, string>();

  holder(key: SendLockKey): string | null {
    return this.holders.get(key) ?? null;
  }

  /** Takes the lock for `attemptId`; true also when it already holds it. */
  acquire(key: SendLockKey, attemptId: string): boolean {
    const current = this.holders.get(key);
    if (current !== undefined && current !== attemptId) return false;
    this.holders.set(key, attemptId);
    return true;
  }

  /** Releases only the holder's own lock. */
  release(key: SendLockKey, attemptId: string): void {
    if (this.holders.get(key) === attemptId) this.holders.delete(key);
  }

  get size(): number {
    return this.holders.size;
  }

  clear(): void {
    this.holders.clear();
  }
}
