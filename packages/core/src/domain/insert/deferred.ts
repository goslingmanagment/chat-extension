// The lifecycle of «Открыть и вставить» (architecture.md §6.5, А7, UI-029,
// NEW-01): one click makes one navigation with one deferred insert of one
// chosen part, valid until `limits.navInsertTimeoutSec`. Nothing is inserted
// by itself — a result never auto-inserts into a preview's chat. It is
// canceled by another human navigation, another insert intent, the preview
// closing before the navigation, a sign-out or a persona change, an
// ambiguous composer, or its deadline («Чат не готов. Откройте его и
// вставьте результат», CG-NAV-TIMEOUT); the generation itself is kept. A new
// attempt is only a new click.

import { type CgCode } from '@cg/contracts/errors';
import { type NavigationReceipt } from '@cg/contracts/host';
import { type ChatRef, type PartRef } from '@cg/contracts/ids';

export type DeferredCancelReason = 'human-navigation' | 'other-insert' | 'preview-closed' | 'session' | 'persona' | 'ambiguous-composer';

export interface DeferredInsert {
  readonly navigationId: string;
  readonly insertIntentId: string;
  readonly opId: string;
  readonly part: PartRef;
  readonly chat: ChatRef;
  readonly expiresAt: number;
}

export type DeferredOutcome =
  | { readonly kind: 'inserted'; readonly insert: DeferredInsert; readonly draftRevision: number; readonly draftDigest: string }
  /** The chat opened but holds the person's text: ask, then insert normally on the read revision (§6.5 п. 4). */
  | { readonly kind: 'needs-confirm'; readonly insert: DeferredInsert }
  /** The navigation or the insert did not happen, or its outcome is not known; never repeated by itself. */
  | { readonly kind: 'failed'; readonly insert: DeferredInsert; readonly code: CgCode; readonly uncertain: boolean }
  | { readonly kind: 'canceled'; readonly insert: DeferredInsert; readonly code: CgCode; readonly reason: DeferredCancelReason | 'expired' };

/** At most one pending «Открыть и вставить» per tab: a new one replaces (cancels) the old. */
export class DeferredInsertSlot {
  private current: DeferredInsert | null = null;

  /** Starts a new deferred insert; returns the one it displaced, canceled as `other-insert`. */
  begin(insert: DeferredInsert): DeferredOutcome | null {
    const displaced = this.current === null ? null : this.cancelOutcome(this.current, 'other-insert');
    this.current = insert;
    return displaced;
  }

  pending(): DeferredInsert | null {
    return this.current;
  }

  /** Cancels the pending insert for a reason of §6.5 «Отмена». */
  cancel(reason: DeferredCancelReason): DeferredOutcome | null {
    if (this.current === null) return null;
    const outcome = this.cancelOutcome(this.current, reason);
    this.current = null;
    return outcome;
  }

  /** The deadline passed before the target's composer was ready. */
  expire(now: number): DeferredOutcome | null {
    if (this.current === null || now < this.current.expiresAt) return null;
    const insert = this.current;
    this.current = null;
    return { kind: 'canceled', insert, code: 'CG-NAV-TIMEOUT', reason: 'expired' };
  }

  /** The host's receipt for the navigation; only the pending one is settled (a late receipt of a replaced one is ignored). */
  settle(navigationId: string, receipt: NavigationReceipt): DeferredOutcome | null {
    const insert = this.current;
    if (insert === null || insert.navigationId !== navigationId) return null;
    this.current = null;
    if (receipt.state === 'failed') {
      const uncertain = receipt.insert !== null && receipt.insert.state === 'uncertain';
      return { kind: 'failed', insert, code: receipt.code, uncertain };
    }
    const result = receipt.insert;
    if (result === null) return { kind: 'failed', insert, code: 'CG-INSERT-FAILED', uncertain: false };
    switch (result.state) {
      case 'applied':
        return { kind: 'inserted', insert, draftRevision: result.draftRevision, draftDigest: result.draftDigest };
      case 'rejected':
        return result.needs !== undefined ? { kind: 'needs-confirm', insert } : { kind: 'failed', insert, code: result.code, uncertain: false };
      case 'uncertain':
        return { kind: 'failed', insert, code: result.code, uncertain: true };
    }
  }

  private cancelOutcome(insert: DeferredInsert, reason: DeferredCancelReason): DeferredOutcome {
    return { kind: 'canceled', insert, code: 'CG-INSERT-CANCELED', reason };
  }
}
